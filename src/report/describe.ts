import type { Change } from '../diff/types.js';
import type { ImpactCounted, ImpactResult } from '../impact/run.js';
import type { RowFolds } from './model.js';

export interface DocumentCounts {
  readonly published: number;
  readonly drafts: number;
  readonly versions: number;
}

function count(n: number, singular: string, pluralForm: string): string {
  return `${String(n)} ${n === 1 ? singular : pluralForm}`;
}

/**
 * Published count first, with drafts and release versions in brackets when there are any. Changes
 * and validation groups both use this, so the report words its counts one way.
 */
export function documentsPhrase(counts: DocumentCounts): string {
  const published = count(counts.published, 'published document', 'published documents');
  const parts: string[] = [];
  if (counts.drafts > 0) parts.push(count(counts.drafts, 'draft', 'drafts'));
  if (counts.versions > 0) parts.push(count(counts.versions, 'in release', 'in releases'));
  return parts.length > 0 ? `${published} (${parts.join(', ')})` : published;
}

function documentTotal(result: ImpactResult): number {
  if ('skipped' in result) return 0;
  return result.published + result.drafts + result.versions;
}

/** What the change does, naming the field or type. Paths sit in code spans. */
function subjectOf(change: Change): string {
  switch (change.kind) {
    case 'removed-type':
      return `Deleting type \`${change.docType}\``;
    case 'removed-field':
      return `Removing \`${change.docType}.${change.path}\``;
    case 'added-field':
      return `Adding \`${change.docType}.${change.path}\``;
    case 'newly-required':
      return `Making \`${change.docType}.${change.path}\` required`;
    case 'no-longer-required':
      return `Making \`${change.docType}.${change.path}\` optional`;
    case 'type-changed':
      return `Changing \`${change.docType}.${change.path}\` from ${change.before.kind} to ${change.after.kind}`;
    case 'options-changed':
      return change.removed.length > 0
        ? `Removing \`${change.removed.join('`, `')}\` from the allowed values of \`${change.docType}.${change.path}\``
        : `Changing the allowed values of \`${change.docType}.${change.path}\``;
    case 'possible-rename':
      return `Possibly renamed \`${change.docType}.${change.from}\` → \`${change.docType}.${change.to}\``;
  }
}

/** The sentence for a counted change: subject, verb, then the counts. */
function countedSentence(result: ImpactCounted): string {
  const change = result.change;
  const subject = subjectOf(change);
  if (documentTotal(result) === 0) return `${subject}: no existing documents affected`;
  const counts = documentsPhrase(result);
  switch (change.kind) {
    case 'removed-field':
      return `${subject} leaves data in ${counts}`;
    case 'newly-required':
      return `${subject} adds problems in ${counts}`;
    case 'removed-type':
      return `${subject} orphans ${counts}`;
    case 'possible-rename':
      return `${subject}: ${counts} still use the old name`;
    default:
      return `${subject} affects ${counts}`;
  }
}

/** The note for a required row. The Studio's count is only worth a number when it differs. */
function requiredNote(flagged: number, total: number): string {
  if (flagged === total) return 'Studio flags the same documents';
  return `Studio flags ${count(flagged, 'document', 'documents')}`;
}

/**
 * One sentence for a structural change, with its impact. `folds` holds the documents the Studio
 * flags on this row, and each kind adds a note to the sentence.
 */
export function describeResult(result: ImpactResult, folds: RowFolds): string {
  const sentence =
    'skipped' in result
      ? `${subjectOf(result.change)}: not measured, ${result.skipped}`
      : countedSentence(result);
  const notes: string[] = [];
  if (folds['unknown-field'] > 0) notes.push('Studio also flags these as unknown fields');
  if (folds.required > 0) notes.push(requiredNote(folds.required, documentTotal(result)));
  return notes.length === 0 ? sentence : `${sentence}; ${notes.join('; ')}`;
}
