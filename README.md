# sanity-schema-impact

Sanity schemas live in code, and content lives in the Content Lake. Changing the schema never changes the documents that already exist. Removed fields keep their data, removed types leave documents Studio can't show, and new validation rules fail on old documents without any warning. `sanity documents validate` checks a dataset against the current schema only. It doesn't compare two schemas, and it isn't meant to run on every pull request.

sanity-schema-impact runs on each pull request and reports what the change does to the content already in the dataset. It diffs the base and head schemas, counts the documents each change affects (drafts and release versions included), and lists the validation problems the change introduces.

## Example comment

The action posts this as one comment on the pull request, and updates it on each push:

```markdown
## Schema impact

`main` (`a1b2c3d`) to `schema/post-cleanup` (`f9e8d7c`), project `abc123xy`, dataset `production`.

### Structure

| Schema change                                                                    |
| -------------------------------------------------------------------------------- |
| Deleting type `category` orphans 58 published documents                          |
| Removing `post.featuredImage` leaves data in 340 published documents (12 drafts) |
| Making `post.slug` required adds problems in 12 published documents              |

### Validation

No new validation problems.

### Result

Failed rules: `data-loss`, `newly-required`.
```

## Quick start: GitHub Action

Add a workflow to the repository. The check needs a Viewer token (see [Token setup](#token-setup)) and the path to your Studio.

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
      - uses: shehabemon/sanity-schema-impact@v0
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
- The check needs the Studio's dependencies installed. Either set `install: 'true'` (runs `pnpm install --frozen-lockfile` at the repository root, pnpm only) or install them in an earlier step.
- The action fetches the base branch tip itself, so a default `actions/checkout` is enough.
- The action installs `sanity-schema-impact` from npm, at the version of the action you use. It doesn't install the Studio's dependencies.
- Pin a full commit SHA in production (`uses: shehabemon/sanity-schema-impact@<sha> # v0.1.0`). Releases are tagged `v0.x.y`.
- On a pull request the report names the pull request's branch and head commit. The checkout is the merge commit, so the report doesn't show that SHA.

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

The report is also written to the job summary. The comment can be posted from any shell with `sanity-schema-impact comment --file report.md`. It reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH` and `GITHUB_API_URL`. Outside a pull request event it warns and exits 0.

## Quick start: CLI

Run the CLI from a checkout of the branch you want to check. `--studio` is the Studio directory inside the repo, and `--base` is the ref to compare with (default `main`):

```bash
npx sanity-schema-impact --studio ./studio --base main
```

Requirements: Node 22.12 or newer, Sanity 3.33 or newer in the Studio (the first release with `sanity schema extract`), and the Studio's dependencies installed. In a workspace the `sanity` binary sits in the root's `node_modules`, and the CLI looks for it there too.

It needs a Viewer token in `SANITY_AUTH_TOKEN`, and a project and dataset from `--project` and `--dataset` or from `SANITY_STUDIO_PROJECT_ID` and `SANITY_STUDIO_DATASET`. Locally, Node's `--env-file` flag is enough: `node --env-file=.env ./node_modules/.bin/sanity-schema-impact --studio ./studio`.

The base is checked out as a git worktree, which has none of the head's untracked files. So the CLI links the head's `node_modules` folders and its `.env` files into the base for the run, and removes the links afterwards. A variable the Studio reads at load time that the CLI doesn't set has to be named with `--pass-env`.

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

### Migration scaffolds

With `--migrations`, the CLI writes one migration for each change that still has documents. Each one is a folder under `<studio>/migrations`, the place the Sanity CLI looks for migrations:

- Removed field: unsets the field on every document that has it.
- Possible rename: copies the value to the new field, then unsets the old one. A document that already has a value in the new field is left alone, so nothing is dropped.
- Removed type: a migration with the delete commented out. It changes nothing until you uncomment the line.

Changes with no documents get no file. Type changes, option changes, newly required fields, and renames inside arrays or across objects are listed on stderr as not scaffolded, because those need a decision from you.

The tool never runs a migration, and it never writes to the dataset. A folder that already exists is skipped and reported, so your edits survive a second run. Drafts and release versions are covered, the same as in the impact counts. Check each file, then dry-run it. A dry run is the default:

```bash
sanity migrations run unset-post-featured-image --project <id> --dataset <name>
sanity migrations run unset-post-featured-image --project <id> --dataset <name> --no-dry-run
```

On Sanity v3 the command is `sanity migration run`, singular. The flags are the same.

The report on stdout doesn't change. The scaffold messages go to stderr.

The head is the current checkout, including uncommitted Studio edits. The report shows the last commit's SHA, not a dirty marker. The base is a detached worktree at the base ref's commit. `NO_COLOR` turns off the table colours.

## Token setup

The tool only reads, so it needs a Viewer token and nothing more. Never give it an editor or admin token.

Create it at manage.sanity.io, logged in to the account that owns the project: open the project, go to API, then Tokens, and add a token with the Viewer role. `sanity manage`, run from the Studio folder, opens the right page.

On Sanity v4 and later you can also create it from the Studio folder with the Sanity CLI. Sanity v3 has no `tokens` command.

```bash
cd studio
pnpm exec sanity tokens add "schema impact" --role viewer
```

Add `-p <projectId>` if the Studio's Sanity config doesn't name the project.

Store the token as a repository secret named `SANITY_AUTH_TOKEN`. Optionally, store the project ID and dataset as repository variables (`SANITY_PROJECT_ID` and `SANITY_DATASET`) and map them to the `SANITY_STUDIO_*` variables, as in the example above.

## Security

- The validation diff runs `sanity documents validate` from the Studio's own `node_modules`. Custom validators in the Studio run inside that process, with the token in its environment. Use a dedicated Viewer token for this tool. A Viewer token can't write to the dataset, even if a validator tries.
- Pull requests from forks don't receive secrets. The action then prints a warning, the check is skipped, and the job passes.
- Never use `pull_request_target`. That event runs the workflow with the secrets while it checks out code from the pull request, and the Studio runs that code during the check. Use `pull_request`, where forks get no secrets.
- The tool is read-only. It never writes to a dataset, and migration scaffolds are files that you review and run yourself.
- The token is read from `SANITY_AUTH_TOKEN` and is never printed in a report or a log.

## Limitations

- `sanity schema extract`, which the structural diff relies on, is marked experimental by Sanity. Its output may change between Sanity releases.
- The extracted schema carries no validation rules except `required`. `min`, `max`, `regex`, custom validators, `deprecated` and `hidden` are absent, so rule changes are caught only by the validation diff.
- `datetime`, `date`, `text` and `url` all extract as `string`, so a change between them isn't reported as a type change.
- Rename detection is a heuristic. A removed and an added field with the same shape and a shared name word are reported as a possible rename.
- Counts use GROQ `defined()`, which treats an empty string or an empty array as set. The Studio may treat them as missing, so the two counts can differ. The report shows that difference when it matters.
- The validation diff runs the Studio twice, once for the base and once for the head, and each run takes about 8 seconds.

## License

MIT. See [LICENSE](LICENSE).

Contributor setup, the fixture Studio and the test layers are in [CONTRIBUTING.md](CONTRIBUTING.md).
