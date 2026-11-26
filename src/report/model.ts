import type { Change } from '../diff/types.js';
import type { ImpactResult } from '../impact/run.js';
import type { MarkerGroup } from '../validation/diff.js';

export const REPORT_VERSION = 1;

/** The code the Studio's validator uses for a field the schema no longer defines. */
export const UNKNOWN_FIELD_CODE = 'object.unknown-field';

export interface RefInfo {
  readonly ref: string;
  readonly sha: string;
  /** Set on the head when the Studio has uncommitted changes. */
  readonly uncommitted?: boolean;
}

export type ValidationSection =
  | { readonly introduced: readonly MarkerGroup[]; readonly resolvedCount: number }
  | { readonly skipped: string };

export interface ReportInput {
  readonly base: RefInfo;
  readonly head: RefInfo;
  readonly projectId: string;
  readonly dataset: string;
  readonly impact: readonly ImpactResult[];
  readonly validation: ValidationSection;
}

export interface ReportSummary {
  readonly changes: number;
  /** Changes with at least one document counted. */
  readonly affected: number;
  readonly skipped: number;
  /** Validation groups left after folding, see `foldUnknownFields`. */
  readonly validationGroups: number;
}

export interface Report {
  readonly version: number;
  readonly base: RefInfo;
  readonly head: RefInfo;
  readonly projectId: string;
  readonly dataset: string;
  readonly summary: ReportSummary;
  readonly changes: readonly ImpactResult[];
  readonly validation: ValidationSection;
  /** Names of the rules that matched, filled in after evaluation. */
  readonly failures: readonly string[];
}

export interface Folded {
  readonly groups: MarkerGroup[];
  /** Index in `changes` -> documents flagged as unknown field on that row. */
  readonly flagged: ReadonlyMap<number, number>;
}

function pathOf(change: Change): string | undefined {
  if (change.kind === 'possible-rename') return change.from;
  return 'path' in change ? change.path : undefined;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareResults(a: ImpactResult, b: ImpactResult): number {
  return (
    compareText(a.change.docType, b.change.docType) ||
    compareText(pathOf(a.change) ?? '', pathOf(b.change) ?? '') ||
    compareText(a.change.kind, b.change.kind)
  );
}

function documentsIn(group: MarkerGroup): number {
  return group.published + group.drafts + group.versions;
}

/**
 * Removing a field makes every document that still holds it fail the Studio's unknown-field
 * check. That's the same fact as the structural row, so those groups are hidden and counted on
 * the row instead. The raw groups stay in the report.
 */
export function foldUnknownFields(
  changes: readonly ImpactResult[],
  groups: readonly MarkerGroup[],
): Folded {
  const flagged = new Map<number, number>();
  const visible = groups.filter((group) => {
    if (group.code !== UNKNOWN_FIELD_CODE) return true;
    const index = changes.findIndex(
      (result) =>
        result.change.docType === group.documentType && pathOf(result.change) === group.pathPattern,
    );
    if (index === -1) return true;
    flagged.set(index, (flagged.get(index) ?? 0) + documentsIn(group));
    return false;
  });
  return { groups: visible, flagged };
}

/** The validation groups the report shows and evaluates. Empty when validation was skipped. */
export function visibleGroups(report: Report): readonly MarkerGroup[] {
  if (!('introduced' in report.validation)) return [];
  return foldUnknownFields(report.changes, report.validation.introduced).groups;
}

export function buildReport(input: ReportInput): Report {
  const changes = [...input.impact].sort(compareResults);
  const partial = {
    version: REPORT_VERSION,
    base: input.base,
    head: input.head,
    projectId: input.projectId,
    dataset: input.dataset,
    changes,
    validation: input.validation,
    failures: [],
  };
  const withSummary = {
    ...partial,
    summary: {
      changes: changes.length,
      affected: changes.filter(
        (result) => 'published' in result && result.published + result.drafts + result.versions > 0,
      ).length,
      skipped: changes.filter((result) => 'skipped' in result).length,
      validationGroups: 0,
    },
  };
  return {
    ...withSummary,
    summary: { ...withSummary.summary, validationGroups: visibleGroups(withSummary).length },
  };
}
