import { mkdtemp, readFile, rm, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import {
  addWorktree,
  currentRef,
  hasUncommittedChanges,
  removeWorktree,
  repoRoot,
  resolveSha,
} from './adapters/git.js';
import type { CommandRunner } from './adapters/process.js';
import type { SanityReader } from './adapters/sanity.js';
import { extractSchema } from './adapters/sanity-cli.js';
import type { Cleanup } from './cleanup.js';
import { normalise } from './diff/normalise.js';
import { diffSchemas } from './diff/classify.js';
import { measureImpact } from './impact/run.js';
import { evaluate, type FailRule } from './report/fail-on.js';
import { buildReport, type Report, type ValidationSection } from './report/model.js';
import { compareValidation, validateStudio } from './validation/run.js';

export interface PipelineOptions {
  /** Absolute path to the head Studio. It must sit inside the repository. */
  readonly studioDir: string;
  readonly base: string;
  readonly projectId: string;
  readonly dataset: string;
  readonly token: string;
  readonly failOn: readonly FailRule[];
  readonly skipValidation: boolean;
  readonly runner: CommandRunner;
  readonly reader: SanityReader;
  readonly cleanup: Cleanup;
  /** Where the base worktree and extracts go. Defaults to the system temp directory. */
  readonly scratchRoot?: string;
}

const SKIPPED_VALIDATION = 'Skipped with --skip-validation.';

/**
 * Compares the Studio at `base` with the working tree. The base is checked out into a temporary
 * worktree and its Studio gets a symlink to the head `node_modules`. Everything the run creates is
 * registered with `cleanup`, and the caller runs it.
 */
export async function runPipeline(options: PipelineOptions): Promise<Report> {
  const { runner, reader, cleanup, token } = options;
  const headStudio = options.studioDir;
  const git = { repoDir: headStudio, runner };

  const root = await repoRoot(git);
  const studioPath = relative(root, headStudio);
  if (studioPath === '' || studioPath.startsWith('..') || isAbsolute(studioPath)) {
    throw new Error('The Studio directory must be inside the repository.');
  }

  const current = await currentRef(git);
  const head = (await hasUncommittedChanges(git, '.'))
    ? { ...current, uncommitted: true }
    : current;
  const baseSha = await resolveSha(git, options.base);

  const scratch = await mkdtemp(join(options.scratchRoot ?? tmpdir(), 'schema-impact-'));
  cleanup.add(() => rm(scratch, { recursive: true, force: true }));

  const worktree = join(scratch, 'base');
  await addWorktree(git, baseSha, worktree);
  cleanup.add(() => removeWorktree(git, worktree));

  const baseStudio = join(worktree, studioPath);
  const headModules = join(headStudio, 'node_modules');
  const baseModules = join(baseStudio, 'node_modules');
  if (!(await exists(baseStudio))) {
    throw new Error(`No Studio at ${studioPath} in ${options.base}.`);
  }
  await symlink(headModules, baseModules, 'dir');
  cleanup.add(() => unlink(baseModules));

  const baseExtract = join(scratch, 'base-schema.json');
  const headExtract = join(scratch, 'head-schema.json');
  const target = { projectId: options.projectId, dataset: options.dataset, runner };
  await extractSchema({ ...target, studioDir: baseStudio, outputPath: baseExtract });
  await extractSchema({ ...target, studioDir: headStudio, outputPath: headExtract });
  const baseSchema = normalise(JSON.parse(await readFile(baseExtract, 'utf8')) as unknown);
  const headSchema = normalise(JSON.parse(await readFile(headExtract, 'utf8')) as unknown);
  const changes = diffSchemas(baseSchema, headSchema);

  const impact = await measureImpact(changes, reader);

  let validation: ValidationSection;
  if (options.skipValidation) {
    validation = { skipped: SKIPPED_VALIDATION };
  } else {
    const shared = {
      projectId: options.projectId,
      dataset: options.dataset,
      token,
      runner,
      reader,
    };
    const before = await validateStudio({ ...shared, studioDir: baseStudio });
    const after = await validateStudio({ ...shared, studioDir: headStudio });
    const comparison = compareValidation(before, after);
    validation = { introduced: comparison.groups, resolvedCount: comparison.resolved.length };
  }

  const report = buildReport({
    base: { ref: options.base, sha: baseSha },
    head,
    projectId: options.projectId,
    dataset: options.dataset,
    impact,
    validation,
  });
  return { ...report, failures: evaluate(report, options.failOn) };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
