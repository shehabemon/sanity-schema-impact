# sanity-schema-impact

Shows, on every pull request, how a Sanity schema change affects content that already exists in the dataset. Work in progress.

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

`pnpm test:integration` runs `test/integration/impact.test.ts` and `test/integration/validation.test.ts` against the fixture dataset with `SANITY_AUTH_TOKEN` (Viewer). It loads `.env` itself, and skips every test unless `SANITY_AUTH_TOKEN`, `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` are all set. `pnpm test` never runs it. The validation test copies the fixture Studio to a temp directory, adds a stricter title rule there, and never edits `fixtures/studio`.

### Validation and Studio code

The validation diff runs `sanity documents validate` from each Studio's own `node_modules`. Custom validators in the Studio run inside that process, with the token in its environment. So:

- Use a dedicated Viewer token for this tool, never an editor or admin token.
- Never run it from a `pull_request_target` workflow. That event gives the job secrets while it runs code from the pull request. Use `pull_request`, where forks get no secrets.

CI runs it in an `integration` job, only on pushes to `main` and only after the main job passes. The job reads the repository secret `SANITY_AUTH_TOKEN` and the repository variables `SANITY_PROJECT_ID` and `SANITY_DATASET`. Until those exist, the tests skip and the job passes. Pull requests from forks don't receive secrets, so the job never runs for them.

## Layout

- `src/` the tool (diff, impact, validation, report, adapters)
- `test/` Vitest tests and schema fixtures
- `fixtures/` seed script, data generator and fixture Studio (`fixtures/studio`)
- `docs/decisions.md` design decisions and trade-offs
