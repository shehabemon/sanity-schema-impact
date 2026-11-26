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

## 52. Unknown-field markers are folded under the structural row

- **Context:** Removing a field makes the Studio flag every document that still holds it as `object.unknown-field`. That's the same fact as the removed-field row, so the validation section showed it twice. On the fixture, the second copy was 249 published documents.
- **Choice:** A group with that code is hidden from the validation section when its document type and path match a removed field or a possible rename. The row gets a note instead ("Studio also flags these as unknown fields"), with no number, since the count is already in the sentence's documents. The JSON keeps every raw group, and `--fail-on` evaluates the visible ones.
- **Trade-off:** A matching unknown-field group that belongs to something else would be hidden too. Matching on type and exact path keeps that unlikely.

## 53. Head is the working tree, base is a detached worktree

- **Context:** The check should see what is about to be pushed, and people run it before committing.
- **Choice:** Head is the current checkout, uncommitted Studio edits included. Its ref is the branch name, or `HEAD` when detached, and its SHA is `HEAD`. The base is a detached worktree at the commit the base ref resolves to, under a temp directory.
- **Trade-off:** The report doesn't mark a dirty head. The SHA is the last commit, so a dirty report can look like the committed state. The README says so.

## 54. The base Studio reuses the head's `node_modules`

- **Context:** A fresh worktree has no `node_modules`, and an install per run would add minutes. Spike 7 ran the Sanity CLI fine through a symlink.
- **Choice:** The base Studio gets a symlink to the head Studio's `node_modules`. Cleanup removes that symlink before it removes the worktree, so the real folder is never touched.
- **Trade-off:** Base and head share one install. If the two branches pin different `sanity` versions, the base extract still uses the head's version. Running the check on a branch that changes the Sanity version isn't reliable yet.
- **Follow-up:** entry 95 links every `node_modules` on the path to the Studio, not only the Studio's own.

## 55. Exit codes and the default rules

- **Context:** The CLI's exit code has to mean "a rule matched" and stay separate from a crash or a bad argument.
- **Choice:** 0 means nothing matched, 1 means a rule matched, 2 means a usage or runtime error. The default rules are `data-loss`, `newly-required` and `validation-error`. `data-loss` covers removed fields and removed types that still have documents. `validation-warning` matches warning and error groups. `evaluate` takes the parsed rules as an argument.
- **Trade-off:** Removed types count as data loss, which the usage notes didn't spell out. The wording says "orphans" for them, to match the README example.

## 56. No timestamp, sorted JSON keys

- **Context:** The PR comment and the JSON are compared between runs. A timestamp would change the bytes on every run.
- **Choice:** The report has no timestamp. Object keys are sorted at every level, so one report always gives one byte sequence. Resolved markers are a count only.
- **Trade-off:** The JSON can't say when it was made. The CI log has that.

## 57. One sentence per change, in a single-column table

- **Context:** The PR comment needs one sentence per change, in the wording the README examples use. A bullet list plus a table would state each number twice.
- **Choice:** One table row per change, holding the whole sentence with the path in a code span. Drafts and releases go in brackets after the published count. A change with no documents says "no existing documents affected".
- **Trade-off:** The sentence has to carry the change name too, so the wording is fixed in one place (`describe.ts`) and the table has no separate label column.

## 58. Project and dataset come from the environment or flags

- **Context:** `documents validate` needs `--project` and `--dataset`, and the usage line doesn't give them. The Studio already reads `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`.
- **Choice:** Those two variables are the defaults, and `--project` and `--dataset` override them. `SANITY_AUTH_TOKEN` is the only token the tool reads.
- **Trade-off:** The CLI doesn't read `sanity.cli.ts`, so the Studio and the tool can point at different datasets if the environment is set differently.

## 59. Colour follows the terminal and NO_COLOR

- **Context:** The table output goes to terminals and to CI logs, and the logs don't render colour codes.
- **Choice:** Colour is on only when stdout is a TTY. A non-empty `NO_COLOR` turns it off as well, as the no-color.org convention says.
- **Trade-off:** Colour is only used for the pass or fail line, so the flag matters less than it would for a bigger table.

## 60. The CLI body lives in `src/cli/run.ts`

- **Context:** Tests need to call the CLI without starting a process. Checking `process.argv[1]` to decide whether to run breaks under npx symlinks.
- **Choice:** `runCli` in `src/cli/run.ts` takes its dependencies as an argument. `src/cli.ts` only calls it. `CommandRunner` moved to `adapters/process.ts`, and `validation/run.ts` re-exports it, so the package exports don't change.
- **Trade-off:** One more file to follow.

## 61. One adapter owns the Sanity CLI calls

- **Context:** The binary path, the child's environment and the exit-code rules were spread across `validation/run.ts`.
- **Choice:** `adapters/sanity-cli.ts` owns the binary path, the child environment (PATH and HOME, plus the token for validation only) and the exit-code rules. Extract accepts 0. Validation accepts 0 and 1. `validateStudio` keeps its signature.
- **Trade-off:** `validateStudio` now depends on the adapter. The existing validation tests cover the behaviour unchanged.

## 62. Cleanup runs on interrupt

- **Context:** A Ctrl-C in the middle of a run would leave a worktree entry in `.git` and a temp directory behind.
- **Choice:** `cleanOnSignal` runs the registered tasks on SIGINT and SIGTERM, then exits with 130 or 143. The tasks run newest first: the symlink, then the worktree, then the temp directory.
- **Trade-off:** SIGKILL can't be handled, so a killed run still needs `git worktree prune`.

## 63. Hidden marker and head label

- **Context:** The Action in a later phase finds its own PR comment by a marker, so the markdown has to start with a fixed line. The head label also has to say when the Studio has uncommitted changes, since the report shows only the last commit's SHA.
- **Choice:** The markdown starts with `<!-- sanity-schema-impact -->`. A detached head is labelled with its short SHA alone. When `git status --porcelain` reports changes under the Studio directory, the head label gets " + uncommitted changes".
- **Trade-off:** Only changes under the Studio count as uncommitted, so a dirty change elsewhere in the repo doesn't show. That matches what the schema extract reads.

## 64. Pull request comment through the REST API, without Octokit

- **Context:** The Action needs to list comments, then create or update one. That is three REST calls, and the global `fetch` in Node 22 covers them.
- **Choice:** `src/github/comment.ts` calls the REST API directly. Comments are read with `per_page=100`, following the `Link` header. The `fetch` function and the API root are injectable. GitHub Enterprise works through `GITHUB_API_URL`.
- **Trade-off:** Pagination, error mapping and the redaction are our code, not a library's. A `Link` header that leaves the API host is refused, so the token never goes to another host.

## 65. The comment is matched by marker alone

- **Context:** The Action has to find its own comment. Filtering on the comment's author type (`Bot`) is the obvious way to tell ours from a user's.
- **Choice:** The match is on the first line, `<!-- sanity-schema-impact -->`, and nothing else. When several match, the newest wins.
- **Trade-off:** The `github-token` input can be a personal token, and its comments have the `User` type. A bot filter would then post a new comment on every run. The cost is that someone who pastes the marker into a comment can make the next run fail with a 403 when it tries to edit that comment.

## 66. Comment bodies are cut at a line break, and the limit is in UTF-16 units

- **Context:** GitHub rejects a comment body over 65,536 characters. JavaScript string lengths count UTF-16 units, and an emoji takes two.
- **Choice:** A body over the limit is cut at the last line break in the second half of the budget, so a table row or a code line usually isn't left half-written. If there is no such break, the cut is at the budget. The cut never leaves half a surrogate pair. A note pointing to the job summary goes last, and the note is counted in the budget.
- **Trade-off:** The cut loses everything after it, and the report has no per-section limit. The JSON output and the job summary still have the full report.

## 67. The Action builds the CLI from its own source for now

- **Context:** The npm package doesn't exist yet. The Action can't pin a published version.
- **Choice:** The composite action installs and builds the CLI in `$GITHUB_ACTION_PATH` with `pnpm install --frozen-lockfile` and `pnpm build`. The step runs after `actions/setup-node` with Node 22, and `corepack enable` provides the pinned pnpm.
- **Trade-off:** Each run installs the devDependencies and builds, which costs some minutes. The caller's Node version doesn't matter. Once the npm release exists, this becomes a pinned `npx sanity-schema-impact@x` call, and that will be a separate change.

## 68. Node 22 comes from `setup-node` inside the Action

- **Context:** The CLI needs Node 22.12 or newer. The Action could ask the caller to set up Node, or set it up itself.
- **Choice:** The Action runs `actions/setup-node@v4` with `node-version: '22'`. Callers don't have to set anything up.
- **Trade-off:** One more action dependency, and a second Node install if the caller has already set one up. A wrong Node version would fail in a confusing way, so I think the extra install is worth it.

## 69. Sanity values come from the environment, never from `with:`

- **Context:** An input is visible in the workflow file and in logs. A token passed through `with:` would be easy to leak by mistake.
- **Choice:** `SANITY_AUTH_TOKEN`, `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` are read from the job's environment. The only secret input is `github-token`, which defaults to `${{ github.token }}`. The check step doesn't have `GITHUB_TOKEN` in its environment. Only the comment step does.
- **Trade-off:** The caller has to put the values in `env:`, which is a little more typing.

## 70. Forks skip the check and the job passes

- **Context:** Pull requests from forks receive no secrets, so `SANITY_AUTH_TOKEN` is empty for them.
- **Choice:** The first step checks the token. If it's empty, the step writes a `::warning::` and sets an output. Each later step's `if:` reads that output and skips. The job passes, because a skipped check shouldn't look like a failure on every fork PR.
- **Trade-off:** A missing secret on a same-repo PR also passes quietly, apart from the warning. The warning is the only signal, and I think that's acceptable.

## 71. Inputs reach shell scripts only through `env:`

- **Context:** A `${{ inputs.* }}` expression inside a `run:` script is pasted into the script text before it runs. A `studio` or `base` value with quotes or `;` in it could then run arbitrary commands.
- **Choice:** Every input is copied into an `env:` entry and read as `"$VAR"`. The structural test asserts that no `run:` block contains `${{`.
- **Trade-off:** Scripts are a little longer. Expressions used in `if:` and `env:` are still GitHub's own, and they don't get pasted into shell text.

## 72. Base fetch uses an explicit refspec and depth 1

- **Context:** `actions/checkout` may fetch only the PR merge commit, so the base branch may not exist locally. The CLI runs `git worktree add` on the base commit.
- **Choice:** `git fetch --no-tags --depth=1 origin "+refs/heads/<branch>:refs/remotes/origin/<branch>"`. The explicit refspec makes `origin/<branch>` exist whatever the checkout's fetch configuration is. The base is `origin/<branch>`, not the bare branch name.
- **Trade-off:** The history of the base branch is missing, but the CLI only needs the commit's tree.

## 73. The check writes its report by redirection, not an `--output` flag

- **Context:** I first wrote the step with an `--output` flag. The CLI has no such flag, and I kept the main command unchanged.
- **Choice:** The step redirects stdout to `$RUNNER_TEMP/schema-impact.md`. The exit code is captured with `set +e`, so a failing rule doesn't stop the job before the summary and the comment run.
- **Trade-off:** A message from the CLI on stdout would end up in the report. The CLI only writes the report to stdout, and its messages go to stderr.

## 74. The extract child gets the Studio project and dataset, not the full environment

- **Context:** Studios read `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` when they load. The extract child got only `PATH` and `HOME`, so a Studio that requires those variables would fail. Passing the whole environment would give Studio code `GITHUB_TOKEN` and anything else in the job.
- **Choice:** `extractSchema` passes the resolved project ID and dataset, from the flag or the environment, and nothing else. The fixture extract gives identical output with or without them.
- **Trade-off:** A Studio that needs another variable has to be changed in `childEnv`, as in entry 47.

## 75. The comment step can't fail the job

- **Context:** The comment step writes to the API, and it can fail for reasons the check doesn't control, such as a read-only token on a fork.
- **Choice:** The step has `continue-on-error: true`. The final step then exits with the check's code, so a failed comment doesn't hide `fail-on`.
- **Trade-off:** A broken comment shows only as a failed step in the log, with the job still green. The job summary still has the report.

## 76. The offline action test stubs the check, and runs the comment for real

- **Context:** The check needs live Sanity access. The build needs the registry. The comment has to be tested against a real HTTP endpoint without going to GitHub.
- **Choice:** `test/action/simulate.test.ts` runs each `run:` script from `action.yml` with a clean environment. The build and the `uses:` step are skipped. `dist/cli.js` in a temp directory is a launcher. `comment` runs the real `src/cli.ts` through tsx, loaded with `NODE_OPTIONS`. The check records its arguments and prints a fixed report. The API is a `node:http` server on 127.0.0.1.
- **Trade-off:** The test doesn't cover the real build, the real check or `setup-node`. Those are covered by the dogfood workflow, which I can't run from here.

## 77. Input defaults and expressions are checked as text, not as YAML

- **Context:** The repository has no YAML dependency, and a dependency for one test file isn't worth it.
- **Choice:** `test/action/parse-action.ts` reads the layout this file uses: two spaces for inputs, four for steps, six for keys. Prettier parses the real file, so a YAML syntax error fails `format:check`. Those two checks together cover most of what a parser would.
- **Trade-off:** A layout change that the reader doesn't expect would fail the test loudly, not silently. Anything beyond this layout needs a real parser.

## 78. Scaffolds are files, and the tool never runs them

- **Context:** The tool reads with a Viewer token and never writes to a dataset. A migration needs a write, so running one is a separate and deliberate step.
- **Choice:** `--migrations` writes `<studio>/migrations/<slug>/index.ts` and stops. The dry run and the real run are left to `sanity migrations run`.
- **Trade-off:** Someone has to run the migration after the PR merges. Nothing happens on its own, which I think is the right default for data.

## 79. One scaffold per counted change, in the folder layout the Sanity CLI reads

- **Context:** `sanity migrations run` looks for `migrations/<id>/index.ts`, and the folder name is the ID. A change that counted no documents has nothing to migrate.
- **Choice:** One folder per change that counted at least one document, drafts and versions included. Zero-count rows and skipped rows get nothing. The slug is built from the names, for example `unset-post-featured-image`. Repeated slugs get `-2`, `-3`.
- **Trade-off:** A removed field with no data gets no file, so the PR shows the count and nothing else. That's intended.

## 80. Renames copy with `setIfMissing` and skip documents where the new field is set

- **Context:** A possible rename comes from matching field types, so it's a guess. If the new field already has a value, unsetting the old one would throw that value away.
- **Choice:** Each document copies the old value with `setIfMissing`, then unsets the old field. A document that already has a value in the new field is left as it is.
- **Trade-off:** Those documents keep the old field, so the migration doesn't fully clear it. Renames inside arrays and renames that move a field to another object aren't scaffolded. They're listed on stderr as not scaffolded.

## 81. A removed type gets a delete that's commented out

- **Context:** `delete_` fails while other documents still reference the document, and the content is lost for good once it runs.
- **Choice:** The generated hook returns `[]`, and the `delete_(doc._id)` line is commented with a TODO about references. Running the file as it is changes nothing.
- **Trade-off:** A developer has to check the references and uncomment the line. That's one step more than a plain delete, and I'd rather have that step.

## 82. Array members are addressed by `_key`, with a helper in each file that needs it

- **Context:** An unset on `variants[].price` needs the keys of the members, which are only known at run time. Members without a `_key` can't be addressed by Sanity.
- **Choice:** Files for array paths include a small `fieldPaths` helper. It expands each `[]` step into `{ _key }` segments and skips members without a key. Plain paths like `seo.title` use the string form and don't include the helper.
- **Trade-off:** The helper adds about 20 lines to each array file. A keyless member is skipped without a message. The fixture data has none, but a dataset with keyless members would show fewer patches than the count.

## 83. An existing migration folder is never overwritten

- **Context:** A developer may have edited a scaffold. Regenerating after a later schema change would throw those edits away.
- **Choice:** The folder is created with `mkdir` without `recursive`. If it's already there, the scaffold is skipped and the CLI says so on stderr. The file itself is written with the `wx` flag.
- **Trade-off:** An old scaffold never picks up a later change to its own schema diff. To refresh one, the developer deletes its folder first.

## 84. Scaffold flags are `--migrations` and `--migrations-dir`

- **Context:** `parseArgs` from `node:util` can't read an optional value for one flag. `sanity migrations run` only finds migrations in the Studio's own folder.
- **Choice:** `--migrations` (a boolean) writes to `<studio>/migrations`. `--migrations-dir <dir>` writes to that directory and also turns scaffolds on. An empty directory is refused.
- **Trade-off:** Two flags for one feature. A directory other than the Studio's folder is only useful as an artifact, since the Sanity CLI won't find it there.

## 85. Scaffold messages go to stderr, so stdout stays the report

- **Context:** The Action redirects stdout into the report file for the PR comment. A stray line on stdout would end up in the comment.
- **Choice:** The count of files written, the skipped folders and the not-scaffolded rows all go to stderr. The report is printed the same way as before.
- **Trade-off:** Anyone reading a terminal sees the messages in a different stream. In the Action they appear in the job log.

## 86. The migration integration test only dry-runs

- **Context:** The migrate runner has a write mode, and a wrong flag in a test would write to `fixture-dev`.
- **Choice:** The test copies the fixture Studio, writes the scaffolds into the copy, and type-checks them with the Studio's own `tsconfig.json`. Then it runs each scaffold as `--dry-run` through a helper that refuses any other argument. It compares the document counts with the impact step.
- **Trade-off:** The test depends on the dry-run output format, which the Sanity CLI could change. A format change would fail the test loudly, which is the behaviour I want.

## 87. Scaffolds don't filter out drafts or versions

- **Context:** Impact counts drafts and release versions. The migration runner could have skipped them, and the counts would then have disagreed.
- **Choice:** No filter excludes them. The live dry run planned patches on 32 drafts and 5 versions, and those numbers equal the impact counts. The `filter` uses the same expression as the impact query, `hasData`, so the two sides keep the same definition of "has data".
- **Trade-off:** If a later migrate version starts skipping drafts, the integration test catches it, because the counts would no longer match.

## 88. The report's labels come from flags the action sets, not from the checkout

- **Context:** `actions/checkout` builds the merge commit on a `pull_request` event, so the head showed a detached SHA that nobody pushed. The base showed `origin/main`, which is the name git needs but not what anyone reads.
- **Choice:** `--base-name`, `--head-name` and `--head-sha` only change the labels. The action sets them on `pull_request` events, with the branch from `GITHUB_HEAD_REF` and the commit from `pull_request.head.sha`, and passes `main` as the base name. Git still gets `origin/main`. Local runs don't pass them, so they look as before.
- **Trade-off:** The head SHA in the report is the PR's commit, but the Studio that was extracted and validated is the merge commit. A reader could take the SHA for the thing that was checked. The report can't show both, so it shows the commit people push and review.

## 89. The action's build installs only the root package

- **Context:** `pnpm-workspace.yaml` also lists `fixtures/studio`. When the action is used from another repository, its checkout has the fixture Studio too, and the build step installed its Sanity dependencies for nothing.
- **Choice:** `pnpm install --frozen-lockfile --filter sanity-schema-impact`. I checked in a scratch copy that the fixture's `node_modules` isn't created, the lockfile doesn't change, `pnpm build` still works, and a filtered install after a full install keeps the Studio's dependencies.
- **Trade-off:** The filter names the package. Renaming the package in `package.json` breaks the build step, and the action-file test pins the string so that shows up in CI.

## 90. The removed-type scaffold has no unused import or parameter

- **Context:** The delete line was commented out, but its `delete_` import and `doc` parameter were still in the file. Strict Studios set `noUnusedLocals` and `noUnusedParameters`, and the file fails both.
- **Choice:** The file imports only `defineMigration`, and the commented `delete_` import sits in the TODO above it. The hook is `document()`, with no parameter. The integration test type-checks the generated files with both flags on, and I confirmed the old file fails that check.
- **Trade-off:** Whoever uncomments the delete also has to add the import and the parameter. That's two more edits, and the TODO lists them.

## 91. Actions are pinned to tags that exist, and the inputs were checked at each one

- **Context:** The tags I was asked for, `actions/checkout@v7.0.1`, `actions/setup-node@v7.1.0` and `pnpm/action-setup@v6.1.1`, all exist in each repository's tag list. I read each `action.yml` at its tag.
- **Choice:** The workflows and `action.yml` pin those tags. The inputs in use (`node-version`, `cache`, and no `version` on pnpm/action-setup, which reads `packageManager`) are still accepted.
- **Trade-off:** Tags can be moved, unlike SHAs. The repo already pins tags, and the README asks consumers to pin a full SHA, so I left the style alone.

## 92. Validation markers may have no code

- **Context:** Sanity v3 writes `documents validate` markers with a path, level and message, and no code. The parser required a string code, so a v3 Studio stopped the check with a malformed-output error on its first marker. Dogfooding found it. The fixtures were all v4 output.
- **Choice:** `code` is optional. A marker with no code, or an empty one, gets an empty `code`. The marker key and the grouping work the same for both.
- **Trade-off:** A marker without a code and one with a code count as the same problem when path and message match. That only matters if base and head ran on different Studio versions, which they don't in practice.

## 93. Unknown-field markers from v3 fold onto the removed field's row

- **Context:** v4 reports a field the schema no longer has as `object.unknown-field`. v3 only says `Field 'x' does not exist on type 'y'`. Without a change, a removed field would show twice on a v3 Studio: once on the structural row and once as a validation group.
- **Choice:** A group with no code folds the same way when the field named in the message is the last segment of the row's path, and the document type matches the row. The type in the message is the object's type, so I don't compare it with the document type.
- **Trade-off:** The match depends on the wording of the v3 message. If Sanity rewords it, those markers show as ordinary validation rows again. Nothing is hidden in that case, but the report gets noisier.

## 94. No separate guard for output whose markers all fail to parse

- **Context:** I wanted an error when the output has markers but none of them parse, so an empty result is never returned by mistake. The parser already throws on the first marker it can't read, and it gives the line number.
- **Choice:** I didn't add a second check. It can't fire on its own, and dead code is one more thing to keep tested. The existing error stays the guard.
- **Trade-off:** The message is the generic "Malformed validation output on line N.", which doesn't say the marker's shape was the problem. Changing that text would touch the existing tests, and the line number already points at the problem.

## 95. The `sanity` binary and the base links are found up to the repository root

- **Context:** npm and yarn workspaces install packages in the root's `node_modules`. The binary lookup and the base link only checked the Studio folder, so a workspace Studio had no binary in the base worktree.
- **Choice:** The binary is searched from the Studio folder up to the repository root, nearest first. For the base, each `node_modules` the head has on that path is linked to the same place in the worktree, unless the base already has one. These links go through the same cleanup as the others. The error no longer names a package manager.
- **Trade-off:** Base and head still share one install, as in entry 54. A base that needs a different root install than the head will get the head's.

## 96. The Studio's `.env` files are linked into the base

- **Context:** The Sanity CLI reads `.env` from the Studio folder when it loads the Studio. The base worktree has none, because `.env` is gitignored. The base Studio failed on a missing project ID, while the head worked because its own `.env` was there.
- **Choice:** Every `.env` and `.env.*` file in the head Studio that the base doesn't have is linked into the base Studio. The links go through the same cleanup. A file the base already has, such as a committed `.env.example`, is left alone.
- **Trade-off:** The base Studio now reads the head's local `.env`, including any token set there. The head's own run already reads that file. In CI there is no `.env` unless the workflow writes one.

## 97. `--pass-env` takes only `SANITY_STUDIO_*` names

- **Context:** A Studio can need a variable that isn't in the child process's environment (entry 74). Passing the whole environment would give Studio code the Sanity and GitHub tokens.
- **Choice:** `--pass-env NAME[,NAME]` copies the named values into both the extract and the validate child. Only names starting with `SANITY_STUDIO_` are accepted. The CLI refuses other names when it parses the arguments, and the adapter checks again before it builds a child's environment. A rejected value is not echoed, because a mistyped argument could hold a token. A name that is set nowhere is an error. The Action passes its `pass-env` input through `env:`.
- **Trade-off:** The rule is a naming convention. A token stored under a `SANITY_STUDIO_*` name would reach Studio code, and the flag can't tell it apart from a setting.
