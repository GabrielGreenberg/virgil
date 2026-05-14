---
description: Deep-index prose cleanup (Step 3a/3b/3c) — title/header cleanup, heading hierarchy, drop caps, pgmark alignment basics. Phase 3 of the deep-index split.
arguments: <citekey>
---

# Deep-index prose cleanup

> **Status: Phase 1 stub.** Content will be migrated from
> [deep-index.md](deep-index.md) §3a / §3b / §3c during Phase 3 of the
> [deep-index improvement plan](../../.claude/plans/ok-i-ve-been-running-unified-sunrise.md).
> Until then, run `/library/deep-index` directly.

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope, anti-patterns,
> self-check, convergence behavior, narrow out-of-scope categories).

## Arguments

`$ARGUMENTS` is the citekey.

## Scope

- **Step 3a** — `\title{}` / `\author{}` / `\date{}` cleanup; filename-shaped title repair; drop-cap recovery; content/metadata-mismatch policy (delegate to `di-preflight` if not yet resolved).
- **Step 3b** — heading hierarchy. OCR-garbage demotion via `detect_misclassified_headings.py` and `detect_garbage_headings.py` / `detect_diagram_book_garbage_headings.py` (Phase 2.4). Inline section-label promotion via `promote_inline_section_labels.py` (Phase 2.4) for LSA / Wiley / JoP venues. Lost-subsection promotion via `promote_lost_subsections.py` (Phase 2.1) for OCR-spaced headings.
- **Step 3c** — pgmark alignment basics. Recovery of missing pgmarks via `recover_missing_pgmarks.py` (with the multi-pattern offset detector from Phase 2.3). Mid-word page-break recovery via `recover_mid_word_breaks.py` (Phase 2.3). Italic-numeral fixup via `fix_italic_numerals.py` (Phase 2.3). Roman-numeral OCR-garble fixup via `fix_roman_pgmarks.py` (Phase 2.3).
