<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** Part of the frozen April-2026 design-system
> migration record. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this file and the code
> disagree, the code is right and this file is history. Start at
> [README.md](README.md).

# 00 — Overview

## What this is

A systematization pass over Virgil's existing UI. The visual identity is
already strong: warm cream paper, brown accent, serif body, eleven
panel-themed card colors, anchored marginalia. Nothing about that
identity is changing.

What is changing: the **internal consistency** of how that identity is
expressed in code. Today, the same idea is implemented several different
ways across the codebase. After this pass, each idea has exactly one
implementation.

## What's broken (the short version)

Twelve concrete drifts, listed in `10-audit.md`. The four that matter
most:

1. **Selection has two implementations.** A generic amber `CARD_SELECTED`
   class still exists, even though every card kind has a themed
   selection color. The amber default is never the right answer; it
   should be deleted.
2. **Hover has six implementations.** `hover:bg-stone-50/50`,
   `hover:bg-stone-100`, `hover:bg-stone-100/70`, etc. Two utility
   classes (`hover-on-light`, `hover-on-dark`) cover every real case.
3. **Card-header tints are computed five different ways.** Tailwind
   classes with `/40` `/50` `/60` `/70` `/80` opacity hacks, plus
   per-color overrides via inline style, plus arbitrary values like
   `bg-[#fdf8e1]/80`. Pre-mix to solid hexes; store one value per slot.
4. **Icon buttons are hand-rolled in eight places.** Each one differs
   in hit area, hover background, and focus ring. Three locked sizes
   (`iconbtn-sm/md/lg`) covers everything.

## What's right (and stays)

- Token names are mostly good. The `--ink-*`, `--edge-*`, `--surface-*`
  scales added in the last pass are kept and extended.
- `MARKER_META` and `CARD_THEMES` as registries are correct. Their
  *shape* needs simplification (five tokens per theme, not nine), but
  the registry pattern is the right architecture.
- The serif-on-cream paper, the pod-with-ambient-shadow surfaces, the
  panel-strip + omni layout — all correct, all unchanged.

## Mental model

Three layers, top to bottom:

```
┌───────────────────────────────────────────────┐
│  Consumers (panels, modals, editor surfaces)  │  ← never hard-code colors
├───────────────────────────────────────────────┤
│  Primitives (PanelCard, Button, IconBtn, …)   │  ← read theme + token
├───────────────────────────────────────────────┤
│  Tokens (globals.css :root)                   │  ← single source of truth
└───────────────────────────────────────────────┘
```

A consumer that reaches around a primitive to set a color directly is a
bug. The fix is to extend the primitive, not to special-case the
consumer.

## What to read next

`01-tokens.md` for the foundation, then `05-cards-and-themes.md` for the
biggest single shape change (theme = 5 tokens, not 9). Then
`MIGRATION.md` to see how this rolls in.
