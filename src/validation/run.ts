import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { redact, type CommandOptions, type CommandResult } from '../adapters/process.js';
import type { SanityReader } from '../adapters/sanity.js';
import { diffMarkers, groupMarkers, type MarkerDiff, type MarkerGroup } from './diff.js';
import { parseValidationOutput, type Marker, type MarkerLevel } from './markers.js';

export type CommandRunner = (options: CommandOptions) => Promise<CommandResult>;

export interface ValidationRun {
  readonly level: MarkerLevel;
  /** Documents in the dataset, counted before the CLI ran. */
  readonly documentCount: number;
  readonly markers: Marker[];
}

export interface ValidateStudioOptions {
  /** Studio directory with its own `node_modules` (the `sanity` binary is taken from there). */
  readonly studioDir: string;
  readonly projectId: string;
  readonly dataset: string;
  readonly token: string;
  readonly level?: MarkerLevel;
  readonly runner: CommandRunner;
  readonly reader: SanityReader;
  readonly timeoutMs?: number;
}

export interface ValidationComparison extends MarkerDiff {
  /** Groups of the introduced markers only. */
  readonly groups: MarkerGroup[];
}

const DEFAULT_LEVEL: MarkerLevel = 'warning';
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** The CLI exits 1 when it finds errors. That's a result, not a failure. */
const RESULT_EXIT_CODES: readonly number[] = [0, 1];
const STDERR_TAIL = 500;

/** Counts documents the validation will see. System and Sanity-internal types are left out. */
const COUNT_QUERY =
  'count(*[!(_id in path("_.**")) && !(_type match "system.*") && !(_type match "sanity.*")])';

/**
 * Validates a Studio's dataset with the `sanity` binary from the Studio's own `node_modules`.
 * Custom validators in the Studio run in this process, with the token in its environment.
 */
export async function validateStudio(options: ValidateStudioOptions): Promise<ValidationRun> {
  const { studioDir, projectId, dataset, token, runner, reader } = options;
  const level = options.level ?? DEFAULT_LEVEL;
  const binary = join(studioDir, 'node_modules', '.bin', 'sanity');

  if (!existsSync(binary)) {
    throw new Error(
      `Sanity CLI not found at ${binary}. Run pnpm install in the Studio directory first.`,
    );
  }

  const documentCount = await reader.fetch<unknown>(COUNT_QUERY, {});
  if (typeof documentCount !== 'number') {
    throw new Error('Unexpected response when counting documents.');
  }
  if (documentCount === 0) {
    throw new Error(`No documents found in dataset ${dataset}. Check the project and token.`);
  }

  const result = await runner({
    cmd: binary,
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
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
      SANITY_AUTH_TOKEN: token,
    },
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    secrets: [token],
  });

  if (!RESULT_EXIT_CODES.includes(result.code)) {
    const tail = redact(result.stderr.trim().slice(-STDERR_TAIL), [token]);
    throw new Error(`sanity documents validate exited with code ${String(result.code)}. ${tail}`);
  }

  return { level, documentCount, markers: parseValidationOutput(result.stdout) };
}

/** Compares the base and head runs. Only the introduced markers are grouped for the report. */
export function compareValidation(base: ValidationRun, head: ValidationRun): ValidationComparison {
  const diff = diffMarkers(base.markers, head.markers);
  return { ...diff, groups: groupMarkers(diff.introduced) };
}
