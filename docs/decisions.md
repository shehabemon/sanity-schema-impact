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
