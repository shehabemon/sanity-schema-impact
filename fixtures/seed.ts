import { createClient, type SanityClient } from '@sanity/client';
import { encodeSolidPng } from './png.js';
import {
  FIXTURE_IMAGE_HEIGHT,
  FIXTURE_IMAGE_WIDTH,
  FIXTURE_IMAGES,
  placeholderAssetIds,
} from './images.js';
import {
  RELEASE_ID,
  draftIdOf,
  generateFixtureDocuments,
  generateReleaseVersions,
  summarise,
  type FixtureDocument,
  type FixtureSummary,
  type ReleaseVersion,
} from './generate.js';

/**
 * Writes the deterministic fixture dataset to a fixture-* dataset.
 *
 * This script is the documented exception to the tool's read-only rule. It uses
 * SANITY_SEED_TOKEN (an Editor token). The tool itself only ever reads its own
 * token, SANITY_AUTH_TOKEN (Viewer).
 *
 * Usage:
 *   pnpm seed --dry-run   counts only, no network (placeholder asset IDs)
 *   pnpm seed             upload the fixture images, then createOrReplace every fixture document
 *   pnpm seed --reset     delete fixture-ID documents first, then seed
 *
 * The fixture release (RELEASE_ID) is created after the documents, with versions of some posts.
 * Re-running skips anything that already exists.
 *
 * Image assets are uploaded first. Sanity derives asset IDs from a content hash, so re-running
 * uploads the same bytes and gets the same IDs back. The Content Lake rejects strong references
 * to assets that do not exist, so documents are written only after their assets exist.
 */

const BATCH_SIZE = 100;
const API_VERSION = '2025-02-19';
const DATASET_PREFIX = 'fixture';
const RELEASE_TITLE = 'Fixture release';

interface Options {
  dryRun: boolean;
  reset: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const known = new Set(['--dry-run', '--reset']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option(s): ${unknown.join(', ')}. Use --dry-run and/or --reset.`);
  }
  return { dryRun: argv.includes('--dry-run'), reset: argv.includes('--reset') };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function printSummary(summary: FixtureSummary): void {
  console.log(`Fixture documents: ${summary.total}`);
  console.log('type        published   drafts');
  for (const [type, counts] of Object.entries(summary.byType)) {
    console.log(
      `${type.padEnd(11)} ${String(counts.published).padStart(9)} ${String(counts.drafts).padStart(8)}`,
    );
  }
}

/**
 * Fixture IDs for --reset: every published ID plus its drafts.* counterpart, and the release
 * versions. The release document itself is kept.
 */
function fixtureIdsFor(docs: readonly FixtureDocument[]): string[] {
  const ids = new Set<string>();
  for (const doc of docs) {
    ids.add(doc._id);
    ids.add(doc._id.startsWith('drafts.') ? doc._id.slice('drafts.'.length) : draftIdOf(doc._id));
  }
  for (const version of generateReleaseVersions(docs)) ids.add(version.document._id);
  return [...ids];
}

/** Creates the fixture release and any of its versions that are missing. */
async function seedRelease(
  client: SanityClient,
  versions: readonly ReleaseVersion[],
): Promise<void> {
  const release = await client.getDocument(`_.releases.${RELEASE_ID}`);
  if (release === undefined) {
    await client.releases.create({ releaseId: RELEASE_ID, metadata: { title: RELEASE_TITLE } });
    console.log(`release ${RELEASE_ID}: created`);
  } else {
    console.log(`release ${RELEASE_ID}: already exists`);
  }

  let created = 0;
  for (const version of versions) {
    const existing = await client.getDocument(version.document._id);
    if (existing !== undefined) continue;
    await client.createVersion({
      document: version.document,
      publishedId: version.publishedId,
      releaseId: RELEASE_ID,
    });
    created++;
  }
  console.log(
    `release versions: ${String(created)} created, ${String(versions.length - created)} already present`,
  );
}

/** Uploads each fixture PNG and returns the asset IDs Sanity assigned, in FIXTURE_IMAGES order. */
async function uploadFixtureImages(client: SanityClient): Promise<string[]> {
  const ids: string[] = [];
  for (const image of FIXTURE_IMAGES) {
    const buffer = encodeSolidPng(FIXTURE_IMAGE_WIDTH, FIXTURE_IMAGE_HEIGHT, image.rgb);
    const asset = await client.assets.upload('image', buffer, {
      filename: image.filename,
      contentType: 'image/png',
    });
    if (!asset._id.startsWith('image-')) {
      throw new Error(`Unexpected asset ID returned for ${image.filename}.`);
    }
    console.log(`asset ${image.filename}: ${asset._id}`);
    ids.push(asset._id);
  }
  return ids;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.dryRun) {
    const docs = generateFixtureDocuments(placeholderAssetIds());
    printSummary(summarise(docs));
    console.log(`Release ${RELEASE_ID}: ${String(generateReleaseVersions(docs).length)} versions`);
    console.log('Dry run: no network calls made, nothing written. Image refs are placeholders.');
    return;
  }

  const projectId = process.env['SANITY_STUDIO_PROJECT_ID'];
  const dataset = process.env['SANITY_STUDIO_DATASET'];
  const token = process.env['SANITY_SEED_TOKEN'];

  // Safety guard: only ever write to a dataset whose name starts with "fixture".
  if (!dataset || !dataset.startsWith(DATASET_PREFIX)) {
    throw new Error(
      `Refusing to seed: SANITY_STUDIO_DATASET must start with "${DATASET_PREFIX}" (got "${dataset ?? ''}").`,
    );
  }
  if (!projectId) throw new Error('Set SANITY_STUDIO_PROJECT_ID.');
  if (!token) throw new Error('Set SANITY_SEED_TOKEN to an Editor token for the fixture project.');

  const client = createClient({
    projectId,
    dataset,
    apiVersion: API_VERSION,
    token,
    useCdn: false,
  });

  console.log(`Seeding dataset "${dataset}" in project "${projectId}".`);

  const assetIds = await uploadFixtureImages(client);
  const docs = generateFixtureDocuments(assetIds);
  printSummary(summarise(docs));

  if (options.reset) {
    const ids = fixtureIdsFor(docs);
    const resetBatches = chunk(ids, BATCH_SIZE);
    for (const [i, batch] of resetBatches.entries()) {
      const tx = client.transaction();
      for (const id of batch) tx.delete(id);
      await tx.commit();
      console.log(`reset batch ${i + 1}/${resetBatches.length}: deleted up to ${batch.length} IDs`);
    }
  }

  const batches = chunk(docs, BATCH_SIZE);
  for (const [i, batch] of batches.entries()) {
    const tx = client.transaction();
    for (const doc of batch) tx.createOrReplace(doc);
    await tx.commit();
    console.log(`batch ${i + 1}/${batches.length}: wrote ${batch.length} documents`);
  }

  await seedRelease(client, generateReleaseVersions(docs));
  console.log('Done.');
}

run().catch((error: unknown) => {
  // Print the message only. Never print the error object, the client config or the token.
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`seed failed: ${message}`);
  process.exitCode = 1;
});
