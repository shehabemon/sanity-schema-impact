import type { SanityReader } from '../adapters/sanity.js';
import type { Change } from '../diff/types.js';
import { buildBatchQueries, type BatchItem } from './batch.js';
import { buildImpactQuery, type ImpactQuery } from './query-builder.js';

export interface ImpactCounted {
  readonly change: Change;
  readonly published: number;
  readonly drafts: number;
  readonly versions: number;
  /** Up to five document IDs, lowest first. */
  readonly sample: readonly string[];
}

export interface ImpactSkipped {
  readonly change: Change;
  readonly skipped: string;
}

export type ImpactResult = ImpactCounted | ImpactSkipped;

export interface MeasureOptions {
  /** Changes per GROQ request. */
  readonly chunkSize?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function skipReason(change: Change): string {
  switch (change.kind) {
    case 'added-field':
      return 'adding a field changes no existing document';
    case 'no-longer-required':
      return 'relaxing a required flag changes no existing document';
    case 'options-changed':
      return 'no option was removed';
    default:
      return 'no impact query for this change';
  }
}

function parseCounts(value: unknown, id: string): Omit<ImpactCounted, 'change'> {
  if (typeof value === 'object' && value !== null) {
    const { published, drafts, versions, sample } = value as Record<string, unknown>;
    if (
      typeof published === 'number' &&
      typeof drafts === 'number' &&
      typeof versions === 'number' &&
      Array.isArray(sample) &&
      (sample as unknown[]).every((s) => typeof s === 'string')
    ) {
      return { published, drafts, versions, sample: sample as string[] };
    }
  }
  throw new Error(`Unexpected result for impact item ${id}.`);
}

/**
 * Counts the documents each change affects, in one batched query per chunk.
 * A change that can't be turned into a query is reported as skipped, not thrown.
 * Errors from the reader are not caught, so auth and network failures stop the run.
 */
export async function measureImpact(
  changes: readonly Change[],
  reader: SanityReader,
  options: MeasureOptions = {},
): Promise<ImpactResult[]> {
  const results = new Map<number, ImpactResult>();
  const pending = new Map<string, Change>();
  const items: BatchItem[] = [];

  changes.forEach((change, index) => {
    let query: ImpactQuery | null;
    try {
      query = buildImpactQuery(change);
    } catch (error) {
      results.set(index, { change, skipped: messageOf(error) });
      return;
    }
    if (query === null) {
      results.set(index, { change, skipped: skipReason(change) });
      return;
    }
    const id = String(index);
    pending.set(id, change);
    items.push({ id, query });
  });

  for (const batch of buildBatchQueries(items, options.chunkSize)) {
    const response = await reader.fetch<Record<string, unknown>>(batch.query, batch.params);
    for (const id of batch.ids) {
      const change = pending.get(id);
      if (change === undefined) throw new Error(`Batch returned an unknown item ${id}.`);
      results.set(Number(id), { change, ...parseCounts(response[id], id) });
    }
  }

  return changes.map((_, index) => {
    const result = results.get(index);
    if (result === undefined) throw new Error(`No impact result for change ${String(index)}.`);
    return result;
  });
}
