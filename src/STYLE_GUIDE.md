# Virgil Style Guide

> Drop-in replacement for `src/STYLE_GUIDE.md`. This file is the
> in-repo summary of the design system. The full reference lives in
> `docs/virgil-design-system/`.

## Visual identity

Virgil is a writing tool that reads like paper. The canvas is a warm
cream (`--background: #f8f3ed`); the text is set in a serif
(`--font-serif`); the chrome around it is sans (`--font-sans`); the
brand accent is a warm brown (`--accent: #7c5e3c`). Pods sit on the
canvas as raised paper surfaces with a subtle shadow.

When in doubt, ask: *would this look right printed?* If the answer is
no, it's not Virgil.

## Three layers

Every visual decision lives in exactly one place.

```
Consumers (panels, modals, editor)
   │ never hard-code colors
Primitives (PanelCard, Button, IconBtn, …)
   │ read theme + token
Tokens (globals.css :root)
   │ single source of truth
```

A consumer that reaches around a primitive to set a color is a bug.
The fix is to extend the primitive.

## Tokens

All colors, sizes, and shadows live in `src/app/globals.css` under
`:root`. Use Tailwind utilities (`bg-surface`, `text-ink-muted`,
`border-edge-subtle`) or `var(--token)` in inline `style`. Never use a
hex literal in `*.tsx`.

The token scales:

- **Ink** (text, light → dark): `ink-faint`, `ink-muted`, `ink-subtle`,
  `ink-body`, `ink-strong`. Plus `--foreground` for editor body.
- **Edge** (borders): `edge-subtle`, `edge-hover`, `edge-strong`.
- **Surface** (backgrounds): `surface`, `surface-muted`,
  `surface-muted-strong`, plus the warmer `--pod-*` family.
- **Footnote rust** (footnote, cut, error): `--footnote-50/100/200/300/500`.
- **Warm amber** (citation, bib, quote): `--amber-50/100/200/500`.

Locked aliases (must track each other): `--theme-color`/`--topbar-bg`,
`--main-tab-bg`/`--background`, `--pod-editor`/`--surface`,
`--h1-color`/`--foreground`, `--h2h3-color`/`--editor-text-color`,
`--scrollbar-hover`/`--muted-light`.

Forbidden in new code: `text-stone-*`, `border-stone-*`,
`bg-stone-*-with-opacity`, hex literals in components, `bg-blue-*` /
`bg-emerald-*` / `bg-red-*` in panel chrome.

## Typography

| Family | Use |
|---|---|
| `--font-serif` | Editor body, headings, blockquote |
| `--font-sans` | App chrome, panels, marginalia |
| `--font-mono` | Code, math, LaTeX commands |

Each has an `*-override` companion the user can set. Always read the
override first: `var(--font-serif-override, var(--font-serif))`.

Editor scale: H1 1.75rem/700, H2 1.35rem/600, H3 1.15rem/600, body
1.05rem/400 with line-height 1.6. Panel scale: header 14px/600, body
13px/400, card title 12.5px/500, badge 10px/600.

Numerals tabular for any list of numbers. Italic only in blockquote and
the AI-marker label. No letter-spacing on body text.

## Spacing & icons

4-pixel grid. `--pod-gap: 10px` is the canonical pod-to-pod gap; don't
override.

Three icon-button sizes: `iconbtn-sm` (20×20), `iconbtn-md` (24×24,
default), `iconbtn-lg` (32×32). The visual SVG inside is smaller than
the button (14, 16, 20 respectively); the whitespace is the click
target.

Icons are stroke-only, stroke-width 2, round caps and joins, single
color (`currentColor`). Three exceptions are filled by design: the AI
star (sky `#0ea5e9`), the trash icon (`text-danger`), and the
heading-fold chevron (`--footnote-color` when folded).

Marginalia gutter icons are 16px, rendered via the components in
`src/components/editor-layout/panel-icons.tsx`.

## Interaction

Five states. One implementation each.

- **Hover.** Two utility classes: `hover-on-light` (resting bg is
  white-ish) and `hover-on-dark` (resting bg is a darker pod). Both
  transition background-color 120ms.
- **Selection.** Always themed. There is no default selection color.
  Each card kind reads its theme's `borderSelected` and
  `headerSelected`.
- **Focus.** `focus-visible:ring-2 ring-edge-strong` (offset 1).
  Inputs use a thicker border instead of a ring.
- **Active.** `translate-y-[0.5px]` on press.
- **Disabled.** `opacity-40 pointer-events-none`.

**Topbar buttons.** Every button in the 40px Virgil bar uses
`.topbarbtn` (add `.topbarbtn-icon` for icon-only). One height (24px),
uniform padding, the standard hover/press/focus/disabled states baked
in. Toggle/"on" state via `aria-pressed="true"` — the utility paints
the accent tint. Don't author bespoke padding, hover, or active
classes for topbar buttons; if you need a new visual state, extend
`.topbarbtn` so every sibling stays in sync.

## Cards & themes

A theme has five tokens: `accent`, `borderSelected`, `headerDefault`,
`headerSelected`, `separatorSelected`. All other values
(`badgeBg`, `titleColor`, etc.) derive from `accent` via
`themeFromAccent()` in `src/lib/panel-theme.ts`.

Eleven themes, four families:

- **Anchored-to-text (warm):** `footnote` (rust), `citation` (amber),
  `bib` (khaki), `quote` (warm-yellow).
- **Editorial (cool):** `comment`/`revision` (purple), `aiRequest`
  (sky).
- **Workflow (neutral):** `note` (green), `archive` (steel-blue),
  `todo` (stone), `cut` (rust).
- **Errors:** `error` (rust), `example` (teal — rare).

`cut`, `footnote`, and `error` share the rust accent — they're never
adjacent in the same surface, and the gutter icon distinguishes them.

A card renders via `<PanelCard theme={…} selected={…}>`. The frame
(border, header strip, separator, body, popout, trash) is identical
across themes; only the colors differ. **Every card has a theme.** A
card without a theme is a bug.

Selection: border flips to `theme.borderSelected`, header tint flips
from `headerDefault` to `headerSelected`, separator flips to
`theme.separatorSelected`, plus a soft `shadow-sm`. The body never
tints.

Hover (not selected): only the border changes (`edge-hover` →
`edge-strong`). The header and body don't react.

## Panels

Sidebar pod with a locked-height header (`--header-h: 34px`). Header
slots, in order: leading menu/swatch, title + count, after-title tool,
add button, AI button, extras, popout chevron. Order is fixed even
when slots are absent.

Panel pods use `bg-pod-panel`, `pod-border`, `pod-radius`,
`pod-shadow-light`. Don't add backdrops, glows, or gradients.

Body is a scrollable list with `space-y-2` between cards. No `border-b`
between cards.

Every panel has a designed empty state — icon, title sentence,
description, optional example card. "No items yet" is not enough.

The panel strip (vertical column of toggles) uses 32×32 icon buttons.
Active toggle: `bg-pod-dark/80 text-ink-strong`. The panel currently
focused gets a 2px accent stripe on its leading edge.

## Buttons

Five variants × three sizes via `<Button variant size>`:

- **primary** — `bg-accent` text white. At most one per surface.
- **secondary** — `bg-surface border-edge-hover`. The default.
- **warm** — `bg-accent-light text-accent`. The "Apply / Yes" affordance
  in suggestion flows.
- **danger** — `bg-danger-soft text-danger`.
- **ghost** — transparent. Cancel, skip, de-emphasized.

Sizes: `sm` 24px / 12px font, `md` 32px / 13px (default), `lg` 40px /
14px. All share `rounded-md` (6px).

Modal footers: rightmost is primary, then ghost cancel to its left,
destructive (if any) far left. Tab right + enter must not delete.

## Inputs

`bg-surface border-edge-subtle rounded-md` (6px). Focus thickens the
border to `edge-strong`; no ring on inputs. Placeholder is
`text-ink-muted`.

Card title input is borderless except a `border-bottom: 1px solid
theme.titleColor` on focus, transparent bg, sans 0.78rem weight 500.
Don't reuse this style.

Toggle: 22×14 pill, off `bg-edge-hover`, on `bg-accent`.
Checkbox: 16×16 box, off `border-edge-strong`, on `bg-accent`.

## Helper mode

Toggle via the "?" button on the Virgil bar → dropdown → "Helper mode".
When active, `document.body` gets `data-helper-mode="on"` and hovering any
element with a `data-helper` attribute shows a black callout with white text.

### Annotating a button

Add `data-helper="Label"` to the interactive element. Keep labels 1–3 words,
≤25 characters. Don't duplicate keyboard shortcuts (those belong in `title`).

```html
<button title="Bold (Cmd+B)" data-helper="Bold">…</button>
```

### Positioning

The callout appears **below center** by default. Override with zone selectors
or an explicit attribute:

| Zone | Callout position | Mechanism |
|---|---|---|
| Virgil bar / MenuBar / panel header | Below | Default |
| Left icon strip | Right of button | `[data-strip-side="left"]` ancestor |
| Right icon strip | Left of button | `[data-strip-side="right"]` ancestor |
| Card-level buttons (inside scroll) | Above | `data-helper-pos="above"` on element |

Card-level buttons (`CardTrashButton`, `TargetIcon`, drag handles) should use
`data-helper-pos="above"` to avoid clipping by the panel's scroll boundary.

### CSS rules

All rules live in `globals.css` under the "Helper mode" comment block. They
use `body[data-helper-mode="on"]` as the gate and `:hover` as the trigger,
so only one callout is visible at a time.

### State hook

`useHelperMode()` in `src/hooks/useHelperMode.ts` — same module-scoped
`useSyncExternalStore` pattern as `usePreferenceMode`. Exports `{ on, toggle, set }`.
Persists to `localStorage` key `virgil-helper-mode`.

## Modals

`<SystemDialog size>` — three sizes: `sm` 360, `md` 480, `lg` 640. No
`xl`, no fullscreen.

Anatomy: title row (40px) + body + footer button row. Backdrop is
`bg-overlay-scrim`, click-to-dismiss.

`<ConfirmDialog>` is a `sm` modal pre-wired for delete-with-content
and discard-unsaved. Anchors near the source element, not screen
center.

Don't nest modals. Use a popover for transients over a modal.

## Drag

Three categories.

1. **Anchor drag** (paragraph-level reanchor). MIMEs:
   `MIME_REPORT`, `MIME_NOTE`, `MIME_TODO`, `MIME_ARCHIVE_ANCHOR`,
   `MIME_CUT`, `MIME_MARGINALIA_MOVE`. Ghost: full card snapshot.
   Drop indicator: 2px solid blue line.
2. **Inline insert drag** (text-only). MIMEs:
   `MIME_CITATION`, `MIME_ARCHIVE`, `MIME_FOOTNOTE`,
   `MIME_TEXT_INSERT`. Ghost: white pill with
   ellipsis text. Drop indicator: ProseMirror native cursor.
3. **Selection drag** (selection chip → panel). MIME:
   `MIME_SELECTION_ANCHOR`. Ghost: small chip with selection excerpt.

Drop targets get a 2px dashed amber outline (`--ring-drag-target`)
plus a 12% fill — universal across paragraph drops, panel drops, card
drops.

## Stack (visual clipboard)

The Stack lives at the bottom-left of the editor pane: a 56px round
translucent button (3 stacked pages icon) backed by a body-portaled
strip that opens on click. Items in the strip are 160×96 compressed
cards showing kind label, 5-line summary, X-to-remove, and relative
date.

Z-index band: **999** — same as `DockOutline`, below `FloatingPanel`
(1200+) so a dragged float visually lands on top of the icon. The
StackIcon paints a blue ring (`#2563eb`) while a drag is hovering it
(populated via the `useStackDropTarget` module signal). The strip uses
`rgba(28, 25, 23, 0.82)` with backdrop blur — a darkish translucent
band consistent with overlay chrome.

## Editor inlines

Eight kinds, each with its own token group:

- Footnote marker (superscript red), citation (warm-yellow brackets),
  LaTeX comment (steel-blue %), comment Mode B (sky underline), inline
  math (mono purple), AI request marker (sky star), suggestion mark
  (amber highlight), linked anchor (invisible until hover).

Selection-from-card on inline atoms: 2px ring in
`--ring-drag-target`. On Mode-B linked spans: kind-specific tint via
`--link-anchor-color`. On Mode-A paragraph anchors: subtle left-border
stripe.

## Gutter chrome

The editor's left padding (`--editor-pl`, default 88px) houses two
shared chrome columns, expressed as CSS variables in `:root` so every
consumer reads the same source:

- `--gutter-col-chevron` (default `-44px`) — fold chevron column for
  headings and the texBlock pod. Consumed by `.heading-fold-chevron`
  and `.tex-block-fold-chevron`.
- `--gutter-col-handle-inset` (default `22px`) — distance from
  `contentLeft` to the grab-handle baseline column. Read by JS via
  `getComputedStyle` in [src/hooks/useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts)
  and fed to [src/text-objects/handle-layout.ts](src/text-objects/handle-layout.ts)
  so JS placement and CSS chrome share one knob.

Grab-handle placement is registry-driven (see
[src/text-objects/text-object-registry.ts](src/text-objects/text-object-registry.ts)).
Two horizontal policies, branched on `meta.isSubObject`:

- **Top-level** (paragraph, heading, exampleBlock, bulletList,
  texBlock, latexComment, etc.) — handle parks at
  `contentLeft − var(--gutter-col-handle-inset)`. Shared baseline
  column across every kind.
- **Sub-object** (listItem, exampleItem) — handle indents into the
  parent's marker zone at `contentLeft − decorationSafety −
  SUB_OBJECT_GAP`, with breathing room past the bullet / ex-marker.

Two vertical policies, branched on `meta.chromeAnchor`:

- **`text-top`** (paragraphs, headings, titleField, blockquotes,
  codeBlocks, lists, listItems, exampleBlock, exampleItems,
  linkedRange) — handle aligns with the first rendered glyph's cap-top,
  measured via `Range.getBoundingClientRect()`. Works for any font /
  line-height — a heading at 1.75rem reads the same as a paragraph at
  1.05rem.
- **`block-top`** (texBlock, latexComment, displayMath, graphicsBlock,
  figureBlock) — handle aligns with the wrapper's visual top edge. For
  framed visual kinds where there's no "first line of prose" to align
  with.

Adding a new TextObject kind requires no gutter-chrome CSS — drop a
registry entry, set `isSubObject`, `decorationSafety`, and
`chromeAnchor`, and the handle places itself on both axes. Tune the
visual globally by editing the CSS variables.

Grab-handle drag is the **only** popout mechanism for text objects —
the per-kind popout buttons (`.par-popout-btn`, `.expex-popout-btn`,
etc.) were retired in the Text-Object refactor. Don't reintroduce a
parallel popout affordance.

## Block images (figures & pictures)

`graphicsBlock` (a bare `\includegraphics`) and `figureBlock` (a captioned
`figure` env) share one NodeView and one `.figure-block` CSS family
(`isFigure` branches them). Two rules:

- **Hug the content.** A populated single image takes exactly the room it
  needs — the picture, plus the caption/lozenge for a figure — not a
  column-wide frame of empty space. `.figure-block-hug` shrinks the block
  to `width: fit-content` (centered with `margin-inline: auto`); the scale
  rides on the block as an inline `max-width: <widthPercent>%` of the text
  column while the panel fills it, so the image keeps its exact rendered
  size and the box collapses onto it. Subfigures (multi-source) and the
  empty-state CTA keep the full-width layout.
- **Delete lives in the grab-handle menu, not on the image.** The
  hover chrome carries only non-destructive controls — pick / scale /
  refresh — and no per-figure X, for the same reason the per-kind popout
  buttons were retired (above): the grab handle owns destructive and
  move operations. (The empty-state placeholder keeps its own X — a
  half-made block's quick bail before it has any content to grab.)

## Marginalia

Two gutters (left wider for the heading-fold chevron, right narrower).
Two-column grid per side (`MARGINALIA_COLS = 2`). Markers anchor to
paragraph UUIDs.

Seven types in `MARKER_META`: `quote`, `note`, `archive`, `revision`,
`cut`, `todo`, `error`. Each derives its color quartet from the
matching panel theme accent via `markerPaletteFromAccent()`.

Click → opens panel + selects card + scrolls. Cmd-click → opens
without scrolling. Hover → highlights linked text range.

## Top bar

40px, `--topbar-bg`. One row. Slots: logo, project tabs, title bar, AI
status, user menu. Hovers use `hover-on-dark`. The active-project tab
joins the canvas via the locked `--main-tab-bg` = `--background`
alias.

Icons in the Virgil bar are **16px tall**. Buttons are 24px
(`.topbarbtn`) so the icon sits with 4px of vertical padding. Don't
author 14px or 20px topbar icons.

## Library tab — double-tab pattern

Each open document renders a paired DocTab + LibraryTab in the Virgil
bar (the LibraryTab is the manila "shadow" tab in `--library-bg`). When
the user activates the Library pane, the tab body itself contains a
**second** layer of tabs — Central (the full catalog) plus any
spawned curated libraries — across left and right panels. Two layers of
tabs is intentional: outer = "what document am I in," inner = "which
slice of the library am I looking at."

All Library-specific UI lives under `library/` (sibling of `src/`).
Style tokens unique to the Library tab body — pill colors, paper-render
rules, `\pgmark{}` chip styling — live in `library/styles/library.css`,
imported once from `src/app/globals.css`. Avoid pulling those rules
into the global stylesheet; keeping them isolated is what lets the
Library subsystem be edited without churn elsewhere in Virgil.

## Suggestion vocabulary

Three keys for binary acceptance: **Y** accept, **N** reject, **S**
skip. Used wherever a user reviews items — extend to any new
accept/reject flow.

## What this guide does not cover

Empty-state designs, first-run onboarding, AI-pass review modes, the
6-dot vs 3-line drag-handle decision, the marginalia overflow design.
These are real design questions but they are **product decisions**, not
systematization. Track them separately. See
`docs/virgil-design-system/10-audit.md` for the deferred list.
