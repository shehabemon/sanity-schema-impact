# Contributing

Thanks for looking at the code. This file covers the development setup, the fixture Studio and the test layers. The user docs are in the [README](README.md).

## Development setup

Requirements: Node 22.12 or newer (see `.nvmrc`) and pnpm 12 (pinned in `package.json`).

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration  # needs SANITY_AUTH_TOKEN and the fixture variables, skips without them
pnpm build
pnpm seed --dry-run    # offline: prints fixture counts only
```

### Environment variables

| Variable                   | Used by               | Notes                                                  |
| -------------------------- | --------------------- | ------------------------------------------------------ |
| `SANITY_STUDIO_PROJECT_ID` | Studio, seed          | Project ID of the fixture project.                     |
| `SANITY_STUDIO_DATASET`    | Studio, seed          | Must start with `fixture` for seeding.                 |
| `SANITY_SEED_TOKEN`        | seed only             | Editor token for the fixture project. Never commit it. |
| `SANITY_AUTH_TOKEN`        | the tool, integration | Viewer token. The only token the tool reads.           |

Copy values into a local `.env` file at the repo root, or export them in your shell. `.env*` is git-ignored.
`pnpm seed` loads `.env` itself through Node's `--env-file-if-exists` flag (Node 22.9+, so 22.12+ is fine). A missing `.env` is not an error. Never commit `.env`.

### Creating the fixture project and seeding it

1. Create a Sanity project at sanity.io/manage, for example named `schema-impact-fixture`.
2. Add a dataset named `fixture-dev`. The name must start with `fixture`, or the seed script refuses to run.
3. In the project's API settings, create an Editor token for this project only. Copy it once.
4. Export the variables:
   ```bash
   export SANITY_STUDIO_PROJECT_ID=<your project id>
   export SANITY_STUDIO_DATASET=fixture-dev
   export SANITY_SEED_TOKEN=<the Editor token>
   ```
5. Seed the dataset. It is safe to re-run. Add `--reset` to delete the fixture documents first:

   ```bash
   pnpm seed            # or: pnpm seed --reset
   ```

   The seed also creates the release `rFixture01` with eight versions of published posts (`versions.rFixture01.*`). `--reset` deletes those versions but keeps the release document.

   The seed first uploads four small solid-colour PNGs (generated in code by `fixtures/png.ts`). Sanity returns content-hashed asset IDs, and every image reference points at one of them, so the Content Lake accepts the strong references. Re-running uploads the same bytes and gets the same IDs. `pnpm seed --dry-run` makes no network calls and uses placeholder asset IDs.

6. Optional: run the Studio locally with `cd fixtures/studio && pnpm exec sanity dev`. Log in to Sanity first if prompted.

The fixture Studio schema can also be extracted without logging in:
`cd fixtures/studio && pnpm exec sanity schema extract --enforce-required-fields`.

### Integration tests

`pnpm test:integration` runs `test/integration/impact.test.ts`, `test/integration/validation.test.ts` and `test/integration/migrations.test.ts` against the fixture dataset with `SANITY_AUTH_TOKEN` (Viewer). It loads `.env` itself, and skips every test unless `SANITY_AUTH_TOKEN`, `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` are all set. `pnpm test` never runs it. The validation test copies the fixture Studio to a temp directory, adds a stricter title rule there, and never edits `fixtures/studio`. The migration test does the same copy, generates the scaffolds into it, type-checks them, and runs only `sanity migrations run --dry-run` against them.

CI runs the integration tests in an `integration` job, only on pushes to `main` and only after the main job passes. The job reads the repository secret `SANITY_AUTH_TOKEN` and the repository variables `SANITY_PROJECT_ID` and `SANITY_DATASET`. Until those exist, the tests skip and the job passes. Pull requests from forks don't receive secrets, so the job never runs for them.

### Releasing

The version lives in three places, and they must match: `version` in `package.json`, `VERSION` in `src/version.ts`, and `CLI_VERSION` in the install step of `action.yml`. `test/smoke.test.ts` and `test/action/action-file.test.ts` fail when the first two or the last one drift apart. The Action installs the CLI from npm at `CLI_VERSION`, so publish the npm release before moving the Action's tag.

Releases are published by `.github/workflows/release.yml`, not from a laptop. npm trusts that workflow by its file name, so the repository holds no npm token, and each version gets a provenance statement.

1. Bump the version in the three places above, commit, and push to `main`. Wait for CI.
2. Tag the commit and push the tag: `git tag -a v0.2.0 -m "0.2.0" && git push origin v0.2.0`.
3. The Release workflow checks that the tag matches `package.json`, runs the checks, and publishes. A tag with a prerelease part, such as `v0.2.0-beta.1`, goes to the `next` dist-tag.
4. After it passes, move the `v0` tag to the same commit (`git tag -f -a v0 -m "Latest 0.x release (0.2.0)" && git push -f origin v0`) and publish the GitHub release.

## Layout

- `src/` the tool (diff, impact, validation, report, adapters, cli)
- `test/` Vitest tests and schema fixtures
- `fixtures/` seed script, data generator and fixture Studio (`fixtures/studio`)
- `docs/decisions.md` design decisions and trade-offs
