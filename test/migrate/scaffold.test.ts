import { describe, expect, it } from 'vitest';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import { planScaffolds } from '../../src/migrate/scaffold.js';

const field: FieldInfo = { kind: 'string', required: false };

function counted(change: Change, published = 3, drafts = 0, versions = 0): ImpactResult {
  return { change, published, drafts, versions, sample: [] };
}

const removedFeaturedImage: Change = {
  kind: 'removed-field',
  docType: 'post',
  path: 'featuredImage',
  before: { kind: 'image', required: false },
};

describe('planScaffolds', () => {
  it('writes one scaffold for a removed field that still has data', () => {
    const plan = planScaffolds([counted(removedFeaturedImage)]);

    expect(plan.notScaffolded).toEqual([]);
    expect(plan.scaffolds).toHaveLength(1);
    expect(plan.scaffolds[0]).toMatchObject({
      slug: 'unset-post-featured-image',
      change: removedFeaturedImage,
    });
    expect(plan.scaffolds[0]?.source).toContain('return at("featuredImage", unset());');
  });

  it('writes nothing for a change that counted no documents', () => {
    const plan = planScaffolds([counted(removedFeaturedImage, 0, 0, 0)]);

    expect(plan).toEqual({ scaffolds: [], notScaffolded: [] });
  });

  it('counts drafts and release versions as affected', () => {
    const plan = planScaffolds([counted(removedFeaturedImage, 0, 2, 1)]);

    expect(plan.scaffolds).toHaveLength(1);
  });

  it('writes nothing for a change the impact step skipped', () => {
    const plan = planScaffolds([
      { change: removedFeaturedImage, skipped: 'no impact query for this change' },
    ]);

    expect(plan).toEqual({ scaffolds: [], notScaffolded: [] });
  });

  it('lists a counted change that has no template, with the reason', () => {
    const change: Change = {
      kind: 'type-changed',
      docType: 'post',
      path: 'title',
      before: field,
      after: { kind: 'number', required: false },
      detail: 'string to number',
    };

    const plan = planScaffolds([counted(change)]);

    expect(plan.scaffolds).toEqual([]);
    expect(plan.notScaffolded).toEqual([
      { result: counted(change), reason: 'type-changed needs a hand-written migration' },
    ]);
  });

  it('lists newly required fields as not scaffolded', () => {
    const change: Change = {
      kind: 'newly-required',
      docType: 'post',
      path: 'slug',
      before: field,
      after: { ...field, required: true },
    };

    expect(planScaffolds([counted(change)]).notScaffolded).toHaveLength(1);
  });

  it('scaffolds a rename between two top-level fields', () => {
    const change: Change = {
      kind: 'possible-rename',
      docType: 'post',
      from: 'featuredImage',
      to: 'heroImage',
      before: field,
      after: field,
    };

    const plan = planScaffolds([counted(change)]);

    expect(plan.notScaffolded).toEqual([]);
    expect(plan.scaffolds[0]?.slug).toBe('rename-post-featured-image-to-hero-image');
  });

  it('scaffolds a rename between two fields in the same object', () => {
    const change: Change = {
      kind: 'possible-rename',
      docType: 'post',
      from: 'seo.title',
      to: 'seo.heading',
      before: field,
      after: field,
    };

    expect(planScaffolds([counted(change)]).scaffolds).toHaveLength(1);
  });

  it('lists a rename inside an array as not scaffolded', () => {
    const change: Change = {
      kind: 'possible-rename',
      docType: 'product',
      from: 'variants[].sku',
      to: 'variants[].code',
      before: field,
      after: field,
    };

    const plan = planScaffolds([counted(change)]);

    expect(plan.scaffolds).toEqual([]);
    expect(plan.notScaffolded[0]?.reason).toBe(
      'renames inside arrays need a hand-written migration',
    );
  });

  it('lists a rename that moves the field to another object as not scaffolded', () => {
    const change: Change = {
      kind: 'possible-rename',
      docType: 'post',
      from: 'seo.title',
      to: 'title',
      before: field,
      after: field,
    };

    const plan = planScaffolds([counted(change)]);

    expect(plan.scaffolds).toEqual([]);
    expect(plan.notScaffolded[0]?.reason).toBe(
      'moving a field to another object needs a hand-written migration',
    );
  });

  it('scaffolds a removed type as a migration that deletes nothing until it is changed', () => {
    const plan = planScaffolds([counted({ kind: 'removed-type', docType: 'category' })]);

    expect(plan.scaffolds[0]?.slug).toBe('delete-category-documents');
    expect(plan.scaffolds[0]?.source).toContain('// return delete_(doc._id);');
  });

  it('lists a field name outside the allowlist as not scaffolded, instead of writing it', () => {
    const change: Change = {
      kind: 'removed-field',
      docType: 'post',
      path: 'title"); evil(); //',
      before: field,
    };

    const plan = planScaffolds([counted(change)]);

    expect(plan.scaffolds).toEqual([]);
    expect(plan.notScaffolded[0]?.reason).toContain('Unsafe field name');
  });

  it('gives repeated slugs a numeric suffix', () => {
    const plan = planScaffolds([
      counted({
        kind: 'removed-field',
        docType: 'post',
        path: 'aB',
        before: field,
      }),
      counted({
        kind: 'removed-field',
        docType: 'post',
        path: 'a_b',
        before: field,
      }),
    ]);

    expect(plan.scaffolds.map((s) => s.slug)).toEqual(['unset-post-a-b', 'unset-post-a-b-2']);
  });

  it('keeps the order of the input', () => {
    const plan = planScaffolds([
      counted({ kind: 'removed-type', docType: 'tag' }),
      counted(removedFeaturedImage),
    ]);

    expect(plan.scaffolds.map((s) => s.slug)).toEqual([
      'delete-tag-documents',
      'unset-post-featured-image',
    ]);
  });
});
