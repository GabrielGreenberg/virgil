# INV-1 — Card chrome & the drop button's home

Read-only investigation. Goal: map the card-header anatomy across every surface a card renders
in (docked panel, omni column, popped-out float) and pin the EXACT insertion site(s) for the new
"drop" button, the gating predicate, header-grab coexistence, deviant-header handling, and the icon
source. Feature (NOT implemented here): a far-right "drop" button (downward double-chevron) that on
mousedown-drag immediately enters drop-mode to (re)anchor a card. Old SHIFT-grab is retired.

---

## 0. TL;DR — the two insertion sites + one predicate

There are **THREE render surfaces** but only **TWO insertion points**, because the omni column
renders the *same* card components as the docked panel (so it shares the docked header), and a
popped card renders **chromeless** (its header moves up into `FloatChrome`):

1. **Docked + omni surface** → the unified header cluster in `PanelCard`,
   `src/components/panel-primitives.tsx:2010-2021`. Insert the drop button **between
   `<div className="flex-1" />` (`:2010`) and `{headerTrailing}` (`:2011`)** — or, to satisfy
   "to the LEFT of the X", insert it immediately **before the `CardJumpChevron`/`CardPopoutButton`
   block (`:2012-2020`)**. The X (`CardPopoutButton`, `:2019`) only renders when `isPoppedOut`, so on a
   DOCKED card there is no X — the drop button is simply the rightmost control. On the popped path this
   branch is not used (popped cards are `chromeless`).

2. **Popped-float surface** → `FloatChrome`, `src/floats/FloatChrome.tsx:94-123`. Insert the drop
   button **between `{trailing}` (`:94`) and the `canJump` jump-chevron block (`:95-116`)**, or
   immediately **before the final `<PopoutButton variant="x" …/>` (`:117-123`)** which is the X.
   That literally places it "to the LEFT of the X".

3. **Gating predicate** → a NEW registry-derived predicate, e.g. `hasDropAnchor(kind)` /
   `isDroppable(kind)`, that returns true iff `CARD_REGISTRY[kind].dropSpec != null`. This is the
   deepest SSOT: the per-kind `dropSpec` facet (`src/cards/types.ts:160`,
   `src/cards/predicates.ts` pattern) ALREADY encodes both "can this card re-anchor by drop" AND the
   per-kind placement (in-text vs margin). `bib`/`ai`/`error` have `dropSpec: null` → no button.
   See §6 for why this is the right gate and §4 for the deviant kinds it correctly excludes.

---

## 1. The unified header anatomy (PanelCard)

`PanelCard` (`src/components/panel-primitives.tsx:1687`) is the single source of truth for card
chrome. When a card passes a `kind` prop (and is not `chromeless`), `renderUnifiedHeader` is true
(`:1724`) and PanelCard owns the header. The header cluster:

```
:1960  <div className="flex items-center gap-1 px-2 h-6 …" data-card-header="1" …>
:2002    <CardDragHandle />                         ← leftmost grip (decorative, lift hint)
:2003    {footnoteBadge}                            ← footnote letter/number badge only
:2004    <CardKindHeader kind … options … />        ← kind label / morph dropdown (LEFT)
:2010    <div className="flex-1" />                 ← SPACER — everything after is far-right
:2011    {headerTrailing}                           ← status dots / claim pill / AI checkbox / 3-dot menu
:2012    {isPoppedOut && canJump && onJump && <CardJumpChevron onClick={onJump} />}
:2018    {onTogglePopout && isPoppedOut && <CardPopoutButton isPoppedOut onClick={onTogglePopout} />}  ← the "X"
:2021  </div>
:2022  {showSeparator && <div className="border-t …" />}
:2030  <div id={bodyId} style={{display:"contents"}}>{children}</div>   ← BODY
:2046  {onTrashClick && !isCollapsed && <CardTrashButton onClick={onTrashClick} />}  ← absolute bottom-right, NOT header
```

### The "X" — what it is, when it shows, z-order, click semantics

- **What:** `CardPopoutButton` (`:1531`), which renders `PopoutButton variant="x"` (`:1539-1544`).
  With `isPoppedOut=true` + `variant="x"` the SVG is a bare X (`popoutSvgInner`, `:1318-1322`). Its
  semantic is **dock the card back** (`onClick={onTogglePopout}`), label "Dock card".
- **When it shows:** ONLY when `onTogglePopout && isPoppedOut` (`:2018`). **A docked card shows NO X**
  in the unified header (ratified 2026-06-11 — drag-lift is the only pop-out path; comment at
  `:2015-2017`). So on the docked surface the drop button is the rightmost control; on the popped
  surface the unified-header branch isn't even used (popped = chromeless, the X lives in `FloatChrome`).
- **Z-order / click semantics:** `PopoutButton` (`:1385-1406`) fires on **`onMouseDown` with
  `preventDefault()`+`stopPropagation()`** (so the action beats the card's focus-driven select), and
  its `onClick` also `preventDefault`+`stopPropagation`s. It sets `draggable={false}` and swallows
  `dragstart`. Being a `<button>`, it is in `INTERACTIVE_CONTROL_SELECTOR` so the header lift skips it
  (see §5).

### "To the LEFT of the X", precisely

On the **docked** unified header the X is absent, so "left of the X" degenerates to "rightmost
control before the (absent) X" — i.e. insert at `:2012`, just before the `CardJumpChevron` /
`CardPopoutButton` block, so order reads `… {headerTrailing} · DROP · [jump] · [X] `. On the
**popped** surface "left of the X" is literal in `FloatChrome` (§2): insert before the final
`<PopoutButton variant="x">` at `:117`.

### The bottom-right trash button is NOT the X and NOT in the header

`CardTrashButton` (`:1555`, rendered at `:2046`) is absolute-positioned bottom-right
(`absolute bottom-1.5 right-1.5`), hover-revealed, red, gated on `onTrashClick && !isCollapsed`. It
does not collide with the header's far-right cluster. Irrelevant to the drop button.

---

## 2. The float chrome (popped card surface)

A popped card renders **chromeless**: e.g. `NoteCard` passes `chromeless={isPoppedOut}`
(`src/panels/Notes/NoteCard.tsx:162`), so `renderUnifiedHeader = kind != null && !chromeless`
(`panel-primitives.tsx:1724`) is FALSE and PanelCard emits **no header** — the body only. The header
moves up into AF's `FloatChrome`, rendered by `FloatWindow` (`src/floats/FloatWindow.tsx:162-170`):

```
:162  <FloatChrome
:163    title={…} titleNode={floatable.chromeSlots?.title}
:165    trailing={floatable.chromeSlots?.trailing}
:167    canJump={floatable.canJump} onJump={floatable.jumpToSource}
:169    onClose={() => ctx.close(key)} />
```

`FloatChrome` (`src/floats/FloatChrome.tsx:79-125`) layout: `grip · title · spacer · {trailing} ·
[jump] · X`. Exact lines:

```
:84   <FloatGrip />                          ← decorative 6-dot grip
:85   {titleNode ?? <span>{title}</span>}    ← kind label / morph dropdown
:93   <span className="flex-1" />            ← SPACER
:94   {trailing}                             ← chromeSlots.trailing (collab pill / 3-dot menu / per-card slot)
:95   {canJump && <button …jump chevron…/>}  ← jump-to-source
:117  <PopoutButton variant="x" … onClick={onClose}/>  ← the X (Dock)
```

**Insertion site:** between `{trailing}` (`:94`) and the `canJump` block (`:95`), or immediately
before the `<PopoutButton variant="x">` (`:117`). "Left of the X" → just before `:117`.

### A popped card IS still a card — so YES, the drop button belongs in the float header too

Because the popped card is chromeless and its header is `FloatChrome`, omitting the float-side
insertion would mean a popped card has NO drop button — which contradicts requirement (1) ("every
card that has a text anchor"). So the drop button must be added in **both** `PanelCard`'s unified
header (docked/omni) **and** `FloatChrome` (popped).

**How the gating predicate reaches FloatChrome:** `FloatChrome` is domain-neutral (imports nothing
card-specific — see its header comment, `:11-23`). It cannot call `hasDropAnchor(kind)` directly. Two
clean options, both registry-rooted (a design-call, not a code-resolvable question):
  - (a) Add a `canDrop: boolean` + `onDrop: () => void` (or a `dropNode`) to `FloatChromeProps`
    (`src/floats/FloatChrome.tsx:51-67`), populated by `FloatWindow` from a new `Floatable.canDrop`
    field that `cardFloatable()` sets from `CARD_REGISTRY[kind].dropSpec != null`
    (`src/cards/floats/index.tsx:72-132`). Mirrors how `canJump`/`onJump` already flow
    (`Floatable.canJump` → `FloatChrome`). **This is the symmetric, deepest path.**
  - (b) Carry the button in as a `chromeSlots` node. Rejected: `chromeSlots` budget is "1 trailing +
    1 title" (`src/floats/types.ts:35-48`); the drop button is its own affordance with X-adjacent
    placement, so it deserves a first-class chrome prop like jump, not a trailing squat.

The float-side drop gesture must call `beginDropSession({ cardKey: floatable.key, … })` with
`inPlace` NOT set (a popped float exists to dim — `markSourceFloat`). This is exactly what the
retiring SHIFT-grab at `FloatingPanel.tsx:432-441` does today (§7).

---

## 3. The float `bareWindow` exception (bib / ai)

`bib` and `ai` floats set `bareWindow: true` (`src/cards/floats/index.tsx:460,611`), so `FloatWindow`
**skips `FloatChrome` entirely** (`FloatWindow.tsx:145-155`) — they render their own bespoke in-body
header. So even on the float surface, bib/ai never see `FloatChrome`. This dovetails perfectly with
the gate: both are `dropSpec: null` / `anchored: false`, so they get NO drop button on any surface.
No special-casing needed.

---

## 4. Deviant headers (bypass the unified header)

### `BibEntryCard` — anchorless, NO drop button (confirmed)

`src/components/BibEntryCard.tsx` does **not** pass `kind` to `PanelCard` (`:452-464`), so
`renderUnifiedHeader` is false; it builds its OWN header div (`:468-519`) with a bespoke top-right
control cluster (`:523-565`: target icon + occurrence counter + a manual `CardPopoutButton` X at
`:542-544`). In the registry `bib` is `anchored: false`, `markerType: null`, `dropSpec: null`
(`src/cards/card-registry.tsx:284-287`, with the explicit comment "bib entries don't anchor to
text"). **Confirmed: bib is the anchorless exception → no drop button.** The gate
(`dropSpec != null`) excludes it automatically; no edit to BibEntryCard is needed.

### `AiRequestCard` — card-only, NO text anchor, NO drop button (confirmed)

`AiRequestCard` (`src/components/panel-primitives.tsx:2246`) is also bespoke: passes NO `kind` to
PanelCard (`:2290-2297`), builds its own header (`:2299-2359`) with its own X-shaped delete button
(`:2332-2350` — note this is a DELETE, not a dock/jump). In the registry `ai` is `anchored: false`,
`markerType: null`, `dropSpec: null` (`card-registry.tsx:465-468`). MEMORY corroborates:
"aiRequestMarker uprooted (AI requests are card-only)". **AiRequest has NO text anchor → no drop
button.** Excluded by the gate automatically; no edit needed.

> Net: both deviant headers are `dropSpec: null`, so a `dropSpec`-derived gate means the deviant
> code paths need ZERO changes — the button simply never appears there. This is the cleanest possible
> outcome and a strong argument for the `dropSpec` gate over an `anchored` gate (which would also
> exclude them, but `anchored` includes some kinds that nonetheless have no dropSpec — see §6).

---

## 5. Coexistence with the header grab (lift-to-pop-out)

### Docked / omni: the lift gesture skips buttons by construction

The header lift lives in `PanelCard.onWrapperMouseDown` (`panel-primitives.tsx:1771-1899`), wired via
the card root's `onMouseDown` (`:1932-1939`). Before arming, it bails if the press target
`closest()`-es `INTERACTIVE_CONTROL_SELECTOR` **within the header subtree** (`:1804-1805`):

```
:1804  const blocker = target.closest(INTERACTIVE_CONTROL_SELECTOR);
:1805  if (blocker && headerEl.contains(blocker)) return;
```

`INTERACTIVE_CONTROL_SELECTOR` (`src/lib/drag-blocklist.ts:26-27`) **includes `button`**. So a
`<button>` drop button inside the header is automatically excluded from the lift — pressing it does
NOT start the header lift. **No new blocklist entry required**, provided the drop button is a real
`<button>` (or carries `[data-no-window-drag]`).

BUT — the NEW button's own behavior is **mousedown-drag → immediately enter drop mode** (requirement
3), which is a *different* gesture from the lift. To keep the lift from also arming on the same press,
the drop button's `onMouseDown` must `stopPropagation()` (so it never reaches the card root's
`onMouseDown` at `:1932`). This is exactly the pattern every header button already uses:
`CardJumpChevron` (`:501` `onMouseDown={(e)=>e.stopPropagation()}`), `PopoutButton`
(`:1388-1392`), `CardTrashButton` (`:1565`). The drop button must additionally call
`e.preventDefault()` and set `draggable={false}` + swallow `dragstart` (the card root is
`draggable="true"` for cross-editor anchor drags — `EditableCard` `cardDraggable`, `:933`), matching
`PopoutButton` (`:1394-1398`). Its own window-level mousemove/mouseup then drive
`beginDropSession(...)`.

### Popped float: the window-drag blocklist also skips buttons

`FloatChrome` sits inside `FloatingPanel`, whose whole header strip is the window-drag surface
(`onHeaderMouseDown`, `FloatingPanel.tsx:419`). It bails when the target `closest()`-es
`WINDOW_DRAG_BLOCK_SELECTOR` (`:425-427`), which is `INTERACTIVE_CONTROL_SELECTOR + [data-card]`
(`drag-blocklist.ts:38`) — again **includes `button`**. So a `<button>` drop button in `FloatChrome`
won't start a window drag. Same `stopPropagation`/`preventDefault` discipline applies.

### Summary of the coexistence contract for the new button

Make it a `<button type="button">` that:
- `onMouseDown`: `e.stopPropagation()` (don't reach header-lift / window-drag) + `e.preventDefault()`,
  then arm its own drag-to-drop (snapshot origin, install window mousemove/mouseup, call
  `beginDropSession`).
- `draggable={false}` + `onDragStart` → `stopPropagation()`+`preventDefault()` (kill the root's HTML5
  anchor-drag for the press).
- Being a `<button>`, it is auto-excluded from BOTH the docked header lift and the float window drag
  by the shared blocklist — no blocklist edits.

---

## 6. The deep, SSOT-rooted gate — derive from `dropSpec`, not a parallel switch

Per Gabriel's standing steer (unify a whole class; derive from existing SSOTs), the gate should read
the **per-kind `dropSpec` facet** already on `CardMeta` (`src/cards/types.ts:160`).

### Why `dropSpec != null` is the right gate (and is already the placement SSOT)

- `dropSpec` is installed per kind at boot via `registerCardDropSpec` from
  `src/cards/drop-specs/index.ts:33-45`. The kinds that register a spec are exactly: note, highlight,
  todo, archive, cutter-comment, cutter-suggestion, revision-comment, revision-suggestion, report,
  report-request, footnote, citation, example. The kinds that register NOTHING (→ `dropSpec` stays
  `null`, `card-registry.tsx:284,466,484`): **bib, ai, error** — exactly the kinds with no drop
  button.
- `dropSpec.allowedPlacements` ALREADY encodes per-kind placement (requirement 5):
  - **in-text kinds** (footnote, citation) use `inlineAtomMoveSpec`
    (`src/panels/Citations/drop-spec.ts:10-13`, footnote analogous), `allowedPlacements:
    ["inline-cursor"]`, `targetScope: "any-editor"` (`util/inline-atom-move.ts:66-67`).
  - **margin kinds** (note, todo, archive, cutter, revision, …) use `textObjectSideReanchorSpec`
    (`src/panels/Notes/drop-spec.ts:14-22`), `allowedPlacements: ["paragraph-side"]`, `targetScope:
    "main-only"` (`util/text-object-side-reanchor.ts:32-33`).
  So the button does NOT need any per-kind placement logic of its own — it just `beginDropSession`s
  and the existing controller (`controller.ts:90-128`) + `lookupSpec`
  (`drop-mode/registry.ts:49-63`) route to the right spec, which already knows in-text vs margin.
  **The drop-mode machinery is the SSOT; the button is a new ENTRY POINT into it, not a new switch.**

### `dropSpec` gate vs the `anchored` gate — they differ; use `dropSpec`

`anchored` (`CardMeta.anchored`) is true for note/highlight/footnote/citation/archive/todo/cutter-*/
revision-*/report/report-request/example, and false for bib/ai/error. For the drop button these two
gates coincide TODAY on bib/ai/error (all `dropSpec=null` and `anchored=false`). But `anchored` is the
"three-surface hover membership" facet, NOT the "can re-anchor by drop" facet — and `example` is
`anchored: true` but is `origin: derived` (a mirror of a doc text-object). Whether `example` should
expose a user drop button is a genuine **design-call** (it has a dropSpec, so the `dropSpec` gate
WOULD show it). Recommend the gate be `dropSpec != null` (it is the precise "re-anchorable by drop"
SSOT) and explicitly confirm the `example` case with Gabriel. A new predicate:

```ts
// src/cards/predicates.ts — mirrors isPoppable (:55)
export const isDroppable = (k: CardKind): boolean => CARD_REGISTRY[k].dropSpec !== null;
```

Caveat for ordering: `dropSpec` is populated by a side-effect import (`@/cards/drop-specs`,
`drop-mode/registry.ts:23`). `predicates.ts` must NOT import the drop-spec module (cycle risk — the
registry header comment at `card-registry.tsx:10-25` is explicit). At the moment `isPoppable` is
called the float path has already imported the registrations; the docked card render likewise runs
after boot. **Open-verification:** confirm `@/cards/drop-specs` is imported before the FIRST card
header renders (it is imported transitively by the drop controller, which `EditorPane` mounts via
`DropModeProvider`; verify the import lands at module-eval, not lazily). If there's any risk the
button reads `dropSpec` before registration, gate instead on a STATIC facet (add an explicit
`droppable: boolean` to `CardMeta` set literally per kind, mirroring how `poppable` is a static facet
decoupled from the registered `toFloatable` — `types.ts:179-186`). The static-facet route is the more
robust deep solution and is recommended.

---

## 7. The retired SHIFT-grab paths (requirement 7) — what to remove/replace

Two `beginDropSession` call sites today; only the FIRST is the card SHIFT-grab to retire:

- **`src/components/FloatingPanel.tsx:432-441`** — `if (e.shiftKey && cardKey && mode==="floating")
  beginDropSession({cardKey, origin})`. THIS is the popped-card SHIFT-grab. The new float-side drop
  button (§2) replaces it. Retiring requirement (7) = delete this branch; the button becomes the only
  popped-card drop entry.
- **`src/text-objects/TextObjectGrabHandle.tsx:868-873`** — `beginDropSession({…, inPlace:true,
  externalCommit:true})`. This is the TEXT-OBJECT lifted-overlay ghost gesture (NOT shift-keyed, not a
  card). It is the lift-to-pop-out ghost path for text-objects and is **out of scope** for the card
  drop button — do not touch.

There is currently NO docked-card path into drop mode at all (docked cards can't SHIFT-grab — the lift
is the only header gesture, and it pops out, it doesn't drop). So requirement (4) "anchor an
unanchored card OR re-anchor an anchored card" from the DOCKED surface is a NET-NEW capability the
docked drop button provides — it lets you re-anchor without first popping out. The button on the
docked header `beginDropSession({ cardKey: <cardPopKey(kind,id)>, origin })`; `lookupSpec`/`parseAnyKey`
already handle the docked `cardPopKey` shape (`drop-mode/registry.ts:49-63`).

> NOTE for the planner: `beginDropSession` (`controller.ts:90`) currently assumes the gesture sources
> from a float (it calls `markSourceFloat` unless `inPlace`). For a DOCKED-card drop there is no float
> to dim. Pass `inPlace: true` for the docked entry (skips `markSourceFloat`) OR extend the controller
> — a design-call. For a POPPED-card drop (FloatChrome button) leave `inPlace` unset so the source
> float dims as today.

---

## 8. Requirement 6 — horizontal-band paragraph pick (already satisfied by hit-test)

For margin (paragraph-side) drops, the hit-test resolves the paragraph from
`editor.view.posAtCoords({left:x, top:y})` (`src/components/drop-mode/hit-test.ts:54`), walks up to the
nearest anchorable block (`resolveAnchorableBlock`, `:132`), and returns a `paragraph-side` placement
for any cursor y within the block's vertical extent (`inText = y>=top && y<=bottom`, `:97`, then the
`paragraph-side` branch at `:108-110`). `posAtCoords` clamps an x in the left/right margin to the
nearest in-line position, so "anywhere in the paragraph's horizontal band including the margins"
generally resolves. **Open-verification:** confirm `posAtCoords` returns non-null for an x well into
the editor's outer margin/gutter (far from glyphs). If it returns null there, requirement (6) needs a
small hit-test widening (resolve by y-band against block rects directly when `posAtCoords` is null).
This is a hit-test concern, not a chrome concern, but flagging it since it's requirement (6).

---

## 9. Icon source — author a new inline double-chevron-down SVG (no lucide)

- **There is NO icon library.** `package.json` has no `lucide` (grep empty). Every glyph in the app is
  a hand-written inline `<svg viewBox="0 0 24 24">`. Icon "modules" are
  `src/components/editor-layout/panel-icons.tsx`, `src/lib/actions/action-icons.tsx`,
  `src/components/stack/StackIcon.tsx` — all collections of inline-SVG React components, not a vendor.
- **Single chevron-down** glyph used app-wide is `<polyline points="6 9 12 15 18 9" />` (e.g.
  `panel-primitives.tsx:458` in the kind dropdown; `BibEntryCard.tsx:557`;
  `library/BibEntryPickerMenu.tsx:520`). The `Chevron` component (`panel-primitives.tsx:1253-1269`)
  draws a right-pointing chevron and rotates it.
- **There is NO existing double-chevron-down ("chevrons-down") glyph.** It must be authored as a NEW
  inline SVG with TWO stacked down-chevron polylines (lucide `ChevronsDown` geometry, drawn by hand):
  e.g. `<polyline points="6 7 12 13 18 7"/>` over `<polyline points="6 13 12 19 18 13"/>` on a
  `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor" strokeWidth≈2/2.5 strokeLinecap="round"
  strokeLinejoin="round"` — matching the existing chevron stroke vocabulary. Reuse the established
  button shell classes: docked header buttons use `w-4 h-4 flex items-center justify-center rounded
  text-ink-muted hover:text-ink-body` (see `CardJumpChevron`, `:504`) and `iconbtn-xs` in FloatChrome
  (`FloatChrome.tsx:121`). Recommend a single shared `CardDropButton` primitive in
  `panel-primitives.tsx` (next to `CardJumpChevron`/`CardPopoutButton`) reused by both the unified
  header and `FloatChrome`, so the glyph + gesture live once.

---

## 10. Anchors (file:line index)

- Unified header cluster + insertion zone: `src/components/panel-primitives.tsx:2010-2021`
- Header-lift gesture + blocklist bail: `src/components/panel-primitives.tsx:1771-1899` (bail `:1804-1805`)
- Card root onMouseDown (where lift arms): `src/components/panel-primitives.tsx:1932-1939`
- `CardPopoutButton` (the X) / `PopoutButton` / `CardJumpChevron` / `CardTrashButton` / `CardDragHandle`:
  `panel-primitives.tsx:1531`, `:1368`, `:490`, `:1555`, `:1505`
- `EditableCard` → PanelCard threading (`canJump`/`onJump`/`headerTrailing`/`chromeless`):
  `panel-primitives.tsx:949-1001`; `+T` `CardBodyTitle` is in the BODY (`:520`, used `:1093`), not the header
- `INTERACTIVE_CONTROL_SELECTOR` / `WINDOW_DRAG_BLOCK_SELECTOR`: `src/lib/drag-blocklist.ts:26-27,38`
- FloatChrome insertion zone: `src/floats/FloatChrome.tsx:93-123`
- FloatWindow renders FloatChrome / bareWindow skip: `src/floats/FloatWindow.tsx:145-175`
- `cardFloatable` shell (where to add `canDrop`): `src/cards/floats/index.tsx:72-132`; `bareWindow` bib/ai `:460,611`
- BibEntryCard deviant header + manual X: `src/components/BibEntryCard.tsx:452-565`
- AiRequestCard deviant header + delete: `src/components/panel-primitives.tsx:2246-2394`
- `CardMeta.dropSpec` facet + `registerCardDropSpec` indirection: `src/cards/types.ts:160`;
  `src/cards/card-registry.tsx:61-73`; registrations `src/cards/drop-specs/index.ts:33-45`
- `isPoppable` predicate pattern to mirror: `src/cards/predicates.ts:55`
- Drop controller `beginDropSession`: `src/components/drop-mode/controller.ts:90-128`
- `lookupSpec` dispatch: `src/components/drop-mode/registry.ts:49-63`
- Per-kind placement specs: `src/panels/Citations/drop-spec.ts:10`, `src/panels/Notes/drop-spec.ts:14`;
  factories `src/components/drop-mode/util/inline-atom-move.ts:66`,
  `src/components/drop-mode/util/text-object-side-reanchor.ts:32`
- Retired SHIFT-grab (card): `src/components/FloatingPanel.tsx:432-441`
- (Out-of-scope) text-object ghost drop: `src/text-objects/TextObjectGrabHandle.tsx:868`
- Paragraph-side hit-test (requirement 6): `src/components/drop-mode/hit-test.ts:54,93-110`
- Single-chevron glyph (icon convention): `panel-primitives.tsx:458`
