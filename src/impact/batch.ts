import type { ImpactQuery } from './query-builder.js';

export interface BatchItem {
  readonly id: string;
  readonly query: ImpactQuery;
}

export interface BatchQuery {
  /** One GROQ object expression. Each key is an item ID. */
  readonly query: string;
  readonly params: Record<string, unknown>;
  /** Item IDs in the order they appear in `query`. */
  readonly ids: readonly string[];
}

export const DEFAULT_CHUNK_SIZE = 20;

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Copies one item's parameters under a prefix and rewrites the filter to match. */
function namespace(
  query: ImpactQuery,
  prefix: string,
): { filter: string; params: Record<string, unknown> } {
  let filter = query.filter;
  const params: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(query.params)) {
    if (!PARAM_NAME.test(name)) throw new Error(`Unsafe parameter name "${name}".`);
    const scoped = `${prefix}_${name}`;
    filter = filter.replace(new RegExp(`\\$${name}(?![A-Za-z0-9_])`, 'g'), () => `$${scoped}`);
    params[scoped] = value;
  }
  return { filter, params };
}

function countsFor(filter: string): string {
  const scope = `(${filter})`;
  return [
    `"published": count(*[${scope} && !(_id in path("drafts.**")) && !(_id in path("versions.**"))])`,
    `"drafts": count(*[${scope} && _id in path("drafts.**")])`,
    `"versions": count(*[${scope} && _id in path("versions.**")])`,
    `"sample": *[${scope}] | order(_id asc)[0...5]._id`,
  ].join(', ');
}

/** Builds one GROQ object query that counts every item in a single request. */
export function buildBatchQuery(items: readonly BatchItem[]): BatchQuery {
  if (items.length === 0) throw new Error('A batch needs at least one item.');
  const seen = new Set<string>();
  const params: Record<string, unknown> = {};
  const entries = items.map((item, index) => {
    if (seen.has(item.id)) throw new Error(`Duplicate batch item ID "${item.id}".`);
    seen.add(item.id);
    const scoped = namespace(item.query, `q${String(index)}`);
    Object.assign(params, scoped.params);
    return `${JSON.stringify(item.id)}: {${countsFor(scoped.filter)}}`;
  });
  return {
    query: `{${entries.join(', ')}}`,
    params,
    ids: items.map((item) => item.id),
  };
}

/** Splits items into batches of at most `chunkSize` and builds a query for each. */
export function buildBatchQueries(
  items: readonly BatchItem[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): BatchQuery[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('Chunk size must be a positive integer.');
  }
  const batches: BatchQuery[] = [];
  for (let start = 0; start < items.length; start += chunkSize) {
    batches.push(buildBatchQuery(items.slice(start, start + chunkSize)));
  }
  return batches;
}
