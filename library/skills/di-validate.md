---
description: |
  Validate the pagination anchors and audit outstanding work on an
  already-deep-indexed library paper. Triggers on: "validate
  <citekey>", "audit the deep-index for X", "check if <citekey> needs
  more cleanup", "run the validator on this paper". Produces a
  punch-list of any remaining issues and classifies outstanding work
  by category. Subskill of /library/deep-index; invoke directly when you just
  want a status check. Does NOT trigger for running the structural
  cleanup itself (use /library/deep-index).
arguments: <citekey>
---

# Validate & audit

> **Allowable-LaTeX doctrine.** This skill mostly READS, but its punch-list
> loop directs you to edit `main.tex` to clear each finding. Every such fix
> must leave behind only vocabulary Virgil renders meaningfully — read
> [_latex-output.md](_latex-output.md) — the **library appendix** (document
> structure, expex numbered examples, `\pgmark{N}`, the font-strip rule, the
> minimal preamble) — which links the cross-silo SSOT
> [_latex-allowlist.md](_latex-allowlist.md) for the inline vocabulary (marks,
> math, footnotes, the `\cite…` family, and the tie `~` vs.
> `\textasciitilde{}` rule). Anything outside those two renders as raw grey
> monospace in Virgil. Never re-paraphrase either doctrine here — link to it.

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

Run from the **resolved** library root — the `cd "$library_root"` the
Bootstrap above already performed (also exported as
`$VIRGIL_LIBRARY_ROOT`). The script and paper paths above are relative to
that root. The default location is `~/Virgil-Library/`, but the library is
a user-picked folder and may live anywhere — never hardcode the default.

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
orchestrator's step 6 for shape, swap the kind), and signal the
orchestrator to emit `DEEP_INDEX_STALLED` (see `_doctrine.md` §0).
Do not silently downgrade the validator severity to `warn` — that
is the failure mode this skill exists to prevent.

### Baseline acceptance via catalog warnings

When the validator flags a finding that's verifiably correct (a
heuristic limitation rather than a real defect — journal-offset
reprint, multi-section pagination, low-confidence flood on a
scanned-OCR book whose markers have all been positionally
verified), suppress future passes by adding a `…-false-positive:`
prefix to the corresponding entry in the catalog row's
`indexed.warnings`. The prefix vocabulary mirrors the finding
kind — **all seven** validator continuity kinds are consumable, so
this table is the whole vocabulary, not a selection from it
(`python3 .virgil/scripts/library/suppression_vocabulary.py --json`
prints it, and CI pins this table against that output):

| Validator kind | Suppression prefix | When to use |
|---|---|---|
| `pgmark-range-impossible` | `pgmark-range-impossible-false-positive:` | Journal-offset reprint — the max pgmark exceeds 1.5× the PDF page count because the printed numbering starts partway through a volume. State the span and the PDF page count in the why. |
| `pgmark-range-suspiciously-wide` | `pgmark-range-suspiciously-wide-false-positive:` | Same offset shape one threshold down (span > 1.3× PDF pages) on a paper whose markers are all positionally verified. Confirm it is an offset and not the silent +N extractor bug this kind exists to catch. |
| `pgmark-duplicate` | `pgmark-duplicate-false-positive:` | The same printed page number legitimately appears twice *within one section namespace* — e.g. a plate or fold-out repeating the folio. (Across namespaces the validator already reports the benign `pgmark-multi-section` instead.) |
| `pgmark-multi-section` | `pgmark-multi-section-false-positive:` | Multi-section pagination — front matter / body / index each restart at 1, so a page number appears in more than one namespace. Informational by design; suppress once you have confirmed the restarts are real. |
| `pgmark-gap` | `pgmark-gap-false-positive:` | A skipped run of printed pages the source genuinely omits (an advert leaf, a plate section the extraction correctly drops, an offset reprint). |
| `pgmark-out-of-order` | `pgmark-out-of-order-false-positive:` | A descending transition that is correct as printed — a bound-in errata or appendix carrying its own numbering, or a mis-bound original. |
| `pgmark-low-confidence-flood` | `pgmark-low-confidence-flood-false-positive:` | Scanned-OCR book where >30% of markers carry `[low]` confidence but every one has been positionally verified (run `recover_low_confidence_pgmarks.py --cascade` first). Note the AUDIT's sibling category is `pgmark-low-confidence` — two different findings, two different spellings, both consumable. |

A finding a **fusion** discovered is written on the row under
`pgmark-fusion-<kind>:` — but suppress it under the BARE
`pgmark-<kind>:` spelling above. The fact being recorded ("this gap
is a journal offset") is a fact about the paper, not about which
pass found it, and the validator's baseline reader strips only
`pgmark-`, so a `pgmark-fusion-…-false-positive:` line resolves to a
kind no finding can carry. Since task 413 the writer refuses that
spelling and names the bare one.

A concrete `<why it's correct>` is required (e.g., `span fits in
PDF page count (offset reprint)`) — these warnings are auditable.
Subsequent validator runs read the catalog warnings and treat any
finding whose kind matches an existing `…-false-positive:` entry
as pre-existing rather than new. This is how known-good cases
escape the convergence-loop gate.

**Always write suppressions atomically via the helper script.** Do
NOT hand-Edit `catalog.json` to add the warning — go through:

```bash
python3 .virgil/scripts/library/add_validator_suppression.py \
    $ARGUMENTS <kind> "<concrete why-it's-correct>"
```

This acquires `lock_catalog`, dedupes against existing suppressions,
and bumps `catalog-version.txt`. The schwarzlose2021brainscapes /
shimojima2015semantic memos documented passes that classified a
finding as false-positive but skipped the catalog write — the next
pass re-flagged the item and the convergence loop misread it as
new work. The helper script makes the coupling enforceable.

### Audit-side suppression prefixes

The audit script (`audit_deepindex.py`) carries its own catalog-
suppression vocabulary, symmetric with the validator's. Each
`…-false-positive:` entry in `indexed.warnings` suppresses the
matching audit finding kind. Run the audit with
`--exit-on-suppressed` so the convergence loop sees exit 0 when
only suppressed items remain (shimojima2015semantic memo: without
this, the loop can't tell "work remaining" from "work suppressed").

The category must be spelled **exactly** as the audit emits it —
`audit_deepindex._catalog_suppression_categories` matches verbatim,
so a near-miss stores fine and silences nothing. Three spellings in
an earlier version of this table were near-misses
(`hyphenation-artifact`, `title-thanks`, and
`pgmark-low-confidence-flood` filed as an *audit* kind); since task
413 `add_validator_suppression.py` REFUSES a category no reader can
match and names the one to use instead, so a typo is a message
rather than a silent no-op. `python3 .virgil/scripts/library/suppression_vocabulary.py`
lists every consumable category; `--json` splits it by reader, which
is what CI pins this table and the validator table above against.

**One declared exclusion.** `error` is a consumable audit category and
is deliberately absent from the table below: it is not a finding about
the paper at all but about the audit's own inputs (`main.tex not
found`). Suppressing it hides a broken pass rather than a heuristic's
false positive, so fix the input instead. Everything else the audit can
emit has a row here.

| Audit kind | Suppression prefix | When to use |
|---|---|---|
| `case-errors` | `case-errors-false-positive:` | Brand-name CamelCase (covered by allowlist, but for edge cases not yet in the list) |
| `hyphenation-artifacts` | `hyphenation-artifacts-false-positive:` | Coordinated compounds the negative-lookahead missed |
| `footnote-inline-rate` | `footnote-inline-rate-false-positive:` | Philosophy premise enumerations (`1. a. ... b. ...`), TOC scope, submission-date lines |
| `pgmark-low-confidence` | `pgmark-low-confidence-false-positive:` | Scanned-OCR book where every marker is positionally verified (use `recover_low_confidence_pgmarks.py --cascade` first). Note the VALIDATOR's sibling kind is `pgmark-low-confidence-flood` — two different findings, two different spellings, both consumable |
| `title-metadata` | `title-metadata-false-positive:` | Title cross-check the metadata comparison gets wrong — e.g. a legitimate `\\thanks{}` the brace-balanced parser already handles |
| `invisibles` | `invisibles-false-positive:` | Invisible/ligature glyphs that are genuinely part of the source |
| `references.bib-quality` | `references.bib-quality-false-positive:` | Bib-shape findings on an entry that is correct as printed |
| `citation-completeness` | `citation-completeness-false-positive:` | `\\cite{}` keys resolved outside `references.bib` |
| `unbalanced-brace` | `unbalanced-brace-false-positive:` | A long but genuinely balanced argument the runaway heuristic flags |
| `missing-pgmark-range` | `missing-pgmark-range-false-positive:` | Front/back matter the PDF carries and the extraction correctly omits |

### Known false-positive patterns (do not chase with new validator carveouts)

Each of these recurs across the corpus; the resolution is a catalog
suppression entry, not a script change:

- **Brand-name CamelCase** (`arXiv`, `bioRxiv`, `ImageNet`, `ChatGPT`,
  `ResNet`, …) — `audit_deepindex.py` BRAND_NAME_ALLOWLIST handles
  the common cases; for edge cases use `case-errors-false-positive:`.
- **Philosophy premise enumerations** — `1. <text>` ... `2. <text>`
  blocks of inline premises. Looks like leaked footnotes but isn't.
- **Formal-semantics variables** — single-letter variables (`P`, `Q`,
  `M`) inside math-mode regions; the math-strip already handles
  most. For unbracketed inline forms use the audit suppression.
- **European-particle surnames** — `van der Berg`, `de Vries`,
  `Graf Fara`. Already handled in citation normalization; if an
  audit finding still fires, suppress.
- **TOC-scope footnote-inline candidates** — handled by the
  back-matter-detection guard; for unusual TOC layouts use the
  audit suppression.

## Step 9.5 — Audit punch-list (drives convergence)

```bash
python3 .virgil/scripts/library/audit_deepindex.py papers/$ARGUMENTS --exit-on-suppressed
```

**This block is the SSOT for the invocation** — `deep-index.md` §9.5
runs the punch-list every pass and deliberately spells no command of its
own, because when it did the two copies drifted and the copy that ran
every pass was the one missing the flag (task 446). Keep the flag here;
`library/lib/__tests__/skill-script-cli-guardrail.test.ts` pins both that
requirement and the one-runnable-spelling rule.

The `--exit-on-suppressed` flag returns 0 when every remaining
finding sits in a category the catalog explicitly marked
`*-false-positive:`. The convergence loop relies on this to
distinguish "work remaining" from "work the prior pass declared a
false positive" (shimojima2015semantic memo).

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
tagging anything. The three allowed categories (§0 / §Scope doctrine):

- `source-missing` — page literally absent from PDF.
- `figure-reconstruction` — raster-only figure content.
- `validator-false-positive` — the validator's heuristic flagged
  something that's verifiably correct (journal-offset reprint with
  span fitting in PDF page count, multi-section pagination with
  legitimate page-label namespaces, low-confidence-flood on a
  scanned-OCR book where every marker has been positionally
  verified). The file is already correct; the validator is the
  thing that's mis-classifying. When tagging an item as
  `[validator-false-positive]` in the Outstanding-work list, also
  add the matching `…-false-positive:` warning to the catalog row
  (see "Baseline acceptance via catalog warnings" above), so future
  passes don't re-flag it.

`user-judgment-required` is **not** a valid category — see
`_doctrine.md` §0. Items the agent expects to address in a
follow-up pass go as `[in-progress]` and are carried forward by
the convergence loop, never surfaced to the user as questions.
