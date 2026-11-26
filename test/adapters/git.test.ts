import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addWorktree,
  currentRef,
  hasUncommittedChanges,
  removeWorktree,
  resolveSha,
} from '../../src/adapters/git.js';
import { runCommand, type CommandRunner } from '../../src/adapters/process.js';

const runner: CommandRunner = runCommand;
let repo: string;
let headSha: string;
let scratch: string;

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

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'git-adapter-'));
  repo = join(scratch, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  await writeFile(join(repo, 'a.txt'), 'one\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'first']);
  headSha = git(['rev-parse', 'HEAD']);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('git adapter', () => {
  it('resolves a branch to its full commit SHA', async () => {
    expect(await resolveSha({ repoDir: repo, runner }, 'main')).toBe(headSha);
  });

  it('refuses a ref that does not exist', async () => {
    await expect(resolveSha({ repoDir: repo, runner }, 'no-such-branch')).rejects.toThrow(
      'Unknown git ref no-such-branch.',
    );
  });

  it('reports the current branch and the HEAD commit', async () => {
    expect(await currentRef({ repoDir: repo, runner })).toEqual({ ref: 'main', sha: headSha });
  });

  it('adds a detached worktree at the given commit and removes it again', async () => {
    const path = join(scratch, 'base-worktree');
    await addWorktree({ repoDir: repo, runner }, headSha, path);
    expect(existsSync(join(path, 'a.txt'))).toBe(true);

    await removeWorktree({ repoDir: repo, runner }, path);
    expect(existsSync(path)).toBe(false);
    expect(git(['worktree', 'list'])).not.toContain('base-worktree');
  });
});

describe('git adapter with a fake runner', () => {
  function scripted(outputs: Record<string, string>): { runner: CommandRunner; calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      runner: (options) => {
        calls.push([...options.args]);
        const key = options.args.join(' ');
        const stdout = outputs[key];
        return Promise.resolve({
          code: stdout === undefined ? 128 : 0,
          stdout: stdout ?? '',
          stderr: 'fatal',
        });
      },
    };
  }

  it('labels a detached HEAD with its short SHA', async () => {
    const sha = 'c'.repeat(40);
    const { runner } = scripted({
      'rev-parse --abbrev-ref HEAD': 'HEAD',
      'rev-parse HEAD': sha,
    });
    expect(await currentRef({ repoDir: repo, runner })).toEqual({ ref: 'ccccccc', sha });
  });

  it('reports uncommitted changes under the given path', async () => {
    const { runner, calls } = scripted({ 'status --porcelain -- .': ' M schemaTypes/post.ts' });
    expect(await hasUncommittedChanges({ repoDir: repo, runner }, '.')).toBe(true);
    expect(calls[0]).toEqual(['status', '--porcelain', '--', '.']);
  });

  it('reports a clean path as having no uncommitted changes', async () => {
    const { runner } = scripted({ 'status --porcelain -- .': '' });
    expect(await hasUncommittedChanges({ repoDir: repo, runner }, '.')).toBe(false);
  });
});
