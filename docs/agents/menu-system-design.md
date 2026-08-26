<!-- last-verified: 2fe534d 2026-06-16 -->

# The `<Menu>` primitive — design doc

> **Status: BUILT + SHIPPED (2026-06-16).** The registry-provider architecture (below) is
> implemented in `src/components/menu/` and **8 of 9 menus are migrated onto it** on `main`
> (grab, lightning/Cmd-/, heading, tab, color, MenuBar block-type + view-menu, label-ref,
> bib-picker), suite green, app integration-healthy live. R1 (the aria-activedescendant premise)
> was spiked live and PASSED before build. R6 nested-key ownership is active.
>
> **The ONE deliberate exception — `SlashCommandPopup`** (user decision, 2026-06-16): it stays a
> ProseMirror plugin and is NOT migrated. It already has full arrow nav; absorbing it onto the
> primitive (the R2 dual-backend `registryFor` seam, §2.3/§6 R2) is consistency-only with real risk
> and zero user-facing change. The `registryFor` adapter + contract type remain in the primitive as
> the available seam if absorption is ever wanted.
>
> **Deferred polish** (functional today via Enter/click/Up-Down; Left/Right is the ideal affordance):
> (a) `ViewMenu` Right=expand/Left=collapse — needs a list `onArrowHorizontal(dir, activeId)` hook in
> `useMenuKeyboard.consume` (before `reg.move` for left/right), threaded through `MenuProvider` (the
> combobox path has its own `onArrowHorizontal`; the window-source list path does not yet);
> (b) the color swatch row navigates Up/Down — could adopt the new `orientation="horizontal"` for
> Left/Right (needs its test updated); (c) a real-keypress **Phase D** live a11y/keyboard smoke is
> owed (synthetic events can't exercise native-caret suppression — best driven by a human pressing
> real arrows in each menu).
>
> Original design rationale follows (historical). This doc was the agreed target after a 3-design
> bake-off (compound-components vs. headless-hook vs. registry-provider) judged against the live
> code; the chosen architecture is **the registry-provider** with two grafts.

## 0. The problem in one paragraph

Virgil has ~12 floating menus/popovers. Each one hand-rolls its own portal,
`useFloatingMenuPosition` call (or a bespoke positioner), a deferred-mousedown
click-outside `useEffect`, an Escape handler, and — where it has keyboard nav at
all — its own arrow/letter logic. The two heaviest menus (the **lightning** panel
behind <kbd>Cmd</kbd>-<kbd>/</kbd> and the **grab-bar** menu) have **no arrow
navigation today** — only a letter fast-path over a `window`-capture keydown
listener. The slash menu owns its nav in a ProseMirror plugin. The input-bearing
popovers (label-ref, bib-picker) re-implement combobox nav by hand and disagree on
ARIA. We want **one primitive** that owns nav + positioning + dismissal + ARIA, so
every open menu becomes arrow-drivable, every menu keeps the editor caret where it
is, and the per-menu boilerplate collapses.

## 1. Chosen architecture (3 lines)

1. **A headless `<MenuProvider>` owns a live item-registry**; items self-register
   via a `useMenuItem(...)` hook (bespoke JSX) or a `<MenuItemsFromRegistry>` mapper
   (registry-driven grab/lightning), and `<MenuProvider>` owns the one
   `useFloatingMenuPosition` call, the one dismissal effect, and the ARIA wiring.
2. **A single `useMenuKeyboard` controller** runs roving `aria-activedescendant` nav
   over the registry's ordered, region-tagged snapshot — list / grid / composite —
   with **no DOM focus move**, so the editor caret never shifts.
3. **A non-React `registryFor(...)` adapter** lets the ProseMirror slash plugin be a
   *registry backend* (its `selectedIndex`/`filtered` become the cursor+snapshot)
   behind the **same** `{ items(), move(), activate() }` contract — so the slash menu
   is *absorbed*, not carved out as an exception.

### Why this one (and the two grafts)

The winning bet is **registry-as-contract**. It is the only design that (a) lets the
15 bespoke SVG grid cells in the lightning panel self-register *without rewriting
them into data rows or `render=` props*, and (b) folds the PM slash plugin into the
**same** abstraction via an adapter onto its already-existing read+command seam
(`slashPopupStore` subscription + `executeSlashSelectionAt(view, index)`, verified
in `src/lib/tiptap/slash-popup.ts:220` and `src/components/SlashCommandPopup.tsx:126`).

Two ideas are grafted from the runner-up designs:

- **Graft from the compound-component design (A):** the composite layout is declared
  **structurally and explicitly** as sibling regions — `<MenuGrid cols={4}>` above
  `<MenuList>` — with an **authored cross-region edge** (remembered last grid
  column). The grid↔list seam is genuinely new logic that exists in *no* current
  menu, so it must be authored and testable, not implicitly inferred from coords.

- **Graft from the headless-hook design (B):** the *consumption surface* is
  **prop-getters**, and the keyboard-source split is **first-class**. `useMenuItem`
  registers into the provider's registry **and returns getters** to spread onto
  existing JSX (so a menu migrates without a markup rewrite — the lowest-blast-radius
  path). Two keydown sources are explicit: a `window`-capture listener for
  editor-focused command menus vs. an input `onKeyDown` for input-bearing comboboxes,
  plus an `onEscape?: () => boolean` interceptor and a `trackAnchor` RAF-coalesced
  scroll re-anchor.

## 2. Public API

### 2.1 `<MenuProvider>` — the headless owner

Renders nothing visible itself; it establishes `MenuRegistryContext`, portals (or
docks) a positioned container, installs the single dismissal effect, and mounts the
keyboard controller.

```tsx
<MenuProvider
  id="lightning"                       // stable menu id; activedescendant ids derive from it
  layout="composite"                   // "list" | "grid" | "composite" | "combobox"
  role="menu"                          // "menu" | "listbox" (drives ARIA fork, §3.3)
  anchorRect={rect}                    // DOMRect | () => DOMRect  (thunk for caret-anchored)
  placements={[{ side: "below", align: "start" }, { side: "above" }]}
  portal                               // default true; false => docked inline (MenuBar)
  letterShortcuts                      // enable the bare-key O(1) fast-path
  dismissOn={{ escape: { stopPropagation: true } }}   // see §3.2; default true editor-anchored
  excludeRefs={[colorPopoverRef]}      // extra click-outside exemptions (nested popovers)
  onEscape={() => false}               // return true to consume Escape without closing (two-stage)
  trackAnchor={() => measureRect()}    // optional RAF-coalesced scroll/resize re-anchor
  onClose={close}
>
  <MenuGrid cols={4}>{/* bespoke FmtBtn cells, each calling useMenuItem */}</MenuGrid>
  <MenuList>
    <MenuItemsFromRegistry rows={cardActionRows("lightning")} />
  </MenuList>
</MenuProvider>
```

### 2.2 Declaring items — two sources, one registered shape

A `MenuNode` is the registry's internal record:

```ts
interface MenuNode {
  id: string;                          // unique within the menu
  region: "grid" | "list" | "widget";  // "widget" = focus-island, skipped by roving (native <input>)
  coords?: { row: number; col: number }; // grid only
  disabled: boolean;                   // stays VISIBLE, skipped by nav, inert on activate
  letter?: string;                     // bare-key fast-path (e.g. "F")
  run: () => void;                     // activation handler
  domId: string;                       // `${menuId}-item-${id}`, the activedescendant target
  ref: HTMLElement | null;
}
```

**(a) Bespoke JSX (hard-coded menus, lightning grid cells, ViewMenu rows, swatches)**
— each element registers itself and gets back getters:

```tsx
function FmtBtn({ id, coords, ... }) {
  const { active, getItemProps } = useMenuItem({
    id, region: "grid", coords, run: () => applyFormat(...),
  });
  return <button {...getItemProps()} data-active={active}>{icon}</button>;
}
```

`getItemProps()` returns `{ role, id, "aria-disabled", tabIndex: -1, "data-active",
onClick, onMouseEnter, ref }`.

**(b) Registry-driven (grab + lightning list)** — one mapper emits a `<MenuItem>`
per `cardActionRows(...)` row, carrying `row.run` / `row.letter` / the resolved
`applies(ctx) === "disabled"` flag (verified shape at `DragHandleMenu.tsx:120`):

```tsx
<MenuItemsFromRegistry rows={cardActionRows("grab")} />
```

So `DragHandleMenu` and the lightning list share one renderer. Both sources populate
the **same** snapshot; the nav controller is source-agnostic.

### 2.3 `registryFor(menuId)` — the PM-slash adapter

A non-React function returning the registry contract the slash plugin drives:

```ts
interface MenuRegistryHandle {
  items(): MenuNode[];          // ordered, region-tagged snapshot
  move(dir: NavDir): void;      // step the cursor
  setActive(id: string): void;
  activate(): void;             // run the active node
}
```

For the **React backend** these are state operations. For the **PM-slash backend**,
`registryFor("slash")` reads the plugin's live `filtered` + `selectedIndex` as the
snapshot+cursor and `move()` dispatches the existing meta-only transaction
(`view.state.tr.setMeta(META_KEY, { …, selectedIndex })`, verified at
`slash-popup.ts:161`), `activate()` calls `executeSlashSelectionAt`. **This dual
backend is the design's known leaky seam** (§6 R2): `move()` is synchronous setState
in one and async tx-dispatch in the other. The contract is enforced by a shared
TypeScript type + a coverage test, and the React view consumes only the cursor for
its highlight.

## 3. Behavior models

### 3.1 Navigation — roving `aria-activedescendant`, no focus theft

**This is the load-bearing choice.** The provider holds `activeId` in state. The
active node gets `data-active` (CSS `[data-active]` paints the highlight, exactly as
`SlashCommandPopup.tsx:118` and `LabelRefPopover.tsx:291` already do), and its
`domId` is mirrored to the focus-holding element's `aria-activedescendant`. **Items
never receive `.focus()`** — so the ProseMirror caret never moves and selection is
never stolen. This matches today's behavior precisely: the grab and lightning menus
keep the editor focused and fire letter-keys via a `window`-capture listener
(`DragHandleMenu.tsx:168`, `ActionsMenuPanel.tsx:352`).

> ✅ **R1 spike PASSED (live, 2026-06-16).** A pre-build probe on the live editor proved
> the coexistence mechanics: (a) setting `aria-activedescendant` on the focused editor
> does NOT steal focus (`document.activeElement` stays the PM view); (b) a `window`-capture
> keydown listener fires and its `stopPropagation()` prevents the arrow from ever reaching
> the editor's own keydown handler (a bubble listener on the contentEditable was not
> reached) — so window-capture beats PM's keydown by construction; (c) `emitCount` delta 0.
> The one part not synthetically testable — `preventDefault` suppressing *native* caret
> motion — is spec-standard (the slash popup + menu Escape already rely on it) and gets a
> real-keypress confirmation in Phase B's manual smoke. The nav model is cleared to build.

**The two keydown sources (graft from B):**

- **Editor-focused command menus** (grab, lightning, heading, tab-plus, view): one
  capturing `keydown` on `window`, installed **only while the menu is open**. It
  `preventDefault()`s only the keys it consumes (Arrows / Home / End / Enter / Space
  / Escape) so the editor caret never moves and those keys never reach PM's
  `handleKeyDown`; all other keys pass through to the editor untouched.
- **Input-bearing comboboxes** (label-ref, bib-picker, color-with-input): **no**
  window listener. The owned `<input>`'s `onKeyDown` calls the controller; real focus
  stays in the input (single-line, so we `preventDefault` arrows to stop caret
  motion), `aria-activedescendant` sits on the input.

**Per-layout key maps over the snapshot:**

| Layout | Keys |
|---|---|
| `list` | Up/Down step (wrap), Home/End jump to first/last enabled |
| `grid` | Left/Right within a row (by `coords.col`), Up/Down between rows (by `coords.col`) |
| `composite` | grid nav until an edge crossing (§3.4) |
| all | Enter/Space → `activate()`; Escape → dismissal (§3.2) |

**Disabled-skip:** the navigable order is `snapshot.filter(n => !n.disabled)`.
Disabled nodes stay **rendered and visible** (greyed) but are stepped over and inert
on activate — preserving today's visible-disabled behavior (`DragHandleMenu.tsx:217`
where `disabled` rows render at `opacity: 0.45`; the registry's
`applies() === "disabled"`).

**Letter-shortcut coexistence:** when `letterShortcuts`, the controller builds an
`O(1)` `Map<upperLetter, id>` from nodes carrying `letter`. A bare single-char key
with no modifier checks the map **before** the arrow branch; a hit (and not disabled)
activates immediately. Arrows and letters are two independent branches in one
handler — pressing **F** still runs Footnote and **Down** still moves
(replacing the linear `entries.find(m => m.row.letter === letter)` at
`DragHandleMenu.tsx:158` with a faster lookup). The grab menu's Backspace/Delete →
delete (`DragHandleMenu.tsx:148`) registers as a letter-alias.

### 3.2 Dismissal

One `useMenuDismiss({ containerRef, excludeRefs, onClose, defer })` inside the
provider replaces the deferred-mousedown click-outside copy-pasted across
`DragHandleMenu.tsx:164`, `ActionsMenuPanel.tsx:361`, `HeadingTypeMenu.tsx:67`,
`SelectionColorPopover.tsx:76`, `TabPlusMenu.tsx`, `LabelRefPopover.tsx` (rAF
variant), and `BibEntryPickerMenu.tsx:174`. It:

- registers a **capture-phase `mousedown` on a `setTimeout(…, 0)` / rAF defer** so the
  opening click can't self-close;
- tests `containerRef.contains(target)` **plus** an `excludeRefs` set — covering the
  lightning panel's need to *not* close when the click lands in its spawned color
  popover (today's brittle
  `document.querySelector('div[aria-label="Text color"]')` at
  `ActionsMenuPanel.tsx:366`, replaced by a real ref the child popover registers),
  and bib-picker's `anchorEl` + `externalInputEl` exemptions
  (`BibEntryPickerMenu.tsx:178-179`);
- a **nested `<MenuProvider>` auto-registers itself into its parent's exclude set**.

**Escape is owned by the same controller** with a `stopPropagation` flag.
`dismissOn.escape.stopPropagation` defaults **true** for any editor-anchored menu,
reproducing the load-bearing `e.stopPropagation()` at `ActionsMenuPanel.tsx:338` (a
**verified** comment: it keeps Escape from reaching `tab-indent.ts`'s Escape→blur
handler and dropping the editor selection). **Two-stage Escape** (first clears the
filter / collapses the dropdown, then closes) is expressed via the `onEscape?: () =>
boolean` interceptor: return `true` to consume without closing. *(Note: today's
`LabelRefPopover` Escape is single-stage — `:100`, `:263` — so two-stage is an
enhancement we add, not behavior we must preserve.)*

### 3.3 Positioning — absorbing `useFloatingMenuPosition`

The provider owns **one** `useFloatingMenuPosition({ anchorRect, placements, gap,
margin })` call (the existing hook, unchanged — `useFloatingMenuPosition.ts:136`,
signature verified) and merges its returned `ref` + `style` into the container via
`getMenuProps()`. The hook's `visibility: hidden`-until-measured contract
(`:251`) handles off-screen-measure-then-place uniformly.

- **The 5 menus already on the hook** (grab `:128`, lightning `:137`, tab-plus,
  +2) migrate by **deleting their own call**.
- **The hand-rolled positioners fold in as `placements`:**
  - `HeadingTypeMenu.tsx:45` (manual below/flip-above) →
    `[{ side: "below", align: "start" }, { side: "above" }]`
  - `SelectionColorPopover.tsx:50` → same
  - `LabelRefPopover.tsx:72` (centered-below, flip-above) →
    `[{ side: "below", align: "center" }, { side: "above", align: "center" }]`
  - MenuBar's `BlockTypeDropdown` / `ViewMenu` — these use manual
    `getBoundingClientRect` + Tailwind `top-full`/`bottom-full`/`right-0` classes
    rendered **in-tree** (`MenuBar.tsx:234`, `:362`, `:372-373`). Two options: (i)
    `portal={false}` docked-inline path, or (ii) — **cleaner** — migrate them onto
    the portal+hook path since they already compute fixed coords. **Decision:** start
    with `portal={false}` docked to preserve the toolbar's stacking context exactly,
    revisit (ii) only if the in-tree absolute path drifts (§6 R4).

**Two capabilities the hook lacks today — add them in Phase B:**

1. **`maxHeight` passthrough.** `BibEntryPickerMenu.tsx:283` computes a viewport-fit
   `maxHeight` clamp. Add an optional `maxHeight` slot the chosen placement computes
   from available space and the provider passes through to the container style.
2. **`trackAnchor` scroll re-anchor (graft from B).** The hook deliberately omits
   scroll (`useFloatingMenuPosition.ts:13-17`). Three menus open-code a scroll/resize
   re-read (slash caret, bib-picker, tab-plus). A `trackAnchor?: () => DOMRect`
   option RAF-coalesces a scroll/resize re-read and re-feeds `anchorRect`, unifying
   them. **The slash menu stays the positioning exception**: its anchor is a doc
   caret position (`coordsAtPos`, RAF-coalesced), so it supplies a `getAnchorRect()`
   thunk rather than a static rect.

`portal` defaults `true` (createPortal to `document.body`, the norm); `portal={false}`
skips the portal and renders inline-relative for MenuBar's docked dropdowns.

### 3.4 The composite grid→list seam (explicit, graft from A)

The lightning panel is the one menu exercising **both** region types under one
provider, and the cross-region edge is **new logic in no current menu** — so it is
authored explicitly, not inferred:

- Regions are ordered top-to-bottom: `<MenuGrid cols={4}>` then `<MenuList>`. Grid
  nodes carry `coords: { row, col }`; list nodes are 1-D.
- **Down off the last grid row** (`coords.row === maxGridRow`) → first non-disabled
  list item; the controller **remembers `lastGridCol`**.
- **Up off list index 0** → grid cell at `{ row: maxGridRow, col: lastGridCol }`
  (clamped to the actual cells in that row — a partial last row must not land on a
  phantom cell, §6 R3).
- Left/Right only fire inside the grid region.

### 3.5 ARIA — `menu` vs `combobox`/`listbox`

`role` forks two patterns (today's menus genuinely split):

- **`role="menu"`** → container `role=menu` + `aria-activedescendant`, items
  `role=menuitem` + `aria-disabled` (matches `DragHandleMenu.tsx:185/216`,
  `HeadingTypeMenu.tsx`, `TabPlusMenu.tsx`). Checkbox rows (ViewMenu) become
  `role=menuitemcheckbox` + `aria-checked`; the current-level checkmark
  (HeadingType, BlockType) is `aria-checked`/`data-current`.
- **`role="listbox"` + an owned `<input role="combobox" aria-expanded aria-controls
  aria-activedescendant>`** → the input-bearing popovers. Focus **stays in the
  input**, arrows drive `aria-activedescendant` over the listbox, options are
  `role=option aria-selected`. This **fixes today's inconsistency**: `BibEntryPicker`
  is `role="dialog"` wrapping a `role="listbox"` (`:298`, `:363`, `:459-460`), and
  `LabelRef` has **no list ARIA at all**. Both converge on the combobox pattern.

`activedescendant` ids are `${menuId}-item-${id}` so they're stable and
collision-free across nested menus.

## 4. Per-menu migration table (all 12)

> **The table's thirteenth row was never written, and that is how its rows sat
> keyboard-DEAD for a release cycle (task 477).** `ItemMenu` — the ⋮ in every
> panel header AND on every card — folded onto the primitive in task 180 and
> onto `AnchoredMenu` in 143, and appears in this table nowhere: only its SHELL
> was ever scheduled. Its children stayed hand-written `<button>`s
> (`MenuDelete`, `MenuArchive`, `CardViewModeMenuItems`' three View rows,
> Bibliography's two filter rows and its export command, Citations' package and
> style groups), so every one of those menus opened a `role="menu"` container
> with **zero `menuitem`s** while `useMenuKeyboard`'s window-CAPTURE listener
> consumed Enter / Space / every arrow on their behalf and activated nothing.
> Most of them also bound `onMouseDown` only, so they were never
> keyboard-activatable even before the swallow.
>
> Migrated in task 477 onto `MenuActionRow` (commands, with a `danger` tone) and
> `MenuToggleRow` (the `menuitemradio` spelling for the three mutually-exclusive
> sets). Three primitive changes fell out of it, each stated where it lives:
> `MenuProvider.closeOnActivate` (the MENU-layer twin of
> `AnchoredMenu.closeOnInsideClick`, because the keyboard controller runs a row
> by calling its handler directly and produces no click to bubble),
> `AnchoredMenu`'s own `getActiveDescendantHost` (its trigger — no anchored menu
> passed one, so arrow-nav moved a highlight assistive tech was never told
> about), and `useMenuKeyboard` consuming Enter/Space only when something
> actually RAN, so a future unregistered menu degrades to Tab+Enter instead of
> to silence. CI: `menu/__tests__/menu-row-registration-census.test.ts` (the
> census, allowlist EMPTY) and
> `components/__tests__/item-menu-row-keyboard.test.tsx`.

| Menu | File | Fit | How it migrates |
|---|---|---|---|
| **DragHandleMenu** (grab) | `DragHandleMenu.tsx` | **clean** | `layout="list"`, `role="menu"`, portal. `<MenuItemsFromRegistry rows={cardActionRows("grab")}>`; `disabled` from `row.applies()`. **Gains arrows** (none today). Letter fast-path + Backspace/Delete→delete preserved via the letter map. Drops its own keydown/mousedown/position effects. |
| **ActionsMenuPanel** (lightning, Cmd-/) | `ActionsMenuPanel.tsx` | **hard — headline** | `layout="composite"`: `<MenuGrid cols={4}>` of the 15 bespoke `FmtBtn` cells (each `useMenuItem` with `coords`, no rewrite) ABOVE `<MenuList>` from `cardActionRows("lightning")`. Cross-region edge (§3.4). `dismissOn.escape.stopPropagation: true` preserves `:338`. Color/BlockType cells are nested-menu triggers (see bottom rows). **Gains Up/Down/Left/Right + Enter** (only letters + Escape today). |
| **BlockTypeDropdown** (MenuBar + nested in lightning grid) | `MenuBar.tsx:202` | **adapter-needed** | `layout="list"`, `role="menu"`. In MenuBar: `portal={false}` docked. As a lightning grid cell: a **sub-menu** — opening it pushes onto a provider stack so only the topmost controller's keydown is live; Escape pops one level back to the grid. Current-level `aria-checked`. Manual `getBoundingClientRect` (`:234`) → `placements`. |
| **ViewMenu** (MenuBar) | `MenuBar.tsx:297` | **hard** | Nested **expandable** groups + checkbox rows, `portal={false}` docked. Expandable rows register `expandable: true`; expanded children register/unregister so the snapshot grows/shrinks; Right/Enter expands, Left collapses; `aria-expanded` on group rows, `role=menuitemcheckbox` + `aria-checked` on toggles. **Largest render-shape stretch** (the flat `region`+`coords` model strains for arbitrary-depth trees — §6 R5). |
| **SlashCommandPopup** (PM plugin) | `slash-popup.ts` + `SlashCommandPopup.tsx` | **adapter — the seam** | **Absorbed, not excepted.** The PM plugin stays the nav owner for state durability (its `selectedIndex`/`filtered` are canonical, mirrored to `slashPopupStore`). `registryFor("slash")` exposes them behind the standard contract; `handleKeyDown` (`slash-popup.ts:152`) delegates Up/Down/Enter to the controller; the React view subscribes to the same cursor for its highlight and consumes `getMenuProps` for position + ARIA only. Positioning stays caret-anchored via a `getAnchorRect()` thunk. |
| **HeadingTypeMenu** | `HeadingTypeMenu.tsx` | **clean** | `layout="list"`, `role="menu"`, portal. Hard-coded JSX rows each `useMenuItem`; `disabled` levels stay visible + arrow-skipped; current-level `aria-checked`. Manual positioner (`:45`) → `placements`. **Gains arrows** (Escape + click-outside only today). |
| **SelectionColorPopover** | `SelectionColorPopover.tsx` | **adapter-needed** | Horizontal swatch row + native `<input type="color">` + clear. `layout="list"` with horizontal orientation (Left/Right over swatches). The native color input registers as `region="widget"` (a focus-island — skipped by roving, reachable by Tab). Stays `role="dialog"` (no filter input today); borrows only positioning + dismissal + the parent-exclude registration (so lightning doesn't close when you click a swatch). |
| **LabelRefPopover** | `LabelRefPopover.tsx` | **adapter-needed** | `layout="combobox"`, `role="listbox"`. Input keeps focus; listbox over `combinedOptions` (`:160`, already a combined `[...headings, ...examples]` index). Its `activeIndex` (`:66`) **is** the controller's cursor; existing `scrollIntoView` (`:171`) replaced by the built-in. Group headings (Sections/Examples) are visual dividers, **not** nav stops. Two-stage Escape via `onEscape` (an enhancement — currently single-stage). Adds the list ARIA it lacks today. |
| **BibEntryPickerMenu** | `BibEntryPickerMenu.tsx` | **adapter-needed** | `layout="combobox"`, `role="listbox"`. Already has `selectedIndex` + `scrollIntoView` (`:253`) + ArrowUp/Down (`:225`). **External-input mode** (`:260-271`): provider accepts `externalInputEl` as the combobox input + keydown source + dismiss-exemption. **ArrowLeft/Right = expand/collapse row detail** (`:238`) — a combobox-specific binding the region must be allowed to override via an `onArrowHorizontal` hook. `maxHeight` clamp (`:283`) needs the §3.3 passthrough. |
| **TabPlusMenu** | `TabPlusMenu.tsx` | **clean** | `layout="list"`, `role="menu"`, portal. Already on the hook (`:104`) + `aria-haspopup`. RecentPaperRow + action rows register as items. Multi-exclude dismissal (wrap + portaled menu) via `excludeRefs`. Scroll-anchor refresh → `trackAnchor`. **Pure win** — gains arrows, loses ~25 lines of boilerplate. |
| **Lightning grid cell → color/figure/ref spawns** | `ActionsMenuPanel.tsx:242,254` | **adapter-needed** | A grid cell's `run()` opens a child popover. The child mounts its **own** `<MenuProvider>`; the parent registers the child container into `excludeRefs` so click-outside doesn't close it; key control hands to the child (provider stack); Escape pops back to the grid. The single most fiddly nested-menu case. |
| **Composite grid→list seam** | (lightning, restated) | **hard** | Covered by §3.4. Called out separately because it's the one place exercising both region types + the authored cross-region edge — the highest-regression-risk new logic. |

## 5. Phased rollout

### Phase B — build the primitive + the 2 hardest reference menus, then MERGE

Build `<MenuProvider>` / `useMenuItem` (getters) / `useMenuKeyboard` /
`useMenuDismiss` / `registryFor` and the `maxHeight` + `trackAnchor` additions to
`useFloatingMenuPosition`. Adopt the **two hardest** menus as living references:

1. **Grab-bar** (`DragHandleMenu`) — the clean registry-driven reference; proves
   list nav + letter coexistence + disabled-skip + the registry mapper.
2. **Lightning** (`ActionsMenuPanel`) — the composite reference; proves grid + list +
   the cross-region edge + nested sub-menu (color/BlockType) + the load-bearing
   Escape `stopPropagation`.

**Merge gate (Phase B DoD):** both menus behave identically to today (letter
shortcuts, Escape-doesn't-blur-the-editor, disabled greyout, click-outside with the
color-popover exclusion) **plus** new arrow nav; `window.__virgilBusStats()`
`emitCount` stays flat while arrowing/typing in an open menu (§6 keystroke note);
full unit coverage of the §3.4 edge matrix. Merge here so the fan-out in Phase C
runs against a landed primitive.

### Phase C — fan-out per-menu migrations on **disjoint files**

Each menu is its own commit/PR on a separate file, so they parallelize and never
collide:

- `HeadingTypeMenu.tsx` (clean) · `TabPlusMenu.tsx` (clean) — quick wins first.
- `LabelRefPopover.tsx` · `BibEntryPickerMenu.tsx` — the combobox pair (share the
  combobox keydown-source + `onEscape` + `maxHeight` work; do them adjacently).
- `SelectionColorPopover.tsx` — the `role="dialog"` / `region="widget"` adapter.
- `MenuBar.tsx` `BlockTypeDropdown` + `ViewMenu` — the docked + expandable-tree pair,
  **last** (most invasive; the in-tree positioning + collapsible-snapshot churn).
- `SlashCommandPopup.tsx` + `slash-popup.ts` — the `registryFor` adapter wiring; the
  React view drops its bespoke highlight derivation onto the shared cursor.

### Phase D — live keyboard verification + a11y

In the dev preview (load `virgil-data/doc_devtest`), per the preview-internals memo:

1. **Prove the activedescendant premise (§6 R1).** Open each menu, drive arrows via
   synthetic events, assert (a) the ProseMirror caret position is unchanged
   (`editor.state.selection`), (b) `document.activeElement` is the editor (or the
   combobox input), never a menu item, (c) `__virgilBusStats().emitCount` is flat.
2. **Nested-menu provider stack (§6 R6).** Open the lightning color/BlockType
   sub-popover from a grid cell; confirm arrows drive only the child (no double-fire),
   Escape pops one level, and the parent doesn't self-close on an inner click.
3. **Escape propagation (§6 R7).** Open the lightning menu, press Escape, confirm the
   editor does **not** blur and the selection survives (the `tab-indent.ts` seam).
4. **Screen-reader audit** of the menu-vs-listbox role flips.

## 6. Risk register

| # | Risk | Mitigation |
|---|---|---|
| **R1** | ~~`aria-activedescendant` on a container while a `contentEditable` PM view holds focus is unverified.~~ **RESOLVED — pre-build R1 spike PASSED live (2026-06-16):** no focus steal, window-capture intercepts before PM (stopPropagation), emit delta 0 (see §3.1). | Mechanics proven; native-caret suppression (spec-standard) gets a real-keypress check in Phase B/D. The fallbacks (focusable proxy / take-focus-restore-on-close) are no longer needed. |
| **R2** | **Dual-backend `registryFor()` leak.** `move()` is sync setState (React) vs. async tx-dispatch (PM). Timing/async semantics differ; the two can drift. | Shared TS contract type + a coverage test asserting both backends satisfy `{ items(), move(), activate() }`; the React view is strictly a one-way subscriber to the cursor (mirrors the existing `slashPopupStore` flow). |
| **R3** | **Composite cross-region edge** (`lastGridCol` memory, disabled-skip at the seam, partial-last-row clamp). New logic in no current menu; a wrong index strands the user. | The §3.4 edge is authored (graft from A) + a focused unit test matrix in Phase B (every grid corner ↔ list head, with disabled rows at the seam, with a partial last row). |
| **R4** | **MenuBar docked (`portal={false}`) is the least-exercised path** — in-tree absolute placement may drift from today's `top-full`/`right-0` CSS. | Migrate the docked dropdowns **last** (Phase C); keep `portal={false}` to preserve the stacking context; only consider the portal+hook path (clean option ii) if drift appears. |
| **R5** | **ViewMenu's arbitrary-depth expandable tree strains the flat `region`+`coords` model.** | Treat ViewMenu as the honest tree case: register/unregister expanded children so the snapshot mutates; if the flat model proves insufficient, add parent/child links to `MenuNode` rather than forcing coords. Scoped to one file, done last. |
| **R6** | **Nested provider key-ownership.** If parent + child both capture `window` keydown, arrows double-fire. | A `MenuStackContext`: only the topmost provider's controller is live; others early-return on `!isTopOfStack`. Escape pops one level. Verified in Phase D.2. |
| **R7** | **Escape `stopPropagation` default must be right per menu** or either the editor blurs (`tab-indent.ts`) or Escape stops working in a parent. | Default `true` for editor-anchored menus (reproduces `ActionsMenuPanel.tsx:338`, verified); per-menu audit in the migration; Phase D.3 regression check. |
| **R8** | **Click-outside multi-exclude regressions.** A forgotten `excludeRefs` entry (color popover, `externalInputEl`, tab-plus wrap) self-closes on a legitimate click. | Nested providers auto-register into the parent's exclude set; the bespoke exemptions become real refs, not `querySelector` strings; covered by the Phase D.2 nested test. |

### Keystroke-sanctity note

The keyboard interception is **O(1) per keypress and entirely outside the editor
transaction path** — it adds **no** entry to the permitted-`editor.on(...)`-subscribers
list in `AGENTS.md`:

- The active-item **snapshot is an array rebuilt only on a registration-version bump**
  (mount/unmount/disabled-flip), never per keystroke. Arrow handling is index
  arithmetic + a precomputed `Set` membership check for disabled-skip over a length
  ~11–16 array — **never `doc.descendants`, never a doc read**.
- The letter fast-path is a single `Map<letter, id>.get(key)` — strictly cheaper than
  today's linear `entries.find(...)` (`DragHandleMenu.tsx:158`).
- The `window`-capture listener is mounted **only while a menu is open** (the same
  mounted-while-open pattern the current menus use and that `SlashCommandPopup`
  follows), and bails O(1) on any non-nav/non-letter key. It is **not** an
  `editor.on('update' | 'transaction')` subscriber and touches no `DocStructureBus`
  event — typing N plain characters leaves `__virgilBusStats().emitCount` unchanged.
- The slash adapter's `move()` dispatches a PM meta-only tx — but that is the
  **existing** behavior (`slash-popup.ts:161`; `apply()` bails O(1) on the meta
  branch), firing only on an actual arrow while the popup is open, not on plain
  typing. The primitive adds no second keystroke consumer on the editor.
- `aria-activedescendant` (no `.focus()`) also avoids the focus-churn reflows a
  roving-`tabindex` would cause while arrowing.
