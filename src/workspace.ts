import { dirname, isAbsolute, relative, sep } from 'node:path';

const DOT_ENV = /^\.env(\..+)?$/;

/** `.env` and `.env.<name>`, the files a Sanity Studio reads when it loads. */
export function isDotEnvFile(name: string): boolean {
  return DOT_ENV.test(name);
}

/**
 * The directory, then each parent up to and including `root`, nearest first. A workspace install
 * can leave `node_modules` in any of them.
 */
export function dirsUpTo(dir: string, root: string): string[] {
  const rel = relative(root, dir);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('The Studio directory must be inside the repository.');
  }
  const dirs = [dir];
  for (let current = dir; current !== root;) {
    current = dirname(current);
    dirs.push(current);
  }
  return dirs;
}
