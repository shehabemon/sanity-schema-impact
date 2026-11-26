import { createClient } from '@sanity/client';
import { redact as redactSecrets } from './process.js';

/** The only read the impact step needs. Tests pass a fake that implements this. */
export interface SanityReader {
  fetch<T>(query: string, params: Record<string, unknown>): Promise<T>;
}

export interface SanityReaderOptions {
  readonly projectId: string;
  readonly dataset: string;
  readonly token: string;
  readonly apiVersion: string;
}

/** Removes every occurrence of a secret from a message. */
export function redact(message: string, secret: string): string {
  return redactSecrets(message, [secret]);
}

/**
 * Reads from a dataset with the raw perspective, so drafts and release versions are included.
 * Error messages are passed through `redact`, and the token is never part of an error.
 */
export function createSanityReader(options: SanityReaderOptions): SanityReader {
  for (const key of ['projectId', 'dataset', 'token', 'apiVersion'] as const) {
    if (options[key].trim() === '') throw new Error(`Missing Sanity option: ${key}.`);
  }
  const { projectId, dataset, token, apiVersion } = options;
  const client = createClient({
    projectId,
    dataset,
    token,
    apiVersion,
    perspective: 'raw',
    useCdn: false,
  });

  return {
    async fetch<T>(query: string, params: Record<string, unknown>): Promise<T> {
      try {
        return await client.fetch<T>(query, params);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        throw new Error(`Sanity query failed: ${redact(message, token)}`);
      }
    },
  };
}
