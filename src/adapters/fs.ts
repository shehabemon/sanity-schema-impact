import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type MigrationWriteOutcome = 'written' | 'exists';

/**
 * Writes `<root>/<slug>/index.ts`. A folder with that name already there is left alone and
 * reported as `exists`, so a migration someone has edited is never replaced.
 */
export async function writeMigrationFile(
  root: string,
  slug: string,
  source: string,
): Promise<MigrationWriteOutcome> {
  await mkdir(root, { recursive: true });
  const folder = join(root, slug);
  try {
    await mkdir(folder);
  } catch (error) {
    if (isErrno(error, 'EEXIST')) return 'exists';
    throw error;
  }
  await writeFile(join(folder, 'index.ts'), source, { flag: 'wx' });
  return 'written';
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
