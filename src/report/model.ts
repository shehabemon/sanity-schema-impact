import type { Change } from '../diff/types.js';
import type { ImpactResult } from '../impact/run.js';
import type { MarkerGroup } from '../validation/diff.js';

export const REPORT_VERSION = 1;

/** The code the Studio's validator uses for a field the schema no longer defines. */
export const UNKNOWN_FIELD_CODE = 'object.unknown-field';

/** The code the Studio's validator uses for a required field that is missing or empty. */
export const REQUIRED_CODE = 'value.required';

/** Sanity v3 reports the same problem with no code, only this message. */
const V3_UNKNOWN_FIELD = /^Field '([^']+)' does not exist on type '[^']+'$/;

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
  /** Validation groups left after folding, see `foldGroups`. */
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

/** A validation group that repeats a fact a structural row already states. */
export type FoldKind = 'unknown-field' | 'required';

/** Documents the Studio flags, per fold kind, on one change row. */
export type RowFolds = Readonly<Record<FoldKind, number>>;

export const NO_FOLDS: RowFolds = { 'unknown-field': 0, required: 0 };

export interface Folded {
  /** Groups that were not folded onto a row. */
  readonly groups: MarkerGroup[];
  /** Index in `changes` -> documents folded onto that row. Only rows with a fold have an entry. */
  readonly rows: ReadonlyMap<number, RowFolds>;
}

interface Fold {
  readonly matchesGroup: (group: MarkerGroup) => boolean;
  readonly matchesChange: (change: Change) => boolean;
  /** Whether a group at `groupPath` belongs on a row at `rowPath`, after the exact match fails. */
  readonly matchesChildPath: (groupPath: string, rowPath: string) => boolean;
  /** Combines the counts of two groups folded onto the same row. */
  readonly combine: (current: number, next: number) => number;
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
 * True for a group that says a field is not in the schema. With a code that's the Studio's
 * unknown-field code. Without one it's the v3 message, and the field has to be the last segment
 * of the path, so `Field 'shop'` only matches a path ending in `shop`.
 */
function isUnknownFieldGroup(group: MarkerGroup): boolean {
  if (group.code === UNKNOWN_FIELD_CODE) return true;
  if (group.code !== '') return false;
  const named = V3_UNKNOWN_FIELD.exec(group.message)?.[1];
  return named !== undefined && group.pathPattern.split('.').pop() === named;
}

/**
 * True for the Studio's required check. Sanity v3 writes the message alone, so the message has to
 * be exactly `Required` there.
 */
function isRequiredGroup(group: MarkerGroup): boolean {
  if (group.code === REQUIRED_CODE) return true;
  return group.code === '' && group.message === 'Required';
}

const FOLDS: Record<FoldKind, Fold> = {
  'unknown-field': {
    matchesGroup: isUnknownFieldGroup,
    matchesChange: () => true,
    matchesChildPath: () => false,
    combine: (current, next) => current + next,
  },
  // Required groups on one row cover the same documents, so the row takes the largest count.
  // A nested child such as `slug.current` also folds onto its parent's row.
  required: {
    matchesGroup: isRequiredGroup,
    matchesChange: (change) => change.kind === 'newly-required',
    matchesChildPath: (groupPath, rowPath) => groupPath.startsWith(`${rowPath}.`),
    combine: Math.max,
  },
};

const FOLD_KINDS: readonly FoldKind[] = ['unknown-field', 'required'];

/** The rule text for a row: the code and message, or the message alone when there's no code. */
export function ruleLabel(code: string, message: string): string {
  return code === '' ? message : `${code}: ${message}`;
}

/**
 * Hides the validation groups that repeat a structural row and counts their documents on the row.
 * A removed field's documents fail the Studio's unknown-field check, and a newly required field's
 * empty documents fail its required check. Both facts are already on the row, so the raw groups
 * stay in the report and the table shows the row's note instead. `hide` lists the kinds to fold,
 * and both kinds by default.
 */
/**
 * The row a group folds onto. An exact path match wins. Otherwise a fold may take a child path,
 * and the first such row is used.
 */
function findRow(changes: readonly ImpactResult[], group: MarkerGroup, fold: Fold): number {
  const sameDocumentType = (result: ImpactResult): boolean =>
    result.change.docType === group.documentType && fold.matchesChange(result.change);
  const exact = changes.findIndex((result) => {
    const path = pathOf(result.change);
    return sameDocumentType(result) && path === group.pathPattern;
  });
  if (exact !== -1) return exact;
  return changes.findIndex((result) => {
    const path = pathOf(result.change);
    return (
      sameDocumentType(result) &&
      path !== undefined &&
      fold.matchesChildPath(group.pathPattern, path)
    );
  });
}

export function foldGroups(
  changes: readonly ImpactResult[],
  groups: readonly MarkerGroup[],
  hide: readonly FoldKind[] = FOLD_KINDS,
): Folded {
  const rows = new Map<number, RowFolds>();
  const kept = groups.filter((group) => {
    for (const kind of hide) {
      const fold = FOLDS[kind];
      if (!fold.matchesGroup(group)) continue;
      const index = findRow(changes, group, fold);
      if (index === -1) return true;
      const current = rows.get(index) ?? NO_FOLDS;
      rows.set(index, { ...current, [kind]: fold.combine(current[kind], documentsIn(group)) });
      return false;
    }
    return true;
  });
  return { groups: kept, rows };
}

function foldedValidation(report: Report, hide?: readonly FoldKind[]): Folded {
  if (!('introduced' in report.validation)) return { groups: [], rows: new Map() };
  return foldGroups(report.changes, report.validation.introduced, hide);
}

/** The validation groups the report shows and counts. Empty when validation was skipped. */
export function visibleGroups(report: Report): readonly MarkerGroup[] {
  return foldedValidation(report).groups;
}

/**
 * The groups `--fail-on` evaluates. A folded Required group still counts, so hiding it doesn't
 * stop the check failing. A folded unknown-field group doesn't count, as before.
 */
export function ruleGroups(report: Report): readonly MarkerGroup[] {
  return foldedValidation(report, ['unknown-field']).groups;
}

/** The folds on each change row, keyed by index in `report.changes`. */
export function rowFolds(report: Report): ReadonlyMap<number, RowFolds> {
  return foldedValidation(report).rows;
}

/** Changes that can't touch existing documents, so they are never measured. */
function touchesNoDocuments(change: Change): boolean {
  if (change.kind === 'added-field' || change.kind === 'no-longer-required') return true;
  return change.kind === 'options-changed' && change.removed.length === 0;
}

/**
 * True for a change with no documents and nothing the Studio flags on its row. Those rows are the
 * quiet ones. A change that can't touch documents is quiet too. Any other skipped change, such as
 * a failed query, is always shown.
 */
export function hasNoImpact(result: ImpactResult, folds: RowFolds | undefined): boolean {
  if (!('published' in result)) return touchesNoDocuments(result.change);
  const flagged = folds === undefined ? 0 : folds['unknown-field'] + folds.required;
  return result.published + result.drafts + result.versions === 0 && flagged === 0;
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
