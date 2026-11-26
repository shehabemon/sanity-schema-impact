import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { redact, runCommand, type CommandRunner } from '../adapters/process.js';
import {
  createSanityReader,
  type SanityReader,
  type SanityReaderOptions,
} from '../adapters/sanity.js';
import { cleanOnSignal, createCleanup, type SignalSource } from '../cleanup.js';
import { runPipeline } from '../pipeline.js';
import { toJson } from '../report/json.js';
import { toMarkdown } from '../report/markdown.js';
import type { Report } from '../report/model.js';
import { toTable } from '../report/table.js';
import { VERSION } from '../version.js';
import { parseCliArgs, type OutputFormat, type ParsedArgs } from './args.js';

const API_VERSION = '2025-02-19';

export interface RunDeps {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { write(text: string): unknown; readonly isTTY?: boolean };
  readonly stderr: { write(text: string): unknown };
  readonly runner: CommandRunner;
  readonly createReader: (options: SanityReaderOptions) => SanityReader;
  readonly signals: SignalSource;
}

export function defaultDeps(): RunDeps {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    runner: runCommand,
    createReader: createSanityReader,
    signals: process,
  };
}

const USAGE = `sanity-schema-impact ${VERSION}

Usage: sanity-schema-impact --studio <dir> [options]

Options:
  --studio <dir>        Studio directory in this repository (required)
  --base <ref>          Git ref to compare with (default: main)
  --format <format>     table, md or json (default: table)
  --fail-on <rules>     Comma-separated rules that make the exit code 1 (default: data-loss,newly-required,validation-error)
  --skip-validation     Skip the validation diff
  --project <id>        Sanity project ID (default: SANITY_STUDIO_PROJECT_ID)
  --dataset <name>      Dataset name (default: SANITY_STUDIO_DATASET)
  -h, --help            Show this help
  -v, --version         Show the version

Environment:
  SANITY_AUTH_TOKEN     Viewer token. Required.
  NO_COLOR              Turns colour off in the table output.
`;

/** Colour is for a terminal, and NO_COLOR (any non-empty value) turns it off. */
export function colourEnabled(
  env: Readonly<Record<string, string | undefined>>,
  isTTY: boolean,
): boolean {
  return isTTY && (env['NO_COLOR'] ?? '') === '';
}

/** Runs the CLI and returns the exit code: 0 clean, 1 a rule failed, 2 usage or runtime error. */
export async function runCli(argv: readonly string[], deps: RunDeps): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    deps.stderr.write(`${errorText(error)}\n`);
    return 2;
  }
  if (parsed.kind === 'help') {
    deps.stdout.write(USAGE);
    return 0;
  }
  if (parsed.kind === 'version') {
    deps.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const { options } = parsed;
  const projectId = options.project ?? deps.env['SANITY_STUDIO_PROJECT_ID'] ?? '';
  const dataset = options.dataset ?? deps.env['SANITY_STUDIO_DATASET'] ?? '';
  const token = deps.env['SANITY_AUTH_TOKEN'] ?? '';
  if (projectId.trim() === '') {
    deps.stderr.write('Set --project or SANITY_STUDIO_PROJECT_ID.\n');
    return 2;
  }
  if (dataset.trim() === '') {
    deps.stderr.write('Set --dataset or SANITY_STUDIO_DATASET.\n');
    return 2;
  }
  if (token.trim() === '') {
    deps.stderr.write('SANITY_AUTH_TOKEN is not set. Use a Viewer token.\n');
    return 2;
  }

  let studioDir: string;
  try {
    studioDir = await realpath(resolve(deps.cwd, options.studio));
  } catch {
    deps.stderr.write(`No Studio directory at ${options.studio}.\n`);
    return 2;
  }

  const cleanup = createCleanup();
  cleanOnSignal(cleanup, deps.signals);
  try {
    const report = await runPipeline({
      studioDir,
      base: options.base,
      projectId,
      dataset,
      token,
      failOn: options.failOn,
      skipValidation: options.skipValidation,
      runner: deps.runner,
      reader: deps.createReader({ projectId, dataset, token, apiVersion: API_VERSION }),
      cleanup,
    });
    deps.stdout.write(render(report, options.format, deps));
    return report.failures.length > 0 ? 1 : 0;
  } catch (error) {
    deps.stderr.write(`${redact(errorText(error), [token])}\n`);
    return 2;
  } finally {
    for (const failure of await cleanup.run()) {
      deps.stderr.write(`Cleanup failed: ${redact(failure, [token])}\n`);
    }
  }
}

function render(report: Report, format: OutputFormat, deps: RunDeps): string {
  switch (format) {
    case 'json':
      return toJson(report);
    case 'md':
      return toMarkdown(report);
    case 'table':
      return toTable(report, { colour: colourEnabled(deps.env, deps.stdout.isTTY ?? false) });
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}
