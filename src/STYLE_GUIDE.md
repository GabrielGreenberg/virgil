# Virgil Style Guide

App-wide UI conventions and component patterns. Check this before building
new UI and update it whenever a decision feels generalizable.

---

## Semantic Color Tokens

Use the semantic tokens defined in `src/app/globals.css` instead of raw
Tailwind color utilities (`text-stone-*`, `border-stone-*`, `bg-stone-*`,
`text-red-*`, `bg-red-*`). The tokens let every instance of a role move
together when colors change, and they're the surface the user-preferences
picker edits.

| Use for | Token utility | CSS var |
|---|---|---|
| Card / popover / input bg (the "paper") | `bg-surface` | `--surface` |
| Subtle resting bg, list-item hover | `bg-surface-muted` | `--surface-muted` |
| Stronger hover (icon buttons, chips) | `bg-surface-muted-strong` | `--surface-muted-strong` |
| Modal scrim | `bg-[var(--overlay-scrim)]` | `--overlay-scrim` |
| Subtle borders (cards, dividers) | `border-edge-subtle` | `--edge-subtle` |
| Border on hover | `border-edge-hover` | `--edge-hover` |
| Input focus border | `focus:border-edge-strong` | `--edge-strong` |
| Disabled / idle drag handle | `text-ink-faint` | `--ink-faint` |
| Placeholder, icon default | `text-ink-muted` | `--ink-muted` |
| Subtitle / caption | `text-ink-subtle` | `--ink-subtle` |
| Section titles, body text | `text-ink-body` | `--ink-body` |
| Modal titles, strong text | `text-ink-strong` | `--ink-strong` |
| Destructive action text | `text-danger` | `--danger` |
| Destructive hover bg | `hover:bg-danger-soft` | `--danger-soft` |
| Drop-target ring | `ring-drag-target` | `--ring-drag-target` |

### Tokens that are locked together

Several tokens intentionally alias to a canonical counterpart so they can't
drift apart. Do not override them independently — change the canonical:

| Alias | Canonical |
|---|---|
| `--pod-editor` | `var(--surface)` |
| `--h1-color` | `var(--foreground)` |
| `--h2h3-color` | `var(--editor-text-color)` |
| `--scrollbar-hover` | `var(--muted-light)` |
| `--theme-color` | `var(--topbar-bg)` |

The aliased keys have been removed from the preferences tree — they surface
only via the canonical token in the picker.

### When raw Tailwind colors are still OK

- Per-panel chrome (footnote-red, note-emerald, bib-amber, AI-sky): these
  colors live in `CARD_THEMES` in `panel-primitives.tsx` and in
  `panel-theme.ts`'s `deriveCardPalette`. They're customized per panel via
  the header color picker — don't collapse them into global tokens.
- Primary-action button fills (`bg-stone-700`, `bg-stone-800`) where the
  darker stone is the intended visual. These are rare; consider adding a
  `--button-primary` token if you find yourself reaching for them often.
- Decorative one-offs (bibliography amber highlight, archive blue tint,
  comment-draft amber badge). If the same color starts recurring in ≥3
  places, promote it to a token.

---

## Icons

### AI Star
The AI/request icon is an **8-ray sun-star** (four cardinal lines + four
diagonal lines, rotated 15 degrees). Never use a traditional 5-point star
for AI-related actions.

```tsx
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
  <g transform="rotate(15 12 12)">
    <line x1="12" y1="2" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
  </g>
</svg>
```

---

## Panel Architecture

### Container Pattern
Every panel renders inside a flex column that fills its allocated space:
```tsx
<div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
  <PanelHeader ... />
  <div className={PANEL.list}> ... </div>
</div>
```
Always use `bg-transparent` on the outer wrapper — the pod/canvas system
controls panel background. Never set `bg-[var(--background)]` on a panel
container (it bleeds through on split views).

### Shared Primitives (`panel-primitives.tsx`)
All panels import from this file. It exports:
- `Card` — **the one card shell** (see below)
- `EditableCard`, `AiRequestCard` — specialized card variants
- `panelCard(selected, extra?)` — raw className builder (rarely needed directly)
- `PANEL` — class-string tokens (`.list`, `.cardInner`, `.subpod`, etc.)
- `PanelHeader` — standard panel header bar
- `ItemMenu` + `MenuDelete` — three-dot context menu
- `TargetIcon` — jump-to-text bullseye
- `Chevron` — expand/collapse arrow
- `PrevNextCounter` + `useCycle` — prev/next navigation
- `AiRequestsSectionHeader` — heading for the AI-request strip inside panel lists
- `HSplit` — horizontal draggable split divider

---

## Card

`Card` is the **one universal card shell** that every in-panel card composes.
Cross-cutting concerns (rounded border, theme colors, selection state,
delete affordance + confirm, drag source, drop-target wiring, text-drag
gutter, `data-prefs` + `data-panel-theme` annotations, popout plug point)
live here and nowhere else. Specialized cards just fill slots.

### Layout
```
[grab?] {header} [inlineDelete?] {headerTrailing?} [menu?] [popout?]
──────────────── separator ─────────────────────────────────────────
{body}
{footer?}
```

Items in `[brackets]` are injected by the shell when the corresponding
feature flag is set; items in `{braces}` are slots the variant fills.

### Slots & flags (most-used)
| Prop | Effect |
|------|--------|
| `header` | Free-form content row. Pass `null`/`undefined` to omit the header + separator entirely (used by CitationCard's edit mode). |
| `body` | Free-form body content. Padded by default via `bodyClassName` (defaults to `relative px-3 pt-1.5 pb-2`). |
| `footer` | Optional content below the body, outside body padding. |
| `headerTrailing` | Last slot before shell-injected menu/popout (typically `CardTargetIcon`). |
| `bodyClassName` | Override body padding when the variant wants different spacing (e.g. `PANEL.cardInner` for Bib/Citation/Revision). |
| `dragSource` | `"none"` / `"handle"` (6-dot grip) / `"whole-card"`. |
| `dragDisabled` | Disables whole-card drag (e.g. CitationCard while editing). |
| `onDragStart` | Required when `dragSource !== "none"`. |
| `onTextDragStart` | Renders the body-gutter 6-dot handle for text-only drags. |
| `onDragOver` / `onDragLeave` / `onDrop` | Drop-target wiring (used by CitationCard to accept bib drops). |
| `onDelete` + `deleteAffordance` | `"inline"` / `"menu"` / `"none"`. Inline renders an `[x]`; menu renders `MenuDelete` inside the three-dot `ItemMenu`. |
| `deleteConfirmWhen` + `deleteConfirmMessage` + `deleteConfirmLabel` | Gate delete on a `ConfirmDialog` when the predicate returns true (e.g. the card body has text). The dialog anchors to the card root. |
| `enableKeyboardDelete` | Defaults on when `selectable && onDelete`. Hooks Del/Backspace. Turn off for cards where keyboard delete is undesired (e.g. RevisionCard). |
| `isFocused` | Pass `true` when the body (or any variant-specific input) has focus. Disables whole-card drag and inline-handle drag while editing. |
| `onSelect` + `selectable` | Shell wires `onClick`, `onFocusCapture` auto-select, and `tabIndex`. |
| `onTogglePopout` + `isPoppedOut` | Plug point for card-level popout. Renders a `CardPopoutButton` trailing the header when set. |
| `onHoverChange` | Fires on mouseenter (true) / mouseleave (false). |
| `panelThemeKey` | Annotates the header with `data-panel-theme=<key>` so preference-mode ctrl+click edits the matching palette. |
| `rootRef` | Callback for the card's root DOM node (used by panels that need to scroll a card into view). |
| `title` | Native tooltip on the card root. |
| `wrapperClassName` / `wrapperStyle` | Variant-specific extras (dashed border for unanchored CitationCard, drop-target ring, opacity for done todos, etc.). |
| `dataAttr` / `extraDataAttrs` | `data-<name>=<value>` annotations for selection-anchor sync, omni view, etc. |

### Variants
| Variant | File | What it fills |
|---|---|---|
| `EditableCard` | `panel-primitives.tsx` | Builds `header={badge + headerContent + toolbar portal}` and `body={<RichTextField>}`; tracks RichTextField focus to feed `isFocused`. Used by Footnote, Note, Archive, Cutter. |
| `AiRequestCard` | `panel-primitives.tsx` | Sky-tinted wrapper (`aiRequestCard` helper on theme), whole-card drag, inline delete with "discard if non-empty" confirm. |
| `TodoCard` | `TodoPanel.tsx` | Grab-handle drag, badge + checkbox + text input in the header slot, notes textarea in the body; tracks `editing` and `notesFocused` to feed `isFocused`. |
| `BibEntryCard` | `BibEntryCard.tsx` | Whole-card drag, custom header (author · year · title + occurrence counter), sub-pod body with bib fields + annotation editor. |
| `CitationCard` | `CitationsPanel.tsx` | Whole-card drag, drop target (accepts bib drops to append keys), header with bib-key chips; edit mode sets `header={null}` to take over the whole card with `CitationBuilder`. |
| `RevisionCard` | `CommentPanel.tsx` | No drag, menu-based delete, bespoke body (turns + reply + resolve); `panelThemeKey="revision"`. |

### "Add feature X to every card"
The card shell is the one and only place to grow cross-cutting behavior.
Adding a feature to every card = editing `Card` in `panel-primitives.tsx`
and (usually) the variant's slot construction. Examples already in place:
- Selection border, focus-capture auto-select, keyboard Delete.
- Inline-delete [x] / three-dot menu with optional confirm.
- Text-drag gutter handle in body.
- Popout plug point (`onTogglePopout`).
- Preference-mode annotations (`data-prefs`, `data-panel-theme`).

### Selection states
- **Every card has a persistent header strip** with its theme's default tint (`theme.headerDefault`) — always visible. Selection intensifies the header, it does not introduce it.
- **Selected**: colored border around whole card, intensified header (`theme.headerSelected`), white body.
- **Default**: `bg-surface border-edge-hover hover:border-edge-strong hover:bg-surface-muted/50`, plus the always-on `theme.headerDefault` tint on the header row.
- Separator: `border-edge-subtle`, darkens to `border-edge-hover` on hover; selected cards use `theme.separatorSelected`.
- Clicking anywhere on the card auto-selects via `onFocusCapture`.
- Clicking empty panel space deselects (panels add `onClick={() => onSelect(null)}` to list container).

### Shared sub-components (`panel-primitives.tsx`)
| Component | Usage |
|-----------|-------|
| `BadgeLabel` | Anchored badge with label (number/letter), themed colors |
| `BadgeOrphaned` | Unanchored badge: local-color square with corner-to-corner cross, 60% opacity |
| `CardTitleInput` | Par-title styled input (`--par-title-color`, `0.78rem`, weight 500, sans-serif) |
| `CardTargetIcon` | Page-with-arrow icon: full opacity when selected, 60% when unselected, 30% when disabled |

### Unanchored (orphaned) cards
Unanchored cards share the same wrapper styling as anchored cards — no
dashed border. The unanchored state is communicated through two opt-in
signals at the panel level:
1. **`BadgeOrphaned` as the badge** — local-color square with diagonal cross, shown instead of `BadgeLabel`.
2. **`CardTargetIcon` with `disabled`** — greyed-out, non-clickable jump icon (30% opacity).

Panels detect orphaned state from their data (`paragraphIds.length === 0`)
and pass the appropriate badge/target-icon props.

### Card themes (`CARD_THEMES`)
Each theme provides: `cardClass`, `headerDefault`, `headerSelected`,
`separatorSelected`, `badgeBg`, `badgeColor`, `badgeBorder`, `titleColor`,
and an optional `override` palette populated when the user picks a
custom color for the panel. Panels reference themes, never hardcode
colors.

Available themes:
- `footnote` — reddish
- `note` — emerald
- `archive` — amber/blue-grey
- `todo` — stone/grey
- `bib` — warm tan (bibliography entries)
- `citation` — warmer yellow (in-text citations)
- `comment` — neutral stone (revisions/comments)
- `aiRequest` — sky (AI request drafts)
- `cut` — red (cutter pieces)

`headerDefault` is roughly half the opacity of `headerSelected` so that
selection intensifies the header rather than introducing it.

### Per-panel color theming

Every panel whose header menu contains the list/page view toggle
(Citations, Bibliography, Footnotes, Notes, Archive, Quotations) also
exposes a **color-picker swatch** to the left of that toggle. Picking a
color overrides the panel's default theme and re-colors every element
tied to that panel: card header tint, selection border, separator,
badge, title, marginalia gutter icon, and — for panels that render
linked-anchor highlights (notes, revisions, cutter) — the in-text
highlight color.

Implementation:
- Base colors live in `src/lib/panel-theme.ts` (`DEFAULT_PANEL_COLORS`,
  `PRESET_COLORS`). User overrides persist to `localStorage` under
  `virgil-panel-colors`.
- `useCardTheme(panelKey)` in `src/hooks/usePanelTheme.ts` returns the
  active `CardTheme` — either the static default or a derived palette
  when an override is set. Consumers apply the palette through
  `cardOverrideStyle`, `headerOverrideStyle`, and `separatorOverrideStyle`
  helpers (in `panel-primitives.tsx`) so inline styles override the
  Tailwind classname defaults without touching the hover behavior.
- `Marginalia.tsx` derives its per-type marker palette from the matching
  panel override; `EditorLayout.tsx` does the same for linked-anchor
  highlights.
- `<PanelThemePicker panelKey="…" />` (in `PanelThemePicker.tsx`)
  renders the swatch + preset popover. Insert it inside each panel's
  three-dot menu, next to the ViewToggle.

### Delete behavior
- Inline [x] button and Delete/Backspace key both route through the shell's internal `tryDelete()`.
- If `deleteConfirmWhen?.()` returns true → shows `ConfirmDialog` anchored to the card root.
- If the predicate is absent or returns false → deletes immediately.
- `deleteAffordance` controls where the control lives: `"inline"` (header [x]), `"menu"` (three-dot menu with `MenuDelete`), or `"none"`.

### Drag behavior
- **Grab handle** (6-dot grip, shown when `dragSource="handle"`): Drags the card entity (footnote atom, margin note anchor, etc.). Uses the whole card as the drag ghost (`setDragImage`), offset below cursor.
- **Whole-card drag** (`dragSource="whole-card"`): the card root is `draggable`. Automatically disabled while `isFocused` is true, or when `dragDisabled` is set (e.g. CitationCard in edit mode).
- **Text handle** (6-dot grip in body gutter, shown when `onTextDragStart` is set): Drags only the text content for inline insertion — no anchoring, no entity identity. Uses a neutral ghost (white bg, gray border). Appears on hover.
- The grab handle is disabled while `isFocused` is true; the text handle likewise.
- Handles use `text-ink-faint` at rest and darken to `text-ink-subtle` on card hover.

### Sub-pods
Expandable sections within cards use sub-pod containers:
- **Muted bg** (notes, textareas): `PANEL.subpod` — `rounded-md border border-stone-200 bg-stone-50/70 p-3`
- **White bg** (rich text editors): `PANEL.subpodWhite` — `rounded-md border border-stone-200 bg-white`

---

## Panel Headers

All panels use `PanelHeader` for their title bar. The header has a fixed
height (`--header-h: 34px`) and background (`--header-bg: #e8e5de`).

```tsx
<PanelHeader title="Footnotes" count={3} onAdd={handleAdd} onAiRequest={handleAi}>
  <PrevNextCounter current={idx} total={total} label="" />
  <ViewToggle mode={viewMode} onChange={setViewMode} />
</PanelHeader>
```

Children (counters, toggles, extra buttons) are right-aligned via flex spacer.

---

## Top Bar

The top bar uses `--topbar-bg` (`#e5e4e1`), a warm-neutral shade close to
panel headers (`#e8e5de`) but slightly cooler (red-blue spread 4 vs 10).

### Background & Border
- Container: `bg-[var(--topbar-bg)]`
- Bottom border: hardcoded `#d5d3ce` in `.top-bar-border::after`

### Default Icon/Text
All non-logo elements use `text-stone-500` (not `var(--muted)`) for
sufficient contrast on the darker background.

### Hover Convention
Buttons **lighten** on hover (opposite of white-background panels):
- Generic buttons: `hover:bg-white/30 hover:text-[var(--accent)]`
- AI button: `hover:bg-sky-50/50 hover:text-sky-600`
- Never use `hover:bg-stone-100` (darkening) on the top bar

### Active Tab
Active tabs retain `bg-[var(--background)]` — the lighter surface pops
against the darker bar.

---

## Navigation Controls

### Prev/Next Chevrons
When a counter (e.g. "3 of 12") has up/down navigation arrows, the two
chevrons are **stacked vertically** beside the number — not laid out
horizontally. Use a `flex flex-col` wrapper with `-space-y-0.5` to keep
them compact.

### PrevNextCounter + useCycle
Most panels with ordered items use `useCycle` for keyboard ↑/↓ navigation
and `PrevNextCounter` in the header to show position. The counter shows:
- `"0 items"` when empty
- `"N items"` when nothing is focused
- `"i+1 of N"` when navigating

---

## Confirmation Dialogs

`ConfirmDialog` positions near the element being acted on, not dead-center
screen. Pass `anchorRef` to position the dialog just below the triggering
element. Without `anchorRef`, it falls back to centered (legacy behavior).

```tsx
<ConfirmDialog
  open={confirmOpen}
  message="This item has text. Delete it?"
  confirmLabel="Delete"
  tone="danger"
  anchorRef={cardRef}    // positions near the card
  onConfirm={...}
  onCancel={...}
/>
```

---

## Target Icon (Jump to Text)

The target icon is a small page with an arrow pointing into it (18x18).
Always visible on cards at varying opacity:
- **Selected**: full opacity
- **Unselected**: 60% opacity
- **Disabled** (unanchored): 30% opacity

Use `CardTargetIcon` from panel-primitives for consistent behavior.
Placement: rightmost element in the card header row.

---

## View Modes (List / In-Text)

Panels with anchored items support two view modes via `ViewToggle`:
- **List**: Standard `PANEL.list` scrollable stack with `space-y-2` gaps.
- **In-text**: Cards absolutely positioned to align with editor scroll height.
  Uses `useInTextPositions` hook and `in-text-connector` CSS classes.

Toggle button: pill with two icons, active button gets `bg-white shadow-sm`.

---

## Buttons

### Primary Action
Accent-colored background for main submit/add actions:
```
bg-[var(--accent)] text-white hover:opacity-90
```

### Secondary Action
Neutral stone for less prominent actions (Insert, Copy, Archive):
```
text-stone-500 bg-stone-100 hover:bg-stone-200 hover:text-stone-700 border border-stone-200
```

### Warm Accent Action
For actions that are prominent but not primary (Restore, etc.):
```
text-[var(--accent)] bg-[var(--accent-light)] hover:brightness-95 border border-stone-200
```
Never use `bg-blue-50` or other cool tones for action buttons — the app's
palette is warm (browns, ambers, stones).

### Danger Action
Delete/destructive actions in menus:
```
text-red-500 hover:bg-red-50
```

### Resolve/Confirm
Positive confirmation actions:
```
text-emerald-600 hover:text-emerald-700 font-medium
```

---

## Section Labels

Thin uppercase labels that divide card groups within a panel list:
```
text-[10px] font-medium text-stone-500 uppercase tracking-wide px-2 mb-1.5
```
With a top border when separating sections:
```
mt-2 pt-2 border-t border-stone-200
```

---

## Empty States

Use `PANEL.empty` for consistent empty-state messaging:
```
p-6 text-center text-sm text-[var(--muted)]
```

---

## AI Request Integration

Panels that support AI-assisted content creation include:
- `AiRequestsSectionHeader` — thin uppercase label with count
- `AiRequestCard` — sky-blue-tinted draggable card with star icon

AI request cards appear at the top of the list, before the panel's own items.

---

## Drag & Drop

Draggable items use custom ghost images matching their category color:
- **Footnotes**: `#fef2f2` bg, `#b45757` border (red)
- **Notes**: emerald tones
- **Citations**: amber/yellow tones
- **Archive**: `#f5f5f4` bg, `#d6d3d1` border (stone)
- **AI requests**: `#e0f2fe` bg, `#7dd3fc` border (sky blue)

Ghost elements are appended to body, positioned offscreen, and removed
after `requestAnimationFrame`.

---

## Colors & Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `var(--accent)` | `#7c5e3c` | Primary accent (warm brown) |
| `var(--accent-light)` | `#f5f0ea` | Light accent background |
| `var(--muted)` | `#8a8580` | De-emphasized text |
| `var(--muted-light)` | `#b5b0aa` | Very subtle text (timestamps, hints) |
| `var(--border)` | `#e5e2dd` | Standard borders |
| `var(--border-light)` | `#efecea` | Subtle/inner borders |
| `var(--background)` | `#faf9f7` | Canvas background |
| `var(--header-bg)` | `#e8e5de` | Panel header background |
| `var(--topbar-bg)` | `#e5e4e1` | Top bar background (cooler than header) |
| `var(--header-h)` | `34px` | Panel header height |

### Category Colors (badges, markers)
| Category | Primary | Background | Border |
|----------|---------|------------|--------|
| Footnotes | `#b45757` | `#fef2f2` | `#b45757` |
| Notes | `#15803d` | `#f0fdf4` | `#86efac` |
| Citations | `#6b6245` | `#fdf8e1` | `#e0d5a8` |
| LaTeX comments | `#7191b0` | `#f0f5fa` | `#a8c4de` |
| Archive | `#7191b0` | `#f0f5fa` | `#a8c1d8` |

### Selection
Selected cards have a colored border + shadow with tinted header, white body:
- **Footnotes**: `border-red-300`, header `bg-red-50/60`
- **Notes**: `border-emerald-300`, header `bg-emerald-50/60`
- **Archive**: `border-amber-300`, header `bg-amber-50/60`
Body text always stays full dark (`#44403c`), never white-on-colored.

### Highlight / Attention Color
When a UI element needs to signal "active attention point" or "hidden
content below" — e.g. the outline's current-position lozenge or a folded
heading's chevron — use the footnote red: `var(--footnote-color, #b45757)`.
This is the app's canonical "reddish highlight" and keeps attention cues
consistent across the editor, outline, and margin gutter.

---

## Margin Elements (Marginalia)

- **Grid**: 2 columns per gutter side (`MARGINALIA_COLS = 2`).
- **Icon size**: 22px squares with 2px row gap.
- Markers are **draggable** (cursor: grab) and support keyboard delete.
- Quotes and notes support **multi-anchor** (same item linked to
  multiple paragraphs).
- Drag indicator: **vertical line** on the gutter side spanning the
  full paragraph height. Horizontal ProseMirror drop cursor is hidden
  during paragraph-linking drags.
