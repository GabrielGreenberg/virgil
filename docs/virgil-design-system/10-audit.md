<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** Part of the frozen April-2026 design-system
> migration record. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this file and the code
> disagree, the code is right and this file is history. Start at
> [README.md](README.md).

# 10 — Audit

> **This is not a worklist any more.** It *was* the worklist for
> `MIGRATION.md` in April 2026; the migration ran. Every item below now
> carries a **Status** line verified against the code on 2026-08-09. Eight
> landed outright, three landed as a primitive whose consumer sweep is
> incomplete, one was superseded by a different design — and **two of the
> three items marked "deferred" have since been decided and built**.
>
> Read the Status line before acting on any item. The body under it describes
> April 2026, not today.

Twelve concrete drifts in the code *as of April 2026*, each with a fix
sentence. Items are in **no specific order** — `MIGRATION.md` grouped them by
pass.

## 1. `CARD_SELECTED` (amber default) still exists

> **Status — LANDED (verified 2026-08-09).** `CARD_SELECTED*` and `panelCard()` are gone (deee7dfa). `src/components/panel-primitives.tsx:399/:418` expose `themedCard(theme, selected, extra)` + `themedCardStyle` reading `theme.borderSelected`; a theme is required on every card consumer.

`src/components/panel-primitives.tsx` defines
`CARD_SELECTED = "bg-surface border-amber-300 shadow-sm"` plus four
themed siblings (`CARD_SELECTED_FOOTNOTE`, `_NOTE`, `_TODO`, `_CUT`).
Every card kind has a theme; the amber default is never the right
answer.

**Fix.** Delete `CARD_SELECTED`. Require every consumer of `panelCard()`
to pass a theme. Replace the four themed siblings with a single helper
`themedCard(theme, selected, extra)` that reads `theme.borderSelected`.

## 2. Hover backgrounds spelled six ways

> **Status — LANDED (verified 2026-08-09).** `.hover-on-light` / `.hover-on-dark` ship at `src/app/globals.css:530-567`, 86 uses across 38 files. Zero raw `hover:bg-stone-*` remain; 2 `hover:bg-amber-*` survive as a deliberate status tint in `BibEntryCard.tsx`. No CI guard.

`hover:bg-stone-50/50`, `hover:bg-stone-100`, `hover:bg-stone-100/70`,
`hover:bg-stone-200/50`, `hover:bg-amber-50`, plus inline-styled hovers
in custom components.

**Fix.** Define `hover-on-light` and `hover-on-dark` utility classes in
`globals.css`. Sweep panel headers, top bar, menu rows. See
`04-interaction.md`.

## 3. Card-header tints use opacity hacks

> **Status — LANDED (verified 2026-08-09).** Header tints are solid hexes derived by `deriveCardPalette` (`src/lib/panel-theme.ts:191-206`, `blendOverWhite`), and `CARD_THEMES` is now a mechanical fold over `DEFAULT_PANEL_COLORS` (`panel-primitives.tsx:460`). No opacity literal remains on any card header.

`bg-red-100/60`, `bg-emerald-100/50`, `bg-[#fdf8e1]/80`, `bg-[#fef3c3]/40`,
`bg-stone-100/70` etc. throughout `CARD_THEMES` in
`panel-primitives.tsx`. Inconsistent opacities (40, 50, 60, 70, 80) for
the same role.

**Fix.** Pre-mix every header tint to a solid hex. Store
`headerDefault` and `headerSelected` as hex strings on the theme,
computed from `accent` via `deriveCardPalette` in `panel-theme.ts`.

## 4. Theme shape is overgrown

> **Status — LANDED (verified 2026-08-09).** 9c63fc49. A row is still nine members, but eight are DERIVED from one authored `accent` hex (`themeFromAccent`, `src/lib/panel-theme.ts:226`), and the `override` sub-palette plus its three appliers are deleted.

`CARD_THEMES` rows have nine fields each, mixing Tailwind classnames,
hex strings, and an optional `override` palette for user-color-picked
panels.

**Fix.** Collapse to five fields: `accent`, `borderSelected`,
`headerDefault`, `headerSelected`, `separatorSelected`. All other
values (`badgeBg`, `badgeColor`, `badgeBorder`, `titleColor`) derive
from `accent` via `deriveCardPalette`. The `override` system disappears
— a user-picked color *replaces* `accent` and the rest re-derives.

## 5. Icon buttons are hand-rolled

> **Status — PARTIAL (verified 2026-08-09).** `.iconbtn-xs/-sm/-md/-lg` (+ danger / on-dark / toggle / accent variants) ship at `src/app/globals.css:575-627`, but only ~23 call sites adopted them; ~37 icon-only buttons in `src/` are still hand-rolled, two of them inside `panel-primitives.tsx` itself. No CI guard. **Before reporting one as drift, check the out-of-scope list now in `src/STYLE_GUIDE.md` (Spacing & icons).**

Eight different icon-button implementations across panel headers,
top bar, card chrome, modal headers, etc. Each differs in hit area
(20–32px), padding, hover bg, and focus ring.

**Fix.** Add `iconbtn-sm`, `iconbtn-md`, `iconbtn-lg` utility classes
in `globals.css`. Use them everywhere. See
`03-spacing-and-icons.md`.

## 6. Buttons have no variant system

> **Status — PARTIAL (verified 2026-08-09).** `<Button>` ships with exactly primary/secondary/warm/danger/ghost × sm/md/lg (`panel-primitives.tsx:1568-1612`) and zero `bg-blue-100`/`bg-emerald-100` action buttons survive — but only 11 files use it and ~6 token-based hand-rolled action buttons remain. No CI guard.

`bg-blue-100 text-blue-800` for "apply"; `bg-emerald-100 text-emerald-800`
for "accept"; `bg-stone-200 text-stone-800` for "cancel"; raw
`<button>` with arbitrary classes elsewhere.

**Fix.** Add `<Button variant size>` to `panel-primitives.tsx`.
Variants: `primary`, `secondary`, `warm`, `danger`, `ghost`. Sizes:
`sm`, `md`, `lg`. See `07-buttons-and-inputs.md`. Sweep `bg-blue-`,
`bg-emerald-`, `bg-red-` in `src/panels` and `src/components` —
replace with `<Button>`.

## 7. `text-stone-*` and `border-stone-*` everywhere

> **Status — LANDED (verified 2026-08-09).** `src/` has zero `text-`/`border-`/`bg-stone-*`. The ink/edge/surface utilities are real Tailwind colors (`globals.css:472` `@theme`) and dominate (495/154/58 uses). One straggler: `ring-stone-500` in `PanelThemePicker.tsx:85`.

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

> **Status — LANDED for the STYLESHEET, one residual (verified 2026-08-12, task 2026-07-20-195).** The consumer sweep ran. `globals.css` now holds **zero** raw reds in a rule body, and the count was wrong in two directions: there was a **sixth** hex (`#fff5f5`, the footnote/RTF drop-target wash — folded onto `--footnote-50`), and the family reached well past footnotes.
>
> Two surfaces this item never named were painting the same reds with no token at all — the **figure** chrome (`#cc0000` error text, `#b8261a` chrome-danger hover, `#b45757` conflict/warning/delete-hover) and its **verbatim twin**, the *heading* label lozenge, whose four rules are byte-identical to the figure ones. `.math-error` was a third `#cc0000`. And this item never mentioned `--danger`, which had existed the whole time and served the panel/card chrome one directory over.
>
> The resolution generalized rather than aliasing: `--danger` grew a **role family** (`--danger-soft` / `--danger-muted` / `--danger-strong`, `src/STYLE_GUIDE.md` → *The destructive / alarm family*) whose two coincident rungs ALIAS `--footnote-50` / `--footnote-500` instead of restating them — codifying exactly the relationship this item calls implicit, so the footnote reds and the destructive reds now converge on one scale as the fix note below hoped. `#cc0000` and `#b8261a` merged into one rung on a contrast argument (adopting the light `--danger` for error text would have dropped it to 3.25:1, under AA). CI: `src/__tests__/destructive-red-tokens.test.ts`, keyed on hue rather than on a list of literals.
>
> **Residual:** `--par-title-color: #c45a5a` still sits outside the scale, deliberately — it is the paragraph-title *concept* colour rather than an alarm, so folding it in is a visual decision, not a sweep. The Outline panel's two borrowed `#b45757` spellings are scoped by queued task **2026-08-02-284** and allowlisted with that pointer.

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

> **Status — SUPERSEDED (verified 2026-08-09).** The pseudo-element swoop + filter chain is gone (tombstone at `globals.css:4437`; `--shadow-ambient-filter` now has zero consumers, and no `TabBar` exists). It was not flattened — it was rebuilt as the CI-pinned `FolderTabChrome` geometry SSOT (`folder-tab-geometry.ts:69`). See `src/STYLE_GUIDE.md` → *Folder tabs*.

The `<TabBar>` active-tab swoop pseudo-element is cute but visually
loud and uses a complex SVG-outline + filter-shadow chain
(`--shadow-ambient-filter`).

**Fix (deferred).** Test side-by-side with a flat-tab version. Not
part of this migration; flagged here so it's tracked.

## 10. Selection ring on inline atoms is amber-hardcoded

> **Status — LANDED (verified 2026-08-09).** 46dfc5a9, and since superseded upward: no amber rgba literal remains in `src/` or `library/`. `globals.css:3078-3093` paints the atom selection ring from the per-kind `--link-anchor-color` (footnotes) and the `--amber-highlight-*` role tokens (citations) — not `--ring-drag-target`.

`.footnote-marker[data-card-selected="true"]` and
`[data-type="citation"][data-card-selected="true"]` both use
`box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.9)` — the amber
literally repeated.

**Fix.** Replace with `box-shadow: 0 0 0 2px var(--ring-drag-target)`.
This is the one place where amber-as-default is correct (see
`09-editor-and-marginalia.md`), but it should reference the token, not
the literal.

## 11. 6-dot vs 3-line drag handle distinction

> **Status — RESOLVED (verified 2026-08-09).** Deferred here, but decided since — via option (b), drop text-only. `ec38210` deleted the card text-drag grip from `panel-primitives.tsx`, leaving only the 6-dot grip. `MIME_TEXT_INSERT` survives with zero producers.

Two visually-similar handles do near-identical things (drag entity vs
drag text-only). Documented in `STYLE_GUIDE.md` but a usability risk.

**Fix (deferred).** Either collapse to one handle with a shift-modifier
for text-only, or drop text-only entirely. Not in this migration; track
for follow-up.

## 12. Marginalia gutter has no overflow design

> **Status — RESOLVED (verified 2026-08-09).** Deferred here, but built since (2026-06-10, chip-A6/R16): the marginalia grid reserves its last cell for a `+K` overflow pill whose popover lists the hidden markers as fully functional marker buttons — `src/lib/marginalia-grid.ts:155-187` + `src/components/Marginalia.tsx:338-420`.

The 2-column grid handles a few markers per paragraph. A heavily-
reviewed paragraph (12+ markers) overflows or collides with the next
paragraph's row.

**Fix (deferred).** Design a `+N` overflow chip that opens a popover
listing the overflow markers. Not in this migration; track for
follow-up.

---

## Summary

| # | Drift | In migration? | **Status 2026-08-09** |
|---|---|---|---|
| 1 | `CARD_SELECTED` amber default | yes (Pass 2) | landed |
| 2 | Hover bg spelled six ways | yes (Pass 3) | landed |
| 3 | Card-header opacity hacks | yes (Pass 6) | landed |
| 4 | Theme shape overgrown | yes (Pass 6) | landed |
| 5 | Icon buttons hand-rolled | yes (Pass 4) | **partial** — primitive shipped, ~37 sites unswept |
| 6 | No button variant system | yes (Pass 5) | **partial** — primitive shipped, ~6 sites unswept |
| 7 | `text-stone-*` everywhere | yes (Pass 7) | landed (1 straggler) |
| 8 | Footnote rust as 5 hexes | yes (Pass 1) | **partial** — scale shipped, consumers unswept |
| 9 | Active-tab swoop noise | deferred | superseded by `FolderTabChrome` |
| 10 | Amber selection ring hardcoded | yes (Pass 1) | landed, then superseded upward |
| 11 | 6-dot vs 3-line drag handles | deferred | **decided** — text-only dropped |
| 12 | Marginalia overflow design | deferred | **built** — `+K` overflow pill |

Nine items rolled into the migration; three were deferred as design
decisions. All three deferred questions have since been answered — two by
building the thing, one by rebuilding the surface entirely.

The three **partials** are the only live residue in this file, and they share
one shape: *the primitive landed and the consumer sweep didn't.* None of them
has a CI guard, which is why they drifted quietly. If you pick one up, file it
as its own task — and read `src/STYLE_GUIDE.md` first, because the surfaces
that are hand-rolled **by design** are enumerated there now (they are not part
of the remaining sweep).
