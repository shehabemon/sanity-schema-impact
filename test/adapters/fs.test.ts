import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeMigrationFile } from '../../src/adapters/fs.js';

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
