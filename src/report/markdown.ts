import { describeResult } from './describe.js';
import { foldUnknownFields, ruleLabel, visibleGroups, type RefInfo, type Report } from './model.js';
import type { MarkerGroup } from '../validation/diff.js';

/** The Action looks for this line to find and update its own comment. */
export const COMMENT_MARKER = '<!-- sanity-schema-impact -->';

const MAX_GROUP_ROWS = 25;
const MAX_MESSAGE_LENGTH = 160;
const SPECIAL_CHARACTERS = /[\\`*_[\]<>|~]/g;

/** Escapes text for a paragraph or a table cell. */
export function escapeText(text: string): string {
  return text.replace(SPECIAL_CHARACTERS, '\\$&').replace(/\r?\n/g, ' ');
}

/** Like `escapeText`, but code spans are copied as they are, so nothing gets escaped twice. */
export function escapeMarkdown(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part.replace(/\r?\n/g, ' ') : escapeText(part)))
    .join('');
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${String(n)} ${n === 1 ? singular : pluralForm}`;
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 3)}...` : text;
}

/** Branch or commit, then its short SHA. A detached head only shows the short SHA once. */
function refText(ref: RefInfo): string {
  const short = ref.sha.slice(0, 7);
  const name = ref.ref.replace(/`/g, '');
  const label = name === short ? `\`${short}\`` : `\`${name}\` (\`${short}\`)`;
  return ref.uncommitted === true ? `${label} + uncommitted changes` : label;
}

function groupRow(group: MarkerGroup): string {
  const documents = `${String(group.published)} published, ${String(group.drafts)} drafts, ${String(group.versions)} in releases`;
  const rule = ruleLabel(group.code, truncate(group.message));
  return `| ${group.level} | ${escapeText(group.documentType)} | ${escapeText(group.pathPattern)} | ${escapeText(rule)} | ${documents} |`;
}

function structureSection(report: Report): string[] {
  if (report.changes.length === 0) return ['No schema changes found.'];
  const rawGroups = 'introduced' in report.validation ? report.validation.introduced : [];
  const { flagged } = foldUnknownFields(report.changes, rawGroups);
  const rows = report.changes.map(
    (result, index) => `| ${escapeMarkdown(describeResult(result, flagged.get(index) ?? 0))} |`,
  );
  return ['| Schema change |', '|---|', ...rows];
}

function validationSection(report: Report): string[] {
  const validation = report.validation;
  if (!('introduced' in validation)) {
    return [`Validation skipped: ${escapeText(validation.skipped)}`];
  }

  const groups = visibleGroups(report);
  const lines: string[] = [];
  if (groups.length === 0) {
    lines.push('No new validation problems.');
  } else {
    lines.push('| Level | Type | Path | Rule | Documents |', '|---|---|---|---|---|');
    lines.push(...groups.slice(0, MAX_GROUP_ROWS).map(groupRow));
    const left = groups.length - MAX_GROUP_ROWS;
    if (left > 0) {
      lines.push(
        '',
        `${plural(left, 'more group', 'more groups')} not shown. The JSON output has all of them.`,
      );
    }
  }
  if (validation.resolvedCount > 0) {
    lines.push(
      '',
      `${plural(validation.resolvedCount, 'problem', 'problems')} fixed by this change.`,
    );
  }
  return lines;
}

function resultLine(report: Report): string {
  if (report.failures.length === 0) return 'No rules failed.';
  return `Failed rules: ${report.failures.map((rule) => `\`${rule}\``).join(', ')}.`;
}

/** The PR comment body. It holds no timestamp, so the same inputs give the same text. */
export function toMarkdown(report: Report): string {
  const lines = [
    COMMENT_MARKER,
    '## Schema impact',
    '',
    `${refText(report.base)} to ${refText(report.head)}, project \`${report.projectId}\`, dataset \`${report.dataset}\`.`,
    '',
    '### Structure',
    '',
    ...structureSection(report),
    '',
    '### Validation',
    '',
    ...validationSection(report),
    '',
    '### Result',
    '',
    resultLine(report),
  ];
  return `${lines.join('\n')}\n`;
}
