import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileNames, linkIfAbsent, pathExists, writeMigrationFile } from '../../src/adapters/fs.js';

describe('writeMigrationFile', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'migration-fs-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes index.ts inside a folder named after the slug, creating the parent', async () => {
    const dir = join(root, 'fresh', 'migrations');

    const outcome = await writeMigrationFile(
      dir,
      'unset-post-featured-image',
      'export default 1;\n',
    );

    expect(outcome).toBe('written');
    expect(await readFile(join(dir, 'unset-post-featured-image', 'index.ts'), 'utf8')).toBe(
      'export default 1;\n',
    );
  });

  it('refuses to overwrite a migration folder that already exists', async () => {
    const dir = join(root, 'existing');
    await mkdir(join(dir, 'rename-post-a-to-b'), { recursive: true });
    await writeFile(join(dir, 'rename-post-a-to-b', 'index.ts'), 'hand written\n');

    const outcome = await writeMigrationFile(dir, 'rename-post-a-to-b', 'scaffold\n');

    expect(outcome).toBe('exists');
    expect(await readFile(join(dir, 'rename-post-a-to-b', 'index.ts'), 'utf8')).toBe(
      'hand written\n',
    );
  });

  it('treats an empty folder with the same name as existing too', async () => {
    const dir = join(root, 'empty-folder');
    await mkdir(join(dir, 'delete-tag-documents'), { recursive: true });

    expect(await writeMigrationFile(dir, 'delete-tag-documents', 'scaffold\n')).toBe('exists');
  });
});

describe('linkIfAbsent', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'link-fs-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates a symlink and reports that it did', async () => {
    const target = join(root, 'source-dir');
    await mkdir(target);

    expect(await linkIfAbsent(target, join(root, 'linked-dir'), 'dir')).toBe(true);
    expect((await lstat(join(root, 'linked-dir'))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(root, 'linked-dir'))).toBe(target);
  });

  it('leaves an existing file alone and reports that it did not link', async () => {
    const path = join(root, '.env');
    await writeFile(path, 'SANITY_STUDIO_ID=own\n');

    expect(await linkIfAbsent(join(root, 'other.env'), path, 'file')).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('SANITY_STUDIO_ID=own\n');
  });

  it('treats a dangling symlink as present', async () => {
    const path = join(root, 'dangling');
    await symlink(join(root, 'nowhere'), path);

    expect(await linkIfAbsent(join(root, 'source-dir'), path, 'dir')).toBe(false);
  });
});

describe('fileNames', () => {
  it('lists the files in a directory and leaves out sub-directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'names-fs-'));
    await writeFile(join(dir, '.env'), '');
    await mkdir(join(dir, 'nested'));

    expect(await fileNames(dir)).toEqual(['.env']);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('pathExists', () => {
  it('is false for a missing path and true for a dangling symlink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exists-fs-'));
    await symlink(join(dir, 'nowhere'), join(dir, 'dangling'));

    expect(await pathExists(join(dir, 'missing'))).toBe(false);
    expect(await pathExists(join(dir, 'dangling'))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
