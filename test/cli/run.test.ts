import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../../src/adapters/process.js';
import type { SanityReader } from '../../src/adapters/sanity.js';
import type { SignalSource } from '../../src/cleanup.js';
import { colourEnabled, runCli, type RunDeps } from '../../src/cli/run.js';
import { VERSION } from '../../src/version.js';

function harness(
  env: Record<string, string | undefined> = {},
  isTTY = false,
): {
  deps: RunDeps;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const unused: CommandRunner = () => Promise.reject(new Error('runner should not be called'));
  const reader: SanityReader = {
    fetch: () => Promise.reject(new Error('reader should not be called')),
  };
  const signals: SignalSource = { on: () => undefined, exit: () => undefined };
  return {
    out,
    err,
    deps: {
      cwd: process.cwd(),
      env,
      stdout: { write: (text) => out.push(text), isTTY },
      stderr: { write: (text) => err.push(text) },
      runner: unused,
      createReader: () => reader,
      signals,
    },
  };
}

describe('runCli', () => {
  it('prints the usage and exits 0 for --help', async () => {
    const { deps, out } = harness();
    expect(await runCli(['--help'], deps)).toBe(0);
    expect(out.join('')).toContain('--studio');
  });

  it('prints the version and exits 0', async () => {
    const { deps, out } = harness();
    expect(await runCli(['--version'], deps)).toBe(0);
    expect(out.join('')).toBe(`${VERSION}\n`);
  });

  it('exits 2 with the reason when an argument is wrong', async () => {
    const { deps, err } = harness();
    expect(await runCli(['--base', 'main'], deps)).toBe(2);
    expect(err.join('')).toBe('Missing --studio <dir>.\n');
  });

  it('asks for the project when neither the flag nor the environment gives one', async () => {
    const { deps, err } = harness({ SANITY_AUTH_TOKEN: 'secret' });
    expect(await runCli(['--studio', '.'], deps)).toBe(2);
    expect(err.join('')).toContain('SANITY_STUDIO_PROJECT_ID');
  });

  it('asks for the token and never echoes one it was given', async () => {
    const { deps, err } = harness({ SANITY_STUDIO_PROJECT_ID: 'p', SANITY_STUDIO_DATASET: 'd' });
    expect(await runCli(['--studio', '.'], deps)).toBe(2);
    expect(err.join('')).toContain('SANITY_AUTH_TOKEN');
  });

  it('exits 2 when the Studio directory does not exist', async () => {
    const env = {
      SANITY_STUDIO_PROJECT_ID: 'p',
      SANITY_STUDIO_DATASET: 'd',
      SANITY_AUTH_TOKEN: 's',
    };
    const { deps, err } = harness(env);
    expect(await runCli(['--studio', 'no/such/studio'], deps)).toBe(2);
    expect(err.join('')).toContain('No Studio directory at');
  });
});

describe('colourEnabled', () => {
  it('is on only for a terminal', () => {
    expect(colourEnabled({}, true)).toBe(true);
    expect(colourEnabled({}, false)).toBe(false);
  });

  it('is off when NO_COLOR is set to any non-empty value', () => {
    expect(colourEnabled({ NO_COLOR: '1' }, true)).toBe(false);
    expect(colourEnabled({ NO_COLOR: '' }, true)).toBe(true);
  });
});
