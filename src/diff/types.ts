// Raw extract nodes. Only the keys the diff reads are typed; anything else
// stays unknown and is narrowed where it is used (see normalise.ts).

export interface RawObjectNode {
  readonly type: 'object';
  readonly attributes: Record<string, unknown>;
  readonly rest?: unknown;
  readonly dereferencesTo?: unknown;
}

export interface RawInlineNode {
  readonly type: 'inline';
  readonly name: string;
}

export interface RawScalarNode {
  readonly type: 'string' | 'number' | 'boolean' | 'unknown';
  readonly literal?: string | undefined;
}

export interface RawArrayNode {
  readonly type: 'array';
  readonly of: unknown;
}

export interface RawUnionNode {
  readonly type: 'union';
  readonly of: readonly unknown[];
}

export type RawNode = RawObjectNode | RawInlineNode | RawScalarNode | RawArrayNode | RawUnionNode;

export interface RawTypeEntry {
  readonly type: 'type';
  readonly name: string;
  readonly value: unknown;
}

export interface RawDocumentEntry {
  readonly type: 'document';
  readonly name: string;
  readonly attributes: unknown;
}

export type RawEntry = RawTypeEntry | RawDocumentEntry;

export type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'reference'
  | 'image'
  | 'file'
  | 'slug'
  | 'portableText'
  | 'union'
  | 'unknown';

export interface FieldInfo {
  readonly kind: FieldKind;
  readonly required: boolean;
  /** The `_type` literal of an object. */
  readonly typeName?: string;
  /** Sorted target document types of a reference. */
  readonly refTo?: readonly string[];
  /** Sorted member kinds or `_type` names of an array, union or portable text. */
  readonly of?: readonly string[];
  /** Sorted literal values of a string union. */
  readonly values?: readonly string[];
}

/** docType -> fieldPath -> FieldInfo */
export type NormalisedSchema = Map<string, Map<string, FieldInfo>>;

export type Change =
  | { readonly kind: 'removed-type'; readonly docType: string }
  | {
      readonly kind: 'removed-field';
      readonly docType: string;
      readonly path: string;
      readonly before: FieldInfo;
    }
  | {
      readonly kind: 'added-field';
      readonly docType: string;
      readonly path: string;
      readonly after: FieldInfo;
    }
  | {
      readonly kind: 'type-changed';
      readonly docType: string;
      readonly path: string;
      readonly before: FieldInfo;
      readonly after: FieldInfo;
      readonly detail: string;
    }
  | {
      readonly kind: 'newly-required' | 'no-longer-required';
      readonly docType: string;
      readonly path: string;
      readonly before: FieldInfo;
      readonly after: FieldInfo;
    }
  | {
      readonly kind: 'possible-rename';
      readonly docType: string;
      readonly from: string;
      readonly to: string;
      readonly before: FieldInfo;
      readonly after: FieldInfo;
    }
  | {
      readonly kind: 'options-changed';
      readonly docType: string;
      readonly path: string;
      readonly before: FieldInfo;
      readonly after: FieldInfo;
      readonly removed: readonly string[];
      readonly added: readonly string[];
    };

export type ChangeKind = Change['kind'];
