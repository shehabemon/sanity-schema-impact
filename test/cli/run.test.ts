import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandRunner } from '../../src/adapters/process.js';
import type { SanityReader } from '../../src/adapters/sanity.js';
import type { SignalSource } from '../../src/cleanup.js';
import { colourEnabled, runCli, type RunDeps } from '../../src/cli/run.js';
import type { FetchLike } from '../../src/github/comment.js';
import { VERSION } from '../../src/version.js';

const refuseFetch: FetchLike = () => Promise.reject(new Error('fetch should not be called'));

function harness(
  env: Record<string, string | undefined> = {},
  isTTY = false,
  fetch: FetchLike = refuseFetch,
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
      fetch,
    },
  };
}

const PR_EVENT = { action: 'synchronize', pull_request: { number: 7 } };
const TOKEN = 'ghs_comment_token_for_test';

describe('runCli comment', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'comment-cli-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  let fileCount = 0;

  async function files(event: unknown): Promise<{ eventPath: string; reportPath: string }> {
    fileCount += 1;
    const eventPath = join(dir, `event-${String(fileCount)}.json`);
    const reportPath = join(dir, `report-${String(fileCount)}.md`);
    await writeFile(eventPath, JSON.stringify(event));
    await writeFile(reportPath, '<!-- sanity-schema-impact -->\n## Schema impact\n');
    return { eventPath, reportPath };
  }

  function env(eventPath: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      GITHUB_TOKEN: TOKEN,
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: 'https://ghe.example.com/api/v3',
      ...extra,
    };
  }

  it('warns and exits 0 when the event is not a pull request', async () => {
    const { eventPath, reportPath } = await files({ ref: 'refs/heads/main' });
    const { deps, err } = harness(env(eventPath));

    expect(await runCli(['comment', '--file', reportPath], deps)).toBe(0);
    expect(err.join('')).toContain('::warning::');
  });

  it('creates the comment on the pull request named in the event', async () => {
    const { eventPath, reportPath } = await files(PR_EVENT);
    const calls: string[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push(`${String(init?.method)} ${url}`);
      return Promise.resolve(
        url.includes('/issues/7/comments?')
          ? Response.json([])
          : Response.json({ id: 5 }, { status: 201 }),
      );
    };
    const { deps, out } = harness(env(eventPath), false, fetch);

    expect(await runCli(['comment', '--file', reportPath], deps)).toBe(0);
    expect(calls).toEqual([
      'GET https://ghe.example.com/api/v3/repos/acme/shop/issues/7/comments?per_page=100',
      'POST https://ghe.example.com/api/v3/repos/acme/shop/issues/7/comments',
    ]);
    expect(out.join('')).toBe('Created comment 5 on acme/shop#7.\n');
  });

  it('exits 2 when GITHUB_TOKEN is not set', async () => {
    const { eventPath, reportPath } = await files(PR_EVENT);
    const { deps, err } = harness(env(eventPath, { GITHUB_TOKEN: '' }));

    expect(await runCli(['comment', '--file', reportPath], deps)).toBe(2);
    expect(err.join('')).toContain('GITHUB_TOKEN is not set.');
  });

  it('exits 2 when the event path is not set', async () => {
    const { reportPath } = await files(PR_EVENT);
    const { deps, err } = harness({ GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: 'acme/shop' });

    expect(await runCli(['comment', '--file', reportPath], deps)).toBe(2);
    expect(err.join('')).toContain('GITHUB_EVENT_PATH is not set.');
  });

  it('exits 2 when the report file does not exist', async () => {
    const { eventPath } = await files(PR_EVENT);
    const { deps, err } = harness(env(eventPath));

    expect(await runCli(['comment', '--file', join(dir, 'missing.md')], deps)).toBe(2);
    expect(err.join('')).toContain('No report at');
  });

  it('exits 2 and keeps the token out of the message when the API refuses', async () => {
    const { eventPath, reportPath } = await files(PR_EVENT);
    const fetch: FetchLike = () =>
      Promise.resolve(Response.json({ message: `Bad credentials for ${TOKEN}` }, { status: 401 }));
    const { deps, err } = harness(env(eventPath), false, fetch);

    expect(await runCli(['comment', '--file', reportPath], deps)).toBe(2);
    expect(err.join('')).toContain('status 401');
    expect(err.join('')).not.toContain(TOKEN);
  });
});

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

  it('exits 2 and names the variable when a --pass-env name is not set', async () => {
    const env = {
      SANITY_STUDIO_PROJECT_ID: 'p',
      SANITY_STUDIO_DATASET: 'd',
      SANITY_AUTH_TOKEN: 's',
    };
    const { deps, err } = harness(env);
    expect(await runCli(['--studio', '.', '--pass-env', 'SANITY_STUDIO_ID'], deps)).toBe(2);
    expect(err.join('')).toBe('SANITY_STUDIO_ID is named in --pass-env but not set.\n');
  });

  it('exits 2 for a --pass-env name outside the Studio prefix, before anything runs', async () => {
    const env = {
      SANITY_STUDIO_PROJECT_ID: 'p',
      SANITY_STUDIO_DATASET: 'd',
      SANITY_AUTH_TOKEN: 's',
    };
    const { deps, err } = harness(env);
    expect(await runCli(['--studio', '.', '--pass-env', 'GITHUB_TOKEN'], deps)).toBe(2);
    expect(err.join('')).toContain('--pass-env only takes variable names');
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
