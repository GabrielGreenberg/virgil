---
description: Numbered examples / expex conversion, formal-semantics math, user note processing (Step 3.h). Phase 3 of the deep-index split.
arguments: <citekey>
---

# Examples & user notes

> **Status: Phase 1 stub.** Content will be migrated from
> [deep-index.md](deep-index.md) §3.h₁ / §3.h₂ during Phase 3 of the
> [deep-index improvement plan](../../.claude/plans/ok-i-ve-been-running-unified-sunrise.md).
> Until then, run `/library/deep-index` directly.

> Shared doctrine: read [_doctrine.md](_doctrine.md) (scope, anti-patterns,
> self-check, convergence behavior, narrow out-of-scope categories).

## Arguments

`$ARGUMENTS` is the citekey.

## Sub-steps

- **3.h₁ — User notes**. Process any `papers/<citekey>/virgil/notes.json`
  entries that ask for body edits.
- **3.h₂ — Numbered examples / expex conversion**.
  - For ≥50 numbered examples, batch via
    `bulk_convert_numbered_examples.py` (Phase 2.6) rather than
    per-example manual edits.
  - For formal-semantics papers (Davidson, Schlenker family,
    Lascarides), run `mathify_formal_semantics.py` (Phase 2.6) first
    to convert OCR-mangled lambda / existential / wedge / Heim-Kratzer
    bracket glyphs to canonical TeX math.
  - For high cross-reference density (Chomsky 1957's 120 examples
    with `see (29ii)` patterns) and heavy inline formal-semantics
    notation, bias toward NOT converting.
  - Wrap bare numbered prose into `\begin{enumerate}` envelopes when
    source shows `^1\. …` paragraph leaders (Annual Reviews
    SUMMARY POINTS / KEY POINTS / FUTURE ISSUES); do NOT convert
    existing `\begin{enumerate}` blocks to expex.
