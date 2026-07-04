# Hardening spec — stop new duplicates at every intake path

Status: implementation contract. Depends on `work_identity.py` (see DEDUP_DESIGN.md).

## Principle

One shared work-identity guard, consulted by every path that can mint a record.
A new record is admitted only if no existing work matches; a `same`-work match is
refused-and-reported; an `uncertain` match is surfaced for review. Backward
compatible: all new params are keyword-only and optional, so untouched callers
keep working.

## New shared helper (in `work_identity.py`)

```
find_work_in_library(fields, entry_type, library, *, index=None,
                     include_uncertain=True) -> Match | None
```
- Builds a `WorkIndex` from `master.bib` (`read_master_bib`) + catalog
  (`read_catalog`) once, or reuses a passed-in `index` (so a batch caller builds
  it once). Records carry catalog meta (bib_state, indexed_state, has_folder).
- Also consults `.virgil/aliases.json`: if the incoming citekey is a known alias,
  resolve straight to the survivor.
- Returns `Match{citekey, relation, confidence, reasons}` for the best `same`
  (or, if `include_uncertain`, `uncertain`) hit, else None.

## Wiring (each is a small, additive guard)

1. **`upsert_catalog_entry` (`_tools.py` L673)** — the universal catalog choke point.
   - FIX the shallow-clobber: nested dict fields (`bib`, `indexed`, `pdf`) must
     `_deep_merge`, not `e.update`, so `importedKeys`/`authenticatedAt` survive.
   - Add keyword-only optional `guard: WorkIndex | None`, `fields_for_guard`,
     `entry_type`. When `guard` is provided and a `same`-work row exists under a
     DIFFERENT citekey, do NOT append — raise `DuplicateWorkError(existing_ck,
     verdict)`. Callers that pass no guard are unaffected.

2. **`triage_apply.py::apply_bib_row` (~L275)** — `.bib` fan-out. Before minting a
   bib-only row, call `find_work_in_library(incoming_fields, type, library)`. On
   `same` → skip the new row, record an alias `new_ck → existing_ck`, note it in
   the triage report ("folded into existing <ck>"). On `uncertain` → mint the row
   but flag `possibleDuplicateOf` in the report for later review.

3. **`triage_apply.py::apply_row` (~L462, the `_master_has_citekey` gate)** —
   PDF/DOCX intake. Same guard using the proposed row's title/year/author. On
   `same` → surface a `duplicate-work` decision (don't silently index a second
   copy of a held paper); default to flag-for-review rather than auto-skip, since
   a held PDF is higher-stakes than a bib stub.

4. **`index_paper.py` — after `authenticate()` returns, before the catalog write.**
   This is where the DOI is strongest. Compare the resolved DOI/title against the
   library. On `same`-work-under-different-citekey → append a `duplicate-work`
   inbox notification naming the existing citekey and DO NOT create a second
   holdings row; leave the extraction on disk but mark the catalog row (if any)
   `duplicateOf`. Closes the `greenberg2018content`/`greenberg2019content` class.

5. **`update_master_bib_entry.py` shim** — the shared raw master writer. Add an
   optional `--guard` flag (default on for interactive callers) that runs
   `find_work_in_library` before an *append* (not before an in-place replace of
   the same citekey). On `same` under a different citekey → refuse with a clear
   message naming the existing entry.

6. **`merge_paper_references.py::find_duplicate` (L157)** — replace the bespoke
   4-stage body with a delegation to `work_identity` (build the WorkIndex once per
   run, reuse across the paper's entries — also fixes the current per-entry
   re-read-and-rescan O(N²) cost). Behavior strictly widens (now catches year-drift
   + fuzzy that the old exact-triple stage missed). The `uncertain` tier routes to
   the existing `manual_review` bucket.

## Recurrence detector (fast, for the drain loop)

`dedup.py check --library PATH` — builds the index, reports the count of `same`
clusters currently present (target: 0 after cleanup). Cheap enough to run at the
end of `/library:index-pending` so any regression is caught immediately and
surfaced to the inbox.

## Adjacent correctness fixes (in scope — "improve the app", low risk)

- **`_bib_parse.py`**: handle escaped/inner quotes in `"`-quoted values and
  guard the column-0 `@type{key,`-inside-brace-value false split (Hazard 5).
  Add a regression test with a nasty synthetic entry. This raises the true match
  rate (fewer dropped DOIs/titles).
- **`synthesize_canonical_entries.py`**: replace the fabricated `score = 1.0`
  with a real title-similarity gate (reuse `work_identity.title_jaccard`;
  reject < 0.6) so it stops injecting wrong/duplicate works. (Flag only if risky
  — coordinate before changing acceptance behavior.)

## Tests

For each wired path, a focused test that feeds a known-duplicate and asserts the
guard fires (skip/flag/refuse as specified) and that a genuinely-new work still
admits. Run the repo's existing library-script tests if present; do not regress.
