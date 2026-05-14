---
description: Pgmark validation + audit punch-list + outstanding-work classification (Step 3i + Step 9.5). Phase 3 of the deep-index split.
arguments: <citekey>
---

# Validate & audit

> **Status: Phase 1 stub.** Content will be migrated from
> [deep-index.md](deep-index.md) §3i and §9.5 during Phase 3 of the
> [deep-index improvement plan](../../.claude/plans/ok-i-ve-been-running-unified-sunrise.md).
> Until then, run `/library/deep-index` directly.

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope, anti-patterns,
> self-check, convergence behavior, narrow out-of-scope categories).

## Arguments

`$ARGUMENTS` is the citekey.

## Validation

- **`pgmark_validate.py`** (Phase 1.1 fixes applied):
  - `range-impossible` requires both `hi > pdf_pages × 1.5` AND
    `span > pdf_pages` — exempts journal-offset reprints.
  - Multi-section pagination (front-matter roman → body arabic →
    index arabic) yields `multi-section` informational findings,
    not `duplicate` blockers.
  - `range-suspiciously-wide` catches catastrophic offsets
    (`span > pdf_pages × 1.3`).
  - `--pdf-pages` / `--no-pdf-check` flags with `pdfinfo` auto-detect.

## Audit punch-list

- **`audit_deepindex.py`** (Phase 1.2 fixes applied):
  - `footnote-inline-rate` skips Contents/TOC, enumeration sequences,
    figure-context, zero-footnote documents.
  - Hyphen artifact regex excludes coordinated compounds (`pre- and
    post-test`).
  - Case-error check strips math spans and excludes math-identifier
    prefixes (`pos[A-Z]`, etc.).
  - New `unbalanced-brace` check for runaway `\footnote{` /
    `\section{` brace arguments.
  - New `missing-pgmark-range` check via `pdfinfo` sibling lookup.

## Outstanding-work classification

The orchestrator emits one of four narrow categories per the doctrine:
`source-missing`, `figure-reconstruction`, `user-judgment-required`,
or `validator-false-positive`. Walk the self-check checklist
(see `_doctrine.md`) before tagging.
