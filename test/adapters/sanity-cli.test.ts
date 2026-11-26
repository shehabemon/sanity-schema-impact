import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandOptions, CommandResult } from '../../src/adapters/process.js';
import { extractSchema, runValidation, sanityBinary } from '../../src/adapters/sanity-cli.js';

const token = 'viewer-token-for-test';
let studioDir: string;
let scratch: string;

function fakeRunner(result: Partial<CommandResult>): {
  runner: (options: CommandOptions) => Promise<CommandResult>;
  calls: CommandOptions[];
} {
  const calls: CommandOptions[] = [];
  return {
    calls,
    runner: (options) => {
      calls.push(options);
      return Promise.resolve({ code: 0, stdout: '', stderr: '', ...result });
    },
  };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'sanity-cli-'));
  studioDir = join(scratch, 'studio');
  await mkdir(join(studioDir, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(studioDir, 'node_modules', '.bin', 'sanity'), '');
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('sanityBinary', () => {
  it('points at the Studio-local binary', () => {
    expect(sanityBinary(studioDir, scratch)).toBe(
      join(studioDir, 'node_modules', '.bin', 'sanity'),
    );
  });

  it('asks for the Studio dependencies, without naming a package manager', () => {
    const error = (() => {
      try {
        sanityBinary(join(scratch, 'missing'), scratch);
        return undefined;
      } catch (caught) {
        return caught as Error;
      }
    })();

    expect(error?.message).toContain("Install the Studio's dependencies first.");
    expect(error?.message).not.toMatch(/pnpm|npm|yarn/);
  });

  it('finds a hoisted binary in the repository root when the Studio has none', async () => {
    const repo = join(scratch, 'hoisted');
    await mkdir(join(repo, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(repo, 'node_modules', '.bin', 'sanity'), '');
    await mkdir(join(repo, 'apps', 'sanity'), { recursive: true });

    expect(sanityBinary(join(repo, 'apps', 'sanity'), repo)).toBe(
      join(repo, 'node_modules', '.bin', 'sanity'),
    );
  });

  it('prefers the binary in the Studio over one in the root', async () => {
    const repo = join(scratch, 'both');
    const own = join(repo, 'apps', 'sanity', 'node_modules', '.bin');
    await mkdir(own, { recursive: true });
    await mkdir(join(repo, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(own, 'sanity'), '');
    await writeFile(join(repo, 'node_modules', '.bin', 'sanity'), '');

    expect(sanityBinary(join(repo, 'apps', 'sanity'), repo)).toBe(join(own, 'sanity'));
  });

  it('does not look above the repository root', async () => {
    const outer = join(scratch, 'outer');
    await mkdir(join(outer, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(outer, 'node_modules', '.bin', 'sanity'), '');
    const repo = join(outer, 'repo');
    await mkdir(join(repo, 'studio'), { recursive: true });

    expect(() => sanityBinary(join(repo, 'studio'), repo)).toThrow(
      "Install the Studio's dependencies first.",
    );
  });
});

describe('extractSchema', () => {
  it('writes the extract to the given path with the enforced required fields flag', async () => {
    const { runner, calls } = fakeRunner({});
    await extractSchema({
      studioDir,
      repoRoot: scratch,
      runner,
      outputPath: join(scratch, 'out.json'),
      projectId: 'proj1',
      dataset: 'fixture',
    });

    expect(calls[0]?.args).toEqual([
      'schema',
      'extract',
      '--enforce-required-fields',
      '--path',
      join(scratch, 'out.json'),
    ]);
  });

  it('passes the Studio project and dataset, and nothing else from the environment', async () => {
    const { runner, calls } = fakeRunner({});
    await extractSchema({
      studioDir,
      repoRoot: scratch,
      runner,
      outputPath: join(scratch, 'out.json'),
      projectId: 'proj1',
      dataset: 'fixture',
    });

    expect(calls[0]?.env).toEqual({
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      SANITY_STUDIO_PROJECT_ID: 'proj1',
      SANITY_STUDIO_DATASET: 'fixture',
    });
  });

  it('passes the pass-env values alongside the project and dataset', async () => {
    const { runner, calls } = fakeRunner({});
    await extractSchema({
      studioDir,
      repoRoot: scratch,
      runner,
      outputPath: join(scratch, 'out.json'),
      projectId: 'proj1',
      dataset: 'fixture',
      passEnv: { SANITY_STUDIO_ID: 'studio-id' },
    });

    expect(calls[0]?.env).toEqual({
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      SANITY_STUDIO_ID: 'studio-id',
      SANITY_STUDIO_PROJECT_ID: 'proj1',
      SANITY_STUDIO_DATASET: 'fixture',
    });
  });

  it('throws with the tail of stderr when the extract fails', async () => {
    const { runner } = fakeRunner({ code: 2, stderr: 'Schema file already exists' });
    await expect(
      extractSchema({
        studioDir,
        repoRoot: scratch,
        runner,
        outputPath: join(scratch, 'x.json'),
        projectId: 'proj1',
        dataset: 'fixture',
      }),
    ).rejects.toThrow('sanity schema extract exited with code 2. Schema file already exists');
  });
});

describe('runValidation', () => {
  it('passes the token only through the environment', async () => {
    const { runner, calls } = fakeRunner({});
    await runValidation({
      studioDir,
      repoRoot: scratch,
      runner,
      projectId: 'proj1',
      dataset: 'fixture',
      token,
      level: 'warning',
    });

    expect(calls[0]?.args).not.toContain(token);
    expect(calls[0]?.env['SANITY_AUTH_TOKEN']).toBe(token);
    expect(calls[0]?.secrets).toEqual([token]);
  });

  it('passes the pass-env values, and still gives the token only to the validate child', async () => {
    const { runner, calls } = fakeRunner({});
    await runValidation({
      studioDir,
      repoRoot: scratch,
      runner,
      projectId: 'proj1',
      dataset: 'fixture',
      token,
      level: 'warning',
      passEnv: { SANITY_STUDIO_ID: 'studio-id' },
    });

    expect(calls[0]?.env).toEqual({
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      SANITY_STUDIO_ID: 'studio-id',
      SANITY_AUTH_TOKEN: token,
    });
  });

  it('accepts exit code 1, because that means problems were found', async () => {
    const { runner } = fakeRunner({ code: 1, stdout: '{"level":"error"}\n' });
    const result = await runValidation({
      studioDir,
      repoRoot: scratch,
      runner,
      projectId: 'proj1',
      dataset: 'fixture',
      token,
      level: 'warning',
    });

    expect(result.stdout).toBe('{"level":"error"}\n');
  });

  it('throws on any other exit code, without the token in the message', async () => {
    const { runner } = fakeRunner({ code: 4, stderr: `bad token ${token}` });
    const error = await runValidation({
      studioDir,
      repoRoot: scratch,
      runner,
      projectId: 'proj1',
      dataset: 'fixture',
      token,
      level: 'warning',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('exited with code 4');
    expect((error as Error).message).not.toContain(token);
  });
});
