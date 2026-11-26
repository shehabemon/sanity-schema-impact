import type {
  FieldInfo,
  FieldKind,
  NormalisedSchema,
  RawNode,
  RawObjectNode,
  RawUnionNode,
} from './types.js';

const SKIPPED_ATTRIBUTES = new Set([
  '_key',
  '_type',
  '_ref',
  '_weak',
  '_id',
  '_rev',
  '_createdAt',
  '_updatedAt',
]);

/** Object `_type`s that stand for a single field and are not descended into. */
const COLLAPSED_TYPES = new Map<string, FieldKind>([
  ['image', 'image'],
  ['file', 'file'],
  ['slug', 'slug'],
]);

const MAX_ALIAS_DEPTH = 16;

interface Context {
  readonly types: ReadonlyMap<string, unknown>;
  readonly fields: Map<string, FieldInfo>;
}

interface FieldParts {
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly typeName?: string | undefined;
  readonly refTo?: readonly string[] | undefined;
  readonly of?: readonly string[] | undefined;
  readonly values?: readonly string[] | undefined;
}

interface Peeled {
  readonly node: RawNode;
  readonly names: readonly string[];
}

export function normalise(extract: unknown): NormalisedSchema {
  if (!Array.isArray(extract)) {
    throw new Error('Unrecognised schema extract: expected an array of entries');
  }

  const types = new Map<string, unknown>();
  const documents: { readonly name: string; readonly attributes: Record<string, unknown> }[] = [];

  extract.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry) || typeof entry.name !== 'string') {
      throw unrecognised(`entry ${index}`, 'expected an object with a name');
    }
    if (entry.type === 'type') {
      if (!('value' in entry)) throw unrecognised(entry.name, 'type entry has no value');
      types.set(entry.name, entry.value);
      return;
    }
    if (entry.type === 'document') {
      if (!isRecord(entry.attributes)) {
        throw unrecognised(entry.name, 'document entry has no attributes');
      }
      documents.push({ name: entry.name, attributes: entry.attributes });
      return;
    }
    throw unrecognised(entry.name, 'unknown entry type');
  });

  const schema: NormalisedSchema = new Map();
  for (const doc of documents) {
    if (isCoreName(doc.name)) continue;
    if (schema.has(doc.name)) throw unrecognised(doc.name, 'duplicate document type');

    const ctx: Context = { types, fields: new Map() };
    emitAttributes(ctx, '', doc.attributes, []);
    schema.set(doc.name, ctx.fields);
  }
  return schema;
}

function emitAttributes(
  ctx: Context,
  prefix: string,
  attributes: Record<string, unknown>,
  stack: readonly string[],
): void {
  for (const [key, raw] of Object.entries(attributes)) {
    if (SKIPPED_ATTRIBUTES.has(key)) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    const { value, required } = readAttribute(raw, path);
    emitField(ctx, path, value, required, stack);
  }
}

function emitField(
  ctx: Context,
  path: string,
  raw: unknown,
  required: boolean,
  stack: readonly string[],
): void {
  const node = narrowNode(raw, path);
  switch (node.type) {
    case 'inline':
      emitNamed(ctx, path, node.name, required, stack);
      return;
    case 'object':
      emitObject(ctx, path, node, required, stack);
      return;
    case 'array':
      emitArray(ctx, path, node.of, required, stack);
      return;
    case 'union':
      emitUnion(ctx, path, node, required, stack);
      return;
    case 'string':
    case 'number':
    case 'boolean':
    case 'unknown':
      setField(ctx, path, { kind: node.type, required });
      return;
  }
}

function emitNamed(
  ctx: Context,
  path: string,
  name: string,
  required: boolean,
  stack: readonly string[],
): void {
  if (stack.includes(name)) {
    setField(ctx, path, { kind: 'object', typeName: name, required });
    return;
  }
  emitField(ctx, path, lookup(ctx, name, path), required, [...stack, name]);
}

function emitObject(
  ctx: Context,
  path: string,
  node: RawObjectNode,
  required: boolean,
  stack: readonly string[],
): void {
  if (node.rest !== undefined) {
    const rest = narrowNode(node.rest, path);
    if (rest.type === 'inline') {
      emitNamed(ctx, path, rest.name, required, stack);
      return;
    }
  }

  if (node.dereferencesTo !== undefined) {
    setField(ctx, path, {
      kind: 'reference',
      refTo: referenceTargets(node.dereferencesTo, path),
      required,
    });
    return;
  }

  const typeName = typeLiteral(node.attributes, path);
  const collapsed = typeName === undefined ? undefined : COLLAPSED_TYPES.get(typeName);
  if (collapsed !== undefined) {
    setField(ctx, path, { kind: collapsed, required });
    return;
  }

  setField(ctx, path, { kind: 'object', typeName, required });
  emitAttributes(ctx, path, node.attributes, stack);
}

function emitArray(
  ctx: Context,
  path: string,
  ofRaw: unknown,
  required: boolean,
  stack: readonly string[],
): void {
  const members = memberNodes(ofRaw, path);
  const names = members.map((member) => describeMember(ctx, member, path)).sort();

  if (names.includes('block')) {
    setField(ctx, path, { kind: 'portableText', of: names, required });
    return;
  }

  setField(ctx, path, { kind: 'array', of: names, required });
  emitField(ctx, `${path}[]`, ofRaw, false, stack);
}

function emitUnion(
  ctx: Context,
  path: string,
  node: RawUnionNode,
  required: boolean,
  stack: readonly string[],
): void {
  const members = node.of.map((member) => narrowNode(member, path));
  const values = literalValues(members);
  if (values !== undefined) {
    setField(ctx, path, { kind: 'string', values, required });
    return;
  }

  const names = members.map((member) => describeMember(ctx, member, path)).sort();
  setField(ctx, path, { kind: 'union', of: names, required });
  for (const member of members) {
    descendMember(ctx, path, member, stack);
  }
}

/** Union members share the parent path, so their attributes are written under it. */
function descendMember(
  ctx: Context,
  path: string,
  member: RawNode,
  stack: readonly string[],
): void {
  const { node, names } = peel(ctx, member, path);
  if (names.some((name) => stack.includes(name))) return;
  if (node.type !== 'object' || node.dereferencesTo !== undefined) return;

  const typeName = typeLiteral(node.attributes, path);
  if (typeName !== undefined && COLLAPSED_TYPES.has(typeName)) return;

  emitAttributes(ctx, path, node.attributes, [...stack, ...names]);
}

function describeMember(ctx: Context, member: RawNode, path: string): string {
  const { node } = peel(ctx, member, path);
  switch (node.type) {
    case 'object': {
      if (node.dereferencesTo !== undefined) return 'reference';
      return typeLiteral(node.attributes, path) ?? 'object';
    }
    case 'union':
      return literalValues(node.of.map((item) => narrowNode(item, path))) === undefined
        ? 'union'
        : 'string';
    case 'array':
      return 'array';
    default:
      return node.type;
  }
}

/** Follows `inline` names and `rest` wrappers until a concrete node is reached. */
function peel(ctx: Context, node: RawNode, path: string): Peeled {
  let current = node;
  const names: string[] = [];
  for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
    if (current.type === 'inline') {
      names.push(current.name);
      current = narrowNode(lookup(ctx, current.name, path), path);
      continue;
    }
    if (current.type === 'object' && current.rest !== undefined) {
      const rest = narrowNode(current.rest, path);
      if (rest.type === 'inline') {
        names.push(rest.name);
        current = rest;
        continue;
      }
    }
    return { node: current, names };
  }
  throw unrecognised(path, 'named types nest too deeply');
}

function memberNodes(ofRaw: unknown, path: string): RawNode[] {
  const node = narrowNode(ofRaw, path);
  return node.type === 'union' ? node.of.map((item) => narrowNode(item, path)) : [node];
}

/** Sorted literal values when every member is a string literal, otherwise undefined. */
function literalValues(members: readonly RawNode[]): string[] | undefined {
  if (members.length === 0) return undefined;
  const values: string[] = [];
  for (const member of members) {
    if (member.type !== 'string' || member.literal === undefined) return undefined;
    values.push(member.literal);
  }
  return values.sort();
}

function setField(ctx: Context, path: string, parts: FieldParts): void {
  // The first write wins. Only union members can collide on a path.
  if (!ctx.fields.has(path)) ctx.fields.set(path, makeInfo(parts));
}

function makeInfo(parts: FieldParts): FieldInfo {
  return {
    kind: parts.kind,
    required: parts.required,
    ...(parts.typeName === undefined ? {} : { typeName: parts.typeName }),
    ...(parts.refTo === undefined ? {} : { refTo: parts.refTo }),
    ...(parts.of === undefined ? {} : { of: parts.of }),
    ...(parts.values === undefined ? {} : { values: parts.values }),
  };
}

function typeLiteral(attributes: Record<string, unknown>, path: string): string | undefined {
  if (!('_type' in attributes)) return undefined;
  const { value } = readAttribute(attributes._type, `${path}._type`);
  const node = narrowNode(value, `${path}._type`);
  return node.type === 'string' ? node.literal : undefined;
}

function referenceTargets(value: unknown, path: string): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const names = value.filter((item: unknown): item is string => typeof item === 'string');
    if (names.length === value.length) return names.sort();
  }
  throw unrecognised(path, 'reference target is not a type name');
}

function lookup(ctx: Context, name: string, path: string): unknown {
  if (!ctx.types.has(name)) throw unrecognised(path, `named type "${name}" is missing`);
  return ctx.types.get(name);
}

function readAttribute(raw: unknown, path: string): { value: unknown; required: boolean } {
  if (!isRecord(raw) || raw.type !== 'objectAttribute' || !('value' in raw)) {
    throw unrecognised(path, 'expected an object attribute');
  }
  return { value: raw.value, required: raw.optional === false };
}

function narrowNode(value: unknown, path: string): RawNode {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw unrecognised(path, 'expected a type node');
  }
  switch (value.type) {
    case 'inline':
      if (typeof value.name === 'string') return { type: 'inline', name: value.name };
      break;
    case 'string':
    case 'number':
    case 'boolean':
    case 'unknown':
      return {
        type: value.type,
        literal: typeof value.value === 'string' ? value.value : undefined,
      };
    case 'object':
      if (isRecord(value.attributes)) {
        return {
          type: 'object',
          attributes: value.attributes,
          rest: value.rest,
          dereferencesTo: value.dereferencesTo,
        };
      }
      break;
    case 'array':
      if ('of' in value) return { type: 'array', of: value.of };
      break;
    case 'union':
      if (Array.isArray(value.of)) return { type: 'union', of: value.of };
      break;
    default:
      throw unrecognised(path, `unsupported node type "${value.type}"`);
  }
  throw unrecognised(path, `malformed "${value.type}" node`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCoreName(name: string): boolean {
  return name.startsWith('sanity.') || name.startsWith('system.');
}

function unrecognised(where: string, reason: string): Error {
  return new Error(`Unrecognised schema extract at ${where}: ${reason}`);
}
