import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseValidationOutput } from '../../src/validation/markers.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/validation/${name}`, import.meta.url), 'utf8');

describe('parseValidationOutput', () => {
  it('returns one marker per entry, with the document fields and the rendered path', () => {
    const markers = parseValidationOutput(fixture('post-title.ndjson'));

    expect(markers).toHaveLength(3);
    expect(markers[0]).toEqual({
      documentId: 'drafts.post-0020',
      documentType: 'post',
      level: 'error',
      code: 'string.maximum-length',
      message: 'Must be at most 40 characters long',
      path: 'title',
      pathPattern: 'title',
    });
  });

  it('keeps the draft and version prefixes on document IDs', () => {
    const ids = parseValidationOutput(fixture('post-title.ndjson')).map((m) => m.documentId);

    expect(ids).toEqual(['drafts.post-0020', 'post-0055', 'versions.rFixture01.post-0240']);
  });

  it('renders keyed and index segments, and generalises both in the pattern', () => {
    const [product, author] = parseValidationOutput(fixture('paths.ndjson'));

    expect(product).toMatchObject({ path: 'tags[0]', pathPattern: 'tags[]' });
    expect(author).toMatchObject({
      path: 'social.links[_key=="lnk001"].url',
      pathPattern: 'social.links[].url',
    });
  });

  it('strips the traceId from the message and keeps the rest of it', () => {
    const [marker] = parseValidationOutput(fixture('validation-exception.ndjson'));

    expect(marker?.message).toBe(
      'slug: Exception occurred while validating value: Dataset not found - Dataset "no-such-dataset-xyz" not found for project ID "zvpg4970"',
    );
  });

  it('ignores blank lines', () => {
    const [line] = fixture('author-name.ndjson').split('\n');

    expect(parseValidationOutput(`\n${line ?? ''}\n\n   \n`)).toHaveLength(1);
  });

  it('reads Sanity v3 markers, which have no code, with an empty code', () => {
    const [first, , , fourth] = parseValidationOutput(fixture('v3-unknown-field.ndjson'));

    expect(first).toEqual({
      documentId: 'drafts.product-0101',
      documentType: 'product',
      level: 'warning',
      code: '',
      message: "Field 'shop' does not exist on type 'catalogProduct'",
      path: 'store.shop',
      pathPattern: 'store.shop',
    });
    expect(fourth).toMatchObject({ documentId: 'collection-0303', code: '', path: 'title' });
  });

  it('rejects a code that is present but is not a string', () => {
    const line = JSON.stringify({
      documentId: 'post-1',
      documentType: 'post',
      level: 'error',
      markers: [{ code: 7, level: 'error', message: 'x', path: ['title'] }],
    });

    expect(() => parseValidationOutput(line)).toThrow(
      new Error('Malformed validation output on line 1.'),
    );
  });

  it('returns no markers for empty output', () => {
    expect(parseValidationOutput('')).toEqual([]);
  });

  it('names the line that fails, without its content', () => {
    const [line] = fixture('author-name.ndjson').split('\n');
    const broken = `${line ?? ''}\n{"documentId":"secret-document-content"\n`;

    expect(() => parseValidationOutput(broken)).toThrow(
      new Error('Malformed validation output on line 2.'),
    );
  });

  it('rejects a record without a document ID', () => {
    const line = '{"documentType":"post","level":"error","markers":[]}';

    expect(() => parseValidationOutput(line)).toThrow(
      new Error('Malformed validation output on line 1.'),
    );
  });

  it('rejects a marker with a level the CLI does not report', () => {
    const line = JSON.stringify({
      documentId: 'post-1',
      documentType: 'post',
      level: 'error',
      markers: [{ code: 'custom', level: 'fatal', message: 'x', path: ['title'] }],
    });

    expect(() => parseValidationOutput(line)).toThrow(
      new Error('Malformed validation output on line 1.'),
    );
  });

  it('rejects a path segment that is neither a name, an index nor a keyed object', () => {
    const line = JSON.stringify({
      documentId: 'post-1',
      documentType: 'post',
      level: 'error',
      markers: [{ code: 'custom', level: 'error', message: 'x', path: [true] }],
    });

    expect(() => parseValidationOutput(line)).toThrow(
      new Error('Malformed validation output on line 1.'),
    );
  });
});
