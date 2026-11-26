import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalise } from '../../src/diff/normalise.js';
import type { NormalisedSchema } from '../../src/diff/types.js';
import {
  array,
  attr,
  bool,
  documentEntry,
  inline,
  named,
  num,
  object,
  reference,
  str,
  typeEntry,
  union,
  unknownValue,
} from './factories.js';

const paths = (schema: NormalisedSchema, docType: string) =>
  [...(schema.get(docType)?.keys() ?? [])].sort();

const field = (schema: NormalisedSchema, docType: string, path: string) =>
  schema.get(docType)?.get(path);

describe('normalise', () => {
  it('lists nested object fields with dot-separated paths', () => {
    const schema = normalise([
      documentEntry('post', {
        title: attr(str(), true),
        seo: attr(object({ title: attr(str()), description: attr(str()) })),
      }),
    ]);

    expect(paths(schema, 'post')).toEqual(['seo', 'seo.description', 'seo.title', 'title']);
    expect(field(schema, 'post', 'title')).toEqual({ kind: 'string', required: true });
    expect(field(schema, 'post', 'seo')).toEqual({ kind: 'object', required: false });
    expect(field(schema, 'post', 'seo.title')).toEqual({ kind: 'string', required: false });
  });

  it('uses [] for array members and records the member kind', () => {
    const schema = normalise([
      documentEntry('product', {
        variants: attr(
          array(
            named('variant', {
              sku: attr(str()),
              price: attr(object({ amount: attr(num()) })),
            }),
          ),
        ),
        tags: attr(array(str())),
      }),
    ]);

    expect(paths(schema, 'product')).toEqual([
      'tags',
      'tags[]',
      'variants',
      'variants[]',
      'variants[].price',
      'variants[].price.amount',
      'variants[].sku',
    ]);
    expect(field(schema, 'product', 'variants')).toEqual({
      kind: 'array',
      of: ['variant'],
      required: false,
    });
    expect(field(schema, 'product', 'variants[]')).toEqual({
      kind: 'object',
      typeName: 'variant',
      required: false,
    });
    expect(field(schema, 'product', 'tags[]')).toEqual({ kind: 'string', required: false });
  });

  it('drops _key, _type, _ref, _weak and system attributes from paths', () => {
    const schema = normalise([
      documentEntry('product', {
        variants: attr(
          array(
            named('variant', { sku: attr(str()) }, { rest: object({ _key: attr(str(), true) }) }),
          ),
        ),
      }),
    ]);

    expect(paths(schema, 'product')).toEqual(['variants', 'variants[]', 'variants[].sku']);
  });

  it('collapses image, file and slug fields into one field each', () => {
    const schema = normalise([
      typeEntry('slug', named('slug', { current: attr(str(), true), source: attr(str()) })),
      documentEntry('post', {
        hero: attr(
          named('image', {
            asset: attr(inline('sanity.imageAsset.reference')),
            hotspot: attr(inline('sanity.imageHotspot')),
            crop: attr(inline('sanity.imageCrop')),
            media: attr(unknownValue()),
          }),
        ),
        attachment: attr(named('file', { asset: attr(inline('sanity.fileAsset.reference')) })),
        slug: attr(inline('slug')),
      }),
    ]);

    expect(paths(schema, 'post')).toEqual(['attachment', 'hero', 'slug']);
    expect(field(schema, 'post', 'hero')?.kind).toBe('image');
    expect(field(schema, 'post', 'attachment')?.kind).toBe('file');
    expect(field(schema, 'post', 'slug')?.kind).toBe('slug');
  });

  it('resolves references, including array members, to their target types', () => {
    const schema = normalise([
      typeEntry('author.reference', reference('author')),
      typeEntry('category.reference', reference('category')),
      documentEntry('post', {
        author: attr(inline('author.reference')),
        categories: attr(
          array(object({ _key: attr(str(), true) }, { rest: inline('category.reference') })),
        ),
      }),
    ]);

    expect(field(schema, 'post', 'author')).toEqual({
      kind: 'reference',
      refTo: ['author'],
      required: false,
    });
    expect(field(schema, 'post', 'categories')).toEqual({
      kind: 'array',
      of: ['reference'],
      required: false,
    });
    expect(field(schema, 'post', 'categories[]')).toEqual({
      kind: 'reference',
      refTo: ['category'],
      required: false,
    });
  });

  it('keeps every target of a multi-type reference, sorted', () => {
    const schema = normalise([
      typeEntry('media.reference', reference(['video', 'image'])),
      documentEntry('post', { media: attr(inline('media.reference')) }),
    ]);

    expect(field(schema, 'post', 'media')?.refTo).toEqual(['image', 'video']);
  });

  it('expands a named type under every field that uses it', () => {
    const schema = normalise([
      typeEntry('address', named('address', { street: attr(str(), true) })),
      documentEntry('order', {
        billing: attr(inline('address')),
        shipping: attr(inline('address')),
      }),
    ]);

    expect(paths(schema, 'order')).toEqual([
      'billing',
      'billing.street',
      'shipping',
      'shipping.street',
    ]);
    expect(field(schema, 'order', 'billing')).toEqual({
      kind: 'object',
      typeName: 'address',
      required: false,
    });
    expect(field(schema, 'order', 'shipping.street')?.required).toBe(true);
  });

  it('stops at a recursive named type and keeps its name as the kind', () => {
    const schema = normalise([
      typeEntry(
        'node',
        named('node', { title: attr(str()), children: attr(array(inline('node'))) }),
      ),
      documentEntry('page', { tree: attr(inline('node')) }),
    ]);

    expect(paths(schema, 'page')).toEqual([
      'tree',
      'tree.children',
      'tree.children[]',
      'tree.title',
    ]);
    expect(field(schema, 'page', 'tree.children[]')).toEqual({
      kind: 'object',
      typeName: 'node',
      required: false,
    });
  });

  it('keeps portable text as one field and lists its member types', () => {
    const schema = normalise([
      documentEntry('post', {
        body: attr(
          array(
            named('block', {
              children: attr(
                array(union(named('span', { text: attr(str()) }), named('mention', {}))),
              ),
              style: attr(union(str('normal'), str('h1'))),
              markDefs: attr(array(named('link', { href: attr(str()) }))),
            }),
          ),
        ),
      }),
    ]);

    expect(paths(schema, 'post')).toEqual(['body']);
    expect(field(schema, 'post', 'body')).toEqual({
      kind: 'portableText',
      of: ['block'],
      required: false,
    });
  });

  it('lists custom portable text members next to the block', () => {
    const schema = normalise([
      documentEntry('post', {
        body: attr(array(union(named('block', {}), named('callout', { text: attr(str()) })))),
      }),
    ]);

    expect(paths(schema, 'post')).toEqual(['body']);
    expect(field(schema, 'post', 'body')?.of).toEqual(['block', 'callout']);
  });

  it('reports a string union as a string with its sorted option values', () => {
    const schema = normalise([
      documentEntry('post', { size: attr(union(str('m'), str('l'), str('s'))) }),
    ]);

    expect(field(schema, 'post', 'size')).toEqual({
      kind: 'string',
      values: ['l', 'm', 's'],
      required: false,
    });
  });

  it('takes required from optional === false and nothing else', () => {
    const schema = normalise([
      documentEntry('post', {
        title: attr(str(), true),
        subtitle: attr(str()),
        legacy: { type: 'objectAttribute', value: str() },
        published: attr(bool(), true),
      }),
    ]);

    expect(field(schema, 'post', 'title')?.required).toBe(true);
    expect(field(schema, 'post', 'subtitle')?.required).toBe(false);
    expect(field(schema, 'post', 'legacy')?.required).toBe(false);
    expect(field(schema, 'post', 'published')?.required).toBe(true);
  });

  it('skips sanity and system documents', () => {
    const schema = normalise([
      documentEntry('sanity.imageAsset', { url: attr(str()) }),
      documentEntry('system.release', { name: attr(str()) }),
      documentEntry('post', { title: attr(str(), true) }),
    ]);

    expect([...schema.keys()]).toEqual(['post']);
  });

  it('throws a clear error on an entry it does not recognise', () => {
    expect(() => normalise({})).toThrow(/Unrecognised schema extract/);
    expect(() => normalise([{ type: 'document' }])).toThrow(/Unrecognised schema extract/);
    expect(() =>
      normalise([
        documentEntry('post', { x: { type: 'objectAttribute', value: { type: 'mystery' } } }),
      ]),
    ).toThrow('Unrecognised schema extract at x: unsupported node type "mystery"');
  });

  it('throws on a node that is missing the keys it needs', () => {
    expect(() => normalise([documentEntry('post', { x: attr({ type: 'inline' }) })])).toThrow(
      'malformed "inline" node',
    );
    expect(() => normalise([documentEntry('post', { x: attr({ type: 'object' }) })])).toThrow(
      'malformed "object" node',
    );
    expect(() => normalise([documentEntry('post', { x: attr({ type: 'array' }) })])).toThrow(
      'malformed "array" node',
    );
    expect(() =>
      normalise([documentEntry('post', { x: attr({ type: 'union', of: 'nope' }) })]),
    ).toThrow('malformed "union" node');
  });

  it('throws when a named type is referenced but not in the extract', () => {
    expect(() => normalise([documentEntry('post', { x: attr(inline('ghost')) })])).toThrow(/ghost/);
  });

  it('reads the real post fields from the fixture extract', () => {
    const raw = readFileSync(
      new URL('../fixtures/schemas/removed-type/before.json', import.meta.url),
      'utf8',
    );
    const schema = normalise(JSON.parse(raw));

    expect(paths(schema, 'post')).toEqual([
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
    expect(field(schema, 'post', 'categories[]')?.refTo).toEqual(['category']);
    expect(field(schema, 'post', 'featuredImage')?.kind).toBe('image');
    expect(field(schema, 'post', 'body')?.kind).toBe('portableText');
    expect([...schema.keys()].sort()).toEqual(['author', 'category', 'post', 'product']);
  });
});
