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
- It reported `Validating 0 documents` for a file of two documents. That conclusion was wrong: the file is read. The CLI ignores any NDJSON file under 300 bytes, and my file was probably that small (I didn't keep it). Section 9.8 has the test.
- I stopped there, because the check was meant to end at a dataset or auth requirement. The command needs a reachable dataset. The token question is answered in section 9.7.

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

## 9. documents validate (validation diff)

Live runs against `fixture-dev` with the Studio at `e53f781`, then with three temporary rules on top. The rules were reverted with `git checkout`, and `git diff fixtures/studio` is empty. `$SCRATCH` is this spike's scratch folder. Versions: `@sanity/cli` 8.35.0, Node 22.19.0. I only ran read commands: `documents validate` (never with `--fix`), `datasets export` and `documents query`.

### 9.1 Flags

```
$ sanity documents validate --help    # trimmed
  -d, --dataset                            Override the dataset
  -p, --project                            Override the project ID
  -y, --yes                                Skip the confirmation prompt
      --file                               NDJSON file, or tar archive holding one (optionally gzipped)
      --format                             json | ndjson | pretty
      --level                              error | warning | info   [default: warning]
      --max-custom-validation-concurrency  [default: 5]
      --max-fetch-concurrency              [default: 25]
      --workspace                          Workspace to validate
```

- The help gives no default for `--format`. Without it the output is `pretty`.
- The confirmation prompt says the command processes all documents locally and executes all custom validation functions. The Studio code runs in this process (see the design notes at the end).

### 9.2 Record shape

ndjson prints one line per document that has at least one marker at the chosen level. Clean documents print nothing.

- Record keys: `documentId` (full ID, so `drafts.` and `versions.<release>.` prefixes stay), `documentType`, `level` (highest level among its markers), `markers[]`, `revision` (the document's `_rev`).
- Marker keys: `code`, `level`, `message`, `item.message`, `path` (array of segments; I haven't seen an array index in one), and `details` for some codes.

Trimmed examples, one per level:

```
error    {"documentId":"drafts.post-0020","documentType":"post","level":"error","markers":[{"code":"string.maximum-length","details":{"actualLength":53,"maximumLength":40},"level":"error","item":{"message":"Must be at most 40 characters long"},"message":"Must be at most 40 characters long","path":["title"]}],"revision":"bfsIs5tNmq8GktcXomBXhx"}
warning  {"documentId":"spike-warn-1","documentType":"product","level":"warning","markers":[{"code":"object.unknown-field","details":{"fieldName":"note","typeName":"product"},"path":["note"],"level":"warning","item":{"message":"Field 'note' does not exist on type 'product'"},"message":"Field 'note' does not exist on type 'product'"}], ...}
info     {"documentId":"author-003","documentType":"author","level":"info","markers":[{"code":"custom","level":"info","item":{"message":"Author slug probe"},"message":"Author slug probe","path":["slug"]}],"revision":"bfsIs5tNmq8GktcXomBXhx"}
```

- The warning sample is from a crafted file (9.8), so its `revision` is trimmed.
- Pretty mode prints progress to stderr and the summary (`Valid`, `Errors`, `Warnings`, `Info`) to stdout.
- JSON mode prints one array, `[]` when there are no markers. I didn't check its non-empty form.

### 9.3 Baseline on the current schema

```
$ sanity documents validate --dataset fixture-dev --format pretty --level info --yes
✔ Loaded workspace 'default' using project 'zvpg4970' and dataset 'fixture-dev' (5.2s)
✔ Downloaded 557 documents (0.3s)
✔ Checked all references (0.0s)
✔ Validated 549 documents (0.7s)
✔ Valid:    549 documents
✖ Errors:   0 documents, 0 errors
⚠ Warnings: 0 documents, 0 warnings
ℹ Info:     0 documents, 0 markers
```

- Total markers on the current schema: 0 at every level. The ndjson run prints nothing (stdout 0 bytes, exit 0).
- The validated set is 549: 500 published, 41 drafts and 8 versions. It is the 550 lines of the export minus `system.release`.
- The download count (557) is 8 higher than the validated count. 4 image assets and 1 `system.release` are skipped by type, which leaves 3 I couldn't identify.

### 9.4 Drafts and versions

With the rules from 9.9, the live run reports markers on `drafts.post-*` (25) and `versions.rFixture01.post-*` (6). Both are validated, and the 549 includes them. A plain GROQ count (`documents query`, default view) returns 500 content documents, so drafts and versions are not in that view.

### 9.5 Exit codes and streams

| Case                     | Exit | stdout                  | stderr                                                             |
| ------------------------ | ---- | ----------------------- | ------------------------------------------------------------------ |
| No markers, ndjson       | 0    | empty                   | empty                                                              |
| Errors present, ndjson   | 1    | one record per document | `› Error: EEXIT: 1`                                                |
| Warnings only, `--file`  | 0    | one warning record      | empty                                                              |
| `--level bogus`          | 2    | empty                   | `Error: Expected --level=bogus to be one of: error, warning, info` |
| No token, no login (9.7) | 1    | empty                   | `Error: You must login first - run "sanity login"`                 |

- Exit 1 means "errors found", not a crash. CI has to read it that way.
- With no CLI config in `HOME`, stderr also gets a telemetry banner. The CLI source has no variable for turning it off, as far as I can see (the only `SANITY_TELEMETRY_*` name is a project ID).

### 9.6 Wall time

- Baseline, `time`: 8.10 s total (`Loaded workspace` 5.2 s, `Validated` 0.7 s).
- Rules run, ndjson: 7.3 s and 7.1 s.
- `--file` run: `Validated` 0.7 s (I didn't time the whole command).
- Fixed cost is about 5 s of workspace loading. I didn't profile it.

### 9.7 Auth

- Viewer token only. I ran `env -i` with `HOME` and `XDG_CONFIG_HOME` pointing at an empty folder in `$SCRATCH`, with `SANITY_AUTH_TOKEN` taken from the root `.env` (never printed), `--project zvpg4970 --dataset fixture-dev`. Result: `Loaded workspace`, `Validated 549 documents`, exit 0.
- So the CLI does read `SANITY_AUTH_TOKEN` when there is no login. The same environment without the variable fails with `Error: You must login first - run "sanity login"`, exit 1.
- Export with the Viewer token works: `sanity datasets export fixture-dev <file> --overwrite`, exit 0, a 151,870-byte tarball. `--file` on that tarball with the Viewer token validated 549 documents, exit 0.

### 9.8 `--file`

Inputs: the tarball from `sanity datasets export fixture-dev` (default flags, with assets), the `data.ndjson` extracted from it (550 lines), and `--dataset`. Everything was extracted into an empty folder and nothing in it was run.

| Command                                              | Validated | Exit                                  |
| ---------------------------------------------------- | --------- | ------------------------------------- |
| `--file export.tar.gz`                               | 549       | 0                                     |
| `--file data.ndjson`                                 | 549       | 0                                     |
| `--file data.ndjson --dataset fixture-dev`           | 549       | 0                                     |
| `--file export.tar.gz --dataset no-such-dataset-xyz` | 549       | 1 (433 `validation.exception` errors) |

- Count check: `data.ndjson` has 550 lines. The CLI skips `system.*` and `sanity.*` types, which removes `system.release`, leaving 549. The 4 image assets are not documents in `data.ndjson`. They are in `assets.json` and `images/`.
- The last row shows what `--file` does not isolate. The 433 errors are every post, author and category document in the file. Their messages start with `slug:` and say `Dataset "no-such-dataset-xyz" not found`. The slug uniqueness check queries the dataset named by `--dataset`. The messages also include a `traceId`.
- Files under 300 bytes are ignored. Crafted files, same record each time:

```
$ sanity documents validate --format pretty --level info --yes --file prod-notitle.ndjson          # 135 bytes, no title
✔ Validated 0 documents (0.0s)                                                                     exit 0
$ sanity documents validate --format pretty --level info --yes --file prod-notitle-padded.ndjson   # 465 bytes, same record plus a 320-char field
✔ Validated 1 document (0.0s)                                                                      exit 1, value.required on title
```

The cause is `maybeExtractNdjson` in `@sanity/cli` 8.35.0 (`dist/util/extractDocumentsFromNdjsonOrTarball.js`). It only starts yielding once the buffer reaches 300 bytes (`HEADER_SIZE`), and a smaller file yields nothing and reports no error. My guesses (missing `publishedAt`, system fields) were wrong. The size was the variable.

- This is also why the section 8 file validated 0. A 0-document run exits 0, so the tool has to check the document count itself.

### 9.9 Rule diff

Temporary edits, all reverted:

- `post.title`: `rule.required()` becomes `rule.required().max(40)`.
- `product.title`: no rule becomes `rule.required()`.
- `author.name`: `rule.required()` gains `.custom(...)` that rejects names containing `a`.

Live run, `--format ndjson --level info`:

| Rule                     | Markers | Level | Documents                            | Predicted from the export |
| ------------------------ | ------- | ----- | ------------------------------------ | ------------------------- |
| `post.title` max 40      | 160     | error | 25 drafts, 129 published, 6 versions | 160 (25 / 129 / 6)        |
| `author.name` custom     | 18      | error | 18 published                         | 18                        |
| `product.title` required | 0       | -     | -                                    | 0                         |

- Baseline 0 markers, after the edits 178 markers in 178 records, exit 1. Each record has one marker.
- The product rule is untested on live data, since every product has a title. It works: a crafted product without a title gives `value.required` on `title` (9.8).
- Custom validators and levels: a custom function that returns `{ message, level: 'warning' }` is reported as `level: "error"` with code `custom`. The level in the return value is ignored. Chaining the level on the rule works: `rule.custom(fn).warning()` gives `warning` and `rule.custom(fn).info()` gives `info`.
- Probe counts with the chained levels: 11 warning records for posts without a slug (16 slug markers in total; 5 share a record with an error). 7 info records for authors (all 25 have the probe; 18 share a record with a name error).
- `--level` filters markers as well as records. With the probes in place: `error` gives 178 records and 178 markers, the default `warning` gives 189 and 194, `info` gives 196 and 219.

### 9.10 Determinism

- Two runs of the same rules: sorted markers are equal (178 each). The raw line order differs (line 2), so the output order is not stable. Sort before diffing.
- `revision` is the document's `_rev`. It was the same in both runs. It changes when the document changes, so it stays out of any key.
- Messages contain no timestamps. Exception messages contain a `traceId`. I didn't check whether it changes between runs, so a key has to strip it.

### 9.11 Base-branch run

```
$ git worktree add --detach <scratch>/wt HEAD                          # e53f781
$ ln -s <repo>/node_modules <wt>/node_modules
$ ln -s <repo>/fixtures/studio/node_modules <wt>/fixtures/studio/node_modules
$ (in <wt>/fixtures/studio) sanity documents validate --dataset fixture-dev --format pretty --yes
✔ Loaded workspace 'default' using project 'fixtureprojectid' and dataset 'fixture-dev' (5.4s)
Error: Dataset not found - Dataset "fixture-dev" not found for project ID      exit 1
$ cp <repo>/fixtures/studio/.env <wt>/fixtures/studio/.env    # project and dataset only, no token
$ (same command)
✔ Validated 549 documents (0.7s)   Valid 549, Errors 0, Warnings 0, Info 0 markers   exit 0
```

- Without the Studio `.env`, the config falls back to the placeholder project `fixtureprojectid`. A CI job has to set `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`, or pass `--project` and `--dataset`.
- Output check: the worktree's pretty summary matches the main checkout's HEAD-schema summary exactly, and both ndjson runs are empty. The main checkout now has the rules, so its output differs. That's expected.
- The first run in the new tree took 11.3 s. I didn't repeat it.
- Cleanup: symlinks removed by name, then `git worktree remove --force` and `git worktree prune`. `git worktree list` shows the main checkout only, and both `node_modules` folders are intact.

### 9.12 Proposed validation diff design

- **Marker key:** `documentId`, `path` joined with `.`, `code`, and `message` with the `traceId` removed. Flatten records to markers first. Leave out `revision` and `details`, which change with the content and not with the rule. New in head = head keys minus base keys. Keep the ID prefix, so a draft and its published copy stay separate. A message that holds the limit (`Must be at most 40 characters long`) makes a changed limit show as a new key.
- **CLI:** run in each Studio directory (base worktree and head checkout):
  `sanity documents validate --project <id> --dataset <name> --format ndjson --level warning --yes > <out>.ndjson`
  Pass `--project` and `--dataset` explicitly, from `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`. Exit 1 means errors were found and is a result, not a failure. Any other non-zero exit is a failure.
- **Input:** live for both runs is the simplest option. A publish between the two runs changes the input, though. The alternative is one Viewer export (0.85 s here) and `--file` for both runs. That fixes the document data for both runs, but slug and reference checks still hit the live dataset, and files under 300 bytes are ignored. The export holds full content and assets, so it should be a short-lived artifact and never published.
- **Count guard (open):** ndjson mode prints no count, and a 0-document run exits 0. Before 5b I need a second source of truth, either the pretty summary from a second run or a GROQ count. Not decided.
- **Overlap:** `object.unknown-field` warnings are the same fact as a removed field in the structural diff. The validation diff should drop that code or fold it into the removed-field entry, or every removed field is reported twice.
- **Auth (CI and the Action):**
  - `SANITY_AUTH_TOKEN` holds a Viewer token in the job environment. The CLI reads it with no login (9.7), so CI never runs `sanity login`. The token is never echoed. None of the runs above printed it.
  - Fork PRs get no secrets, so the job skips with a message, the same rule as the integration tests (decision 38).
  - Risk: the Studio code (custom validators) runs with the token in its environment for every PR from this repo. A custom validator could read it. The Viewer role limits this to reads of the whole dataset. Before 7, pick one: run head validation only for trusted authors, or use a protected environment with required reviewers.
- **Runtime:** about 8 s per run (5 s workspace load, under 1 s to validate 549 documents). Base and head together are about 16 s, plus the export and a Studio install in each tree. I didn't measure the install here (Phase 2: 1.1 s offline with a warm store).

**Impact on Phase 5b:** the layers in the architecture notes still hold. The validation layer shells out to the CLI once per tree. Two things need a guard in the tool before 5b: the 300-byte drop, and a count check for ndjson. The 557 vs 549 download gap is unexplained. The Phase 5 section of the project notes still says `--file` validated 0 documents. I didn't change that section, so it needs updating by hand.

## 10. Migration runner (dry runs)

Checked against `fixture-dev` on 26 Nov with `sanity migrations run <id> --dry-run --no-progress --no-confirm --dataset fixture-dev -p <project>` from a copy of the fixture Studio. The token was `SANITY_AUTH_TOKEN` from `.env`. Versions: `sanity` 6.25.0, `@sanity/cli` 8.35.0, `@sanity/migrate` 8.0.5.

- **Location:** `<studio>/migrations/<id>/index.ts`. The folder name is the ID. `sanity migrations list` reads only that folder and says "No migrations folder found" when it's missing.
- **Source of documents:** the migrate library streams the dataset export and applies `documentTypes` in code. It parses `filter` with groq-js and evaluates it locally. Only `_.`-prefixed system IDs are dropped, so drafts (`drafts.*`) and versions (`versions.*`) reach the migration.
- **Counts agree with the impact step:**
  - `post.featuredImage` removed: impact 249 published, 32 drafts and 5 in releases, 286 in total. The dry run printed 286 patch headers, 286 distinct IDs, 32 `drafts.` IDs and 5 `versions.` IDs.
  - `post.featuredImage` renamed to `heroImage`: 286 distinct documents, with two operations each (`setIfMissing` on `heroImage`, `unset()` on `featuredImage`), so 572 headers.
  - `product.variants[].price` removed: 100 documents counted and 100 distinct documents in the dry run. The 193 variant members all have a `_key`, and the dry run planned 193 keyed operations.
  - `product` removed as a type: the scaffold plans no patches, as intended.
- **Output format:** a header per operation, `[patch] [<type>] <id>`, then one `└─` line per path step. Keyed paths print as `└─ [_key=="v0"]`. The header line has a trailing space.
- **Type-check:** the generated files type-check with the fixture Studio's `tsconfig.json`, and a planted error in the same folder is reported. So the `sanity/migrate` typings are checked, not just the syntax.
- **Not checked:** a real run. The test only uses `--dry-run`, and the tool never writes to the dataset.
