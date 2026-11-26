import { execFileSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommand, type CommandOptions, type CommandResult } from '../src/adapters/process.js';
import type { SanityReader } from '../src/adapters/sanity.js';
import { createCleanup } from '../src/cleanup.js';
import { runPipeline } from '../src/pipeline.js';

/**
 * A npm-workspaces layout: the Sanity binary and the shared modules sit at the repository root,
 * and the Studio is a package below it with its own `.env` files that git ignores.
 */

const fixtures = new URL('./fixtures/schemas/removed-field/', import.meta.url);
const token = 'viewer-token-for-test';

let scratch: string;
let repo: string;
let headStudio: string;

interface Call {
  readonly cmd: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly binaryExists: boolean;
  readonly envFiles: string[];
}

function git(args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd: repo, encoding: 'utf8' },
  ).trim();
}

function recordingCli(calls: Call[]): (options: CommandOptions) => Promise<CommandResult> {
  return async (options) => {
    if (options.cmd === 'git') return runCommand(options);
    if (options.args[0] === 'schema') {
      const envFiles = (await readdirSafe(options.cwd)).filter((name) => name.startsWith('.env'));
      calls.push({
        cmd: options.cmd,
        cwd: options.cwd,
        env: options.env,
        binaryExists: await exists(options.cmd),
        envFiles,
      });
      const out = options.args[options.args.indexOf('--path') + 1] ?? '';
      const source = options.cwd === headStudio ? 'after.json' : 'before.json';
      await copyFile(new URL(source, fixtures), out);
    }
    if (options.args[0] === 'documents') {
      calls.push({
        cmd: options.cmd,
        cwd: options.cwd,
        env: options.env,
        binaryExists: await exists(options.cmd),
        envFiles: [],
      });
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

const reader: SanityReader = {
  fetch: <T>(query: string): Promise<T> => {
    if (query.startsWith('count(')) return Promise.resolve(1 as T);
    const ids = [...query.matchAll(/"(\d+)": \{/g)].map((match) => match[1] ?? '');
    return Promise.resolve(
      Object.fromEntries(
        ids.map((id) => [id, { published: 1, drafts: 0, versions: 0, sample: [] }]),
      ) as T,
    );
  },
};

beforeAll(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'workspace-')));
  repo = join(scratch, 'repo');
  headStudio = join(repo, 'apps', 'sanity');
  await mkdir(headStudio, { recursive: true });
  await mkdir(join(repo, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(repo, 'node_modules', '.bin', 'sanity'), '');
  await writeFile(join(headStudio, 'sanity.config.ts'), 'export default {};\n');
  await writeFile(join(headStudio, '.env.example'), 'SANITY_STUDIO_ID=\n');
  await writeFile(join(headStudio, '.env'), 'SANITY_STUDIO_ID=abc\n');
  await writeFile(join(headStudio, '.env.local'), 'SANITY_STUDIO_DATASET=fixture\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules\n.env\n.env.local\n');
  git(['init', '-q', '-b', 'main', repo]);
  git(['add', '.gitignore', 'apps/sanity/sanity.config.ts', 'apps/sanity/.env.example']);
  git(['commit', '-q', '-m', 'studio']);
  git(['update-ref', 'refs/remotes/origin/main', 'main']);
  headStudio = await realpath(headStudio);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('runPipeline in a workspace layout', () => {
  it('runs the extract from the root binary in both checkouts and links the head env files', async () => {
    const calls: Call[] = [];
    const scratchRoot = join(scratch, 'run-a');
    await mkdir(scratchRoot);
    const cleanup = createCleanup();

    const report = await runPipeline({
      studioDir: headStudio,
      base: 'main',
      projectId: 'proj1',
      dataset: 'fixture',
      token,
      failOn: [],
      skipValidation: true,
      runner: recordingCli(calls),
      reader,
      cleanup,
      scratchRoot,
    });
    expect(report.changes.map((result) => result.change.kind)).toEqual(['removed-field']);

    const [baseExtract, headExtract] = calls;
    expect(baseExtract?.cwd).not.toBe(headStudio);
    expect(baseExtract?.binaryExists).toBe(true);
    expect(baseExtract?.envFiles).toEqual(['.env', '.env.example', '.env.local']);
    expect(headExtract?.binaryExists).toBe(true);

    await cleanup.run();
    expect(git(['worktree', 'list']).split('\n')).toHaveLength(1);
    expect(await readFile(join(headStudio, '.env'), 'utf8')).toBe('SANITY_STUDIO_ID=abc\n');
    expect(await readdirSafe(scratchRoot)).toEqual([]);
  });

  it('keeps a file the base already has, and removes only the links it created', async () => {
    const calls: Call[] = [];
    const scratchRoot = join(scratch, 'run-b');
    await mkdir(scratchRoot);
    const cleanup = createCleanup();

    await runPipeline({
      studioDir: headStudio,
      base: 'main',
      projectId: 'proj1',
      dataset: 'fixture',
      token,
      failOn: [],
      skipValidation: true,
      runner: recordingCli(calls),
      reader,
      cleanup,
      scratchRoot,
    });
    await cleanup.run();

    const base = calls[0];
    expect(base?.envFiles.filter((name) => name === '.env.example')).toHaveLength(1);
    expect(await readFile(join(headStudio, '.env.example'), 'utf8')).toBe('SANITY_STUDIO_ID=\n');
    expect(await readdirSafe(scratchRoot)).toEqual([]);
  });

  it('passes the pass-env values to the extract and validate children with the token', async () => {
    const calls: Call[] = [];
    const scratchRoot = join(scratch, 'run-c');
    await mkdir(scratchRoot);
    const cleanup = createCleanup();

    await runPipeline({
      studioDir: headStudio,
      base: 'main',
      projectId: 'proj1',
      dataset: 'fixture',
      token,
      failOn: [],
      skipValidation: false,
      passEnv: { SANITY_STUDIO_ID: 'abc' },
      runner: recordingCli(calls),
      reader,
      cleanup,
      scratchRoot,
    });
    await cleanup.run();

    const extracts = calls.filter((call) => call.env['SANITY_STUDIO_PROJECT_ID'] !== undefined);
    expect(extracts.every((call) => call.env['SANITY_STUDIO_ID'] === 'abc')).toBe(true);
    const validates = calls.filter((call) => call.env['SANITY_AUTH_TOKEN'] !== undefined);
    expect(validates).toHaveLength(2);
    expect(validates.every((call) => call.env['SANITY_STUDIO_ID'] === 'abc')).toBe(true);
  });
});
