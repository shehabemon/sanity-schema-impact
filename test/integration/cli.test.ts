import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommand } from '../../src/adapters/process.js';
import { createSanityReader } from '../../src/adapters/sanity.js';
import { runCli, type RunDeps } from '../../src/cli/run.js';
import { documentKind } from '../../src/validation/diff.js';
import {
  generateFixtureDocuments,
  generateReleaseVersions,
  type FixtureDocument,
} from '../../fixtures/generate.js';
import { placeholderAssetIds } from '../../fixtures/images.js';

// Runs against the fixture dataset only when all three variables are set (see setup.ts).
const projectId = process.env['SANITY_STUDIO_PROJECT_ID'] ?? '';
const dataset = process.env['SANITY_STUDIO_DATASET'] ?? '';
const token = process.env['SANITY_AUTH_TOKEN'] ?? '';
const enabled = [projectId, dataset, token].every((value) => value.trim() !== '');

// Each run extracts two schemas and validates two checkouts, so give the suite room.
const LONG_TIMEOUT_MS = 600_000;

const studioSource = fileURLToPath(new URL('../../fixtures/studio', import.meta.url));
const featuredImageBlock = `    defineField({
      name: 'featuredImage',
      title: 'Featured image',
      type: 'image',
      options: { hotspot: true },
    }),
`;
const titleRule = `      validation: (rule) => rule.required(),`;
const TITLE_LIMIT = 40;

const docs = generateFixtureDocuments(placeholderAssetIds());
const everything: FixtureDocument[] = [
  ...docs,
  ...generateReleaseVersions(docs).map((version) => version.document),
];

function split(predicate: (doc: FixtureDocument) => boolean): {
  published: number;
  drafts: number;
  versions: number;
} {
  const hits = everything.filter(predicate).map((doc) => doc._id);
  const kinds = hits.map((id) => documentKind(id));
  return {
    published: kinds.filter((kind) => kind === 'published').length,
    drafts: kinds.filter((kind) => kind === 'drafts').length,
    versions: kinds.filter((kind) => kind === 'versions').length,
  };
}

const withFeaturedImage = split(
  (doc) => doc._type === 'post' && doc['featuredImage'] !== undefined,
);
const overTitleLimit = split((doc) => {
  const title: unknown = doc['title'];
  return doc._type === 'post' && typeof title === 'string' && title.length > TITLE_LIMIT;
});

function deps(cwd: string, stdout: string[], stderr: string[]): RunDeps {
  return {
    cwd,
    env: {
      SANITY_STUDIO_PROJECT_ID: projectId,
      SANITY_STUDIO_DATASET: dataset,
      SANITY_AUTH_TOKEN: token,
    },
    stdout: { write: (text) => stdout.push(text), isTTY: false },
    stderr: { write: (text) => stderr.push(text) },
    runner: runCommand,
    createReader: createSanityReader,
    signals: { on: () => undefined, exit: () => undefined },
    fetch: globalThis.fetch,
  };
}

describe.skipIf(!enabled)('CLI against the fixture Studio', () => {
  let workDir: string | undefined;
  let repo = '';
  let studio = '';
  let jsonOut = '';
  let jsonErr = '';
  let exitCode = -1;
  let markdownOut = '';

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'schema-impact-cli-'));
    repo = join(workDir, 'repo');
    studio = join(repo, 'studio');
    const git = (args: string[]): void => {
      execFileSync(
        'git',
        ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args],
        {
          cwd: repo,
        },
      );
    };

    // The base is the committed fixture Studio. The working tree is the head.
    await cp(studioSource, studio, {
      recursive: true,
      filter: (source) => basename(source) !== 'node_modules',
    });
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'fixture studio']);
    git(['checkout', '-q', '-b', 'change']);

    const postPath = join(studio, 'schemaTypes', 'post.ts');
    const post = await readFile(postPath, 'utf8');
    if (!post.includes(featuredImageBlock) || !post.includes(titleRule)) {
      throw new Error('The fixture post schema has changed.');
    }
    await writeFile(
      postPath,
      post
        .replace(featuredImageBlock, '')
        .replace(
          titleRule,
          titleRule.replace('rule.required()', `rule.required().max(${String(TITLE_LIMIT)})`),
        ),
    );
    await symlink(join(studioSource, 'node_modules'), join(studio, 'node_modules'), 'dir');

    const outJson: string[] = [];
    const errJson: string[] = [];
    exitCode = await runCli(
      ['--studio', 'studio', '--format', 'json'],
      deps(repo, outJson, errJson),
    );
    jsonOut = outJson.join('');
    jsonErr = errJson.join('');

    const outMd: string[] = [];
    await runCli(['--studio', 'studio', '--format', 'md'], deps(repo, outMd, []));
    markdownOut = outMd.join('');
  }, LONG_TIMEOUT_MS);

  afterAll(async () => {
    if (workDir === undefined) return;
    // Unlink the symlink first, so removing the tree never reaches the real node_modules.
    const link = join(studio, 'node_modules');
    if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await unlink(link);
    await rm(workDir, { recursive: true, force: true });
  }, LONG_TIMEOUT_MS);

  it('exits 1 because data-loss and validation-error both matched', () => {
    expect(jsonErr).toBe('');
    expect(exitCode).toBe(1);
  });

  it('counts the documents that still hold the removed featured image', () => {
    const report = JSON.parse(jsonOut) as {
      changes: {
        change: { kind: string; path?: string };
        published: number;
        drafts: number;
        versions: number;
      }[];
    };
    const row = report.changes.find((r) => r.change.kind === 'removed-field');

    expect(row).toMatchObject({
      change: { path: 'featuredImage' },
      published: withFeaturedImage.published,
      drafts: withFeaturedImage.drafts,
      versions: withFeaturedImage.versions,
    });
  });

  it('keeps the title limit group with the expected split, and the raw unknown-field group', () => {
    const report = JSON.parse(jsonOut) as {
      validation: {
        introduced: {
          pathPattern: string;
          code: string;
          published: number;
          drafts: number;
          versions: number;
        }[];
        resolvedCount: number;
      };
    };
    const title = report.validation.introduced.find((g) => g.pathPattern === 'title');
    const unknown = report.validation.introduced.find((g) => g.code === 'object.unknown-field');

    expect(title).toMatchObject({
      code: 'string.maximum-length',
      published: overTitleLimit.published,
      drafts: overTitleLimit.drafts,
      versions: overTitleLimit.versions,
    });
    expect(unknown).toMatchObject({
      pathPattern: 'featuredImage',
      published: withFeaturedImage.published,
      drafts: withFeaturedImage.drafts,
      versions: withFeaturedImage.versions,
    });
  });

  it('checks the working tree out as the change branch, with uncommitted Studio edits', () => {
    const report = JSON.parse(jsonOut) as { head: { ref: string; uncommitted?: boolean } };

    expect(report.head).toMatchObject({ ref: 'change', uncommitted: true });
    expect(markdownOut).toContain('to `change` (`');
    expect(markdownOut).toContain('+ uncommitted changes');
  });

  it('starts the markdown with the hidden marker and folds the unknown-field note into the row', () => {
    expect(markdownOut.split('\n')[0]).toBe('<!-- sanity-schema-impact -->');
    expect(markdownOut).toContain('Studio also flags these as unknown fields |');
    expect(markdownOut).not.toContain('object.unknown-field');
  });
});
