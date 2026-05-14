---
description: Deep-index preflight (Step 0/0.5) — metadata mismatch detection, lending-slip / JSTOR / multi-article / OCR-recovery dispatch, genre routing.
arguments: <citekey>
---

# Deep-index preflight

Runs the gates that decide whether `/library/deep-index` can proceed
on `papers/$ARGUMENTS/`, and which genre branches downstream subskills
should follow.

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope,
> anti-patterns, self-check, convergence behavior, narrow
> out-of-scope categories).

> **Status note.** Until Phase 3 content migration completes, the
> canonical descriptions of each step still live in
> [deep-index.md](deep-index.md). Subskill stubs document the
> *invocation order* and the scripts that run; the doctrine and
> per-step semantics are in deep-index.md.

## Arguments

`$ARGUMENTS` is the citekey to preflight.

## Step 0.1 — Lending-slip / JSTOR boilerplate strip (one-time)

```bash
python3 .virgil/scripts/detect_lending_slip.py $ARGUMENTS --strip-from-tex
python3 .virgil/scripts/strip_jstor_boilerplate.py papers/$ARGUMENTS/main.tex
```

Removes ILLIAD / OCLC / interlibrary-loan front matter and JSTOR
cover-page boilerplate so downstream cover-page metadata reads land
on the article's real first page.

## Step 0.2 — Content / metadata mismatch detection

```bash
python3 .virgil/scripts/detect_metadata_mismatch.py $ARGUMENTS --json
```

Outputs a `kind` in {`none`, `title-only-missing`,
`author-only-missing`, `both-missing`,
`file-is-book-bib-is-chapter`}. For `file-is-book-bib-is-chapter`:

```bash
python3 .virgil/scripts/apply_metadata_mismatch_policy.py $ARGUMENTS
```

Applies the four-condition auto-resolution policy (see
[_doctrine.md](_doctrine.md)) — updates `master.bib` to `@book`,
updates the catalog, sets `bib.state = needs-reauth`, updates the
in-file `\title{...}`. For other kinds, emit an outstanding-work
item per the §9 categories.

## Step 0.3 — Multi-article detection

```bash
python3 .virgil/scripts/detect_multi_article.py papers/$ARGUMENTS
```

Identifies adjacent-article spans for surgical removal (per §3a in
deep-index.md).

## Step 0.4 — Caesar-shift / running-header cleanup

```bash
python3 .virgil/scripts/decode_caesar_pdf.py papers/$ARGUMENTS/main.tex
python3 .virgil/scripts/strip_ocr_running_headers.py papers/$ARGUMENTS/main.tex \
    --from-master-bib master.bib --from-toc
```

## Step 0.5 — Genre routing

Run `detect_genre.py` and propagate the result to downstream
subskills. The doctrine's genre branches are:

- **`scanned-ocr`** — run `strip_ocr_headings`, `fix_italic_numerals`,
  `fix_roman_pgmarks`, `recover_low_confidence_pgmarks` in
  di-clean-prose; expect Tier 4 prevalence in recover-footnotes.
- **`journal-article-offset-pagination`** — set `--journal-cumulative`
  on `pgmark_validate`.
- **`book-endnote-style`** — Tier 0.5 in recover-footnotes
  (`reattach_page_hint_endnotes` / `reattach_unified_chapter_notes`
  / `reattach_document_end_notes` per the sub-pattern detected).
- **`formal-semantics-paper`** — `mathify_formal_semantics` pre-pass
  in di-examples; skip `bulk_convert_numbered_examples` (heavy
  cross-reference density).
- **`diagram-heavy-book`** — `detect_garbage_headings` then
  `strip_ocr_headings`; expect 4-6× heading-count reduction.
- **`dissertation`** — Step 0.2 metadata check mandatory;
  `promote_lost_subsections` in di-clean-prose;
  `rewrite_citations --style=bracket-numeric` if applicable.
- **`annual-reviews-paper`** — `detect_journal_toc --strip`,
  `consolidate_margin_glossary` (Phase 2.4 deferred).

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
