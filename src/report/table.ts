import { describeResult, documentsPhrase } from './describe.js';
import {
  hasNoImpact,
  NO_FOLDS,
  rowFolds,
  ruleLabel,
  visibleGroups,
  type RefInfo,
  type Report,
} from './model.js';

export interface TableOptions {
  readonly colour: boolean;
}

const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

function paint(text: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${text}${RESET}` : text;
}

/** Pads each cell to the widest cell in its column. Cells are plain text, so `length` is exact. */
function columns(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd(),
  );
}

function refLine(ref: RefInfo): string {
  const label = `${ref.ref} (${ref.sha.slice(0, 7)})`;
  return ref.uncommitted === true ? `${label} + uncommitted changes` : label;
}

/** A plain-text summary for a terminal. Colour is only added when the caller asks for it. */
export function toTable(report: Report, options: TableOptions): string {
  const lines: string[] = [
    `${refLine(report.base)} to ${refLine(report.head)}`,
    `project ${report.projectId}, dataset ${report.dataset}`,
    '',
    'Structure',
  ];

  if (report.changes.length === 0) {
    lines.push('  No schema changes found.');
  } else {
    // Rows with documents, or with something the Studio flags, come first. Each part keeps its order.
    const folds = rowFolds(report);
    const rows = report.changes.map((result, index) => ({
      result,
      fold: folds.get(index) ?? NO_FOLDS,
    }));
    const ordered = [
      ...rows.filter(({ result, fold }) => !hasNoImpact(result, fold)),
      ...rows.filter(({ result, fold }) => hasNoImpact(result, fold)),
    ];
    for (const { result, fold } of ordered) {
      lines.push(`  ${describeResult(result, fold)}`);
    }
  }

  lines.push('', 'Validation');
  if (!('introduced' in report.validation)) {
    lines.push(`  Skipped: ${report.validation.skipped}`);
  } else {
    const groups = visibleGroups(report);
    if (groups.length === 0) {
      lines.push('  No new validation problems.');
    } else {
      const rows = [
        ['Level', 'Type', 'Path', 'Rule', 'Documents'],
        ...groups.map((group) => [
          group.level,
          group.documentType,
          group.pathPattern,
          ruleLabel(group.code, group.message),
          documentsPhrase(group),
        ]),
      ];
      lines.push(...columns(rows).map((line) => `  ${line}`));
    }
    if (report.validation.resolvedCount > 0) {
      const n = report.validation.resolvedCount;
      lines.push(`  ${String(n)} ${n === 1 ? 'problem' : 'problems'} fixed by this change`);
    }
  }

  lines.push('');
  if (report.failures.length === 0) {
    lines.push(paint('Passed', GREEN, options.colour));
  } else {
    lines.push(paint(`Failed: ${report.failures.join(', ')}`, RED, options.colour));
  }
  return `${lines.join('\n')}\n`;
}
