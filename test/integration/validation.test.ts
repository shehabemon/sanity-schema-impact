import { cp, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommand } from '../../src/adapters/process.js';
import { createSanityReader } from '../../src/adapters/sanity.js';
import { documentKind, type DocumentKind } from '../../src/validation/diff.js';
import {
  compareValidation,
  validateStudio,
  type ValidationComparison,
} from '../../src/validation/run.js';
import {
  generateFixtureDocuments,
  generateReleaseVersions,
  type FixtureDocument,
} from '../../fixtures/generate.js';
import { placeholderAssetIds } from '../../fixtures/images.js';

// Runs against the fixture dataset only when all three variables are set (see setup.ts).
const API_VERSION = '2025-02-19';
const projectId = process.env['SANITY_STUDIO_PROJECT_ID'] ?? '';
const dataset = process.env['SANITY_STUDIO_DATASET'] ?? '';
const token = process.env['SANITY_AUTH_TOKEN'] ?? '';
const enabled = [projectId, dataset, token].every((value) => value.trim() !== '');

// Each CLI run loads the workspace and validates the dataset, so give the suite room.
const LONG_TIMEOUT_MS = 300_000;

const studioSource = fileURLToPath(new URL('../../fixtures/studio', import.meta.url));
const titleRule = `      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (rule) => rule.required(),`;
const limitedTitleRule = titleRule.replace('rule.required()', 'rule.required().max(40)');
const TITLE_LIMIT = 40;
const LIMIT_MESSAGE = `Must be at most ${String(TITLE_LIMIT)} characters long`;

// Expected counts come from the generator, the same way the impact suite does it.
const docs = generateFixtureDocuments(placeholderAssetIds());
const everything: FixtureDocument[] = [
  ...docs,
  ...generateReleaseVersions(docs).map((v) => v.document),
];
const titleLength = (doc: FixtureDocument): number => {
  const title: unknown = doc['title'];
  return typeof title === 'string' ? title.length : 0;
};
const overLimit = everything
  .filter((doc) => doc._type === 'post' && titleLength(doc) > TITLE_LIMIT)
  .map((doc) => doc._id);

function expectedSplit(): Record<DocumentKind, number> {
  const split: Record<DocumentKind, number> = { published: 0, drafts: 0, versions: 0 };
  for (const id of overLimit) split[documentKind(id)]++;
  return split;
}

describe.skipIf(!enabled)('validation diff against the fixture dataset', () => {
  let workDir: string | undefined;
  let headStudio = '';
  let comparison: ValidationComparison;
  let documentCount: number;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'schema-impact-validation-'));
    headStudio = join(workDir, basename(studioSource));

    // The head copy gets a stricter title rule. The fixture itself is never edited.
    await cp(studioSource, headStudio, {
      recursive: true,
      filter: (source) => basename(source) !== 'node_modules',
    });
    await symlink(join(studioSource, 'node_modules'), join(headStudio, 'node_modules'), 'dir');
    const configPath = join(headStudio, 'schemaTypes', 'post.ts');
    const config = await readFile(configPath, 'utf8');
    if (!config.includes(titleRule)) throw new Error('The post title rule has changed.');
    await writeFile(configPath, config.replace(titleRule, limitedTitleRule));

    const reader = createSanityReader({ projectId, dataset, token, apiVersion: API_VERSION });
    const base = await validateStudio({
      studioDir: studioSource,
      projectId,
      dataset,
      token,
      runner: runCommand,
      reader,
    });
    const head = await validateStudio({
      studioDir: headStudio,
      projectId,
      dataset,
      token,
      runner: runCommand,
      reader,
    });
    comparison = compareValidation(base, head);
    documentCount = base.documentCount;
  }, LONG_TIMEOUT_MS);

  afterAll(async () => {
    if (workDir === undefined) return;
    // Unlink the symlink first, so removing the tree never reaches the real node_modules.
    const link = join(headStudio, 'node_modules');
    if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link);
    await rm(workDir, { recursive: true, force: true });
  }, LONG_TIMEOUT_MS);

  it('validates a non-empty dataset', () => {
    expect(documentCount).toBeGreaterThan(0);
  });

  it('introduces one title marker per post over the limit, in every split', () => {
    const split = expectedSplit();
    const introduced = comparison.introduced;

    expect(introduced).toHaveLength(overLimit.length);
    expect(introduced.every((m) => m.documentType === 'post' && m.pathPattern === 'title')).toBe(
      true,
    );
    expect(introduced.every((m) => m.code === 'string.maximum-length')).toBe(true);
    expect({
      published: introduced.filter((m) => documentKind(m.documentId) === 'published').length,
      drafts: introduced.filter((m) => documentKind(m.documentId) === 'drafts').length,
      versions: introduced.filter((m) => documentKind(m.documentId) === 'versions').length,
    }).toEqual(split);
  });

  it('groups the new title markers into one group with the same split', () => {
    const split = expectedSplit();
    const sample = [...overLimit].sort().slice(0, 5);

    expect(comparison.groups).toHaveLength(1);
    expect(comparison.groups[0]).toMatchObject({
      documentType: 'post',
      pathPattern: 'title',
      code: 'string.maximum-length',
      message: LIMIT_MESSAGE,
      published: split.published,
      drafts: split.drafts,
      versions: split.versions,
      sample,
    });
  });

  it('reports no resolved markers', () => {
    expect(comparison.resolved).toEqual([]);
  });
});
