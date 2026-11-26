import { hasData, parsePath } from '../impact/query-builder.js';

export type MigrationTemplate =
  | { readonly kind: 'unset'; readonly docType: string; readonly path: string }
  | {
      readonly kind: 'rename';
      readonly docType: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly kind: 'delete'; readonly docType: string };

const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Every value that reaches the file is either checked against an allowlist or made a JSON string. */
const literal = (value: string): string => JSON.stringify(value);
const list = (values: readonly string[]): string => `[${values.map(literal).join(', ')}]`;

function typeName(name: string): string {
  if (!TYPE_NAME.test(name)) throw new Error(`Unsafe document type name "${name}".`);
  return name;
}

function header(origin: string): string[] {
  return [
    `// Scaffolded by sanity-schema-impact for ${origin}.`,
    '// Review it before running. Without --no-dry-run the CLI only prints the patches.',
  ];
}

function defineFile(options: {
  readonly imports: string;
  readonly origin: string;
  readonly notes?: readonly string[];
  readonly helpers?: readonly string[];
  readonly title: string;
  readonly docType: string;
  readonly filter?: string;
  readonly signature: string;
  readonly hook: readonly string[];
}): string {
  const lines = [
    ...header(options.origin),
    ...(options.notes ?? []).map((note) => `// ${note}`),
    '',
    `import { ${options.imports} } from "sanity/migrate";`,
    '',
    ...(options.helpers ?? []),
    'export default defineMigration({',
    `  title: ${literal(options.title)},`,
    `  documentTypes: ${list([options.docType])},`,
    ...(options.filter === undefined ? [] : [`  filter: ${literal(options.filter)},`]),
    '  migrate: {',
    `    ${options.signature} {`,
    ...options.hook.map((line) => `      ${line}`),
    '    },',
    '  },',
    '});',
  ];
  return `${lines.join('\n')}\n`;
}

const ARRAY_HELPER = [
  '// Sanity addresses array members by _key. Each `[]` step becomes a keyed segment, and',
  "// members without a _key are skipped because there's no way to address them.",
  'type Segment = string | { _key: string };',
  '',
  'function fieldPaths(node: unknown, steps: readonly string[]): Segment[][] {',
  '  const [step, ...rest] = steps;',
  '  if (step === undefined) return [[]];',
  '  const isArray = step.endsWith("[]");',
  '  const name = isArray ? step.slice(0, -2) : step;',
  '  const value = (node as Record<string, unknown> | null | undefined)?.[name];',
  '  if (value === undefined || value === null) return [];',
  '  if (!isArray) return fieldPaths(value, rest).map((tail) => [name, ...tail]);',
  '  if (!Array.isArray(value)) return [];',
  '  return value.flatMap((member: unknown) => {',
  '    const key = (member as { _key?: unknown } | null | undefined)?._key;',
  '    if (typeof key === "string") {',
  '      return fieldPaths(member, rest).map((tail) => [name, { _key: key }, ...tail]);',
  '    }',
  '    return [];',
  '  });',
  '}',
  '',
];

const VALUE_HELPER = [
  '/** Reads a dotted path, or returns undefined where the path stops. */',
  'function valueAt(node: unknown, path: string): unknown {',
  '  return path.split(".").reduce<unknown>(',
  '    (current, name) => (current as Record<string, unknown> | null | undefined)?.[name],',
  '    node,',
  '  );',
  '}',
  '',
];

function unsetSource(docType: string, path: string): string {
  typeName(docType);
  const segments = parsePath(path);
  const filter = hasData(segments);
  const title = `Remove ${docType}.${path}`;
  const origin = `removed-field ${docType}.${path}`;

  if (segments.some((segment) => segment.array)) {
    return defineFile({
      imports: 'defineMigration, at, unset',
      origin,
      helpers: ARRAY_HELPER,
      title,
      docType,
      filter,
      signature: 'document(doc)',
      hook: [
        `const steps = ${list(path.split('.'))};`,
        'return fieldPaths(doc, steps).map((path) => at(path, unset()));',
      ],
    });
  }

  return defineFile({
    imports: 'at, defineMigration, unset',
    origin,
    title,
    docType,
    filter,
    signature: 'document()',
    hook: [`return at(${literal(path)}, unset());`],
  });
}

function renameSource(docType: string, from: string, to: string): string {
  typeName(docType);
  parsePath(from);
  parsePath(to);

  return defineFile({
    imports: 'at, defineMigration, setIfMissing, unset',
    origin: `possible-rename ${docType}.${from} to ${to}`,
    notes: ['The schema diff guessed this rename from matching field types. Check that it is one.'],
    helpers: VALUE_HELPER,
    title: `Rename ${docType}.${from} to ${to}`,
    docType,
    filter: hasData(parsePath(from)),
    signature: 'document(doc)',
    hook: [
      `const value = valueAt(doc, ${literal(from)});`,
      '// A document that already has a value in the new field keeps both, so nothing is dropped.',
      `if (value === undefined || valueAt(doc, ${literal(to)}) !== undefined) return [];`,
      `return [at(${literal(to)}, setIfMissing(value)), at(${literal(from)}, unset())];`,
    ],
  });
}

function deleteSource(docType: string): string {
  typeName(docType);

  return defineFile({
    imports: 'defineMigration, delete_',
    origin: `removed-type ${docType}`,
    title: `Delete ${docType} documents`,
    docType,
    signature: 'document(doc)',
    hook: [
      '// TODO: Deleting fails while other documents still reference this one, and the content is',
      '// gone for good. Find and fix those references first, then uncomment the line below.',
      '// return delete_(doc._id);',
      'return [];',
    ],
  });
}

/**
 * The source of one migration file. Names are checked before they're used, so a value can't
 * close a string or a comment early. Throws for a name outside the allowlist.
 */
export function renderMigration(template: MigrationTemplate): string {
  switch (template.kind) {
    case 'unset':
      return unsetSource(template.docType, template.path);
    case 'rename':
      return renameSource(template.docType, template.from, template.to);
    case 'delete':
      return deleteSource(template.docType);
  }
}
