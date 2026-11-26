type Scalar = 'string' | 'number' | 'boolean' | 'unknown';

export const str = (literal?: string) =>
  literal === undefined ? { type: 'string' } : { type: 'string', value: literal };

export const num = () => ({ type: 'number' });
export const bool = () => ({ type: 'boolean' });
export const unknownValue = () => ({ type: 'unknown' });

export const scalar = (type: Scalar) => ({ type });

export const inline = (name: string) => ({ type: 'inline', name });
export const array = (of: unknown) => ({ type: 'array', of });
export const union = (...of: unknown[]) => ({ type: 'union', of });

export function object(attributes: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { type: 'object', attributes, ...extra };
}

/** An object attribute as the extract writes it. `required` maps to `optional: false`. */
export const attr = (value: unknown, required = false) => ({
  type: 'objectAttribute',
  value,
  optional: !required,
});

export const typeAttr = (name: string) => ({
  type: 'objectAttribute',
  value: { type: 'string', value: name },
});

/** An object with a `_type` literal, the way named types and array members appear. */
export const named = (
  name: string,
  attributes: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => object({ _type: typeAttr(name), ...attributes }, extra);

export const reference = (target: string | string[]) =>
  object(
    {
      _ref: attr(str(), true),
      _type: typeAttr('reference'),
      _weak: attr(bool()),
    },
    { dereferencesTo: target },
  );

export const typeEntry = (name: string, value: unknown) => ({ type: 'type', name, value });

export function documentEntry(name: string, fields: Record<string, unknown> = {}) {
  return {
    type: 'document',
    name,
    attributes: {
      _id: attr(str(), true),
      _type: typeAttr(name),
      _createdAt: attr(str(), true),
      _updatedAt: attr(str(), true),
      _rev: attr(str(), true),
      ...fields,
    },
  };
}
