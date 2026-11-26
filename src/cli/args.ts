import { parseArgs } from 'node:util';
import { parseFailOn, type FailRule } from '../report/fail-on.js';

export type OutputFormat = 'table' | 'md' | 'json';

export interface CliOptions {
  readonly base: string;
  /** As typed. The caller resolves it against the working directory. */
  readonly studio: string;
  readonly format: OutputFormat;
  readonly failOn: readonly FailRule[];
  readonly skipValidation: boolean;
  readonly project?: string;
  readonly dataset?: string;
}

export type ParsedArgs =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'run'; readonly options: CliOptions };

const FORMATS: readonly OutputFormat[] = ['table', 'md', 'json'];

function isFormat(value: string): value is OutputFormat {
  return (FORMATS as readonly string[]).includes(value);
}

export function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      base: { type: 'string' },
      studio: { type: 'string' },
      format: { type: 'string' },
      'fail-on': { type: 'string' },
      'skip-validation': { type: 'boolean' },
      project: { type: 'string' },
      dataset: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.help === true) return { kind: 'help' };
  if (values.version === true) return { kind: 'version' };

  if (values.studio === undefined) throw new Error('Missing --studio <dir>.');

  const format = values.format ?? 'table';
  if (!isFormat(format)) {
    throw new Error(`Unknown --format "${format}". Use table, md or json.`);
  }

  return {
    kind: 'run',
    options: {
      base: values.base ?? 'main',
      studio: values.studio,
      format,
      failOn: parseFailOn(values['fail-on']),
      skipValidation: values['skip-validation'] === true,
      ...(values.project === undefined ? {} : { project: values.project }),
      ...(values.dataset === undefined ? {} : { dataset: values.dataset }),
    },
  };
}
