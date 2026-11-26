# Dogfood notes

Three bugs turned up when I ran the CLI against a real Studio for the first time. They are fixed, and each fix has a decision entry. This file records the run and what it showed.

## Setup

- Studio: Sanity 3.79.0, in an npm workspaces repository. The Studio sits in `apps/sanity`, and its packages are hoisted to the repository root's `node_modules`.
- Dataset: about 6,000 documents.
- Command, from the repository root, with the project and dataset read from the Studio's gitignored `.env`:

  ```bash
  node <repo>/dist/cli.js --base main --studio apps/sanity --project "$ID" --dataset "$DATASET"
  ```

- Runs: no schema change, then a temporary uncommitted edit removing one field from a nested object that existing documents hold. The edit was reverted afterwards.

## Findings

### 1. Sanity v3 validation markers have no code

- **Symptom:** On a v3 Studio the validation step failed with `Malformed validation output on line 1.`, and the check exited 2.
- **Cause:** v3 markers carry a path, a level and a message, and no `code`. The parser required a string `code`.
- **Fix:** `code` is optional and is stored as empty. Unknown-field markers from v3, which read `Field 'x' does not exist on type 'y'`, fold onto the removed-field row the same way v4's `object.unknown-field` does. Groups with no code print the message alone. Decisions 92 and 93.

### 2. Hoisted `node_modules` were not found in the base checkout

- **Symptom:** In a workspace layout the base extract couldn't find the `sanity` binary.
- **Cause:** The binary lookup and the base link only checked the Studio folder. npm workspaces put the packages in the repository root.
- **Fix:** The binary is searched from the Studio up to the repository root. Each `node_modules` the head has on that path is linked into the same place in the base checkout, and the links are removed with the worktree. Decision 95.

### 3. The base Studio didn't get its `.env`

- **Symptom:** The head Studio extracted fine. The base extract failed with ``Configuration must contain `projectId` ``.
- **Cause:** The Studio reads `SANITY_STUDIO_ID`, and the child process only gets `PATH`, `HOME` and the project and dataset that the CLI passes. The Sanity CLI loads the Studio's gitignored `.env` on its own, and the head had one. The base worktree didn't.
- **Fix:** The head's `.env` and `.env.*` files that the base doesn't have are linked into the base Studio. For a Studio that needs more variables, `--pass-env SANITY_STUDIO_*` passes them to both children. Decisions 96 and 97.

## What worked

- Timings, measured here with the Sanity CLI directly on the head Studio: `schema extract` took 2.9 s and `documents validate` took 7.6 s. A full run of the CLI took about 23 s, including both Studios.
- The normaliser read the extract as 18 types and 430 fields. Every field has a known kind, so nothing fell through to an unknown kind.
- The removed-field row carried the unknown-field count: the structural row showed the documents still holding the field, with the Studio's flag noted on the same line, and no separate validation row.
- A run with no schema change exited 0 with no leftover worktrees, symlinks or temporary directories.

## Not a bug

- The extract lists `media.tag` as a document type. The media plugin registers it as one, so the extract is right to include it.
