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
    expect(sanityBinary(studioDir)).toBe(join(studioDir, 'node_modules', '.bin', 'sanity'));
  });

  it('asks for pnpm install when the Studio has no binary', () => {
    expect(() => sanityBinary(join(scratch, 'missing'))).toThrow('Run pnpm install');
  });
});

describe('extractSchema', () => {
  it('writes the extract to the given path with the enforced required fields flag', async () => {
    const { runner, calls } = fakeRunner({});
    await extractSchema({ studioDir, runner, outputPath: join(scratch, 'out.json') });

    expect(calls[0]?.args).toEqual([
      'schema',
      'extract',
      '--enforce-required-fields',
      '--path',
      join(scratch, 'out.json'),
    ]);
    expect(calls[0]?.env).toEqual({
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
    });
  });

  it('throws with the tail of stderr when the extract fails', async () => {
    const { runner } = fakeRunner({ code: 2, stderr: 'Schema file already exists' });
    await expect(
      extractSchema({ studioDir, runner, outputPath: join(scratch, 'x.json') }),
    ).rejects.toThrow('sanity schema extract exited with code 2. Schema file already exists');
  });
});

describe('runValidation', () => {
  it('passes the token only through the environment', async () => {
    const { runner, calls } = fakeRunner({});
    await runValidation({
      studioDir,
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

  it('accepts exit code 1, because that means problems were found', async () => {
    const { runner } = fakeRunner({ code: 1, stdout: '{"level":"error"}\n' });
    const result = await runValidation({
      studioDir,
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
