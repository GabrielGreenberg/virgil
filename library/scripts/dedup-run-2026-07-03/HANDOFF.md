# Library de-duplication — run 2026-07-03 (handoff)

## What was done to the LIVE library

A full work-identity de-duplication was applied to
`~/Library/CloudStorage/Dropbox/Virgil-Library`:

| | before | after |
|---|---|---|
| master.bib entries | 27,014 | **24,028** |
| catalog rows | 4,290 | 3,721 |

- **2,986 redundant master.bib entries removed** (field-unioned into the survivor).
- **569 duplicate catalog rows removed.**
- **97 duplicate paper folders archived** (moved to `.virgil/_dedup-archive/`,
  never deleted; see `manifest.jsonl`). 0 cases archived a more-indexed copy
  than the survivor.
- **2,991 aliases** recorded in `.virgil/aliases.json` (every collapsed citekey
  still resolves to its survivor).
- `.virgil/dedup-distinct.json` — 303 adjudicated-distinct pairs (editions,
  Part I/II companions, book-vs-review) so they are never re-flagged/merged.

## How it was decided (provenance in this folder)

- `plan.json` — raw scan (rule-based clustering).
- `verdicts/` — every LLM verdict: all 1,809 auto clusters, 487 conflict
  clusters, 449 uncertain pairs, and an adversarial re-verification of all 85
  folder-archiving clusters.
- `final_plan.json` — the applied plan after adjudication + overlap-safe
  union-find + verify filter.
- `folder_archive_review.md`, `rename_suggestions.md`, `report.md`.

## Backups (off-Dropbox, for reversal)

- `~/Library/Application Support/Virgil/backups/dedup-20260703-1/` —
  `master.bib.bak` + `catalog.json.bak` (pre-main-apply).
- `~/Library/Application Support/Virgil/backups/dedup-20260703-2-supplemental/`
  — pre-supplemental-apply.

### To reverse
1. Restore `master.bib` + `catalog.json` from `dedup-20260703-1/`.
2. Move every folder in `.virgil/_dedup-archive/` back to `papers/`.
3. Delete `.virgil/aliases.json` and `.virgil/dedup-distinct.json`.
(All 97 archived folders are intact on disk — nothing was deleted.)

## Hardening — NOT yet active on the live pipeline

The intake guard that prevents new duplicates is committed on branch
**`dedup-work-identity`** in `/Users/gabriel/Programming/virgil` but is NOT
deployed to the live library (the live `.virgil/scripts/library/` is
Virgil-managed / synced from the repo build). To activate it durably:

```bash
cd /Users/gabriel/Programming/virgil
git checkout main && git merge dedup-work-identity   # review first
npm run build:library-bundle                          # regenerate the bundle
# then let the Virgil app sync the bundle to the library (its normal deploy)
```

New/changed runtime files: `work_identity.py`, `dedup_index.py`, `dedup.py`
(new); `_tools.py`, `_bib_parse.py`, `triage_apply.py`, `index_paper.py`,
`update_master_bib_entry.py`, `merge_paper_references.py` (hardened). Tests:
`test_work_identity` (in scratchpad), `test_parser_hardening`, `test_dedup_cli`,
`test_wiring` — all green.

## Ongoing use

- `python3 dedup.py check --library <lib>` — recurrence detector (0 = clean).
  Add to the drain loop to catch new dups immediately.
- `python3 dedup.py scan|apply|verify` — re-run the cleanup pipeline anytime.
