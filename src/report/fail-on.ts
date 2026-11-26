import type { Report } from './model.js';
import { visibleGroups } from './model.js';

export const RULES = [
  'data-loss',
  'newly-required',
  'options-changed',
  'validation-error',
  'validation-warning',
  'any',
  'none',
] as const;

export type FailRule = (typeof RULES)[number];

export const DEFAULT_FAIL_ON: readonly FailRule[] = [
  'data-loss',
  'newly-required',
  'validation-error',
];

function isRule(name: string): name is FailRule {
  return (RULES as readonly string[]).includes(name);
}

/** Parses the `--fail-on` value. Unset means the defaults. Duplicates are dropped. */
export function parseFailOn(value: string | undefined): FailRule[] {
  if (value === undefined) return [...DEFAULT_FAIL_ON];
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (names.length === 0) throw new Error('--fail-on needs at least one rule.');
  for (const name of names) {
    if (!isRule(name)) {
      throw new Error(`Unknown --fail-on rule "${name}". Use one of: ${RULES.join(', ')}.`);
    }
  }
  const unique = [...new Set(names)].filter(isRule);
  if (unique.includes('none') && unique.length > 1) {
    throw new Error('none cannot be combined with other rules.');
  }
  return unique;
}

/** Returns the rules that matched, in the order they were asked for. */
export function evaluate(report: Report, rules: readonly FailRule[]): FailRule[] {
  if (rules.includes('none')) return [];
  const groups = visibleGroups(report);
  const counted = report.changes.filter(
    (result) => 'published' in result && result.published + result.drafts + result.versions > 0,
  );
  const hasCountOf = (kinds: readonly string[]): boolean =>
    counted.some((result) => kinds.includes(result.change.kind));

  const matches: Record<FailRule, boolean> = {
    'data-loss': hasCountOf(['removed-field', 'removed-type']),
    'newly-required': hasCountOf(['newly-required']),
    'options-changed': hasCountOf(['options-changed']),
    'validation-error': groups.some((group) => group.level === 'error'),
    'validation-warning': groups.some((group) => group.level !== 'info'),
    any: counted.length > 0 || groups.length > 0,
    none: false,
  };
  return rules.filter((rule) => matches[rule]);
}
