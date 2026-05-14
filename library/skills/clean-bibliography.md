---
description: Bibliography cleanup — References itemization, references.bib emission, inline citation rewriting (every style). Phase 3 of the deep-index split.
arguments: <citekey>
---

# Bibliography cleanup

> **Status: Phase 1 stub.** Content will be migrated from
> [deep-index.md](deep-index.md) §3e / §3f / §3g during Phase 3 of the
> [deep-index improvement plan](../../.claude/plans/ok-i-ve-been-running-unified-sunrise.md).
> Until then, run `/library/deep-index` directly.

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope, anti-patterns,
> self-check, convergence behavior, narrow out-of-scope categories).

## Arguments

`$ARGUMENTS` is the citekey.

## Pipeline

- **3e — References itemization** via `format_references_section.py`.
  Phase 1.3 fixed the shift-by-one bug and added the paragraph-separated
  fast path + sanity-check abort. Phase 2.1 adds style flags:
  - `--style=siggraph` for all-caps author Chicago.
  - `--style=author-year-paren` for humanities theses.
  - `--same-author-mode` for year-only continuation entries.
  - `--diagnostic` for parser-coverage stats.
  - Fallback to `itemize_jammed_references.py` (Phase 2.1) when the
    primary parser yields <5% of expected entries.
  - Fallback to `itemize_book_bibliography.py` (Phase 2.1) for fully
    run-on book bibliographies.
- **3e' — Index itemization** via `itemize_index.py` (Phase 2.1).
- **3e'' — Illustrations list** via `format_illustrations_list.py`
  (Phase 2.1) for art-history books.
- **3f — `references.bib` emission**. After itemization,
  `populate_references_bib_from_itemize.py` (Phase 2.1) extracts each
  `\item` and emits a bibtex entry with the citekey rule.
- **3g — Citation rewriting** via `rewrite_citations.py` with the
  extended style table (Phase 2.1):
  - `chicago`, `apa`, `bracket-key`, `bracket-numeric`,
    `bracket-author-year`, `author-year-paren`, `bracket-locator`,
    plus alphabetic year-suffix support, fused-surname tokenizer,
    lowercase-particle longest-suffix match, multi-author surname
    matching, possessive citations, expanded SKIP_CONTEXTS and
    year-range guard.
  - `fuzzy_citekey_disambiguate.py` (Phase 2.1) breaks ties on
    same-surname-same-year-same-titleword collisions.

## Synthesis (sources gap)

When the source PDF's bibliography is truncated or incomplete, instead
of emitting many `missing-bib-entry:` warnings, **synthesize**
canonical entries from external reference data for well-known cited
works. Mark with `% synthesized` comment in `references.bib` and a
short `\noindent\textit{Note: …}` disclaimer in the body's
Bibliography section.
