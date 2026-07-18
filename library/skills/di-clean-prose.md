---
description: |
  Clean up the prose of an indexed library paper — fix the title and
  headings, restore the heading hierarchy, handle drop caps, and
  align pagination anchors. Triggers on: "clean the prose for
  <citekey>", "fix the headings in this paper", "tidy the title and
  drop caps for X". Phase 3 of the /deep-index pipeline; invoke
  directly when only prose-level cleanup is needed. Does NOT trigger
  for footnote recovery (use /recover-footnotes) or bibliography
  cleanup (use /clean-bibliography).
arguments: <citekey>
---

# Deep-index prose cleanup

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

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope, anti-patterns,
> self-check, convergence behavior, narrow out-of-scope categories).

> **No-paraphrase rule (load-bearing).** Header / heading / drop-cap /
> pgmark-alignment cleanup is *structural*: deleting misclassified
> headings, merging wrapped heading fragments, recovering OCR-dropped
> drop-cap letters, fixing `\title{}`, moving a pgmark to body scope.
> **Do not rewrite the words of body paragraphs.** Drop-cap recovery
> prepends a single recovered letter to one word; it does not rewrite
> the following sentence. Multi-article span removal *deletes* the
> adjacent-article text — it does not paraphrase or summarize it.
> Heading-hierarchy fixes change `\section{}` / `\subsection{}` markup
> around a heading, not the heading's text (except when the doctrine
> explicitly authorizes deletion of OCR-garbage clusters). See
> `_doctrine.md` §No-paraphrase rule for the full permitted/forbidden
> taxonomy and the `lee2023structure` failure case.

Operates on `papers/$ARGUMENTS/main.tex` after `/library/di-preflight`
has run.

## Step 3a — Header / `\maketitle` cleanup

Compare the current `\title{…}`, `\author{…}`, `\date{…}` fields
against `master.bib`. Fix them if they're wrong (e.g. title includes
the journal name, or author is in wrong format). Ensure `\maketitle`
is present after the preamble. Remove any author names, journal
titles, or institutional affiliations that leaked into the body text
as paragraphs or headings on the first page (they belong in the
preamble fields, not in the document body).

**Filename-shaped titles.** If `\title{}` matches a filename pattern
(`*.dvi`, `*.pdf`, `*.ps`, or a single-word LaTeX-source residue), the
extractor used the file's source name instead of the printed title.
Replace with the actual title from `master.bib`. If `master.bib` is
also wrong, promote the document's first `\section{}` heading as the
title.

**Drop-cap recovery (OCR'd books).** OCR commonly drops the styled
drop-cap glyph at chapter starts, leaving body text like `ower is the
ability to do work...` mis-classified as a `\subsubsection`. Detect
by scanning the first paragraph after each `\section{}` for a lowercase
opening that doesn't form a valid English word with the section
heading's context. Run:

```bash
python3 .virgil/scripts/library/recover_drop_caps.py papers/$ARGUMENTS
```

The script reads the corresponding PDF page via `pdftotext -layout`
to recover the missing initial letter and emits a patch list. Apply
each suggestion as a body Edit (one-letter prepend; never modify
surrounding text).

For scanned-OCR articles where the drop-cap got concatenated to the
title (e.g., `\section{... PERCEPTION* I}` + body `n perception`):

```bash
python3 .virgil/scripts/library/recover_drop_cap_at_title.py papers/$ARGUMENTS/main.tex
```

**Content vs. metadata mismatch — file is source of truth.** When
the body content does not match `master.bib`'s `title` (e.g., the
file is a whole book but `master.bib` describes one chapter, or the
file and bib describe genuinely different works, or this is a
reprint / republication), the on-disk file wins. Update
`master.bib`, the catalog row, and the in-file `\title{...}` to
match the file's actual identity. Use the cover/title-page of the
source PDF as the authoritative title. Apply this **automatically**
— do not defer; do not surface a question (see `_doctrine.md` §0).

When `detect_metadata_mismatch.py` (run in di-preflight) flagged a
mismatch, the policy script in preflight already updated
`master.bib`. Otherwise, apply the update directly:

1. Read the cover/title page via `pdftotext -layout`.
2. Choose the longest reasonable candidate title from the cover. If
   ambiguous, prefer the larger artifact (book over chapter,
   proceedings over paper, reprint over original).
3. Use `update_master_bib_entry.py` and `update_catalog_entry.py`
   (NOT direct Write) to acquire the file locks safely. **The bib
   shim's write is a whole-block replacement, not a diff** — it
   re-emits the entry from exactly the fields file. What you have here
   is a cover-page *correction* (a title, maybe publisher/isbn), so
   pass `--merge-existing` and the rest of the entry survives; without
   it the shim refuses the write rather than let author/year/doi be
   destroyed. This is the hand-run twin of what
   `apply_metadata_mismatch_policy.py` does in preflight.
4. Set `bib.state = "needs-reauth"` so the next
   `/library/authenticate-bib` pass re-verifies the new DOI.
5. Update the in-file `\title{}` to match.
6. Log the change as an AI-change bullet in the run summary — never
   as outstanding work.

For reprint / republication: keep the existing bib but add a
`note` field documenting the reprint source, then proceed — a
single-field fields file, so `--merge-existing` is required here too.

**The only exception — `metadata-lock: true`.** If the catalog row
carries `metadata-lock: true`, the user has explicitly pinned the
metadata. Do **not** touch `master.bib` or the catalog `title`.
Signal the orchestrator to emit `DEEP_INDEX_STALLED` (see
`_doctrine.md` §0) and append a notification with
`kind: "deep-index-blocked"` and reason
`metadata-lock: true on catalog row; pass blocked`. This is the
same exit channel as the three-iteration validator abort. Do not
emit it as an outstanding-work item — it's a terminal-state
block.

**Multi-article PDF detection.** If `detect_genre.py` (preflight)
classified the source as `multi-article-pdf`, run:

```bash
python3 .virgil/scripts/library/detect_multi_article.py papers/$ARGUMENTS
```

The script identifies adjacent-article spans in `main.tex` (text that
belongs to a different article — often JSTOR scans or Annual Reviews
collections include front-of-issue or facing-page content). Surgically
remove each identified span via a body Edit. This **is** in-scope for
/deep-index per §Scope doctrine — don't defer it to /index-paper. The
threshold for surgical removal: the span must (a) be clearly
attributable to a different article (different title, different
authors), (b) not be referenced by the body of the indexed paper,
and (c) have a clear start/end boundary (typically a column or
paragraph break).

## Step 3b — Heading hierarchy

Walk the entire document and correct `\section` / `\subsection` /
`\subsubsection` usage:

- Remove section numbering from heading text (e.g. `\section{2. The
  Data}` → `\section{The Data}`) — LaTeX auto-numbers sections.
- Demote or remove misclassified headings. Common mistakes:
  - Author name promoted to `\subsubsection{Samuel Cumming}` — delete.
  - Single words that are clearly running header remnants — delete.
  - Subheading levels are wrong (e.g. `\subsection` where `\section`
    is needed based on the document structure).
- Use the PDF's table of contents or visual structure to verify the
  heading hierarchy.

For OCR'd books with bulk-corruption (many `\subsection{...}` calls
with lowercase content):

```bash
python3 .virgil/scripts/library/strip_ocr_headings.py papers/$ARGUMENTS/main.tex
```

For diagram-heavy books (Venn diagrams, payoff matrices, formal
logic) — *reporter; review before editing*:

```bash
python3 .virgil/scripts/library/detect_garbage_headings.py papers/$ARGUMENTS/main.tex
```

For prose-shaped misclassified headings (italicized fragments,
transitional phrases, ellipses) — these are body sentences
mis-promoted — *reporter; review before editing*:

```bash
python3 .virgil/scripts/library/detect_misclassified_headings.py papers/$ARGUMENTS/main.tex
```

> **Known false-positive patterns for the two reporters above.** Both
> scripts can flag legitimate headings; do not blindly act on every
> report. Common false positives:
>
> - **Numbered chapter titles** (`\section{1. First Approximations}`,
>   `\section{2. Private Language, Public Languages}`): the period
>   after the chapter number trips
>   `detect_misclassified_headings`'s `\.\s+[A-Z]` "multiple sentences"
>   rule; the same titles often surface in
>   `detect_garbage_headings`. If the heading is a legitimate chapter
>   title that matches the book's TOC structure, skip the candidate.
> - **All-caps siblings already at the correct nesting level** —
>   sometimes flagged as garbage due to length / lack of subordinate
>   prose.
> - **Single-phrase titles with no body prose at all** — the
>   "multiple sentences" rule sometimes mis-fires on author + comma +
>   year citation contexts inside an otherwise legitimate heading.
>
> **Reliable vs. unreliable reasons for `detect_misclassified_headings`.**
> The script tags each finding with one of five reasons. Their
> reliability varies:
>
> - `interior comma + lowercase` — **reliable**. Almost always a real
>   pulled-prose mispromotion.
> - `transitional phrase` (however, indeed, therefore, …) —
>   **reliable** for similar reasons.
> - `ends with ellipsis` — **reliable** for body-prose detection.
> - `italic/quoted pulled sentence` — **moderately reliable**; review.
> - `multiple sentences` — **unreliable on numbered headings**; review
>   carefully (this is the main source of false positives).
>
> Review every report against the paper's actual structure before
> editing. Both scripts only **print** findings; they don't mutate the
> file.

For punctuation-only headings (`* *`, `**`, `Δ`):

```bash
python3 .virgil/scripts/library/strip_punctuation_only_headings.py papers/$ARGUMENTS/main.tex
```

For inline section labels (LSA / Journal of Philosophy / Wiley
styles):

```bash
python3 .virgil/scripts/library/promote_inline_section_labels.py papers/$ARGUMENTS/main.tex \
    --style=default   # or `jp` (lowercase roman) or `wiley`
```

For OCR-spaced lost subsections (`M u lti-d im en sion al`) — *script
not yet written; recognize the pattern manually and edit if it
appears*:

```bash
# python3 .virgil/scripts/library/promote_lost_subsections.py papers/$ARGUMENTS/main.tex
# (TODO: script doesn't exist yet. Manually edit affected headings.)
```

**All-caps sibling promotion.** When `\subsubsection{HEADING1}`,
`\subsubsection{HEADING2}`, … `\subsubsection{HEADINGn}` are all-caps
siblings at the same nesting depth, the extractor mistook journal
small-caps or all-caps styling for a sub-sub-section. Promote each
to `\section{Title Case HeadingN}`. This is a common failure mode
for Annual Reviews, Springer, and other journals that style section
headings in all-caps. Detection: run of ≥2 sibling
`\subsubsection{}` calls whose argument is ≥80% uppercase letters
and ≥4 characters. Manual edit or per-paper script.

**Math-symbol subsection demotion.** Headings whose content is
dominated by math symbols (⊢, ⇑, ⇀, ↿, ▷◁, ≡, ∅, ⊬, ∆, Γ, δ, γ, σ, θ,
⇒) or has fewer than 3 letters or starts with `)` should be unwrapped
back to plain body text. These are inference-rule diagram fragments
mis-promoted from formal-logic/math books. Common in textbooks and
dissertations on logic, semantics, and proof theory.

**OCR-garbage heading detection (cluster awareness).** Per-line
heuristics ("mostly numbers", "single-word fragments") miss ~50% of
garbage headings on edge cases. Use cluster awareness:

- If `\section{}` / `\subsection{}` headings appear in a cluster of
  ≥3 short/noisy entries within 50 lines, and the surrounding body
  text reads like a figure caption (axis labels, coordinate values,
  figure references), the entire cluster is a figure-caption block
  that the extractor synthesized. Delete the headings (or convert to
  `\textbf{}` if the captions are needed).
- Single-character headings, headings whose argument is mostly
  non-alphabetic punctuation, and headings with `\(\d+\)\s*[a-z]'?\(`
  shape (formal-semantics example markers): delete or convert to
  body text. They are not headings.

**Multi-line section fragment merger.** Book chapter titles often
wrap across extraction lines (e.g., `\section{Convention, Construction,
and}` immediately followed by a blank line and `\section{Cinematic
Vision}`). Detect adjacent `\section{}` calls separated only by blank
lines where the first ends without terminal punctuation (no period,
no question mark, no closing quote), and merge them into a single
heading. Preserve italic-toggle and quote-context.

**Lost section heading recovery.** If a chapter or section heading
appears to be missing — sequence reset detected in body text (e.g.,
note numbers jump backward from 47 to 1), or the body contains a
chapter list that doesn't match the present headings — propose
inserting it. Source the title from the body's chapter list or the
PDF's TOC.

**Lost chapter-title recovery (OCR'd books):**

```bash
python3 .virgil/scripts/library/recover_chapter_titles.py $ARGUMENTS
```

> **Verify the result.** After running, scan the diff for repeated
> identical `\section{}` titles (a strong signal the script captured
> the book's recto/verso running-header banner instead of real
> chapter titles — common on OCR'd books with strong page banners).
> If you see the same heading text re-injected at every pgmark,
> revert and use `extract_book_toc.py` + `book_chapter_locator.py`
> (next block) instead.

For book TOC-driven heading insertion:

```bash
python3 .virgil/scripts/library/extract_book_toc.py $ARGUMENTS --out /tmp/$ARGUMENTS-toc.json
python3 .virgil/scripts/library/book_chapter_locator.py $ARGUMENTS /tmp/$ARGUMENTS-toc.json
```

> **Verify the result.** After running, scan the diff: if the inserted
> `\section{Chapter N: <title>}` headings appear adjacent to existing
> title-only `\section{<title>}` headings (the book uses titles-only
> rather than `Chapter N: …`), they're **duplicates** — the script's
> existing-section guard only matches sections that already start
> with a numeric chapter number. Revert and either (a) rely on the
> existing chapter headings, or (b) manually rewrite the existing
> headings to include the chapter number so future locator runs see
> them. Also cross-check the TOC count against the body's `\section{}`
> count — `extract_book_toc.py` sometimes misses chapters in messy
> PDF TOCs (the locator only inserts what TOC contains).

## Step 3c — `\pgmark` alignment

> **Short-circuit for DOCX-native (or otherwise pgmark-less) papers.**
> If the catalog row has `indexed.pgmarkCount == 0` — typical for
> DOCX-native extraction, plain-text imports, etc. — there are no
> markers to align. **Skip §3c entirely.** Do **not** read the PDF
> alternate and synthesize new pgmarks; that's out of scope for
> deep-index (it would re-extract page boundaries, which belongs to
> `/index-paper`). The validator in §3i will pass trivially in this
> case (zero markers ⇒ no scope violations, no continuity gaps).
>
> Note: §2's PDF reading rule (read the first ~8 pages of any
> available PDF for structural reference) **still applies** — it's a
> read-only structural cross-check, not a pgmark-synthesis step.
> Only the per-marker alignment work in §3c is short-circuited.

Verify that `\pgmark{N}` appears **above** the first line of content
from printed page N. After header/footer removal, some markers may
have shifted relative to their content. Cross-check against the PDF
text to confirm correct placement.

**Scope rules (load-bearing — silently breaks rendering if violated).**
`\pgmark{N}` must appear at **document body scope only**. Never inside:

- math mode: `\[...\]`, `$...$`, `\begin{equation}...\end{equation}`,
  `align`, `gather`, `multline`, or any other math environment;
- the brace-argument of a command: `\footnote{...}`, `\textbf{...}`,
  `\textit{...}`, `\section{...}`, `\subsection{...}`, `\title{...}`,
  `\author{...}`, `\date{...}`, etc.;
- the preamble (above `\begin{document}` / `\maketitle`).

The renderer's pgmark scanner only sees markers at body scope; one
inside math or a command argument is silently swallowed and produces
no margin chip.

If a source page boundary cuts through one of these constructs, place
the pgmark on its own line *before* the enclosing block. If that loses
too much fidelity (e.g., the boundary truly falls inside a multi-line
equation), **split the block at the boundary** into two pieces with
the pgmark on its own line between them. Example — equation (4) of
`cumming2024attentional` with the page break running through the `=`:

```latex
\[ (4) \quad [\![\text{Why is Mary annoyed?}]\!] = \]

\pgmark{5}

\[ \lambda p.\, \text{Explanation(that Mary is annoyed, } p) \]
```

Do **not** fuse those two displays into one — the pgmark would have
to live inside math, and would disappear.

**OCR-garbled Roman numeral pgmarks:**

```bash
python3 .virgil/scripts/library/fix_roman_pgmarks.py $ARGUMENTS
```

**Italic OCR `I`/`l`/`O` as digits in year / page-range contexts:**

```bash
python3 .virgil/scripts/library/fix_italic_numerals.py papers/$ARGUMENTS/main.tex
```

**Mid-word page-break gap detection (no auto-fix; reports):**

```bash
python3 .virgil/scripts/library/recover_mid_word_breaks.py $ARGUMENTS
```

**Low-confidence pgmark promotion:**

```bash
python3 .virgil/scripts/library/recover_low_confidence_pgmarks.py $ARGUMENTS \
    --threshold 0.30 --window 1500
```

**Strip impossible pgmark outliers** (only fires on values past the
IQR envelope, so journal-offset reprints are safe):

```bash
python3 .virgil/scripts/library/strip_impossible_pgmarks.py papers/$ARGUMENTS/main.tex
```

**Chapter-footnote collision detection** (low-N pgmarks that are
actually footnote numbers, not page numbers):

```bash
python3 .virgil/scripts/library/detect_chapter_footnote_collision.py papers/$ARGUMENTS/main.tex
```

**Repair with bypass** (when `master.bib` has `pages = {<lo>-<hi>}`,
pass `--max-page <hi+5>` to strip year-shaped or stray-page outliers
without triggering the >50% safeguard):

```bash
python3 .virgil/scripts/library/repair_pgmarks.py papers/$ARGUMENTS/main.tex --max-page 250
```

For `@book` entries (which normally lack a `pages` field), omit
`--max-page` entirely — the script's IQR-envelope safeguard handles
outlier protection on its own. If the catalog warns
`pgmark-range-impossible` on a `@book`, run
`recover_low_confidence_pgmarks.py` first to upgrade legitimate
markers before invoking `repair_pgmarks` (so the IQR envelope is
computed against the full population, not just the high-confidence
subset).
