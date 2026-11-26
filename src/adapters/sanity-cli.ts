import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult, CommandRunner } from './process.js';
import { redact } from './process.js';
import type { MarkerLevel } from '../validation/markers.js';

const EXTRACT_TIMEOUT_MS = 5 * 60_000;
const VALIDATE_TIMEOUT_MS = 10 * 60_000;
const STDERR_TAIL = 500;

/** The Studio's own `sanity` binary. A missing one means `pnpm install` was never run there. */
export function sanityBinary(studioDir: string): string {
  const binary = join(studioDir, 'node_modules', '.bin', 'sanity');
  if (!existsSync(binary)) {
    throw new Error(
      `Sanity CLI not found at ${binary}. Run pnpm install in the Studio directory first.`,
    );
  }
  return binary;
}

/** Only PATH and HOME reach the child, plus whatever the caller adds. Nothing is inherited. */
function childEnv(extra: Record<string, string>): Record<string, string> {
  return { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ...extra };
}

function stderrTail(result: CommandResult, secrets: readonly string[]): string {
  return redact(result.stderr.trim().slice(-STDERR_TAIL), secrets);
}

export interface ExtractOptions {
  readonly studioDir: string;
  readonly outputPath: string;
  readonly runner: CommandRunner;
  /** Studios read these at load time, so the resolved values are passed on. */
  readonly projectId: string;
  readonly dataset: string;
}

/** Writes the Studio's schema to `outputPath`. Any non-zero exit is a failure here. */
export async function extractSchema(options: ExtractOptions): Promise<void> {
  const { studioDir, outputPath, runner, projectId, dataset } = options;
  const result = await runner({
    cmd: sanityBinary(studioDir),
    args: ['schema', 'extract', '--enforce-required-fields', '--path', outputPath],
    cwd: studioDir,
    env: childEnv({ SANITY_STUDIO_PROJECT_ID: projectId, SANITY_STUDIO_DATASET: dataset }),
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
  readonly projectId: string;
  readonly dataset: string;
  readonly token: string;
  readonly level: MarkerLevel;
  readonly runner: CommandRunner;
  readonly timeoutMs?: number;
}

/**
 * Runs `documents validate` in ndjson mode. Exit 0 and 1 are both results: 1 means errors were
 * found. The token goes in the environment only.
 */
export async function runValidation(options: ValidationOptions): Promise<CommandResult> {
  const { studioDir, projectId, dataset, token, level, runner } = options;
  const result = await runner({
    cmd: sanityBinary(studioDir),
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
    env: childEnv({ SANITY_AUTH_TOKEN: token }),
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
