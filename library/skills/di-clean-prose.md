---
description: Deep-index prose cleanup (Step 3a/3b/3c) — title/header cleanup, heading hierarchy, drop caps, pgmark alignment basics. Phase 3 of the deep-index split.
arguments: <citekey>
---

# Deep-index prose cleanup

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope, anti-patterns,
> self-check, convergence behavior, narrow out-of-scope categories).

Operates on `papers/$ARGUMENTS/main.tex` after `/library/di-preflight`
has run. The canonical narrative for each step still lives in
[deep-index.md](deep-index.md) §3a/3b/3c; the subskill stub
documents the script-invocation order and the load-bearing rules.

## Step 3a — Header / `\maketitle` cleanup

Compare `\title{...}`, `\author{...}`, `\date{...}` against
`master.bib`. Remove journal-title / institutional-affiliation /
author-name leaks from the body.

**Filename-shaped titles** (`*.dvi`, `*.pdf`, `*.ps`, single-word
LaTeX-source residue): replace with the `master.bib` title; if
that's also wrong, promote the first body `\section{}` heading.

**Drop-cap recovery (OCR'd books):**

```bash
python3 .virgil/scripts/recover_drop_caps.py papers/$ARGUMENTS
```

For scanned-OCR articles where the drop-cap got concatenated to the
title (e.g., `\section{... PERCEPTION* I}` + body `n perception`):

```bash
python3 .virgil/scripts/recover_drop_cap_at_title.py papers/$ARGUMENTS/main.tex
```

**Content vs. metadata mismatch.** When `detect_metadata_mismatch.py`
(run in di-preflight) returned `file-is-book-bib-is-chapter`, the
policy script in preflight already updated `master.bib`. Otherwise,
the four-condition policy stays a `user-judgment-required` (see
[_doctrine.md](_doctrine.md) for when it isn't).

**Multi-article PDF detection:**

```bash
python3 .virgil/scripts/detect_multi_article.py papers/$ARGUMENTS
```

Surgically remove adjacent-article spans via body Edit. In-scope per
§0.5 doctrine — don't defer.

## Step 3b — Heading hierarchy

For OCR'd books with bulk-corruption (many `\subsection{...}` calls
with lowercase content):

```bash
python3 .virgil/scripts/strip_ocr_headings.py papers/$ARGUMENTS/main.tex
```

For diagram-heavy books (Venn diagrams, payoff matrices, formal
logic) — *reporter; review before editing*:

```bash
python3 .virgil/scripts/detect_garbage_headings.py papers/$ARGUMENTS/main.tex
```

For prose-shaped misclassified headings (italicized fragments,
transitional phrases, ellipses) — these are body sentences
mis-promoted — *reporter; review before editing*:

```bash
python3 .virgil/scripts/detect_misclassified_headings.py papers/$ARGUMENTS/main.tex
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
python3 .virgil/scripts/strip_punctuation_only_headings.py papers/$ARGUMENTS/main.tex
```

For inline section labels (LSA / Journal of Philosophy / Wiley
styles):

```bash
python3 .virgil/scripts/promote_inline_section_labels.py papers/$ARGUMENTS/main.tex \
    --style=default   # or `jp` (lowercase roman) or `wiley`
```

For OCR-spaced lost subsections (`M u lti-d im en sion al`) — *script
not yet written; recognize the pattern manually and edit if it
appears*:

```bash
# python3 .virgil/scripts/promote_lost_subsections.py papers/$ARGUMENTS/main.tex
# (TODO: script doesn't exist yet. Manually edit affected headings.)
```

**All-caps sibling promotion** (run of ≥2 sibling `\subsubsection{}`
with ≥80% uppercase): promote to `\section{Title Case}`. Manual edit
or per-paper script.

**Math-symbol subsection demotion**: unwrap headings dominated by
`⊢⇑⇀≡⊬∆Γδγσθ⇒` etc. back to body text.

**Multi-line section fragment merger**: adjacent `\section{}` calls
separated only by blank lines where the first lacks terminal
punctuation — merge into a single heading.

**Lost chapter-title recovery (OCR'd books):**

```bash
python3 .virgil/scripts/recover_chapter_titles.py $ARGUMENTS
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
python3 .virgil/scripts/extract_book_toc.py $ARGUMENTS --out /tmp/$ARGUMENTS-toc.json
python3 .virgil/scripts/book_chapter_locator.py $ARGUMENTS /tmp/$ARGUMENTS-toc.json
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

> **Short-circuit for DOCX-native papers** (catalog
> `indexed.pgmarkCount == 0`): skip §3c entirely. The validator in
> §3i passes trivially.

**Scope rule (load-bearing — silently breaks rendering if violated):**
`\pgmark{N}` must appear at document body scope only. Never inside:

- math mode (`\[...\]`, `$...$`, `\begin{equation}…\end{equation}`,
  `align`, `gather`, `multline`, math environment);
- the brace argument of a command (`\footnote{...}`, `\textbf{...}`,
  `\textit{...}`, `\section{...}`, `\subsection{...}`, `\title{...}`,
  `\author{...}`, `\date{...}`);
- the preamble (above `\begin{document}` / `\maketitle`).

The renderer's pgmark scanner only sees markers at body scope; one
inside math or a command argument is silently swallowed and produces
no margin chip.

**OCR-garbled Roman numeral pgmarks:**

```bash
python3 .virgil/scripts/fix_roman_pgmarks.py $ARGUMENTS
```

**Italic OCR `I`/`l`/`O` as digits in year / page-range contexts:**

```bash
python3 .virgil/scripts/fix_italic_numerals.py papers/$ARGUMENTS/main.tex
```

**Mid-word page-break gap detection (no auto-fix; reports):**

```bash
python3 .virgil/scripts/recover_mid_word_breaks.py $ARGUMENTS
```

**Low-confidence pgmark promotion:**

```bash
python3 .virgil/scripts/recover_low_confidence_pgmarks.py $ARGUMENTS \
    --threshold 0.30 --window 1500
```

**Strip impossible pgmark outliers** (only fires on values past the
IQR envelope, so journal-offset reprints are safe):

```bash
python3 .virgil/scripts/strip_impossible_pgmarks.py papers/$ARGUMENTS/main.tex
```

**Chapter-footnote collision detection** (low-N pgmarks that are
actually footnote numbers, not page numbers):

```bash
python3 .virgil/scripts/detect_chapter_footnote_collision.py papers/$ARGUMENTS/main.tex
```

**Repair with bypass** (when `master.bib` has `pages = {<lo>-<hi>}`,
pass `--max-page <hi+5>` to strip year-shaped or stray-page outliers
without triggering the >50% safeguard):

```bash
python3 .virgil/scripts/repair_pgmarks.py papers/$ARGUMENTS/main.tex --max-page 250
```

For `@book` entries (which normally lack a `pages` field), omit
`--max-page` entirely — the script's IQR-envelope safeguard handles
outlier protection on its own. If the catalog warns
`pgmark-range-impossible` on a `@book`, run
`recover_low_confidence_pgmarks.py` first to upgrade legitimate
markers before invoking `repair_pgmarks` (so the IQR envelope is
computed against the full population, not just the high-confidence
subset).
