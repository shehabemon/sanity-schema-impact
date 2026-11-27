# sanity-schema-impact

Shows, on every pull request, how a Sanity schema change affects content that already exists in the dataset. Work in progress.

## Usage

Run the CLI from a checkout of the branch you want to check. `--studio` is the Studio directory inside the repo, and `--base` is the ref to compare with (default `main`):

```bash
npm install                        # or pnpm/yarn: the Studio's dependencies must be installed
sanity-schema-impact --studio ./studio --base main
```

It needs a Viewer token in `SANITY_AUTH_TOKEN`, and a project and dataset from `--project` and `--dataset` or from `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`. Locally, Node's `--env-file` flag is enough: `node --env-file=.env dist/cli.js --studio ./fixtures/studio`.

In an npm or yarn workspace the `sanity` binary sits in the repository root's `node_modules`, and the CLI looks for it there too. The base is checked out as a git worktree, which has none of the head's untracked files. So the CLI links the head's `node_modules` folders and its `.env` files into the base for the run, and removes the links afterwards. A variable the Studio reads at load time that the CLI doesn't set has to be named with `--pass-env`.

| Option                   | Meaning                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `--studio <dir>`         | Studio directory inside the repo (required).                                                                  |
| `--base <ref>`           | Ref to compare with (default `main`).                                                                         |
| `--base-name <name>`     | Name shown for the base in the report (default: the `--base` value).                                          |
| `--head-name <name>`     | Name shown for the head in the report (default: the checked-out branch).                                      |
| `--head-sha <sha>`       | Full commit SHA shown for the head in the report (default: the checked-out commit).                           |
| `--format <format>`      | `table` (default), `md` for a PR comment, or `json`.                                                          |
| `--fail-on <rules>`      | Comma-separated rules that make the exit code 1. Default `data-loss,newly-required,validation-error`.         |
| `--skip-validation`      | Skip the validation diff. Only the structural diff and the counts run.                                        |
| `--pass-env <names>`     | Comma-separated `SANITY_STUDIO_*` variables passed to the Studio's Sanity processes. Other names are refused. |
| `--project`, `--dataset` | Override the Sanity project and dataset.                                                                      |
| `--migrations`           | Write migration scaffolds to `<studio>/migrations`. See below.                                                |
| `--migrations-dir <dir>` | Write migration scaffolds to `<dir>` instead. Turns `--migrations` on.                                        |

Rules: `data-loss` (a removed field or type still has documents), `newly-required`, `options-changed`, `validation-error` (an introduced error), `validation-warning` (an introduced warning or error), `any`, `none`.

Exit codes: 0 when no rule matched, 1 when one did, 2 for a usage or runtime error.

## Migration scaffolds

With `--migrations`, the CLI writes one migration for each change that still has documents. Each one is a folder under `<studio>/migrations`, the place `sanity migrations run` looks:

- Removed field: unsets the field on every document that has it.
- Possible rename: copies the value to the new field, then unsets the old one. A document that already has a value in the new field is left alone, so nothing is dropped.
- Removed type: a migration with the delete commented out. It changes nothing until you uncomment the line.

Changes with no documents get no file. Type changes, option changes, newly required fields, and renames inside arrays or across objects are listed on stderr as not scaffolded, because those need a decision from you.

The tool never runs a migration, and it never writes to the dataset. A folder that already exists is skipped and reported, so your edits survive a second run. Drafts and release versions are covered, the same as in the impact counts. Check each file, then dry-run it. A dry run is the default:

```bash
sanity migrations run unset-post-featured-image --project <id> --dataset <name>
sanity migrations run unset-post-featured-image --project <id> --dataset <name> --no-dry-run
```

The report on stdout doesn't change. The scaffold messages go to stderr.

The head is the current checkout, including uncommitted Studio edits. The report shows the last commit's SHA, not a dirty marker. The base is a detached worktree at the base ref's commit. `NO_COLOR` turns off the table colours.

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

### Validation and Studio code

The validation diff runs `sanity documents validate` from each Studio's own `node_modules`. Custom validators in the Studio run inside that process, with the token in its environment. So:

- Use a dedicated Viewer token for this tool, never an editor or admin token.
- Never run it from a `pull_request_target` workflow. That event gives the job secrets while it runs code from the pull request. Use `pull_request`, where forks get no secrets.

CI runs it in an `integration` job, only on pushes to `main` and only after the main job passes. The job reads the repository secret `SANITY_AUTH_TOKEN` and the repository variables `SANITY_PROJECT_ID` and `SANITY_DATASET`. Until those exist, the tests skip and the job passes. Pull requests from forks don't receive secrets, so the job never runs for them.

## GitHub Action

The action runs the check on pull requests, writes the report to the job summary, and keeps one comment on the pull request up to date.

```yaml
name: Schema impact

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  schema-impact:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: shehabemon/sanity-schema-impact@v0.1.0-beta.1 # pin a full commit SHA in production
        env:
          SANITY_AUTH_TOKEN: ${{ secrets.SANITY_AUTH_TOKEN }}
          SANITY_STUDIO_PROJECT_ID: ${{ vars.SANITY_PROJECT_ID }}
          SANITY_STUDIO_DATASET: ${{ vars.SANITY_DATASET }}
        with:
          studio: studio
          install: 'true'
```

- `SANITY_AUTH_TOKEN` is a Viewer token, stored as a repository secret. It is required.
- `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET` are optional. The CLI reads them when `--project` and `--dataset` aren't given.
- The Sanity values come from `env:`, not `with:`, so the token never appears in a workflow input.
- The check needs the Studio's dependencies installed. Either set `install: 'true'` (runs `pnpm install --frozen-lockfile` at the repository root) or install them in an earlier step.
- Pin a full commit SHA in production (`uses: shehabemon/sanity-schema-impact@<sha> # v0.x.y`). Releases are tagged `v0.x.y`; the current one is the beta `v0.1.0-beta.1`.
- The action builds the CLI from its own source on each run, with Node 22 and pnpm. The npm release will replace that with a pinned `npx` call. That build installs only the CLI's own dependencies, not the fixture Studio's.
- On a pull request the report names the pull request's branch and head commit. The checkout is the merge commit, so the report doesn't show that SHA.

**Pull requests from forks** don't receive secrets. The action then prints a warning, the check is skipped, and the job passes.

**Never use `pull_request_target`.** That event runs the workflow with the secrets while it checks out code from the pull request. The Studio runs its own code (custom validators) during the check, so a fork could read the token. Use `pull_request`.

| Input             | Default               | Meaning                                                                                                     |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `studio`          | required              | Studio directory inside the repository.                                                                     |
| `base`            | `''`                  | Branch to compare with. Empty means the pull request's base branch, or `main` outside pull requests.        |
| `fail-on`         | `''`                  | Rules that fail the step, as in the CLI. Empty uses the CLI defaults.                                       |
| `skip-validation` | `false`               | Skip the validation diff.                                                                                   |
| `install`         | `false`               | Run `pnpm install --frozen-lockfile` at the repository root before the check. pnpm only.                    |
| `pass-env`        | `''`                  | `SANITY_STUDIO_*` variables for the Studio's Sanity processes, as in `--pass-env`. Other names are refused. |
| `comment`         | `true`                | Create or update the pull request comment. Only on `pull_request` events.                                   |
| `github-token`    | `${{ github.token }}` | Token for the comment. Needs `pull-requests: write`.                                                        |

The step exits with the CLI's exit code, so `fail-on` decides whether the check fails. A comment that can't be posted is reported as a failed step, and it doesn't hide the check's result.

The comment is found by its first line, `<!-- sanity-schema-impact -->`, and updated in place. GitHub caps a comment at 65,536 characters. A longer report is cut at a line break, with a note that the full report is in the job summary.

The comment can also be posted from any shell: `sanity-schema-impact comment --file report.md`. It reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH` and `GITHUB_API_URL`. Outside a pull request event it warns and exits 0.

## Layout

- `src/` the tool (diff, impact, validation, report, adapters, cli)
- `test/` Vitest tests and schema fixtures
- `fixtures/` seed script, data generator and fixture Studio (`fixtures/studio`)
- `docs/decisions.md` design decisions and trade-offs
