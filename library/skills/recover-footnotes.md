---
description: Footnote recovery — full tier ladder (Tier 0 → Tier 4) including endnote-style sub-tiers.
arguments: <citekey>
---

# Footnote recovery

> Shared doctrine: read [_doctrine.md](_doctrine.md). Tier 4
> (orphan-prefix attachment) always succeeds where a preceding body
> paragraph exists; deferring footnote recovery is almost always a
> doctrine violation.

Operates on `papers/$ARGUMENTS/main.tex`. The canonical narrative is
[deep-index.md](deep-index.md) §3d; this stub documents the
script-invocation order and the tier ladder.

## Tier 0 — In-file leaked-prose scan

Pre-pass to normalize OCR no-separator and glued-multi-footnote
patterns:

```bash
python3 .virgil/scripts/split_leaked_footnotes.py papers/$ARGUMENTS/main.tex
```

Standard reattacher (now with bibliography-section / citation-arg /
pgmark-preservation / TOC-skip guards + automatic Tier-4 fallback):

```bash
python3 .virgil/scripts/reattach_leaked_footnotes.py papers/$ARGUMENTS/main.tex
```

Unicode-superscript-prefixed leaks (modern OUP/Cambridge/Springer):

```bash
python3 .virgil/scripts/reattach_super_footnotes.py papers/$ARGUMENTS/main.tex
```

## Tier 0.5 — Endnote-style branches

Per-chapter Notes blocks (single-chapter papers):

```bash
python3 .virgil/scripts/reattach_chapter_end_notes.py $ARGUMENTS
```

End-of-book Notes with `\subsection{Chapter N}` sub-dividers:

```bash
python3 .virgil/scripts/reattach_unified_chapter_notes.py $ARGUMENTS
```

End-of-document Notes with no per-chapter dividers:

```bash
python3 .virgil/scripts/reattach_document_end_notes.py $ARGUMENTS
```

Popular-science page+hint endnotes (`<page>\t<hint>: <citation>`):

```bash
python3 .virgil/scripts/reattach_page_hint_endnotes.py papers/$ARGUMENTS/main.tex
```

## Tier 1 — PDF re-extraction

```bash
python3 .virgil/scripts/extract_pdf_footnotes.py papers/$ARGUMENTS
python3 .virgil/scripts/reattach_footnotes.py papers/$ARGUMENTS
```

## Tier 2 — Fresh OCR on individual pages

Skip silently if `ocrmypdf` is unavailable; otherwise re-OCR the
specific pages where the body extraction was garbled.

## Tier 3 — Rasterize and read visually

Use PyMuPDF to rasterize a page to PNG and read it with the visual
tool. `recover_orphan_footnotes.py` does this in batch.

## Tier 3.5 — PDF call-site recovery

For `[orphan fn N]`-tagged notes from prior passes:

```bash
python3 .virgil/scripts/resolve_orphan_footnotes.py $ARGUMENTS
```

6-pattern matcher (`.N` / `<word>N` / `,N` / ` N` / `<close-punct>N`
/ `<digit>, N`) with citekey-derived snippet fallback. Processes
orphans in reverse document order so earlier ones' offsets stay
valid.

## Tier 3.7 — Semantic relocation

For orphans whose body has a distinctive term that appears exactly
once in the enclosing chapter:

```bash
python3 .virgil/scripts/relocate_orphan_footnotes.py $ARGUMENTS
```

## Tier 4 — Orphan-prefix attachment (always succeeds)

Now automatic inside `reattach_leaked_footnotes.py`. When no call
site is found, the footnote attaches to the nearest preceding body
paragraph with a `[orphan fn N]` prefix. **This is strictly better
than leaving a numbered paragraph unattached.**

## Truncated-footnote recovery

For footnotes ending mid-sentence (the body continuation got
dropped at the page boundary):

```bash
python3 .virgil/scripts/recover_truncated_footnote.py $ARGUMENTS --apply
```

## Post-recovery cleanup (always run, idempotent)

Strip over-escapes inside footnote bodies:

```bash
python3 .virgil/scripts/unescape_footnote_bodies.py papers/$ARGUMENTS/main.tex
```

Lift any `\footnote{}` that landed inside `\cite{}` brace args:

```bash
python3 .virgil/scripts/fix_footnote_in_citation_args.py papers/$ARGUMENTS/main.tex
```

Pull `\pgmark{}` literals out of footnote bodies (otherwise the
renderer silently swallows them):

```bash
python3 .virgil/scripts/fix_pgmark_in_footnotes.py papers/$ARGUMENTS/main.tex
```
