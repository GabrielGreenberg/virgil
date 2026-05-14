---
description: Footnote recovery — full tier ladder (Tier 0 → Tier 4) including endnote-style sub-tiers. Phase 3 of the deep-index split.
arguments: <citekey>
---

# Footnote recovery

> **Status: Phase 1 stub.** Content will be migrated from
> [deep-index.md](deep-index.md) §3d during Phase 3 of the
> [deep-index improvement plan](../../.claude/plans/ok-i-ve-been-running-unified-sunrise.md).
> Until then, run `/library/deep-index` directly.

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope, anti-patterns,
> self-check, convergence behavior, narrow out-of-scope categories).

## Arguments

`$ARGUMENTS` is the citekey.

## Tier ladder

- **Tier 0** — in-file leaked-prose scan via
  `reattach_leaked_footnotes.py` with all four guards (bibliography-section,
  citation-argument, pgmark-preservation, TOC-skip) plus the
  automatic Tier-4 fallback. Pair with `split_leaked_footnotes.py`
  pre-pass (Phase 2.2) for OCR no-space patterns and glued
  multi-footnote paragraphs.
- **Tier 0.3** — `reattach_super_footnotes.py` (Phase 2.2) for
  Unicode-superscript-prefixed leaks (modern OUP/Cambridge/Springer).
- **Tier 0.5** — endnote-style branches:
  - `reattach_page_hint_endnotes.py` (Phase 2.2) for popular-science
    page+hint format.
  - `reattach_unified_chapter_notes.py` (Phase 2.2) for end-of-book
    Notes with `\subsection{Chapter N}` sub-dividers.
  - `reattach_document_end_notes.py` (Phase 2.2) for end-of-document
    Notes with no per-chapter dividers.
  - `reattach_chapter_end_notes.py` (existing) for per-chapter notes.
- **Tier 1** — PDF re-extraction via
  `extract_pdf_footnotes.py` + `reattach_footnotes.py`.
- **Tier 2** — fresh OCR via `ocrmypdf` on individual pages.
- **Tier 3** — rasterize page to PNG via PyMuPDF and read visually;
  `recover_orphan_footnotes.py` for batch.
- **Tier 3.5** — PDF call-site recovery via `resolve_orphan_footnotes.py`
  (Phase 2.2), the 6-pattern matcher with citekey-derived snippet
  fallback.
- **Tier 3.7** — semantic relocation via `relocate_orphan_footnotes.py`
  (Phase 2.2), term-extraction + per-chapter scope.
- **Tier 4 (always succeeds)** — orphan-prefix attachment to the
  nearest preceding body paragraph. This is now automatic inside
  `reattach_leaked_footnotes.py` and is also available as a
  fallback inside the resolve/relocate scripts.

## Post-recovery cleanup

- `unescape_footnote_bodies.py` (Phase 2.2) — strip over-escapes
  inside `\footnote{}` bodies. Idempotent, runs every pass.
- `fix_footnote_in_citation_args.py` (Phase 2.2) — detect any
  `\footnote{}` that landed inside a `\cite{}` brace arg and extract.
- `fix_pgmark_in_footnotes.py` (Phase 2.2) — when a footnote body
  contains a `\pgmark{N}`, pull it out and re-place at body scope.
