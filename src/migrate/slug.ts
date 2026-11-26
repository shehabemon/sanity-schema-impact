import type { Change } from '../diff/types.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lowercase words joined by dashes: `featuredImage` gives `featured-image`, `variants[].price` gives `variants-price`. */
export function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.toLowerCase())
    .join('-');
}

function checked(name: string): string {
  if (!SLUG.test(name)) throw new Error(`No usable migration name: "${name}".`);
  return name;
}

/** The migration ID and folder name for a change. */
export function slugFor(change: Change): string {
  switch (change.kind) {
    case 'removed-field':
      return checked(`unset-${words(change.docType)}-${words(change.path)}`);
    case 'possible-rename':
      return checked(
        `rename-${words(change.docType)}-${words(change.from)}-to-${words(change.to)}`,
      );
    case 'removed-type':
      return checked(`delete-${words(change.docType)}-documents`);
    default:
      throw new Error(`No migration slug for ${change.kind}.`);
  }
}

/** Adds -2, -3 and so on to a slug that an earlier entry already used. */
export function uniqueSlugs(slugs: readonly string[]): string[] {
  const used = new Set<string>();
  return slugs.map((slug) => {
    let candidate = slug;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${slug}-${String(n)}`;
      n += 1;
    }
    used.add(candidate);
    return candidate;
  });
}
