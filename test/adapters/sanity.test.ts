import { describe, expect, it } from 'vitest';
import { createSanityReader, redact } from '../../src/adapters/sanity.js';

const options = {
  projectId: 'abc123',
  dataset: 'fixture-dev',
  token: 'token-value',
  apiVersion: '2025-02-19',
};

describe('redact', () => {
  it('replaces every occurrence of the secret in a message', () => {
    expect(redact('bad token sk-123 used with sk-123', 'sk-123')).toBe(
      'bad token [redacted] used with [redacted]',
    );
  });

  it('leaves the message alone when there is no secret', () => {
    expect(redact('Unauthorized', '')).toBe('Unauthorized');
  });
});

describe('createSanityReader', () => {
  it.each(['projectId', 'dataset', 'token', 'apiVersion'] as const)(
    'refuses a blank %s without echoing any value',
    (key) => {
      expect(() => createSanityReader({ ...options, [key]: '   ' })).toThrow(
        `Missing Sanity option: ${key}.`,
      );
    },
  );
});
