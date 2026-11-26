import { describe, expect, it } from 'vitest';
import type { SanityReader } from '../../src/adapters/sanity.js';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import { measureImpact } from '../../src/impact/run.js';

interface Counts {
  published: number;
  drafts: number;
  versions: number;
  sample: string[];
}

interface Call {
  query: string;
  params: Record<string, unknown>;
}

/**
 * Fake reader that answers each item in the batch. It reads the item IDs back out of the
 * query text, the same way the Content Lake would key its response.
 */
function fakeReader(answer: (index: number) => Counts): { reader: SanityReader; calls: Call[] } {
  const calls: Call[] = [];
  const reader: SanityReader = {
    fetch: <T>(query: string, params: Record<string, unknown>): Promise<T> => {
      calls.push({ query, params });
      const keys = [...query.matchAll(/("(?:[^"\\]|\\.)*"): \{"published"/g)].map(
        (m) => JSON.parse(m[1] ?? '""') as string,
      );
      const response = Object.fromEntries(keys.map((key) => [key, answer(Number(key))]));
      return Promise.resolve(response as T);
    },
  };
  return { reader, calls };
}

const field = (overrides: Partial<FieldInfo> = {}): FieldInfo => ({
  kind: 'image',
  required: false,
  ...overrides,
});

const removedFeaturedImage: Change = {
  kind: 'removed-field',
  docType: 'post',
  path: 'featuredImage',
  before: field(),
};

const removedProduct: Change = { kind: 'removed-type', docType: 'product' };

const addedField: Change = {
  kind: 'added-field',
  docType: 'post',
  path: 'subtitle',
  after: field({ kind: 'string' }),
};

describe('measureImpact', () => {
  it('reports published, draft and version counts and a sample for each change', async () => {
    const { reader } = fakeReader((index) => ({
      published: 100 + index,
      drafts: 4,
      versions: 2,
      sample: ['post-0001', 'post-0002'],
    }));
    const results = await measureImpact([removedFeaturedImage], reader);
    expect(results).toEqual([
      {
        change: removedFeaturedImage,
        published: 100,
        drafts: 4,
        versions: 2,
        sample: ['post-0001', 'post-0002'],
      },
    ]);
  });

  it('keeps results in the same order as the changes', async () => {
    const { reader } = fakeReader((index) => ({
      published: index,
      drafts: 0,
      versions: 0,
      sample: [],
    }));
    const results = await measureImpact([removedProduct, removedFeaturedImage], reader);
    expect(results.map((r) => r.change)).toEqual([removedProduct, removedFeaturedImage]);
    expect(results.map((r) => ('published' in r ? r.published : null))).toEqual([0, 1]);
  });

  it('skips changes that leave existing content valid, with a reason', async () => {
    const { reader, calls } = fakeReader(() => ({
      published: 0,
      drafts: 0,
      versions: 0,
      sample: [],
    }));
    const results = await measureImpact([addedField], reader);
    expect(results).toEqual([
      { change: addedField, skipped: 'adding a field changes no existing document' },
    ]);
    expect(calls).toHaveLength(0);
  });

  it('skips a change with an unsafe path instead of sending it, and keeps going', async () => {
    const unsafe: Change = {
      kind: 'removed-field',
      docType: 'post',
      path: 'title) || true',
      before: field({ kind: 'string' }),
    };
    const { reader, calls } = fakeReader(() => ({
      published: 1,
      drafts: 0,
      versions: 0,
      sample: [],
    }));
    const results = await measureImpact([unsafe, removedProduct], reader);
    expect(results[0]).toMatchObject({ change: unsafe });
    expect(results[0]).toHaveProperty('skipped', expect.stringMatching(/unsafe field name/i));
    expect(results[1]).toMatchObject({ change: removedProduct, published: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).not.toContain('|| true');
  });

  it('sends one request per chunk of changes', async () => {
    const changes: Change[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'removed-type',
      docType: `type${String(i)}`,
    }));
    const { reader, calls } = fakeReader(() => ({
      published: 0,
      drafts: 0,
      versions: 0,
      sample: [],
    }));
    const results = await measureImpact(changes, reader, { chunkSize: 2 });
    expect(calls).toHaveLength(3);
    expect(results).toHaveLength(5);
  });

  it('passes the document type as a parameter, not in the query text', async () => {
    const { reader, calls } = fakeReader(() => ({
      published: 0,
      drafts: 0,
      versions: 0,
      sample: [],
    }));
    await measureImpact([removedProduct], reader);
    expect(calls[0]?.params).toEqual({ q0_type: 'product' });
    expect(calls[0]?.query).not.toContain('"product"');
  });

  it('rejects a response that is missing a count', async () => {
    const reader: SanityReader = {
      fetch: <T>(): Promise<T> =>
        Promise.resolve({ '0': { published: 'many', drafts: 0, versions: 0, sample: [] } } as T),
    };
    await expect(measureImpact([removedProduct], reader)).rejects.toThrow(/unexpected result/i);
  });

  it('propagates errors from the reader', async () => {
    const reader: SanityReader = {
      fetch: <T>(): Promise<T> => Promise.reject(new Error('Sanity query failed: Unauthorized')),
    };
    await expect(measureImpact([removedProduct], reader)).rejects.toThrow('Unauthorized');
  });
});
