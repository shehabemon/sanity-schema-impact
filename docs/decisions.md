# Decisions

Short entries: context, choice, trade-off. Newest at the bottom.

## 1. pnpm workspace instead of a nested Studio

- **Context:** The tool needs a Sanity Studio fixture to extract schemas from. Sanity v6 brings React, styled-components and a large dependency tree.
- **Choice:** A pnpm workspace. The root is the tool. `fixtures/studio` is a second workspace package with its own `package.json`.
- **Trade-off:** Two `package.json` files to keep in mind. In return the published tool's dependencies stay small, and the Studio can be upgraded without touching the tool.

## 2. tsup for bundling, tsc for type checking

- **Context:** The CLI and library need ESM output with `.d.ts` files and a node22 target. Type errors must fail CI.
- **Choice:** `tsup` emits the bundle and declarations. `tsc --noEmit` does the type checking, with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- **Trade-off:** Two tools to keep in step. tsup's own type checking isn't strict enough to rely on alone.

## 3. TypeScript 6 instead of 7

- **Context:** TypeScript 7 is out, but `typescript-eslint` 8.74 refuses to load with it. Its peer range is `>=4.8.4 <6.1.0`.
- **Choice:** `typescript@^6.0.3`, the newest version the lint toolchain accepts.
- **Trade-off:** One major version behind. Move to 7 once `typescript-eslint` supports it.

## 4. Deterministic seed with fixed IDs

- **Context:** Later tests assert exact impact counts against the fixture dataset. Random IDs or random data would make those numbers drift between runs.
- **Choice:** `faker.seed(42)` at the start of every generation, and fixed IDs (`author-001`, `category-01`, `post-0001`, `product-001`). Draft copies are `drafts.<id>`. The generator is a pure function, separate from the writer in `fixtures/seed.ts`.
- **Trade-off:** The data looks less realistic than fully random data. The fixture needs stable counts, not realism.

## 5. SANITY_SEED_TOKEN exception to the read-only rule

- **Context:** The tool is read-only: it only ever uses `SANITY_AUTH_TOKEN` (Viewer). Seeding a dataset needs a write token.
- **Choice:** Only `fixtures/seed.ts` reads `SANITY_SEED_TOKEN` (Editor). Before any write it checks that the dataset name starts with `fixture`, and refuses otherwise. The token is never logged; errors print only the message.
- **Trade-off:** A second, more powerful token lives in the local environment. The `fixture*` guard is a name check, not a permission check, so the token should be scoped to a dedicated fixture project.

## 6. Hand-written Studio scaffold instead of `sanity init`

- **Context:** `sanity init` is interactive and wants a project up front. The fixture Studio only needs a config and schema types.
- **Choice:** The Studio files are written by hand: `package.json`, `sanity.config.ts`, `sanity.cli.ts`, `tsconfig.json` and `schemaTypes/`. Project ID and dataset come from env vars, with placeholder fallbacks so `schema extract` works without a project.
- **Trade-off:** It can drift from what `sanity init` generates. The drift is small, and the schema types are the part that matters.

## 7. Real uploaded image assets

- **Context:** The first real seed failed with `references non-existent document "image-fixture5040-1600x900-jpg"`. The Content Lake enforces strong references, so an image pointing at an asset that doesn't exist is rejected.
- **Choice:** `fixtures/png.ts` generates four 160x90 solid-colour PNGs in code, using only `node:zlib` for DEFLATE plus a small CRC-32 and chunk writer. The seed uploads them with `client.assets.upload` before writing any documents. Every image field (`featuredImage`, `seo.ogImage`, `author.avatar`) uses one of the returned asset IDs. `--dry-run` uses fake placeholder IDs and never sends them.
- **Trade-off:** Asset IDs come from the upload response rather than being computed locally. Sanity hashes the bytes, and zlib output can differ between builds, so the IDs may change on another Node version. That's harmless because the seed reads the IDs back on every run. The upside is that the fixture passes real reference validation, so the validation diff won't have to special-case dangling asset errors.

## 8. Release versions (`versions.*`) not seeded yet

- **Context:** Impact queries should count release versions separately from drafts. `@sanity/client` 8.17 has `client.releases` and `client.createVersion({ baseId, releaseId, publishedId })`.
- **Choice:** Not seeded for now. The seed writes only published and `drafts.*` documents.
- **Trade-off:** The `versions.*` side of the impact queries can't be tested against real data yet. Add a release step to the seed when the impact queries are built.
- **Superseded by 37.** The seed now creates the fixture release.

## 9. No `@eslint/js` recommended config

- **Context:** `typescript-eslint`'s strict type-checked config covers most of what `@eslint/js` recommended would add, and it's one less dependency.
- **Choice:** The flat config uses `tseslint.configs.strictTypeChecked` and `eslint-config-prettier` only.
- **Trade-off:** Core rules such as `no-undef` aren't enabled. TypeScript catches most of those anyway.

## 10. esbuild build script allowed via `allowBuilds`

- **Context:** pnpm 12 blocks dependency build scripts by default, and esbuild (used by tsup, tsx and vitest) needs its postinstall to fetch the native binary.
- **Choice:** `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`. No other build script is allowed.
- **Trade-off:** Any future package with a build script needs an explicit entry.

## 11. pnpm version pinned with `packageManager`

- **Context:** Local and CI installs should use the same pnpm, so the lockfile doesn't churn.
- **Choice:** `packageManager: pnpm@12.23.0` in `package.json`. CI picks it up through `pnpm/action-setup`.
- **Trade-off:** Contributors need pnpm 12 installed, either through Corepack or directly.

## 12. Seed loads `.env` with `--env-file-if-exists`

- **Context:** `pnpm seed` needs `SANITY_STUDIO_PROJECT_ID`, `SANITY_STUDIO_DATASET` and `SANITY_SEED_TOKEN`. Node can already read env files, so a dotenv dependency isn't needed.
- **Choice:** `"seed": "tsx --env-file-if-exists=.env fixtures/seed.ts"`. Node 22.9 added the flag, and the engine floor is 22.12. tsx forwards it to Node. A missing `.env` is ignored, so CI and `--dry-run` still work.
- **Trade-off:** It's a Node-only flag, so the script has to stay on Node. Node prints a short notice when the file is missing.

## 13. `@types/node` as a dev dependency

- **Context:** `typecheck` and `lint` need types for `process`, `console` and `node:*` imports.
- **Choice:** `@types/node@^22` at the workspace root. `@types/react` isn't added; the Studio stays out of type checking.
- **Trade-off:** Adding it changed the lockfile beyond the one package. Vitest's optional `@types/node` peer now resolves, which pulls in jsdom 31 and some transitive packages that warn about engines below Node 22.20.

## 14. Image fields assigned round-robin by document number

- **Context:** Every image field needs one of four asset IDs. A shared cursor would make each ID depend on how many earlier fields were filled, so the output would shift whenever a gap rate changed.
- **Choice:** `assetIds[n mod length]`, where `n` is the post or author number. `seo.ogImage` uses `n + 1`, so a post's two images differ. The gap ratios (30% without a featured image, 50% without an og image, 5% without a slug, 20% without a legacy SKU) and faker's draw order are unchanged.
- **Trade-off:** The distribution is even, not random. That's fine for a fixture whose job is stable counts.

## 15. `fixtures/studio/schema.json` is committed

- **Context:** The schema extract is the input for the diff engine's tests. Ignoring it would make those tests depend on a local extract.
- **Choice:** The file is committed. `fixtures/studio` is in `.prettierignore` and the ESLint `ignores`, so generated JSON isn't formatted or linted.
- **Trade-off:** It must be regenerated when the Studio schema changes. A stale file would only be caught in review.

## 16. Change-kind fixtures come from the CLI, one edit per pair

- **Context:** The diff engine needs before/after pairs. Hand-written JSON would encode my guess at the extract format, which is what the spike was meant to replace.
- **Choice:** Each `before.json` and `after.json` is real `sanity schema extract --enforce-required-fields --path` output from the fixture Studio, with one source edit per pair. `removed-type` removes `product`, which nothing references, so the pair has no side effects. `newly-required` uses `post.slug`, not `post.title`, because `title` is already required.
- **Trade-off:** The pairs go stale when the fixture Studio changes, and each one is about 48 KB. A smaller hand-written schema would be easier to read but would not be what the CLI emits.

## 17. Named types are expanded before diffing (proposed for phase 3)

- **Context:** A change inside a registered named type appears only in that type's top-level entry, not under the field paths that use it. Field paths are `inline` references in the extract.
- **Choice:** The normaliser resolves `inline` references before flattening, so a change inside a named type lands under every field path that uses it. Top-level named entries are not reported on their own, except when they're removed.
- **Trade-off:** Flattened maps repeat named-type content under every field that uses it, so they get larger. The alternative is to diff named types separately and map changes back to fields, which is more code and more edge cases.

## 18. Validation rules are left to the validation diff

- **Context:** `min`, `max`, `regex`, `custom`, `deprecated`, `hidden`, `readOnly`, `initialValue` and `description` never appear in the extract. Only `required()` shows up, and only with `--enforce-required-fields`.
- **Choice:** The structural diff doesn't try to detect them. Validation rules go to the validation diff. Studio-only options (`deprecated`, `hidden`, `readOnly`, `initialValue`, `description`) are not diffed at all, because they don't change what existing content means.
- **Trade-off:** Adding `max(120)` to a title won't appear in the structural diff. It only shows up when the validation diff runs against the dataset.

## 19. Array members get their own `path[]` entry

- **Context:** A changed reference target inside an array (`categories`) has to be reported at a path, and an array-level entry alone can't carry the member's target.
- **Choice:** An array field is one entry with `of` (its member kinds or `_type` names), and each member is a separate `path[]` entry with the member's own kind, `refTo` or children.
- **Trade-off:** The member kind is stored twice, once in `of` and once on `path[]`. In return a member change is reported at the member path, and `of` changes are reported at the array.

## 20. Paths use `.` for objects and `[]` for array members

- **Context:** Changes need stable, readable keys, and array indices change when items are reordered.
- **Choice:** `variants[].price.amount`, `categories[]`, `tags[]`. `_key`, `_type`, `_ref`, `_weak` and the system fields never appear in a path.
- **Trade-off:** Two array members with different shapes can't be told apart by path. Unions share a path, which is the same limit Sanity's own extract has.

## 21. image, file, slug and reference are single fields

- **Context:** An image is an object with `asset`, `hotspot`, `crop` and `media`. A slug and a reference are objects too. Diffing their internals would report noise such as "hotspot.x is required", which doesn't affect content.
- **Choice:** Objects with `_type` `image`, `file` or `slug` become one field of that kind. A reference becomes kind `reference` with its target types in `refTo`.
- **Trade-off:** Custom fields added to an image or file type aren't diffed. The fixture Studio has no `file` field, so the `file` branch is covered only by a hand-built test, not by a real extract.

## 22. Named types are expanded, with a stack guard for recursion

- **Context:** A field of named type `address` only shows its contents in the top-level `address` entry, so a change there never appears under the fields that use it.
- **Choice:** `inline` references are expanded in place under each field that uses them. A name already on the expansion stack stops the walk, and that field is kept as kind `object` with `typeName` set to the name.
- **Trade-off:** The flattened map repeats a named type's fields under every field that uses it, so a change inside one type is reported once per use. Each use is a real impact, but one change can produce several entries.

## 23. Portable text is one field

- **Context:** A block's children, spans, marks and markDefs are a deep tree. Diffing them would flag every change to the decorator set, and the extract only lists annotations, not the allowed decorators.
- **Choice:** An array with a `block` member becomes kind `portableText`. `of` lists the block and any custom member `_type`s. Nothing below the field is walked.
- **Trade-off:** A change to a custom block's fields, or to a list of decorators, isn't diffed. Adding a custom block type shows as a type change on the field.

## 24. Literal string unions are strings with values

- **Context:** `options.list` makes the extract emit a `union` of string literals, and a plain `string` field emits `string`. Removing an option can break existing content, so the values matter.
- **Choice:** A union whose members are all string literals becomes kind `string` with sorted `values`. Any other union becomes kind `union` with its member names in `of`.
- **Trade-off:** A field that moves from a plain string to a literal union is an options change, not a type change. That's the right reading for validation, but it is a choice.

## 25. Type changes hide the changes under them

- **Context:** When `seo` goes from an object to a string, every `seo.*` path would show as removed too.
- **Choice:** A type change (kind, `typeName`, `refTo` or `of`) at a path suppresses every change below it. On the changed path itself only the type change is reported, except for `newly-required` and `no-longer-required`, which are still reported.
- **Trade-off:** If a parent changes type and a child also loses a required flag, only the parent is shown.

## 26. Removals and additions are collapsed to the top path

- **Context:** Removing `seo` removes `seo.title`, `seo.description` and `seo.ogImage` at once. Reporting all four is noise, and the top path already says what happened.
- **Choice:** Only the highest removed or added path is reported. Ancestors are found at `.` and `[]` boundaries.
- **Trade-off:** The count of removed leaves isn't in the change list. The impact step counts documents per path, so the count comes from there.

## 27. Rename detection pairs one removed and one added field

- **Context:** Renaming `featuredImage` to `heroImage` shows up as a removal and an addition. Reporting that as a rename tells the author the data needs a move, not a drop.
- **Choice:** Removed and added fields are grouped by parent path and shape (kind, `typeName`, `refTo`, `of` and `values`, ignoring `required`). A rename is reported only when a group has exactly one removed and one added field. Array members are never renamed.
- **Trade-off:** Two fields with the same shape in the same parent, both renamed, are reported as removed and added, which is the safe reading. A rename that also changes the type is reported as a removal and an addition.

## 28. Added document types produce no change

- **Context:** The change list has no `added-type` kind. A new document type doesn't change existing content, and listing each of its fields as added would be noise.
- **Choice:** A document type that only exists in head emits nothing.
- **Trade-off:** An author can't see new types in the PR comment. If that turns out to matter, add an `added-type` kind rather than listing fields.

## 29. no-longer-required is part of the diff output

- **Context:** The project's change list keeps `no-longer-required` for JSON output only, but the classifier has to produce it for that output.
- **Choice:** `diffSchemas` emits it. The report layer decides whether to show it.
- **Trade-off:** The report layer has to filter it out for the markdown and terminal views.

## 30. Shapes the fixture Studio doesn't exercise

- **Context:** The spike covers the fixture Studio's field types. A `file` field and a reference to several types aren't in it, so their extract shape is unverified.
- **Choice:** `file` is detected by `_type` `file`, the same way as `image`. A `dereferencesTo` that is a list of names is read as several targets. Both are covered by hand-built tests only.
- **Trade-off:** If the real extract differs, the normaliser throws or misreports. I'll re-check both against a real extract when the fixture Studio gets those fields.

## 31. Field paths compile to a fixed GROQ grammar

- **Context:** Each change needs a count of the documents it touches. Nested objects and arrays need different GROQ shapes, and a single `defined()` doesn't cover arrays.
- **Choice:** `a.b` becomes `defined(a.b)`. An array segment becomes a filter on the array: `variants[].price.amount` becomes `count(variants[defined(price.amount)]) > 0`. A path that ends in `[]` only checks that the array has members. Nested arrays recurse. Options use `in $removed` with the same shape.
- **Trade-off:** `count(...) > 0` counts a document once when any member matches. A document with three bad variants counts as one, which is the number a PR comment needs.

## 32. Newly required fields count only where the parent exists

- **Context:** A missing `seo.title` on a post with no `seo` object is not a new validation error, because there is nothing to validate. Counting it would inflate the number.
- **Choice:** Top level: `!defined(slug)`. Nested: `defined(seo) && !defined(seo.title)`. Inside an array: `count(variants[!defined(sku)]) > 0`, which is empty when the array is empty.
- **Trade-off:** A required field inside a missing parent isn't counted here. The parent's own change covers that case.

## 33. Field names pass an allowlist before they reach GROQ

- **Context:** Field paths come from schema extracts and are written into the query text. GROQ has no parameter form for attribute names, so the allowlist is the only guard against injection.
- **Choice:** Each segment must match `/^[A-Za-z_][A-Za-z0-9_]*$/`, and must not be `in`, `match`, `asc`, `desc`, `true`, `false` or `null`. The Content Lake treats `true`, `false` and `null` as literals: `defined(true)` matched every post. The first four parse as attribute names in `defined()`, but they are operators next to `in $removed`, so I reject them too. A bad path throws, and `measureImpact` reports that change as skipped. Document types never go into the text; they go through `$type`.
- **Trade-off:** A field called `match` or `in` can't be counted. That's rare, and a skipped change is visible in the report.

## 34. Counts are batched into one GROQ object per request

- **Context:** One request per change is slow on a PR with many changes, and the query grows with each one.
- **Choice:** One request covers up to 20 changes (`DEFAULT_CHUNK_SIZE`, overridable through `chunkSize`). The query is a JSON-keyed object, one entry per item. Parameters are namespaced as `$q<n>_<name>`, and the filter text is rewritten to match. Requests run one after another.
- **Trade-off:** A failed request fails every change in its chunk. Running them sequentially is slower, but it keeps the load on the API low.

## 35. Raw perspective, with the published/draft/version split done by ID prefix

- **Context:** Drafts and release versions don't appear under the published perspective, and impact needs them counted separately.
- **Choice:** `perspective: 'raw'` and `useCdn: false`. Drafts are `drafts.**`, versions are `versions.**`, and published is everything else. The split uses IDs, not release metadata, so it works for any release. Reader errors are passed through `redact`, which removes the token from the message.
- **Trade-off:** Raw also returns system documents such as `_.releases.*`. The `_type` filter in every query excludes them. An ID with a `versions.` prefix is treated as a version even if no release exists.

## 36. Fixture release: one `createVersion` call per version, using the document form

- **Context:** `client.createVersion` in `@sanity/client` 8.17 takes a full `document`, or `baseId` with `releaseId`. The `baseId` form copies the published document unchanged.
- **Choice:** The `document` form with `publishedId` and `releaseId`. One call writes the version with its changed title. `releases.create` makes the release. The seed checks each release and version before writing, so re-runs create nothing new. On the first run the SDK warned that it prefers `baseId` for existing documents. With `baseId` the version would briefly exist with the unchanged title, and the title would need a second patch, so I kept the document form.
- **Trade-off:** The SDK warning shows on the first seed run. `--reset` deletes the release versions but keeps the release document, so a later seed can re-add the versions to it.

## 37. Release versions come from their own generator

- **Context:** The release needs versions with changed titles. The existing generator returns only the published and draft set, and its tests and counts rely on that.
- **Choice:** `generateReleaseVersions(docs)` is separate. It copies every 40th published post (40, 80, ..., 320) into `versions.rFixture01.*`, with " (release edit)" added to the title. Those posts also have drafts, because every tenth post does. So a single post appears as published, draft and version, and the split gets tested.
- **Trade-off:** The set of versioned posts is fixed, so the release never changes shape. That's what counts need.

## 38. Integration tests are gated on three variables and load `.env` themselves

- **Context:** The integration test needs a Viewer token and a dataset. `pnpm test` has to stay offline and fast. Vitest doesn't read `.env`, and CI doesn't have the secret yet.
- **Choice:** `vitest.integration.config.ts` and a setup file. The setup file calls `process.loadEnvFile` when `.env` exists. Variables already set win. The suite is `describe.skipIf` unless all three variables are non-blank. The default config excludes `test/integration/**`. Expected counts come from the generator, not hard-coded numbers.
- **Trade-off:** A skipped suite shows green. The CI log says "skipped" for the integration job until the secret and variables exist, so a misconfigured run is visible but not an error.

## 39. `@sanity/client` moves to runtime dependencies

- **Context:** The impact step now queries Sanity when the tool runs, not only when the seed runs.
- **Choice:** `@sanity/client` moves from `devDependencies` to `dependencies`.
- **Trade-off:** The published package carries the client. Writing a minimal HTTP call would avoid that, but it would have to reimplement auth, retries and perspective handling.

## 40. Unbuildable changes are skipped, and reader errors are not

- **Context:** A change with an unsafe path, or a required flag on an array member, has no count query. Throwing would stop the whole PR check for one change.
- **Choice:** `measureImpact` returns `{ change, skipped }` for those. Errors from the reader propagate, so an expired token or a network failure stops the run instead of looking like zero impact.
- **Trade-off:** A skipped change only shows up in the report. The report layer has to show skips, or they are invisible.

## 41. Marker identity for the validation diff

- **Context:** The CLI's ndjson output has no stable order between runs, `revision` changes with every document edit, and `details` carries values such as `actualLength` that change with the content. Exception messages carry a `traceId`.
- **Choice:** A marker's key is `documentId`, its `path` joined with `.`, its `code`, and its `message` with the `traceId` removed. Records are flattened to markers and the keys are sorted before comparing. `revision` and `details` are left out.
- **Trade-off:** Two markers with the same key on the same path collapse into one. A message that embeds a changing value (a count, say) makes a new key on every run, so rule messages need to be stable.

## 42. The spike ran rules against the live dataset, not `--file`

- **Context:** `--file` ignores NDJSON files under 300 bytes, and it still checks slugs and references against the dataset named by `--dataset`. Testing a rule change needed a live read, and the export was only useful for predicting counts.
- **Choice:** Rule-diff counts were taken from live runs, and the export was used for predictions and for the `--file` tests. The validation diff keeps the live path as its default until the size guard and count check exist. The export-once option stays open for 5b.
- **Trade-off:** A live run can see a change made between the base and head runs. Accepting that for now keeps the design simpler, with no artifact to store.

## 43. Paths are rendered for people and generalised for grouping

- **Context:** The CLI reports a path as an array. Field names are strings, array indices are numbers, and array members with a `_key` are objects like `{"_key": "lnk001"}`. I confirmed all three with a read-only `--file` run on a crafted document. Groups need a path that ignores which array member failed.
- **Choice:** `path` joins names with `.`, writes an index as `[3]` and a keyed member as `[_key=="lnk001"]`. `pathPattern` is the same string with every index and key replaced by `[]`. So `social.links[_key=="lnk001"].url` has the pattern `social.links[].url`.
- **Trade-off:** A malformed segment fails the whole parse, so an unexpected CLI shape stops the run rather than producing a wrong key.

## 44. The marker key leaves out the level

- **Context:** Entry 41 fixed the key as document, path, code and message. Duplicate markers on one document can show up in the output.
- **Choice:** The key is a JSON tuple of those four values, so a delimiter in a message can't make two keys collide. Level isn't part of it. Duplicates collapse to one marker in each list.
- **Trade-off:** If a rule moves from warning to error, the diff shows no change. That's the intended reading, since the same problem is still there. Duplicates can't be counted separately, which is fine for a PR comment.

## 45. Exit codes 0 and 1 are results

- **Context:** Spike 9.5 showed that exit 1 means "errors found", and anything else is a real failure (bad level, auth, a missing dataset).
- **Choice:** Exit 0 and 1 parse stdout. Any other code throws with the last 500 characters of stderr, passed through `redact` with the token.
- **Trade-off:** The stderr tail is still free text, so a message from the CLI could include something unexpected. Redaction only covers the token value.

## 46. Zero documents is an error, not a clean run

- **Context:** The ndjson output has no document count, and a dataset with nothing in it exits 0 with no markers. A clean result and an empty dataset would look the same.
- **Choice:** Before the CLI runs, one GROQ count excludes `_.**`, `system.*` and `sanity.*`. Zero throws. The count uses the raw perspective, so drafts and versions are included. It matched the CLI's 549 on the fixture dataset.
- **Trade-off:** It's one more request per run. The count and the CLI can still disagree if a publish lands between them.

## 47. Secrets stay out of the child's environment and out of errors

- **Context:** Studio code runs in the CLI process with the token in its environment (see the security notes in the README).
- **Choice:** `runCommand` replaces the child's environment with the one it is given and runs without a shell. `validateStudio` passes only `PATH`, `HOME` and `SANITY_AUTH_TOKEN`. Start failures, timeouts and signals go through `redact` with the listed secrets. `sanity.ts`'s `redact` now calls the same helper.
- **Trade-off:** The child can't see other environment variables, so a Studio that needs one more variable has to be changed here.

## 48. The Studio's own binary, not npx

- **Context:** `npx` or `pnpm exec` can pick up a different `sanity` version, and can install packages on the way. Spike 7 showed `pnpm exec` installing the whole workspace when `node_modules` was missing.
- **Choice:** `validateStudio` runs `<studioDir>/node_modules/.bin/sanity`. A missing binary throws an error that names `pnpm install`.
- **Trade-off:** The Studio has to be installed before the check runs. The CI job has to run `pnpm install` in each tree, which it already does for the root.

## 49. Only introduced markers are grouped

- **Context:** The report lists what a PR adds. Grouping the resolved and unchanged markers would mix them into the PR's numbers.
- **Choice:** `compareValidation` groups `introduced` only. A group counts each document once and splits the count by ID prefix. Its level is the highest level among its markers. The sample is the five lowest IDs.
- **Trade-off:** A group's `level` can be higher than the level of a single marker in it, if the rule uses several levels.

## 50. Validation fixtures are un-ignored

- **Context:** `.gitignore` ignores `*.ndjson`, which is right for run output but would also drop the test fixtures.
- **Choice:** Added `!test/fixtures/**/*.ndjson`. The fixtures are real CLI records, copied unchanged. The only exception is the crafted `paths.ndjson`, which I made with a read-only `--file` run.
- **Trade-off:** A stray ndjson dump under `test/fixtures` would be committed. The directory is small, so a review catches it.

## 51. Timeout default and where the ID helper lives

- **Context:** A validation run takes about 8 s on the fixture dataset, and the CLI has no timeout of its own. The impact step has no classifier in JavaScript: its published, drafts and versions split is written in GROQ.
- **Choice:** `validateStudio` takes an optional `timeoutMs` and defaults to ten minutes. `documentKind` lives in `src/validation/diff.ts`, since nothing else needs it yet. The impact code isn't changed.
- **Trade-off:** Ten minutes is a guess that leaves room for a slow dataset, and a hung CLI keeps a CI job busy until then. If a second module needs the ID split, the helper moves to a shared file.
