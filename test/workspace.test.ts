import { describe, expect, it } from 'vitest';
import { dirsUpTo, isDotEnvFile } from '../src/workspace.js';

describe('dirsUpTo', () => {
  it('lists the Studio, its parents and the repository root, nearest first', () => {
    expect(dirsUpTo('/repo/apps/sanity', '/repo')).toEqual([
      '/repo/apps/sanity',
      '/repo/apps',
      '/repo',
    ]);
  });

  it('returns only the root when the Studio is the root', () => {
    expect(dirsUpTo('/repo', '/repo')).toEqual(['/repo']);
  });

  it('refuses a directory outside the repository', () => {
    expect(() => dirsUpTo('/elsewhere/studio', '/repo')).toThrow(
      'The Studio directory must be inside the repository.',
    );
  });

  it('does not treat a sibling whose name starts with two dots as outside', () => {
    expect(dirsUpTo('/repo/..cache/studio', '/repo')).toEqual([
      '/repo/..cache/studio',
      '/repo/..cache',
      '/repo',
    ]);
  });
});

describe('isDotEnvFile', () => {
  it.each(['.env', '.env.local', '.env.production'])('matches %s', (name) => {
    expect(isDotEnvFile(name)).toBe(true);
  });

  it.each(['env', '.envrc', '.env.', 'app.env', '.environment', 'sanity.config.ts'])(
    'does not match %s',
    (name) => {
      expect(isDotEnvFile(name)).toBe(false);
    },
  );
});
