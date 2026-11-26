import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandOptions, CommandResult } from '../../src/adapters/process.js';
import type { SanityReader } from '../../src/adapters/sanity.js';
import { compareValidation, validateStudio, type CommandRunner } from '../../src/validation/run.js';

const token = 'viewer-token-for-test';
const postTitle = readFileSync(
  new URL('../fixtures/validation/post-title.ndjson', import.meta.url),
  'utf8',
);
const authorName = readFileSync(
  new URL('../fixtures/validation/author-name.ndjson', import.meta.url),
  'utf8',
);

let studioDir: string;
let emptyStudioDir: string;
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'validation-run-'));
  studioDir = join(workDir, 'studio');
  emptyStudioDir = join(workDir, 'no-install');
  await mkdir(join(studioDir, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(studioDir, 'node_modules', '.bin', 'sanity'), '');
  await mkdir(emptyStudioDir);
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function fakeRunner(...results: CommandResult[]): {
  runner: CommandRunner;
  calls: CommandOptions[];
} {
  const calls: CommandOptions[] = [];
  const runner: CommandRunner = (options) => {
    calls.push(options);
    const next = results.shift();
    return next === undefined
      ? Promise.reject(new Error('Unexpected command.'))
      : Promise.resolve(next);
  };
  return { runner, calls };
}

function fakeReader(count: number): { reader: SanityReader; queries: string[] } {
  const queries: string[] = [];
  const reader: SanityReader = {
    fetch: <T>(query: string): Promise<T> => {
      queries.push(query);
      return Promise.resolve(count as T);
    },
  };
  return { reader, queries };
}

const common = { projectId: 'proj1', dataset: 'fixture-dev', token };

describe('validateStudio', () => {
  it('refuses to run when the Studio has no local Sanity binary, and says how to fix it', async () => {
    const { runner, calls } = fakeRunner();
    const { reader } = fakeReader(10);

    await expect(
      validateStudio({ ...common, studioDir: emptyStudioDir, runner, reader }),
    ).rejects.toThrow('Run pnpm install in the Studio directory first.');
    expect(calls).toHaveLength(0);
  });

  it('refuses to run when the dataset holds no documents', async () => {
    const { runner, calls } = fakeRunner();
    const { reader, queries } = fakeReader(0);

    await expect(validateStudio({ ...common, studioDir, runner, reader })).rejects.toThrow(
      'No documents found in dataset fixture-dev.',
    );
    expect(calls).toHaveLength(0);
    expect(queries[0]).toContain('system.*');
  });

  it('runs the local binary with the ndjson format, warning level and the token in the environment only', async () => {
    const { runner, calls } = fakeRunner({ code: 0, stdout: '', stderr: '' });
    const { reader } = fakeReader(10);

    await validateStudio({ ...common, studioDir, runner, reader });

    const [call] = calls;
    expect(call?.cmd).toBe(join(studioDir, 'node_modules', '.bin', 'sanity'));
    expect(call?.args).toEqual([
      'documents',
      'validate',
      '--project',
      'proj1',
      '--dataset',
      'fixture-dev',
      '--format',
      'ndjson',
      '--level',
      'warning',
      '--yes',
    ]);
    expect(call?.cwd).toBe(studioDir);
    expect(call?.env).toEqual({
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      SANITY_AUTH_TOKEN: token,
    });
    expect(call?.args.join(' ')).not.toContain(token);
    expect(call?.secrets).toEqual([token]);
  });

  it('passes an explicit level through to the CLI', async () => {
    const { runner, calls } = fakeRunner({ code: 0, stdout: '', stderr: '' });
    const { reader } = fakeReader(10);

    await validateStudio({ ...common, studioDir, level: 'error', runner, reader });

    expect(calls[0]?.args).toContain('error');
  });

  it('returns the markers when the CLI exits 1, because that means errors were found', async () => {
    const { runner } = fakeRunner({ code: 1, stdout: postTitle, stderr: 'Error: EEXIT: 1' });
    const { reader } = fakeReader(10);

    const run = await validateStudio({ ...common, studioDir, runner, reader });

    expect(run.documentCount).toBe(10);
    expect(run.markers).toHaveLength(3);
  });

  it('returns no markers when the CLI exits 0 with empty output', async () => {
    const { runner } = fakeRunner({ code: 0, stdout: '', stderr: '' });
    const { reader } = fakeReader(10);

    const run = await validateStudio({ ...common, studioDir, runner, reader });

    expect(run.markers).toEqual([]);
  });

  it('throws on any other exit code, with the stderr tail and no token', async () => {
    const stderr = `Error: auth failed for ${token}`;
    const { runner } = fakeRunner({ code: 2, stdout: '', stderr });
    const { reader } = fakeReader(10);

    const attempt = validateStudio({ ...common, studioDir, runner, reader });

    await expect(attempt).rejects.toThrow('exited with code 2');
    await attempt.catch((error: unknown) => {
      expect(String(error)).toContain('[redacted]');
      expect(String(error)).not.toContain(token);
    });
  });
});

describe('compareValidation', () => {
  it('lists the markers the head run adds, and groups them', async () => {
    const { runner: baseRunner } = fakeRunner({ code: 0, stdout: '', stderr: '' });
    const { runner: headRunner } = fakeRunner({ code: 1, stdout: postTitle, stderr: '' });
    const { reader } = fakeReader(10);
    const base = await validateStudio({ ...common, studioDir, runner: baseRunner, reader });
    const head = await validateStudio({ ...common, studioDir, runner: headRunner, reader });

    const comparison = compareValidation(base, head);

    expect(comparison.introduced).toHaveLength(3);
    expect(comparison.resolved).toEqual([]);
    expect(comparison.groups).toHaveLength(1);
    expect(comparison.groups[0]).toMatchObject({
      documentType: 'post',
      pathPattern: 'title',
      code: 'string.maximum-length',
      published: 1,
      drafts: 1,
      versions: 1,
    });
  });

  it('lists a marker that only the base run had as resolved', async () => {
    const { runner: baseRunner } = fakeRunner({ code: 1, stdout: authorName, stderr: '' });
    const { runner: headRunner } = fakeRunner({ code: 0, stdout: '', stderr: '' });
    const { reader } = fakeReader(10);
    const base = await validateStudio({ ...common, studioDir, runner: baseRunner, reader });
    const head = await validateStudio({ ...common, studioDir, runner: headRunner, reader });

    const comparison = compareValidation(base, head);

    expect(comparison.introduced).toEqual([]);
    expect(comparison.resolved.map((m) => m.documentId)).toEqual(['author-001']);
    expect(comparison.groups).toEqual([]);
  });
});
