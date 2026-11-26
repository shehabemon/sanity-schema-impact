import { describe, expect, it } from 'vitest';
import type { Marker } from '../../src/validation/markers.js';
import { diffMarkers, documentKind, groupMarkers } from '../../src/validation/diff.js';

const base: Marker = {
  documentId: 'post-0001',
  documentType: 'post',
  level: 'error',
  code: 'string.maximum-length',
  message: 'Must be at most 40 characters long',
  path: 'title',
  pathPattern: 'title',
};

const marker = (overrides: Partial<Marker>): Marker => ({ ...base, ...overrides });

describe('diffMarkers', () => {
  it('reports markers only in head as introduced and markers only in base as resolved', () => {
    const shared = marker({ documentId: 'post-0002' });
    const gone = marker({ documentId: 'post-0003' });
    const added = marker({ documentId: 'post-0004' });

    const diff = diffMarkers([shared, gone], [shared, added]);

    expect(diff.introduced).toEqual([added]);
    expect(diff.resolved).toEqual([gone]);
  });

  it('treats a changed message as a different marker', () => {
    const before = marker({ message: 'Must be at most 40 characters long' });
    const after = marker({ message: 'Must be at most 30 characters long' });

    const diff = diffMarkers([before], [after]);

    expect(diff.introduced).toEqual([after]);
    expect(diff.resolved).toEqual([before]);
  });

  it('sorts both lists by document, path, code and message whatever the input order', () => {
    const b = marker({ documentId: 'post-0009' });
    const a = marker({ documentId: 'post-0001' });
    const c = marker({ documentId: 'post-0005', path: 'body', pathPattern: 'body' });

    const diff = diffMarkers([], [b, c, a]);

    expect(diff.introduced.map((m) => m.documentId)).toEqual([
      'post-0001',
      'post-0005',
      'post-0009',
    ]);
  });

  it('reports a marker once even when the input repeats it', () => {
    const diff = diffMarkers([], [base, base]);

    expect(diff.introduced).toHaveLength(1);
  });
});

describe('documentKind', () => {
  it('classifies drafts and versions by prefix and everything else as published', () => {
    expect(documentKind('post-0001')).toBe('published');
    expect(documentKind('drafts.post-0001')).toBe('drafts');
    expect(documentKind('versions.rFixture01.post-0001')).toBe('versions');
  });
});

describe('groupMarkers', () => {
  it('counts each document once and splits the count by published, drafts and versions', () => {
    const markers = [
      marker({ documentId: 'post-0001' }),
      marker({ documentId: 'post-0001' }),
      marker({ documentId: 'drafts.post-0002' }),
      marker({ documentId: 'versions.rFixture01.post-0003' }),
    ];

    const [group] = groupMarkers(markers);

    expect(group).toMatchObject({ published: 1, drafts: 1, versions: 1 });
  });

  it('samples the five lowest document IDs, sorted', () => {
    const ids = ['post-0007', 'post-0002', 'post-0005', 'post-0001', 'post-0004', 'post-0003'];

    const [group] = groupMarkers(ids.map((documentId) => marker({ documentId })));

    expect(group?.sample).toEqual([
      'post-0001',
      'post-0002',
      'post-0003',
      'post-0004',
      'post-0005',
    ]);
  });

  it('keeps the highest level of the markers in a group', () => {
    const groups = groupMarkers([
      marker({ documentId: 'post-0001', level: 'info' }),
      marker({ documentId: 'post-0002', level: 'warning' }),
    ]);

    expect(groups[0]?.level).toBe('warning');
  });

  it('keys groups on type, path pattern, code and message', () => {
    const groups = groupMarkers([
      marker({ documentId: 'post-0001', path: 'body[]', pathPattern: 'body[]' }),
      marker({ documentId: 'post-0002', path: 'body[0]', pathPattern: 'body[]' }),
      marker({ documentId: 'post-0003', code: 'custom' }),
      marker({ documentType: 'author', documentId: 'author-001' }),
    ]);

    expect(groups).toHaveLength(3);
  });

  it('orders groups by type, pattern, code and message', () => {
    const groups = groupMarkers([
      marker({ documentType: 'post', code: 'zz' }),
      marker({ documentType: 'author', code: 'aa' }),
      marker({ documentType: 'post', code: 'aa' }),
    ]);

    expect(groups.map((g) => [g.documentType, g.code])).toEqual([
      ['author', 'aa'],
      ['post', 'aa'],
      ['post', 'zz'],
    ]);
  });
});
