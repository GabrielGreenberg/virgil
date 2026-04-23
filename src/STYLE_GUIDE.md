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

Panels live under `src/panels/<Kind>/` — one folder per panel. Each folder
contains the panel component, its card component(s) (if any), an optional
omni builder, and an `index.ts` barrel. The taxonomy (panel kind, card
kind, popout key prefix, omni eligibility, default strip side) lives in
[`src/panels/panel-registry.ts`](src/panels/panel-registry.ts) — a single
source of truth that other systems (chrome, OmniView, popKey helper)
read from.

### Panel + CardListPanel (the wrappers)

Every panel uses one of two wrappers from `src/panels/_shared/`:

- **`Panel`** — the universal chrome (outer flex column, header, scroll
  body). Variants: `"list"` (default — applies `PANEL.list`) and `"raw"`
  (caller owns the body). Use `Panel` directly when there are no
  card-list semantics (Outline, Search, WordCount).
- **`CardListPanel<T>`** — wraps `Panel` and adds iteration over an
  `items` array, AI-requests section, and list/in-text view modes. Use
  for any panel whose body is "a list of cards." Pass `kind`, `items`,
  `getId`, `selectedId`, `onSelect`, `renderCard` (and optional
  `inTextRenderItem` + `inTextPositions` for the in-text mode).

```tsx
// Cardful panel — most common case
<CardListPanel
  kind="notes"
  items={sortedNotes}
  getId={(n) => n.id}
  selectedId={selectedNoteId}
  onSelect={onSelectNote}
  renderCard={(note, { selected }) => <NoteCard note={note} selected={selected} ... />}
  emptyState={<div className={PANEL.empty}>No notes yet.</div>}
  // Plus header/footer/scroll/in-text slots as needed.
/>

// Non-cardful panel — bespoke body
<Panel kind="outline" variant="raw" headerLeading={<OptionsMenu/>}>
  <div className="flex-1 overflow-y-auto p-1 relative">…tree…</div>
</Panel>
```

`Panel` requires only `kind` — title, popout, and close are wired
automatically from the registry + `PanelChromeProvider`. Available slots:

| Slot | Purpose |
|------|---------|
| `headerLeading` | Far-left of header (typically the options menu) |
| `headerTitleAfter` | Inline buttons cluster with the title (Outline's Edit/Focus/Lock) |
| `headerExtras` | Right-aligned header content (counter, view toggle) |
| `panelExtras` | Above the scroll body (search inputs, citation builder) |
| `footer` | Below the scroll body (Todo's archive bar) |
| `wrapperClassName` / `wrapperProps` | Spread onto the outer wrapper (Archive's capture-drop styling) |
| `onKeyDown` / `scrollTabIndex` | Keyboard nav on the scroll container |

`CardListPanel` adds: `aiRequests`, `viewMode`, `inTextPositions`,
`inTextRenderItem`, `inTextTrailing` (footnotes' orphan stack),
`listTrailing` (bibliography's pending requests).

### Container Pattern (legacy bare-bones)
Only the lower-level kit — `Panel` itself, the popout dispatcher in
`EditorLayout`, and the `Suggestions` panel — instantiates this raw
container directly. Real panels use `Panel`/`CardListPanel`.

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
The lower-level kit on which `Panel`/`CardListPanel` are built. It exports:
- `panelCard(selected, extra?)` — card className builder
- `PANEL` — class-string tokens (`.list`, `.cardInner`, `.subpod`, etc.)
- `PanelHeader` — standard header bar (used internally by `Panel`)
- `PanelChromeProvider` / `PanelClose` / `PanelPopout` — chrome plumbing
- `ItemMenu` + `MenuDelete` — three-dot context menu
- `TargetIcon` — jump-to-text bullseye
- `Chevron` — expand/collapse arrow
- `PrevNextCounter` + `useCycle` — prev/next navigation
- `AiRequestCard` + `AiRequestsSectionHeader` — AI request integration
- `HSplit` — horizontal draggable split divider

---

## PanelCard (universal card wrapper)

`PanelCard` (in `panel-primitives.tsx`) is the single source of truth for
card chrome. **Every card in the app** — `EditableCard` (footnotes, notes,
archive, cutter), `BibEntryCard`, `CitationCard`, `TodoRow`,
`RevisionCard`, `QuotationGroupCard`, `AiRequestCard` — wraps its
header/separator/body in a `<PanelCard>`. System-level look-and-feel
changes (popout position, trash placement, popped-out styling) land here,
not in individual panels.

`PanelCard` renders:
- the outer card `<div>` with `group relative`, themed border, selection
  state, and popped-out sizing
- an absolute top-right **popout button** (`CardPopoutButton`) — always
  visible, chevron when docked / X when floating
- an absolute bottom-right **trash button** (`CardTrashButton`) — small,
  red, hover-reveal — opt-in via `onTrashClick`

Because both buttons are absolute-positioned overlays, each card's header
reserves right-padding (`pr-7`) for the popout so trailing header content
doesn't sit under the button.

## EditableCard

`EditableCard` is the canonical card component for panels with editable
rich-text content (footnotes, notes, archive, cutter). It wraps
`PanelCard` and adds the rich-text body + header chrome (grab handle,
badge, title, inline toolbar, three-dot menu). Panels pass content-specific
data, not styling.

### Layout
```
[grab handle] [badge] [title input] ... [target icon] [menu]    [popout]
──────────────── separator ────────────────────────────────────
[RichTextField body]                                    
[optional footer]                                        [🗑 trash]
```

(The `[popout]` and `[🗑 trash]` markers sit in the absolute overlay layer
provided by `PanelCard`, not inside the flex header/footer rows.)

The **popout chevron** sits at the top-right corner of the card. It is
always visible (not hover-reveal) so the pop-out affordance is
discoverable at rest. The icon is a chevron while the card is docked and
an X while the card is floating (click the X to re-dock). Clicking
toggles the card between its panel-list slot and a `FloatingPanel` portal
— see *Card popout* below.

The **trash-icon delete** (opt-in via `inlineDelete` on EditableCard, or
`onTrashClick` on PanelCard directly) sits at the bottom-right corner of
the card. It is small, red (`text-danger`), and hover-reveal
(`opacity-0 group-hover:opacity-70`) so it does not clutter the resting
card surface.

### Opt-in features (props)
| Prop | Effect |
|------|--------|
| `grabHandle` | 6-dot grip as first header element; only the grip is draggable |
| `hideToolbar` | Suppresses the inline B/I/U toolbar (keyboard shortcuts still work) |
| `inlineDelete` | Small red trash icon in bottom-right corner instead of three-dot menu |
| `onEditorFocus` | Routes the focused Tiptap editor to MenuBar for toolbar integration |
| `onTogglePopout` / `isPoppedOut` | Opt in to the per-card popout button; usually left unset — wrapper cards supply these from context |

### Card popout
Any wrapper card (`NoteCard`, `FootnoteCard`, `ArchiveCard`, `CutCard`,
`TodoRow`, `BibEntryCard`, `CitationCard`, `RevisionCard`,
`QuotationGroupCard`, `AiRequestCard`) reads the shared `PoppedCardsContext`
(`src/hooks/usePoppedCards.ts`) to decide whether it is popped.

- **In a panel list**: if the context says popped, the wrapper returns
  `null` so the panel's list doesn't render it.
- **As a float**: `EditorLayout` iterates `prefs.poppedOutCards` and calls
  a top-level `renderPoppedCard(key)` dispatcher that rebuilds the card
  with `isPoppedOut={true}`. That prop makes the wrapper bypass the
  null-return and wrap itself in `<FloatCard>`
  (`src/components/FloatingCards.tsx`), which mounts a `FloatingPanel`
  portal with the rect from `useViewPrefs.cardFloatPositions`.

Keys are shaped `${kind}:${id}` and produced by `popKey(panelKind, id)`
or `cardPopKey(cardKind, id)` from
[`src/panels/panel-registry.ts`](src/panels/panel-registry.ts) — never
hand-rolled in card components. The canonical prefix per `CardKind`
lives in `CARD_KEY_PREFIXES`: `note, footnote, archive, cut, todo, bib,
citation, revision, quotation, ai`. (Note: the `comment` CardKind uses
prefix `revision` for backward compatibility with the original
panel name.) A card is rendered exactly once: either in the panel list
or in the float.

Because the dispatcher lives at the `EditorLayout` root, popped cards stay
visible even when the host panel's sidebar is closed — the dispatcher has
access to the same EditorLayout-scope state the panels consume, so data
flows to the float independently of panel mount state.

### Inline-entity ID stability

Footnotes and citations have no inherent identifier in a `.tex` file, so
the parser would otherwise mint a fresh UUID for each one on every load,
breaking any state keyed by those ids (popped-out cards, selection sync).
The serializer emits two no-op markers alongside each inline entity:

```latex
\vfid{<uuid>}\footnote{...}
\vcid{<uuid>}\cite{...}
```

Both are declared in the preamble as `\providecommand` no-ops so real
LaTeX compilation ignores them. The parser consumes a preceding
`\vfid`/`\vcid` into a pending-id slot and applies it to the next
`\footnote` or citation command; absent a marker, it falls back to a
fresh UUID (so legacy `.tex` files still open — the next save writes
the markers in). This lives in `src/lib/latex-serializer.ts`,
`src/lib/latex-parser.ts`, and the footnote-body parser/serializer in
`src/lib/footnote-content.ts`.

### Selection states
- **Every card has a persistent header strip** with its theme's default tint (`theme.headerDefault`) — it is always visible, whether or not the card is selected. This is a stylistic rule: selection intensifies the header, it does not introduce it.
- **Selected**: colored border around whole card, intensified header (`theme.headerSelected`), white body.
- **Default**: `bg-white border-stone-300 hover:border-stone-400 hover:bg-stone-50/50`, plus the always-on `theme.headerDefault` tint on the header row. The card outline (`stone-300`) is chosen to visually match the perceived edge weight of the pod/panel (which is a lighter `var(--border-light)` stroke plus an ambient shadow).
- Separator: `border-stone-200`, darkens to `border-stone-300` on hover; selected cards use `theme.separatorSelected`.
- Clicking anywhere in the card (header, title, body) auto-selects via `onFocusCapture`.
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
- Trash-icon button and Delete/Backspace key both go through `tryDelete()`
- If the card body has text content → shows `ConfirmDialog`
- If empty → deletes immediately
- The `ConfirmDialog` positions near the card (via `anchorRef`), not dead-center screen

### Drag behavior
- **Card handle** (6-dot grip in header): Drags the card entity (footnote atom, margin note anchor, etc.). Uses the whole card as the drag ghost (`setDragImage`), offset below cursor.
- **Text handle** (3-line icon in body gutter): Drags only the text content for inline insertion — no anchoring, no entity identity. Uses a neutral ghost (white bg, gray border). Appears on hover (`opacity-0 group-hover:opacity-60`).
- Both handles are disabled while RichTextField is focused
- Handle darkens on card hover (`group-hover:text-stone-500`)

### Sub-pods
Expandable sections within cards use sub-pod containers:
- **Muted bg** (notes, textareas): `PANEL.subpod` — `rounded-md border border-stone-200 bg-stone-50/70 p-3`
- **White bg** (rich text editors): `PANEL.subpodWhite` — `rounded-md border border-stone-200 bg-white`

---

## Panel Headers

`PanelHeader` is the underlying header primitive. In normal use, you
don't render it directly — it's wired by `Panel`, which exposes the
header slots (`headerLeading`, `headerTitleAfter`, `headerExtras`) plus
`title`/`count`/`onAdd`/`onAiRequest`. The header has a fixed height
(`--header-h: 34px`) and background (`--header-bg: #e8e5de`).

```tsx
// Typical use — through Panel/CardListPanel
<CardListPanel
  kind="footnotes"
  count={3}
  onAdd={handleAdd}
  onAiRequest={handleAi}
  headerLeading={<ItemMenu align="left">…</ItemMenu>}
  headerExtras={<PrevNextCounter current={idx} total={total} label="" />}
  …
/>

// Direct use is fine for one-off custom headers (the children slot
// holds right-aligned content).
<PanelHeader title="Outline" leading={<OptionsMenu/>}>
  <ExpandCollapseButtons />
</PanelHeader>
```

Children (counters, toggles, extra buttons) are right-aligned via flex spacer.

### Panel close + pop-out buttons
Every panel header ends with two buttons at the top right:
- `PanelPopout` — small square pod with an up-facing chevron underneath,
  pops the panel into a floating window. Greys out (disabled) when the
  panel is already popped out.
- `PanelClose` (rightmost) — an X that always closes the panel:
  collapses the column in single mode, removes the half in split mode,
  or closes the floater when popped out.

`Panel` (and the `PanelHeader` primitive it uses) wires both
automatically via `PanelChromeContext`. Bespoke headers that don't go
through `Panel`/`PanelHeader` should render `<PanelPopout />` followed
by `<PanelClose />` as the last two elements.

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

## System Dialogs

Every app-level modal (confirm, alert, prompt, new-document, tex-file
picker, document-class mismatch, AI window, preferences) composes from
the centralized primitives in
[`src/components/system-dialog.tsx`](components/system-dialog.tsx). The
tokens object in that file is the **one place to edit** to re-skin every
dialog in the app.

```tsx
import SystemDialog, {
  SystemDialogHeader,
  SystemDialogBody,
  SystemDialogFooter,
  SystemDialogButton,
} from "@/components/system-dialog";

<SystemDialog open onClose={cancel} size="sm" anchorRef={cardRef}>
  <SystemDialogHeader title="Delete this?" subtitle="Optional subtitle" />
  <SystemDialogBody>
    <p>This item has text. Delete it?</p>
  </SystemDialogBody>
  <SystemDialogFooter>
    <SystemDialogButton onClick={cancel}>Cancel</SystemDialogButton>
    <SystemDialogButton variant="danger" autoFocus onClick={confirm}>
      Delete
    </SystemDialogButton>
  </SystemDialogFooter>
</SystemDialog>
```

### Size presets

| size   | max-width              | Use for                          |
|--------|------------------------|----------------------------------|
| `sm`   | `340px`                | confirm, alert                   |
| `md`   | `380px`                | prompt, document-class mismatch  |
| `lg`   | `520px`                | new-document                     |
| `xl`   | `720px`                | larger forms                     |
| `full` | `min(96vw, 1100px)`    | AI window, preferences, dashboards |

### Button variants

| variant     | Use for                          |
|-------------|----------------------------------|
| `primary`   | Default destructive-confirm (stone-800) |
| `danger`    | Delete / irreversible (red-tinted)      |
| `secondary` | Cancel / dismiss                        |
| `accent`    | "Create" / positive commit (var(--accent)) |

The `autoFocus` prop on a button captures focus when the dialog opens and
enables Enter-to-confirm. Exactly one button per dialog should have it.

### Anchored vs. centered

`SystemDialog` accepts an optional `anchorRef` — a ref to the element that
triggered the dialog. When provided, the dialog positions just below the
anchor (clamped to viewport) instead of dead-center screen. Use this for
inline confirmations (e.g. "delete card" prompts near the card itself).

### Imperative API: `useSystemDialog`

For hook-level code that can't conveniently render a dialog component
(e.g. [useLatexCompile](hooks/useLatexCompile.ts)), use the imperative
API provided by `<SystemDialogProvider>` (mounted in
[`src/app/page.tsx`](app/page.tsx)):

```tsx
import { useSystemDialog } from "@/components/system-dialog-host";

const dialog = useSystemDialog();
await dialog.alert({ title: "Compile failed", message: "...", tone: "danger" });
const ok = await dialog.confirm({ title: "Move?", message: "..." });
const name = await dialog.prompt({ title: "Rename", initial: "foo" });
```

### ConfirmDialog convenience

For the common "confirm an action" pattern, use
[`ConfirmDialog`](components/ConfirmDialog.tsx) — a thin wrapper that
composes `SystemDialog` for you, plus `useConfirmDialog()` which returns
`{ confirm, dialog }` for in-tree imperative use. The dialog node mounts
once near the layout root; `confirm(...)` pops a confirmation from any
descendant.

```tsx
<ConfirmDialog
  open={confirmOpen}
  message="This item has text. Delete it?"
  confirmLabel="Delete"
  tone="danger"
  anchorRef={cardRef}
  onConfirm={...}
  onCancel={...}
/>
```

### Do / don't

- **Don't** call `window.alert` / `window.confirm` / `window.prompt` in
  app code — these drop the user into OS chrome and can't be themed. Use
  `useSystemDialog()` instead.
- **Don't** hand-roll a modal shell (`fixed inset-0 … bg-black/20` + a
  `rounded-xl` frame). Compose from `SystemDialog` so one edit re-skins
  everything.
- **Do** add a new button variant to `SYSTEM_DIALOG_TOKENS.button` rather
  than reaching for arbitrary Tailwind classnames inline.

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

---

## Link Architecture

Every connection between an in-editor element and a side-panel card is a
`Link`. Links are declared in [src/links/link-registry.ts](links/link-registry.ts),
modeled by a discriminated union in [src/links/_shared/types.ts](links/_shared/types.ts),
and manipulated through the unified API in [src/links/links.ts](links/links.ts).

### Three kinds

| Kind | Anchor | Marker | Connector | Multiplicity | Modes |
|---|---|---|---|---|---|
| `footnote` | inline atom | superscript number | on-select SVG curve | one | — |
| `citation` | inline atom | styled pill | on-select SVG curve | one | — |
| `anchor` | paragraph + optional text range | gutter icon (+ text-range highlight for Mode B) | none | many | A: paragraph only · B: paragraph + text range |

Mode is derived, not declared: an `anchor` link is Mode B iff
`anchor.textRange` is populated. `isModeB(link)` in
`src/links/_shared/types.ts` codifies this.

### Agent Legibility Contract

Every cross-document reference in Virgil follows one DOM contract, no
exceptions. Parsers (including Claude Cowork) may assume exactly these
three attributes:

- `data-link-id="<uuid>"` — the link's stable id.
- `data-link-kind="footnote | citation | anchor"` — which kind.
- `data-link-card="<cardKind>:<cardId>"` — the target card, in the same
  format used by `popKey()` in `panel-registry.ts`.

On the in-editor marker (footnote atom, citation atom, linkedAnchor
mark span): all three are present.

On the panel card element: `data-link-card` is present; multi-anchor
cards may also carry `data-link-ids="<id1> <id2> …"`.

### Tiptap JSON

The same three attrs appear on the serialized doc, so a fresh parse
can reconstruct the link graph without runtime state:

```jsonc
// footnote (inline atom)
{ "type": "footnote",
  "attrs": { "linkId": "...", "linkKind": "footnote", "linkCard": "footnote:...",
             "number": 4, "content": {...}, "title": "" } }

// citation (inline atom)
{ "type": "citation",
  "attrs": { "linkId": "...", "linkKind": "citation", "linkCard": "citation:...",
             "command": "\\citep{...}", "displayText": "..." } }

// anchor, Mode B — mark on a text range
{ "type": "text", "text": "contentious phrase",
  "marks": [{ "type": "linkedAnchor",
              "attrs": { "linkId": "...", "linkKind": "anchor",
                         "linkCard": "note:..." } }] }
```

Mode A anchor links have no inline node — their only in-doc trace is
the paragraph UUID on the anchorable node. They live in the target
card's sidecar. `derivedLinksForCard(cardKind, card)` in
[src/links/links.ts](links/links.ts) produces a canonical `Link[]`
from any card record (legacy-field-aware); this is the Cowork entry
point for reading card sidecars.

### Coupled highlight

Margin icon and Mode B text range share one highlight state, keyed by
`linkId`. Hovering or selecting either end lights up both — CSS-only,
driven by `data-link-highlight` written by
[useLinkHighlight](links/_shared/useLinkHighlight.ts).

The pref `alwaysShowLinkedText` (toggle in View → Marginalia) adds
`data-always-show-links="true"` on the editor root; CSS then gives every
Mode B text range a subtle persistent background, intensified on
hover/select.

### Multiplicity

`LINK_REGISTRY[kind].multiplicity` is `"one"` for `footnote` / `citation`
and `"many"` for `anchor`. Enforced at runtime in `createLink` via
`enforceMultiplicity`.

### Do / don't

- **Do** call `jumpToLink` / `resolveLink` / `deleteLink` — never reach
  into `editor.view.dom.querySelector('[data-<kind>-id=…]')` from a
  panel. The only canonical id attribute is `data-link-id`.
- **Do** add a new link kind by adding a `LinkRegistryEntry` and, if
  needed, a per-kind subfolder in `src/links/<Kind>/`.
- **Don't** add new `data-<kind>-id` or `data-<kind>-entry` attributes.
  Extend the unified contract, don't sidestep it.
- **Don't** add per-kind connector components; extend `LinkConnector`.
- **Don't** store anchor state in two places. For card sidecars, prefer
  `derivedLinksForCard` over reading legacy fields directly.
