import type { Change } from '../diff/types.js';

/**
 * The body of a `*[...]` filter plus its parameters. The filter always starts with
 * `_type == $type`, so the document type only ever travels as a parameter.
 */
export interface ImpactQuery {
  readonly filter: string;
  readonly params: Record<string, unknown>;
}

export interface Segment {
  readonly name: string;
  readonly array: boolean;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Words GROQ reads as operators or literals, so they can't be used as bare attribute names. */
const RESERVED = new Set(['in', 'match', 'asc', 'desc', 'true', 'false', 'null']);

const TYPE_CLAUSE = '_type == $type';

/** Splits `variants[].price.amount` into segments. Throws on anything outside the name allowlist. */
export function parsePath(path: string): Segment[] {
  if (path.length === 0) throw new Error('Field path is empty.');
  return path.split('.').map((part) => {
    const array = part.endsWith('[]');
    const name = array ? part.slice(0, -2) : part;
    if (!NAME.test(name) || RESERVED.has(name)) {
      throw new Error(`Unsafe field name in path "${path}".`);
    }
    return { name, array };
  });
}

const dotted = (segments: readonly Segment[]): string => segments.map((s) => s.name).join('.');

/** Expression that is true when the document (or array member) has data at the path. */
export function hasData(segments: readonly Segment[]): string {
  const first = segments.findIndex((s) => s.array);
  if (first === -1) return `defined(${dotted(segments)})`;
  const head = dotted(segments.slice(0, first + 1));
  const rest = segments.slice(first + 1);
  if (rest.length === 0) return `count(${head}) > 0`;
  return `count(${head}[${hasData(rest)}]) > 0`;
}

/** Expression that is true when the document (or array member) has a value in the removed list. */
function usesRemoved(segments: readonly Segment[]): string {
  const first = segments.findIndex((s) => s.array);
  if (first === -1) return `${dotted(segments)} in $removed`;
  const head = dotted(segments.slice(0, first + 1));
  const rest = segments.slice(first + 1);
  if (rest.length === 0) return `count(${head}[@ in $removed]) > 0`;
  return `count(${head}[${usesRemoved(rest)}]) > 0`;
}

/** Expression that is true when the parent exists and the field is missing from it. */
function isMissing(segments: readonly Segment[]): string {
  const first = segments.findIndex((s) => s.array);
  if (first === -1) {
    const name = dotted(segments);
    const parent = segments.slice(0, -1);
    if (parent.length === 0) return `!defined(${name})`;
    return `defined(${dotted(parent)}) && !defined(${name})`;
  }
  const head = dotted(segments.slice(0, first + 1));
  const rest = segments.slice(first + 1);
  if (rest.length === 0) {
    throw new Error('A required flag on an array member is not counted.');
  }
  return `count(${head}[${isMissing(rest)}]) > 0`;
}

function filterFor(docType: string, clause: string): ImpactQuery {
  return { filter: `${TYPE_CLAUSE} && (${clause})`, params: { type: docType } };
}

/**
 * Builds the GROQ filter that finds the documents a change affects.
 * Returns null for changes that leave existing content valid.
 * Throws when a path contains a segment outside the name allowlist.
 */
export function buildImpactQuery(change: Change): ImpactQuery | null {
  switch (change.kind) {
    case 'removed-type':
      return { filter: TYPE_CLAUSE, params: { type: change.docType } };
    case 'removed-field':
    case 'type-changed':
      return filterFor(change.docType, hasData(parsePath(change.path)));
    case 'possible-rename':
      return filterFor(change.docType, hasData(parsePath(change.from)));
    case 'newly-required':
      return filterFor(change.docType, isMissing(parsePath(change.path)));
    case 'options-changed': {
      if (change.removed.length === 0) return null;
      const query = filterFor(change.docType, usesRemoved(parsePath(change.path)));
      return { filter: query.filter, params: { ...query.params, removed: [...change.removed] } };
    }
    case 'added-field':
    case 'no-longer-required':
      return null;
  }
}
