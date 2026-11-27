import { describe, expect, it } from 'vitest';
import type { Change } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import {
  buildReport,
  foldGroups,
  hasNoImpact,
  NO_FOLDS,
  REPORT_VERSION,
  ruleGroups,
  ruleLabel,
  type ReportInput,
  rowFolds,
  visibleGroups,
} from '../../src/report/model.js';
import type { MarkerGroup } from '../../src/validation/diff.js';

const base = { ref: 'main', sha: 'a'.repeat(40) };
const head = { ref: 'change', sha: 'b'.repeat(40) };

function counted(change: Change, published: number, drafts = 0, versions = 0): ImpactResult {
  return { change, published, drafts, versions, sample: [] };
}

function removedField(docType: string, path: string): Change {
  return { kind: 'removed-field', docType, path, before: { kind: 'string', required: false } };
}

function newlyRequired(docType: string, path: string): Change {
  const field = { kind: 'string' as const, required: false };
  return {
    kind: 'newly-required',
    docType,
    path,
    before: field,
    after: { ...field, required: true },
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    base,
    head,
    projectId: 'proj1',
    dataset: 'fixture',
    impact: [],
    validation: { introduced: [], resolvedCount: 0 },
    ...overrides,
  };
}

const group: MarkerGroup = {
  documentType: 'post',
  pathPattern: 'title',
  code: 'string.maximum-length',
  message: 'Must be at most 40 characters long',
  level: 'error',
  published: 129,
  drafts: 25,
  versions: 6,
  sample: ['drafts.post-0020'],
};

describe('buildReport', () => {
  it('starts at version 1 with no failures', () => {
    const report = buildReport(input());
    expect(REPORT_VERSION).toBe(1);
    expect(report.version).toBe(1);
    expect(report.failures).toEqual([]);
  });

  it('sorts changes by document type, then path, so the order does not depend on the diff', () => {
    const report = buildReport(
      input({
        impact: [
          counted(removedField('post', 'title'), 1),
          counted(removedField('author', 'name'), 1),
          counted(removedField('post', 'body'), 1),
        ],
      }),
    );

    expect(
      report.changes.map((result) => ('path' in result.change ? result.change.path : '')),
    ).toEqual(['name', 'body', 'title']);
    expect(report.changes.map((result) => result.change.docType)).toEqual([
      'author',
      'post',
      'post',
    ]);
  });

  it('counts changes, the ones that affect documents, and the skipped ones', () => {
    const report = buildReport(
      input({
        impact: [
          counted(removedField('post', 'featuredImage'), 3),
          counted(removedField('post', 'old'), 0),
          {
            change: {
              kind: 'added-field',
              docType: 'post',
              path: 'x',
              after: { kind: 'string', required: false },
            },
            skipped: 'adding a field changes no existing document',
          },
        ],
      }),
    );

    expect(report.summary).toEqual({ changes: 3, affected: 1, skipped: 1, validationGroups: 0 });
  });

  it('counts the introduced validation groups', () => {
    const report = buildReport(input({ validation: { introduced: [group], resolvedCount: 4 } }));

    expect(report.summary.validationGroups).toBe(1);
    expect(report.validation).toEqual({ introduced: [group], resolvedCount: 4 });
  });

  it('records a skipped validation section without groups', () => {
    const report = buildReport(
      input({ validation: { skipped: 'Skipped with --skip-validation.' } }),
    );

    expect(report.validation).toEqual({ skipped: 'Skipped with --skip-validation.' });
    expect(report.summary.validationGroups).toBe(0);
  });

  it('keeps the refs, project and dataset it was given', () => {
    const report = buildReport(input());

    expect(report.base).toEqual(base);
    expect(report.head).toEqual(head);
    expect(report.projectId).toBe('proj1');
    expect(report.dataset).toBe('fixture');
  });
});

describe('unknown-field folding', () => {
  const removedField: ImpactResult = {
    change: {
      kind: 'removed-field',
      docType: 'post',
      path: 'featuredImage',
      before: { kind: 'image', required: false },
    },
    published: 249,
    drafts: 0,
    versions: 0,
    sample: [],
  };
  const unknownField: MarkerGroup = {
    documentType: 'post',
    pathPattern: 'featuredImage',
    code: 'object.unknown-field',
    message: 'Field "featuredImage" is not defined in the schema',
    level: 'warning',
    published: 249,
    drafts: 0,
    versions: 0,
    sample: [],
  };

  it('keeps the raw group in the report but hides it from the visible groups', () => {
    const report = buildReport(
      input({
        impact: [removedField],
        validation: { introduced: [unknownField], resolvedCount: 0 },
      }),
    );

    expect(report.validation).toEqual({ introduced: [unknownField], resolvedCount: 0 });
    expect(visibleGroups(report)).toEqual([]);
    expect(report.summary.validationGroups).toBe(0);
  });

  it('counts the flagged documents on the matching change row', () => {
    const report = buildReport(
      input({
        impact: [removedField],
        validation: { introduced: [unknownField], resolvedCount: 0 },
      }),
    );

    expect(rowFolds(report).get(0)?.['unknown-field']).toBe(249);
  });

  it('keeps unknown-field groups that match no removed or renamed field', () => {
    const report = buildReport(
      input({
        impact: [removedField],
        validation: {
          introduced: [{ ...unknownField, pathPattern: 'other' }],
          resolvedCount: 0,
        },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('leaves other validation codes alone even on a matching path', () => {
    const report = buildReport(
      input({
        impact: [removedField],
        validation: {
          introduced: [{ ...unknownField, code: 'string.maximum-length' }],
          resolvedCount: 0,
        },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });
});

describe('unknown-field folding for Sanity v3 markers', () => {
  const removedShop: ImpactResult = {
    change: {
      kind: 'removed-field',
      docType: 'product',
      path: 'store.shop',
      before: { kind: 'string', required: false },
    },
    published: 40,
    drafts: 3,
    versions: 0,
    sample: [],
  };
  const v3Shop: MarkerGroup = {
    documentType: 'product',
    pathPattern: 'store.shop',
    code: '',
    message: "Field 'shop' does not exist on type 'catalogProduct'",
    level: 'warning',
    published: 40,
    drafts: 3,
    versions: 0,
    sample: [],
  };

  it('folds a code-less marker that names the removed field onto its row', () => {
    const report = buildReport(
      input({
        impact: [removedShop],
        validation: { introduced: [v3Shop], resolvedCount: 0 },
      }),
    );

    expect(visibleGroups(report)).toEqual([]);
    expect(rowFolds(report).get(0)?.['unknown-field']).toBe(43);
  });

  it('keeps a code-less marker visible when the field name is not the path end', () => {
    const report = buildReport(
      input({
        impact: [removedShop],
        validation: {
          introduced: [{ ...v3Shop, message: "Field 'barcode' does not exist on type 'x'" }],
          resolvedCount: 0,
        },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('keeps a code-less marker visible when its message is not the unknown-field message', () => {
    const report = buildReport(
      input({
        impact: [removedShop],
        validation: {
          introduced: [{ ...v3Shop, message: 'Must be at most 40 characters long' }],
          resolvedCount: 0,
        },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('keeps a code-less marker visible when no change matches its document type', () => {
    const report = buildReport(
      input({
        impact: [removedShop],
        validation: {
          introduced: [{ ...v3Shop, documentType: 'collection' }],
          resolvedCount: 0,
        },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });
});

describe('required folding', () => {
  const requiredBody: ImpactResult = {
    change: newlyRequired('product', 'body'),
    published: 125,
    drafts: 7,
    versions: 0,
    sample: [],
  };
  const studioRequired: MarkerGroup = {
    documentType: 'product',
    pathPattern: 'body',
    code: 'value.required',
    message: 'Required',
    level: 'error',
    published: 125,
    drafts: 0,
    versions: 0,
    sample: ['product-1'],
  };

  it('folds a value.required group onto the matching newly-required row', () => {
    const report = buildReport(
      input({
        impact: [requiredBody],
        validation: { introduced: [studioRequired], resolvedCount: 0 },
      }),
    );

    expect(visibleGroups(report)).toEqual([]);
    expect(report.summary.validationGroups).toBe(0);
    expect(rowFolds(report).get(0)?.required).toBe(125);
  });

  it('folds a code-less Required message from Sanity v3 the same way', () => {
    const report = buildReport(
      input({
        impact: [requiredBody],
        validation: { introduced: [{ ...studioRequired, code: '' }], resolvedCount: 0 },
      }),
    );

    expect(visibleGroups(report)).toEqual([]);
    expect(rowFolds(report).get(0)?.required).toBe(125);
  });

  it('keeps a Required group visible when no newly-required change has its path', () => {
    const report = buildReport(
      input({
        impact: [requiredBody],
        validation: {
          introduced: [{ ...studioRequired, pathPattern: 'bodyText' }],
          resolvedCount: 0,
        },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('folds a Required group on a child path onto the parent row', () => {
    const slug: ImpactResult = {
      change: newlyRequired('post', 'slug'),
      published: 16,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    const child = {
      ...studioRequired,
      documentType: 'post',
      pathPattern: 'slug.current',
      published: 16,
    };
    const report = buildReport(
      input({ impact: [slug], validation: { introduced: [child], resolvedCount: 0 } }),
    );

    expect(visibleGroups(report)).toEqual([]);
    expect(rowFolds(report).get(0)?.required).toBe(16);
  });

  it('takes the largest count when an exact and a child Required group fold onto one row', () => {
    const slug: ImpactResult = {
      change: newlyRequired('post', 'slug'),
      published: 16,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    const exact = { ...studioRequired, documentType: 'post', pathPattern: 'slug', published: 16 };
    const child = { ...exact, pathPattern: 'slug.current' };
    const report = buildReport(
      input({ impact: [slug], validation: { introduced: [exact, child], resolvedCount: 0 } }),
    );

    expect(visibleGroups(report)).toEqual([]);
    expect(rowFolds(report).get(0)?.required).toBe(16);
  });

  it('keeps a child Required group visible when its parent is not a newly required change', () => {
    const removed: ImpactResult = {
      change: removedField('post', 'slug'),
      published: 16,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    const child = { ...studioRequired, documentType: 'post', pathPattern: 'slug.current' };
    const report = buildReport(
      input({ impact: [removed], validation: { introduced: [child], resolvedCount: 0 } }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('keeps a child Required group visible when the change at its parent path is for another type', () => {
    const slug: ImpactResult = {
      change: newlyRequired('page', 'slug'),
      published: 16,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    const child = { ...studioRequired, documentType: 'post', pathPattern: 'slug.current' };
    const report = buildReport(
      input({ impact: [slug], validation: { introduced: [child], resolvedCount: 0 } }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('keeps a Required group visible on a row that is not newly required', () => {
    const removed: ImpactResult = {
      change: removedField('product', 'body'),
      published: 125,
      drafts: 7,
      versions: 0,
      sample: [],
    };
    const report = buildReport(
      input({
        impact: [removed],
        validation: { introduced: [studioRequired], resolvedCount: 0 },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('keeps other messages on the same path visible', () => {
    const report = buildReport(
      input({
        impact: [requiredBody],
        validation: {
          introduced: [{ ...studioRequired, code: 'array.min-length', message: 'Required' }],
          resolvedCount: 0,
        },
      }),
    );

    expect(visibleGroups(report)).toHaveLength(1);
  });

  it('takes the largest count of the folded Required groups on the row, not their sum', () => {
    const report = buildReport(
      input({
        impact: [requiredBody],
        validation: {
          introduced: [studioRequired, { ...studioRequired, code: '', published: 0, drafts: 2 }],
          resolvedCount: 0,
        },
      }),
    );

    expect(rowFolds(report).get(0)?.required).toBe(125);
  });
});

describe('ruleGroups', () => {
  const oldField: ImpactResult = {
    change: removedField('post', 'old'),
    published: 3,
    drafts: 0,
    versions: 0,
    sample: [],
  };
  const unknown: MarkerGroup = {
    documentType: 'post',
    pathPattern: 'old',
    code: 'object.unknown-field',
    message: 'Field "old" is not defined in the schema',
    level: 'warning',
    published: 3,
    drafts: 0,
    versions: 0,
    sample: [],
  };
  const required: MarkerGroup = {
    documentType: 'post',
    pathPattern: 'slug.current',
    code: 'value.required',
    message: 'Required',
    level: 'error',
    published: 2,
    drafts: 0,
    versions: 0,
    sample: [],
  };

  it('still counts a folded child Required group, and drops a folded unknown-field group', () => {
    const report = buildReport(
      input({
        impact: [
          oldField,
          {
            change: newlyRequired('post', 'slug'),
            published: 2,
            drafts: 0,
            versions: 0,
            sample: [],
          },
        ],
        validation: { introduced: [unknown, required], resolvedCount: 0 },
      }),
    );

    expect(visibleGroups(report)).toEqual([]);
    expect(ruleGroups(report)).toEqual([required]);
  });
});

describe('foldGroups', () => {
  it('hides only the kinds it is asked to hide', () => {
    const changes: ImpactResult[] = [
      { change: newlyRequired('post', 'slug'), published: 2, drafts: 0, versions: 0, sample: [] },
    ];
    const requiredGroup: MarkerGroup = {
      documentType: 'post',
      pathPattern: 'slug',
      code: 'value.required',
      message: 'Required',
      level: 'error',
      published: 2,
      drafts: 0,
      versions: 0,
      sample: [],
    };

    const kept = foldGroups(changes, [requiredGroup], ['unknown-field']);
    expect(kept.groups).toEqual([requiredGroup]);
    expect(kept.rows.size).toBe(0);
  });
});

describe('hasNoImpact', () => {
  const zero = counted(removedField('post', 'old'), 0);

  it('is true for a counted change with no documents and nothing folded onto it', () => {
    expect(hasNoImpact(zero, NO_FOLDS)).toBe(true);
    expect(hasNoImpact(zero, undefined)).toBe(true);
  });

  it('is false once the change has documents', () => {
    expect(hasNoImpact(counted(removedField('post', 'old'), 0, 1), NO_FOLDS)).toBe(false);
  });

  it('is false when the Studio still flags documents on the row', () => {
    expect(hasNoImpact(zero, { ...NO_FOLDS, required: 2 })).toBe(false);
  });

  it('is false for a change that could not be measured, which is always shown', () => {
    const skipped: ImpactResult = {
      change: removedField('post', 'old'),
      skipped: 'nothing to count',
    };
    expect(hasNoImpact(skipped, NO_FOLDS)).toBe(false);
  });

  it('is true for changes that never touch existing documents', () => {
    const info = { kind: 'string', required: false } as const;
    const added: ImpactResult = {
      change: { kind: 'added-field', docType: 'post', path: 'x', after: info },
      skipped: 'adding a field changes no existing document',
    };
    const relaxed: ImpactResult = {
      change: { kind: 'no-longer-required', docType: 'post', path: 'x', before: info, after: info },
      skipped: 'relaxing a required flag changes no existing document',
    };
    const widened: ImpactResult = {
      change: {
        kind: 'options-changed',
        docType: 'post',
        path: 'x',
        before: info,
        after: info,
        removed: [],
        added: ['b'],
      },
      skipped: 'no option was removed',
    };
    expect(hasNoImpact(added, NO_FOLDS)).toBe(true);
    expect(hasNoImpact(relaxed, NO_FOLDS)).toBe(true);
    expect(hasNoImpact(widened, NO_FOLDS)).toBe(true);
  });
});

describe('ruleLabel', () => {
  it('puts the code before the message', () => {
    expect(ruleLabel('string.maximum-length', 'Must be at most 40 characters long')).toBe(
      'string.maximum-length: Must be at most 40 characters long',
    );
  });

  it('shows the message alone when the marker has no code', () => {
    expect(ruleLabel('', "Field 'shop' does not exist on type 'catalogProduct'")).toBe(
      "Field 'shop' does not exist on type 'catalogProduct'",
    );
  });
});
