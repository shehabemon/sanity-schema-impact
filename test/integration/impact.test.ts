import { beforeAll, describe, expect, it } from 'vitest';
import { createSanityReader, type SanityReader } from '../../src/adapters/sanity.js';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import { measureImpact, type ImpactResult } from '../../src/impact/run.js';
import {
  generateFixtureDocuments,
  generateReleaseVersions,
  isDraftId,
  type FixtureDocument,
} from '../../fixtures/generate.js';
import { placeholderAssetIds } from '../../fixtures/images.js';

// Runs against the fixture dataset only when all three variables are set (see setup.ts).
const API_VERSION = '2025-02-19';
const projectId = process.env['SANITY_STUDIO_PROJECT_ID'] ?? '';
const dataset = process.env['SANITY_STUDIO_DATASET'] ?? '';
const token = process.env['SANITY_AUTH_TOKEN'] ?? '';
const enabled = [projectId, dataset, token].every((value) => value.trim() !== '');

// Expected counts come from the generator. Asset IDs don't change which fields are set,
// so placeholder IDs give the same counts as the real upload.
const docs = generateFixtureDocuments(placeholderAssetIds());
const everything: FixtureDocument[] = [
  ...docs,
  ...generateReleaseVersions(docs).map((v) => v.document),
];

const isVersion = (id: string): boolean => id.startsWith('versions.');

interface Expected {
  published: number;
  drafts: number;
  versions: number;
  sample: string[];
}

function expectedFor(docType: string, matches: (doc: FixtureDocument) => boolean): Expected {
  const hits = everything.filter((doc) => doc._type === docType && matches(doc));
  const countWhere = (pred: (id: string) => boolean): number =>
    hits.filter((doc) => pred(doc._id)).length;
  return {
    published: countWhere((id) => !isDraftId(id) && !isVersion(id)),
    drafts: countWhere(isDraftId),
    versions: countWhere(isVersion),
    sample: hits
      .map((doc) => doc._id)
      .sort()
      .slice(0, 5),
  };
}

const field = (overrides: Partial<FieldInfo>): FieldInfo => ({
  kind: 'string',
  required: false,
  ...overrides,
});

const seoOf = (doc: FixtureDocument): Record<string, unknown> | undefined =>
  doc['seo'] as Record<string, unknown> | undefined;

const variantsOf = (doc: FixtureDocument): { price?: { amount?: unknown } }[] =>
  (doc['variants'] as { price?: { amount?: unknown } }[] | undefined) ?? [];

interface Case {
  name: string;
  change: Change;
  expected: Expected;
}

// options-changed is not covered here: the fixture Studio has no literal-union field.
const cases: Case[] = [
  {
    name: 'removed field post.featuredImage',
    change: {
      kind: 'removed-field',
      docType: 'post',
      path: 'featuredImage',
      before: field({ kind: 'image' }),
    },
    expected: expectedFor('post', (doc) => doc['featuredImage'] !== undefined),
  },
  {
    name: 'removed type product',
    change: { kind: 'removed-type', docType: 'product' },
    expected: expectedFor('product', () => true),
  },
  {
    name: 'newly required post.slug',
    change: {
      kind: 'newly-required',
      docType: 'post',
      path: 'slug',
      before: field({ kind: 'slug' }),
      after: field({ kind: 'slug', required: true }),
    },
    expected: expectedFor('post', (doc) => doc['slug'] === undefined),
  },
  {
    name: 'nested removed field post.seo.ogImage',
    change: {
      kind: 'removed-field',
      docType: 'post',
      path: 'seo.ogImage',
      before: field({ kind: 'image' }),
    },
    expected: expectedFor('post', (doc) => seoOf(doc)?.['ogImage'] !== undefined),
  },
  {
    name: 'newly required nested post.seo.title (every post has one)',
    change: {
      kind: 'newly-required',
      docType: 'post',
      path: 'seo.title',
      before: field({}),
      after: field({ required: true }),
    },
    expected: expectedFor(
      'post',
      (doc) => seoOf(doc) !== undefined && seoOf(doc)?.['title'] === undefined,
    ),
  },
  {
    name: 'removed field inside an array product variants[].price.amount',
    change: {
      kind: 'removed-field',
      docType: 'product',
      path: 'variants[].price.amount',
      before: field({ kind: 'number' }),
    },
    expected: expectedFor('product', (doc) =>
      variantsOf(doc).some((variant) => variant.price?.amount !== undefined),
    ),
  },
];

describe.skipIf(!enabled)('impact against the fixture dataset', () => {
  let reader: SanityReader;
  let results: ImpactResult[];

  beforeAll(async () => {
    reader = createSanityReader({ projectId, dataset, token, apiVersion: API_VERSION });
    results = await measureImpact(
      cases.map((c) => c.change),
      reader,
    );
  });

  it.each(cases.map((c, i) => [c.name, i] as const))('counts %s', (_name, index) => {
    const testCase = cases[index];
    expect(testCase).toBeDefined();
    expect(results[index]).toEqual({ change: testCase?.change, ...testCase?.expected });
  });

  it('reports no change as skipped', () => {
    expect(results.every((result) => !('skipped' in result))).toBe(true);
  });
});
