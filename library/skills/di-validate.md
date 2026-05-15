---
description: Pgmark validation + audit punch-list + outstanding-work classification (Step 3i + Step 9.5).
arguments: <citekey>
---

# Validate & audit

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else.

```bash
# Find library_path.py — synced PWA folders have it under .virgil/scripts/,
# the Virgil source repo has it under editor/scripts/. Either is fine.
library_path_py=""
for candidate in .virgil/scripts/editor/library_path.py editor/scripts/library_path.py; do
  [ -f "$candidate" ] && { library_path_py="$candidate"; break; }
done
if [ -z "$library_path_py" ]; then
  echo "No library set up. Pick a library in Virgil first."
  exit 1
fi
library_root="$(python3 "$library_path_py" --get 2>/dev/null)" || {
  echo "No library set up. Pick a library in Virgil first."
  echo "  (Or run: python3 $library_path_py --set <abs-path>)"
  exit 1
}
cd "$library_root"
export VIRGIL_LIBRARY_ROOT="$library_root"
```

---

> Shared doctrine: read [_doctrine.md](_doctrine.md). The validator
> and audit are the truthful-signal gate for the convergence loop —
> false positives mean the agent makes bad decisions.

Operates on `papers/$ARGUMENTS/main.tex` and the catalog row. The
§9.5 audit punch-list narrative (which depends on the validator's
outputs) lives in [deep-index.md](deep-index.md) §9.5 as part of the
orchestrator's convergence-driving section.

## Step 3i — Pgmark validation (hard gate)

```bash
python3 .virgil/scripts/library/pgmark_validate.py papers/$ARGUMENTS/main.tex \
    --baseline-from-catalog --severity error
```

Auto-detects PDF page count via `pdfinfo` on the sibling
`<citekey>.pdf`. The validator emits scope violations (always
blockers) and continuity findings (only blockers when "new vs.
baseline").

**Phase 1.1 fixes applied:**

- `range-impossible` requires both `hi > pdf_pages × 1.5` AND
  `span > pdf_pages` (not either-or). Journal-offset reprints
  (pp. 19-39 in 23-page PDF, pp. 171-203 in 36-page PDF, pp.
  579-627 in 49-page PDF) correctly do NOT fire.
- Multi-section pagination (front-matter roman → body arabic →
  index arabic restart) detected via monotonic-reset; duplicate
  page labels across resets get the `multi-section` informational
  finding instead of the `duplicate` blocker.
- `range-suspiciously-wide` catches catastrophic offsets where
  `span > pdf_pages × 1.3`. (Would have caught the peacocke +170
  silent offset.)

**Flags:**

- `--no-pdf-check` — skip range checks entirely (use for
  journal-offset reprints if the AND-of-range-and-span rule somehow
  trips; in practice the AND rule handles Springer / Elsevier
  articles where the PDF starts at the article's first printed page).
- `--pdf-pages N` — explicit page count (overrides auto-detection
  from the sibling PDF).
- `--severity warn` — always exit 0 (use when invoking from a wrapper
  that needs to inspect findings without halting on blockers).
- `--json` — emit JSON instead of markdown.
- `--baseline-from-catalog` — required for the "new vs. baseline"
  continuity check (already in the canonical invocation above).

Run from the library root (`cd ~/Virgil-Library`) — the script and
paper paths above are relative to that root.

### Hard-gate semantics

Exit code 0 = clean; exit code 1 = blockers (scope violations, or
continuity breaks newly introduced by this pass). Any blocker must
be fixed before write-back. Read the markdown report it prints; for
each finding, edit the file to fix it, then re-run. The validator
is the truthful-signal gate for the convergence loop — silently
downgrading severity to `warn` is the failure mode this skill
exists to prevent.

### Scope-violation findings (always blockers)

Scope violations are always blockers regardless of baseline — they
cannot be pre-existing because the pre-deep-index file rendered
fine. Common fixes:

- `pgmark-scope: math display` — split the surrounding `\[...\]`
  into two displays with the pgmark on its own line between them
  (see §3c in the orchestrator).
- `pgmark-scope: argument of \<cmd>` — pull the pgmark out of the
  command's brace argument and place it on its own line before the
  command.
- `pgmark-scope: preamble` — move the pgmark below `\maketitle`.

**Math-display-open downgrade rule.** When the validator reports a
`math display open` violation but the open `\[` is followed by
ASCII alphanumeric continuation on the same line (e.g., `sh\[sh`),
this is almost always a PDF extraction artifact (unbalanced bracket
from a Unicode angle bracket `〈 〉` mis-extraction, or a phonetic
transcription that included `[`). A single such artifact can
produce a cascade of 7+ false-positive scope violations. Before
treating these as blockers: scan for orphan `\[` on lines where
alphanumeric characters follow within 10 columns; replace each
such `\[` with `[`; re-run the validator. The cascade should
clear.

### Continuity findings (only blockers when "new vs. baseline")

- `pgmark-gap` / `pgmark-out-of-order` (new vs. baseline) — you
  almost certainly deleted or moved a marker by accident; cross-
  reference the PDF and restore the missing one.
- `pgmark-duplicate` — same printed-page number appearing twice
  inside a single monotonic run (not across a section reset).
  Usually means a stale marker was left behind after a fix; locate
  and remove the misplaced copy.
- `content-mismatch` — pgmark whose surrounding prose doesn't match
  the page's text in the PDF; either the marker is misplaced or
  the prose was reflowed across pages. Re-anchor against the PDF.
- `range-impossible` — already covered above (Phase 1.1 fixes
  applied). Fires only when `hi > pdf_pages × 1.5` AND `span >
  pdf_pages` (AND, not either-or).

Pre-existing continuity findings (`_pre-existing_` in the report)
are not blockers — they reflect imperfect detection from the
original extraction and are fine to leave. Only `**new**` findings
gate the pass.

> **Empty-baseline case.** When the catalog row has
> `warnings == []` (typical for papers indexed before continuity-
> warning emission was added to `index_paper.py`), the validator
> has no baseline to compare against and will mark **every**
> continuity gap as "new". To handle this:
>
> 1. **Before** running the preprocessor in §1, copy
>    `papers/$ARGUMENTS/main.tex` to
>    `.virgil/baselines/$ARGUMENTS-pre-deepindex.tex` (`mkdir -p`
>    the dir if missing). This is the snapshot of pre-deep-index
>    state.
> 2. **In §3i**, if the catalog row's `warnings` is empty, run the
>    validator a **second time** against the baseline file:
>    `python3 .virgil/scripts/library/pgmark_validate.py .virgil/baselines/$ARGUMENTS-pre-deepindex.tex --baseline-from-catalog`
>    The script doesn't need a special flag for this — the file
>    path is the only required positional. The output is its own
>    gap set (call it `B`).
> 3. Re-run on the current `main.tex` to get its gap set (call
>    it `C`).
> 4. **Match gaps by `(prev_pgmark, next_pgmark)` pair**, not by
>    line number (line numbers shift during deep-index). A gap in
>    `C` is `_pre-existing_` iff a gap in `B` reports the same
>    `(prev, next)` pgmark pair. Any gap in `C` whose `(prev,
>    next)` pair has no match in `B` is genuinely **new** and
>    gates the pass.
> 5. Scope violations (`pgmark-scope: …`) are always blockers
>    regardless of baseline — they cannot be pre-existing because
>    the pre-deep-index file rendered fine.
>
> Do not silently dismiss "new" findings without this cross-check.

### Low-confidence pgmark re-verification

`\pgmark[low]{N}` is not a permanent classification. After the
preprocessing pass strips soft hyphens and normalizes prose,
content-overlap verification at a slightly relaxed threshold (30%,
was 40%) and wider window (±1500 chars, was ±800) often
successfully promotes markers that previously failed. Always
re-run `[low]` verification after any prose cleanup; this is a
free pass-2 win.

### Three-iteration abort

If three iterations fail to clear all blockers, **abort**: leave
`indexed.state` unchanged (do not write `deepIndexed`), append a
notification with `kind: "deep-index-blocked"` (see the
orchestrator's step 6 for shape, swap the kind), and stop. Do not
silently downgrade the validator severity to `warn` — that is the
failure mode this skill exists to prevent.

### Baseline acceptance via catalog warnings

When the validator flags a finding that's verifiably correct (a
heuristic limitation rather than a real defect — journal-offset
reprint, multi-section pagination, low-confidence flood on a
scanned-OCR book whose markers have all been positionally
verified), suppress future passes by adding a `…-false-positive:`
prefix to the corresponding entry in the catalog row's
`indexed.warnings`. The prefix vocabulary mirrors the finding
kind:

- `pgmark-range-impossible-false-positive: <why it's correct>`
- `pgmark-duplicate-false-positive: <why it's correct>`
- `pgmark-gap-false-positive: <why it's correct>`
- `pgmark-out-of-order-false-positive: <why it's correct>`

A concrete `<why it's correct>` is required (e.g., `span fits in
PDF page count (offset reprint)`) — these warnings are auditable.
Subsequent validator runs read the catalog warnings and treat any
finding whose kind matches an existing `…-false-positive:` entry
as pre-existing rather than new. This is how known-good cases
escape the convergence-loop gate.

## Step 9.5 — Audit punch-list (drives convergence)

```bash
python3 .virgil/scripts/library/audit_deepindex.py papers/$ARGUMENTS
```

Reports remaining issues across:

- Invisible characters / ligatures.
- Hyphenation artifacts (coordinated-compound exclusion applied —
  `pre- and post-test` no longer flagged).
- Case errors (math-identifier prefix filter applied — `posM` no
  longer flagged).
- Title-metadata cross-check.
- References.bib quality (trailing artifacts, single-hyphen pages,
  empty fields, triple-hyphen).
- Pgmark continuity (low-confidence count, validator-finding count).
- **Footnote inline-rate** (Phase 1.2 fixes applied):
  - Skips Contents/TOC blocks, numbered TOC-shaped entries.
  - Skips enumeration sequences (3+ consecutive numbers within 30
    lines).
  - Skips figure-context candidates.
  - Skip entire check if document has zero `\footnote{}` commands.
- Citation completeness (`\cite{}` keys missing from
  references.bib).
- **Unbalanced-brace detection** (new): runaway `\footnote{` /
  `\section{` / `\textbf{` arguments spanning >3 paragraphs or
  crossing a `\section{}` boundary.
- **Missing-pgmark-range** (new): max pgmark < 80% of PDF page count.

## Outstanding-work classification

Walk the [_doctrine.md](_doctrine.md) self-check checklist before
tagging anything. The four allowed categories:

- `source-missing` — page literally absent from PDF.
- `figure-reconstruction` — raster-only figure content.
- `user-judgment-required` — narrow; see doctrine for the cases
  where this IS the right tag.
- `validator-false-positive` — the validator's heuristic flagged
  something that's verifiably correct (journal-offset reprint with
  span fitting in PDF page count, multi-section pagination with
  legitimate page-label namespaces, low-confidence-flood on a
  scanned-OCR book where every marker has been positionally
  verified). Distinct from `user-judgment-required` because there's
  no decision for the user to make — the file is already correct.
  When tagging an item as `[validator-false-positive]` in the
  Outstanding-work list, also add the matching
  `…-false-positive:` warning to the catalog row (see "Baseline
  acceptance via catalog warnings" above), so future passes don't
  re-flag it.

Items tagged for follow-up passes should be `[in-progress]`, not
`[user-judgment-required]`, and should be carried forward by the
convergence loop — not surfaced as questions.
