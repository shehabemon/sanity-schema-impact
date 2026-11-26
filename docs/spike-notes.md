# Spike notes: `sanity schema extract`

Run against `fixtures/studio` at `102092e`. Versions: `@sanity/cli` 8.35.0, `sanity` 6.25.0, Node 22.19.0, pnpm 12.23.0.

Throwaway scripts and outputs live outside the repo. `$SCRATCH` below is that folder. Where I tried a schema change, I edited the fixture in place, extracted, and reverted with `git checkout`. The committed `fixtures/studio/schema.json` was never written by the spike.

Baseline, used everywhere below:

```
$ cd fixtures/studio && ./node_modules/.bin/sanity schema extract --enforce-required-fields --path $SCRATCH/spike/singular.json
- Extracting schema with enforced required fields
✔ Extracted schema to $SCRATCH/spike/singular.json with enforced required fields
# exit 0, stdout empty
$ cmp $SCRATCH/spike/singular.json fixtures/studio/schema.json && echo "singular == committed"
singular == committed
```

## 1. Top-level shape

```
$ node shape.mjs singular.json
isArray true length 21
document   product      name,type,attributes
type       post.reference  type,name,value  object
type       slug         name,type,value  object
document   sanity.imageAsset name,type,attributes
...
```

I assumed every entry would be `{type, name, value}`. That's wrong for documents. The 14 type entries are `{type: "type", name, value}`. The 7 documents are `{type: "document", name, attributes}`.

- **7 documents:** `post`, `product`, `category`, `author` (ours), and `system.release`, `sanity.imageAsset`, `sanity.fileAsset` (Sanity's).
- **10 named object types:** `slug`, `geopoint`, and eight `sanity.*` types (`sanity.imageCrop`, `sanity.imageHotspot`, `sanity.imageDimensions`, `sanity.imageMetadata`, `sanity.imagePalette`, `sanity.imagePaletteSwatch`, `sanity.assetSourceData`, `sanity.releaseMetadata`).
- **4 generated reference types:** `post.reference`, `author.reference`, `category.reference`, `sanity.imageAsset.reference`. Each has `value.dereferencesTo` pointing at its target. A `<T>.reference` only exists while something references `T`. Removing `product` (the only thing that references `post`) also removed `post.reference` (see the change kinds below).
- `geopoint` and `system.release` are listed although no fixture source uses them. The list includes Sanity's default types, so the diff has to filter them out.

References:

- A field that points at a named type is `{type: "inline", name}`. Examples: `post.author` gives `{"type":"inline","name":"author.reference"}`, and `slug` gives `{"type":"inline","name":"slug"}`.
- A registered top-level object type works the same way. I changed `author.social` from an inline `type: 'object'` to a registered `socialBlock` type and extracted:

  ```
  author.social = {"type":"objectAttribute","value":{"type":"inline","name":"socialBlock"}}
  top-level socialBlock present: true   (entries: 21 -> 22)
  ```

- An inline object (the old `social`, or `variant` in `product.variants`) is a nested `{type: "object", attributes}` with no top-level entry. Its name survives only as a `_type` literal.

Consequence: a change inside a registered named type shows up in that type's top-level entry, not under the field path that uses it. The normaliser has to expand `inline` references, or it will attribute changes to the wrong place.

## 2. Field shapes

Flattened with a throwaway script (`node flatten.mjs singular.json <doc>`). `[]` marks array members and `[required]` marks `optional: false`.

```
# product
title: string
variants[].sku: string
variants[].price.amount: number
variants[].price.currency: string
variants[]._type = "variant"
tags[]: string
relatedPosts[] -> ref(post)
legacySku: string

# post (trimmed; `...` marks the omitted middle)
title: string [required]
slug._type = "slug"
slug.current: string [required]
slug.source: string
featuredImage.asset -> ref(sanity.imageAsset)
featuredImage.media: unknown
featuredImage.hotspot._type = "sanity.imageHotspot"
featuredImage.hotspot.x: number [required]
featuredImage.hotspot.y: number [required]
featuredImage.hotspot.height: number [required]
featuredImage.hotspot.width: number [required]
featuredImage.crop._type = "sanity.imageCrop"
featuredImage.crop.top: number [required]
featuredImage.crop.bottom: number [required]
featuredImage.crop.left: number [required]
featuredImage.crop.right: number [required]
featuredImage._type = "image"
author -> ref(author)
categories[] -> ref(category)
body[].children[].marks[]: string
...
seo.ogImage.crop.left: number [required]
seo.ogImage.crop.right: number [required]
seo.ogImage._type = "image"
publishedAt: string
```

Body lines (also in the flattened output, trimmed): `body[].children[].text: string`, `body[].children[]._type = "span"`, `body[].children[].handle: string`, `body[].children[]._type = "inlineMention"`, `body[].markDefs[].href: string`, `body[].markDefs[]._type = "link"`, `body[].style: string = "normal"` (plus the other style literals), `body[].level: number`, `body[]._type = "block"`.

By field kind:

- **Strings, numbers:** `string` and `number`. Text (`seo.description`) and url (`author.social.links[].url`) are also `string`.
- **Datetime:** `publishedAt` is `string`. I changed it to `date` in the source and the extract was byte-identical. Datetime, date, string, text and url can't be told apart structurally.
- **Nested object (`seo`):** `object` with `attributes`. Path: `seo.title`.
- **Array of objects (`variants`):** `array` whose `of` is an `object` with `attributes` (`sku`, `price`, `_type: "variant"`). The `_key` sits under `rest`. Path: `variants[].price.amount`.
- **Array of strings (`tags`):** `array` of `string`, no `_key`.
- **Reference (`author`):** `{type: "inline", name: "author.reference"}`. Resolve it through `dereferencesTo` to get `author`.
- **Array of references (`categories`):** `of` is an `object` with `_key` under `attributes` and `rest: {type: "inline", name: "category.reference"}`. The `_key` and the reference sit in different places than in object arrays.
- **Image (`featuredImage`, `seo.ogImage`):** `object` with `_type: "image"`, `asset` (reference to `sanity.imageAsset`), `media` (`unknown`), `hotspot` and `crop` (inline built-ins). `seo.ogImage` has no `hotspot` option, but it still gets `hotspot` and `crop`. The extract doesn't record image options.
- **Slug (`slug`):** `inline slug` pointing at the built-in `slug` object. `current` is required under the flag. `source` is optional.
- **Portable text (`body`):** `array` of `object` with `_type: "block"`, `children` (a union of `span` and the custom `inlineMention`), `markDefs` (link annotations with `href`), `style` and `listItem` (string literal unions), `level`. Spans carry `marks` as plain `string[]`, so the allowed decorators aren't listed. Only annotations show up, via `markDefs`.

Flattening rules I'm using: `[]` for array members, `_type` literals as pseudo-attributes, `_key`/`_id`/`_createdAt`/`_updatedAt`/`_rev` skipped, union members share a path.

## 3. Required

```
$ node jsondiff.mjs singular.json noflag.json    # noflag = extract without --enforce-required-fields
~ post.attributes.title.optional: false -> true
~ slug.value.attributes.current.optional: false -> true
~ sanity.imageCrop.value.attributes.top.optional: false -> true
...
[29 differences]
```

- With the flag, `post.title` (`rule.required()`) is `optional: false`. Without it, `optional: true`. Without the flag, `required()` leaves no trace at all.
- The flag also marks Sanity's built-in attributes as required (`slug.current`, `sanity.imageCrop.*`, `sanity.fileAsset.*`). Those flip too.
- `post.slug` has no `required()` in the fixture, so it's `optional: true` in both runs. Adding `required()` to it gives `~ post.attributes.slug.optional: true -> false` (see the newly-required fixture).

## 4. What is absent

I added each rule to a different fixture field, extracted with the flag, and diffed against the baseline:

```
$ node jsondiff.mjs singular.json probe-validation.json
~ product.attributes.legacySku.value.type: "string" -> "union"
+ product.attributes.legacySku.value.of
[2 differences]
```

| Attribute         | Field                  | In extract                                            |
| ----------------- | ---------------------- | ----------------------------------------------------- |
| `min(3).max(120)` | `post.title`           | no                                                    |
| `regex(...)`      | `product.title`        | no                                                    |
| `custom(...)`     | `product.tags`         | no                                                    |
| `deprecated`      | `post.seo.title`       | no                                                    |
| `description`     | `post.publishedAt`     | no (`product.legacySku` already has one, also absent) |
| `hidden`          | `product.relatedPosts` | no                                                    |
| `readOnly`        | `category.title`       | no                                                    |
| `initialValue`    | `author.name`          | no                                                    |
| field `title`     | `post.featuredImage`   | no (the `Featured image` label never appears)         |
| `options.list`    | `product.legacySku`    | yes: `string` becomes a union of the literal values   |

Also absent: the `datetime` → `date` change (byte-identical, see above).

What the structural diff can detect: entries, paths, leaf kinds (string, number, boolean, unknown), `_type` literals, reference targets, array member kinds, union literals (list options), required (only with the flag).

What it can't: validation rules other than `required()` (min, max, regex, custom, warnings), `deprecated`, `hidden`, `readOnly`, `initialValue`, `description`, titles, and datetime vs date vs string vs text vs url.

The first group belongs to the validation diff. The second group doesn't change what existing content means, except datetime vs date, which changes the valid format, so that also goes to the validation diff.

## 5. Determinism

```
$ shasum -a 256 singular.json run2.json | cut -c1-20    # run2 = second extract of the same schema
61756d1302b0afe5f83b
61756d1302b0afe5f83b
$ cmp run2.json singular.json   # no output: identical
```

Order is stable across runs. It isn't alphabetical (`post.reference` comes first). Reordering fields changes the bytes but not the structure:

```
$ node jsondiff.mjs singular.json probe-order.json   # post's publishedAt moved to the top of its fields
(no structural differences)
[0 differences]
$ cmp singular.json probe-order.json  # bytes differ
```

So the diff has to key on entry name and field name, never on array index or raw bytes. Sort before any byte comparison, if one is ever needed.

## 6. CLI

- **`schema` vs `schemas`:** both work and produce the same output. The help text shows `sanity schemas extract` as the usage line.
- **`--path`:** writes the file. Stdout stays empty. Progress lines go to stderr.
- **Experimental warning:** there is no runtime warning on either stream. The only mention is in `--help`: "Note: This command is experimental and subject to change."
- **Broken schema** (`post.author` pointed at a missing type):

  ```
  $ sanity schema extract --enforce-required-fields --path $SCRATCH/spike/broken.json
  # stdout
  [ERROR] [post]
    author.<unnamed_type_@_index_0>
      ✖ Unknown type: nope.
  # stderr
  - Extracting schema with enforced required fields
  ✖ Failed to extract schema with enforced required fields
  # exit 1, no file written
  ```

- **`--workspace`:** I added a second workspace to a temporary `sanity.config.ts`. Each workspace needs a `basePath`, or the command refuses to run.

  | Command                                    | Exit | Result                                                             |
  | ------------------------------------------ | ---- | ------------------------------------------------------------------ |
  | no `--workspace`                           | 1    | `Multiple workspaces found… Available workspaces: default, second` |
  | `--workspace second`                       | 0    | 15 entries (`category` and the core types)                         |
  | `--workspace default`                      | 0    | bytes identical to `singular.json`                                 |
  | `--workspace missing`                      | 1    | `Could not find "missing" workspace`                               |
  | `--path` to an existing file, no `--force` | 2    | `Schema file already exists… Pass --force to overwrite it.`        |

## 7. Worktree

I used `git worktree add --detach <scratch>/wt HEAD` and ran each case in it.

| Case                                                         | Command                                       | Result                                                                                     | Real time                      |
| ------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| (a) no `node_modules`, direct binary                         | `./node_modules/.bin/sanity schema extract …` | exit 127, no such file                                                                     | —                              |
| (a) no `node_modules`, pnpm                                  | `pnpm exec sanity schema extract …`           | pnpm installed the workspace from the store (`Done in 1.1s`), then the extract ran. Exit 0 | 7.81 s                         |
| (b) symlinked `node_modules` (root and `fixtures/studio`)    | `./node_modules/.bin/sanity schema extract …` | exit 0, output identical to `schema.json`. `tsc -v` through the root link: 6.0.3           | 5.74 s                         |
| (c) `pnpm install --frozen-lockfile --offline`, then extract | `pnpm install --frozen-lockfile --offline`    | exit 0, `Done in 1.1s`, 1002 packages reused                                               | 1.10 s install, 6.66 s extract |

Notes:

- `pnpm exec` in a checkout without `node_modules` installed the whole workspace before running the command. I passed no install flags. CI should run `pnpm install --frozen-lockfile` explicitly.
- My first run of case (a) was cut off by `head`, which left a partial `node_modules`. I removed that worktree and redid the case from scratch. The numbers above come from the clean run.
- The symlinks were removed by name, before the offline install, so pnpm never wrote into the main checkout.
- Cleanup: `git worktree remove --force`, then `git worktree prune`. I used `--force` straight away and never tried a plain remove. `git worktree list` shows only the main checkout, and the main `node_modules` is intact.

## 8. `documents validate --file` (quick check)

```
$ sanity documents validate --help    # lists --file, --format json|ndjson|pretty, --level, --yes
$ sanity documents validate --file bad2.ndjson --format pretty --level info --yes </dev/null
- Loading workspace…
✔ Loaded workspace 'default' using project <id from the local .env> and dataset <name from the local .env> (5.3s)
- Checking reference existence…
✔ Checked all references (0.0s)
- Validating 0 documents…
✔ Validated 0 documents (0.0s)

Validation results:
✔ Valid:    0 documents
✖ Errors:   0 documents, 0 errors
⚠ Warnings: 0 documents, 0 warnings
ℹ Info:     0 documents, 0 markers
```

- The flags exist. With `--file`, the command still loaded a real workspace from the project in the local `.env`, so it reads from that project. I only ran validation, never a write command.
- It reported `Validating 0 documents` for a file containing two documents, one missing its required `title` and one with a wrong field type. So the file input is not being used here.
- I stopped there, because the check was meant to end at a dataset or auth requirement. The command needs a reachable dataset. I didn't test whether it also needs a token, and I didn't export anything.

## Proposed normalised shape

```ts
// Built from the extract: `inline` references expanded, system attributes
// (_id, _type, _createdAt, _updatedAt, _rev) and _key dropped, generated
// `*.reference` and Sanity-owned types excluded.
export type NormalisedSchema = Record<DocType, Record<FieldPath, FieldEntry>>;

export type DocType = string;

/** Dotted path; `[]` marks array members, e.g. `variants[].price.amount`. */
export type FieldPath = string;

export type FieldKind =
  'string' | 'number' | 'boolean' | 'unknown' | 'object' | 'array' | 'reference';

export interface FieldEntry {
  kind: FieldKind;
  /** Only meaningful when both extracts used --enforce-required-fields. */
  required: boolean;
  /** `_type` literal of an object: 'image', 'slug', 'block', 'sanity.imageCrop', 'variant'. */
  typeName?: string;
  /** Target document type of a reference. */
  refTo?: string;
  /** Kind of the array's members. */
  of?: FieldKind;
  /** `_type` literal of the array's members. */
  itemTypeName?: string;
  /** Literal values of a string union (list options), in extract order. */
  options?: readonly string[];
}
```

## Change kinds the diff engine can detect

Revised from the original six kinds. Each rule runs on two normalised maps (base and head).

- **`removed-type`:** a user document type or named object type exists in base and not in head. Ignore `*.reference`, `system.*`, `sanity.*`, `geopoint` and `slug`. Seen with `product`: the `product` entry and the derived `post.reference` both disappear.
- **`removed-field`:** a path exists in base and not in head, under the same document type. Report only the top-most removed path. Seen with `product.legacySku`.
- **`added-field`:** a path exists in head only. Seen with `post.subtitle`.
- **`type-changed`:** same path, and `kind`, `typeName`, `refTo`, `of` or `itemTypeName` differs. Seen with `product.title` (`string` → `number`). Can't see datetime, date, string, text or url changes.
- **`newly-required`:** same path, `required` goes from false to true. Only compare when both extracts used the flag. Seen with `post.slug`.
- **`possible-rename`:** one `removed-field` and one `added-field` in the same document type and parent, with identical `kind`, `typeName`, `refTo`, `of` and `itemTypeName`. Only report it when there is exactly one candidate on each side, otherwise report removed and added separately. Seen with `post.featuredImage` → `post.heroImage`.
- **`options-changed` (new, not in the original list):** a string union's values differ between base and head. Removed values can break existing content. Seen with the `options.list` probe.

Not detectable structurally, so they stay with the validation diff: validation rules other than `required()`, datetime vs date vs string vs text vs url, and anything that only changes Studio UI (`deprecated`, `hidden`, `readOnly`, `initialValue`, `description`, titles).

## Surprises

- Document entries use `attributes`, not `value`.
- Images are `object` with a `_type` literal, not `image`.
- Datetime is `string`.
- `hotspot` and `crop` are emitted for every image.
- Core types (`geopoint`, `system.release`, `sanity.*`) are in every extract. A Sanity version change between base and head would probably change them too. I haven't tested that, so the diff should filter them.
- Registered named types are referenced by `inline`, and their contents sit in their own top-level entry. Changes inside them don't show under the field path.
- The experimental command gives no runtime warning.
- `pnpm exec` installs the workspace when `node_modules` is missing.
