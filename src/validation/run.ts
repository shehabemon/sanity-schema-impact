import type { CommandRunner } from '../adapters/process.js';
import type { SanityReader } from '../adapters/sanity.js';
import { runValidation, sanityBinary } from '../adapters/sanity-cli.js';
import { diffMarkers, groupMarkers, type MarkerDiff, type MarkerGroup } from './diff.js';
import { parseValidationOutput, type Marker, type MarkerLevel } from './markers.js';

export interface ValidationRun {
  readonly level: MarkerLevel;
  /** Documents in the dataset, counted before the CLI ran. */
  readonly documentCount: number;
  readonly markers: Marker[];
}

export type { CommandRunner };

export interface ValidateStudioOptions {
  /** Studio directory. The `sanity` binary is looked for in it and its parents up to `repoRoot`. */
  readonly studioDir: string;
  readonly repoRoot: string;
  readonly projectId: string;
  readonly dataset: string;
  readonly token: string;
  readonly level?: MarkerLevel;
  readonly runner: CommandRunner;
  readonly reader: SanityReader;
  readonly timeoutMs?: number;
  /** `SANITY_STUDIO_*` variables from `--pass-env`. */
  readonly passEnv?: Readonly<Record<string, string>>;
}

export interface ValidationComparison extends MarkerDiff {
  /** Groups of the introduced markers only. */
  readonly groups: MarkerGroup[];
}

const DEFAULT_LEVEL: MarkerLevel = 'warning';

/** Counts documents the validation will see. System and Sanity-internal types are left out. */
const COUNT_QUERY =
  'count(*[!(_id in path("_.**")) && !(_type match "system.*") && !(_type match "sanity.*")])';

/**
 * Validates a Studio's dataset with the `sanity` binary from its `node_modules` or a parent's.
 * Custom validators in the Studio run in this process, with the token in its environment.
 */
export async function validateStudio(options: ValidateStudioOptions): Promise<ValidationRun> {
  const { studioDir, projectId, dataset, token, runner, reader } = options;
  const level = options.level ?? DEFAULT_LEVEL;

  sanityBinary(studioDir, options.repoRoot);

  const documentCount = await reader.fetch<unknown>(COUNT_QUERY, {});
  if (typeof documentCount !== 'number') {
    throw new Error('Unexpected response when counting documents.');
  }
  if (documentCount === 0) {
    throw new Error(`No documents found in dataset ${dataset}. Check the project and token.`);
  }

  const result = await runValidation({
    studioDir,
    repoRoot: options.repoRoot,
    projectId,
    dataset,
    token,
    level,
    runner,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.passEnv === undefined ? {} : { passEnv: options.passEnv }),
  });

  return { level, documentCount, markers: parseValidationOutput(result.stdout) };
}

/** Compares the base and head runs. Only the introduced markers are grouped for the report. */
export function compareValidation(base: ValidationRun, head: ValidationRun): ValidationComparison {
  const diff = diffMarkers(base.markers, head.markers);
  return { ...diff, groups: groupMarkers(diff.introduced) };
}
