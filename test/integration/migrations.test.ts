import { readFileSync } from 'node:fs';
import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommand } from '../../src/adapters/process.js';
import { createSanityReader } from '../../src/adapters/sanity.js';
import { diffSchemas } from '../../src/diff/classify.js';
import { normalise } from '../../src/diff/normalise.js';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import { measureImpact, type ImpactResult } from '../../src/impact/run.js';
import { planScaffolds } from '../../src/migrate/scaffold.js';
import { writeScaffolds } from '../../src/migrate/write.js';

// Runs against the fixture dataset only when all three variables are set (see setup.ts).
// Every migration here is run with --dry-run. Nothing is written to the dataset.
const API_VERSION = '2025-02-19';
const projectId = process.env['SANITY_STUDIO_PROJECT_ID'] ?? '';
const dataset = process.env['SANITY_STUDIO_DATASET'] ?? '';
const token = process.env['SANITY_AUTH_TOKEN'] ?? '';
const enabled = [projectId, dataset, token].every((value) => value.trim() !== '');

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const studioDir = join(repoRoot, 'fixtures', 'studio');
const tscBinary = join(repoRoot, 'node_modules', '.bin', 'tsc');
const sanityBinary = join(studioDir, 'node_modules', '.bin', 'sanity');
const MIGRATION_TIMEOUT_MS = 5 * 60_000;

function schemaAt(path: string) {
  return normalise(JSON.parse(readFileSync(join(repoRoot, path), 'utf8')) as unknown);
}

function realChange(name: string, kind: Change['kind']): Change {
  const changes = diffSchemas(
    schemaAt(`test/fixtures/schemas/${name}/before.json`),
    schemaAt(`test/fixtures/schemas/${name}/after.json`),
  );
  const found = changes.find((change) => change.kind === kind);
  if (found === undefined) throw new Error(`The ${name} fixture has no ${kind} change.`);
  return found;
}

const objectField: FieldInfo = { kind: 'object', required: false };

/** The changes the fixture Studio would produce. Renames and type removal come from the real fixture pairs. */
const changes: Change[] = [
  {
    kind: 'removed-field',
    docType: 'post',
    path: 'featuredImage',
    before: { kind: 'image', required: false },
  },
  realChange('possible-rename', 'possible-rename'),
  { kind: 'removed-field', docType: 'product', path: 'variants[].price', before: objectField },
  realChange('removed-type', 'removed-type'),
];

interface DryRunPatches {
  /** Distinct documents the dry run plans to patch. */
  readonly ids: readonly string[];
  /** Patch operations, one header each. A document can have several. */
  readonly operations: number;
  /** Lines in square brackets that aren't patch headers, such as creates or deletes. */
  readonly otherLines: readonly string[];
}

/** Reads a dry run's patch headers. Each header is one operation on a document. */
function parseDryRun(stdout: string): DryRunPatches {
  const ids = new Set<string>();
  let operations = 0;
  const otherLines: string[] = [];
  for (const line of stdout.split('\n')) {
    const header = /^\[patch\] \[[^\]]+\] (\S+)\s*$/.exec(line);
    if (header?.[1] !== undefined) {
      ids.add(header[1]);
      operations += 1;
    } else if (line.startsWith('[')) {
      otherLines.push(line);
    }
  }
  return { ids: [...ids], operations, otherLines };
}

const isDraft = (id: string): boolean => id.startsWith('drafts.');
const isVersion = (id: string): boolean => id.startsWith('versions.');

function totalOf(result: ImpactResult): number {
  return 'skipped' in result ? 0 : result.published + result.drafts + result.versions;
}

describe.skipIf(!enabled)('migration scaffolds against the fixture dataset', () => {
  let scratch = '';
  let impact: ImpactResult[];
  let slugs: string[];

  /** A dry run of one scaffold. The guard keeps a real run out of this file. */
  async function dryRun(slug: string): Promise<DryRunPatches> {
    const args = [
      'migrations',
      'run',
      slug,
      '--dry-run',
      '--no-progress',
      '--no-confirm',
      '--dataset',
      dataset,
      '-p',
      projectId,
    ];
    if (!args.includes('--dry-run') || args.includes('--no-dry-run')) {
      throw new Error('This test only runs migrations as dry runs.');
    }
    const result = await runCommand({
      cmd: sanityBinary,
      args,
      cwd: scratch,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: process.env['HOME'] ?? '',
        SANITY_AUTH_TOKEN: token,
      },
      timeoutMs: MIGRATION_TIMEOUT_MS,
      secrets: [token],
    });
    expect(result.code, result.stderr.slice(-500)).toBe(0);
    return parseDryRun(result.stdout);
  }

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'scaffold-studio-'));
    for (const name of [
      'package.json',
      'sanity.cli.ts',
      'sanity.config.ts',
      'tsconfig.json',
      'schemaTypes',
    ]) {
      await cp(join(studioDir, name), join(scratch, name), { recursive: true });
    }
    await symlink(join(studioDir, 'node_modules'), join(scratch, 'node_modules'), 'dir');

    const reader = createSanityReader({ projectId, dataset, token, apiVersion: API_VERSION });
    impact = await measureImpact(changes, reader);
    const plan = planScaffolds(impact);
    await writeScaffolds(plan.scaffolds, join(scratch, 'migrations'));
    slugs = plan.scaffolds.map((scaffold) => scaffold.slug);
  }, 120_000);

  afterAll(async () => {
    if (scratch !== '') await rm(scratch, { recursive: true, force: true });
  });

  it('plans one scaffold for each change that counted documents', () => {
    expect([...slugs].sort()).toEqual([
      'delete-product-documents',
      'rename-post-featured-image-to-hero-image',
      'unset-post-featured-image',
      'unset-product-variants-price',
    ]);
  });

  it(
    'writes scaffolds that type-check against the Studio sanity/migrate typings',
    async () => {
      const result = await runCommand({
        cmd: tscBinary,
        args: ['--noEmit', '-p', join(scratch, 'tsconfig.json')],
        cwd: scratch,
        env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' },
        timeoutMs: MIGRATION_TIMEOUT_MS,
      });

      expect(result.stdout, result.stdout).toBe('');
      expect(result.code).toBe(0);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'writes scaffolds that pass with noUnusedLocals and noUnusedParameters, as strict Studios set them',
    async () => {
      const config = join(scratch, 'tsconfig.migrations.json');
      await writeFile(
        config,
        `${JSON.stringify(
          {
            extends: './tsconfig.json',
            compilerOptions: { noUnusedLocals: true, noUnusedParameters: true },
            include: ['migrations/**/*.ts'],
          },
          null,
          2,
        )}\n`,
      );
      const env = { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' };
      const listed = await runCommand({
        cmd: tscBinary,
        args: ['--listFilesOnly', '-p', config],
        cwd: scratch,
        env,
        timeoutMs: MIGRATION_TIMEOUT_MS,
      });
      expect(listed.stdout).toContain(join('migrations', 'unset-post-featured-image', 'index.ts'));

      const result = await runCommand({
        cmd: tscBinary,
        args: ['--noEmit', '-p', config],
        cwd: scratch,
        env,
        timeoutMs: MIGRATION_TIMEOUT_MS,
      });
      expect(result.stdout, result.stdout).toBe('');
      expect(result.code).toBe(0);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'plans the same number of patches for a removed field as the impact step counted',
    async () => {
      const counted = totalOf(impact[0] as ImpactResult);
      const patches = await dryRun('unset-post-featured-image');

      expect(patches.otherLines).toEqual([]);
      expect(patches.ids).toHaveLength(counted);
      expect(patches.operations).toBe(counted);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'includes drafts and release versions in the dry run, as the impact step does',
    async () => {
      const result = impact[0];
      if (result === undefined || 'skipped' in result) throw new Error('No counted result.');
      const patches = await dryRun('unset-post-featured-image');

      expect(patches.ids.filter(isDraft)).toHaveLength(result.drafts);
      expect(patches.ids.filter(isVersion)).toHaveLength(result.versions);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'plans the same number of patches for a rename as the impact step counted',
    async () => {
      const counted = totalOf(impact[1] as ImpactResult);
      const patches = await dryRun('rename-post-featured-image-to-hero-image');

      expect(patches.ids).toHaveLength(counted);
      // One setIfMissing on the new field and one unset on the old one, per document.
      expect(patches.operations).toBe(counted * 2);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'plans a keyed patch for each document the impact step counted inside an array',
    async () => {
      const counted = totalOf(impact[2] as ImpactResult);
      const patches = await dryRun('unset-product-variants-price');

      expect(patches.otherLines).toEqual([]);
      expect(counted).toBeGreaterThan(0);
      expect(patches.ids).toHaveLength(counted);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'plans no patches for a removed type, so the scaffold deletes nothing',
    async () => {
      const counted = totalOf(impact[3] as ImpactResult);
      const patches = await dryRun('delete-product-documents');

      expect(counted).toBeGreaterThan(0);
      expect(patches.ids).toEqual([]);
      expect(patches.otherLines).toEqual([]);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
