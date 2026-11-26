import { describe, expect, it } from 'vitest';
import type { Change, FieldInfo } from '../../src/diff/types.js';
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
