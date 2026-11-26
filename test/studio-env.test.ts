import { describe, expect, it } from 'vitest';
import { isStudioVariable, parsePassEnv, resolvePassEnv } from '../src/studio-env.js';

describe('parsePassEnv', () => {
  it('returns no names when the flag is unset or empty', () => {
    expect(parsePassEnv(undefined)).toEqual([]);
    expect(parsePassEnv('')).toEqual([]);
    expect(parsePassEnv(' , ')).toEqual([]);
  });

  it('splits a comma-separated list and trims each name', () => {
    expect(parsePassEnv('SANITY_STUDIO_ID, SANITY_STUDIO_REGION')).toEqual([
      'SANITY_STUDIO_ID',
      'SANITY_STUDIO_REGION',
    ]);
  });

  it('accepts only names with the SANITY_STUDIO_ prefix', () => {
    expect(() => parsePassEnv('SANITY_STUDIO_ID,SANITY_AUTH_TOKEN')).toThrow(
      '--pass-env only takes variable names that start with SANITY_STUDIO_, such as SANITY_STUDIO_ID.',
    );
  });

  it('keeps the rejected value out of the message', () => {
    let message = '';
    try {
      parsePassEnv('sk-live-123');
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).not.toBe('');
    expect(message).not.toContain('sk-live-123');
  });

  it('drops a repeated name', () => {
    expect(parsePassEnv('SANITY_STUDIO_ID,SANITY_STUDIO_ID')).toEqual(['SANITY_STUDIO_ID']);
  });

  it('refuses the GitHub token and other unrelated names', () => {
    expect(() => parsePassEnv('GITHUB_TOKEN')).toThrow('start with SANITY_STUDIO_');
    expect(() => parsePassEnv('SANITY_STUDIO_')).toThrow('start with SANITY_STUDIO_');
  });

  it('refuses a name that is not a plain environment variable name', () => {
    expect(() => parsePassEnv('SANITY_STUDIO_ID=x')).toThrow('start with SANITY_STUDIO_');
  });
});

describe('isStudioVariable', () => {
  it('is true only for names in the SANITY_STUDIO_ family', () => {
    expect(isStudioVariable('SANITY_STUDIO_DATASET')).toBe(true);
    expect(isStudioVariable('SANITY_AUTH_TOKEN')).toBe(false);
    expect(isStudioVariable('sanity_studio_id')).toBe(false);
  });
});

describe('resolvePassEnv', () => {
  it('copies the named values from the environment', () => {
    expect(
      resolvePassEnv(['SANITY_STUDIO_ID'], {
        SANITY_STUDIO_ID: 'abc',
        SANITY_AUTH_TOKEN: 'secret',
      }),
    ).toEqual({ SANITY_STUDIO_ID: 'abc' });
  });

  it('names a variable that is missing, so the cause is clear', () => {
    expect(() => resolvePassEnv(['SANITY_STUDIO_ID'], {})).toThrow(
      'SANITY_STUDIO_ID is named in --pass-env but not set.',
    );
  });
});
