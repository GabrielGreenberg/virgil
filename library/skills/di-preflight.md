---
description: |
  Run preflight checks before deep-indexing a library paper — detect
  metadata mismatches, strip lending-slip / JSTOR boilerplate, identify
  multi-article scans, dispatch OCR recovery, and route by genre.
  Triggers on: "preflight <citekey>", "check the metadata for X before
  deep-index", "run the deep-index preflight on this paper". Subskill
  of /deep-index. Does NOT trigger for the full structural cleanup
  pass (use /deep-index).
arguments: <citekey>
---

# Deep-index preflight

> **Allowable-LaTeX doctrine.** Every `.tex` edit this skill makes — the
> auto-applied `\title{...}` patch, a hand-corrected heading, a boilerplate
> strip — must leave behind only vocabulary Virgil renders meaningfully — read
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

Runs the gates that decide whether `/library/deep-index` can proceed
on `papers/$ARGUMENTS/`, and which genre branches downstream subskills
should follow.

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope,
> anti-patterns, self-check, convergence behavior, narrow
> out-of-scope categories).

## Arguments

`$ARGUMENTS` is the citekey to preflight.

## Verdict (emit exactly one, on its own line)

The orchestrator reads this, so it is greppable and terminal:

- `PREFLIGHT_OK` — the gates ran; the pass may continue. Print the
  Step 0.5 genre label on the line above it as `genre: <label>`.
- `PREFLIGHT_BLOCKED` — a gate below says there is nothing here to
  deep-index. Print the reason and the exact recovery command above the
  keyword. Today Step 0.0 is the only producer.

A non-`none` metadata mismatch, an unrecognized genre, a Caesar step
skipped for want of its conditions — none of those block. They are flags,
and every one of them is `PREFLIGHT_OK` with a catalog warning.

## Step 0.0 — Body-populated / OCR-recovery gate

Runs first, because every gate after it reads `main.tex`.

Count the non-comment bytes of `main.tex`'s body (between `\maketitle`
and `\end{document}`). **100 or more → this gate is done; go to 0.1.**

Fewer than 100 is an `/index-paper` failure, not something a deep pass
can clean up. **Determine why before reporting it** — "scanned PDF" is a
guess, and the causes take different repairs:

```bash
python3 .virgil/scripts/library/recover_ocr_pipeline.py $ARGUMENTS --check-only
```

`--check-only` is read-only: it samples the first three pages for text
density and prints either "PDF already has text layer; no OCR needed." or
"PDF needs OCR." Nothing is installed, converted, or overwritten.

- **Needs OCR** — the source has no text layer. Block with:
  `extraction-empty-body — body has <N> bytes; PDF has no text layer.
  Recover with: python3 .virgil/scripts/library/recover_ocr_pipeline.py
  $ARGUMENTS && /library/index-paper $ARGUMENTS`
- **Has a text layer** — extraction failed on a PDF that *does* carry
  text, so OCR is the wrong repair. Block with:
  `extraction-empty-body — body has <N> bytes; source has a text layer,
  so this is an extraction failure. Re-run /library/index-paper
  $ARGUMENTS.`
- **`error: PDF not found`** — the paper's source is a DOCX (or the PDF
  is missing), so the OCR question doesn't arise at all. Same block as
  the text-layer case: it is an extraction failure, and the exit code is
  the script telling you which question it *can't* answer, not a failure
  of this gate.

Then emit `PREFLIGHT_BLOCKED` and stop. Do not run 0.1–0.6 — they all
operate on a body that isn't there.

**Never pass `--force-install`.** `ocrmypdf` + `tesseract` are *required*
deps installed eagerly by `/library/setup` (library/AGENTS.md §"Required
deps"), so a missing binary is a setup problem to surface, not a ~200 MB
install to trigger from inside a pass. Left alone, the recovery script
refuses with the manual install line — which is the behavior we want.

**Recovery is the operator's step, not this pass's.** Even the non-
`--check-only` invocation only re-OCRs the PDF and archives the original;
re-extraction is `/library/index-paper`, and deep-index's §"What this
command does NOT do" states plainly that rebuilding `main.tex` from the
PDF is an `/index-paper` job surfaced at preflight. So this gate
*determines and routes*; it does not repair.

## Step 0.1 — Lending-slip / JSTOR boilerplate strip (one-time)

```bash
python3 .virgil/scripts/library/detect_lending_slip.py $ARGUMENTS --strip-from-tex
python3 .virgil/scripts/library/strip_jstor_boilerplate.py papers/$ARGUMENTS/main.tex
```

Removes ILLIAD / OCLC / interlibrary-loan front matter and JSTOR
cover-page boilerplate so downstream cover-page metadata reads land
on the article's real first page.

## Step 0.2 — Content / metadata mismatch detection

```bash
python3 .virgil/scripts/library/detect_metadata_mismatch.py $ARGUMENTS --json
```

Note: `detect_metadata_mismatch.py` matches against the **PDF cover
page text** (extracted via `pdftotext`), not against the
`\title{...}` in `main.tex`. So `both-missing` can fire even when
the tex already has the correct title — it just means the cover
page's first non-trivial line didn't match. Treat the result as a
flag, not as proof of tex/bib disagreement.

Outputs a `kind` in {`none`, `title-only-missing`,
`author-only-missing`, `both-missing`,
`file-is-book-bib-is-chapter`}. For `file-is-book-bib-is-chapter`:

```bash
# Always dry-run first — the candidate-title extraction can grab
# blurb attributions, ISBN footers, or other noisy cover-page lines.
python3 .virgil/scripts/library/apply_metadata_mismatch_policy.py $ARGUMENTS --dry-run
# Eyeball the "Would set fields: {...}" output. If the candidate
# title looks like a real book title (not a person's name, not an
# ISBN, not "A Classic Series"), commit:
python3 .virgil/scripts/library/apply_metadata_mismatch_policy.py $ARGUMENTS
```

If the on-disk bib entry already has `@book` AND the bib title
already matches the file's actual title (check `master.bib` and
`main.tex`'s `\title{...}` directly), skip the apply step. The
chapter→book promotion has already happened; rerunning the policy
risks overwriting a correct title with a noisy cover-page string.

Applies the four-condition auto-resolution policy (see
[_doctrine.md](_doctrine.md)) — updates `master.bib` to `@book`,
updates the catalog, sets `bib.state = needs-reauth`, updates the
in-file `\title{...}`.

For other non-`none` kinds (`title-only-missing`,
`author-only-missing`, `both-missing`), record an outstanding-work item
on the catalog entry via `update_catalog_entry.py`. The array lives at
`indexed.warnings` — **not** at the entry top level; every reader
(`suppression_categories_from_catalog`, `pgmark_validate.py`,
`synthesize_canonical_entries.py`, the frontend row) looks only there, so
a top-level `warnings` key is invisible to all of them. And a bare
`"warnings": [...]` patch REPLACES the row's array, deleting every other
kind on it, so declare the kind you recomputed and let the shim merge:

```bash
cat > /tmp/$ARGUMENTS-mismatch-warning.json <<'EOF'
{ "indexed": { "warnings": ["metadata-mismatch: <kind>"] } }
EOF
python3 .virgil/scripts/library/update_catalog_entry.py "$ARGUMENTS" \
  --patch-file /tmp/$ARGUMENTS-mismatch-warning.json \
  --recompute-warning-kind metadata-mismatch
rm /tmp/$ARGUMENTS-mismatch-warning.json
```

`metadata-mismatch` is recomputed per preflight pass: pass an empty
array (with the kind still declared) when this pass finds no mismatch,
so a resolved one stops being flagged. The doctrine §"Self-check"
favors *applying* the auto-resolution policy when the file content
clearly matches the citekey's named work (e.g., a dissertation whose
`\title{...}` is blank but whose body matches the bib title); reach
for the warning channel only when the auto-resolution policy's
four-condition gate doesn't hold. Do not stop the preflight on this
case — it is a flag, not a halt.

## Step 0.3 — Multi-article detection

```bash
python3 .virgil/scripts/library/detect_multi_article.py papers/$ARGUMENTS
```

Identifies adjacent-article spans for surgical removal (see
`/library/di-clean-prose` Step 3a for the removal procedure).

## Step 0.4 — Caesar-shift / running-header cleanup

**Order: run Step 0.5 (genre detection) first**, then come back here
gated on the result. Re-ordering the file would be confusing for
readers tracing 0.1 → 0.5 in line; the gate is enforced by the
following conditionals.

`decode_caesar_pdf.py` is destructive on dot-leader-heavy TOCs and any
text with high punctuation/special-character density: it can blank
`\title{...}` and `\section{...}` arguments and garble TOC entries. It
is intended for JSTOR / custom-CMap PDFs only. **Run only when at least
one of the following is true:**

1. `detect_genre.py` (Step 0.5) returned `scanned-ocr`; OR
2. `pdffonts papers/$ARGUMENTS/$ARGUMENTS.pdf` shows custom Type-3 fonts
   (a strong CMap-shift signal); OR
3. A spot read of `papers/$ARGUMENTS/main.tex` shows characters in
   `~}|{` etc. predominating where lowercase letters should appear.

If none of those hold, SKIP the Caesar step. When unsure, invoke with
`--dry-run` first, eyeball the reported shifts and paragraph count,
and only commit if the decoded preview reads as English prose.

```bash
# Only if Caesar conditions above hold:
python3 .virgil/scripts/library/decode_caesar_pdf.py papers/$ARGUMENTS/main.tex --dry-run
# review output, then re-run without --dry-run to commit
python3 .virgil/scripts/library/decode_caesar_pdf.py papers/$ARGUMENTS/main.tex
```

For running-header cleanup, `strip_ocr_running_headers.py` is **not
safe-by-default** when its phrase sources include strings that
also appear inside `\title{...}` / `\section{...}` / `\chapter{...}`
arguments. The script will blank those LaTeX command arguments
because it case-insensitively matches the running-header phrase
anywhere in the file, including inside braces.

**Rules:**

- Default invocation is `--from-toc` ONLY. Skip this script when no
  TOC is present in the body — passing `--from-toc` with no TOC
  errors out with "No phrases provided," so probe first:
  `grep -c '\\tableofcontents\|^\\section\*\?{Contents}' papers/$ARGUMENTS/main.tex`.
- **Skip `strip_ocr_running_headers` entirely when entry type is
  `@book` or `@inbook` AND a body-level TOC is present.** Books'
  TOC entries contain chapter-title strings that the script's
  substring matcher will then blank inside other TOC `\item` lines
  (e.g., chapter "Transparency" → 132 substring matches inside
  "Transparency 51; Putting Transparency to Work 61" → all blanked).
  Defer header cleanup to di-clean-prose, which has a TOC-aware
  handler.
- DO NOT pass `--from-master-bib`. It is unsafe across ALL entry
  types because the bib's title field almost always matches the
  paper's `\title{...}` verbatim, which is exactly what the script
  will then blank. (This held for `@book`, `@phdthesis`, and
  `@article` cases in run-2 / run-3 of the 2026-05-14 iteration.)
- Always do the backup-and-verify pattern. If any heading argument
  was blanked, restore and defer header cleanup to di-clean-prose:

```bash
TOC_PRESENT=$(grep -c '\\tableofcontents\|^\\section\*\?{Contents}' papers/$ARGUMENTS/main.tex || echo 0)
BIB_TYPE=$(python3 -c "
import re, sys
with open('master.bib') as f:
    src = f.read()
m = re.search(r'@(\w+)\{$ARGUMENTS\b', src)
print(m.group(1).lower() if m else 'unknown')
")
if [ "$TOC_PRESENT" -gt 0 ] && [ "$BIB_TYPE" != "book" ] && [ "$BIB_TYPE" != "inbook" ]; then
  cp papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/main.tex.bak
  python3 .virgil/scripts/library/strip_ocr_running_headers.py papers/$ARGUMENTS/main.tex \
      --from-toc
  if diff papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/main.tex.bak \
        | grep -E '\\(title|section|chapter)\{ *\}'; then
    echo "FAIL: heading args blanked — restoring; deferring to di-clean-prose"
    cp papers/$ARGUMENTS/main.tex.bak papers/$ARGUMENTS/main.tex
  fi
  rm papers/$ARGUMENTS/main.tex.bak
else
  echo "Skipping strip_ocr_running_headers (no TOC, or @book/@inbook) — defer to di-clean-prose"
fi
```

## Step 0.5 — Genre routing

```bash
python3 .virgil/scripts/library/detect_genre.py papers/$ARGUMENTS
```

`detect_genre.py` prints one of six primary labels to stdout:
`article`, `article-vancouver`, `endnote-style`, `multi-article-pdf`,
`scanned-ocr`, `book`. Record the result and propagate it to downstream subskills via
the catalog entry's `warnings` (e.g. `"genre: scanned-ocr"`) or via
an in-memory pass-through if you are inside the
`/library/deep-index` orchestrator.

**Primary-label downstream actions (what each label means in practice):**

- **`scanned-ocr`** — Caesar/CMap-shift cleanup is allowed in
  Step 0.4. Downstream: `strip_ocr_headings`, `fix_italic_numerals`,
  `fix_roman_pgmarks`, `recover_low_confidence_pgmarks` in
  di-clean-prose; expect Tier 4 prevalence in recover-footnotes.
- **`endnote-style`** — Tier 0.5 in recover-footnotes
  (`reattach_page_hint_endnotes` / `reattach_unified_chapter_notes` /
  `reattach_document_end_notes` per the sub-pattern detected).
- **`multi-article-pdf`** — Step 0.3 result is authoritative. If
  Step 0.3 surfaced spans, trigger surgical adjacent-article removal
  (see `/library/di-clean-prose` Step 3a). If Step 0.3 returned 0 spans, IGNORE the
  `multi-article-pdf` label here and treat the paper as `article` —
  `detect_genre.py` and `detect_multi_article.py` use different
  heuristics, and the `detect_multi_article` zero-spans signal is
  the safer interpretation (adjacent-article removal is destructive).
- **`book`** — broad bucket for monographs. Inspect the catalog row
  + master.bib type to pick a finer sub-bucket: if `@book` with
  endnotes, treat as `endnote-style`; if `@phdthesis`, treat as
  dissertation (see below); otherwise proceed with default
  di-clean-prose / recover-footnotes flow.
- **`article`** — default journal-article flow. If the PDF page
  range and the bib `pages` field disagree (article starts at
  pp. 19–39 inside a 23-page PDF), set `--journal-cumulative` on
  `pgmark_validate` in di-validate.
- **`article-vancouver`** — an article whose in-text citations are
  numeric/bracketed (`[12]`) rather than author-year. Same flow as
  `article`, plus `rewrite_citations --style=bracket-numeric` in
  di-clean-prose to resolve the bracket numbers against the itemized
  reference list.

**Secondary signals (NOT emitted by detect_genre.py — derive from
catalog/bib/file inspection):**

- **dissertation** — detect via `master.bib` entry type
  `@phdthesis` / `@mastersthesis`. Step 0.2 metadata check
  mandatory; lost-subsection promotion in di-clean-prose
  (manual heading edit — no script yet);
  `rewrite_citations --style=bracket-numeric` if applicable.
- **formal-semantics-paper** — detect via lambda / brackets in
  body text + linguistics/philosophy keywords in the title.
  `mathify_formal_semantics` pre-pass in di-examples; skip
  `bulk_convert_numbered_examples` (heavy cross-reference density).
- **diagram-heavy-book** — detect via high heading-to-page ratio +
  Venn/diagram-caption strings in heading slots. `detect_garbage_headings`
  then `strip_ocr_headings`; expect 4-6× heading-count reduction.
- **annual-reviews-paper** — detect via Annual Reviews publisher
  in `master.bib` or post-article TOC pattern. `detect_journal_toc --strip`,
  `consolidate_margin_glossary` (Phase 2.4 deferred).

If `detect_genre.py` returns a label not in the primary list (script
evolution), pass it through as-is and log it as an unrecognized
genre in the catalog warnings — do not abort.

## Step 0.6 — Pgmark coverage check

Compare the actual pgmark count in `main.tex` against the catalog's
recorded `indexed.pgmarkCount`. Drift here usually means a prior
pass added or removed markers without updating the catalog; the
audit needs to see the new total.

```bash
python3 .virgil/scripts/library/verify_pgmark_coverage.py $ARGUMENTS \
    --update-catalog
```

When the in-file count diverges from the catalog count, the script
writes the in-file count back (under `lock_catalog`) and prints a
`pgmark-coverage:` line. This runs before the main subskill chain
so downstream audits see a current count.

## Step 0.7 — Report

Print a one-line summary of what 0.0–0.6 did (stripped / flagged /
skipped), then the two lines the caller reads:

```
genre: <label from Step 0.5>
PREFLIGHT_OK
```

## Where this sits in the pipeline

`/library/deep-index` dispatches **this skill** as its Step 0 — after the
resume/fresh preflight, before Step 1's deterministic preprocessing — and
then continues, in order:

1. `/library/di-clean-prose` — title, headers, heading hierarchy,
   drop caps, pgmark alignment.
2. `/library/recover-footnotes` — full tier ladder.
3. `/library/clean-bibliography` — References itemization,
   references.bib emission, citation rewriting.
4. `/library/di-examples` — numbered examples / expex conversion,
   formal-semantics math.
5. `/library/di-validate` — pgmark validator + audit punch-list +
   outstanding-work classification.

Invoked standalone, this skill is self-contained: run it before a
deep-index pass on a source you suspect of cover-page boilerplate or a
metadata mismatch, and the orchestrator's own Step 0 will then be a
no-op (every 0.x detection fires only when its target is present).
