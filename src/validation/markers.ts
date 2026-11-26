export type MarkerLevel = 'error' | 'warning' | 'info';

/** One validation problem on one document. */
export interface Marker {
  readonly documentId: string;
  readonly documentType: string;
  readonly level: MarkerLevel;
  readonly code: string;
  readonly message: string;
  /** Readable field path, e.g. `body[_key=="abc"].text` or `tags[0]`. */
  readonly path: string;
  /** The same path with keys and indices replaced by `[]`, e.g. `body[].text`. */
  readonly pathPattern: string;
}

type PathSegment = string | number | { readonly _key: string };

const LEVELS: readonly string[] = ['error', 'warning', 'info'];
const TRACE_ID = /\s*\(traceId: [^)]*\)/g;

function malformed(line: number): Error {
  // The line content is left out on purpose: it can hold document data.
  return new Error(`Malformed validation output on line ${String(line)}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderPath(segments: readonly PathSegment[], generalise: boolean): string {
  let out = '';
  for (const segment of segments) {
    if (typeof segment === 'string') {
      out += out === '' ? segment : `.${segment}`;
    } else if (typeof segment === 'number') {
      out += generalise ? '[]' : `[${String(segment)}]`;
    } else {
      out += generalise ? '[]' : `[_key==${JSON.stringify(segment._key)}]`;
    }
  }
  return out;
}

function parsePath(value: unknown): PathSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const segments: PathSegment[] = [];
  for (const item of value as unknown[]) {
    if (typeof item === 'string') {
      segments.push(item);
    } else if (typeof item === 'number' && Number.isInteger(item) && item >= 0) {
      segments.push(item);
    } else if (isRecord(item) && typeof item['_key'] === 'string') {
      segments.push({ _key: item['_key'] });
    } else {
      return undefined;
    }
  }
  return segments;
}

function parseMarker(value: unknown): Omit<Marker, 'documentId' | 'documentType'> | undefined {
  if (!isRecord(value)) return undefined;
  const { level, code, message } = value;
  const segments = parsePath(value['path']);
  if (
    typeof level !== 'string' ||
    !LEVELS.includes(level) ||
    typeof code !== 'string' ||
    typeof message !== 'string' ||
    segments === undefined
  ) {
    return undefined;
  }
  return {
    level: level as MarkerLevel,
    code,
    message: message.replace(TRACE_ID, ''),
    path: renderPath(segments, false),
    pathPattern: renderPath(segments, true),
  };
}

/**
 * Parses the ndjson the Sanity CLI writes for `documents validate --format ndjson`.
 * Each record is one document with one or more markers. Blank lines are skipped.
 * A line that doesn't parse throws with its line number and nothing from the line.
 */
export function parseValidationOutput(ndjson: string): Marker[] {
  const markers: Marker[] = [];
  const lines = ndjson.split('\n');

  lines.forEach((text, index) => {
    if (text.trim() === '') return;
    const lineNumber = index + 1;

    let record: unknown;
    try {
      record = JSON.parse(text) as unknown;
    } catch {
      throw malformed(lineNumber);
    }
    if (!isRecord(record)) throw malformed(lineNumber);

    const { documentId, documentType, markers: entries } = record;
    if (typeof documentId !== 'string' || typeof documentType !== 'string') {
      throw malformed(lineNumber);
    }
    if (!Array.isArray(entries)) throw malformed(lineNumber);

    for (const entry of entries as unknown[]) {
      const marker = parseMarker(entry);
      if (marker === undefined) throw malformed(lineNumber);
      markers.push({ documentId, documentType, ...marker });
    }
  });

  return markers;
}
