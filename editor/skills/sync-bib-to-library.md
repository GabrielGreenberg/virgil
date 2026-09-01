---
description: |
  Tidy a Virgil paper's bibliography against the user's Virgil Library
  — swap matched entries to the library's authoritative version,
  rename citekeys throughout the document accordingly, and add any
  missing entries to the library. Triggers on: "Virgil, sync my
  bibliography", "tidy my refs against the library", "fix my bib",
  "clean up my references", "merge my refs with the library", "make
  sure my citekeys match the library". Run with --dry-run first if the
  user hasn't confirmed they want writes. Does NOT trigger for
  verifying a single bib entry (use answer-bib-review). Args:
  <docPath> [--dry-run] [--library <path>].
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

> **Allowable-LaTeX doctrine.** The citekey rename this skill performs
> rewrites `\cite…` commands in `document.tex`, and the entry blocks it swaps
> into `references.bib` carry LaTeX in their field values. Both must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular keep the `\cite…`
> family's spelling intact (a rename changes only the KEY inside the braces)
> and use the tie `~`, never `\textasciitilde{}`, for a non-breaking space;
> anything outside the allowlist renders as raw grey monospace.

> **Shared doctrine — find-or-surface, never fabricate.** Read
> [_find-or-surface.md](_find-or-surface.md). The **missing-entries**
> step above authenticates each new entry through the library pipeline —
> so this skill can mint a `master.bib` row. Never fake one: if a
> missing entry won't authenticate, let its terminal state
> (`unverified` / `failed`) stand as the surfaced gap and leave it for a
> human, rather than swapping in a guessed entry.

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
  (`./.virgil/library-path.json` → `VIRGIL_LIBRARY_ROOT` →
  `~/.config/virgil/library-path.json` → `~/Virgil-Library/`) is used.

## Procedure

Paths below are relative to the cwd you ran cowork from — typically the
paper folder (post-sync, Virgil-managed) or the Virgil source repo (dev
workflow). Both work; we pick the right helper-script location at the
top of step 1.

1. **Resolve the library.**
   ```bash
   # Set from the invocation above: LIBRARY holds the value of an explicit
   # `--library <path>`, and stays empty when the caller didn't pass one.
   # Build the flag as an ARRAY, not a `${LIBRARY:+--library "$LIBRARY"}`
   # string — under zsh that idiom collapses into ONE argument
   # ("--library /path") and argparse rejects it. Empty array = zero args,
   # so an absent flag falls through to the normal resolution chain.
   LIBRARY=""   # e.g. LIBRARY="/Users/me/Papers/Virgil-Library"
   lib_args=()
   [ -n "$LIBRARY" ] && lib_args=(--library "$LIBRARY")

   # Synced PWA folders have library_path.py under .virgil/scripts/editor/.
   # The Virgil source repo has it under editor/scripts/. Either is fine.
   library_path_py=""
   for candidate in .virgil/scripts/editor/library_path.py editor/scripts/library_path.py; do
     [ -f "$candidate" ] && { library_path_py="$candidate"; break; }
   done
   if [ -z "$library_path_py" ]; then
     echo "This folder doesn't look Virgil-managed (no editor scripts found)."
     echo "Open the paper in Virgil first so cowork tooling syncs into it."
     exit 1
   fi
   library_root=$(python3 "$library_path_py" --get "${lib_args[@]}") || true
   # Derive the editor scripts directory from the resolved library_path.py.
   # Used below for `bib_match_library.py` etc. so we stay consistent
   # with whichever location the resolver was found in.
   scripts_dir="$(dirname "$library_path_py")"
   ```
   If the second command failed (no `library_root` populated), surface a
   clean message and stop:
   ```
   No library set up. Pick a library in Virgil first.
   ```
   You may optionally offer (once) to record the path on the user's
   behalf: ask *"Where is your Virgil Library? (absolute path; leave
   blank to skip)"*. On a non-empty answer:
   ```bash
   python3 "$library_path_py" --set "<their answer>"
   library_root=$(python3 "$library_path_py" --get)
   ```
   If they leave it blank or the path doesn't validate, stop with
   `error: library path not set — pick a library in Virgil first, or
   re-run after setting it via library_path.py --set <abs-path>`. Don't
   fall back to guessing.

2. **Match phase.** Classify every paper entry:
   ```bash
   python3 "$scripts_dir/bib_match_library.py" "<docPath>" \
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
     bundles the citekey rename **into the same atomic contract op as the
     `.bib` swap** — `bibEdit` `replace` + `renameCitekey` in one
     pen-protected `apply_response` commit, so `document.tex`'s `\cite*{}`
     commands and `virgil/citations.json` are retargeted together with the
     `references.bib` body: the entry's bib, cites, and cards land
     together-or-not-at-all. (No standalone `rename_citekey.py` write path
     any more — its pure rewriters ride the contract.)
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

   b. **Build a triage JSONL** with one `bib-only` row per entry, by
      running the library's own batch engine SCOPED to the bundle with
      `--only`:
      ```bash
      (cd "$library_root" && \
       python3 .virgil/scripts/library/triage_batch.py \
         --library . --only "$(basename "$bundle")" \
         --output /tmp/sync-triage.jsonl)
      ```
      `--only` takes a bare filename relative to `unsorted/` and errors
      (exit 2) on a miss rather than falling back to the whole inbox, so
      this is a tightly-scoped run: nothing else sitting in `unsorted/`
      is triaged, moved or enqueued.

      **Do not hand-roll the rows.** The engine is the ONE implementation
      of what a `.bib` entry becomes, and an inline copy silently drops
      what `triage_apply` reads: the verbatim entry text (`bibEntryRaw`),
      the `citekey-exists` collision flag with the existing entry's
      resolved `bib.state`, TeX-stripped field values, and — the one that
      changes behaviour — an `@unpublished` entry's `manuscript` state,
      without which a manuscript lands as `unverified` and is queued for
      authentication it should never get.

   c. **Apply the triage JSONL** from inside the library root (so
      `triage_apply.py` resolves `master.bib` and `.virgil/catalog.json`
      correctly through its locked shims):
      ```bash
      (cd "$library_root" && \
       python3 .virgil/scripts/library/triage_apply.py \
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
   python3 "$scripts_dir/bib_match_library.py" "<docPath>" \
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
