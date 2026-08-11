<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** Part of the frozen April-2026 design-system
> migration record. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this file and the code
> disagree, the code is right and this file is history. Start at
> [README.md](README.md).

# 03 — Spacing & Icons

## Spacing grid

Everything is on a **4-pixel grid**. Tailwind's default spacing scale is
4px-based; use it. Don't introduce arbitrary `p-[5px]` or `gap-[7px]`
unless aligning to a non-grid asset (e.g. an icon's optical center).

| Token | Px | Use |
|---|---|---|
| `0.5` | 2 | nothing structural; only sub-pixel optical adjustments |
| `1` | 4 | tight chip padding, badge inset |
| `1.5` | 6 | icon-button corner inset |
| `2` | 8 | card body padding (small), gap between adjacent chips |
| `2.5` | 10 | `--pod-gap`; default gap between adjacent pods |
| `3` | 12 | card body padding (default), panel section gap |
| `4` | 16 | section spacing inside pods |
| `6` | 24 | section spacing across pods |
| `8` | 32 | major layout breaks |

`--pod-gap: 10px` is locked as the canonical "between two pods" value.
Don't override it.

## Pod radii

```
--pod-radius: 8px        all pods, panels, modals
rounded-md   6px          cards, sub-pods, popovers
rounded      4px          chips, badges, small buttons (default Tailwind)
rounded-sm   2px          inline atoms (footnote marker, citation, mark highlight)
rounded-full             pill chips (panel-tab, AI star marker)
```

The progression `8 → 6 → 4 → 2` is intentional: bigger surfaces have
bigger radii, smaller surfaces have smaller radii. Inverting this looks
wrong even when you can't say why.

## Shadow scale

```
--pod-shadow:           main editor pod, modals, popovers (3+ levels of context)
--card-shadow-ambient:  omni-view floating cards on the canvas
none:                   docked cards, inline chips, sub-pods
```
<!-- token-doc-allow -->

> ⚠️ **This table used to list a third tier, `--pod-shadow-light` ("side
> panels, secondary pods"), which was never added to `globals.css`.** It was
> proposed in the (now removed) `patches/globals.css.patch.md` and the patch
> never landed, so a rule reading `var(--pod-shadow-light)` with no fallback
> resolved to nothing. `library/styles/library.css` consumed it *with* a
> fallback, which is why the omission was invisible for a year — the fallback
> was the real value and the var was decoration. Task 170 retired that read
> and added a CI census (`src/__tests__/phantom-css-var.test.ts`) over every
> `var()` in the app. The shipped scale is two levels, not three.

Shadows in this system are **levels, not directions**. There's no
shadow-up vs shadow-down; everything sits on a notional sheet of paper.

## Icons

### Three sizes — that's it

| Class | Px | Use |
|---|---|---|
| `iconbtn-sm` | 20×20 | inline editor toolbar, dense menu rows |
| `iconbtn-md` | 24×24 | panel headers, top-bar admin, default |
| `iconbtn-lg` | 32×32 | omni-view primary actions, panel-strip toggles |

Each class locks: hit area, padding, hover background
(`hover:bg-surface-muted-strong`), focus ring (`focus-visible:ring-2
ring-edge-strong`), and corner radius. **Don't hand-roll.**

The visual icon inside is always smaller than the hit area:
`14px` glyph in `20px` button, `16px` glyph in `24px` button, `20px`
glyph in `32px` button. The whitespace is the click target.

### Icon style

- **Stroke-only.** No filled icons except the three semantic types
  below.
- **Stroke width 2.** Never 1.5, never 2.5.
- **Stroke linecap round, linejoin round.** Don't change.
- **Single color.** Inherit `currentColor` from the button.
- **24px viewBox** for medium and small; **24px viewBox** for large too.
  The button changes; the SVG doesn't.

### Filled-icon exceptions

Three icons are filled, by design:

1. **AI star** (`★`) — denotes AI-touched surfaces. Always sky blue
   (`#0ea5e9`).
2. **Trash** (delete) — outline plus filled lid handle. Always red
   (`text-danger`).
3. **Heading-fold chevron** — solid triangle, picks up `--footnote-color`
   when folded.

No other filled icons. If you're tempted, use a stroke variant.

### Marginalia gutter icons

Marginalia icons are 16×16, drawn via the components in
`src/components/editor-layout/panel-icons.tsx`. The icon itself is
neutral (stroke-only); color comes from `MARKER_META[type].color` /
`MARGIN_ICON_SIZE`. Don't pass `color` directly — let the panel-theme
machinery do it.

## Hit-area floor

- Buttons: **24×24 minimum.**
- Inline editor handles (drag grip, fold chevron): **12×12 visual,
  20×20 hit area** via padding.
- Card-trash button: **16×16 visual, 24×24 hit area.**

If a control is harder to hit than to see, you have it backwards.
