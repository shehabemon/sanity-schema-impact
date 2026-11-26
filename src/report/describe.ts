import type { ImpactCounted, ImpactResult } from '../impact/run.js';

const UNKNOWN_FIELD_NOTE = '; Studio also flags these as unknown fields';

function count(n: number, singular: string, pluralForm: string): string {
  return `${String(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Published count first, with drafts and release versions in brackets when there are any. */
function documentsPhrase(result: ImpactCounted): string {
  const published = count(result.published, 'published document', 'published documents');
  const parts: string[] = [];
  if (result.drafts > 0) parts.push(count(result.drafts, 'draft', 'drafts'));
  if (result.versions > 0) parts.push(count(result.versions, 'in release', 'in releases'));
  return parts.length > 0 ? `${published} (${parts.join(', ')})` : published;
}

/** The sentence for a counted change: subject, verb, then the counts. Paths sit in code spans. */
function countedSentence(result: ImpactCounted): string {
  const change = result.change;
  const total = result.published + result.drafts + result.versions;
  const withCounts = (subject: string, verb: string): string =>
    total > 0
      ? `${subject} ${verb} ${documentsPhrase(result)}`
      : `${subject}: no existing documents affected`;

  switch (change.kind) {
    case 'removed-field':
      return withCounts(`Removing \`${change.docType}.${change.path}\``, 'leaves data in');
    case 'newly-required':
      return withCounts(`Making \`${change.docType}.${change.path}\` required`, 'adds problems in');
    case 'removed-type':
      return withCounts(`Deleting type \`${change.docType}\``, 'orphans');
    case 'type-changed':
      return withCounts(
        `Changing \`${change.docType}.${change.path}\` from ${change.before.kind} to ${change.after.kind}`,
        'affects',
      );
    case 'options-changed':
      return withCounts(
        `Removing \`${change.removed.join('`, `')}\` from the allowed values of \`${change.docType}.${change.path}\``,
        'affects',
      );
    case 'possible-rename': {
      const subject = `Possibly renamed \`${change.docType}.${change.from}\` → \`${change.docType}.${change.to}\``;
      return total > 0
        ? `${subject}: ${documentsPhrase(result)} still use the old name`
        : `${subject}: no existing documents affected`;
    }
    default:
      return withCounts(`Changing \`${change.docType}.${change.path}\``, 'affects');
  }
}

/**
 * One sentence for a structural change, with its impact. `flagged` is the number of documents
 * the Studio marks as unknown field; the sentence says so without repeating the number.
 */
export function describeResult(result: ImpactResult, flagged: number): string {
  const sentence =
    'skipped' in result ? `Not measured: ${result.skipped}` : countedSentence(result);
  return flagged > 0 ? `${sentence}${UNKNOWN_FIELD_NOTE}` : sentence;
}
