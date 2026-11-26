import { writeMigrationFile } from '../adapters/fs.js';

export interface MigrationFile {
  readonly slug: string;
  readonly source: string;
}

export interface WriteSummary {
  readonly written: readonly string[];
  /** Slugs whose folder was already there, so nothing was written for them. */
  readonly existing: readonly string[];
}

/** Writes each scaffold under `root`. One folder that already exists doesn't stop the others. */
export async function writeScaffolds(
  files: readonly MigrationFile[],
  root: string,
): Promise<WriteSummary> {
  const written: string[] = [];
  const existing: string[] = [];
  for (const file of files) {
    const outcome = await writeMigrationFile(root, file.slug, file.source);
    (outcome === 'written' ? written : existing).push(file.slug);
  }
  return { written, existing };
}
