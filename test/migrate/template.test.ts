import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { renderMigration, type MigrationTemplate } from '../../src/migrate/template.js';

function parseErrors(source: string): string[] {
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return (result.diagnostics ?? []).map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  );
}

const templates: Record<string, MigrationTemplate> = {
  'a top-level field': { kind: 'unset', docType: 'post', path: 'featuredImage' },
  'a nested field': { kind: 'unset', docType: 'post', path: 'seo.title' },
  'a field inside an array': { kind: 'unset', docType: 'product', path: 'variants[].price' },
  'a nested field inside an array member': {
    kind: 'unset',
    docType: 'product',
    path: 'variants[].price.amount',
  },
  'a top-level rename': { kind: 'rename', docType: 'post', from: 'featuredImage', to: 'heroImage' },
  'a nested rename': { kind: 'rename', docType: 'post', from: 'seo.title', to: 'seo.heading' },
  'a removed type': { kind: 'delete', docType: 'category' },
};

describe('renderMigration', () => {
  it('unsets a top-level field on the documents that still hold it', () => {
    const source = renderMigration({ kind: 'unset', docType: 'post', path: 'featuredImage' });

    expect(source).toContain('import { at, defineMigration, unset } from "sanity/migrate";');
    expect(source).toContain('documentTypes: ["post"],');
    expect(source).toContain('filter: "defined(featuredImage)",');
    expect(source).toContain('return at("featuredImage", unset());');
  });

  it('uses a dotted path for a nested object field', () => {
    const source = renderMigration({ kind: 'unset', docType: 'post', path: 'seo.title' });

    expect(source).toContain('filter: "defined(seo.title)",');
    expect(source).toContain('return at("seo.title", unset());');
  });

  it('addresses each array member by its key for a field inside an array', () => {
    const source = renderMigration({
      kind: 'unset',
      docType: 'product',
      path: 'variants[].price',
    });

    expect(source).toContain('filter: "count(variants[defined(price)]) > 0",');
    expect(source).toContain('const steps = ["variants[]", "price"];');
    expect(source).toContain('fieldPaths(doc, steps).map((path) => at(path, unset()))');
    expect(source).toContain('typeof key === "string"');
  });

  it('copies the value to the new field only where the new field is empty', () => {
    const source = renderMigration({
      kind: 'rename',
      docType: 'post',
      from: 'featuredImage',
      to: 'heroImage',
    });

    expect(source).toContain('filter: "defined(featuredImage)",');
    expect(source).toContain('if (value === undefined || valueAt(doc, "heroImage") !== undefined)');
    expect(source).toContain(
      'return [at("heroImage", setIfMissing(value)), at("featuredImage", unset())];',
    );
  });

  it('warns that a rename was guessed from the schema', () => {
    const source = renderMigration({
      kind: 'rename',
      docType: 'post',
      from: 'featuredImage',
      to: 'heroImage',
    });

    expect(source).toContain('The schema diff guessed this rename');
  });

  it('keeps the delete as a commented line with a note on the references', () => {
    const source = renderMigration({ kind: 'delete', docType: 'category' });

    expect(source).toContain('// return delete_(doc._id);');
    expect(source).toContain('TODO: Deleting fails while other documents still reference this one');
    expect(source).toContain('return [];');
    expect(source).not.toMatch(/^\s*return delete_\(/m);
  });

  it('says which change the file was scaffolded for, in the header', () => {
    const source = renderMigration({ kind: 'unset', docType: 'post', path: 'seo.title' });

    expect(
      source.startsWith('// Scaffolded by sanity-schema-impact for removed-field post.seo.title.'),
    ).toBe(true);
  });

  it.each(Object.entries(templates))('writes %s as TypeScript that parses', (_, template) => {
    expect(parseErrors(renderMigration(template))).toEqual([]);
  });

  it('refuses a document type that is not a plain name', () => {
    expect(() =>
      renderMigration({ kind: 'delete', docType: 'post"); process.exit(1); //' }),
    ).toThrow('Unsafe document type name');
  });

  it('refuses a field name outside the allowlist, so no code can be injected', () => {
    expect(() =>
      renderMigration({ kind: 'unset', docType: 'post', path: 'title"); evil(); //' }),
    ).toThrow('Unsafe field name');
  });

  it('refuses a newline in a name, which would leave the header comment', () => {
    expect(() =>
      renderMigration({ kind: 'unset', docType: 'post', path: 'title\nevil()' }),
    ).toThrow('Unsafe field name');
  });
});
