import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHUNK_SIZE,
  buildBatchQueries,
  buildBatchQuery,
  type BatchItem,
} from '../../src/impact/batch.js';

const item = (id: string, filter: string, params: Record<string, unknown>): BatchItem => ({
  id,
  query: { filter, params },
});

const removedType = (id: string, type: string): BatchItem => item(id, '_type == $type', { type });

const removedValues = (id: string, type: string, removed: string[]): BatchItem =>
  item(id, `_type == $type && (status in $removed)`, { type, removed });

const parametersIn = (query: string): string[] =>
  [...new Set(query.match(/\$[A-Za-z_][A-Za-z0-9_]*/g) ?? [])].map((p) => p.slice(1)).sort();

describe('buildBatchQuery', () => {
  it('returns one object entry per item with published, drafts, versions and sample counts', () => {
    const { query } = buildBatchQuery([removedType('product', 'product')]);
    expect(query.startsWith('{"product": {')).toBe(true);
    for (const key of ['"published":', '"drafts":', '"versions":', '"sample":']) {
      expect(query).toContain(key);
    }
  });

  it('separates drafts and release versions from published documents by ID prefix', () => {
    const { query } = buildBatchQuery([removedType('product', 'product')]);
    expect(query).toContain(
      '"published": count(*[(_type == $q0_type) && !(_id in path("drafts.**")) && !(_id in path("versions.**"))])',
    );
    expect(query).toContain('"drafts": count(*[(_type == $q0_type) && _id in path("drafts.**")])');
    expect(query).toContain(
      '"versions": count(*[(_type == $q0_type) && _id in path("versions.**")])',
    );
  });

  it('takes the five lowest sample IDs in ascending order', () => {
    const { query } = buildBatchQuery([removedType('product', 'product')]);
    expect(query).toContain('"sample": *[(_type == $q0_type)] | order(_id asc)[0...5]._id');
  });

  it('keys each entry by its JSON-encoded item ID', () => {
    const { query } = buildBatchQuery([removedType('post.featuredImage:removed-field', 'post')]);
    expect(query.startsWith('{"post.featuredImage:removed-field": {')).toBe(true);
  });

  it('namespaces parameters per item so items with the same names do not collide', () => {
    const batch = buildBatchQuery([
      removedType('a', 'post'),
      removedValues('b', 'product', ['eco', 'sale']),
    ]);
    expect(batch.params).toEqual({
      q0_type: 'post',
      q1_type: 'product',
      q1_removed: ['eco', 'sale'],
    });
  });

  it('references only parameters it supplies, and supplies every parameter it references', () => {
    const batch = buildBatchQuery([
      removedType('a', 'post'),
      removedValues('b', 'product', ['eco']),
    ]);
    expect(parametersIn(batch.query)).toEqual(Object.keys(batch.params).sort());
  });

  it('rewrites parameter names inside the filter text', () => {
    const batch = buildBatchQuery([removedValues('b', 'product', ['eco'])]);
    expect(batch.query).toContain('status in $q0_removed');
    expect(batch.query).not.toMatch(/\$removed\b/);
    expect(batch.query).not.toMatch(/\$type\b/);
  });

  it('lists the IDs it covers in item order', () => {
    const batch = buildBatchQuery([removedType('x', 'post'), removedType('y', 'author')]);
    expect(batch.ids).toEqual(['x', 'y']);
  });

  it('refuses an empty list', () => {
    expect(() => buildBatchQuery([])).toThrow(/at least one/);
  });

  it('refuses duplicate IDs', () => {
    expect(() => buildBatchQuery([removedType('x', 'post'), removedType('x', 'author')])).toThrow(
      /duplicate/i,
    );
  });
});

describe('buildBatchQueries', () => {
  const items = Array.from({ length: 45 }, (_, i) => removedType(`change-${String(i)}`, 'post'));

  it('splits items into chunks of the default size', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(20);
    const batches = buildBatchQueries(items);
    expect(batches.map((b) => b.ids.length)).toEqual([20, 20, 5]);
  });

  it('honours a configured chunk size', () => {
    const batches = buildBatchQueries(items, 10);
    expect(batches).toHaveLength(5);
    expect(batches.flatMap((b) => b.ids)).toEqual(items.map((i) => i.id));
  });

  it('returns no batches for no items', () => {
    expect(buildBatchQueries([])).toEqual([]);
  });

  it.each([0, -1, 2.5])('refuses chunk size %s', (size) => {
    expect(() => buildBatchQueries(items, size)).toThrow(/chunk size/i);
  });
});
