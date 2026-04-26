# 10 — Audit

Twelve concrete drifts in the current code, each with a fix sentence.
This is the worklist for `MIGRATION.md`. Items are in **no specific
order** — `MIGRATION.md` groups them by pass.

## 1. `CARD_SELECTED` (amber default) still exists

`src/components/panel-primitives.tsx` defines
`CARD_SELECTED = "bg-surface border-amber-300 shadow-sm"` plus four
themed siblings (`CARD_SELECTED_FOOTNOTE`, `_NOTE`, `_TODO`, `_CUT`).
Every card kind has a theme; the amber default is never the right
answer.

**Fix.** Delete `CARD_SELECTED`. Require every consumer of `panelCard()`
to pass a theme. Replace the four themed siblings with a single helper
`themedCard(theme, selected, extra)` that reads `theme.borderSelected`.

## 2. Hover backgrounds spelled six ways

`hover:bg-stone-50/50`, `hover:bg-stone-100`, `hover:bg-stone-100/70`,
`hover:bg-stone-200/50`, `hover:bg-amber-50`, plus inline-styled hovers
in custom components.

**Fix.** Define `hover-on-light` and `hover-on-dark` utility classes in
`globals.css`. Sweep panel headers, top bar, menu rows. See
`04-interaction.md`.

## 3. Card-header tints use opacity hacks

`bg-red-100/60`, `bg-emerald-100/50`, `bg-[#fdf8e1]/80`, `bg-[#fef3c3]/40`,
`bg-stone-100/70` etc. throughout `CARD_THEMES` in
`panel-primitives.tsx`. Inconsistent opacities (40, 50, 60, 70, 80) for
the same role.

**Fix.** Pre-mix every header tint to a solid hex. Store
`headerDefault` and `headerSelected` as hex strings on the theme,
computed from `accent` via `deriveCardPalette` in `panel-theme.ts`.

## 4. Theme shape is overgrown

`CARD_THEMES` rows have nine fields each, mixing Tailwind classnames,
hex strings, and an optional `override` palette for user-color-picked
panels.

**Fix.** Collapse to five fields: `accent`, `borderSelected`,
`headerDefault`, `headerSelected`, `separatorSelected`. All other
values (`badgeBg`, `badgeColor`, `badgeBorder`, `titleColor`) derive
from `accent` via `deriveCardPalette`. The `override` system disappears
— a user-picked color *replaces* `accent` and the rest re-derives.

## 5. Icon buttons are hand-rolled

Eight different icon-button implementations across panel headers,
top bar, card chrome, modal headers, etc. Each differs in hit area
(20–32px), padding, hover bg, and focus ring.

**Fix.** Add `iconbtn-sm`, `iconbtn-md`, `iconbtn-lg` utility classes
in `globals.css`. Use them everywhere. See
`03-spacing-and-icons.md`.

## 6. Buttons have no variant system

`bg-blue-100 text-blue-800` for "apply"; `bg-emerald-100 text-emerald-800`
for "accept"; `bg-stone-200 text-stone-800` for "cancel"; raw
`<button>` with arbitrary classes elsewhere.

**Fix.** Add `<Button variant size>` to `panel-primitives.tsx`.
Variants: `primary`, `secondary`, `warm`, `danger`, `ghost`. Sizes:
`sm`, `md`, `lg`. See `07-buttons-and-inputs.md`. Sweep `bg-blue-`,
`bg-emerald-`, `bg-red-` in `src/panels` and `src/components` —
replace with `<Button>`.

## 7. `text-stone-*` and `border-stone-*` everywhere

The `--ink-*` and `--edge-*` token scales were added in the last pass,
but ~200 sites still use raw `text-stone-500`, `border-stone-300`, etc.

**Fix.** Codemod (mechanical):
- `text-stone-300` → `text-ink-faint`
- `text-stone-400` → `text-ink-muted`
- `text-stone-500` → `text-ink-subtle`
- `text-stone-700` → `text-ink-body`
- `text-stone-800` → `text-ink-strong`
- `border-stone-200` → `border-edge-subtle`
- `border-stone-300` → `border-edge-hover`
- `border-stone-400` → `border-edge-strong`
- `bg-stone-50` → `bg-surface-muted`
- `bg-stone-100` → `bg-surface-muted-strong`

## 8. Footnote rust appears as 5 different hexes

`#b45757` in some places, `#c45a5a` in `--par-title-color`, `#fef2f2`
for bg, `#fde8e8` for one-off hover, `#fecaca` for selected. The
relationship between them is implicit, not codified.

**Fix.** Add a `--footnote-50/100/200/300/500` scale to
`globals.css`. Existing token names alias into the scale (e.g.
`--footnote-bg = var(--footnote-50)`). Hand-rolled hovers like
`#fde8e8` become `var(--footnote-100)`. Same treatment for the
warm-amber family (citation/bib/quote currently three different
golds).

## 9. Active-tab "swoop" creates visual noise

The `<TabBar>` active-tab swoop pseudo-element is cute but visually
loud and uses a complex SVG-outline + filter-shadow chain
(`--shadow-ambient-filter`).

**Fix (deferred).** Test side-by-side with a flat-tab version. Not
part of this migration; flagged here so it's tracked.

## 10. Selection ring on inline atoms is amber-hardcoded

`.footnote-marker[data-card-selected="true"]` and
`[data-type="citation"][data-card-selected="true"]` both use
`box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.9)` — the amber
literally repeated.

**Fix.** Replace with `box-shadow: 0 0 0 2px var(--ring-drag-target)`.
This is the one place where amber-as-default is correct (see
`09-editor-and-marginalia.md`), but it should reference the token, not
the literal.

## 11. 6-dot vs 3-line drag handle distinction

Two visually-similar handles do near-identical things (drag entity vs
drag text-only). Documented in `STYLE_GUIDE.md` but a usability risk.

**Fix (deferred).** Either collapse to one handle with a shift-modifier
for text-only, or drop text-only entirely. Not in this migration; track
for follow-up.

## 12. Marginalia gutter has no overflow design

The 2-column grid handles a few markers per paragraph. A heavily-
reviewed paragraph (12+ markers) overflows or collides with the next
paragraph's row.

**Fix (deferred).** Design a `+N` overflow chip that opens a popover
listing the overflow markers. Not in this migration; track for
follow-up.

---

## Summary

| # | Drift | In migration? |
|---|---|---|
| 1 | `CARD_SELECTED` amber default | yes (Pass 2) |
| 2 | Hover bg spelled six ways | yes (Pass 3) |
| 3 | Card-header opacity hacks | yes (Pass 6) |
| 4 | Theme shape overgrown | yes (Pass 6) |
| 5 | Icon buttons hand-rolled | yes (Pass 4) |
| 6 | No button variant system | yes (Pass 5) |
| 7 | `text-stone-*` everywhere | yes (Pass 7) |
| 8 | Footnote rust as 5 hexes | yes (Pass 1) |
| 9 | Active-tab swoop noise | deferred |
| 10 | Amber selection ring hardcoded | yes (Pass 1) |
| 11 | 6-dot vs 3-line drag handles | deferred |
| 12 | Marginalia overflow design | deferred |

Nine items roll in. Three deferred — they are real issues but require
design decisions, not just systematization.
