import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeScaffolds } from '../../src/migrate/write.js';

describe('writeScaffolds', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'scaffold-write-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes every scaffold and reports the slugs it wrote', async () => {
    const dir = join(root, 'all');

    const summary = await writeScaffolds(
      [
        { slug: 'unset-post-a', source: 'a\n' },
        { slug: 'delete-tag-documents', source: 'b\n' },
      ],
      dir,
    );

    expect(summary).toEqual({ written: ['unset-post-a', 'delete-tag-documents'], existing: [] });
    expect(await readFile(join(dir, 'delete-tag-documents', 'index.ts'), 'utf8')).toBe('b\n');
  });

  it('keeps existing folders and reports them, without stopping the rest', async () => {
    const dir = join(root, 'mixed');
    await writeScaffolds([{ slug: 'unset-post-a', source: 'first\n' }], dir);

    const summary = await writeScaffolds(
      [
        { slug: 'unset-post-a', source: 'second\n' },
        { slug: 'unset-post-b', source: 'third\n' },
      ],
      dir,
    );

    expect(summary).toEqual({ written: ['unset-post-b'], existing: ['unset-post-a'] });
    expect(await readFile(join(dir, 'unset-post-a', 'index.ts'), 'utf8')).toBe('first\n');
  });
});
