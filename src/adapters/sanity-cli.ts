import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult, CommandRunner } from './process.js';
import { redact } from './process.js';
import type { MarkerLevel } from '../validation/markers.js';
import { dirsUpTo } from '../workspace.js';
import { isStudioVariable } from '../studio-env.js';

const EXTRACT_TIMEOUT_MS = 5 * 60_000;
const VALIDATE_TIMEOUT_MS = 10 * 60_000;
const STDERR_TAIL = 500;

/**
 * The `sanity` binary for a Studio. It's looked for in the Studio and then each parent up to the
 * repository root, because a workspace install puts it in the root's `node_modules`.
 */
export function sanityBinary(studioDir: string, repoRoot: string): string {
  for (const dir of dirsUpTo(studioDir, repoRoot)) {
    const binary = join(dir, 'node_modules', '.bin', 'sanity');
    if (existsSync(binary)) return binary;
  }
  throw new Error(
    `Sanity CLI not found for the Studio at ${studioDir}. Install the Studio's dependencies first.`,
  );
}

/**
 * Only PATH and HOME reach the child, plus the pass-env values and whatever the caller adds.
 * Nothing else is inherited. A pass-env name outside the Studio prefix is refused here too.
 */
function childEnv(
  passEnv: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  for (const name of Object.keys(passEnv)) {
    if (!isStudioVariable(name)) throw new Error(`${name} can't be passed to the Studio.`);
  }
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: process.env['HOME'] ?? '',
    ...passEnv,
    ...extra,
  };
}

function stderrTail(result: CommandResult, secrets: readonly string[]): string {
  return redact(result.stderr.trim().slice(-STDERR_TAIL), secrets);
}

export interface ExtractOptions {
  readonly studioDir: string;
  /** The checkout the Studio sits in. The binary is looked for up to here. */
  readonly repoRoot: string;
  readonly outputPath: string;
  readonly runner: CommandRunner;
  /** Studios read these at load time, so the resolved values are passed on. */
  readonly projectId: string;
  readonly dataset: string;
  /** `SANITY_STUDIO_*` variables from `--pass-env`. */
  readonly passEnv?: Readonly<Record<string, string>>;
}

/** Writes the Studio's schema to `outputPath`. Any non-zero exit is a failure here. */
export async function extractSchema(options: ExtractOptions): Promise<void> {
  const { studioDir, outputPath, runner, projectId, dataset } = options;
  const result = await runner({
    cmd: sanityBinary(studioDir, options.repoRoot),
    args: ['schema', 'extract', '--enforce-required-fields', '--path', outputPath],
    cwd: studioDir,
    env: childEnv(options.passEnv ?? {}, {
      SANITY_STUDIO_PROJECT_ID: projectId,
      SANITY_STUDIO_DATASET: dataset,
    }),
    timeoutMs: EXTRACT_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    throw new Error(
      `sanity schema extract exited with code ${String(result.code)}. ${stderrTail(result, [])}`,
    );
  }
}

export interface ValidationOptions {
  readonly studioDir: string;
  /** The checkout the Studio sits in. The binary is looked for up to here. */
  readonly repoRoot: string;
  readonly projectId: string;
  readonly dataset: string;
  readonly token: string;
  readonly level: MarkerLevel;
  readonly runner: CommandRunner;
  readonly timeoutMs?: number;
  /** `SANITY_STUDIO_*` variables from `--pass-env`. */
  readonly passEnv?: Readonly<Record<string, string>>;
}

/**
 * Runs `documents validate` in ndjson mode. Exit 0 and 1 are both results: 1 means errors were
 * found. The token goes in the environment only.
 */
export async function runValidation(options: ValidationOptions): Promise<CommandResult> {
  const { studioDir, projectId, dataset, token, level, runner } = options;
  const result = await runner({
    cmd: sanityBinary(studioDir, options.repoRoot),
    args: [
      'documents',
      'validate',
      '--project',
      projectId,
      '--dataset',
      dataset,
      '--format',
      'ndjson',
      '--level',
      level,
      '--yes',
    ],
    cwd: studioDir,
    env: childEnv(options.passEnv ?? {}, { SANITY_AUTH_TOKEN: token }),
    timeoutMs: options.timeoutMs ?? VALIDATE_TIMEOUT_MS,
    secrets: [token],
  });
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(
      `sanity documents validate exited with code ${String(result.code)}. ${stderrTail(result, [token])}`,
    );
  }
  return result;
}
