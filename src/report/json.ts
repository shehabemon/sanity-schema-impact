import type { Report } from './model.js';

/** Object keys are sorted at every level, so the same report always gives the same bytes. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

export function toJson(report: Report): string {
  return `${JSON.stringify(sortKeys(report), null, 2)}\n`;
}
