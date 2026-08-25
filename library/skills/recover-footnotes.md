---
description: |
  Recover orphan footnotes in an indexed library paper — re-attach
  footnotes to their callouts, handle endnote-style sources, and fix
  truncated/leaked footnote text. Triggers on: "recover footnotes for
  <citekey>", "fix the footnotes in this paper", "reattach the
  endnotes for X", "Virgil, the footnotes in <citekey> are broken".
  Walks the full Tier 0 → Tier 4 ladder including endnote-style
  sub-tiers. Subskill of /deep-index; invoke directly when only
  footnote recovery is needed. Does NOT trigger for prose cleanup
  (use /di-clean-prose) or bibliography work (use /clean-bibliography).
arguments: <citekey>
---

# Footnote recovery

> **Allowable-LaTeX doctrine.** Every `\footnote{…}` this skill re-wraps or
> repairs must stick to the vocabulary Virgil renders meaningfully — read
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

> Shared doctrine: read [_doctrine.md](_doctrine.md). Tier 4
> (orphan-prefix attachment) always succeeds where a preceding body
> paragraph exists; deferring footnote recovery is almost always a
> doctrine violation.

> **No-paraphrase rule (load-bearing).** This skill re-anchors
> footnote bodies that leaked into the body as ordinary paragraphs,
> or that were emitted as `% orphan footnote` comments. The
> reattachment is *structural only*: strip the leading footnote
> number, wrap the rest in `\footnote{…}`, and place it at the call
> site. **Do not rewrite the footnote's words.** Do not "tighten",
> paraphrase, expand, or smooth the source text. Do not drop
> author-year mentions while reformatting (an existing
> `Tao [2011]` becomes `\citet{tao2011}` — it never disappears).
> Do not invent continuation text for a footnote that ends mid-
> sentence — use `recover_truncated_footnote.py` to pull the
> continuation from the PDF instead. The `lee2023structure`
> footnote-18 case (2026-05) — where the AI step substituted invented
> philosophy prose for the source text and silently dropped a
> `Tao [2011]` citation — is the exact failure mode this rule exists
> to prevent. See `_doctrine.md` §No-paraphrase rule for full
> taxonomy.

Operates on `papers/$ARGUMENTS/main.tex`.

## Failure modes

Footnotes have three failure modes from the original extractor:

1. **Orphan-comment form** — `% orphan footnote` comments scattered
   in the body; the call site is unknown.
2. **Leaked-prose form (most common)** — pymupdf and similar
   extractors emit footnote bodies as ordinary paragraphs at
   page-bottom, beginning with a bare or superscript footnote number.
3. **DOCX-dropped form** — DOCX extractor silently drops PDF
   footnotes; the body has no `\footnote{…}` and no leaked-prose
   bodies, but the PDF alternate has visible footnotes.

For modes 1 and 2, walk the tier ladder below. For mode 3, the DOCX
case stays out-of-scope for re-extraction (warn and continue, per the
DOCX-native rule in Tier 4) — but the warning is single-issue, not a
stall reason for the rest of the pass.

If `% orphan footnote` comments exist in the document (mode 1),
attempt to re-attach them as `\footnote{…}` at the correct position
in the body text. Use footnote numbering from the PDF to identify the
attachment point. If you can't determine the correct position with
Tier 0, walk Tiers 1–4 below — **don't leave orphan comments in
place once the ladder has been walked**; the Tier 4 fallback always
gives every footnote a home.

## Tier 0 — In-file leaked-prose scan

Most leaked-prose footnotes are already present in `main.tex` as
paragraphs; the work is to locate the call site within the same
chapter and rewrap.

Pre-pass to normalize OCR no-separator and glued-multi-footnote
patterns:

```bash
python3 .virgil/scripts/library/split_leaked_footnotes.py papers/$ARGUMENTS/main.tex
```

Standard reattacher (now with bibliography-section / citation-arg /
pgmark-preservation / TOC-skip guards + automatic Tier-4 fallback):

```bash
python3 .virgil/scripts/library/reattach_leaked_footnotes.py papers/$ARGUMENTS/main.tex
```

The script walks `main.tex` for paragraph-start patterns
(`^\d+\s+<body>$`, `^\d+\.\s+<body>$`, column-glued
`^\d+\s+<body>\s+\d+\s+<body>` runs) and matches each leaked body
to an inline call site via six patterns: `<word>.N`, `<word>N`
(no separator), `<word>,N`, `<word> N`, `<close-punct>N`, and
`<digit>, N`. Rewraps each match as `\footnote{<body>}` inline at
the call site. Reports placed vs. unplaced counts.

Unicode-superscript-prefixed leaks (modern OUP/Cambridge/Springer):

```bash
python3 .virgil/scripts/library/reattach_super_footnotes.py papers/$ARGUMENTS/main.tex
```

**PDF-native sources with footnote bodies leaked as paragraph prose.**
Many PDF extractors (pymupdf in particular) emit footnote bodies as
ordinary paragraphs at the page-bottom, with no `% orphan footnote`
marker — the prose just sits there as a paragraph beginning with a
bare or superscript footnote number (e.g. `1Not absent some extra
information…`, `7See e.g., Hobbs [1979, 1990]…`). When the source
is the PDF itself (not a DOCX with a PDF alternate), and the body
text contains corresponding inline superscript markers (or
bracketed numbers like `[1]`), **do** re-attach the leaked
paragraphs as `\footnote{…}` at their call sites. The mapping is
determined by the leading footnote number on the leaked paragraph
matching an inline marker in the body text earlier on or near the
same page. Strip the leading number from the footnote body, escape
internal braces if needed, and place the `\footnote{…}` inline at
the call-site superscript position. Footnote-internal citations get
rewritten per `clean-bibliography` just like body citations.

## Tier 0.5 — Endnote-style branches

If the source is endnote-style (chapter-end notes rather than per-page
footnotes), use the appropriate reattacher. Expects 70–95% recovery
before Tier 1.

Per-chapter Notes blocks (single-chapter papers — identifies notes-block
structure: last paragraph of a chapter starting with `^1\.\s+`, followed
by `2\.`, `3\.`, … and ending at the next chapter or end of section,
parses the bodies, and matches inline call sites within the parent
chapter):

```bash
python3 .virgil/scripts/library/reattach_chapter_end_notes.py papers/$ARGUMENTS/main.tex
```

End-of-book Notes with `\subsection{Chapter N}` sub-dividers:

```bash
python3 .virgil/scripts/library/reattach_unified_chapter_notes.py $ARGUMENTS
```

End-of-book unified `\section{Notes}` with `Notes to Chapter N`
sub-headers (free-form bold/italic lines, *not* LaTeX subsection
commands — Chalmers/Dennett/Searle/Hofstadter monograph pattern,
chalmersramsey memo):

```bash
python3 .virgil/scripts/library/reattach_unified_endnotes.py papers/$ARGUMENTS/main.tex
```

End-of-document Notes with no per-chapter dividers:

```bash
python3 .virgil/scripts/library/reattach_document_end_notes.py $ARGUMENTS
```

Popular-science page+hint endnotes (`<page>\t<hint>: <citation>`):

```bash
python3 .virgil/scripts/library/reattach_page_hint_endnotes.py papers/$ARGUMENTS/main.tex
```

## Pre-Tier 1 preflight (verify offsets and check for duplicates)

**Before invoking any tier: verify the PDF-page → printed-page
offset.** Don't assume a fixed offset (e.g. `+10` or `+11`) — the
number of PDF pages between the cover and printed page 1 varies per
paper. Pin it by finding the PDF page on which the printed
page-number footer matches the lowest existing `\pgmark{N}` in
`main.tex`:

```bash
# Find the PDF page whose footer says <N>; offset = pdf_page - N
for p in $(seq $N $((N+30))); do
  pdftotext -layout -f $p -l $p papers/$ARGUMENTS/$ARGUMENTS.pdf - 2>/dev/null \
    | awk -v n=$N '$0 ~ "^[[:space:]]*"n"[[:space:]]*$" { print p; exit }'
done
```

(Or call `recover_missing_pgmarks.py` / `recover_page_break_fragments.py`
/ `extract_pdf_footnotes.py`, which auto-detect the offset.) Mis-typed
offsets cause every subsequent tier-1 lookup to land on the wrong
page, with no obvious error signal — verify once at the start of the
session.

**Before placing reconstructed prose: pre-flight a duplicate check.**
If you're about to insert a sentence or paragraph reconstructed from
the PDF, first grep `main.tex` for the leading 4-6 words. The
extractor sometimes preserves a *truncated* version of the text
elsewhere (e.g., earlier in the paragraph, or just before the page
break), and inserting a fresh copy creates a hard-to-spot duplicate.
If a near-match exists, EXTEND the existing truncated location
rather than INSERT a fresh copy.

## Tier 1 — PDF re-extraction

Many PDF extractors (pymupdf in particular) collapse superscript
markers into the baseline text or drop them entirely. Re-run
`pdftotext` in layout mode on the page in question (`$N` is the PDF
page, computed from the printed page plus the verified offset
above):

```bash
pdftotext -layout -f $N -l $N papers/$ARGUMENTS/$ARGUMENTS.pdf -
```

Layout mode preserves vertical position and often surfaces
superscripts that the default mode lost. Compare against the current
`main.tex` body to find the call site, then place the `\footnote{…}`.

For batch footnote recovery across many pages, prefer the
`extract_pdf_footnotes.py` + `reattach_footnotes.py` pipeline:

```bash
python3 .virgil/scripts/library/extract_pdf_footnotes.py papers/$ARGUMENTS/$ARGUMENTS.pdf papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/virgil/footnotes-extracted.json
python3 .virgil/scripts/library/reattach_footnotes.py papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/virgil/footnotes-extracted.json
```

The first script auto-detects chapter boundaries via `\section{}`
headings + nearest `\pgmark{}`, walks each chapter's PDF pages, and
parses vertical-format footnote bodies into a per-chapter JSON. The
second walks each chapter's body in `main.tex`, finds inline call
sites (`<letter-or-punct>N<word-boundary>`), and inserts
`\footnote{<body>}`. Run `clean_fn_trailing_pagenum.py` afterward
to strip any leaked printed-page-number footers that got swept into
footnote bodies. Footnotes the auto-pipeline doesn't place fall
through to Tier 2/3.

> The source PDF basename matches `$ARGUMENTS` for PDFs indexed via
> the standard pipeline. If the on-disk filename differs (e.g.
> `<citekey>.PDF` or a triage-renamed alternate), substitute the
> actual filename in the first arg.

> **Tier 1 failure mode.** If `extract_pdf_footnotes.py` aborts with
> `ERROR: can't pin offset (no PDF footer for printed page N)`, the
> PDF lacks a recognisable footer for the seed page — common in
> popular-science books and InDesign-typeset PDFs where the running
> footer is graphical. **Skip Tier 1 and proceed to Tier 3 / orphan
> resolution.** Do not retry; the auto-detector won't change its
> mind on a re-run.

## Tier 2 — Fresh OCR on individual pages

If `ocrmypdf` is available, generate a fresh OCR layer for just the
relevant page(s):

```bash
mkdir -p .virgil/work/$ARGUMENTS
ocrmypdf --pages $N --force-ocr -O 0 --output-type pdf \
  papers/$ARGUMENTS/$ARGUMENTS.pdf \
  .virgil/work/$ARGUMENTS/page-$N.pdf
pdftotext -layout .virgil/work/$ARGUMENTS/page-$N.pdf -
```

Skip silently if `ocrmypdf` is missing (`command -v ocrmypdf` →
empty). The Tier 1 result is still useful even if Tier 2 isn't
available.

## Tier 3 — Rasterize and read visually

Rasterize the page to PNG and read it directly. Claude Code's `Read`
tool natively shows PNG/JPEG images, so you can look at the page as
a human would and locate the superscript marker by eye:

```bash
mkdir -p .virgil/work/$ARGUMENTS
python3 -c "import fitz; doc=fitz.open('papers/$ARGUMENTS/$ARGUMENTS.pdf'); doc[$N-1].get_pixmap(matrix=fitz.Matrix(2,2)).save('.virgil/work/$ARGUMENTS/page-$N.png'); doc.close()"
```

Then `Read .virgil/work/$ARGUMENTS/page-$N.png` and locate the
superscript marker visually. Use the visible word adjacent to the
superscript to find the corresponding word in `main.tex` (the OCR
text and the indexed body should share most of the lexical content)
and place the `\footnote{…}` there.

For multi-page ambiguities you can rasterize a range with a single
Python invocation — keep the work directory and clean it up at the
end of the run (or at the start of the next run). `recover_orphan_footnotes.py`
does this in batch.

## Tier 3.5 — PDF call-site recovery

Before falling back to Tier 4, run the batch PDF call-site recovery
script against all remaining `[orphan fn N]`-tagged notes from prior
passes:

```bash
python3 .virgil/scripts/library/resolve_orphan_footnotes.py $ARGUMENTS
```

6-pattern matcher (`.N` / `<word>N` / `,N` / ` N` / `<close-punct>N`
/ `<digit>, N`) with citekey-derived snippet fallback. The script
tries the patterns against the PDF page text, filters running
headers/footers, and matches body context within ±12K chars of the
orphan position in `main.tex`. Processes orphans in reverse document
order so earlier ones' offsets stay valid. Expects 70–85% additional
recovery over Tier 1's auto-pipeline output. Anything still
unattached after this batch run falls through to Tier 4.

> **Coverage caveat.** The script's wrapper regex caps nested-brace
> depth at 2, so dense footnotes (multiple `\cite{...}` inside an
> orphan body) may be silently skipped. If
> `grep -cE '\[orphan fn [0-9]+\]' papers/$ARGUMENTS/main.tex`
> exceeds the script's reported total by more than 2×, treat the
> unmatched orphans as accepted Tier-4 outcomes — approximate
> placement with an `[orphan fn N]` prefix is strictly better than
> no placement.

## Tier 3.7 — Semantic relocation

For orphans whose body has a distinctive term that appears exactly
once in the enclosing chapter:

```bash
python3 .virgil/scripts/library/relocate_orphan_footnotes.py $ARGUMENTS
```

## Tier 4 — Orphan-prefix attachment (always succeeds)

When a footnote body cannot be confidently matched to a call site
after Tiers 0–3.7, attach it to the **end of the nearest preceding
body paragraph** with `[orphan fn N]` prefix:

```latex
... preceding paragraph's last sentence.\footnote{[orphan fn 7] Not
absent some extra information about the typing context...}
```

The `[orphan fn N]` prefix tells the reader the placement is
approximate. This is **strictly better** than leaving the numbered
paragraph loose as prose, which (a) clutters the body with
mis-classified text and (b) wastes the work of having extracted
the footnote body. Tier 4 always succeeds; every footnote gets a
`\footnote{}` wrapper.

Tier 4 is not a standalone invocation; it fires *automatically*
inside `reattach_leaked_footnotes.py` (Tier 0) whenever a leaked-prose
paragraph can't be auto-attached to a call site. Each Tier-4
placement is logged as `[N via Tier-4 orphan-prefix]` in the reattach
summary. **The orphan count can *increase* during Tier 0** if call
sites can't be found; later tiers (3.5, 3.7) then *decrease* it as
exact placements are recovered. **Tier-4 placement is strictly better
than leaving a numbered paragraph unattached.**

Optionally, when many orphans converge to nearby positions, emit a
summary warning of the form:

`footnote-recovery-needed: <N> footnotes attached with approximate
placement (orphan-prefix tag) — Tiers 0–3.5 could not pin call sites`

Where `<N>` is the count of footnotes attached with `[orphan fn N]`
prefix. This warning is informational, not a blocker. Re-running
deep-index does NOT re-do these — `[orphan fn N]` is the canonical
form for approximate placements.

This rule is **distinct from the DOCX-native case below**. There,
footnotes were dropped entirely; here they leak as prose. The
DOCX-native rule forbids synthesis from the PDF (because re-extraction
is `/library/index-paper`'s job); the PDF-native rule permits
re-attachment from prose already in `main.tex` (no re-extraction, just
repositioning). The two paths cover disjoint extractor failure
modes.

## DOCX-native sources with PDF alternate

The DOCX extractor commonly drops PDF footnotes silently — no
`% orphan footnote` markers are emitted, and the body text has no
`\footnote{…}` either. Deep-index does **not** synthesize footnotes
from the PDF in this case (recovery requires re-extracting against
the PDF, which belongs to `/library/index-paper`). If you notice the
asymmetry (PDF has visible footnotes, `main.tex` has none), record
exactly one warning of the form `"footnote-recovery-needed: <count>
footnotes in PDF source not present in main.tex"` for the catalog-row
step to merge into `entry.indexed.warnings`, and continue. Do not
block the deep-index pass on this.

**Why this kind defers to step 5 rather than persisting here.**
`/library/clean-bibliography` persists its three kinds at source
(task 323) because its OWN next step reads them back out of the catalog
within the same run. Nothing reads `footnote-recovery-needed:` inside
the producing pass, so persist-at-source would buy nothing here and
`deep-index.md` §5 remains its coherent owner. Running standalone, say
plainly in your reply that the line was computed and is persisted by a
`/library/deep-index` pass (or its step 5), not by this run. The
asymmetry with clean-bibliography is chosen, not drift.

**How to derive `<count>` (must be deterministic across re-runs).**
Run `pdfinfo papers/$ARGUMENTS/$ARGUMENTS.pdf | grep '^Pages:'` to
get the page count K. Then extract every line of `pdftotext` output
that is a bare positive integer between 1 and 200 (inclusive) —
footnote numbers virtually never exceed 200, and this hard cap
excludes journal-offset page numbers like 730..756 outright.
Then identify and **subtract the page-number set**:

1. Look at your bare-integer set. Find the **longest run of
   consecutive integers** in it (e.g. for `{1,2,3,5,7,8,9,10,11,17}`
   the longest run is `{7,8,9,10,11}`).
2. If that run has length ≥ `min(K, 8)` — i.e. it covers most of
   the printed pages, or at least 8 consecutive pages for very
   short papers — treat the entire run as page numbers and remove
   it from the set.
3. If no such run exists (e.g. the PDF doesn't surface page numbers
   as bare integers at all, or pagination is non-numeric), do
   nothing — the bare-integer set is already mostly footnotes.

Then take the maximum of what remains. That is the footnote count.
Do **not** count occurrences of each integer — count once. If the
remaining set is empty, the count is 0 and you emit no warning.

**Why this works.** Page numbers in `pdftotext` output appear as a
contiguous arithmetic sequence (one per page boundary, in order),
whether the article paginates from 1 or from a journal offset like
730. Footnote numbers are also a contiguous arithmetic sequence
in principle, but their range stays under 200 in practice (the
200-line cap above already excluded most page-number runs that
start at high offsets; the contiguous-run detector handles the
rest). The detector is conservative — it underreports rather than
overreports (better to miss a footnote-count warning than fire a
spurious one).

## Truncated-footnote recovery

For footnotes ending mid-sentence (the body continuation got
dropped at the page boundary):

```bash
python3 .virgil/scripts/library/recover_truncated_footnote.py $ARGUMENTS --apply
```

## Post-recovery cleanup (always run, idempotent)

Strip over-escapes inside footnote bodies:

```bash
python3 .virgil/scripts/library/unescape_footnote_bodies.py papers/$ARGUMENTS/main.tex
```

Lift any `\footnote{}` that landed inside `\cite{}` brace args:

```bash
python3 .virgil/scripts/library/fix_footnote_in_citation_args.py papers/$ARGUMENTS/main.tex
```

Pull `\pgmark{}` literals out of footnote bodies (otherwise the
renderer silently swallows them):

```bash
python3 .virgil/scripts/library/fix_pgmark_in_footnotes.py papers/$ARGUMENTS/main.tex
```

## Update `entry.indexed.footnoteCount` after re-attachment

When the catalog-row write step runs, recompute `footnoteCount` as
the number of `\footnote{` occurrences in the post-deep-index
`main.tex` (one shell pass: `grep -o '\\footnote{' main.tex | wc
-l`). The pre-deep-index value (typically 0 for PDF-native leaked
sources) reflects the extractor's output, which is now stale.
Updating it gives downstream readers and the future paper-counts
UI an accurate picture of how many footnotes the document actually
carries. Skip this re-count when the deep-index pass made no
footnote re-attachments — preserve the prior value.
