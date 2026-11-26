import { faker } from '@faker-js/faker';

// Pure, deterministic fixture data generator. No I/O: same output on every call.

export const SEED = 42;

export const AUTHOR_COUNT = 25;
export const CATEGORY_COUNT = 15;
/** Categories CATEGORY_COUNT-N+1..CATEGORY_COUNT get a parent (categories 01..05). */
export const CATEGORIES_WITH_PARENT = 5;
export const POST_COUNT = 360;
/** Every 10th published post also gets a drafts.* copy with a changed title (about 10%). */
export const DRAFT_EVERY_NTH_POST = 10;
/** Posts that exist only as drafts. */
export const DRAFT_ONLY_POST_COUNT = 5;
export const PRODUCT_COUNT = 100;

export const GAP_RATES = {
  missingFeaturedImage: 0.3,
  missingSlug: 0.05,
  missingLegacySku: 0.2,
} as const;

export type FixtureType = 'author' | 'category' | 'post' | 'product';

export interface FixtureDocument {
  _id: string;
  _type: FixtureType;
  [field: string]: unknown;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export const authorId = (n: number): string => `author-${pad(n, 3)}`;
export const categoryId = (n: number): string => `category-${pad(n, 2)}`;
export const postId = (n: number): string => `post-${pad(n, 4)}`;
export const productId = (n: number): string => `product-${pad(n, 3)}`;
export const draftIdOf = (id: string): string => `drafts.${id}`;

export const isDraftId = (id: string): boolean => id.startsWith('drafts.');

/** Picks an uploaded asset ID round-robin: slot n uses assetIds[n mod length]. */
export type AssetPicker = (slot: number) => string;

const pickerFor =
  (assetIds: readonly string[]): AssetPicker =>
  (slot) => {
    const id = assetIds[slot % assetIds.length];
    if (id === undefined) throw new Error('No asset IDs supplied.');
    return id;
  };

const imageRef = (assetId: string): Record<string, unknown> => ({
  _type: 'image',
  asset: { _type: 'reference', _ref: assetId },
});

const ref = (id: string, key: string): Record<string, unknown> => ({
  _type: 'reference',
  _ref: id,
  _key: key,
});

const portableBody = (prefix: string, paragraphs: number): Record<string, unknown>[] =>
  Array.from({ length: paragraphs }, (_, p) => {
    const markDefs: Record<string, unknown>[] = [];
    const children: Record<string, unknown>[] = [];
    const withLink = faker.number.float({ min: 0, max: 1 }) < 0.2;
    if (withLink) {
      markDefs.push({ _key: `${prefix}l${p}`, _type: 'link', href: faker.internet.url() });
    }
    children.push({
      _type: 'span',
      _key: `${prefix}s${p}a`,
      text: faker.lorem.paragraph(),
      marks: withLink ? [`${prefix}l${p}`] : [],
    });
    if (faker.number.float({ min: 0, max: 1 }) < 0.3) {
      children.push({
        _type: 'inlineMention',
        _key: `${prefix}m${p}`,
        handle: `@${faker.internet.username()}`,
      });
      children.push({ _type: 'span', _key: `${prefix}s${p}b`, text: ' ', marks: [] });
    }
    return {
      _type: 'block',
      _key: `${prefix}b${p}`,
      style: 'normal',
      markDefs,
      children,
    };
  });

const PUBLISHED_FROM = '2023-01-01T00:00:00.000Z';
const PUBLISHED_TO = '2026-06-30T00:00:00.000Z';

function buildPost(n: number, asset: AssetPicker): FixtureDocument {
  const title = faker.lorem.sentence({ min: 3, max: 7 }).replace(/\.$/, '');
  const doc: FixtureDocument = {
    _id: postId(n),
    _type: 'post',
    title,
    body: portableBody(`p${n}`, faker.number.int({ min: 2, max: 4 })),
    author: ref(authorId(faker.number.int({ min: 1, max: AUTHOR_COUNT })), 'a0'),
    categories: faker.helpers
      .arrayElements(
        Array.from({ length: CATEGORY_COUNT }, (_, i) => i + 1),
        { min: 1, max: 3 },
      )
      .map((c, i) => ref(categoryId(c), `c${i}`)),
    publishedAt: faker.date.between({ from: PUBLISHED_FROM, to: PUBLISHED_TO }).toISOString(),
    seo: {
      title: `${title} | Fixture`,
      description: faker.lorem.sentence(),
      ...(faker.number.float({ min: 0, max: 1 }) < 0.5 ? { ogImage: imageRef(asset(n + 1)) } : {}),
    },
  };
  if (faker.number.float({ min: 0, max: 1 }) >= GAP_RATES.missingFeaturedImage) {
    doc.featuredImage = imageRef(asset(n));
  }
  if (faker.number.float({ min: 0, max: 1 }) >= GAP_RATES.missingSlug) {
    doc.slug = {
      _type: 'slug',
      current: `${faker.helpers.slugify(title).toLowerCase()}-${pad(n, 4)}`,
    };
  }
  return doc;
}

function buildAuthor(n: number, asset: AssetPicker): FixtureDocument {
  const name = faker.person.fullName();
  const linkCount = faker.number.int({ min: 0, max: 3 });
  return {
    _id: authorId(n),
    _type: 'author',
    name,
    slug: { _type: 'slug', current: `author-${pad(n, 3)}` },
    bio: portableBody(`a${n}`, 1),
    avatar: imageRef(asset(n)),
    social: {
      links: Array.from({ length: linkCount }, (_, k) => ({
        _type: 'socialLink',
        _key: `a${n}k${k}`,
        platform: faker.helpers.arrayElement(['github', 'x', 'linkedin', 'mastodon']),
        url: faker.internet.url(),
      })),
    },
  };
}

function buildCategory(n: number): FixtureDocument {
  const doc: FixtureDocument = {
    _id: categoryId(n),
    _type: 'category',
    title: `${faker.commerce.department()} ${n}`,
    slug: { _type: 'slug', current: `category-${pad(n, 2)}` },
  };
  if (n > CATEGORY_COUNT - CATEGORIES_WITH_PARENT) {
    doc.parent = ref(categoryId(n - (CATEGORY_COUNT - CATEGORIES_WITH_PARENT)), 'parent');
  }
  return doc;
}

function buildProduct(n: number): FixtureDocument {
  const variantCount = faker.number.int({ min: 1, max: 3 });
  const doc: FixtureDocument = {
    _id: productId(n),
    _type: 'product',
    title: faker.commerce.productName(),
    variants: Array.from({ length: variantCount }, (_, k) => ({
      _type: 'variant',
      _key: `v${k}`,
      sku: `SKU-${pad(n, 3)}-${k + 1}`,
      price: {
        amount: faker.number.int({ min: 5, max: 300 }),
        currency: 'USD',
      },
    })),
    tags: faker.helpers.arrayElements(['new', 'sale', 'eco', 'limited', 'classic'], {
      min: 1,
      max: 3,
    }),
    relatedPosts: faker.helpers
      .arrayElements(
        Array.from({ length: POST_COUNT }, (_, i) => i + 1),
        { min: 0, max: 3 },
      )
      .map((p, i) => ref(postId(p), `r${i}`)),
  };
  if (faker.number.float({ min: 0, max: 1 }) >= GAP_RATES.missingLegacySku) {
    doc.legacySku = `LEG-${pad(n, 4)}`;
  }
  return doc;
}

/**
 * Returns every fixture document: published documents plus drafts.* copies.
 * Calling it twice with the same asset IDs returns deep-equal output (faker is re-seeded on each call).
 *
 * @param assetIds Image asset IDs that exist in the dataset. Every image reference uses one of them,
 *   so the Content Lake accepts the strong references. Use placeholderAssetIds() for --dry-run only.
 */
export function generateFixtureDocuments(assetIds: readonly string[]): FixtureDocument[] {
  if (assetIds.length === 0)
    throw new Error('generateFixtureDocuments needs at least one asset ID.');
  const asset = pickerFor(assetIds);
  faker.seed(SEED);
  const docs: FixtureDocument[] = [];

  for (let n = 1; n <= AUTHOR_COUNT; n++) docs.push(buildAuthor(n, asset));
  for (let n = 1; n <= CATEGORY_COUNT; n++) docs.push(buildCategory(n));

  for (let n = 1; n <= POST_COUNT; n++) {
    const post = buildPost(n, asset);
    docs.push(post);
    if (n % DRAFT_EVERY_NTH_POST === 0) {
      docs.push({
        ...post,
        _id: draftIdOf(post._id),
        title: `${String(post.title)} (draft edit)`,
      });
    }
  }
  for (let n = POST_COUNT + 1; n <= POST_COUNT + DRAFT_ONLY_POST_COUNT; n++) {
    const post = buildPost(n, asset);
    docs.push({ ...post, _id: draftIdOf(post._id) });
  }

  for (let n = 1; n <= PRODUCT_COUNT; n++) docs.push(buildProduct(n));

  return docs;
}

export const RELEASE_ID = 'rFixture01';
/** Number of published posts that get a version in the fixture release. */
export const RELEASE_POST_COUNT = 8;
/** The release versions every RELEASE_POST_STEP-th published post (40, 80, ..., 320). */
export const RELEASE_POST_STEP = 40;

export interface ReleaseVersion {
  /** The published document this version would replace when the release is published. */
  publishedId: string;
  document: FixtureDocument;
}

/**
 * Copies some published posts into `versions.<RELEASE_ID>.*` with a changed title.
 * Pure: same input, same output.
 */
export function generateReleaseVersions(docs: readonly FixtureDocument[]): ReleaseVersion[] {
  const published = new Map(
    docs.filter((d) => !isDraftId(d._id)).map((d): [string, FixtureDocument] => [d._id, d]),
  );
  return Array.from({ length: RELEASE_POST_COUNT }, (_, k) => {
    const publishedId = postId(RELEASE_POST_STEP * (k + 1));
    const post = published.get(publishedId);
    if (post === undefined || post._type !== 'post') {
      throw new Error(`Release post ${publishedId} is not in the fixture.`);
    }
    return {
      publishedId,
      document: {
        ...post,
        _id: `versions.${RELEASE_ID}.${publishedId}`,
        title: `${String(post.title)} (release edit)`,
      },
    };
  });
}

export interface TypeCounts {
  published: number;
  drafts: number;
}

export interface FixtureSummary {
  total: number;
  byType: Record<FixtureType, TypeCounts>;
}

export function summarise(docs: readonly FixtureDocument[]): FixtureSummary {
  const byType: Record<FixtureType, TypeCounts> = {
    author: { published: 0, drafts: 0 },
    category: { published: 0, drafts: 0 },
    post: { published: 0, drafts: 0 },
    product: { published: 0, drafts: 0 },
  };
  for (const doc of docs) {
    const bucket = byType[doc._type];
    if (isDraftId(doc._id)) bucket.drafts++;
    else bucket.published++;
  }
  return { total: docs.length, byType };
}
