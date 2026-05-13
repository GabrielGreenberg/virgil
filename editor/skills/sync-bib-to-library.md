---
description: Tidy a paper's references.bib against the Virgil Library — swap matched entries to library-authoritative versions (renaming citekeys throughout the doc), and add missing entries to the library via the bib-only triage + authentication pipeline. Args - <docPath> [--dry-run] [--library <path>].
---

# /editor/sync-bib-to-library $ARGUMENTS

Reconcile every entry in `<docPath>/references.bib` with the user's
Virgil Library:

- **Matched entries** (citekey, DOI, or title+author hit on
  `master.bib`) → replace the paper's entry block with the library's
  authoritative form; rename citekeys throughout `document.tex` and
  `virgil/citations.json` if the library uses a different key.
- **Missing entries** → fan-out into the library's bib-only triage
  pipeline (`triage_apply.py`), then authenticate each via
  `/library/authenticate-bib`, then loop back and swap them in.
- **Ambiguous entries** (same author+year, similar title, multiple
  library candidates) → write a markdown review note under
  `<docPath>/virgil/notes/` for the user to disambiguate manually.

This skill is safe to run from the editor session — the library's
locked CLI shims (`master.bib.lock`, `catalog.json.lock`,
`notifications/inbox.json.lock`) serialize writes even if a parallel
library session is running (e.g., `/loop /library/index-pending`).
Pausing that loop while this runs makes output cleaner; it isn't
required.

## Args

- `<docPath>` — path to the paper folder (contains `document.tex`,
  `references.bib`, `virgil/`).
- `--dry-run` — print the per-entry decision table and exit without
  writing anything. Recommended for the first run on any paper.
- `--library <path>` — override library-path resolution. Useful when
  multiple libraries exist; otherwise the chain
  (`VIRGIL_LIBRARY_ROOT` → `~/.config/virgil/library-path.json` →
  `~/Virgil-Library/`) is used.

## Procedure

All paths below are relative to the repository root (the Virgil source
tree).

1. **Resolve the library.**
   ```bash
   library_root=$(python3 editor/scripts/library_path.py --get ${LIBRARY:+--library "$LIBRARY"}) || true
   ```
   If the command failed (non-zero exit), tell the user the resolved
   error message verbatim, then ask them once: *"Where is your Virgil
   Library? (absolute path)"*. On their answer:
   ```bash
   python3 editor/scripts/library_path.py --set "<their answer>"
   library_root=$(python3 editor/scripts/library_path.py --get)
   ```
   If they refuse or the path doesn't validate, stop and report
   `error: library path not set — re-run after setting it via
   library_path.py --set <abs-path>`. Don't fall back to guessing.

2. **Match phase.** Classify every paper entry:
   ```bash
   python3 editor/scripts/bib_match_library.py "<docPath>" \
       --library "$library_root" \
       --output /tmp/sync-match.jsonl
   ```
   Each row has `status ∈ {matched, missing, ambiguous}` plus the
   library citekey on `matched`.

3. **Report.** Print a per-entry decision table. Columns: paper
   citekey · status · library citekey · match source. Include counts
   (N matched, K missing, P ambiguous) at the bottom.

   **If `--dry-run` is set, stop here.** Tell the user to re-run
   without the flag to apply.

4. **Apply matches (pass 1).** For each `matched` row:
   - If `paper_citekey == library_citekey`, the entry may already be
     identical — still delegate; `answer-bib-review` no-ops cheaply
     when the swap doesn't change bytes.
   - Invoke per-entry:
     ```bash
     /editor/answer-bib-review "<docPath>" "<paper_citekey>" \
         --library-sync "<library_citekey>" \
         --library "$library_root"
     ```
   - On rename (paper citekey ≠ library citekey), the per-entry skill
     calls `rename_citekey.py`, which atomically rewrites
     `document.tex` and `virgil/citations.json`.
   - Collect a short status line per entry (`Done: library-sync …`)
     for the final summary.

5. **Add missing entries (skip if none).**

   a. **Build a bundle file** of missing entries inside `unsorted/`:
      ```bash
      slug=$(basename "<docPath>" | tr -c 'A-Za-z0-9' '-' | tr -s '-' | sed 's/^-//;s/-$//')
      ts=$(date -u +%Y%m%dT%H%M%SZ)
      bundle="$library_root/unsorted/sync-$slug-$ts.bib"
      mkdir -p "$library_root/unsorted"
      ```
      Concatenate the raw entry blocks for every `missing` row from
      `/tmp/sync-match.jsonl` into `$bundle`. Use the `paper_fields`
      payload from the JSONL plus the paper's verbatim entry text
      (read with `_bib_parse.find_entry_span` against
      `<docPath>/references.bib`).

   b. **Build a triage JSONL** with one `bib-only` row per entry. Do
      **not** call `triage_batch.py` — that scans every file in
      `unsorted/` and we want a tightly-scoped run. Instead, emit
      directly:
      ```bash
      python3 -c '
      import json, sys
      from pathlib import Path
      sys.path.insert(0, "library/scripts")
      from _bib_parse import read_bib_file
      bundle = Path("'"$bundle"'")
      rows = []
      for e in read_bib_file(bundle):
          rows.append({
              "filename":         bundle.name,
              "flags":            ["bib-only"],
              "extension":        "bib",
              "proposedCitekey":  e["citekey"],
              "proposedType":     e["type"],
              "proposedFields":   e["fields"],
              "proposedBibState": "unverified",
          })
      Path("/tmp/sync-triage.jsonl").write_text(
          "\n".join(json.dumps(r) for r in rows) + "\n",
          encoding="utf-8",
      )
      print(f"queued {len(rows)} bib-only triage rows")
      '
      ```

   c. **Apply the triage JSONL** from inside the library root (so
      `triage_apply.py` resolves `master.bib` and `.virgil/catalog.json`
      correctly through its locked shims):
      ```bash
      (cd "$library_root" && \
       python3 .virgil/scripts/triage_apply.py \
         --input /tmp/sync-triage.jsonl \
         --library .)
      ```
      This upserts each entry into `master.bib`, creates
      `papers/<citekey>/`, inserts a bib-only catalog row, and queues
      `kind: "authenticate"` per citekey.

   d. **Delete the bundle** from `unsorted/` once `triage_apply.py`
      finishes — it's transient:
      ```bash
      rm -f "$bundle"
      ```

   e. **Authenticate each new citekey.** For every citekey produced
      by step (c), invoke `/library/authenticate-bib <citekey>` from
      inside the library root. The skill uses the locked Python shims,
      so it's safe even with a parallel `/loop /library/index-pending`
      session. You can authenticate sequentially (simpler) or
      delegate to subagents in parallel (faster for large batches).

6. **Re-match (pass 2).** Now that the missing entries live in
   `master.bib`, re-run the matcher and apply the swap for the same
   set of paper citekeys:
   ```bash
   python3 editor/scripts/bib_match_library.py "<docPath>" \
       --library "$library_root" \
       --output /tmp/sync-match-2.jsonl
   ```
   For rows that flipped from `missing` to `matched`, run step 4 per
   entry. Anything still `missing` (e.g., triage rejected it as a
   collision) goes into the ambiguous review note in step 7.

7. **Write the ambiguous-review note** if any ambiguous (or
   still-missing) rows remain:
   ```
   <docPath>/virgil/notes/sync-bib-review-<ISO>.md
   ```
   Body: one section per row, with the paper citekey, the candidates
   (for ambiguous) or the reason (for residual missing), and a
   suggested resolution. Skip writing the file if every entry resolved.

8. **Final notification + reply.**
   ```bash
   python3 -c "from editor.scripts._common import append_notification, bump_version, now_iso, resolve_doc; \
               doc = resolve_doc('<docPath>'); \
               append_notification(doc, {'kind': 'ai-request-complete', 'at': now_iso(), 'summary': 'sync-bib-to-library: <N> matched, <K> added, <P> flagged'}); \
               bump_version(doc)"
   ```
   Reply (single line):
   ```
   Done: synced <total> entries (<M> swapped, <K> added, <P> flagged). Output: references.bib, document.tex, virgil/citations.json[, virgil/notes/sync-bib-review-…md].
   ```

## Idempotence

Re-running on a paper whose bib already mirrors the library is a
no-op: pass 1 reports 100% matched, pass 2 has nothing to do,
no missing entries to triage, no ambiguous note written.

## Safety

- **Don't auto-swap on ambiguous matches.** When the signature
  (surname + year ± 1 + normalized title) hits multiple library
  candidates, write the review note and leave the paper's entry
  alone.
- **Don't fall back to `~/Virgil-Library/` silently.** The library
  path *must* resolve through `library_path.py`. If the chain fails,
  surface the error and exit — never guess.
- **Trust library terminal states.** `bib.state ∈ {failed,
  unverified, manuscript, canonical}` are still authoritative for the
  paper. Mention any non-`authenticated` state in the report so the
  user knows to follow up in the library.
- **Don't delete entries from `references.bib` that aren't in
  `paper.tex`.** Some users keep an extended bibliography. Reconcile
  fields, but don't prune.

## Reply format

One line. Examples:

```
Done: synced 23 entries (18 swapped, 4 added, 1 flagged). Output: references.bib, document.tex, virgil/citations.json, virgil/notes/sync-bib-review-20260513T142500Z.md.
```

```
Done: dry-run on 23 entries (18 matched, 4 missing, 1 ambiguous). Re-run without --dry-run to apply.
```
