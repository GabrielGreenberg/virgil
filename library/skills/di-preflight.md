---
description: Deep-index preflight (Step 0/0.5) — metadata mismatch detection, lending-slip / JSTOR / multi-article / OCR-recovery dispatch, genre routing.
arguments: <citekey>
---

# Deep-index preflight

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
`author-only-missing`, `both-missing`), append an outstanding-work
item to the catalog entry's `warnings` array via
`update_catalog_entry.py` with a patch like
`{"warnings": ["metadata-mismatch: <kind>"]}`. The doctrine §"Self-check"
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

`detect_genre.py` prints one of five primary labels to stdout:
`article`, `endnote-style`, `multi-article-pdf`, `scanned-ocr`,
`book`. Record the result and propagate it to downstream subskills via
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

**Secondary signals (NOT emitted by detect_genre.py — derive from
catalog/bib/file inspection):**

- **dissertation** — detect via `master.bib` entry type
  `@phdthesis` / `@mastersthesis`. Step 0.2 metadata check
  mandatory; `promote_lost_subsections` in di-clean-prose;
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

## What runs next

`/library/deep-index` (orchestrator) invokes in order:

1. `/library/di-clean-prose` — title, headers, heading hierarchy,
   drop caps, pgmark alignment.
2. `/library/recover-footnotes` — full tier ladder.
3. `/library/clean-bibliography` — References itemization,
   references.bib emission, citation rewriting.
4. `/library/di-examples` — numbered examples / expex conversion,
   formal-semantics math.
5. `/library/di-validate` — pgmark validator + audit punch-list +
   outstanding-work classification.
