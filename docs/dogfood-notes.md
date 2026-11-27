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

## Second run: report noise

A second run against the same Studio, with about 6,000 documents. Each run compared `main` with one uncommitted schema edit.

- **Page run:** removed `page.dynamicRoute`, added a required text field `page.summary`, and made `page.body` required.
- **Product run:** removed `product.seo` and made `product.body` required. `shop` embeds `product` inline in an array, so the same two edits also show under `shop.products[]`.

### 4. Unrelated text fields were reported as a rename

- **Symptom:** `page.dynamicRoute` was shown as possibly renamed to `page.summary`, with "4 published documents still use the old name". The Studio also flagged those four as unknown fields.
- **Cause:** Rename detection paired any removed and added field that had the same parent and shape. Two plain text fields have the same shape, so the names were never compared.
- **Fix:** For plain text, number and boolean fields, the names must share a word. Decision 101.

### 5. A required field was reported twice

- **Symptom:** `product.body` appeared as "adds problems in 125 published documents (7 drafts)", and the validation table repeated it as a `Required` row with the same counts.
- **Cause:** The Studio reports each empty document as `value.required`, and the structure row already said the same thing.
- **Fix:** The Required group folds onto the newly-required row, and the row says whether the Studio's count matches. Required groups on a child path, such as `slug.current` under `slug`, fold onto the parent's row too. Decision 99. I checked the marker on a scratch copy of the fixture Studio with `required()` added to `post.slug`, so the dataset was never written. There the `slug` and `slug.current` groups both had 16 documents, and the row reads "Studio flags the same documents" with no validation row left.

### 6. Rows with no documents took up most of the comment

- **Symptom:** The product run's zero rows (`product.seo`, and `shop.products[].body` and `shop.products[].seo`) said "no existing documents affected", in the same table as the rows that touch content.
- **Cause:** `shop` embeds `product` inline in an array, so every product edit repeats under `shop.products[]`. Those repeats have no documents of their own. The Markdown listed every change in one table, in path order.
- **Fix:** Counted rows with no documents go into a collapsed block below the table. This is what made the collapsed block worth doing. Decision 100.

### 7. Validation counts were worded differently from structure rows

- **Symptom:** The same fact read "125 published documents (7 drafts)" in one table and "125 published, 7 drafts, 0 in releases" in the other.
- **Fix:** One helper writes both. Decision 98.

### 8. Unmeasured rows didn't say which change they were

- **Symptom:** With both edits in place, and the rename no longer paired, the added `page.summary` field showed as `Not measured: adding a field changes no existing document`, with no field name, in the main table.
- **Fix:** Every row now names its change first. Changes that can't touch documents go in the collapsed block. Decision 102.
