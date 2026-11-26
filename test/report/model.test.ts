import { describe, expect, it } from 'vitest';
import type { Change } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import {
  buildReport,
  type Report,
  foldUnknownFields,
  REPORT_VERSION,
  visibleGroups,
  type ReportInput,
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

function unknownGroups(report: Report): MarkerGroup[] {
  return 'introduced' in report.validation ? [...report.validation.introduced] : [];
}

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

    expect(foldUnknownFields(report.changes, unknownGroups(report)).flagged.get(0)).toBe(249);
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
