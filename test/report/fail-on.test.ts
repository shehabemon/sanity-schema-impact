import { describe, expect, it } from 'vitest';
import { DEFAULT_FAIL_ON, evaluate, parseFailOn } from '../../src/report/fail-on.js';
import { buildReport, type ReportInput } from '../../src/report/model.js';

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

const removedFeaturedImage = {
  change: {
    kind: 'removed-field' as const,
    docType: 'post',
    path: 'featuredImage',
    before: { kind: 'image' as const, required: false },
  },
  published: 249,
  drafts: 32,
  versions: 5,
  sample: ['post-0001'],
};

const titleError = {
  documentType: 'post',
  pathPattern: 'title',
  code: 'string.maximum-length',
  message: 'Must be at most 40 characters long',
  level: 'error' as const,
  published: 129,
  drafts: 25,
  versions: 6,
  sample: ['drafts.post-0020'],
};

describe('parseFailOn', () => {
  it('uses data-loss, newly-required and validation-error when no value is given', () => {
    expect(parseFailOn(undefined)).toEqual(['data-loss', 'newly-required', 'validation-error']);
    expect(DEFAULT_FAIL_ON).toEqual(['data-loss', 'newly-required', 'validation-error']);
  });

  it('reads a comma-separated list and ignores surrounding spaces', () => {
    expect(parseFailOn(' options-changed , validation-warning ')).toEqual([
      'options-changed',
      'validation-warning',
    ]);
  });

  it('rejects an unknown rule and lists the valid names', () => {
    expect(() => parseFailOn('data-loss,breaking')).toThrow(
      'Unknown --fail-on rule "breaking". Use one of: data-loss, newly-required, options-changed, validation-error, validation-warning, any, none.',
    );
  });

  it('rejects a value with no rules in it', () => {
    expect(() => parseFailOn(' , ')).toThrow('--fail-on needs at least one rule.');
  });

  it('accepts none on its own and refuses to mix it with other rules', () => {
    expect(parseFailOn('none')).toEqual(['none']);
    expect(() => parseFailOn('none,data-loss')).toThrow('none cannot be combined');
  });

  it('removes duplicate rules', () => {
    expect(parseFailOn('data-loss,data-loss')).toEqual(['data-loss']);
  });
});

describe('evaluate', () => {
  it('matches data-loss when a removed field still has documents in it', () => {
    const report = buildReport(input({ impact: [removedFeaturedImage] }));
    expect(evaluate(report, ['data-loss'])).toEqual(['data-loss']);
  });

  it('does not match data-loss for a removed field nobody uses', () => {
    const report = buildReport(
      input({ impact: [{ ...removedFeaturedImage, published: 0, drafts: 0, versions: 0 }] }),
    );
    expect(evaluate(report, ['data-loss'])).toEqual([]);
  });

  it('does not match data-loss for a skipped change', () => {
    const report = buildReport(
      input({ impact: [{ change: removedFeaturedImage.change, skipped: 'unsafe path' }] }),
    );
    expect(evaluate(report, ['data-loss'])).toEqual([]);
  });

  it('matches newly-required only when documents are counted', () => {
    const required = {
      change: {
        kind: 'newly-required' as const,
        docType: 'post',
        path: 'slug',
        before: { kind: 'slug' as const, required: false },
        after: { kind: 'slug' as const, required: true },
      },
      published: 0,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    expect(evaluate(buildReport(input({ impact: [required] })), ['newly-required'])).toEqual([]);

    const counted = { ...required, published: 3 };
    expect(evaluate(buildReport(input({ impact: [counted] })), ['newly-required'])).toEqual([
      'newly-required',
    ]);
  });

  it('matches options-changed only when documents are counted', () => {
    const options = {
      change: {
        kind: 'options-changed' as const,
        docType: 'post',
        path: 'status',
        before: { kind: 'string' as const, required: false, values: ['draft', 'live'] },
        after: { kind: 'string' as const, required: false, values: ['live'] },
        removed: ['draft'],
        added: [],
      },
      published: 2,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    expect(evaluate(buildReport(input({ impact: [options] })), ['options-changed'])).toEqual([
      'options-changed',
    ]);
  });

  it('matches validation-error on an introduced error group, and validation-warning on warnings', () => {
    const error = buildReport(
      input({ validation: { introduced: [titleError], resolvedCount: 0 } }),
    );
    const warning = buildReport(
      input({
        validation: { introduced: [{ ...titleError, level: 'warning' }], resolvedCount: 0 },
      }),
    );

    expect(evaluate(error, ['validation-error'])).toEqual(['validation-error']);
    expect(evaluate(error, ['validation-warning'])).toEqual(['validation-warning']);
    expect(evaluate(warning, ['validation-error'])).toEqual([]);
    expect(evaluate(warning, ['validation-warning'])).toEqual(['validation-warning']);
  });

  it('still matches validation-error for a Required group folded onto its newly required row', () => {
    const requiredBody = {
      change: {
        kind: 'newly-required' as const,
        docType: 'post',
        path: 'title',
        before: { kind: 'string' as const, required: false },
        after: { kind: 'string' as const, required: true },
      },
      published: 3,
      drafts: 0,
      versions: 0,
      sample: [],
    };
    const report = buildReport(
      input({
        impact: [requiredBody],
        validation: {
          introduced: [
            {
              ...titleError,
              code: 'value.required',
              message: 'Required',
              pathPattern: 'title',
              published: 3,
              drafts: 0,
              versions: 0,
            },
          ],
          resolvedCount: 0,
        },
      }),
    );

    expect(report.summary.validationGroups).toBe(0);
    expect(evaluate(report, ['validation-error'])).toEqual(['validation-error']);
  });

  it('still matches validation-error for a Required group on a child path of a newly required field', () => {
    const report = buildReport(
      input({
        impact: [
          {
            change: {
              kind: 'newly-required' as const,
              docType: 'post',
              path: 'slug',
              before: { kind: 'slug' as const, required: false },
              after: { kind: 'slug' as const, required: true },
            },
            published: 16,
            drafts: 0,
            versions: 0,
            sample: [],
          },
        ],
        validation: {
          introduced: [
            {
              ...titleError,
              code: 'value.required',
              message: 'Required',
              pathPattern: 'slug.current',
              published: 16,
              drafts: 0,
              versions: 0,
            },
          ],
          resolvedCount: 0,
        },
      }),
    );

    expect(report.summary.validationGroups).toBe(0);
    expect(evaluate(report, ['validation-error'])).toEqual(['validation-error']);
  });

  it('never matches a validation rule when validation was skipped', () => {
    const report = buildReport(
      input({ validation: { skipped: 'Skipped with --skip-validation.' } }),
    );
    expect(evaluate(report, ['validation-error', 'validation-warning'])).toEqual([]);
  });

  it('matches any when a change is counted or a validation group is introduced', () => {
    expect(evaluate(buildReport(input({ impact: [removedFeaturedImage] })), ['any'])).toEqual([
      'any',
    ]);
    expect(
      evaluate(buildReport(input({ validation: { introduced: [titleError], resolvedCount: 0 } })), [
        'any',
      ]),
    ).toEqual(['any']);
  });

  it('never matches none', () => {
    const report = buildReport(input({ impact: [removedFeaturedImage] }));
    expect(evaluate(report, ['none'])).toEqual([]);
  });

  it('returns nothing for a clean report', () => {
    expect(evaluate(buildReport(input()), parseFailOn(undefined))).toEqual([]);
  });
});
