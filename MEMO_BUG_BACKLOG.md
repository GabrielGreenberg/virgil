# Bug & polish backlog

Running list of bugs / UX rough edges noticed while central work is in flight on
`main` (can't be worked through inline). To be **drained in a dedicated manage
session** (chip-dispatch pattern) once the central work settles.

Append new items at the bottom. Keep each item self-contained: current behavior,
desired behavior, a file:line pointer, and any open design question so the
implementer doesn't have to re-derive scope.

Status legend: `open` · `in-progress` · `done`

---

## 1. Inline-math popup: save-by-default, add a Cancel button

**Reported:** 2026-06-05 · **Status:** open · **Area:** main-text / math editing

**Current behavior** — `MathPopover` ([src/components/MathPopover.tsx](src/components/MathPopover.tsx))
uses a two-key model:
- **Enter** → `commit()` (save) — [:139](src/components/MathPopover.tsx:139)
- **Escape** → `cancel()` (discard) — [:105](src/components/MathPopover.tsx:105)
- **Click-outside** → `commit()` (save) — already saves — [:89](src/components/MathPopover.tsx:89)
- Hint text: "Enter to save · Esc to cancel · Shift+Enter for newline" — [:147](src/components/MathPopover.tsx:147)

**Desired behavior** — make **saving the default on any dismissal** (Enter,
click-away, blur, and Escape), and surface an explicit **Cancel button** as the
sole way to revert. The user shouldn't have to remember to press Return; closing
the popup commits, and the only discard path is the visible button.

**Scope (small):** click-outside already commits, so the change is mostly:
1. Add a Cancel button to the popover UI (`cancel()` is already wired — [:80](src/components/MathPopover.tsx:80)).
2. Repoint Escape (and any blur path) from `cancel()` → `commit()`.
3. Update the hint text at [:147](src/components/MathPopover.tsx:147) to match the new model.

**Open question for the implementer:** the user said "escape to cancel" is part
of what they want gone — but Escape-to-discard is strong muscle memory. Decide
whether Escape should (a) save like every other dismissal (Cancel button becomes
the *only* revert), or (b) stay mapped to Cancel/revert as the keyboard shortcut
for that button. The directive "save no matter what + a cancel button" leans
toward (a); confirm with the user if ambiguous.

---

## 2. Slash commands should not open panels (`\ex` is the reported case)

**Reported:** 2026-06-05 · **Status:** open · **Area:** main-text / slash commands

**Reported behavior** — typing the example slash command (`\ex`, shown in the
popup; user called it "/x") correctly inserts a new example block inline, but
*also* force-opens the Examples panel. Slash commands, as a class, should not
open panels.

**Architecture (one fix site).** Slash commands run via the popup
([SlashCommandPopup.tsx](src/components/SlashCommandPopup.tsx)) →
`executeSelection` → `cmd.action` ([commands.ts](src/lib/tiptap/commands.ts)).
Most commands mutate the doc directly and open nothing. Four commands instead
dispatch a `CustomEvent` that's handled in ONE bridge file —
[command-input.ts](src/components/editor-layout/event-bridges/command-input.ts) —
which is where all the panel-opening lives. So this is a contained class-fix, not
a scattered one.

**The class (current panel behavior of the four event-routed commands):**

| Command | Event | Handler | Panel behavior |
|---|---|---|---|
| `\ref` | `virgil-ref-create` | [:82–94](src/components/editor-layout/event-bridges/command-input.ts:82) | **None** — opens an inline LabelRef popover at the cursor. *This is the model.* |
| `\ex` | `virgil-ex-create` | [:96–111](src/components/editor-layout/event-bridges/command-input.ts:96) | **Hard-opens** Examples panel unconditionally (block at [:102–107](src/components/editor-layout/event-bridges/command-input.ts:102)) ← reported bug |
| `\footnote` | `virgil-footnote-input` | [:113–146](src/components/editor-layout/event-bridges/command-input.ts:113) | **Hard-opens** Footnotes panel unconditionally (block at [:132–138](src/components/editor-layout/event-bridges/command-input.ts:132)) — same bug, not yet reported |
| `\cite` | `virgil-citation-create` | [:49–80](src/components/editor-layout/event-bridges/command-input.ts:49) + [citations-host.tsx:67–83](src/components/editor-layout/panels/citations-host.tsx:67) | Soft-routes (opens panel only if its side is blank/collapsed), then `createCitation` selects+pins the card and auto-opens the library picker |

**Desired principle:** a slash command creates its thing inline (atom/block +
cursor placement) and does **not** activate any panel. `\ref` already behaves
this way — use it as the reference.

**Direct fix:** delete the panel-open blocks from the `\ex` handler ([:102–107](src/components/editor-layout/event-bridges/command-input.ts:102))
and the `\footnote` handler ([:132–138](src/components/editor-layout/event-bridges/command-input.ts:132)).
Keep the inline insert + `setSelected…` (selection without panel activation is
fine and harmless if the panel is already open).

**Open design question — `\cite` is the real nuance.** For citations the panel is
currently the *completion surface*: `createCitation(mode:"omni")` + `focusNewCard`
auto-open the library picker so you can choose the bib entry. Suppressing the
panel open there removes the completion path. Options for the manage session:
(a) keep `\cite` as a deliberate exception to the no-panel rule; or (b) redesign
citation completion to be inline like `\ref`'s popover, then make the rule
uniform. Decide with the user. (The `\cite` soft-route is already the gentlest
of the four — it won't clobber an existing panel — so it may be acceptable as-is
even if `\ex`/`\footnote` are fixed.)

---

## 3. ExpEx: Backspace on an empty example line should delete the sub-item / item

**Reported:** 2026-06-05 · **Status:** open · **Area:** main-text / expex examples

**Reported behavior** — inside an example environment, when the current line is
empty and you hit Delete (Backspace), it should:
- if you're on a **sub-item** (the little `a.`/`b.` letter — an `exampleItem`),
  delete that sub-item;
- if you're on a top-level **item** (the `(n)` example — the `exampleBlock`),
  delete the example.

**Current state** — [expex.ts](src/lib/tiptap/expex.ts) defines keymaps for
**Enter / Tab / Shift-Tab only — there is no Backspace/Delete handler**. So
Backspace on an empty expex line falls through to ProseMirror's default
join/delete, which does nothing useful (`exampleBlock` is `isolating: true`, so
the cursor can't join out of the block). Hence "nothing happens."

**The fix already exists, half-written.** The deletion logic the user wants is
*already implemented* inside the Shift-Tab handlers — it's just coupled to a
re-insert (promote/dissolve):
- `ExampleItem` Shift-Tab ([:829](src/lib/tiptap/expex.ts:829)) computes the
  three delete branches — delete whole block / delete now-empty list / delete
  just the item — at [:913–925](src/lib/tiptap/expex.ts:913), then re-inserts the
  item as a new block. Backspace wants that **delete branch without the re-insert**.
- `ExampleBlock` Shift-Tab ([:340](src/lib/tiptap/expex.ts:340)) dissolves a
  fully-empty block into a plain paragraph — that's the top-level "delete the
  item" case.

**Deep fix:** factor the depth-resolution + 3-way delete branch out of the
Shift-Tab handlers into a shared `deleteEmptyExampleStructure($from)` helper, and
call it from new Backspace handlers on **both** `ExampleItem` (sub-item) and
`ExampleBlock` (top-level item). The `ExpexNumbering` appendTransaction
([:1329](src/lib/tiptap/expex.ts:1329)) already re-letters/renumbers after any
structural change, so the remaining items fix themselves up for free.

**Guards:** only fire when the paragraph is empty (`$from.parent.content.size === 0`)
and the cursor is at its start; otherwise normal character deletion.

**Open questions for the manage session:**
1. "Delete" = Backspace (the Mac key). Also wire forward-Delete? Decide.
2. Top-level empty item: leave an empty paragraph behind (like Shift-Tab
   dissolve) or fully remove the example and land the cursor in the previous
   block? Define the cursor landing, and the only-example vs. one-of-many cases.
3. Empty sub-item that's the *last* item in the block: deleting it should mirror
   the Shift-Tab branch (delete the list + flip block `kind` back to `single`).

---

## 4. Ref popover: keyboard-navigate the label dropdown (arrows + Enter)

**Reported:** 2026-06-05 · **Status:** open · **Area:** main-text / ref popover ·
**Related:** item 1 (same "popover keyboard model" family)

**Reported behavior** — after `\ref` opens the popover and you start typing a
label, you can filter the list but **can't arrow down into it and press Enter to
pick an item** — you're forced to the mouse.

**Current state** — in [LabelRefPopover.tsx](src/components/LabelRefPopover.tsx)
the dropdown options are **mouse-only**: each option commits via `onMouseDown`
([:234–262](src/components/LabelRefPopover.tsx:234)). The input's `onKeyDown`
([:209–218](src/components/LabelRefPopover.tsx:209)) handles only **Enter**
(commits the raw typed text) and **Escape** — there is no ArrowUp/Down handling
and no "active option" index at all. So the keyboard can never reach a list row.

**Deep fix (reuse the existing pattern):** the slash popup already implements
exactly this listbox model — `selectedIndex` + ArrowUp/Down wrap + Enter executes
the highlighted row ([slash-popup.ts:152–195](src/lib/tiptap/slash-popup.ts:152)).
Mirror it here:
1. Add an `activeIndex` state over the **combined** list in render order
   (`[...filteredHeadings, ...filteredExamples]`) so arrow nav crosses the
   Sections/Examples group boundary correctly.
2. ArrowDown/ArrowUp move `activeIndex` (with `preventDefault` so the caret/page
   doesn't move) and scroll the active row into view.
3. Enter commits the highlighted option when one is active; falls back to the
   typed `inputValue` (current behavior) when none is.
4. Visually highlight the active row (add an `.active` class alongside the
   existing `.current`).

**Open question:** the user said "navigate the whole thing." In the `\ref`
*create* flow the popover is just input + dropdown, so dropdown nav covers it.
For the *edit-existing-ref* mode there's also a jump-to-target pod and the
`\ref`/`\getref`/`\getfullref` tri-toggle — full arrow nav across those pods is a
nice-to-have; confirm scope. The concrete reported gap is the create-mode
dropdown.

---

## 5. Unnecessary gap between the text tool strip and the editor pod

**Reported:** 2026-06-05 · **Status:** open · **Area:** ui-chrome / editor pane

**Reported behavior** — too much vertical space between the tool strip above the
editor (the 24px row holding the section breadcrumb on the left and the
⚡/←→/split/⋮ cluster on the right) and the top edge of the editor pod below it.
Tighten it.

**Where it lives** — the vertical stack sits in
[EditorPane.tsx:3588–3767](src/components/EditorPane.tsx:3588), in this order
inside the editor-pane column:
1. **Section breadcrumb** (`SectionLozenge`) — floats in a `height: 0` sticky
   container with `paddingTop: 6` ([:3595](src/components/EditorPane.tsx:3595)); no flow contribution.
2. **Tool strip** `[data-tool-strip="text"]` — `height: 24`, sticky `top: 0`, z-40
   ([:3611](src/components/EditorPane.tsx:3611)). The docked `MenuBar` lives inside it.
3. **Pod-top cap** `[data-editor-pod-cap]` — sticky `top: 10`, **net-zero flow**
   (`-14 + 22 - 8 = 0`), intricate rounded-corner-arc geometry ([:3709](src/components/EditorPane.tsx:3709)).
4. **Top-gutter spacer** `[data-flex-row="top"]` — `flex: 0 100 ${viewPrefs.topGutter}px`,
   **`topGutter` default 0** ([:3757](src/components/EditorPane.tsx:3757)).

CSS vars: `--pod-radius: 8px`, `--pod-gap: 10px` ([globals.css:49](src/app/globals.css:49)).

**Diagnostic fork for the manage session:**
- **If `topGutter` > 0** in the user's saved `viewPrefs` (it's a global pref, not
  per-doc-default), the gap is just that spacer — reset/lower it, or check whether
  a stale pref crept in. Cheapest explanation; check first.
- **If `topGutter` is 0** and the gap persists, it's structural — the 24px strip
  band is taller than the ~16px icon glyphs need, and/or the cap's `top: 10`
  offset. Tighten the strip height / cap offset.

**⚠️ Trap:** do NOT naively delete the pod-cap's negative margins to close the gap.
That cap's `marginTop/marginBottom` + height are *load-bearing* — they draw the
manila rounded-corner arc that masks the pod's lateral box-shadow (see the long
comment at [:3683](src/components/EditorPane.tsx:3683)). Net flow is already 0, so
the cap is not the gap's source; leave its geometry intact. **Measure the gap live
in the preview** to confirm the lever before editing.

---

## 6. Remove the redundant "action menu" (⚡) from the text tool strip

**Reported:** 2026-06-05 · **Status:** open · **Area:** ui-chrome / MenuBar

**Reported behavior** — the action menu up in the top tool strip is redundant and
won't be used; remove it.

**Mapping (high confidence).** The ⚡ lightning-bolt in the strip cluster is the
`ActionsStripButton` — rendered at [MenuBar.tsx:1452](src/components/MenuBar.tsx:1452),
just left of the para-nav arrows (gated by `onParaNavBack || onParaNavForward`).
Clicking it drops down the **`ActionsMenuPanel`**, the shared actions/formatting
dropdown. Per the glossary, that exact panel is *also* reachable from the gutter
lightning-bolt (`SelectionActionsMenu`, contextual to the current paragraph) and
from the passage `DragHandleMenu` — so the strip copy is genuinely redundant.
*(If the user actually meant the ⋮ kebab to its right, that's the `ViewMenu` —
but "action menu" + "redundant" points to the ⚡, since the kebab holds unique
view/layout prefs. Confirm if in doubt.)*

**Fix:** delete the `<ActionsStripButton editor={editor} />` render at
[MenuBar.tsx:1452](src/components/MenuBar.tsx:1452). The gutter `SelectionActionsMenu`
remains as the `ActionsMenuPanel` trigger.

**Adjacent cleanup (deep-fix the class).** Removing the strip button likely
orphans already-vestigial detach plumbing — `onActionsDetach` /
`handleActionsDetach` / `DetachedActionsToolbar` / `ActionButtonsRow`, which the
glossary notes already have "no current spawn path." Sweep those out in the same
pass rather than leaving dead code. Verify nothing else still spawns the detached
actions toolbar before deleting.

---

## 7. L/R tool strip: reordering a panel icon shouldn't open the panel

**Reported:** 2026-06-05 · **Status:** open · **Area:** ui-chrome / pane rail ·
**Related:** item 2 (same "unwanted panel-open side effect" symptom, different root cause)

**Reported behavior** — drag-and-dropping a left/right tool-strip item to a new
position on the strip reorders it correctly but *also* opens (activates) that
panel. A reorder should not open the panel.

**Root cause (precise — one-line fix).** The strip icons are `StripButton`
([drag-drop.tsx:67](src/components/editor-layout/drag-drop.tsx:67)), rendered by
`IconStrip` ([EditorPane.tsx:4757](src/components/EditorPane.tsx:4757)) with both
`onClick → handleStripClick` (activate) and `onMove → handleMove` (reorder).
`StripButton` disambiguates drag from click with a `handledByPointer` ref:
- **Click path:** `onPointerUp`'s non-drag branch sets `handledByPointer = true`
  and calls `onClick()` ([:244–246](src/components/editor-layout/drag-drop.tsx:244)).
  The browser's trailing synthetic `click` then hits the native `onClick`
  ([:260–265](src/components/editor-layout/drag-drop.tsx:260)), sees the guard set,
  and skips — so `onClick()` fires exactly once. ✅
- **Drag path:** `onPointerUp`'s `isDragging` branch calls `onMove(...)` and
  `return`s at [:241](src/components/editor-layout/drag-drop.tsx:241) **without
  setting `handledByPointer = true`**. The guard is still `false` (reset in
  `onPointerDown` at [:94](src/components/editor-layout/drag-drop.tsx:94)), so the
  browser's trailing `click` reaches the native `onClick` with the guard down →
  `onClick()` → `handleStripClick` → `openPanelDocked` → **panel opens.** ❌

**Fix:** set `handledByPointer.current = true` in the drag branch, just before the
`return` at [:241](src/components/editor-layout/drag-drop.tsx:241). Safe because
`onPointerDown` resets the guard to `false` at the start of every gesture, so a
stuck-`true` can't suppress a later legitimate click.

**Adjacent audit (eliminate the class):** any other control that is *both*
draggable and clickable via this same pointer-threshold pattern (e.g. inline-atom
grab handles, the text-object grab handle) could have the identical
missing-guard-on-drag-end bug. Worth a quick sweep while here — `StripButton` is
just the reported instance.

---

## 8. Atom drag-drop → Cmd-Z jumps the viewport to the top of the page

**Reported:** 2026-06-05 · **Status:** open · **Area:** main-text / inline-atom drag-drop

**Reported behavior** — drag-and-drop an inline atom (footnote / citation / `\ref`
/ inline math), then hit Cmd-Z. The undo is correct, but the page also scrolls up
to the very top.

**Root cause (the undo restores a stale pre-move selection).**
1. The grab gesture **deliberately never selects the atom.** `InlineAtomGrab`'s
   mousedown returns `true` so ProseMirror skips its own mousedown and never rests
   a `NodeSelection` on the atom ([inline-atom-grab.ts:233](src/lib/tiptap/inline-atom-grab.ts:233))
   — these atoms are `selectable:false` precisely to avoid a ~100px scroll-jump.
   Consequence: at drop time the editor's selection is **not** on the atom; it's
   wherever it last was — frequently doc-top, or the default at-doc-start selection.
2. The move dispatches with that stale selection in place. `moveInlineAtomWithin`
   ([inline-atom-move.ts:127](src/components/drop-mode/util/inline-atom-move.ts:127))
   builds `delete + insert`, sets the *post-move* selection on the moved node, and
   dispatches. prosemirror-history captures **`selectionBefore` = the stale top
   selection** (it's the prior state's selection, independent of what the tr sets).
3. On Cmd-Z, prosemirror-history's `undo` applies the inverse steps (correct),
   restores `selectionBefore` (top), and dispatches it **with `scrollIntoView()`**
   → viewport jumps to the top.

The move already kills the jump on the **drop** (no `NodeSelection`, the explicit
"NEVER `.scrollIntoView()`" at [:123](src/components/drop-mode/util/inline-atom-move.ts:123)),
but that does nothing for **undo**, which restores the *pre-move* selection the
grab left stale.

**Fix.** Before dispatching the move, park a caret at the atom's **original**
location so `selectionBefore` lands there. In `moveInlineAtomWithin`, pre-dispatch
a selection-only tr `TextSelection.create(state.doc, from)` with
`setMeta("addToHistory", false)`, then build the move against the updated state
(positions are unchanged — only the selection moved). On Cmd-Z, undo then restores
a caret at the atom's old home (on-screen, where the atom returns) and scrolls
*there* — no top-jump. Must be a **`TextSelection` caret adjacent to `from`**, not
a `NodeSelection` (the atoms are `selectable:false`, and a NodeSelection would
re-introduce the very scroll-jump the grab avoids). `addToHistory:false` keeps it
out of the undo stack so one Cmd-Z still undoes the whole move.

**Also check:** the **cross-editor** move path
([inline-atom-move.ts:103–112](src/components/drop-mode/util/inline-atom-move.ts:103))
splits into two dispatches and may want analogous selection parking in the source
editor; the reported case is the common **same-editor** in-text grab.

**Note:** distinct bug from the atom-drag observer-renumber issue in memory
([[atom-drag-and-observer-move-bug]]) — same subsystem, different fault (that was
the `DocStructureObserver` mis-mapping multi-step txns; this is undo selection).

---

## 9. Virgil-bar "+" menu paints under floating panels (z-index / stacking trap)

**Reported:** 2026-06-05 · **Status:** open · **Area:** ui-chrome / Virgil bar

**Reported behavior** — the "+" menu in the Virgil bar (Recent papers / Open folder
/ Create new document / New Virgil window) is at the wrong z-position; floating
panels and other windows layer over it instead of it sitting on top.

**Root cause — a child z-index trapped in a low parent stacking context.**
- The dropdown is rendered `position: absolute z-50` **inline** inside the
  component, not portaled — [TabPlusMenu.tsx:121](src/components/TabPlusMenu.tsx:121).
- Its parent, the Virgil bar, is `sticky top-0 z-30`
  ([EditorLayout.tsx:3817](src/components/EditorLayout.tsx:3817)). `sticky` +
  `z-index` **establishes a stacking context**, so the menu's `z-50` only orders it
  *within* the bar — relative to the page the whole menu is pinned at the bar's
  **z-30** level. A child can never paint above a layer that out-stacks its
  ancestor, no matter how high its own z-index.
- The things covering it escape that trap: floating panels / popped cards are
  **portaled to `document.body`** at **z-1200+** (`FloatingPanel` takes a dynamic
  `zIndex`; see the "cards use zIndex 1200+" note in
  [CardLiftOutline.tsx:80](src/components/CardLiftOutline.tsx:80)), and the other
  popovers sit at 1000–2000 (Slash/Math/LabelRef popovers **1000**;
  DragHandle/ActionsMenu/Heading menus **2000**; assorted dropdowns **z-[9999]**).

**Fix — match the established floating-overlay pattern.** Every other floating
popover (`MathPopover`, `LabelRefPopover`, `SlashCommandPopup`) `createPortal`s to
`document.body` and uses `zIndex: 1000`. Do the same here:
1. **Portal the dropdown to `document.body`** instead of `position: absolute`
   inside the bar — this is the load-bearing change; it escapes the z-30 context.
   Position it from the "+" button's `getBoundingClientRect()` (the wrapper
   `wrapRef` already exists at [TabPlusMenu.tsx:106](src/components/TabPlusMenu.tsx:106));
   keep the existing outside-click / Escape close handlers.
2. **Give it a chrome-menu-tier z-index** so it clears floating panels/cards
   (1200+) — e.g. **2000**, matching `DragHandleMenu` / `ActionsMenuPanel`. (z-50
   becomes irrelevant once portaled, but set it to the right tier anyway.)

**Adjacent audit (same trap):** any other `position: absolute` dropdown rendered
inside the `z-30` virgil-bar has this exact bug — e.g. the `absolute … z-20`
dropdown at [EditorLayout.tsx:4431](src/components/EditorLayout.tsx:4431), and
`MyPapersPod` (glossary notes it "mirrors the Virgil-bar `TabPlusMenu`"). Sweep
for `absolute z-[0-9]` menus inside low-z sticky bars and portal them uniformly.

---

## 10. ExpEx: multi-digit example numbers wrap — number column must adapt without breaking grab-handle geometry

**Reported:** 2026-06-05 · **Status:** open · **Area:** main-text / expex layout ·
**Related:** item 3 (same expex subsystem, unrelated fault)

**Reported behavior** — example `(10)` doesn't fit its number column: the `)`
wraps to a second line. The number gutter must make room for 1–3 digit numbers,
**and** the inner grab handle (the dots sitting between the number and the body
text) must reposition dynamically to match. User flags it as tricky because of
that coupling.

**Root cause** — the number column is a fixed `1.5em`:
`.expex-block { grid-template-columns: 1.5em 1fr; column-gap: 0.8em }`
([globals.css:3489](src/app/globals.css:3489)). `(9)` fits; `(10)` overflows and
wraps inside the grid cell. Same fixed `1.5em` on the item rows
(`.expex-item-row`, [globals.css:3544](src/app/globals.css:3544)).

**The coupling web (why it's "tricky"):**
1. **Equal-increment design:** A–B (number col + gap = 2.3em) is deliberately
   equal to B–C on item rows so `(n)` / `a.` / text align in uniform steps
   (comments at [:3492](src/app/globals.css:3492), [:3536](src/app/globals.css:3536),
   [:3583](src/app/globals.css:3583)). Widening only the block column breaks the
   symmetry; widening both over-indents nested tiers.
2. **The 0.8em gap is the inner handle's breathing room** — explicitly widened
   from 0.5em for that purpose ([:3494](src/app/globals.css:3494)). Any fix that
   lets the number bleed into the gap (e.g. bare `white-space: nowrap`) eats the
   zone where the inner handle renders (exactly the screenshot's dots position).
3. **Hardcoded mirrors:** `.expex-item-label-annotation { margin-left: 2.4rem }`
   ([:3554](src/app/globals.css:3554)) shifts the per-item "ex." pod by B–C — it
   must track any column change. (Note it's already drifted: 2.4**rem** vs the
   grid's 2.3**em**.)
4. **Same bug class inside items:** depth-1/3 markers are roman
   (`markerForDepth` — i., viii., xviii. …, [expex.ts:94](src/lib/tiptap/expex.ts:94));
   wide romans overflow the items' own fixed `1.5em` column too. A digits-only
   fix leaves that half alive.

**What's already solved (don't re-solve it):** the grab handles do **not** use
hardcoded offsets. `handle.left = markerLeft − gapPx − HANDLE_WIDTH`
([handle-layout.ts:48](src/text-objects/handle-layout.ts:48)) where `markerLeft`
is **measured** per block from the live `.expex-number` / `.expex-item-marker`
rects ([block-frame.ts:298](src/text-objects/block-frame.ts:298),
`markerElementLeft` at [:260](src/text-objects/block-frame.ts:260)). If the CSS
columns adapt, every handle (outer + inner) repositions for free. The work is
purely the CSS layout decision + its hardcoded mirrors.

**Candidate fixes for the manage session:**
- **(a) Cheap:** widen the fixed columns (e.g. 2.2em) + `white-space: nowrap` on
  `.expex-number`/`.expex-item-marker`. Keeps doc-wide alignment; costs
  permanent indent even in 1-digit docs; romans can still overflow extremes.
- **(b) Per-block `max-content` columns:** each example sizes to its own number —
  but adjacent examples' bodies stop aligning ((9) vs (10) ragged). Probably
  reject; alignment is the point of the equal-increment design.
- **(c) Deep fix — doc-adaptive shared width:** a CSS var (e.g.
  `--expex-num-width`) on the editor container, derived from the document's max
  example number, consumed by both grids (`grid-template-columns:
  var(--expex-num-width) 1fr`) and the label-pod margins. The `ExpexNumbering`
  appendTransaction ([expex.ts:1329](src/lib/tiptap/expex.ts:1329)) already
  computes every number and is structurally gated, so it can maintain the var
  with **zero keystroke-sanctity cost** (set style only when max-digit-count
  changes). Same pattern for an item-marker width var if roman overflow is in
  scope. All examples stay aligned, width adapts per doc, handles follow the
  measured DOM automatically.

**Verify after fix:** `(1)`/`(10)`/`(100)` render un-wrapped; inner + outer
handle dots sit in their gap zones on all three; nested `viii.` tier; the
per-item "ex." label pod still aligns with C; drop-indicator bars (also derived
from `contentLeft`/`markerLeft` per [block-frame.ts:18](src/text-objects/block-frame.ts:18))
still align.

---

## 10. Re-introduce grip-based drag-into-document for Todo / Error cards via a body-level affordance

**Reported:** 2026-06-09 · **Status:** open · **Area:** ui-chrome / card panels

In the A1 gardening pass the long-dead, commented-out `handleDragStart` blocks
on `TodoRow` ([src/panels/Todo/TodoRow.tsx](src/panels/Todo/TodoRow.tsx)) and
`ErrorCard` ([src/panels/Errors/ErrorCard.tsx](src/panels/Errors/ErrorCard.tsx))
were removed — they wired the card **grip** as a `draggable` source that emitted
`MIME_TODO` / `MIME_TEXT_INSERT` to drop the card's text into the document. That
capability had already been severed (the grip no longer set `draggable`; the
handlers were dead code) and the grip is now reserved for the lift/pop gesture.

**Desired behavior** — if drag-the-card-text-into-the-document is still wanted,
re-introduce it via a **body-level affordance** (a dedicated drag handle in the
card body, not the grip), so it doesn't collide with the grip's lift/pop role.
The original payload contract (`MIME_TODO` for todos, `MIME_TEXT_INSERT` for
error cards) is preserved in git history (pre-A1) if the drop targets still
accept those MIME types.

---

## 11. Borrowed-schema extraction: dedupe BorrowedMainText ⊕ RichTextField ⊕ main editor

**Reported:** 2026-06-09 · **Status:** open · **Area:** main-text / card bodies (A9 deferral)

**Context** — A9 Commit C added [src/components/BorrowedMainText.tsx](src/components/BorrowedMainText.tsx),
a read-only TipTap renderer for a card's resolved body (real inline atoms:
citation / `\ref` / inline math / nested footnote markers). It builds its OWN
read-only extension list mirroring [RichTextField](src/components/RichTextField.tsx)'s
hand-mirrored card-context schema (`~:239-261`) — StarterKit minus
heading/blockquote/codeBlock, plus the inline atoms + block-atom previews — and
additionally registers `LabelRef` + `Footnote` read-only.

So the card-context inline-atom schema now lives in **two** hand-kept copies
(RichTextField + BorrowedMainText), and the MAIN editor has a **third**
(`buildEditorExtensions` in [src/lib/editor-extensions.ts](src/lib/editor-extensions.ts)).
A new inline-atom kind must be added to all three or it's silently stripped in
one surface.

**Why deferred (not done in A9)** — the plan called for the fallback unless a
shared `borrowed-schema.ts` is a *clean* pure-extraction. It is not: the main
editor's `buildEditorExtensions` is full of stateful main-surface NodeViews
(heading folding, paragraph-title chrome, the DocStructureObserver, grab
handles) that a read-only card body must NOT run, so the main and card schemas
are intentionally different. A faithful dedup would need to factor out only the
**inline-atom + block-atom-preview** sub-schema (the part all three share) into
one module that each surface composes with its own block/chrome layer.

**Desired** — extract the shared inline/block-atom extension list into
`borrowed-schema.ts`, consumed by RichTextField, BorrowedMainText, and (via a
`cardContext`-style flag) the main editor's atom registration, so the
"add an atom kind in one place" invariant holds. Verify with a main-editor
smoke test (typing + atoms still render) and the full suite.

## 12. OrphanedFootnoteCard still welds compressed = !isSelected (pre-A4 axis)

`src/panels/Footnotes/FootnoteCard.tsx` (~:196, the orphaned variant): the A4
selection ⟂ expansion split gave every anchored card an independent `expanded`
axis, but `OrphanedFootnoteCard` kept the old weld — no `ac`, no chevron,
`compressed = !isSelected`. Selecting it expands it; the
selected-but-collapsed cell is unreachable for this one card.

**Desired** — give it a panel-local expansion axis like A4 Commit G did for
ErrorCard (panel-owned `expanded` set + the chevron), so the N1 2×2 holds
uniformly. (A4 Session-13 deferral #3, carried at refactor archival.)

## 13. CitationCard draft chevron is a dead click while isDraft

`src/panels/Citations/CitationCard.tsx`: the A4 expand chevron renders on a
draft citation card but expanding a draft is a no-op — a dead affordance.

**Desired** — suppress the chevron while `isDraft` (or make expansion
meaningful for drafts). (A4 Session-13 deferral #6, carried at refactor
archival.)

---

# Session-17 card UI batch (reported 2026-06-11)

Items 14–21 form one **card chrome & pop-out UX cluster** — they all touch the
same header anatomy and should likely land as one architectural chip, not
piecemeal. Items 22–23 are the **UI-consistency sweep** (the visual analogue of
the functional refactor). Item 24 is a live runtime crash. Investigation
findings from the Session-17 workflow refine these in place.

## 14. Card chrome: kill the chevron — header click toggles expand/collapse

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / shared chrome

No chevron control at all. Clicking anywhere on the card header toggles
expand/collapse. Must disambiguate from header-drag (item 19) via the existing
click-vs-drag threshold pattern. Subsumes item 13 (draft-citation dead chevron
disappears with the chevron itself).

## 15. Collapsed card must always show its title (when present)

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / shared chrome

Collapsed view currently can omit the title. Desired: title always visible in
collapsed mode whenever the card has one.

## 16. Footnote cards: collapsed mode drops inline-style citations

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / footnotes

A footnote whose text contains citations doesn't render them inline-style in
collapsed mode (expanded mode does). Likely the collapsed preview path bypasses
the borrowed-schema renderer — check whether the whole inline-atom class
(refs, math) drops too. Related: item 11 (borrowed-schema dedupe).

## 17. Titleless cards: shrink the title-row gap (+T affordance)

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / shared chrome

When a card has no title, the title row leaves an oversized gap; it should
collapse to a small +T affordance area.

## 18. Kill the pop-out button — grab-to-pop is the only pop-out path

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / shared chrome

Remove the ↑ pop-out button from the card header entirely.

## 19. Unify grab surfaces: grab bar and header are the same grab

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / shared chrome

The ⋮⋮ grab-dots and the header should be one grab surface — dragging the
header lifts the card exactly like dragging the dots. Click on header =
expand/collapse (item 14); drag = lift.

## 20. Grab-to-pop must preserve shape + position (only expansion may change)

**Reported:** 2026-06-11 · **Status:** open · **Area:** floats / pop-out pipeline

Popping a card out must be visually seamless: the float keeps the in-panel
card's shape (width/height) and position (where it was lifted/released); no
chrome/font/padding jump. The single allowed change: a collapsed card may
expand. Today the float visibly differs from the lifted card.

## 21. Popped cards must NOT disappear from the omni panel

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / floats

Example cards vanish from the omni panel when popped out. Desired: the card
stays in the panel (design call pending: live duplicate vs ghosted placeholder).
Make residue behavior uniform across all kinds at the registry level.

## 22. Citation card typography is inconsistent across states

**Reported:** 2026-06-11 · **Status:** open · **Area:** card panels / citations / style

Fonts differ between collapsed (bold serif citekey), expanded-resolved (italic
serif bib entry), expanded-unresolved (large red serif), and the TYPE/CODE/
PREVIEW control rows — no shared typography tokens. Normalize against
STYLE_GUIDE.md (and add a typography section there if silent).

## 23. UI-consistency sweep: window shapes, pop-out geometry, fonts

**Reported:** 2026-06-11 · **Status:** open · **Area:** cross-cutting / style

The visual analogue of the functional refactor: audit + normalize window
shapes (radius/border/shadow/padding), float sizes and pop-out positions, and
font usage across all card kinds and floats. Audit first, then a normalization
chip that lands shared tokens — sequence AFTER the chrome redesign (items
14–21) so the audit measures the new chrome.

## 24. Runtime crash: `cssTokenForCardKind` — unknown kind reaches the crosswalk

**Reported:** 2026-06-11 · **Status:** open · **Area:** links / anchor reconciler

`TypeError: Cannot read properties of undefined (reading 'cssToken')` at
[src/cards/legacy-token-crosswalk.ts:61](src/cards/legacy-token-crosswalk.ts:61)
in `cssTokenForCardKind`, called from `useAnchorHighlightReconciler`'s
`collectAnchorEls` ([src/links/_shared/useAnchorHighlightReconciler.ts:202](src/links/_shared/useAnchorHighlightReconciler.ts:202)).
The crosswalk is keyed by exactly the 16 spine `CardKind`s, so a legacy/unknown
kind string is reaching it — likely the SEAM E-5 `linkedAnchor.kind` write-site
residue (and/or `bibliography`-vs-`bib` drift) named in the DoD addendum.
Deep fix should make unknown kinds impossible-or-harmless everywhere the
crosswalk is read, not just guard this one call site.
