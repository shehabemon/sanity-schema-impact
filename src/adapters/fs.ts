import { lstat, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
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

/** True when anything is at `path`. A symlink counts even when its target is missing. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return false;
    throw error;
  }
}

/** Links `path` to `target` unless something is already at `path`. Returns whether it linked. */
export async function linkIfAbsent(
  target: string,
  path: string,
  type: 'dir' | 'file',
): Promise<boolean> {
  if (await pathExists(path)) return false;
  await symlink(target, path, type);
  return true;
}

/** Names of the entries in `dir` that aren't directories. */
export async function fileNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
}
