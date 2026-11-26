import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
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
import { fileNames, linkIfAbsent, pathExists } from './adapters/fs.js';
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
import { dirsUpTo, isDotEnvFile } from './workspace.js';

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
  /** Labels for the report. They don't change what is checked out or compared. */
  readonly display?: DisplayNames;
  /** `SANITY_STUDIO_*` variables handed to both Sanity child processes. */
  readonly passEnv?: Readonly<Record<string, string>>;
}

export interface DisplayNames {
  readonly base?: string;
  readonly head?: string;
  readonly headSha?: string;
}

const SKIPPED_VALIDATION = 'Skipped with --skip-validation.';

/**
 * Compares the Studio at `base` with the working tree. The base is checked out into a temporary
 * worktree, and the untracked files the head has (`node_modules` and `.env` files) are linked into
 * it. Everything the run creates is registered with `cleanup`, and the caller runs it.
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
  const checkedOut = (await hasUncommittedChanges(git, '.'))
    ? { ...current, uncommitted: true }
    : current;
  const head = {
    ...checkedOut,
    ref: options.display?.head ?? checkedOut.ref,
    sha: options.display?.headSha ?? checkedOut.sha,
  };
  const baseSha = await resolveSha(git, options.base);

  const scratch = await mkdtemp(join(options.scratchRoot ?? tmpdir(), 'schema-impact-'));
  cleanup.add(() => rm(scratch, { recursive: true, force: true }));

  const worktree = join(scratch, 'base');
  await addWorktree(git, baseSha, worktree);
  cleanup.add(() => removeWorktree(git, worktree));

  const baseStudio = join(worktree, studioPath);
  if (!(await pathExists(baseStudio))) {
    throw new Error(`No Studio at ${studioPath} in ${options.base}.`);
  }
  await linkUntracked({ headStudio, root, worktree, cleanup });

  const baseExtract = join(scratch, 'base-schema.json');
  const headExtract = join(scratch, 'head-schema.json');
  const passEnv = options.passEnv ?? {};
  const target = { projectId: options.projectId, dataset: options.dataset, runner, passEnv };
  await extractSchema({
    ...target,
    studioDir: baseStudio,
    repoRoot: worktree,
    outputPath: baseExtract,
  });
  await extractSchema({
    ...target,
    studioDir: headStudio,
    repoRoot: root,
    outputPath: headExtract,
  });
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
      passEnv,
    };
    const before = await validateStudio({ ...shared, studioDir: baseStudio, repoRoot: worktree });
    const after = await validateStudio({ ...shared, studioDir: headStudio, repoRoot: root });
    const comparison = compareValidation(before, after);
    validation = { introduced: comparison.groups, resolvedCount: comparison.resolved.length };
  }

  const report = buildReport({
    base: { ref: options.display?.base ?? options.base, sha: baseSha },
    head,
    projectId: options.projectId,
    dataset: options.dataset,
    impact,
    validation,
  });
  return { ...report, failures: evaluate(report, options.failOn) };
}

interface LinkOptions {
  readonly headStudio: string;
  /** Root of the head checkout. Parents of the Studio are searched up to here. */
  readonly root: string;
  readonly worktree: string;
  readonly cleanup: Cleanup;
}

/**
 * Links what the head has outside git into the base checkout, and skips anything the base has.
 * That's `node_modules` in the Studio or a parent folder, and the Studio's `.env` files, which the
 * Sanity CLI reads when it loads the Studio. Each link is removed by `cleanup`.
 */
async function linkUntracked(options: LinkOptions): Promise<void> {
  const { headStudio, root, worktree, cleanup } = options;
  for (const headDir of dirsUpTo(headStudio, root)) {
    const headModules = join(headDir, 'node_modules');
    if (!(await pathExists(headModules))) continue;
    const baseModules = join(worktree, relative(root, headDir), 'node_modules');
    if (await linkIfAbsent(headModules, baseModules, 'dir')) {
      cleanup.add(() => unlink(baseModules));
    }
  }

  const baseStudio = join(worktree, relative(root, headStudio));
  for (const name of (await fileNames(headStudio)).filter(isDotEnvFile)) {
    const basePath = join(baseStudio, name);
    if (await linkIfAbsent(join(headStudio, name), basePath, 'file')) {
      cleanup.add(() => unlink(basePath));
    }
  }
}
