import { describe, expect, it } from 'vitest';
import {
  AUTHOR_COUNT,
  CATEGORY_COUNT,
  DRAFT_ONLY_POST_COUNT,
  POST_COUNT,
  PRODUCT_COUNT,
  RELEASE_ID,
  generateFixtureDocuments,
  generateReleaseVersions,
  summarise,
  type FixtureDocument,
} from '../../fixtures/generate.js';
import { FIXTURE_IMAGES, placeholderAssetIds } from '../../fixtures/images.js';

// Stand-in asset IDs. The real seed passes the IDs returned by client.assets.upload.
const TEST_ASSET_IDS = [
  'image-aaaa-160x90-png',
  'image-bbbb-160x90-png',
  'image-cccc-160x90-png',
  'image-dddd-160x90-png',
];

const docs = generateFixtureDocuments(TEST_ASSET_IDS);
const published = docs.filter((d) => !d._id.startsWith('drafts.'));
const ofType = (type: FixtureDocument['_type']): FixtureDocument[] =>
  published.filter((d) => d._type === type);
const posts = ofType('post');
const products = ofType('product');
const authors = ofType('author');

/** Collects every image asset reference (image.asset._ref) in a document tree. */
const collectAssetRefs = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((v) => collectAssetRefs(v, out));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj._type === 'image' && obj.asset && typeof obj.asset === 'object') {
      const ref = (obj.asset as Record<string, unknown>)._ref;
      if (typeof ref === 'string') out.push(ref);
    }
    Object.values(obj).forEach((v) => collectAssetRefs(v, out));
  }
  return out;
};

describe('fixture generator counts', () => {
  it('produces the expected number of documents per type', () => {
    const summary = summarise(docs);
    expect(summary.byType.author.published).toBe(AUTHOR_COUNT);
    expect(summary.byType.category.published).toBe(CATEGORY_COUNT);
    expect(summary.byType.post.published).toBe(POST_COUNT);
    expect(summary.byType.product.published).toBe(PRODUCT_COUNT);
  });

  it('produces about 500 published documents', () => {
    expect(published).toHaveLength(AUTHOR_COUNT + CATEGORY_COUNT + POST_COUNT + PRODUCT_COUNT);
    expect(published).toHaveLength(500);
  });

  it('adds draft-only posts on top of the drafts copies', () => {
    const { byType } = summarise(docs);
    expect(byType.post.drafts).toBe(36 + DRAFT_ONLY_POST_COUNT);
    expect(docs.filter((d) => d._id.startsWith('drafts.post-'))).toHaveLength(41);
  });
});

describe('fixture generator determinism', () => {
  it('returns deep-equal output on repeated calls with the same asset IDs', () => {
    expect(generateFixtureDocuments(TEST_ASSET_IDS)).toEqual(docs);
  });

  it('uses stable, zero-padded IDs', () => {
    const ids = new Set(docs.map((d) => d._id));
    expect(ids.has('author-001')).toBe(true);
    expect(ids.has('category-01')).toBe(true);
    expect(ids.has('post-0001')).toBe(true);
    expect(ids.has('product-001')).toBe(true);
  });

  it('refuses an empty asset list instead of writing dangling image refs', () => {
    expect(() => generateFixtureDocuments([])).toThrow(/asset/i);
  });
});

describe('drafts', () => {
  it('gives about 10% of published posts a drafts copy with a changed title', () => {
    const publishedPostIds = new Set(posts.map((p) => p._id));
    const drafted = docs.filter(
      (d) => d._id.startsWith('drafts.') && publishedPostIds.has(d._id.slice('drafts.'.length)),
    );
    const ratio = drafted.length / posts.length;
    expect(ratio).toBeGreaterThan(0.08);
    expect(ratio).toBeLessThan(0.12);
    for (const draft of drafted) {
      const original = posts.find((p) => `drafts.${p._id}` === draft._id);
      expect(original).toBeDefined();
      expect(draft.title).not.toBe(original?.title);
    }
  });
});

describe('references', () => {
  const publishedIds = new Set(published.map((d) => d._id));

  const collectDocRefs = (value: unknown, out: string[] = []): string[] => {
    if (Array.isArray(value)) value.forEach((v) => collectDocRefs(v, out));
    else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // Image asset references are checked separately below.
      if (obj._type === 'reference' && typeof obj._ref === 'string') out.push(obj._ref);
      Object.entries(obj)
        .filter(([key]) => key !== 'asset')
        .forEach(([, v]) => collectDocRefs(v, out));
    }
    return out;
  };

  it('points only at IDs that exist in the published set', () => {
    const refs = published.flatMap((d) => collectDocRefs(d));
    expect(refs.length).toBeGreaterThan(0);
    const dangling = refs.filter((r) => !publishedIds.has(r));
    expect(dangling).toEqual([]);
  });

  it('gives every drafts copy references that also exist', () => {
    const draftRefs = docs
      .filter((d) => d._id.startsWith('drafts.'))
      .flatMap((d) => collectDocRefs(d));
    expect(draftRefs.every((r) => publishedIds.has(r))).toBe(true);
  });
});

describe('image asset references', () => {
  const assetRefs = docs.flatMap((d) => collectAssetRefs(d));

  it('only points at the asset IDs it was given', () => {
    const allowed = new Set(TEST_ASSET_IDS);
    expect(assetRefs.length).toBeGreaterThan(0);
    expect(assetRefs.filter((r) => !allowed.has(r))).toEqual([]);
  });

  it('uses every supplied asset ID (round-robin)', () => {
    expect(new Set(assetRefs)).toEqual(new Set(TEST_ASSET_IDS));
  });

  it('spreads references evenly across the assets', () => {
    const counts = new Map<string, number>();
    for (const ref of assetRefs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
    const values = [...counts.values()];
    const max = Math.max(...values);
    const min = Math.min(...values);
    expect(max - min).toBeLessThanOrEqual(
      Math.ceil(assetRefs.length / TEST_ASSET_IDS.length) * 0.25,
    );
  });

  it('sets avatar on every author from the asset list', () => {
    for (const author of authors) {
      const avatar = author['avatar'] as { asset: { _ref: string } } | undefined;
      expect(avatar).toBeDefined();
      expect(TEST_ASSET_IDS).toContain(avatar?.asset._ref);
    }
  });

  it('gives a post featuredImage and seo.ogImage that differ when more than one asset is supplied', () => {
    const withBoth = posts.filter((p) => p['featuredImage'] !== undefined && p.seo !== undefined);
    const seo = (p: FixtureDocument): { ogImage?: { asset: { _ref: string } } } =>
      p['seo'] as { ogImage?: { asset: { _ref: string } } };
    const pairs = withBoth.filter((p) => seo(p).ogImage !== undefined);
    expect(pairs.length).toBeGreaterThan(0);
    for (const post of pairs) {
      const featured = (post['featuredImage'] as { asset: { _ref: string } }).asset._ref;
      expect(seo(post).ogImage?.asset._ref).not.toBe(featured);
    }
  });
});

describe('placeholder asset IDs (dry run only)', () => {
  it('provides one placeholder ID per fixture image', () => {
    expect(placeholderAssetIds()).toHaveLength(FIXTURE_IMAGES.length);
  });

  it('builds a complete dataset from the placeholders', () => {
    const dry = generateFixtureDocuments(placeholderAssetIds());
    expect(summarise(dry)).toEqual(summarise(docs));
  });
});

describe('deliberate gaps', () => {
  const share = (items: FixtureDocument[], pred: (d: FixtureDocument) => boolean): number =>
    items.filter(pred).length / items.length;

  it('leaves roughly 30% of posts without a featuredImage', () => {
    const rate = share(posts, (p) => p['featuredImage'] === undefined);
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.4);
  });

  it('leaves roughly 5% of posts without a slug', () => {
    const rate = share(posts, (p) => p['slug'] === undefined);
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.12);
  });

  it('leaves roughly 20% of products without legacySku', () => {
    const rate = share(products, (p) => p['legacySku'] === undefined);
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.3);
  });
});

describe('release versions', () => {
  const releaseVersions = generateReleaseVersions(docs);
  const versionIds = releaseVersions.map((v) => v.document._id);

  it('versions eight published posts in one release', () => {
    expect(releaseVersions).toHaveLength(8);
    expect(versionIds).toEqual([
      'versions.rFixture01.post-0040',
      'versions.rFixture01.post-0080',
      'versions.rFixture01.post-0120',
      'versions.rFixture01.post-0160',
      'versions.rFixture01.post-0200',
      'versions.rFixture01.post-0240',
      'versions.rFixture01.post-0280',
      'versions.rFixture01.post-0320',
    ]);
    expect(RELEASE_ID).toBe('rFixture01');
  });

  it('names the published post each version belongs to', () => {
    for (const version of releaseVersions) {
      expect(version.document._id).toBe(`versions.${RELEASE_ID}.${version.publishedId}`);
      expect(published.map((d) => d._id)).toContain(version.publishedId);
    }
  });

  it('changes the title of every version', () => {
    for (const version of releaseVersions) {
      const original = posts.find((p) => p._id === version.publishedId);
      expect(version.document.title).not.toBe(original?.title);
      expect(version.document._type).toBe('post');
    }
  });

  it('keeps the rest of each post, including its image presence', () => {
    for (const version of releaseVersions) {
      const original = posts.find((p) => p._id === version.publishedId);
      expect(version.document['featuredImage']).toEqual(original?.['featuredImage']);
      expect(version.document['slug']).toEqual(original?.['slug']);
    }
  });

  it('points references only at published documents', () => {
    const publishedIds = new Set(published.map((d) => d._id));
    const refs = releaseVersions.flatMap((v) => collectDocRefsFrom(v.document));
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((r) => !publishedIds.has(r))).toEqual([]);
  });

  it('is deterministic', () => {
    expect(generateReleaseVersions(docs)).toEqual(releaseVersions);
  });

  it('stays out of the main document set', () => {
    expect(docs.some((d) => d._id.startsWith('versions.'))).toBe(false);
  });
});

function collectDocRefsFrom(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectDocRefsFrom(v, out));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj._type === 'reference' && typeof obj._ref === 'string') out.push(obj._ref);
    Object.entries(obj)
      .filter(([key]) => key !== 'asset')
      .forEach(([, v]) => collectDocRefsFrom(v, out));
  }
  return out;
}
