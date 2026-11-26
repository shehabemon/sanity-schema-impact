import { describe, expect, it } from 'vitest';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import { describeResult } from '../../src/report/describe.js';

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

describe('describeResult', () => {
  it('says what is left behind, with drafts and release versions in brackets', () => {
    expect(describeResult(counted(removedFeaturedImage, 249, 32, 5), 0)).toBe(
      'Removing `post.featuredImage` leaves data in 249 published documents (32 drafts, 5 in releases)',
    );
  });

  it('uses the singular for one published document and one draft', () => {
    expect(describeResult(counted(removedFeaturedImage, 1, 1), 0)).toBe(
      'Removing `post.featuredImage` leaves data in 1 published document (1 draft)',
    );
  });

  it('leaves out the bracket when there are no drafts or releases', () => {
    expect(describeResult(counted(removedFeaturedImage, 12), 0)).toBe(
      'Removing `post.featuredImage` leaves data in 12 published documents',
    );
  });

  it('says no existing documents are affected when every count is zero', () => {
    expect(describeResult(counted(removedFeaturedImage, 0), 0)).toBe(
      'Removing `post.featuredImage`: no existing documents affected',
    );
  });

  it('adds the unknown-field note to the same sentence, without a number', () => {
    expect(describeResult(counted(removedFeaturedImage, 249, 32, 5), 249)).toBe(
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
    expect(describeResult(counted(change, 3), 0)).toBe(
      'Making `post.slug` required adds problems in 3 published documents',
    );
  });

  it('describes a deleted type', () => {
    expect(describeResult(counted({ kind: 'removed-type', docType: 'product' }, 4, 0, 2), 0)).toBe(
      'Deleting type `product` orphans 4 published documents (2 in releases)',
    );
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
    expect(describeResult(counted(change, 2), 0)).toBe(
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
    expect(describeResult(counted(change, 3), 0)).toBe(
      'Possibly renamed `post.featuredImage` → `post.heroImage`: 3 published documents still use the old name',
    );
    expect(describeResult(counted(change, 0), 0)).toBe(
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
    expect(describeResult(counted(change, 2), 0)).toBe(
      'Removing `draft` from the allowed values of `post.status` affects 2 published documents',
    );
  });

  it('gives the reason for a change that was not measured', () => {
    const skipped: ImpactResult = {
      change: { kind: 'added-field', docType: 'post', path: 'x', after: field },
      skipped: 'adding a field changes no existing document',
    };
    expect(describeResult(skipped, 0)).toBe(
      'Not measured: adding a field changes no existing document',
    );
  });
});
