import { describe, expect, it } from 'vitest';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import { describeResult, documentsPhrase } from '../../src/report/describe.js';
import { NO_FOLDS, type RowFolds } from '../../src/report/model.js';

const field: FieldInfo = { kind: 'image', required: false };

const removedFeaturedImage: Change = {
  kind: 'removed-field',
  docType: 'post',
  path: 'featuredImage',
  before: field,
};

function counted(change: Change, published: number, drafts = 0, versions = 0): ImpactResult {
  return { change, published, drafts, versions, sample: [] };
}

function folds(overrides: Partial<RowFolds>): RowFolds {
  return { ...NO_FOLDS, ...overrides };
}

describe('documentsPhrase', () => {
  it('leaves the brackets out when there are no drafts or releases', () => {
    expect(documentsPhrase({ published: 125, drafts: 0, versions: 0 })).toBe(
      '125 published documents',
    );
  });

  it('puts drafts and releases in brackets, each only when it is above zero', () => {
    expect(documentsPhrase({ published: 125, drafts: 7, versions: 0 })).toBe(
      '125 published documents (7 drafts)',
    );
    expect(documentsPhrase({ published: 0, drafts: 0, versions: 1 })).toBe(
      '0 published documents (1 in release)',
    );
  });
});

describe('describeResult', () => {
  it('says what is left behind, with drafts and release versions in brackets', () => {
    expect(describeResult(counted(removedFeaturedImage, 249, 32, 5), NO_FOLDS)).toBe(
      'Removing `post.featuredImage` leaves data in 249 published documents (32 drafts, 5 in releases)',
    );
  });

  it('uses the singular for one published document and one draft', () => {
    expect(describeResult(counted(removedFeaturedImage, 1, 1), NO_FOLDS)).toBe(
      'Removing `post.featuredImage` leaves data in 1 published document (1 draft)',
    );
  });

  it('leaves out the bracket when there are no drafts or releases', () => {
    expect(describeResult(counted(removedFeaturedImage, 12), NO_FOLDS)).toBe(
      'Removing `post.featuredImage` leaves data in 12 published documents',
    );
  });

  it('says no existing documents are affected when every count is zero', () => {
    expect(describeResult(counted(removedFeaturedImage, 0), NO_FOLDS)).toBe(
      'Removing `post.featuredImage`: no existing documents affected',
    );
  });

  it('adds the unknown-field note to the same sentence, without a number', () => {
    expect(
      describeResult(counted(removedFeaturedImage, 249, 32, 5), folds({ 'unknown-field': 249 })),
    ).toBe(
      'Removing `post.featuredImage` leaves data in 249 published documents (32 drafts, 5 in releases); Studio also flags these as unknown fields',
    );
  });

  it('describes a newly required field', () => {
    const change: Change = {
      kind: 'newly-required',
      docType: 'post',
      path: 'slug',
      before: field,
      after: field,
    };
    expect(describeResult(counted(change, 3), NO_FOLDS)).toBe(
      'Making `post.slug` required adds problems in 3 published documents',
    );
  });

  it('says the Studio flags the same documents when its count matches the change', () => {
    const change: Change = {
      kind: 'newly-required',
      docType: 'product',
      path: 'body',
      before: field,
      after: field,
    };
    expect(describeResult(counted(change, 125, 7), folds({ required: 132 }))).toBe(
      'Making `product.body` required adds problems in 125 published documents (7 drafts); Studio flags the same documents',
    );
  });

  it('gives the Studio count when it differs from the change', () => {
    const change: Change = {
      kind: 'newly-required',
      docType: 'product',
      path: 'tags',
      before: field,
      after: field,
    };
    expect(describeResult(counted(change, 2), folds({ required: 130 }))).toBe(
      'Making `product.tags` required adds problems in 2 published documents; Studio flags 130 documents',
    );
  });

  it('uses the singular for a single document the Studio flags', () => {
    const change: Change = {
      kind: 'newly-required',
      docType: 'post',
      path: 'slug',
      before: field,
      after: field,
    };
    expect(describeResult(counted(change, 0), folds({ required: 1 }))).toBe(
      'Making `post.slug` required: no existing documents affected; Studio flags 1 document',
    );
  });

  it('describes a deleted type', () => {
    expect(
      describeResult(counted({ kind: 'removed-type', docType: 'product' }, 4, 0, 2), NO_FOLDS),
    ).toBe('Deleting type `product` orphans 4 published documents (2 in releases)');
  });

  it('describes a type change with both kinds', () => {
    const change: Change = {
      kind: 'type-changed',
      docType: 'product',
      path: 'title',
      before: { kind: 'string', required: false },
      after: { kind: 'number', required: false },
      detail: 'kind changed',
    };
    expect(describeResult(counted(change, 2), NO_FOLDS)).toBe(
      'Changing `product.title` from string to number affects 2 published documents',
    );
  });

  it('describes a possible rename with both names', () => {
    const change: Change = {
      kind: 'possible-rename',
      docType: 'post',
      from: 'featuredImage',
      to: 'heroImage',
      before: field,
      after: field,
    };
    expect(describeResult(counted(change, 3), NO_FOLDS)).toBe(
      'Possibly renamed `post.featuredImage` → `post.heroImage`: 3 published documents still use the old name',
    );
    expect(describeResult(counted(change, 0), NO_FOLDS)).toBe(
      'Possibly renamed `post.featuredImage` → `post.heroImage`: no existing documents affected',
    );
  });

  it('describes removed option values', () => {
    const change: Change = {
      kind: 'options-changed',
      docType: 'post',
      path: 'status',
      before: { kind: 'string', required: false, values: ['draft', 'live'] },
      after: { kind: 'string', required: false, values: ['live'] },
      removed: ['draft'],
      added: [],
    };
    expect(describeResult(counted(change, 2), NO_FOLDS)).toBe(
      'Removing `draft` from the allowed values of `post.status` affects 2 published documents',
    );
  });

  it('names the change and gives the reason when it was not measured', () => {
    const skipped: ImpactResult = {
      change: { kind: 'added-field', docType: 'post', path: 'x', after: field },
      skipped: 'adding a field changes no existing document',
    };
    expect(describeResult(skipped, NO_FOLDS)).toBe(
      'Adding `post.x`: not measured, adding a field changes no existing document',
    );
  });

  it('names a relaxed required flag', () => {
    const skipped: ImpactResult = {
      change: {
        kind: 'no-longer-required',
        docType: 'post',
        path: 'x',
        before: field,
        after: field,
      },
      skipped: 'relaxing a required flag changes no existing document',
    };
    expect(describeResult(skipped, NO_FOLDS)).toBe(
      'Making `post.x` optional: not measured, relaxing a required flag changes no existing document',
    );
  });

  it('names a removed type when its query failed', () => {
    const skipped: ImpactResult = {
      change: { kind: 'removed-type', docType: 'post' },
      skipped: 'request timed out',
    };
    expect(describeResult(skipped, NO_FOLDS)).toBe(
      'Deleting type `post`: not measured, request timed out',
    );
  });
});
