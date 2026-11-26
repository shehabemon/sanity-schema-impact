import type { CommandResult, CommandRunner } from './process.js';

export interface GitContext {
  /** Any directory inside the repository. */
  readonly repoDir: string;
  readonly runner: CommandRunner;
}

export interface RefInfo {
  readonly ref: string;
  readonly sha: string;
}

const GIT_TIMEOUT_MS = 60_000;

function env(): Record<string, string> {
  return { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' };
}

async function raw(ctx: GitContext, args: readonly string[]): Promise<CommandResult> {
  return ctx.runner({
    cmd: 'git',
    args,
    cwd: ctx.repoDir,
    env: env(),
    timeoutMs: GIT_TIMEOUT_MS,
  });
}

async function git(ctx: GitContext, args: readonly string[]): Promise<string> {
  const result = await raw(ctx, args);
  if (result.code !== 0) {
    throw new Error(`git ${String(args[0])} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function repoRoot(ctx: GitContext): Promise<string> {
  return git(ctx, ['rev-parse', '--show-toplevel']);
}

/** The branch name, or the short SHA when detached, with the commit it points at. */
export async function currentRef(ctx: GitContext): Promise<RefInfo> {
  const branch = await git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const sha = await git(ctx, ['rev-parse', 'HEAD']);
  return { ref: branch === 'HEAD' ? sha.slice(0, 7) : branch, sha };
}

/** True when anything under `pathspec` has uncommitted changes. */
export async function hasUncommittedChanges(ctx: GitContext, pathspec: string): Promise<boolean> {
  const status = await git(ctx, ['status', '--porcelain', '--', pathspec]);
  return status !== '';
}

export async function resolveSha(ctx: GitContext, ref: string): Promise<string> {
  const result = await raw(ctx, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (result.code !== 0) throw new Error(`Unknown git ref ${ref}.`);
  return result.stdout.trim();
}

/** Checks out a commit into a detached worktree. The path must not exist yet. */
export async function addWorktree(ctx: GitContext, sha: string, path: string): Promise<void> {
  await git(ctx, ['worktree', 'add', '--detach', path, sha]);
}

export async function removeWorktree(ctx: GitContext, path: string): Promise<void> {
  await git(ctx, ['worktree', 'remove', '--force', path]);
  await git(ctx, ['worktree', 'prune']);
}
