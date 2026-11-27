import { describe, expect, it } from 'vitest';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import { buildReport, type Report } from '../../src/report/model.js';
import { toTable } from '../../src/report/table.js';

const field: FieldInfo = { kind: 'image', required: false };
const change: Change = {
  kind: 'removed-field',
  docType: 'post',
  path: 'featuredImage',
  before: field,
};

function report(failures: string[] = []): Report {
  return {
    ...buildReport({
      base: { ref: 'main', sha: 'a'.repeat(40) },
      head: { ref: 'change', sha: 'b'.repeat(40) },
      projectId: 'proj1',
      dataset: 'fixture',
      impact: [{ change, published: 249, drafts: 32, versions: 5, sample: [] }],
      validation: { introduced: [], resolvedCount: 0 },
    }),
    failures,
  };
}

describe('toTable', () => {
  it('lines up the change and its impact in plain text when colour is off', () => {
    const text = toTable(report(), { colour: false });

    expect(text).toContain(
      'Removing `post.featuredImage` leaves data in 249 published documents (32 drafts, 5 in releases)',
    );
    expect(text).not.toContain('\u001b[');
  });

  it('colours the failing result red when colour is on', () => {
    expect(toTable(report(['data-loss']), { colour: true })).toContain(
      '\u001b[31mFailed: data-loss\u001b[0m',
    );
  });

  it('shows a passing result when no rule failed', () => {
    expect(toTable(report(), { colour: false })).toContain('Passed');
  });
});

describe('toTable with Sanity v3 markers', () => {
  it('shows a rule without a code as its message alone', () => {
    const base = report();
    const withRule = buildReport({
      base: base.base,
      head: base.head,
      projectId: 'proj1',
      dataset: 'fixture',
      impact: [],
      validation: {
        introduced: [
          {
            documentType: 'product',
            pathPattern: 'title',
            code: '',
            message: "Field 'title' does not exist on type 'collectionTitle'",
            level: 'warning',
            published: 2,
            drafts: 0,
            versions: 0,
            sample: ['product-1', 'product-2'],
          },
        ],
        resolvedCount: 0,
      },
    });

    const text = toTable(withRule, { colour: false });
    expect(text).toContain("Field 'title' does not exist on type 'collectionTitle'");
    expect(text).not.toMatch(/: Field 'title'/);
  });
});

describe('toTable ordering and folds', () => {
  function withImpact(
    impact: ImpactResult[],
    validation: Report['validation'] = { introduced: [], resolvedCount: 0 },
  ) {
    return buildReport({
      base: { ref: 'main', sha: 'a'.repeat(40) },
      head: { ref: 'change', sha: 'b'.repeat(40) },
      projectId: 'proj1',
      dataset: 'fixture',
      impact,
      validation,
    });
  }

  it('lists the rows with documents before the rows with none, keeping their order', () => {
    const quiet: ImpactResult = {
      change: { kind: 'removed-field', docType: 'post', path: 'alpha', before: field },
      published: 0,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    const text = toTable(
      withImpact([quiet, { change, published: 249, drafts: 32, versions: 5, sample: [] }]),
      { colour: false },
    );

    expect(text.indexOf('featuredImage')).toBeLessThan(text.indexOf('alpha'));
    expect(text.indexOf('alpha')).toBeGreaterThan(text.indexOf('Structure'));
  });

  it('shows the document wording for validation groups', () => {
    const text = toTable(
      withImpact([], {
        introduced: [
          {
            documentType: 'product',
            pathPattern: 'body',
            code: 'value.required',
            message: 'Required',
            level: 'error',
            published: 125,
            drafts: 7,
            versions: 0,
            sample: [],
          },
          {
            documentType: 'post',
            pathPattern: 'title',
            code: 'string.maximum-length',
            message: 'Must be at most 40 characters long',
            level: 'error',
            published: 1,
            drafts: 0,
            versions: 0,
            sample: [],
          },
        ],
        resolvedCount: 0,
      }),
      { colour: false },
    );

    expect(text).toContain('125 published documents (7 drafts)');
    expect(text).toContain('1 published document');
  });
});
