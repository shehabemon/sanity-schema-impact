import { describe, expect, it } from 'vitest';
import { diffSchemas } from '../../src/diff/classify.js';
import { normalise } from '../../src/diff/normalise.js';
import {
  array,
  attr,
  documentEntry,
  inline,
  named,
  num,
  object,
  reference,
  str,
  typeEntry,
  union,
} from './factories.js';

const diff = (base: unknown[], head: unknown[]) => diffSchemas(normalise(base), normalise(head));

const SANITY_IMAGE = documentEntry('sanity.imageAsset', { url: attr(str()) });

const image = () => named('image', {});

describe('diffSchemas', () => {
  it('reports nothing for identical schemas', () => {
    const schema = [
      documentEntry('post', {
        title: attr(str(), true),
        seo: attr(object({ title: attr(str()) })),
      }),
    ];

    expect(diff(schema, schema)).toEqual([]);
  });

  it('reports a removed document type once and none of its fields', () => {
    const base = [
      documentEntry('post', { title: attr(str(), true) }),
      documentEntry('product', { title: attr(str()), legacySku: attr(str()) }),
    ];
    const head = [documentEntry('post', { title: attr(str(), true) })];

    expect(diff(base, head)).toEqual([{ kind: 'removed-type', docType: 'product' }]);
  });

  it('reports only the highest removed path when a whole object goes', () => {
    const base = [
      documentEntry('post', {
        title: attr(str(), true),
        seo: attr(object({ title: attr(str()), description: attr(str()) })),
      }),
    ];
    const head = [documentEntry('post', { title: attr(str(), true) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'removed-field',
        docType: 'post',
        path: 'seo',
        before: { kind: 'object', required: false },
      },
    ]);
  });

  it('reports a removed leaf inside a kept object by its full path', () => {
    const base = [
      documentEntry('post', {
        seo: attr(object({ title: attr(str()), description: attr(str()) })),
      }),
    ];
    const head = [documentEntry('post', { seo: attr(object({ description: attr(str()) })) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'removed-field',
        docType: 'post',
        path: 'seo.title',
        before: { kind: 'string', required: false },
      },
    ]);
  });

  it('reports only the highest added path when a whole object is new', () => {
    const base = [documentEntry('post', { title: attr(str(), true) })];
    const head = [
      documentEntry('post', {
        title: attr(str(), true),
        seo: attr(object({ title: attr(str()), description: attr(str()) })),
      }),
    ];

    expect(diff(base, head)).toEqual([
      {
        kind: 'added-field',
        docType: 'post',
        path: 'seo',
        after: { kind: 'object', required: false },
      },
    ]);
  });

  it('describes a scalar kind change', () => {
    const base = [documentEntry('product', { title: attr(str()) })];
    const head = [documentEntry('product', { title: attr(num()) })];

    expect(diff(base, head)).toEqual([
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

  it('does not report the children of a parent whose kind changed', () => {
    const base = [
      documentEntry('post', { meta: attr(object({ a: attr(str()), b: attr(str()) })) }),
    ];
    const head = [documentEntry('post', { meta: attr(str()) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'type-changed',
        docType: 'post',
        path: 'meta',
        before: { kind: 'object', required: false },
        after: { kind: 'string', required: false },
        detail: 'object → string',
      },
    ]);
  });

  it('reports a reference target change', () => {
    const base = [
      typeEntry('author.reference', reference('author')),
      documentEntry('post', { writer: attr(inline('author.reference')) }),
    ];
    const head = [
      typeEntry('category.reference', reference('category')),
      documentEntry('post', { writer: attr(inline('category.reference')) }),
    ];

    expect(diff(base, head)).toEqual([
      {
        kind: 'type-changed',
        docType: 'post',
        path: 'writer',
        before: { kind: 'reference', refTo: ['author'], required: false },
        after: { kind: 'reference', refTo: ['category'], required: false },
        detail: 'ref(author) → ref(category)',
      },
    ]);
  });

  it('reports an array kind change at the array and not at its member', () => {
    const base = [documentEntry('post', { tags: attr(array(str())) })];
    const head = [documentEntry('post', { tags: attr(array(num())) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'type-changed',
        docType: 'post',
        path: 'tags',
        before: { kind: 'array', of: ['string'], required: false },
        after: { kind: 'array', of: ['number'], required: false },
        detail: 'string[] → number[]',
      },
    ]);
  });

  it('reports a changed reference target inside an array at the member path', () => {
    const base = [
      typeEntry('category.reference', reference('category')),
      documentEntry('post', {
        categories: attr(array(object({}, { rest: inline('category.reference') }))),
      }),
    ];
    const head = [
      typeEntry('category.reference', reference('author')),
      documentEntry('post', {
        categories: attr(array(object({}, { rest: inline('category.reference') }))),
      }),
    ];

    expect(diff(base, head)).toEqual([
      {
        kind: 'type-changed',
        docType: 'post',
        path: 'categories[]',
        before: { kind: 'reference', refTo: ['category'], required: false },
        after: { kind: 'reference', refTo: ['author'], required: false },
        detail: 'ref(category) → ref(author)',
      },
    ]);
  });

  it('reports a field that becomes required', () => {
    const base = [documentEntry('post', { slug: attr(str()) })];
    const head = [documentEntry('post', { slug: attr(str(), true) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'newly-required',
        docType: 'post',
        path: 'slug',
        before: { kind: 'string', required: false },
        after: { kind: 'string', required: true },
      },
    ]);
  });

  it('reports a field that stops being required', () => {
    const base = [documentEntry('post', { title: attr(str(), true) })];
    const head = [documentEntry('post', { title: attr(str()) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'no-longer-required',
        docType: 'post',
        path: 'title',
        before: { kind: 'string', required: true },
        after: { kind: 'string', required: false },
      },
    ]);
  });

  it('reports the removed and added values of a string union', () => {
    const base = [documentEntry('post', { status: attr(union(str('draft'), str('live'))) })];
    const head = [documentEntry('post', { status: attr(union(str('live'), str('archived'))) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'options-changed',
        docType: 'post',
        path: 'status',
        before: { kind: 'string', values: ['draft', 'live'], required: false },
        after: { kind: 'string', values: ['archived', 'live'], required: false },
        removed: ['draft'],
        added: ['archived'],
      },
    ]);
  });

  it('pairs one removed and one added sibling with the same shape as a rename', () => {
    const base = [documentEntry('post', { featuredImage: attr(image()) })];
    const head = [documentEntry('post', { heroImage: attr(image()) })];

    expect(diff(base, head)).toEqual([
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

  it('pairs a rename inside an array of objects', () => {
    const base = [
      documentEntry('product', {
        variants: attr(array(named('variant', { sku: attr(str()) }))),
      }),
    ];
    const head = [
      documentEntry('product', {
        variants: attr(array(named('variant', { code: attr(str()) }))),
      }),
    ];

    expect(diff(base, head)).toEqual([
      {
        kind: 'possible-rename',
        docType: 'product',
        from: 'variants[].sku',
        to: 'variants[].code',
        before: { kind: 'string', required: false },
        after: { kind: 'string', required: false },
      },
    ]);
  });

  it('leaves an ambiguous rename as separate removed and added fields', () => {
    const base = [
      documentEntry('post', {
        heroA: attr(image()),
        heroB: attr(image()),
      }),
    ];
    const head = [documentEntry('post', { hero: attr(image()) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'added-field',
        docType: 'post',
        path: 'hero',
        after: { kind: 'image', required: false },
      },
      {
        kind: 'removed-field',
        docType: 'post',
        path: 'heroA',
        before: { kind: 'image', required: false },
      },
      {
        kind: 'removed-field',
        docType: 'post',
        path: 'heroB',
        before: { kind: 'image', required: false },
      },
    ]);
  });

  it('does not pair fields whose parents differ', () => {
    const base = [documentEntry('post', { seo: attr(object({ ogImage: attr(image()) })) })];
    const head = [documentEntry('post', { seo: attr(object({})), hero: attr(image()) })];

    expect(diff(base, head)).toEqual([
      {
        kind: 'added-field',
        docType: 'post',
        path: 'hero',
        after: { kind: 'image', required: false },
      },
      {
        kind: 'removed-field',
        docType: 'post',
        path: 'seo.ogImage',
        before: { kind: 'image', required: false },
      },
    ]);
  });

  it('reports a portable text member added as a change to the field', () => {
    const base = [
      documentEntry('post', { body: attr(array(named('block', { text: attr(str()) }))) }),
    ];
    const head = [
      documentEntry('post', {
        body: attr(array(union(named('block', { text: attr(str()) }), named('callout', {})))),
      }),
    ];

    expect(diff(base, head)).toEqual([
      {
        kind: 'type-changed',
        docType: 'post',
        path: 'body',
        before: { kind: 'portableText', of: ['block'], required: false },
        after: { kind: 'portableText', of: ['block', 'callout'], required: false },
        detail: 'portableText(block) → portableText(block|callout)',
      },
    ]);
  });

  it('describes a change between unions of object types by their names', () => {
    const base = [
      documentEntry('post', { blocks: attr(union(named('quote', {}), named('embed', {}))) }),
    ];
    const head = [
      documentEntry('post', { blocks: attr(union(named('quote', {}), named('gallery', {}))) }),
    ];

    expect(diff(base, head)).toEqual([
      {
        kind: 'type-changed',
        docType: 'post',
        path: 'blocks',
        before: { kind: 'union', of: ['embed', 'quote'], required: false },
        after: { kind: 'union', of: ['gallery', 'quote'], required: false },
        detail: 'union(embed|quote) → union(gallery|quote)',
      },
    ]);
  });

  it('reports a change inside a named type under each field that uses it', () => {
    const base = [
      typeEntry('address', named('address', { street: attr(str()) })),
      documentEntry('order', {
        billing: attr(inline('address')),
        shipping: attr(inline('address')),
      }),
    ];
    const head = [
      typeEntry('address', named('address', { street: attr(num()) })),
      documentEntry('order', {
        billing: attr(inline('address')),
        shipping: attr(inline('address')),
      }),
    ];

    expect(diff(base, head)).toEqual([
      {
        kind: 'type-changed',
        docType: 'order',
        path: 'billing.street',
        before: { kind: 'string', required: false },
        after: { kind: 'number', required: false },
        detail: 'string → number',
      },
      {
        kind: 'type-changed',
        docType: 'order',
        path: 'shipping.street',
        before: { kind: 'string', required: false },
        after: { kind: 'number', required: false },
        detail: 'string → number',
      },
    ]);
  });

  it('ignores sanity and system documents', () => {
    const base = [documentEntry('post', { title: attr(str()) }), SANITY_IMAGE];
    const head = [documentEntry('post', { title: attr(str()) })];

    expect(diff(base, head)).toEqual([]);
  });

  it('emits nothing for a document type that only exists in head', () => {
    const base = [documentEntry('post', { title: attr(str()) })];
    const head = [
      documentEntry('post', { title: attr(str()) }),
      documentEntry('author', { name: attr(str(), true) }),
    ];

    expect(diff(base, head)).toEqual([]);
  });

  it('sorts changes by document type, path and kind whatever the input order', () => {
    const base = [
      documentEntry('product', { legacySku: attr(str()), title: attr(str()) }),
      documentEntry('post', { title: attr(str()), slug: attr(str()) }),
      documentEntry('author', { name: attr(str()) }),
    ];
    const head = [
      documentEntry('post', { title: attr(num()), slug: attr(str(), true) }),
      documentEntry('product', { title: attr(str()) }),
    ];
    const changes = diff(base, head);

    expect(changes.map((change) => [change.kind, change.docType])).toEqual([
      ['removed-type', 'author'],
      ['newly-required', 'post'],
      ['type-changed', 'post'],
      ['removed-field', 'product'],
    ]);
    expect(diff([...base].reverse(), [...head].reverse())).toEqual(changes);
  });
});
