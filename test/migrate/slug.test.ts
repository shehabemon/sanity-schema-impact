import { describe, expect, it } from 'vitest';
import type { Change } from '../../src/diff/types.js';
import { slugFor, uniqueSlugs, words } from '../../src/migrate/slug.js';

const field = { kind: 'string', required: false } as const;

describe('slugFor', () => {
  it('names a removed field after its type and path, in lowercase words', () => {
    const change: Change = {
      kind: 'removed-field',
      docType: 'post',
      path: 'featuredImage',
      before: field,
    };

    expect(slugFor(change)).toBe('unset-post-featured-image');
  });

  it('drops the array markers from a path inside an array', () => {
    const change: Change = {
      kind: 'removed-field',
      docType: 'product',
      path: 'variants[].price',
      before: field,
    };

    expect(slugFor(change)).toBe('unset-product-variants-price');
  });

  it('names a rename with the old and new field names', () => {
    const change: Change = {
      kind: 'possible-rename',
      docType: 'post',
      from: 'summary',
      to: 'excerpt',
      before: field,
      after: field,
    };

    expect(slugFor(change)).toBe('rename-post-summary-to-excerpt');
  });

  it('names a removed type after its documents', () => {
    expect(slugFor({ kind: 'removed-type', docType: 'category' })).toBe(
      'delete-category-documents',
    );
  });

  it('refuses a name that leaves nothing to put in the slug', () => {
    expect(() => slugFor({ kind: 'removed-type', docType: '_' })).toThrow(
      'No usable migration name: "delete--documents".',
    );
  });

  it('has no slug for change kinds that are never scaffolded', () => {
    expect(() =>
      slugFor({
        kind: 'type-changed',
        docType: 'post',
        path: 'title',
        before: field,
        after: field,
        detail: 'string to number',
      }),
    ).toThrow('No migration slug for type-changed.');
  });
});

describe('words', () => {
  it('splits camel case and separators into lowercase words', () => {
    expect(words('seoMetaTitle')).toBe('seo-meta-title');
    expect(words('seo_meta')).toBe('seo-meta');
    expect(words('seo.title')).toBe('seo-title');
  });
});

describe('uniqueSlugs', () => {
  it('keeps the first of a repeated slug and numbers the rest', () => {
    expect(
      uniqueSlugs(['unset-post-a', 'unset-post-a', 'unset-post-a', 'delete-tag-documents']),
    ).toEqual(['unset-post-a', 'unset-post-a-2', 'unset-post-a-3', 'delete-tag-documents']);
  });

  it('suffixes a slug that collides with a suffix given earlier', () => {
    expect(uniqueSlugs(['x', 'x', 'x-2'])).toEqual(['x', 'x-2', 'x-2-2']);
  });
});
