---
description: Pgmark validation + audit punch-list + outstanding-work classification (Step 3i + Step 9.5).
arguments: <citekey>
---

# Validate & audit

> Shared doctrine: read [_doctrine.md](_doctrine.md). The validator
> and audit are the truthful-signal gate for the convergence loop —
> false positives mean the agent makes bad decisions.

Operates on `papers/$ARGUMENTS/main.tex` and the catalog row. The
canonical narrative is [deep-index.md](deep-index.md) §3i and §9.5.

## Step 3i — Pgmark validation (hard gate)

```bash
python3 .virgil/scripts/pgmark_validate.py papers/$ARGUMENTS/main.tex \
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

## Step 9.5 — Audit punch-list (drives convergence)

```bash
python3 .virgil/scripts/audit_deepindex.py papers/$ARGUMENTS
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
- `validator-false-positive` — validator's heuristic flagged
  something verifiably correct.

Items tagged for follow-up passes should be `[in-progress]`, not
`[user-judgment-required]`, and should be carried forward by the
convergence loop — not surfaced as questions.
