import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  runCommand,
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
} from '../src/adapters/process.js';
import type { SanityReader } from '../src/adapters/sanity.js';
import { createCleanup, type Cleanup } from '../src/cleanup.js';
import { runPipeline } from '../src/pipeline.js';

const fixtures = new URL('./fixtures/', import.meta.url);
const removedFieldBefore = new URL('schemas/removed-field/before.json', fixtures);
const removedFieldAfter = new URL('schemas/removed-field/after.json', fixtures);
const titleNdjson = await readFile(new URL('validation/post-title.ndjson', fixtures), 'utf8');

let scratch: string;
let repo: string;
let studio: string;
const token = 'viewer-token-for-test';

function git(args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args],
    {
      cwd: repo,
      encoding: 'utf8',
    },
  ).trim();
}

interface FakeOptions {
  failBaseExtract?: boolean;
}

/** Real git, real schema diff. The Sanity CLI and the dataset are faked. */
function fakeCli(options: FakeOptions = {}): CommandRunner {
  return async (call: CommandOptions): Promise<CommandResult> => {
    if (call.cmd === 'git') return runCommand(call);
    const isHead = call.cwd === studio;
    if (call.args[0] === 'schema') {
      if (!isHead && options.failBaseExtract) {
        return { code: 2, stdout: '', stderr: 'Failed to extract' };
      }
      const out = call.args[call.args.indexOf('--path') + 1] ?? '';
      await copyFile(isHead ? removedFieldAfter : removedFieldBefore, out);
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: isHead ? 1 : 0, stdout: isHead ? titleNdjson : '', stderr: '' };
  };
}

const reader: SanityReader = {
  fetch: <T>(query: string): Promise<T> => {
    if (query.startsWith('count(')) return Promise.resolve(10 as T);
    const ids = [...query.matchAll(/"(\d+)": \{/g)].map((match) => match[1] ?? '');
    return Promise.resolve(
      Object.fromEntries(
        ids.map((id) => [id, { published: 4, drafts: 1, versions: 0, sample: ['post-0001'] }]),
      ) as T,
    );
  },
};

function options(
  cleanup: Cleanup,
  extra: { skipValidation?: boolean; failOn?: ('data-loss' | 'validation-error')[] } = {},
  fake: FakeOptions = {},
) {
  return {
    studioDir: studio,
    base: 'main',
    projectId: 'proj1',
    dataset: 'fixture',
    token,
    failOn: extra.failOn ?? ['data-loss'],
    skipValidation: extra.skipValidation ?? false,
    runner: fakeCli(fake),
    reader,
    cleanup,
    scratchRoot: scratch,
  };
}

beforeAll(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'pipeline-')));
  repo = join(scratch, 'repo');
  studio = join(repo, 'studio');
  await mkdir(studio, { recursive: true });
  await mkdir(join(studio, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(studio, 'node_modules', '.bin', 'sanity'), '');
  await writeFile(join(studio, 'sanity.config.ts'), 'export default {};\n');
  git(['init', '-q', '-b', 'main', repo]);
  git(['add', 'studio/sanity.config.ts']);
  git(['commit', '-q', '-m', 'studio']);
  studio = await realpath(studio);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('runPipeline', () => {
  it('reports a removed field with its impact and marks data-loss as failed', async () => {
    const cleanup = createCleanup();
    const report = await runPipeline(options(cleanup, { skipValidation: true }));
    await cleanup.run();

    expect(report.changes.map((result) => result.change.kind)).toEqual(['removed-field']);
    expect(report.summary.affected).toBe(1);
    expect(report.failures).toEqual(['data-loss']);
    expect(report.validation).toEqual({ skipped: 'Skipped with --skip-validation.' });
  });

  it('validates both checkouts and keeps the introduced groups', async () => {
    const cleanup = createCleanup();
    const report = await runPipeline(options(cleanup, { failOn: ['validation-error'] }));
    await cleanup.run();

    expect(report.validation).toMatchObject({ resolvedCount: 0 });
    if (!('introduced' in report.validation)) throw new Error('validation was skipped');
    expect(report.validation.introduced.length).toBeGreaterThan(0);
    expect(report.failures).toEqual(['validation-error']);
  });

  it('removes the base worktree and the linked node_modules when cleanup runs', async () => {
    const cleanup = createCleanup();
    await runPipeline(options(cleanup, { skipValidation: true }));
    await cleanup.run();

    expect(git(['worktree', 'list']).split('\n')).toHaveLength(1);
    expect(await readFile(join(studio, 'node_modules', '.bin', 'sanity'), 'utf8')).toBe('');
  });

  it('cleans up the worktree when the base extract fails', async () => {
    const cleanup = createCleanup();
    await expect(
      runPipeline(options(cleanup, { skipValidation: true }, { failBaseExtract: true })),
    ).rejects.toThrow('sanity schema extract exited with code 2');
    await cleanup.run();

    expect(git(['worktree', 'list']).split('\n')).toHaveLength(1);
  });
});
