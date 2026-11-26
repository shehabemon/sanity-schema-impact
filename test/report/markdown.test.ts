import { describe, expect, it } from 'vitest';
import type { Change, FieldInfo } from '../../src/diff/types.js';
import type { ImpactResult } from '../../src/impact/run.js';
import { buildReport, type ReportInput } from '../../src/report/model.js';
import { toMarkdown } from '../../src/report/markdown.js';
import type { MarkerGroup } from '../../src/validation/diff.js';

const field: FieldInfo = { kind: 'image', required: false };
const featuredImage: Change = {
  kind: 'removed-field',
  docType: 'post',
  path: 'featuredImage',
  before: field,
};

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    base: { ref: 'main', sha: 'a'.repeat(40) },
    head: { ref: 'change', sha: 'b'.repeat(40) },
    projectId: 'proj1',
    dataset: 'fixture',
    impact: [],
    validation: { introduced: [], resolvedCount: 0 },
    ...overrides,
  };
}

function group(overrides: Partial<MarkerGroup> = {}): MarkerGroup {
  return {
    documentType: 'post',
    pathPattern: 'title',
    code: 'string.maximum-length',
    message: 'Must be at most 40 characters long',
    level: 'error',
    published: 129,
    drafts: 25,
    versions: 6,
    sample: ['drafts.post-0020'],
    ...overrides,
  };
}

const removed: ImpactResult = {
  change: featuredImage,
  published: 249,
  drafts: 32,
  versions: 5,
  sample: ['post-0001'],
};

describe('toMarkdown', () => {
  it('starts with the hidden marker the Action uses to find its comment', () => {
    const text = toMarkdown(buildReport(input()));

    expect(text.split('\n')[0]).toBe('<!-- sanity-schema-impact -->');
  });

  it('puts one sentence per structural change in a table row', () => {
    const text = toMarkdown(buildReport(input({ impact: [removed] })));

    expect(text).toContain('| Schema change |');
    expect(text).toContain(
      '| Removing `post.featuredImage` leaves data in 249 published documents (32 drafts, 5 in releases) |',
    );
  });

  it('says so when no schema change was found', () => {
    const text = toMarkdown(buildReport(input()));

    expect(text).toContain('No schema changes found.');
    expect(text).not.toContain('| Change |');
  });

  it('shows the base and head refs with short SHAs', () => {
    const text = toMarkdown(buildReport(input()));

    expect(text).toContain('`main` (`aaaaaaa`) to `change` (`bbbbbbb`)');
  });

  it('shows a detached head as its short SHA alone', () => {
    const text = toMarkdown(buildReport(input({ head: { ref: 'bbbbbbb', sha: 'b'.repeat(40) } })));

    expect(text).toContain('to `bbbbbbb`, project');
  });

  it('marks a head with uncommitted Studio changes', () => {
    const text = toMarkdown(
      buildReport(input({ head: { ref: 'change', sha: 'b'.repeat(40), uncommitted: true } })),
    );

    expect(text).toContain('to `change` (`bbbbbbb`) + uncommitted changes, project');
  });

  it('lists the introduced validation groups with their documents split by kind', () => {
    const text = toMarkdown(
      buildReport(input({ validation: { introduced: [group()], resolvedCount: 0 } })),
    );

    expect(text).toContain(
      '| error | post | title | string.maximum-length: Must be at most 40 characters long | 129 published, 25 drafts, 6 in releases |',
    );
  });

  it('caps the validation table and says how many groups were left out', () => {
    const groups = Array.from({ length: 30 }, (_, i) =>
      group({ pathPattern: `field${String(i).padStart(2, '0')}` }),
    );
    const text = toMarkdown(
      buildReport(input({ validation: { introduced: groups, resolvedCount: 0 } })),
    );

    expect(text.match(/^\| error \|/gm)).toHaveLength(25);
    expect(text).toContain('5 more groups not shown. The JSON output has all of them.');
  });

  it('escapes markdown and table syntax in validation messages', () => {
    const text = toMarkdown(
      buildReport(
        input({
          validation: {
            introduced: [group({ message: 'Bad | <script>*x*' })],
            resolvedCount: 0,
          },
        }),
      ),
    );

    expect(text).toContain('Bad \\| \\<script\\>\\*x\\*');
  });

  it('says how many problems the change fixed', () => {
    const text = toMarkdown(
      buildReport(input({ validation: { introduced: [], resolvedCount: 3 } })),
    );

    expect(text).toContain('3 problems fixed by this change.');
  });

  it('leaves the fixed line out when nothing was fixed', () => {
    const text = toMarkdown(buildReport(input()));

    expect(text).not.toContain('fixed by this change');
    expect(text).not.toContain('resolved');
  });

  it('adds the unknown-field note to the row of a removed field the Studio still flags', () => {
    const text = toMarkdown(
      buildReport(
        input({
          impact: [removed],
          validation: {
            introduced: [
              group({
                code: 'object.unknown-field',
                pathPattern: 'featuredImage',
                level: 'warning',
                published: 249,
                drafts: 32,
                versions: 5,
              }),
            ],
            resolvedCount: 0,
          },
        }),
      ),
    );

    expect(text).toContain('; Studio also flags these as unknown fields |');
    expect(text).not.toContain('object.unknown-field');
  });

  it('shows why validation was skipped', () => {
    const text = toMarkdown(
      buildReport(input({ validation: { skipped: 'Skipped with --skip-validation.' } })),
    );

    expect(text).toContain('Validation skipped: Skipped with --skip-validation.');
  });

  it('names the rules that failed, or says none did', () => {
    const failed = { ...buildReport(input({ impact: [removed] })), failures: ['data-loss'] };
    expect(toMarkdown(failed)).toContain('Failed rules: `data-loss`.');
    expect(toMarkdown(buildReport(input()))).toContain('No rules failed.');
  });
});
