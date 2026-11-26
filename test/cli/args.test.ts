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

  it('reads the names and the head commit the report should show', () => {
    const parsed = parseCliArgs([
      '--studio',
      'studio',
      '--base',
      'origin/main',
      '--base-name',
      'main',
      '--head-name',
      'schema/title-limit',
      '--head-sha',
      'd'.repeat(40),
    ]);

    expect(parsed).toMatchObject({
      kind: 'run',
      options: {
        base: 'origin/main',
        baseName: 'main',
        headName: 'schema/title-limit',
        headSha: 'd'.repeat(40),
      },
    });
  });

  it('leaves the display names unset when the flags are not given', () => {
    const parsed = parseCliArgs(['--studio', './studio']);

    expect(parsed.kind === 'run' && 'headSha' in parsed.options).toBe(false);
    expect(parsed.kind === 'run' && 'baseName' in parsed.options).toBe(false);
  });

  it('refuses an empty display name', () => {
    expect(() => parseCliArgs(['--studio', 'x', '--head-name', ' '])).toThrow(
      '--head-name needs a name.',
    );
  });

  it('refuses a head commit that is not a full SHA', () => {
    expect(() => parseCliArgs(['--studio', 'x', '--head-sha', 'abc1234'])).toThrow(
      '--head-sha needs a full commit SHA.',
    );
  });

  it('leaves migration scaffolds off unless asked for', () => {
    const parsed = parseCliArgs(['--studio', './studio']);

    expect(parsed.kind === 'run' && 'migrations' in parsed.options).toBe(false);
  });

  it('writes scaffolds to the Studio when --migrations is given without a directory', () => {
    const parsed = parseCliArgs(['--studio', './studio', '--migrations']);

    expect(parsed).toMatchObject({ kind: 'run', options: { migrations: {} } });
  });

  it('writes scaffolds to the directory given with --migrations-dir', () => {
    const parsed = parseCliArgs(['--studio', './studio', '--migrations-dir', 'out/migrations']);

    expect(parsed).toMatchObject({
      kind: 'run',
      options: { migrations: { dir: 'out/migrations' } },
    });
  });

  it('refuses an empty --migrations-dir', () => {
    expect(() => parseCliArgs(['--studio', './studio', '--migrations-dir', ''])).toThrow(
      '--migrations-dir needs a directory.',
    );
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

  it('reads the report file for the comment subcommand', () => {
    expect(parseCliArgs(['comment', '--file', 'schema-impact.md'])).toEqual({
      kind: 'comment',
      file: 'schema-impact.md',
    });
  });

  it('requires the report file for the comment subcommand', () => {
    expect(() => parseCliArgs(['comment'])).toThrow('Missing --file <report.md>.');
  });

  it('keeps the run flags out of the comment subcommand', () => {
    expect(() => parseCliArgs(['comment', '--file', 'r.md', '--studio', 'x'])).toThrow(/studio/);
  });

  it('shows help for the comment subcommand', () => {
    expect(parseCliArgs(['comment', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('parseCliArgs --pass-env', () => {
  it('reads the names into the options', () => {
    const parsed = parseCliArgs(['--studio', 'apps/sanity', '--pass-env', 'SANITY_STUDIO_ID']);

    expect(parsed).toMatchObject({ kind: 'run', options: { passEnv: ['SANITY_STUDIO_ID'] } });
  });

  it('leaves passEnv out when the flag is not given', () => {
    const parsed = parseCliArgs(['--studio', 'apps/sanity']);

    expect(parsed).toMatchObject({ kind: 'run' });
    expect(parsed.kind === 'run' && 'passEnv' in parsed.options).toBe(false);
  });

  it('refuses a name outside the SANITY_STUDIO_ prefix', () => {
    expect(() =>
      parseCliArgs(['--studio', 'apps/sanity', '--pass-env', 'SANITY_AUTH_TOKEN']),
    ).toThrow('--pass-env only takes variable names that start with SANITY_STUDIO_');
  });
});
