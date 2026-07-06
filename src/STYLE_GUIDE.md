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
- **Menu selection** (the keyboard-roving "selection square" the L/R/U/D
  arrow cursor moves in an action menu): `--menu-roving-bg` /
  `bg-menu-roving` — a darker, blue-tinted surface (from `--accent-blue`)
  so the active item reads clearly against the neutral `:hover` grey and
  the near-white resting surface. Every menu's roving-active state consumes
  this ONE token (grab, lightning grid+list, heading, tab, MenuBar, the
  color-popover ring, the label-ref/bib comboboxes), so the cursor looks
  the same everywhere and a new menu inherits it for free. This is the
  sanctioned way to tint menu chrome blue — never reach for a raw
  `bg-blue-*`.
- **Footnote rust** (footnote, cut, error): `--footnote-50/100/200/300/500`.
- **Warm amber** (citation, bib, quote): `--amber-50/100/200/500`.
- **Library edge** (`--library-edge`): the SSOT for every Library-surface
  page edge — tab silhouette strokes, the panel/body frame border, NavPod.
  DERIVED, not a literal: `color-mix(in oklab, var(--library-bg) 82%, #000)`,
  so it is a darker tint of the library field *by construction* and can never
  drift into a warm-on-cool clash (the failure mode when these edges rode the
  top-bar token `--topbar-border` over the promoted cool `--library-bg`; task
  048). Any new Library-surface edge consumes THIS token, never
  `--topbar-border`; a guard in `folder-path.test.ts` fails the build if a
  `library/` source re-grabs `--topbar-border`. The general pattern: an edge
  token that must harmonize with a surface should be `color-mix`-derived FROM
  that surface's var, not a hand-picked hex that a future retone can desync.

Locked aliases (must track each other): `--theme-color`/`--topbar-bg`,
`--main-tab-bg`/`--background`, `--pod-editor`/`--surface`,
`--h1-color`/`--foreground`, `--h2h3-color`/`--editor-text-color`,
`--scrollbar-hover`/`--muted-light`.

Forbidden in new code: `text-stone-*`, `border-stone-*`,
`bg-stone-*-with-opacity`, hex literals in components, `bg-blue-*` /
`bg-emerald-*` / `bg-red-*` in panel chrome, and **literal corner radii**
(`borderRadius: 6`, `border-radius: 0.375rem`, `rounded-[6px]`) — use the
radius scale below. The guard `npm run check:radius` enforces this.

### Radius scale

Corner radii are tokens, the single source of truth — the same rule colors
already follow. Six steps, defined in `src/app/globals.css :root` and mapped
onto the Tailwind `rounded-*` utilities via an `@theme` block, so
`rounded-md` etc. are token-backed and `var(--radius-md)` works in inline
`style`/CSS. Pick by role, not by eyeballed pixels:

| Token | px | `rounded-*` | Use |
|---|---|---|---|
| `--radius-xs` | 3 | `rounded-xs` | in-text/chip micro details: inline marks (highlight, citation/footnote/label/note markers), annotation chips/toggles/delete, `kbd`, scrollbar thumb. |
| `--radius-sm` | 4 | `rounded-sm` | small controls & inner rows: icon/topbar buttons, color swatches, inner list rows, form inputs inside a popover, drag-handle hit area. |
| `--radius-md` | 6 | `rounded-md` | primary CONTROL radius: `<Button>`, inputs, segmented controls, copy buttons, tooltips, hint bubbles. |
| `--pod-radius` | 8 | `rounded-lg` | CARD + POD + MENU tier: cards, sub-pods, dropdown/popover menus, floating menus, editor pod, code / display-math blocks, figure images. |
| `--panel-radius` | 14 | `rounded-xl` | large PANEL + MODAL tier: sidebar panel pods, docked floating panels, system/font dialogs. |
| `--radius-pill` | 9999 | `rounded-pill` / `rounded-full` | fully-round capsules: status pills, page-scroll lozenges, pgmark chips, drag-ghost badges. |

**Allowed to stay literal** (the guard permits these): hairline insertion &
drop-indicator bars (`1px`), perfect circles / dots / avatars (`50%`), and
intentional flattening resets (`0`).

**Deliberate exceptions** (do NOT collapse into the scale):

- `--library-manila-radius` (10px) — the Library "manila folder" corner. The
  active-tab SVG silhouette (`library/components/panel-tabs/folder-path.ts`)
  and the panel body frame tangent at R=10 by design. Named so the tab
  geometry and the frame read one value; never `--pod-radius`.
- `folder-path.ts` `R`/`S` sweep constants — path geometry, touched at the
  geometry layer, never tokenized (guard-allowlisted).

A genuine one-off can carry a `radius-allow` comment on the line to opt out of
the guard, but reach for that rarely — a new radius almost always belongs to a
tier above.

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
class (Tailwind's `font-mono` skips the user's mono override pref; apply
`.card-mono` directly and set the size alongside it). CODE/key mono sits on
the META tier (10px).

**Status badges (library cards).** Two documented chip dialects coexist on
the bibliography/citation card's stacked header, distinguished by role, not
drift:

| Dialect | Spec | Use |
|---|---|---|
| **Membership chip** | 9px / uppercase / tracking-wide | "location tags" — which library an entry lives in (Local / Central / a custom library). `provenance-chips.tsx`. |
| **Status badge** | 10px / sentence-case / tracking-wide / colored | the entry's *state* — `✓ Authenticated` (bib-auth; "Verified" is retired — F#2) and the processing tier (`Bib only` / `Indexed PDF` / `Deep-indexed PDF`). `library-entry-status.tsx`. |

Sentence-case on the status badge is deliberate: the labels are user-facing
vocabulary that reads as words, not shouted tags. Membership chips stay the
denser uppercase tag so the two layers read as distinct registers.

**Stacked card header (library cards).** The bibliography card header is a
**three-layer vertical stack** — (1) text: author · year · title, full width;
(2) libraries: membership chips; (3) status: the verification + tier badges +
the "Open" link. Stacking (not a single trailing chip row) is what keeps the
title legible when the panel is narrow — a trailing `shrink-0` chip row would
otherwise squeeze the title to one character per line. The library-aware meta
is composed by the panel and passed to the card-agnostic `headerMeta` slot.

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

The **external-link / "open in new tab"** glyph (`ExternalLinkIcon` —
`src/components/icons/`, a lucide box-with-arrow leaf, 12px default) is the
shared mark for opening a library entry as its own tab; like `DropChevrons`
it is a domain-neutral leaf (no card/library imports) so any surface —
bibliography cards, citation cards — can reuse it.

Marginalia margin icons are 16px, rendered via the components in
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

**Omni bin pill.** The count-pill controls in the Omni cascade that
collect cards which can't render inline — the outside-focus band and
the unanchored bin — share `.omni-bin-pill` (`globals.css`). It's a
solid, clearly-bounded chip against the white Omni column: tinted
resting bg (`--surface-muted`) so it separates from the column, a
perceptible stone-300 edge (`--edge-hover`), readable `--ink-body`
text, hover deepening one step (bg → `--surface-muted-strong`, border →
`--edge-strong`). Beware the hover trap: never rest a hover-able pill at
the same token its hover lands on, or the feedback vanishes. The leading
glyph stays per-bin (a `◎` vs a `BadgeOrphaned` badge). Reuse this class
for any future "N collected X" chip rather than re-authoring the faint
white-on-white recipe.

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
adjacent in the same surface, and the margin icon distinguishes them.

A card renders via `<PanelCard theme={…} selected={…}>`. The frame
(border, header strip, separator, body, popout, trash) is identical
across themes; only the colors differ. **Every card has a theme.** A
card without a theme is a bug.

**No bespoke card headers.** Pass `kind` (+ `kindLabelOverride` when the
registry label differs from the card's overline, e.g. `bib` →
"Bibliography item") so PanelCard renders the ONE unified header —
`[drag] OVERLINE [headerTrailing] [drop?] [jump?/X?]` — and thread small
per-card controls (jump target, occurrence counter, "Add") through the
narrow `headerTrailing` slot, multi-line meta (library chips / status) as
a body meta row, and popout/close through `onTogglePopout`. Never
hand-roll a header `<div>` or an absolute top-right control cluster inside
a PanelCard (the shape `BibEntryCard` carried until task 055, the last
offender). A stacked bespoke header competes with the title for width and
drifts from the standard chrome.

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

### The drop button (re-anchor) — header control

Every card that has a text anchor carries a **drop button**: a
double-chevron-down "drop here" glyph (`DropChevrons` —
`src/components/icons/`, two stacked lucide `ChevronsDown` polylines,
sized to match `CardJumpChevron`). **Grabbing it (mousedown-drag)
enters drop-mode** to anchor or re-anchor the card into the prose at a
target position — the card cousin of the in-text atom grab and the
lifted-overlay grab handle (all three share `beginCardDropGesture`,
`src/components/drop-mode/card-drop-gesture.ts`). It is the **rightmost
header control on a docked card**, and sits **left of the X** when the
card is popped out (the jump chevron + X render only there). Gated on
the static `isDroppable(kind)` registry facet — so it appears on every
droppable kind (note, footnote, citation, todo, archive, the
comment/suggestion/report families) and is absent on `bib` / `ai` /
`error` / `example`. The glyph component is domain-neutral (no card or
drop-mode imports) so the float chrome and the margin pin reuse the
same mark. Press isolation builds on `CardJumpChevron`'s (real
`<button draggable=false>`, mousedown `stopPropagation`, `dragstart`
swallowed) so it never co-fires the header drag-lift or the card-root
anchor drag — but it goes **intentionally beyond** the jump chevron by
ALSO calling `preventDefault()` on mousedown. This is a press-**drag**,
not a click: the `preventDefault` suppresses native focus + stray
text-selection during the drag and trips the header wrapper's
`if (e.defaultPrevented) return` lift-guard. That `preventDefault` is
load-bearing — do not "align" it back to `CardJumpChevron` by removing
it. A non-primary (right/middle) press is guarded out at the top of the
handler (`if (e.button !== 0) return`) so it passes through with its
native behavior intact. Inline kinds disable the button (40% opacity,
not-allowed) while the card is an empty/keyless draft — there is no atom
to anchor yet.

**Same glyph, domain-dispatched gesture core (text-object floats).** The
drop button is now on **popped-out text-object floats too** (not just
cards): a paragraph/heading/list/etc. float carries the same
`DropChevrons` left of its X, and pressing it drops the block **back into
the prose** (move-and-close). Because the glyph is domain-neutral, the
DISPATCH lives one level up at the float host (`FloatWindow.onDropPress`),
not in the button: a **card** float's press still routes to
`beginCardDropGesture` (the byte-unchanged card path), while a
**text-object** float's press drives the **lifted-overlay ghost** via
`LiftHost.beginLift({terminalPolicy:"float"})` — the same lift core the
in-editor grab handle uses (`terminalPolicy:"grab"`). The convention:
**one drop-glyph, gated on the float's static `canDrop` facet; the
gesture it arms is chosen by the float's domain at the host, so the
chrome stays domain-blind.** The text-object terminal policy is
ghost-only (no popout — the float is already open; outside-content
release cancels).

## Panels

Sidebar pod with a locked-height header (`--header-h: 34px`). Header
slots, in order: leading menu/swatch, title + count, after-title tool,
add button, AI button, extras, popout chevron. Order is fixed even
when slots are absent.

Panel pods are **borderless warm sheets**: `--pod-panel` fill, a larger
`--panel-radius` (14px, vs the editor pod's 8px `--pod-radius`), and the
**same ambient shadow as cards** (`--card-shadow-ambient`); **no border**
(`--panel-border: none`). The **header shares the body fill**
(`--pod-panel`) with **no divider** — header and body read as one
continuous sheet. Separation between stacked pods comes from the cream
`--pod-gap` gutter + each sheet's shadow — not a border. Don't add
backdrops, glows, gradients, a border, or a header divider.

Body is a scrollable list with `space-y-2` between cards. No `border-b`
between cards.

Every panel has a designed empty state — icon, title sentence,
description, optional example card. "No items yet" is not enough.

The panel strip (vertical column of toggles) uses 32×32 icon buttons.
Active toggle: `bg-pod-dark/80 text-ink-strong` — the lit strip icon is
the **only** active-panel cue. A panel looks **identical whether or not it
has focus**: no per-pod stripe, ring, border, or shadow-change on focus.

## Resize gutters

Every draggable divider in the app — the panel-band dividers, the
panel↔editor gutters, the code splitter, zen margins, and the three
Library resizers — shares ONE grip chrome: `.drag-gap.drag-gap-{h,v}
.band-grip`. The strip is **invisible at rest** (only the resize cursor
shows) and reveals a single centered **grip pill** on hover AND drag —
`--edge-hover` → `--drag-highlight` accent, widening on its short axis
(28→40→44px). It's orientation-agnostic from one rule set in `globals.css`:
a horizontal gutter gets a wide-short pill on `::before`; a vertical gutter
a tall-thin pill on `::after` (its `::before` is the hit-area extension).
Don't hand-roll a resizer's look — put `band-grip` on a `.drag-gap-{h,v}`
element and toggle `.dragging` for the gesture (`useDragGap` does this for
the editor gutters; an imperative resizer adds/removes the class itself).
The stacked-panel bands additionally carry `.band-grip-occlude` for an
opaque `--background` backing (they occlude omni cards showing through);
**no other gutter opts in** — every other resizer stays transparent at rest.

## Code view

The CodeMirror LaTeX-source pane (right of the `SplitWithCode` divider)
is a focused, two-pane mode — treat it as a clean document column, not a
crowded workspace:

- **No L/R panel strips.** Both `PaneRail`s are hidden while the code
  pane is open (`useCodePaneSplit().active`); panels are unavailable in
  code view by design. Errors get their own slim sidebar inside the code
  pane.
- **Comfortable gutter, never a squeeze.** When the splitter narrows the
  editor below its natural width, gutters cap at `CODE_VIEW_GUTTER_PX`
  (48px) — a healthy left/right margin, not prose jammed to the edge.
  Keep in sync with `EDITOR_PANE_COMPRESSED_MIN_PX` in
  `split-with-code.tsx` (300px prose + gutter×2 + 2px border).
- **Panes do NOT auto-align cursors.** Moving the cursor in one pane does
  not scroll the other. The TipTap cursor drives a passive light-red
  **band** (`.cm-virgil-band`, `rgba(220,38,38,0.09)`) over the matching
  source lines — highlight only, no scroll. Explicit alignment is a pair
  of **sync arrows** on the divider (◄ aligns text to the code cursor, ►
  aligns code to the text cursor).
- **Errors stay in their pane.** Clicking an error in the code-view
  sidebar scrolls CodeMirror and stays in code view; clicking one in the
  visual editor scrolls + highlights the prose. One owner, one jump.

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

Card-level buttons (`CardTrashButton`, `CardJumpChevron`, drag handles) should use
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

`<SystemDialog size>` — five sizes: `sm` 340, `md` 380, `lg` 520,
`xl` 720, `full` `min(96vw,1100px)`. All chrome lives in one object,
`SYSTEM_DIALOG_TOKENS` (`src/components/system-dialog.tsx`) — edit it
to re-skin every dialog at once.

Anatomy: header (title + optional subtitle) + body + footer button row.
Surface is `bg-surface`, `rounded-xl`, `border`, and the detached-float
shadow token `--shadow-float` (not a raw `shadow-xl`). Title is
`text-sm font-semibold text-ink-body`. Backdrop is `bg-[var(--overlay-scrim)]`
(a warm-neutral translucent derived from `--ink-strong`, not cool black),
click-to-dismiss.

Buttons render through the `Button` primitive (`<SystemDialogButton>` maps
the legacy `primary/secondary/danger/accent` names onto it). The affirmative
button is `variant="primary"`, filled with **`--btn-primary`** (aliases the
taupe `--control-selected`, NOT the saturated `--accent` brown) so it reads
as a darker shade of the paper. Destructive confirms use `variant="danger"`.

`<ConfirmDialog>` is a `sm` modal pre-wired for delete-with-content
and discard-unsaved. Anchors near the source element, not screen
center.

### Positioning variants — one shell, principled variety

`SystemDialog` has a `variant` axis so surfaces that predate it fold onto the
one SSOT instead of hand-rolling `fixed z-[9999] bg-surface rounded-lg shadow-xl`.
Every variant shares the portal, the `SYSTEM_DIALOG_TOKENS` chrome, Esc/focus/
`role="dialog"` wiring, and outside-click-to-close; they differ only in scrim,
placement, and z-tier. This is the positioning taxonomy — reach for the variant
that matches the surface, don't reinvent the shell:

| surface | `variant` | scrim | z-tier |
| --- | --- | --- | --- |
| modal / global-centered (confirm, alert, prompt, standalone modal) | `"modal"` (default) | yes | `MODAL_SCRIM_Z` |
| draggable tool window (Preferences) | `"draggable"` | no | `DRAGGABLE_DIALOG_Z` |
| anchored popover at a point (preference-mode picker) | `"anchored"` | no | `MODAL_SCRIM_Z` |
| context menu / anchored dropdown (`ItemMenu`, help menu) | *use `<Menu>`* | no | `OPEN_CHROME_MENU_Z` |
| caret / selection popup (`NodeEditPopover`, slash, citation) | *use `useFloatingMenuPosition`* | no | `OPEN_CHROME_MENU_Z` |
| resting margin trigger (bolt, pill) | — | no | `RESTING_MARGIN_TRIGGER_Z` |

- **`variant="draggable"`** — scrimless window dragged by its header. SystemDialog
  owns the drag (one `useDragPosition`); wire a custom header strip as the grab
  handle with **`useSystemDialogDrag()`** (`{ onMouseDown, dragging }`). Pass
  `ignoreOutsideSelector` so clicking the topbar trigger doesn't close-then-reopen.
- **`variant="anchored"`** — scrimless popover pinned at a viewport point via
  `at={{x,y}}` (or `anchorRef`), measured and clamped inside the viewport before
  it paints. Pass `outsideClickGuard` to keep a modifier gesture from dismissing
  (e.g. ctrl+click-to-retarget).
- `FloatingPanel`-hosted tool windows (Fonts) keep their resizable shell but should
  derive header/surface chrome from `SYSTEM_DIALOG_TOKENS`, not bespoke literals.

**Imperative dialogs.** `useSystemDialog()` (from
`src/components/system-dialog-host.tsx`, provider mounted app-wide) exposes
`alert` / `confirm` / `prompt` — promise-returning replacements for the
native `window.*` dialogs that render through the same `SystemDialog` chrome.
Reach for these instead of hand-rolling a one-off modal.

Don't nest modals. Use a popover for transients over a modal.

### Menus

`<Menu>`/`MenuProvider` (`src/components/menu/`) is the **canonical dropdown /
context-menu primitive** — the menu-side sibling of `SystemDialog`. Reach for it
for any command menu, kebab, or anchored dropdown; don't hand-roll a portal +
`z-[9999]` + a bespoke `document.addEventListener('mousedown')` closer. One
`MenuProvider` owns, per open menu:

- **positioning** — the single `useFloatingMenuPosition` call (measured, viewport-
  clamped, `placements` tried in order, RAF-coalesced `trackAnchor` re-anchor);
- **portal** — body-portaled by default (escapes the sticky-bar / stacking-context
  trap above), or docked inline with `portal={false}` (MenuBar's own context);
- **z-tier** — `OPEN_CHROME_MENU_Z` (2000), so it composes above the float layer;
- **dismissal** — one mousedown-outside + Escape controller (`useMenuDismiss`),
  with `excludeRefs` to exempt an outside trigger and nested popovers;
- **keyboard / roving nav** — one `useMenuKeyboard` controller; items opt in via
  `useMenuItem` (or `<MenuItemsFromRegistry>`) to gain arrow-nav + the roving
  active highlight. Items never take `.focus()` (roving `aria-activedescendant`
  only) so the editor caret never moves.

**`ItemMenu`** (the three-dot card/panel menu in `panel-primitives.tsx`, used by
all 8 card panels + `CardViewModeMenu`) is **folded onto this primitive** — it's a
thin shell that keeps its `align` + `children` API and the auto-injected
`PanelTextSizeRow` row, but delegates portal / positioning / dismiss / z / Escape
to `MenuProvider` (retiring its old `fixed z-[9999]` portal + hand-rolled
mousedown closer). Its arbitrary button children render opaquely (they keep their
`onMouseDown`+`preventDefault` fire-before-close pattern; a wrapping
`onClick`→close preserves the old "any click inside dismisses" semantics + the
stopPropagation fence against the card header). Opaque children still work without
per-item registration — wrap them in `useMenuItem` when a menu wants roving nav.

The sticky-bar topbar kebabs (`ExternalChangeBadge`, `CollabStatusPill`) are the
reference wiring for the body-portal case — see the **Top bar** portal rule below.

### Z-index ladder

The float/menu tiers are named constants in `src/floats/float-policy.ts`
(one SSOT, pinned by `float-policy.test.ts`); the modal/tooltip tiers were
formerly bare literals and now join them. Derive from a symbol, never a magic
number. Full ladder, low → high:

| tier | z | constant |
| --- | --- | --- |
| content / editor prose | 0–99 | (local) |
| docked panel band | 1000 | `FLOATING_PANEL_Z_BASE` |
| resting margin trigger | 1199 | `RESTING_MARGIN_TRIGGER_Z` |
| float layer (popped cards, lift overlay) | 1200 | `FLOAT_Z_BASE` |
| draggable tool window (`SystemDialog variant="draggable"`) | 1205 | `DRAGGABLE_DIALOG_Z` |
| open chrome menu (`<Menu>` CHROME_Z, sticky-bar dropdowns) | 2000 | `OPEN_CHROME_MENU_Z` |
| drop-mode indicator | 9999 | `DROP_INDICATOR_Z` |
| modal scrim + centered dialogs | 10000 | `MODAL_SCRIM_Z` |
| hint / tooltip bubble | 10010 | `HINT_Z` |

`HINT_Z` has no TS consumer — the only site is the `.hint-bubble` CSS rule
(CSS can't import TS), which mirrors the value; the test guards the mirror.

## Drag

Three categories.

1. **Anchor drag** (paragraph-level reanchor). This no longer flows
   through native HTML5 DnD — paragraph-level re-anchor now runs through
   the drop-mode controller (the card/float drop button + the folded
   margin pin both call `beginCardDropGesture`), classified+applied by the
   shared `textObjectSideReanchorSpec`. The per-panel anchor MIMEs
   (`MIME_REPORT`/`MIME_NOTE`/`MIME_TODO`/`MIME_ARCHIVE_ANCHOR`/`MIME_CUT`/
   the Revisions MIME) are gone. `MIME_MARGINALIA_MOVE` remains only as a
   legacy `ANCHOR_DRAG_TYPES` member. Drop indicator: 2px solid blue line.
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

## Margin chrome

The editor's left padding (`--editor-pl`, default 88px) houses two
shared chrome columns, expressed as CSS variables in `:root` so every
consumer reads the same source:

- `--margin-col-chevron` (default `-44px`) — fold chevron column for
  headings and the texBlock pod. Consumed by `.heading-fold-chevron`
  and `.tex-block-fold-chevron`.
- `--margin-col-handle-inset` (default `22px`) — the narrow-viewport
  **floor** for handle placement (`editorColumnLeft − this`), below which a
  deeply-indented block's handle won't be pushed off-screen-left. Read by JS
  via `getComputedStyle` in [src/hooks/useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts)
  (`cache.marginInset`) and applied in [src/text-objects/handle-layout.ts](src/text-objects/handle-layout.ts).
- `--margin-handle-gap` (default `0.625em`) — the **one uniform GAP** every
  margin affordance leaves between its RIGHT edge and its block's marker.
  em-based so it scales with the labeled text; resolved PER BLOCK in
  [src/text-objects/block-frame.ts](src/text-objects/block-frame.ts) against
  that block's font (`gapPx`), so every prose block shares one value and a
  larger heading font widens it proportionally.
- `--margin-track-width` (default `1.25em`) — the step a **markerless
  container** (`bulletList` / `orderedList`) takes left of its first item's
  handle, so container + item stack with uniform spacing.
- `--margin-handle-hit-pad` (default `calc(var(--editor-font-size) * 1.8)`,
  ≈ 1.8em) — the width of a grab handle's **hit/hover halo** (the
  `.text-object-grab-handle::before`): a wide, centered pad around the 12px
  dots so the target is grabbable even when the cursor occludes the dots.
  Scales with the editor font; clamped per-handle by `--margin-handle-hit-cap`
  (an inline override, half the distance to the nearest same-row handle) so
  close nested handles don't overlap. See "Grab hit/hover halo" below.

**Horizontal — measured marker-left + one uniform em gap.** There is NO
per-kind placement constant. Every margin affordance hugs the block's
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
  `--margin-track-width` left of the first grabbable child's `markerLeft`.
- **paragraph / heading / blockquote / codeBlock / titleField / framed
  atoms** (no marker) → the text `contentLeft`. (A text **selection** also
  anchors to `contentLeft` — it labels text, not a marker.)

The result: `⠿ (2) ⠿ a.` (example container left of the number, item left of
its marker) and `⠿⠿ • text` (both list handles left of the bullet, uniform
spacing) — same gap everywhere, and because markers are MEASURED + the gap is
em-based, a wide `(100)` marker or a font-size change can't break it. Floored
at `editorColumnLeft − var(--margin-col-handle-inset)` for narrow viewports.

**Marker-left fallback invariant (generalizable).** When a kind's marker
chrome can't be measured (a transient render before the NodeView mounts, an
unfaithful clone that stripped the span), `resolveMarkerLeft` must fall back to
a position in the MARGIN — **left of content** (e.g. `contentLeft −
trackWidthPx`, the column the marker occupies) — NEVER to `contentLeft` itself.
A `contentLeft` fallback puts the handle at the text start, *right* of the
marker, dropping the dots onto the content (the backlog #49 symptom). The
deeper "no second handle" rule: a container's INNER body paragraph is NOT its
own grabbable text-object — only the container is. The `data-uuid` decoration
the hover scan keys on is suppressed for any `paragraph` whose parent is a
`DEFERRING_PARENTS` container (listItem / blockquote / codeBlock / exampleItem /
**exampleBlock**), so a single example's `(16)` body and a sub-item's `b.` body
never sprout a phantom handle on their text. That set is the SSOT in
`@/lib/anchor-uuid` (`isDeferredInnerParagraph`), shared by the mint resolve,
the backfill plugin, and the decoration walk so the boundary can't drift.

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

Adding a new TextObject kind requires no margin-chrome CSS and no placement
constant — drop a registry entry, set `chromeAnchor` (and `isSubObject` /
`parentKind` if it nests), teach `block-frame.ts` `resolveMarkerLeft` how to
measure the new kind's marker if it has one, and the handle places itself on
both axes. Tune the visual globally by editing the `--margin-handle-gap` /
`--margin-track-width` / `--margin-col-handle-inset` CSS variables.

**Optical-center anchoring (generalizable chrome rule).** Any margin
affordance that labels a line of text — a grab handle or a marker —
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
`--margin-handle-hit-pad` wide (≈ 1.8em, scaling with the editor font) × one
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
  keystroke) and writes it to the handle as an inline `--margin-handle-hit-cap`
  (half the gap, px); the `::before` width is then
  `max(12px, min(var(--margin-handle-hit-pad), calc(var(--margin-handle-hit-cap) * 2)))`.
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

Two margins (left wider for the heading-fold chevron, right narrower).
Two-column grid per side (`MARGINALIA_COLS = 2`). Markers anchor to
paragraph UUIDs.

Seven types in `MARKER_META`: `quote`, `note`, `archive`, `revision`,
`cut`, `todo`, `error`. Each derives its color quartet from the
matching panel theme accent via `markerPaletteFromAccent()`.

Click → opens panel + selects card + scrolls. Cmd-click → opens
without scrolling. Hover → highlights linked text range.

**Orphan dock ("unanchored — click to re-pin").** A card whose anchor can
no longer be resolved to any live paragraph (its stored UUID, its
`linkedAnchor` mark, and its text snapshot are all dead — the resolver SSOT
`resolveCardAnchor` returns `source:'orphan'`) has no line to align against.
Rather than silently culling its marker (the old "card vanishes ~10s later"
bug), the margin surfaces it in a **fixed dock** pinned to the top of the
side it would dock on (`OrphanDock` in `Marginalia.tsx`): a faint
`bg-surface/90` + `border-edge-subtle` rounded strip of the card's normal
marker buttons, with a `data-hint`/`aria-label` of "N unanchored — click to
re-pin". Each entry behaves like any margin marker — click opens the card's
panel; grab (when editable) starts a drop-mode re-anchor session (the
re-pin). The dock only appears when a card genuinely orphans against a
**non-empty** live-UUID set — never during the editor-mount gap (the marker
builder treats a zero-UUID resolve index as not-ready and falls back to the
raw stored pids, so a momentarily-empty doc can't false-flag every card).
This is render-layer only: the card and its sidecar are untouched, so a
reload (or a successful re-anchor) restores it to the grid.

## Top bar

40px, `--topbar-bg`. One row. Slots: logo, project tabs, title bar, AI
status, user menu. Hovers use `hover-on-dark`. The active-project tab
joins the canvas via the locked `--main-tab-bg` = `--background`
alias.

Icons in the Virgil bar are **16px tall**. Buttons are 24px
(`.topbarbtn`) so the icon sits with 4px of vertical padding. Don't
author 14px or 20px topbar icons.

**Dropdowns from a sticky bar must be body-portaled.** The Virgil bar is
`sticky top-0 z-30`, which establishes a stacking context — any dropdown
rendered `position:absolute` inline inside it is trapped at z-30 and
floating panels / popped cards (z-1200+) paint over it, no matter how
high the dropdown's own `z-index` (this was backlog #9). Render such
dropdowns with `createPortal(..., document.body)`, position them from the
trigger's `getBoundingClientRect()` via `useFloatingMenuPosition`
(`src/hooks/useFloatingMenuPosition.ts`), and give them the chrome-menu
tier **`zIndex: 2000`** (matching `DragHandleMenu` / `ActionsMenuPanel`).
The cleanest way to satisfy all three is to render the dropdown through the
shared `<Menu>`/`MenuProvider` primitive (`src/components/menu/`), which
already body-portals, positions via `useFloatingMenuPosition`, and rides
`OPEN_CHROME_MENU_Z` — see `ExternalChangeBadge` and `CollabStatusPill`'s
kebab menus, the two topbar status-cluster dropdowns, for the reference
wiring (`excludeRefs={[wrapEl]}` to exempt the outside trigger,
`trackAnchor` off the kebab ref). `TabPlusMenu` (the "+") and the Help
(`?`) menu also follow this rule; the `MyPapersPod` "Add paper" menu still
renders inline `absolute` but lives in the Library tab, away from the
editor's floating overlays — port it if that ever changes.

**Window insets / WCO title bar.** The bar's geometry is inset-aware. One
variable family — `--window-inset-{top,right,bottom,left}` (globals.css,
"Window insets" block) — is the SSOT for every OS/browser-reserved edge: it
reads the live `env(titlebar-area-*)` (Window Controls Overlay, opted into via
`app/manifest.ts`) and `env(safe-area-inset-*)` (notch; needs `viewport-fit=cover`,
set in the `viewport` export in `app/layout.tsx`). All resolve to **0 in a
normal browser tab**, so consuming them is a no-op off-install. The `.virgil-bar`
rule uses them to (a) grow the bar — `min-height: max(--bar-base-h,
--window-inset-top)` — so it BECOMES the reserved title-bar strip when Chrome's
PWA toolbar folds up, and (b) inset its material (`padding-left/right`) so the
tabs/buttons clear the window controls. WCO chrome is gated on the SSOT
selector `:root[data-display-mode="window-controls-overlay"]` (NOT a raw
`@media (display-mode: …)`): the bar is `-webkit-app-region: drag` (a native
window-drag handle); its content clusters are marked `no-drag` **wholesale**
(`.virgil-bar > *`) — an opt-in model, not an interactive-leaf allowlist, so a
non-semantic clickable child (e.g. a folder-tab `<div onClick>`) can't silently
become a dead drag region — and empty filler opts back into dragging with
`[data-window-drag-zone]`. It also nudges the bar's bottom seam 1px below the
OS titlebar-strip edge (`min-height: max(--bar-base-h, calc(--window-inset-top
+ 1px))`) so the `border-b` isn't clipped in the traffic-light gutter. Reactive
state (display mode, px insets) lives in
[`useWindowChrome`](hooks/useWindowChrome.ts) — a window-level store (exempt from
keystroke sanctity, like `DiskWatcher`) that mirrors `data-display-mode` onto
`<html>`; a pre-paint bootstrap in `layout.tsx` seeds it flash-free. Imperative
JS clamps read `getWindowInsetTopPx()`. **Any new top-anchored chrome should
keep clear of `--window-inset-top` rather than assuming `y=0`** (dialogs and
floating panels already do). Because the gate is the `data-display-mode` SSOT,
WCO chrome now renders in the dev preview too — set
`localStorage['virgil:wco-debug']='1'` (or append `?wco-debug`), which forces
the attribute AND injects synthetic insets.

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
