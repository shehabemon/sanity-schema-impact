import { describe, expect, it } from 'vitest';
import { buildImpactQuery } from '../../src/impact/query-builder.js';
import type { Change, FieldInfo } from '../../src/diff/types.js';

const field = (overrides: Partial<FieldInfo> = {}): FieldInfo => ({
  kind: 'string',
  required: false,
  ...overrides,
});

const removedField = (docType: string, path: string): Change => ({
  kind: 'removed-field',
  docType,
  path,
  before: field(),
});

describe('buildImpactQuery: data at a path', () => {
  it('counts documents that have a top-level field', () => {
    expect(buildImpactQuery(removedField('post', 'featuredImage'))).toEqual({
      filter: '_type == $type && (defined(featuredImage))',
      params: { type: 'post' },
    });
  });

  it('translates a dotted object path into a single defined() call', () => {
    expect(buildImpactQuery(removedField('post', 'seo.ogImage'))?.filter).toBe(
      '_type == $type && (defined(seo.ogImage))',
    );
  });

  it('looks inside an array of objects with a filter on its members', () => {
    expect(buildImpactQuery(removedField('product', 'variants[].price.amount'))?.filter).toBe(
      '_type == $type && (count(variants[defined(price.amount)]) > 0)',
    );
  });

  it('counts documents whose array member path has at least one member', () => {
    expect(buildImpactQuery(removedField('product', 'tags[]'))?.filter).toBe(
      '_type == $type && (count(tags) > 0)',
    );
  });

  it('recurses through nested arrays', () => {
    expect(buildImpactQuery(removedField('post', 'a[].b[].c'))?.filter).toBe(
      '_type == $type && (count(a[count(b[defined(c)]) > 0]) > 0)',
    );
  });

  it('uses the old name for a possible rename', () => {
    const change: Change = {
      kind: 'possible-rename',
      docType: 'post',
      from: 'featuredImage',
      to: 'heroImage',
      before: field({ kind: 'image' }),
      after: field({ kind: 'image' }),
    };
    expect(buildImpactQuery(change)?.filter).toBe('_type == $type && (defined(featuredImage))');
  });

  it('uses the same data check for a type change', () => {
    const change: Change = {
      kind: 'type-changed',
      docType: 'product',
      path: 'title',
      before: field(),
      after: field({ kind: 'number' }),
      detail: 'string -> number',
    };
    expect(buildImpactQuery(change)?.filter).toBe('_type == $type && (defined(title))');
  });
});

describe('buildImpactQuery: removed types', () => {
  it('matches only the document type', () => {
    expect(buildImpactQuery({ kind: 'removed-type', docType: 'product' })).toEqual({
      filter: '_type == $type',
      params: { type: 'product' },
    });
  });
});

describe('buildImpactQuery: newly required fields', () => {
  const required = (docType: string, path: string): Change => ({
    kind: 'newly-required',
    docType,
    path,
    before: field(),
    after: field({ required: true }),
  });

  it('counts top-level documents missing the field', () => {
    expect(buildImpactQuery(required('post', 'slug'))?.filter).toBe(
      '_type == $type && (!defined(slug))',
    );
  });

  it('only counts nested misses where the parent object exists', () => {
    expect(buildImpactQuery(required('post', 'seo.title'))?.filter).toBe(
      '_type == $type && (defined(seo) && !defined(seo.title))',
    );
  });

  it('counts array members that are missing the field', () => {
    expect(buildImpactQuery(required('product', 'variants[].sku'))?.filter).toBe(
      '_type == $type && (count(variants[!defined(sku)]) > 0)',
    );
  });

  it('applies the parent check inside array members', () => {
    expect(buildImpactQuery(required('product', 'variants[].price.currency'))?.filter).toBe(
      '_type == $type && (count(variants[defined(price) && !defined(price.currency)]) > 0)',
    );
  });

  it('refuses a required flag on an array member path', () => {
    expect(() => buildImpactQuery(required('product', 'tags[]'))).toThrow(/array member/);
  });
});

describe('buildImpactQuery: options changed', () => {
  const optionsChanged = (path: string, removed: string[]): Change => ({
    kind: 'options-changed',
    docType: 'product',
    path,
    before: field({ values: ['new', 'sale', 'eco'] }),
    after: field({ values: ['new', 'sale'] }),
    removed,
    added: [],
  });

  it('counts documents that use a removed top-level value', () => {
    expect(buildImpactQuery(optionsChanged('status', ['eco']))).toEqual({
      filter: '_type == $type && (status in $removed)',
      params: { type: 'product', removed: ['eco'] },
    });
  });

  it('counts documents with a removed value on an array member', () => {
    expect(buildImpactQuery(optionsChanged('tags[]', ['eco']))?.filter).toBe(
      '_type == $type && (count(tags[@ in $removed]) > 0)',
    );
  });

  it('returns null when no value was removed', () => {
    expect(buildImpactQuery(optionsChanged('status', []))).toBeNull();
  });
});

describe('buildImpactQuery: changes with no existing content impact', () => {
  it('returns null for an added field', () => {
    expect(
      buildImpactQuery({
        kind: 'added-field',
        docType: 'post',
        path: 'subtitle',
        after: field(),
      }),
    ).toBeNull();
  });

  it('returns null for a relaxed required flag', () => {
    expect(
      buildImpactQuery({
        kind: 'no-longer-required',
        docType: 'post',
        path: 'title',
        before: field({ required: true }),
        after: field(),
      }),
    ).toBeNull();
  });
});

describe('buildImpactQuery: field name safety', () => {
  it.each([
    'title) || true //',
    'title]',
    'a-b',
    'a[]b',
    'a[][]',
    'a..b',
    '.a',
    'a.',
    '',
    'in',
    'null',
  ])('rejects the path %j', (path) => {
    expect(() => buildImpactQuery(removedField('post', path))).toThrow();
  });

  it('accepts underscore-led names', () => {
    expect(buildImpactQuery(removedField('post', '_custom.item_2'))?.filter).toBe(
      '_type == $type && (defined(_custom.item_2))',
    );
  });

  it('never interpolates the document type', () => {
    const hostile = 'post" || true || _type == "x';
    const query = buildImpactQuery(removedField(hostile, 'featuredImage'));
    expect(query?.filter).not.toContain(hostile);
    expect(query?.params).toEqual({ type: hostile });
  });
});
