import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffSchemas } from '../../src/diff/classify.js';
import { normalise } from '../../src/diff/normalise.js';
import type { Change } from '../../src/diff/types.js';

const loadExtract = (kind: string, side: 'before' | 'after'): unknown =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/schemas/${kind}/${side}.json`, import.meta.url), 'utf8'),
  );

const diffFixture = (kind: string): Change[] =>
  diffSchemas(normalise(loadExtract(kind, 'before')), normalise(loadExtract(kind, 'after')));

describe('fixture schema pairs', () => {
  it('reports exactly one removed type and nothing for its fields', () => {
    expect(diffFixture('removed-type')).toEqual([{ kind: 'removed-type', docType: 'product' }]);
  });

  it('reports exactly one removed field', () => {
    expect(diffFixture('removed-field')).toEqual([
      {
        kind: 'removed-field',
        docType: 'product',
        path: 'legacySku',
        before: { kind: 'string', required: false },
      },
    ]);
  });

  it('reports exactly one added field', () => {
    expect(diffFixture('added-field')).toEqual([
      {
        kind: 'added-field',
        docType: 'post',
        path: 'subtitle',
        after: { kind: 'string', required: false },
      },
    ]);
  });

  it('reports exactly one type change', () => {
    expect(diffFixture('type-changed')).toEqual([
      {
        kind: 'type-changed',
        docType: 'product',
        path: 'title',
        before: { kind: 'string', required: false },
        after: { kind: 'number', required: false },
        detail: 'string → number',
      },
    ]);
  });

  it('reports exactly one newly required field', () => {
    expect(diffFixture('newly-required')).toEqual([
      {
        kind: 'newly-required',
        docType: 'post',
        path: 'slug',
        before: { kind: 'slug', required: false },
        after: { kind: 'slug', required: true },
      },
    ]);
  });

  it('reports exactly one possible rename', () => {
    expect(diffFixture('possible-rename')).toEqual([
      {
        kind: 'possible-rename',
        docType: 'post',
        from: 'featuredImage',
        to: 'heroImage',
        before: { kind: 'image', required: false },
        after: { kind: 'image', required: false },
      },
    ]);
  });

  it('normalises the post fields of the real extract', () => {
    const post = normalise(loadExtract('removed-type', 'before')).get('post');

    expect([...(post?.keys() ?? [])].sort()).toEqual([
      'author',
      'body',
      'categories',
      'categories[]',
      'featuredImage',
      'publishedAt',
      'seo',
      'seo.description',
      'seo.ogImage',
      'seo.title',
      'slug',
      'title',
    ]);
    expect(post?.get('categories[]')).toEqual({
      kind: 'reference',
      refTo: ['category'],
      required: false,
    });
    expect(post?.get('seo.title')).toEqual({ kind: 'string', required: false });
    expect(post?.get('featuredImage')?.kind).toBe('image');
  });
});
