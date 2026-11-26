import { describe, expect, it } from 'vitest';
import type { Change } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import { buildReport, type Report, type ReportInput } from '../../src/report/model.js';
import { toJson } from '../../src/report/json.js';

const sha = (char: string): string => char.repeat(40);

function sample(): Report {
  const removed: ImpactResult = {
    change: {
      kind: 'removed-field',
      docType: 'post',
      path: 'featuredImage',
      before: { kind: 'image', required: false },
    },
    published: 249,
    drafts: 32,
    versions: 5,
    sample: ['post-0001', 'post-0002'],
  };
  const relaxed: Change = {
    kind: 'no-longer-required',
    docType: 'post',
    path: 'title',
    before: { kind: 'string', required: true },
    after: { kind: 'string', required: false },
  };
  const input: ReportInput = {
    base: { ref: 'main', sha: sha('a') },
    head: { ref: 'change', sha: sha('b') },
    projectId: 'proj1',
    dataset: 'fixture',
    impact: [
      removed,
      { change: relaxed, skipped: 'relaxing a required flag changes no existing document' },
    ],
    validation: { introduced: [], resolvedCount: 3 },
  };
  return buildReport(input);
}

describe('toJson', () => {
  it('writes the same bytes for the same report, whatever order its keys were built in', () => {
    const report = sample();
    const reversed = Object.fromEntries(Object.entries(report).reverse()) as Report;

    expect(toJson(reversed)).toBe(toJson(report));
  });

  it('keeps the resolved marker count and the no-longer-required changes', () => {
    const parsed = JSON.parse(toJson(sample())) as {
      validation: { resolvedCount: number };
      changes: { change: { kind: string } }[];
    };

    expect(parsed.validation.resolvedCount).toBe(3);
    expect(parsed.changes.map((c) => c.change.kind)).toContain('no-longer-required');
  });

  it('is valid JSON at version 1 with a trailing newline', () => {
    const text = toJson(sample());

    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ version: 1, projectId: 'proj1', dataset: 'fixture' });
  });

  it('writes the top-level keys in alphabetical order', () => {
    const keys = Object.keys(JSON.parse(toJson(sample())) as object);

    expect(keys).toEqual([
      'base',
      'changes',
      'dataset',
      'failures',
      'head',
      'projectId',
      'summary',
      'validation',
      'version',
    ]);
  });
});
