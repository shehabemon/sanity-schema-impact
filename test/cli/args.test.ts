import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../../src/cli/args.js';

describe('parseCliArgs', () => {
  it('uses main as the base, the table format and the default rules when only the Studio is given', () => {
    const parsed = parseCliArgs(['--studio', './studio']);

    expect(parsed).toEqual({
      kind: 'run',
      options: {
        base: 'main',
        studio: './studio',
        format: 'table',
        failOn: ['data-loss', 'newly-required', 'validation-error'],
        skipValidation: false,
      },
    });
  });

  it('reads every flag', () => {
    const parsed = parseCliArgs([
      '--base',
      'release',
      '--studio',
      'apps/studio',
      '--format',
      'md',
      '--fail-on',
      'any',
      '--skip-validation',
      '--project',
      'abc123',
      '--dataset',
      'production',
    ]);

    expect(parsed).toEqual({
      kind: 'run',
      options: {
        base: 'release',
        studio: 'apps/studio',
        format: 'md',
        failOn: ['any'],
        skipValidation: true,
        project: 'abc123',
        dataset: 'production',
      },
    });
  });

  it('requires the Studio directory', () => {
    expect(() => parseCliArgs(['--base', 'main'])).toThrow('Missing --studio <dir>.');
  });

  it('refuses a format it does not know', () => {
    expect(() => parseCliArgs(['--studio', 'x', '--format', 'xml'])).toThrow(
      'Unknown --format "xml". Use table, md or json.',
    );
  });

  it('refuses an unknown flag', () => {
    expect(() => parseCliArgs(['--studio', 'x', '--verbose'])).toThrow(/verbose/);
  });

  it('passes a bad --fail-on value through with its message', () => {
    expect(() => parseCliArgs(['--studio', 'x', '--fail-on', 'breaking'])).toThrow(
      'Unknown --fail-on rule "breaking".',
    );
  });

  it('returns help and version without needing a Studio', () => {
    expect(parseCliArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseCliArgs(['--version'])).toEqual({ kind: 'version' });
  });
});
