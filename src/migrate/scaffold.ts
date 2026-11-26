import type { Change } from '../diff/types.js';
import type { ImpactResult } from '../impact/run.js';
import { renderMigration, type MigrationTemplate } from './template.js';
import { slugFor, uniqueSlugs } from './slug.js';

export interface Scaffold {
  readonly slug: string;
  readonly source: string;
  readonly change: Change;
}

export interface NotScaffolded {
  readonly result: ImpactResult;
  readonly reason: string;
}

export interface ScaffoldPlan {
  readonly scaffolds: readonly Scaffold[];
  readonly notScaffolded: readonly NotScaffolded[];
}

type Planned =
  | { readonly ok: true; readonly slug: string; readonly template: MigrationTemplate }
  | { readonly ok: false; readonly reason: string };

function parentOf(path: string): string {
  const cut = path.lastIndexOf('.');
  return cut === -1 ? '' : path.slice(0, cut);
}

function planOne(change: Change): Planned {
  switch (change.kind) {
    case 'removed-field':
      if (change.path.endsWith('[]')) {
        return {
          ok: false,
          reason: 'a field that ends in an array member needs a hand-written migration',
        };
      }
      return {
        ok: true,
        slug: slugFor(change),
        template: { kind: 'unset', docType: change.docType, path: change.path },
      };
    case 'possible-rename':
      if (change.from.includes('[]') || change.to.includes('[]')) {
        return { ok: false, reason: 'renames inside arrays need a hand-written migration' };
      }
      if (parentOf(change.from) !== parentOf(change.to)) {
        return {
          ok: false,
          reason: 'moving a field to another object needs a hand-written migration',
        };
      }
      return {
        ok: true,
        slug: slugFor(change),
        template: { kind: 'rename', docType: change.docType, from: change.from, to: change.to },
      };
    case 'removed-type':
      return {
        ok: true,
        slug: slugFor(change),
        template: { kind: 'delete', docType: change.docType },
      };
    default:
      return { ok: false, reason: `${change.kind} needs a hand-written migration` };
  }
}

function countedDocuments(result: ImpactResult): number {
  return 'skipped' in result ? 0 : result.published + result.drafts + result.versions;
}

/**
 * One migration per change that counted documents. Changes with no documents, and changes the
 * impact step skipped, get nothing. A counted change that has no template is listed instead.
 */
export function planScaffolds(results: readonly ImpactResult[]): ScaffoldPlan {
  const planned: { readonly result: ImpactResult; readonly outcome: Planned }[] = [];
  for (const result of results) {
    if (countedDocuments(result) === 0) continue;
    let outcome: Planned;
    try {
      outcome = planOne(result.change);
      if (outcome.ok) renderMigration(outcome.template);
    } catch (error) {
      outcome = { ok: false, reason: error instanceof Error ? error.message : 'unknown error' };
    }
    planned.push({ result, outcome });
  }

  const ready = planned.flatMap(({ result, outcome }) =>
    outcome.ok ? [{ result, slug: outcome.slug, template: outcome.template }] : [],
  );
  const slugs = uniqueSlugs(ready.map((entry) => entry.slug));

  const scaffolds: Scaffold[] = ready.map((entry, index) => ({
    slug: slugs[index] ?? entry.slug,
    source: renderMigration(entry.template),
    change: entry.result.change,
  }));
  const notScaffolded = planned.flatMap(({ result, outcome }) =>
    outcome.ok ? [] : [{ result, reason: outcome.reason }],
  );

  return { scaffolds, notScaffolded };
}
