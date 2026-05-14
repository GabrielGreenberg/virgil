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
logic):

```bash
python3 .virgil/scripts/detect_garbage_headings.py papers/$ARGUMENTS/main.tex
```

For prose-shaped misclassified headings (italicized fragments,
transitional phrases, ellipses) — these are body sentences
mis-promoted:

```bash
python3 .virgil/scripts/detect_misclassified_headings.py papers/$ARGUMENTS/main.tex
```

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

For OCR-spaced lost subsections (`M u lti-d im en sion al`):

```bash
python3 .virgil/scripts/promote_lost_subsections.py papers/$ARGUMENTS/main.tex
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

For book TOC-driven heading insertion:

```bash
python3 .virgil/scripts/extract_book_toc.py $ARGUMENTS --out /tmp/$ARGUMENTS-toc.json
python3 .virgil/scripts/book_chapter_locator.py $ARGUMENTS /tmp/$ARGUMENTS-toc.json
```

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
