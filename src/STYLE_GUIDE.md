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

**Never write a bare font-family name inline.** next/font loads the real
faces only behind CSS variables, so an inline `fontFamily: "Inter"` (or a
hand-quoted `"Playfair Display"`) silently falls back to the UA default.
Always emit the override-first var stack via `resolveFontStack(name)`
(`src/lib/panel-typography.ts`) — it is total: curated names get their
`FONT_STACKS` entry, unknown names get the quoted literal plus a
heuristic generic tail. Don't write local `fontStack` helpers.

Editor scale: H1 1.75rem/700, H2 1.35rem/600, H3 1.15rem/600, body
1.05rem/400 with line-height 1.6. Panel scale: header 11px/600 uppercase
tracking-wider (`PanelHeader`), card title `--par-title-size`
(0.78rem ≈ 12.5px)/500, badge 10px/600.

### In-card type scale — meta vs content (UI-consistency sweep)

Inside a card body there are exactly **two tiers** (ratified 2026-06-12);
anything at 10.5 / 11 / 11.5px is a stray:

| Tier | Spec | Use | Token |
|---|---|---|---|
| **META** | 10px / 500 / uppercase / tracking-wide / `var(--muted)` | row labels ("Type", "Code"), key rows, chips, CODE text | `.card-meta-label` / `CardMetaLabel` |
| **CONTENT** | 12px | entry rows, inputs, previews | `.card-content-row` (or the panel body style) |

Mono inside cards always routes through the override-first stack
`var(--font-mono-override, var(--font-mono)), monospace` — the `.card-mono`
class / `CardMono` primitive (Tailwind's `font-mono` skips the user's mono
override pref). CODE/key mono sits on the META tier (10px).

### Picker scope — body content only

The per-panel font picker (`usePanelBodyStyle`) styles **body content
only**: entry rows, notes textareas, rich-text bodies. Card titles,
collapsed header lines, kind labels, meta rows, and code rows are
design-system-fixed (the TITLE and META dialects) and override-immune —
never spread a panel body style over them. The canonical title style is
`cardTitleStyle(theme)` (panel-primitives); `CardTitleInput` /
`CardBodyTitle` already use it.

### Card body typography — the two-class rule (A9)

Card *body* text is NOT one size. Every `CardKind` declares a
`bodyClass` in `CARD_REGISTRY` (`src/cards/types.ts`), and
`DEFAULT_PANEL_TYPOGRAPHY` (`src/lib/panel-typography.ts`) is **derived**
from it — never hand-kept — so the declared class and the rendered
default can't drift:

| `bodyClass` | Family · size | Kinds |
|---|---|---|
| `"borrowed"` | Source Serif 4 · **15px** | footnote, archive, example — the apparatus that *quotes document prose*. Same family as main text (17px), one step down for hierarchy. |
| `"sans"` | Inter · **12px** | everyone else — notes, todos, revisions, cuts, citations, bib, **reports** (R11), highlights. |

A panel's default row comes from its primary kind's `bodyClass` (a dev
assertion — `assertPanelTypographyCoverage` — pins that morph siblings in
a panel agree, so a morph never flips typography). The per-field user
override registry (the text-size stepper) sits on top of these defaults.

A `"borrowed"`-class card renders its **compressed** view and any
read-only surface through `BorrowedMainText` (a read-only TipTap clipped
to `compressedLines`), so collapsed cards still show real inline atoms
(citation / `\ref` / inline math) — not a flattened string. Sans-class
cards keep the one-line summary. The empty-body placeholder is the single
`CardEmptyText` component (one `text-ink-faint italic` style), not a
hand-rolled span.

### The card kind-chevron (morph) — A9

A polymorphic panel (one panel hosting a kind PAIR — Notes
note↔highlight, Revisions / Cutter comment↔suggestion, Reports
report↔report-request) renders a **chevron-down kind dropdown** in the
card header (`CardKindHeader`, options = `cardKindsForPanel(panel)`),
docked AND popped (via `chromeSlots.title`). Picking the sibling morphs
the card *in place* through the one chokepoint
(`convertCardWithRemap`): it salvages fields via the registered transform
(`registerCardMorph`), keeps a popped float alive (float-key remap), and
confirms first when the morph is `lossy` (drops a body / byline that the
target can't hold — `CardMeta.morph.lossy`). Never a one-way "+X" button.

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

Card chrome colors come from theme tokens (`theme.accent`,
`theme.titleColor`, …), never raw Tailwind palette literals
(`text-sky-500`). This holds for the system themes too (`aiRequest`,
`error` — non-overridable, but they ride the same accent→palette
derivation). A literal that happens to match the accent today will
silently drift when the palette doesn't. Deliberate non-theme
constants (e.g. the `info` severity steel in `ErrorCard`) get a
comment saying why they're exempt.

Selection: border flips to `theme.borderSelected`, header tint flips
from `headerDefault` to `headerSelected`, separator flips to
`theme.separatorSelected`, plus a soft `shadow-sm`. The body never
tints.

Hover (not selected): only the border changes (`edge-hover` →
`edge-strong`). The header and body don't react.

### Card header interaction (ratified 2026-06-11)

The docked unified header is a two-gesture surface — **click = toggle
expansion + select** (never jump, never open a panel), **drag = lift to
pop out** (the ONLY pop-out path; there is no chevron and no docked
pop-out button). The body click keeps the select+expand+jump contract.
Threading: `useAnchoredCard().onHeaderActivate` → `PanelCard`
(`onHeaderActivate`); panel-local stores (Errors) compose their own
select+toggle. The header carries the disclosure a11y (role="button",
Enter/Space, `aria-expanded`, stateful "Expand card"/"Collapse card"
label). Cards whose body is pinned open (e.g. a draft citation)
downgrade the header click to **select-only** — toggling a pinned-open
body would be a silent no-op — and pass `headerDisclosure={false}` so
the a11y drops `aria-expanded` and labels the header "Select card"
(`CitationCard`'s `isDraft` branch is the precedent). Cursor:
`cursor-default` on the header; the grab hint lives on the dots glyph
(`CardDragHandle`, `cursor-grab`). A completed lift swallows its
trailing click (suppress-click ref) so it can't also toggle. Tab focus
on the header is inert (`data-card-header` bails the focus-capture
auto-activation) — Enter/Space are the sole keyboard activation.

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

## Hints, tooltips & keyboard shortcuts

Virgil has **one** hover/focus affordance, rendered app-wide by `HintLayer`
(mounted once in `src/app/page.tsx`). It is the production replacement for
native `title=""` tooltips and the engine behind Helper mode. **Don't** use
`title=""` for tooltips and **don't** hand-roll hover popovers — add hint
attributes and let the single controller do the rest (delay, positioning,
keyboard a11y, dismissal).

### Adding a hint

Spread `useHint(...)` onto an element, or wrap it with `<Hint>`:

```tsx
const hint = useHint({ label: "Open actions menu", keys: "Mod+/" });
<button {...hint} aria-label="Open actions menu">⚡</button>

// …or without touching the child's props:
<Hint label="Delete" keys="Backspace"><IconButton …/></Hint>
```

Both just stamp the attribute protocol that `HintLayer` reads:

| Attribute | Meaning |
|---|---|
| `data-hint="Label"` | The tooltip text. 1–4 words. Optional — omit for a shortcut-only hint (just the keycap, e.g. the ⚡ button's "⌘/"). |
| `data-hint-keys="Mod+/"` | Optional shortcut, rendered via `<Kbd>` (plain light text inside the bubble). At least one of label / keys is required. |
| `data-hint-pos="above\|below\|left\|right"` | Optional placement nudge (flips/clamps to fit). |

The bubble appears after a ~550 ms hover (the Notion-style beat), instantly on
keyboard `:focus-visible`, and instantly for every hinted element while Helper
mode is on. It dismisses on Escape / scroll / pointer-down / pointer-leave and
positions via `useFloatingMenuPosition`.

**Accessibility:** `data-hint` is *not* an accessible name. Icon-only controls
still need `aria-label` (the `title`→hint migration adds one automatically).
Where the element already has visible text, that text is the name — don't add a
redundant `aria-label`.

### Keyboard shortcuts — `<Kbd>`

`<Kbd keys="Mod+Shift+N" />` renders a platform-aware keycap (`Mod` → ⌘ on Mac,
`Ctrl` elsewhere; `Enter`→⏎, `Esc`, `/`, letters…). This is the **only** way to
render a shortcut — no hardcoded `⌘…` strings. Used inside hint bubbles
(`data-hint-keys`), menus, and popover hints. `useIsMac()` / `formatShortcut()`
back it (`src/components/Kbd.tsx`).

### Positioning

Below-center by default. Override with a zone ancestor or explicit attribute:

| Zone | Bubble position | Mechanism |
|---|---|---|
| Virgil bar / MenuBar / panel header | Below | Default |
| Left icon strip | Right of element | `[data-strip-side="left"]` ancestor |
| Right icon strip | Left of element | `[data-strip-side="right"]` ancestor |
| Card-level buttons (inside scroll) | Above | `data-hint-pos="above"` on element |

Card-level buttons (`CardTrashButton`, `TargetIcon`, drag handles) should use
`data-hint-pos="above"` to avoid clipping by the panel's scroll boundary.

### Helper mode

Helper mode is just the **instant, always-on** rendering of the same hints.
Toggle via the "?" button on the Virgil bar → "Helper mode"; `document.body`
gets `data-helper-mode="on"` and `HintLayer` drops the hover delay to 0 so every
`data-hint` is discoverable at a glance. `useHelperMode()`
(`src/hooks/useHelperMode.ts`, module-scoped `useSyncExternalStore`, persisted to
`localStorage:virgil-helper-mode`) exposes `{ on, toggle, set }`.

> Legacy `data-helper` is still read as an alias by `HintLayer`; new code uses
> `data-hint`. The old CSS `::after` callout has been removed — the bubble is JS.

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
- `--gutter-col-handle-inset` (default `22px`) — the narrow-viewport
  **floor** for handle placement (`editorColumnLeft − this`), below which a
  deeply-indented block's handle won't be pushed off-screen-left. Read by JS
  via `getComputedStyle` in [src/hooks/useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts)
  (`cache.gutterInset`) and applied in [src/text-objects/handle-layout.ts](src/text-objects/handle-layout.ts).
- `--gutter-handle-gap` (default `0.625em`) — the **one uniform GAP** every
  gutter affordance leaves between its RIGHT edge and its block's marker.
  em-based so it scales with the labeled text; resolved PER BLOCK in
  [src/text-objects/block-frame.ts](src/text-objects/block-frame.ts) against
  that block's font (`gapPx`), so every prose block shares one value and a
  larger heading font widens it proportionally.
- `--gutter-track-width` (default `1.25em`) — the step a **markerless
  container** (`bulletList` / `orderedList`) takes left of its first item's
  handle, so container + item stack with uniform spacing.
- `--gutter-handle-hit-pad` (default `calc(var(--editor-font-size) * 1.8)`,
  ≈ 1.8em) — the width of a grab handle's **hit/hover halo** (the
  `.text-object-grab-handle::before`): a wide, centered pad around the 12px
  dots so the target is grabbable even when the cursor occludes the dots.
  Scales with the editor font; clamped per-handle by `--gutter-handle-hit-cap`
  (an inline override, half the distance to the nearest same-row handle) so
  close nested handles don't overlap. See "Grab hit/hover halo" below.

**Horizontal — measured marker-left + one uniform em gap.** There is NO
per-kind placement constant. Every gutter affordance hugs the block's
MEASURED marker (`block-frame.ts` `markerLeft`):

> `affordance.left = markerLeft − gapPx − <its own width>`

so its RIGHT edge sits one `gapPx` left of the marker. `markerLeft` is
measured, never a guessed glyph width, per kind:

- **exampleBlock** → its `(n)` number (`.expex-number`) left edge.
- **exampleItem** → its `a./b.` marker (`.expex-item-marker`) left edge.
- **listItem** → the bullet band: the middle of the parent list's measured
  `padding-left` indent (`li.left − padding-left / 2`). The `::marker`
  pseudo isn't rect-able, so we anchor to the measured band (em-scaling),
  never a hardcoded bullet width.
- **bulletList / orderedList** (markerless container) → one
  `--gutter-track-width` left of the first grabbable child's `markerLeft`.
- **paragraph / heading / blockquote / codeBlock / titleField / framed
  atoms** (no marker) → the text `contentLeft`. (A text **selection** also
  anchors to `contentLeft` — it labels text, not a marker.)

The result: `⠿ (2) ⠿ a.` (example container left of the number, item left of
its marker) and `⠿⠿ • text` (both list handles left of the bullet, uniform
spacing) — same gap everywhere, and because markers are MEASURED + the gap is
em-based, a wide `(100)` marker or a font-size change can't break it. Floored
at `editorColumnLeft − var(--gutter-col-handle-inset)` for narrow viewports.

Two vertical policies, branched on `meta.chromeAnchor`:

- **`text-top`** (paragraphs, headings, titleField, blockquotes,
  codeBlocks, lists, listItems, exampleBlock, exampleItems,
  linkedRange) — the handle glyph's vertical center is pinned to the
  **optical (cap-band) center** of the block's first visual text line:
  `firstLineRect.top + capTopOffset + capHeight / 2` (see
  [src/lib/text-metrics.ts](src/lib/text-metrics.ts)). Resolved through the
  canonical [src/text-objects/block-frame.ts](src/text-objects/block-frame.ts)
  `resolveBlockFrame()` so every affordance on a row reads the same numbers.
  A **container** (`bulletList` / `orderedList` / `exampleBlock`) resolves
  THROUGH to its first grabbable child's first line — the row the user sees
  — so a container handle and its first item's handle land on the same Y by
  construction. (Never anchor a container to its own `(n)` chip / wrapper
  metrics.) Works for any font / line-height — a heading at 1.75rem reads
  the same as a paragraph at 1.05rem.
- **`block-top`** (texBlock, latexComment, displayMath, graphicsBlock,
  figureBlock) — handle sits a half-glyph below the wrapper's visual top
  edge. For framed visual kinds where there's no "first line of prose" to
  align with.

Adding a new TextObject kind requires no gutter-chrome CSS and no placement
constant — drop a registry entry, set `chromeAnchor` (and `isSubObject` /
`parentKind` if it nests), teach `block-frame.ts` `resolveMarkerLeft` how to
measure the new kind's marker if it has one, and the handle places itself on
both axes. Tune the visual globally by editing the `--gutter-handle-gap` /
`--gutter-track-width` / `--gutter-col-handle-inset` CSS variables.

**Optical-center anchoring (generalizable chrome rule).** Any gutter or
marginal affordance that labels a line of text — a grab handle or a marker —
centers its glyph on the text's *optical center*
(`capTopOffset + capHeight / 2` below the line-box top), NOT on the line-box
top or the glyph cap-top. Anchoring to the line-box top (or `flex-start`
from it) leaves the affordance sitting low by ~half a cap-height, and the
error grows with font size. Read the Y from
`resolveBlockFrame(el, …).opticalCenterY` and center the glyph on it (an
absolute `top` plus `transform: translateY(-50%)`). (The drag DROP INDICATOR
does NOT optical-center: it takes its Y from the block box's top/bottom gap —
where a block boundary sits, not where a line of text sits — and shares only
the *horizontal* axis with the handles, per the next rule.)

**Content-left sharing (the horizontal analog, chip 4a).** The drag DROP
INDICATOR — the between-blocks insert bar and the expex new-item / into-item /
single-body bars — takes its x (and a horizontal bar's width) from the SAME
`resolveBlockFrame(el, …).contentLeft` / `contentWidth` the grab handles read,
never from an independent `getBoundingClientRect().left`. So the drop bar hugs
the block's text-left and lines up with the grab handles and the block content
by construction — it cannot drift from them. The distinction bites for an
INDENTED block whose box-left and text-left differ — an `exampleItem`, whose
box opens at the `a.` / `(n)` label column but whose prose is inset: the
canonical frame puts the bar in the PROSE column (where the dropped text lands),
not under the label. (The expex bars resolve the frame of the insertion site's
first content CHILD, robust to a body whose `data-uuid` isn't yet hydrated
mid-drag; a plain paragraph's box-left already equals its content-left, so
ordinary paragraph text is byte-unchanged.)

**Content-right sharing (the figure chrome, chip 4b).** The FIGURE CHROME — the
pick / scale / refresh row that tucks BESIDE a hugged figure/graphics block —
anchors its "beside" left to `resolveBlockFrame(el, …).contentRight`
(`contentLeft + contentWidth`, the rendered figure box's right edge), so it hugs
the image the way the grab handle hugs the marker on the LEFT: one frame on both
sides, no parallel `getBoundingClientRect().right` to drift. The beside↔overlay
responsive toggle (a per-figure RAF-coalesced `ResizeObserver`) is unchanged —
only the geometry SOURCE of the figure's right edge moved onto the frame. One
call-site subtlety: a figure's `[data-uuid]` node DOM is the full-COLUMN-width
`.react-renderer` host (the box the drop indicator correctly spans for a
full-width insert bar), so the chrome resolves the frame on the INNER
`.figure-block` hug box — whose right edge IS the image — not on the host. Leave
`resolveFirstLineTarget` untouched: descending it to the hug box would shrink the
drop indicator's figure-adjacent bar to image width (a chip-4a regression).

**Grab hit/hover halo.** The six dots stay a thin 12px box (the placement
math above pins it precisely on both axes — do NOT resize the box, the X
formula depends on its width). The *target*, though, is a wider transparent
`.text-object-grab-handle::before` halo CENTERED on the dots —
`--gutter-handle-hit-pad` wide (≈ 1.8em, scaling with the editor font) × one
line tall — so the user can grab it even with the cursor occluding the dots.
Three rules:

- **It enlarges the target, never the dots.** The halo is a `::before` (part
  of the element for hit-testing), so the existing mousedown→lift gesture
  fires from anywhere in the halo with NO JS wiring. `z-index:-1` paints it
  behind the dots; the host's integer `z-index` forms a stacking context that
  contains the negative layer, so it can't fall behind the paper.
- **Hover/press feedback covers the whole halo.** The `:hover` / `:active` /
  `.is-pressed` / `.is-menu-open` background renders on the `::before` (the
  full ≈1.8em halo, centered on the dots), not the 12px box — so the enlarged
  target is visible the moment it's engaged. Keep the dots themselves visually
  unchanged.
- **Closely-spaced siblings clamp, don't overlap.** A nested block shows two
  handles on one row a short distance apart (measured on the dev doc: bullet
  container↔item ≈ 19px; example container↔item ≈ 37px). A full ≈1.8em (~27px)
  halo would overlap the 19px-apart pair, so each halo's half-width is clamped
  to half the distance to its nearest same-row handle. The component derives
  that distance from the already-resolved on-screen placements (NOT a doc walk;
  [TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx)
  `applyHitCaps`, gated on the per-hover handle set so it stays O(1) per
  keystroke) and writes it to the handle as an inline `--gutter-handle-hit-cap`
  (half the gap, px); the `::before` width is then
  `max(12px, min(var(--gutter-handle-hit-pad), calc(var(--gutter-handle-hit-cap) * 2)))`.
  Result: the 19px bullet handles shrink to 19px halos that meet at the
  midpoint with no overlap (each dots-cluster fully owned, the midpoint
  resolving to the inner/item handle — the more specific grab), while the 37px
  example handles keep full halos with a gap between them. Isolated handles and
  far-enough siblings are never clamped (the `min` picks the full pad).

Grab-handle drag is the **only** popout mechanism for text objects —
the per-kind popout buttons (`.par-popout-btn`, `.expex-popout-btn`,
etc.) were retired in the Text-Object refactor. Don't reintroduce a
parallel popout affordance.

## Block images (figures & pictures)

`graphicsBlock` (a bare `\includegraphics`) and `figureBlock` (a captioned
`figure` env) share one NodeView and one `.figure-block` CSS family
(`isFigure` branches them). Four rules:

- **Hug the content.** A populated single image takes exactly the room it
  needs — the picture, plus the caption/lozenge for a figure — not a
  column-wide frame of empty space. `.figure-block-hug` shrinks the block
  to `width: fit-content`; the scale rides on the block as an inline
  `max-width: <widthPercent>%` of the text column while the panel fills it,
  so the image keeps its exact rendered size and the box collapses onto it.
  Subfigures (multi-source) and the empty-state CTA keep the full-width
  layout.
- **Pictures left, figures centered.** Justification splits by KIND on the
  hug class. A bare picture (`.figure-block-bare`) left-justifies at the
  text-column edge (`margin-inline: 0`, `text-align: left`) so an
  image-sized block shares a paragraph's left geometry — its left edge is
  the paragraph text-left, and the block affordances (grab handle, drop
  bar, expex-drop bar) line up with prose for free. A captioned figure
  (`.figure-block-wrapped`) stays centered (`margin-inline: auto`): a figure
  announces itself with a caption, so it reads as a centered block. ("If I
  want a picture centered, I put it in a figure.")
- **Chrome beside the image, overlay as fallback.** The hover chrome
  normally overlays the image's top-right corner. When the row fits in the
  space to the RIGHT of the (fit-content) block within the text column,
  FigureBlockNodeView measures it — a per-figure `ResizeObserver`, RAF-
  coalesced, recomputed on mount / image-load / scale / column-resize, no
  doc walk — and adds `.figure-chrome-beside`, so the controls sit just
  outside the image instead of on top of it. A wide image with no room to
  its right keeps the overlay. (A left picture has the whole column − image
  to its right; a centered figure has the right half-gap.) Not CSS
  container queries — they force `contain: layout` on the React-NodeView
  wrapper and break inter-block rhythm.
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
