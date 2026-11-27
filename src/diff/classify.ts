import type { Change, FieldInfo, NormalisedSchema } from './types.js';

interface Entry {
  readonly path: string;
  readonly info: FieldInfo;
}

interface Pair {
  readonly path: string;
  readonly before: FieldInfo;
  readonly after: FieldInfo;
}

export function diffSchemas(base: NormalisedSchema, head: NormalisedSchema): Change[] {
  const changes: Change[] = [];

  for (const docType of base.keys()) {
    if (!head.has(docType)) changes.push({ kind: 'removed-type', docType });
  }

  for (const [docType, headFields] of head) {
    const baseFields = base.get(docType);
    if (baseFields !== undefined) {
      changes.push(...diffDocument(docType, baseFields, headFields));
    }
  }

  return changes.sort(compareChanges);
}

function diffDocument(
  docType: string,
  base: ReadonlyMap<string, FieldInfo>,
  head: ReadonlyMap<string, FieldInfo>,
): Change[] {
  const common: Pair[] = [];
  const removed: Entry[] = [];
  for (const [path, before] of base) {
    const after = head.get(path);
    if (after === undefined) removed.push({ path, info: before });
    else common.push({ path, before, after });
  }

  const added: Entry[] = [];
  for (const [path, info] of head) {
    if (!base.has(path)) added.push({ path, info });
  }

  const typeChanged = new Set(
    common
      .filter((pair) => typeSignature(pair.before) !== typeSignature(pair.after))
      .map((pair) => pair.path),
  );

  const changes: Change[] = [];

  for (const { path, before, after } of common) {
    if (hasAncestorIn(path, typeChanged)) continue;

    if (typeChanged.has(path)) {
      changes.push({
        kind: 'type-changed',
        docType,
        path,
        before,
        after,
        detail: `${describe(before)} → ${describe(after)}`,
      });
    } else if (JSON.stringify(valuesOf(before)) !== JSON.stringify(valuesOf(after))) {
      changes.push({
        kind: 'options-changed',
        docType,
        path,
        before,
        after,
        removed: valuesOf(before).filter((value) => !valuesOf(after).includes(value)),
        added: valuesOf(after).filter((value) => !valuesOf(before).includes(value)),
      });
    }

    if (!before.required && after.required) {
      changes.push({ kind: 'newly-required', docType, path, before, after });
    }
    if (before.required && !after.required) {
      changes.push({ kind: 'no-longer-required', docType, path, before, after });
    }
  }

  const removedFields = collapse(removed, typeChanged);
  const addedFields = collapse(added, typeChanged);
  const {
    removed: unpairedRemoved,
    added: unpairedAdded,
    renames,
  } = pairRenames(removedFields, addedFields);

  for (const { from, to } of renames) {
    changes.push({
      kind: 'possible-rename',
      docType,
      from: from.path,
      to: to.path,
      before: from.info,
      after: to.info,
    });
  }
  for (const entry of unpairedRemoved) {
    changes.push({ kind: 'removed-field', docType, path: entry.path, before: entry.info });
  }
  for (const entry of unpairedAdded) {
    changes.push({ kind: 'added-field', docType, path: entry.path, after: entry.info });
  }

  return changes;
}

/** Keeps only the highest path of each removed or added subtree, and drops anything under a type change. */
function collapse(entries: readonly Entry[], typeChanged: ReadonlySet<string>): Entry[] {
  const paths = new Set(entries.map((entry) => entry.path));
  return entries.filter(
    ({ path }) => !hasAncestorIn(path, paths) && !hasAncestorIn(path, typeChanged),
  );
}

function pairRenames(
  removed: readonly Entry[],
  added: readonly Entry[],
): { removed: Entry[]; added: Entry[]; renames: { from: Entry; to: Entry }[] } {
  const removedByShape = groupByShape(removed);
  const addedByShape = groupByShape(added);
  const renames: { from: Entry; to: Entry }[] = [];
  const renamedFrom = new Set<string>();
  const renamedTo = new Set<string>();

  for (const [key, fromGroup] of removedByShape) {
    const toGroup = addedByShape.get(key) ?? [];
    const from = fromGroup[0];
    const to = toGroup[0];
    if (fromGroup.length !== 1 || toGroup.length !== 1 || from === undefined || to === undefined) {
      continue;
    }
    if (isPlainScalar(from.info) && !sharesNameWord(from.path, to.path)) continue;
    renames.push({ from, to });
    renamedFrom.add(from.path);
    renamedTo.add(to.path);
  }

  return {
    removed: removed.filter((entry) => !renamedFrom.has(entry.path)),
    added: added.filter((entry) => !renamedTo.has(entry.path)),
    renames,
  };
}

/** Array members are never renamed. A rename must share the parent path and the field shape. */
function groupByShape(entries: readonly Entry[]): Map<string, Entry[]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (entry.path.endsWith('[]')) continue;
    const key = `${parentOf(entry.path)}\u0000${typeSignature(entry.info)}${JSON.stringify(valuesOf(entry.info))}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Text, number and boolean fields with no option list. Their shape is the same for many fields,
 * so a rename between them also needs the names to agree.
 */
function isPlainScalar(info: FieldInfo): boolean {
  const scalar = info.kind === 'string' || info.kind === 'number' || info.kind === 'boolean';
  return scalar && info.typeName === undefined && valuesOf(info).length === 0;
}

/** The lower-cased words of the last path segment, split on camelCase, underscores and dashes. */
function nameWords(path: string): string[] {
  return path
    .slice(path.lastIndexOf('.') + 1)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((word) => word !== '');
}

function sharesNameWord(a: string, b: string): boolean {
  const words = new Set(nameWords(a));
  return nameWords(b).some((word) => words.has(word));
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(0, index);
}

/** Every proper prefix of a path that ends at a `.` or a `[]` boundary. */
function ancestors(path: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < path.length; index++) {
    if (path[index] === '.') {
      result.push(path.slice(0, index));
    } else if (path.startsWith('[]', index)) {
      result.push(path.slice(0, index));
      if (index + 2 < path.length) result.push(path.slice(0, index + 2));
    }
  }
  return result;
}

function hasAncestorIn(path: string, paths: ReadonlySet<string>): boolean {
  return ancestors(path).some((ancestor) => paths.has(ancestor));
}

function typeSignature(info: FieldInfo): string {
  return JSON.stringify([info.kind, info.typeName ?? null, info.refTo ?? [], info.of ?? []]);
}

function valuesOf(info: FieldInfo): readonly string[] {
  return info.values ?? [];
}

function describe(info: FieldInfo): string {
  switch (info.kind) {
    case 'reference':
      return `ref(${(info.refTo ?? []).join('|')})`;
    case 'array':
      return `${(info.of ?? []).join('|')}[]`;
    case 'portableText':
      return `portableText(${(info.of ?? []).join('|')})`;
    case 'union':
      return `union(${(info.of ?? []).join('|')})`;
    case 'object':
      return info.typeName === undefined ? 'object' : `object(${info.typeName})`;
    default:
      return info.kind;
  }
}

function pathOf(change: Change): string {
  switch (change.kind) {
    case 'removed-type':
      return '';
    case 'possible-rename':
      return change.from;
    default:
      return change.path;
  }
}

function compareChanges(a: Change, b: Change): number {
  return (
    compareStrings(a.docType, b.docType) ||
    compareStrings(pathOf(a), pathOf(b)) ||
    compareStrings(a.kind, b.kind)
  );
}

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
