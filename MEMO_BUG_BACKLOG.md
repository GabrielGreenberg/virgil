# Bug & polish backlog

Running list of bugs / UX rough edges noticed while central work is in flight on
`main` (can't be worked through inline). To be **drained in a dedicated manage
session** (chip-dispatch pattern) once the central work settles.

Append new items at the bottom. Keep each item self-contained: current behavior,
desired behavior, a file:line pointer, and any open design question so the
implementer doesn't have to re-derive scope.

Status legend: `open` · `in-progress` · `done`

> **DRAINED 2026-06-13:** items #1–40 are all done / wontfix / superseded (shipped
> across releases v0.1.52 + v0.1.53). This file is now a clean running log —
> append new items at the bottom. The next maintenance manager prompt (cadence +
> hard guards) is `MEMO_MANAGER_HANDOFF.md` at the repo root. Outstanding
> non-code work: the card-refactor **walks** W1–W9 + W11 (`MEMO_CARD_REFACTOR_WALKS.md`)
> still need Gabriel's hands and are the most likely source of new bugs.

---

## 1. Inline-math popup: save-by-default, add a Cancel button

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chip `Q1`) · **RATIFIED 2026-06-13:** Escape SAVES too (option a) — Cancel button is the only revert · **Area:** main-text / math editing

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

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chip `Q1`) · **RATIFIED 2026-06-13:** `\ex`/`\footnote` stop opening panels; `\cite` creates its card in OMNI-VIEW (not the dedicated Citations panel), surfacing only if another panel covers omni (the gentle soft-route) — NOT an inline popover · **Area:** main-text / slash commands

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

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chip `Q2`) · **Area:** main-text / expex examples

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

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chip `Q1`) · **Area:** main-text / ref popover ·
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

**Reported:** 2026-06-05 · **Status:** done (2026-06-13 — **legacy gutter-pref subsystem removed**, superseding the shipped-default reset; corrects the earlier "no-op" call) · **Area:** ui-chrome / editor pane / prefs defaults

**Verdict (2026-06-13, re-verification + fix) — NOT a no-op; a real shipped
defect.** The earlier chrome-polish call got the *fact* right (the gap is the
`[data-flex-row="top"]` spacer driven by `topGutter`, shipped at **99px** in
`useViewPrefs.defaults.json`, leaked from the developer's personal drag height by
the `bcca090` prefs promotion) but reached the wrong *disposition*. It concluded
"no-op" by reasoning the change "wouldn't move the needle for users with a saved
pref" — which under-weights the audience a **default** actually serves: **any
fresh user with no persisted prefs blob gets the 99px gap, no drag required.**
`DEFAULT_PREFS` spreads the JSON verbatim
([useViewPrefs.ts:184](src/hooks/useViewPrefs.ts:184)) and is returned whenever
there's no saved blob ([:301](src/hooks/useViewPrefs.ts:301),
[:408](src/hooks/useViewPrefs.ts:408)). The structural stack is genuinely fine
(24px strip + net-zero pod-cap, left untouched); the sole lever was the leaked
default.

**Fix — two stages.**
1. **Stopgap (reset):** `topGutter` 99 → 0 in `useViewPrefs.defaults.json`
   (eyeballed by hand — `tools/sync-defaults.sh` deliberately NOT run, per
   [[release-prefs-snapshot-gotcha]]). Closed the immediate gap for fresh users
   but left the pref machinery — and the re-fold hazard — in place.
2. **Deep fix (the real one — commit `1cac8e2`, merge `79596ac`, merged to `main`
   but NOT pushed/deployed):** on the user's call ("top/bottom gutters aren't a
   user pref — that's legacy, root it out"), **removed the entire top/bottom
   gutter-pref subsystem.** Note the "inert" drag bar the user flagged
   (`data-gutter-gap`) was actually *wired* (`onMouseDown → setEditorTopGutter`),
   but a user-draggable whitespace gutter is the misfeature, not dead code.
   Removed across 8 files: the `topGutter`/`bottomGutter` prefs + setters +
   `GLOBAL_PREF_KEYS` (`useViewPrefs.ts` + `.defaults.json`); the drag handles,
   spacers (`data-flex-row`), bars (`data-gutter-gap`) + interface fields
   (`EditorPane.tsx`); the EditorLayout bundle wiring; the Reader exposure
   (`reader-view-prefs.ts`); the **dead** zen-mirror fields (`useZenMode.ts` —
   defined + persisted but never consumed); the now-dead print rule
   (`globals.css`); and — critically — the promote whitelist
   (`dev-prefs-registry.json`). The shared `useDragGap` primitive was **kept**
   (panel-resize / code-split / zen-margins still use it). Typecheck clean,
   31/31 tests, preview verified flush (pod frame at y≈64 under the 56px chrome).

**✅ Durability — resolved (not just mitigated).** The 99 arrived via
`promote-defaults` folding the developer's `personal-snapshot.json` (history:
`59af265` → `510888b` → `bcca090`). Removing `topGutter`/`bottomGutter` from the
`dev-prefs-registry.json` whitelist (option (b) from the original plan) means
promote-defaults can **never re-fold them** — the re-fold loop is closed for good.
Stale values in any user's already-persisted blob are now inert: no consumer reads
them, and the global-pref write path drops them on the next change.

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

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chrome-polish chip) · **Area:** ui-chrome / MenuBar
**Done:** removed the `<ActionsStripButton>` render + import from `MenuBar.tsx` and deleted the now-orphaned `ActionsStripButton.tsx`. The flagged detach plumbing (`onActionsDetach` / `handleActionsDetach` / `DetachedActionsToolbar` / `ActionButtonsRow`) was already gone from code in earlier passes — only stale doc/jsdoc references survived, which were corrected (glossary, ui-chrome, architecture, workspace/actions manifest + the `{@link ActionsStripButton}` jsdoc). Gutter `SelectionActionsMenu` + `Mod-/` remain the triggers.

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

**Reported:** 2026-06-05 · **Status:** done (2026-06-11, fixed as the suppress-click guard class in chip `card-chrome-ux`, merge `7f843a6`) · **Area:** ui-chrome / pane rail ·
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

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chip `R1`) · **Area:** main-text / inline-atom drag-drop

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

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chrome-polish chip) · **Area:** ui-chrome / Virgil bar
**Done:** `TabPlusMenu` dropdown now `createPortal`s to `document.body`, positioned from the "+" button rect via `useFloatingMenuPosition`, at `zIndex 2000`. Adjacent sibling with the identical trap fixed the same way: the Help (`?`) menu dropdown in `EditorLayout.tsx` (was `absolute z-20` inside the bar). `MyPapersPod`'s "Add paper" menu still renders inline `absolute` but lives in the Library tab away from editor floating overlays → no live symptom, judged out-of-scope (noted in STYLE_GUIDE). Generalizable rule + test landed.

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

## 10. Re-introduce grip-based drag-into-document for Todo / Error cards via a body-level affordance

**Reported:** 2026-06-09 · **Status:** wontfix (2026-06-13, Gabriel — grip is now the pop-out gesture; drag-text-into-doc not wanted) · **Area:** ui-chrome / card panels

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

**Reported:** 2026-06-09 · **Status:** done (2026-06-13, chip `S` borrowed-schema) · **Area:** main-text / card bodies (A9 deferral)

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

**DONE 2026-06-11** (chip `card-chrome-ux`, merge `7f843a6`): orphan now on the
global store axis; 2×2 fully reachable; pinned by `orphan-expansion.test.tsx`.

## 13. CitationCard draft chevron is a dead click while isDraft

`src/panels/Citations/CitationCard.tsx`: the A4 expand chevron renders on a
draft citation card but expanding a draft is a no-op — a dead affordance.

**Desired** — suppress the chevron while `isDraft` (or make expansion
meaningful for drafts). (A4 Session-13 deferral #6, carried at refactor
archival.)

**DONE 2026-06-11** (chip `card-chrome-ux`, merge `7f843a6`): chevron retired
globally; draft header click = select-only with `headerDisclosure={false}` a11y;
pinned by `citation-draft-header.test.tsx`.

---

# Session-17 card UI batch (reported 2026-06-11)

Items 14–21 form one **card chrome & pop-out UX cluster** — they all touch the
same header anatomy and should likely land as one architectural chip, not
piecemeal. Items 22–23 are the **UI-consistency sweep** (the visual analogue of
the functional refactor). Item 24 is a live runtime crash. Investigation
findings from the Session-17 workflow refine these in place.

> **Ratified design calls for chip E (Gabriel, 2026-06-12):** per-panel font
> picker = **body text only** (titles/meta/labels override-immune, the TITLE
> dialect) · type scale = **10px meta + 12px content** (kill 10.5/11/11.5
> strays) · citation body padding **normalizes to the px-3 standard** · card
> floats stay **uniform 360×280** (no per-kind registry facet).

> **Ratified design calls (Gabriel, 2026-06-11):** header click = **toggle +
> select** (no jump; body click keeps select+expand+jump) · pop residue =
> **fully live card** (delete ExampleCard's suppression; no ghosting) · float
> chrome = **match the docked card** (surface `"card"` + kind-tinted
> FloatChrome header) · collapsed-card pop = **expand to content height**,
> capped by `capPopoutHeight` (55 vh).

> **Session-17 investigation digest (2026-06-11, all causal claims 2×-verified).**
> Full findings in the session transcript; per-item fix sites:
>
> - **#14/18/19** land in ONE component — `PanelCard`'s unified header
>   ([panel-primitives.tsx:1838-1876](src/components/panel-primitives.tsx)).
>   Chevron = `CardExpandChevron` (:1849), pop-out button = :1870-1872 (one
>   deletion), lift gesture `onWrapperMouseDown` (:1690) is ALREADY scoped to
>   the whole header — #19 is structurally done, needs only affordance polish.
>   Header click today has no handler; it bubbles to root onClick =
>   select+expand+jump. Click-vs-drag needs a StripButton-style suppress-click
>   guard set in the drag branch (the exact missing-guard class of item 7 —
>   fix both together). Deviants to handle in the same pass: BibEntryCard +
>   AiRequestCard (bespoke headers, no `kind` prop), items 12/13 (else they
>   become dead-header bugs under click=toggle).
> - **#15** — `EditableCard`'s compressed branch drops `bodyTitle`
>   unconditionally ([panel-primitives.tsx:998-1019](src/components/panel-primitives.tsx)); one site, five title-bearing kinds.
> - **#17** — `CardBodyTitle` (:517-593) + `.card-title-*`
>   ([globals.css:1157-1199](src/app/globals.css)); one component, one CSS block.
> - **#16** — collapsed footnotes DO use BorrowedMainText; the mount at
>   panel-primitives.tsx:1009 just omits the `getCitationDisplayText` resolver
>   (and footnote-body citations persist `displayText=""`). Deep fix:
>   BorrowedMainText consumes `CitationDisplayContext` (nullable accessor) —
>   fixes footnote+archive+example surfaces at once. Bonus: kills the
>   non-converging `updateCitationDisplay` loop in EditorPane (:1074-1101).
>   No dependency on item 11.
> - **#20** — lift spawn rect is hardcoded `{cursorX−180, cursorY−16, 360×280}`
>   ([panel-primitives.tsx:1757-1774](src/components/panel-primitives.tsx)); the measured source rect is captured (:1750)
>   but used only for the outline flash; the `CardLiftHandoff.width/height`
>   fields documented "matched to the source card" are set to constants
>   (vestigial channel). Fix: derive spawn rect from source rect via a shared
>   `liftSpawnRect()` in [float-policy.ts](src/floats/float-policy.ts) — the text-object lift
>   ([TextObjectGrabHandle.tsx:968-1001](src/text-objects/TextObjectGrabHandle.tsx)) is the proven reference math.
>   Chrome continuity is separate: card floats use `surface:"panel"` (beige,
>   3px border, heavy shadow — [cards/floats/index.tsx:108](src/cards/floats/index.tsx)) vs the docked
>   white card, and FloatChrome's header is neutral vs the kind-tinted docked
>   header — both one-site flips.
> - **#21** — `ExampleCard` is the ONLY card that self-suppresses its docked
>   render when popped ([ExampleCard.tsx:370](src/panels/Examples/ExampleCard.tsx) `isPopped → return null`):
>   historical drift (ba90bd9 removed the pattern everywhere 2026-04-21;
>   4ef533c re-introduced it on examples 6 days later). All other 14 poppable
>   kinds keep a fully live docked card. Fix: delete :367-371 (+ comment scrub
>   in usePoppedCards.ts:5-17); optional uniform ghost-residue would land once
>   in PanelCard (texBlock `.is-popped` CSS is the ghost precedent).
> - **#22** — ROOT CAUSE (live-verified): `BODY_CLASS_TYPOGRAPHY`
>   ([panel-typography.ts](src/lib/panel-typography.ts)) stores bare family names ("Inter",
>   "Source Serif 4") that are NEVER loaded under those literals → every
>   element styled via `usePanelBodyStyle` ([usePanelTypography.ts:48-57](src/hooks/usePanelTypography.ts))
>   renders UA-default **Times New Roman** (incl. the bold-serif collapsed
>   citekey, all note/footnote/report/todo bodies, and the broken font-picker
>   options). ONE-SITE fix: name→var-stack crosswalk in `usePanelBodyStyle`.
>   Second bug: three sites spread `...bodyStyle` LAST over title styles
>   (clobbers par-title size + theme.titleColor). NOTE: the screenshot's
>   expanded-row serif did NOT reproduce in the dev env (measures real Inter)
>   — needs one manual check on Gabriel's machine before scoping that part.
> - **#23** — geometry already mostly single-sited (PanelCard shell;
>   FloatHost→FloatWindow→FloatChrome→FloatingPanel + float-policy). Real
>   divergences: 4 duplicate `360×280` literals; per-kind float sizes exist
>   only for text objects (registry `initialFloatSize`) — add a CardMeta
>   float-size facet; kind-color CSS block ([globals.css:2561-2585](src/app/globals.css)) omits
>   bib/ai/example/error — stamp `--link-anchor-color` from `theme.accent` at
>   the PanelCard root and delete the block; `Floatable.spawnHint` declared but
>   dead; TextObjectGrabHandle's hand-mirrored chrome metrics (24/32/16/1)
>   belong in float-policy; bib/ai still `bareWindow` (= float-chrome-stage6).
> - **#24** — NOT seam E-5 firing: persisted sidecar `links[].target.ref.kind:
>   "comment"` (pre-rename revisions.json — confirmed in the dev doc AND the
>   sample paper) flows un-normalized through `migrateCardLinks`
>   ([migrate-card.ts:39-41](src/links/migrate-card.ts)) into the crosswalk via an `as CardKind`
>   cast at [useAnchorHighlightReconciler.ts:202](src/links/_shared/useAnchorHighlightReconciler.ts). Same-class latent crash in
>   `getPanelByCardKind`. Fix (both): legacy-token→CardKind normalizer applied
>   in the migrate-card.ts load funnel + make both crosswalk accessors total
>   with a loud dev warn. The `useCutter.ts:50-68` `rewriteLinkTargetKind`
>   ("cut"→"cutter-comment") is the proven in-repo pattern to generalize.
>   E-5 proper (write-site unification) stays in the registry-completion chip.

## 14. Card chrome: kill the chevron — header click toggles expand/collapse

**Reported:** 2026-06-11 · **Status:** done (2026-06-11, chip `card-chrome-ux`, merge `7f843a6`) · **Area:** card panels / shared chrome

No chevron control at all. Clicking anywhere on the card header toggles
expand/collapse. Must disambiguate from header-drag (item 19) via the existing
click-vs-drag threshold pattern. Subsumes item 13 (draft-citation dead chevron
disappears with the chevron itself).

## 15. Collapsed card must always show its title (when present)

**Reported:** 2026-06-11 · **Status:** done (2026-06-11, chip `card-chrome-ux`, merge `7f843a6`) · **Area:** card panels / shared chrome

Collapsed view currently can omit the title. Desired: title always visible in
collapsed mode whenever the card has one.

## 16. Footnote cards: collapsed mode drops inline-style citations

**Reported:** 2026-06-11 · **Status:** done (2026-06-11, chip `card-chrome-ux`, merge `7f843a6`) · **Area:** card panels / footnotes

A footnote whose text contains citations doesn't render them inline-style in
collapsed mode (expanded mode does). Likely the collapsed preview path bypasses
the borrowed-schema renderer — check whether the whole inline-atom class
(refs, math) drops too. Related: item 11 (borrowed-schema dedupe).

## 17. Titleless cards: shrink the title-row gap (+T affordance)

**Reported:** 2026-06-11 · **Status:** done (2026-06-11, chip `card-chrome-ux`, merge `7f843a6`) · **Area:** card panels / shared chrome

When a card has no title, the title row leaves an oversized gap; it should
collapse to a small +T affordance area.

## 18. Kill the pop-out button — grab-to-pop is the only pop-out path

**Reported:** 2026-06-11 · **Status:** done (2026-06-11, chip `card-chrome-ux`, merge `7f843a6`) · **Area:** card panels / shared chrome

Remove the ↑ pop-out button from the card header entirely.

## 19. Unify grab surfaces: grab bar and header are the same grab

**Reported:** 2026-06-11 · **Status:** done (2026-06-11, chip `card-chrome-ux`, merge `7f843a6`) · **Area:** card panels / shared chrome

The ⋮⋮ grab-dots and the header should be one grab surface — dragging the
header lifts the card exactly like dragging the dots. Click on header =
expand/collapse (item 14); drag = lift.

## 20. Grab-to-pop must preserve shape + position (only expansion may change)

**Reported:** 2026-06-11 · **Status:** done (2026-06-12, chip `popout-continuity`, merge `42bcf11`) · **Area:** floats / pop-out pipeline

Popping a card out must be visually seamless: the float keeps the in-panel
card's shape (width/height) and position (where it was lifted/released); no
chrome/font/padding jump. The single allowed change: a collapsed card may
expand. Today the float visibly differs from the lifted card.

## 21. Popped cards must NOT disappear from the omni panel

**Reported:** 2026-06-11 · **Status:** done (2026-06-12, chip `popout-continuity`, merge `42bcf11`) · **Area:** card panels / floats

Example cards vanish from the omni panel when popped out. Desired: the card
stays in the panel (design call pending: live duplicate vs ghosted placeholder).
Make residue behavior uniform across all kinds at the registry level.

## 22. Citation card typography is inconsistent across states

**Reported:** 2026-06-11 · **Status:** done (2026-06-12, chip `ui-consistency-sweep`, merge `2f8eda5`; root cause earlier in `font-stack-fix`) · **Area:** card panels / citations / style

**Root cause landed** (chip `font-stack-fix`, reviewed + merged): `FONT_STACKS`
crosswalk + total `resolveFontStack` in [panel-typography.ts](src/lib/panel-typography.ts),
consumed in `usePanelBodyStyle` — bare unloaded family names (the Times-fallback
bug) can no longer ship; the per-panel font picker works. **Remaining for the
ui-consistency-sweep chip:** the bodyStyle-over-title spread-order clobber ·
token normalization (meta scale, CardMetaLabel/CardMono) · preview-chrome
bare-name emitters the fix deliberately skipped (`FontsDialog.tsx:22/82/436`
`fontStack`, `FontPicker.tsx:18` + option previews, `SmartPreferences.tsx:139,142`
raw select styles — unify all three local helpers on `resolveFontStack`) ·
serif-heuristic regex misses dialog-reachable serif names (cosmetic) · dead
`--panel-body-fontfamily`/`--panel-body-color` vars in panel-kind-context.tsx ·
the not-reproducing expanded-row serif (manual check on Gabriel's machine).

Fonts differ between collapsed (bold serif citekey), expanded-resolved (italic
serif bib entry), expanded-unresolved (large red serif), and the TYPE/CODE/
PREVIEW control rows — no shared typography tokens. Normalize against
STYLE_GUIDE.md (and add a typography section there if silent).

## 23. UI-consistency sweep: window shapes, pop-out geometry, fonts

**Reported:** 2026-06-11 · **Status:** done (2026-06-12, chip `ui-consistency-sweep`, merge `2f8eda5`) · **Area:** cross-cutting / style

The visual analogue of the functional refactor: audit + normalize window
shapes (radius/border/shadow/padding), float sizes and pop-out positions, and
font usage across all card kinds and floats. Audit first, then a normalization
chip that lands shared tokens — sequence AFTER the chrome redesign (items
14–21) so the audit measures the new chrome.

## 24. Runtime crash: `cssTokenForCardKind` — unknown kind reaches the crosswalk

**Reported:** 2026-06-11 · **Status:** done (2026-06-11) · **Area:** links / anchor reconciler

**FIXED** (chip `legacy-kind-crash-fix`, reviewed + merged): legacy tokens
(`"comment"`, `"cut"`) normalized via `normalizeLegacyCardKind` at the
`migrateLink` load funnel; both crosswalk accessors runtime-total (null + once-
per-token dev warn); `useCutter`'s local rewrite deduped into the funnel
(reviewer proved call-graph equivalence); `"quotation"` documented known-dead.
**Follow-up routed to the registry-completion chip:** `resolveLinkPanel` →
`getPanelByCardKind` ([panel-registry.ts:265](src/panels/panel-registry.ts)) is a
dead-code pair whose unguarded `CARD_REGISTRY[kind]` index is the same crash
shape — harden or delete.

`TypeError: Cannot read properties of undefined (reading 'cssToken')` at
[src/cards/legacy-token-crosswalk.ts:61](src/cards/legacy-token-crosswalk.ts:61)
in `cssTokenForCardKind`, called from `useAnchorHighlightReconciler`'s
`collectAnchorEls` ([src/links/_shared/useAnchorHighlightReconciler.ts:202](src/links/_shared/useAnchorHighlightReconciler.ts:202)).
The crosswalk is keyed by exactly the 16 spine `CardKind`s, so a legacy/unknown
kind string is reaching it — likely the SEAM E-5 `linkedAnchor.kind` write-site
residue (and/or `bibliography`-vs-`bib` drift) named in the DoD addendum.
Deep fix should make unknown kinds impossible-or-harmless everywhere the
crosswalk is read, not just guard this one call site.

---

## 25. ExpEx: multi-digit example numbers wrap — number column must adapt without breaking grab-handle geometry

*(Originally committed as a second "item 10" in `31db102`; renumbered here — 10
was taken.)*

**Reported:** 2026-06-05 · **Status:** done (2026-06-13, chip `Q2`) · **Area:** main-text / expex layout ·
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

## 26. Float-side ExampleCard shows a permanently disabled Edit button

**Reported:** 2026-06-12 (chip-D review gate, example-residue lens) · **Status:** superseded by item 32 (chip W-A) · **Area:** card panels / examples

With the pop residue now live everywhere (#21), the popped example float
renders a permanently **disabled** Edit button while the docked card next to
it has the working one — a visible dead affordance. Either enable editing in
the float or hide the button there. (Same gate also noted, lower priority:
`collectClippedHeight` over-counts fixed-height inner textareas — capped by
55vh, observe in walk W11 — and the `headerTint` registry→FloatChrome wiring
has no test, which belongs to the queued `test-hardening` chip.)

---

## 27. Derive the in-text anchor color maps from CARD_THEMES (second G3 surface)

**Reported:** 2026-06-12 (chip-E review gate) · **Status:** done (2026-06-13, chip `R2`) · **Area:** links / globals.css

Chip E derived CARD outline colors from `theme.accent` (inline stamp on the
PanelCard root) and deleted the card CSS block — but the **in-text** maps
(`.linked-anchor` / `[data-paragraph-kind]` color blocks in globals.css, ~:2590
and ~:2637 pre-merge) are still hand-mirrored hex tables. A user panel-color
override now desyncs card outline vs in-text anchor paint. Fix the same way:
stamp `--link-anchor-color` from the live theme at the highlight write-sites
(`useCardSelectionHighlight`/`useCardHoverHighlight` family) or generate the
map from `DEFAULT_PANEL_COLORS`, then delete both blocks. (Archive hexes were
hand-aligned to `#7191b0` in the chip-E fold as a stopgap.)

## 28. BibEntryCard renders bib fields via dangerouslySetInnerHTML — escape them

**Reported:** 2026-06-12 (chip-E review gate) · **Status:** done (2026-06-13, chip `Q6`) · **Area:** bibliography / security

`BibEntryCard`'s publication-details row joins raw `entry.fields` (journal,
booktitle, editor, doi, url) into `dangerouslySetInnerHTML` to get literal
`<i>` markup. A `.bib` entry containing HTML (e.g. fetched by find-citation
from an external source, or a shared paper's references.bib) injects markup
into the panel. Pre-existing, flagged by the chip-E gate. Fix: escape field
values before templating (or render JSX spans), and audit the other
formatted-bib innerHTML sinks (`getFormatted*` family) in the same pass.
Smaller residue from the same gate, fold into whichever chip lands nearby:
`CardMono` has zero call sites (adopt-or-delete) · BibEntryCard's `compact`
prop is dead code · the Inter/"Source Serif 4" picker option previews render
the user's override face rather than the named face (needs a preview-oriented
resolver) · bib expanded body still on `PANEL.cardInner` (exempt or convert).

---

## 29. Per-heading fold-chevron transaction subscribers — gate or centralize (+ AGENTS.md list gap)

**Reported:** 2026-06-12 (doc-rot chip G + its review gate) · **Status:** done (2026-06-13, chip `R2`) · **Area:** main-text / keystroke sanctity

`editor-extensions.ts` (~:908): each heading NodeView registers its own
`editor.on("transaction")` fold-chevron refresher — N headings = N subscribers
firing on EVERY transaction, ungated. Each is verified O(1) (plugin-state read
+ `Set.has` + `classList.toggle(force)`) and unsubscribes on destroy, so a
50-heading doc costs ~µs — **benign today but a list-contract gap**: it brushes
keystroke sanctity's letter and isn't on AGENTS.md's permitted list. Fix:
(a) gate the refresh on `tr.getMeta(sectionFoldingPluginKey) !== undefined ||
tr.docChanged` (mirroring useEditorUIState's gate over the same plugin state),
or better one plugin-level subscriber updating all chevrons; (b) reconcile
AGENTS.md's permitted list with the **six** unlisted subscribers chip G found
(EditorLayout :1902/:2091/:2172, SelectionActionsMenu :238, omni-host :184,
code-pane-bridge :405 — each looked gated/O(1); list or fix each).
Also from the same gate, code-comment rot to sweep when nearby:
`panel-registry.ts:52,90` ("See POLYMORPHIC_CARD_PANEL below" — retired
symbol) and `card-registry.tsx:379` ("live key is revision:s:<id>" — that's
the LEGACY key; live is `float:card:<kind>:<id>`).

---

# Walk-session card/UX batch (reported 2026-06-12, Gabriel hands-on)

> **Investigation digest + ratified calls (2026-06-12).** The 8 walk bugs
> root into 5 chips (cross-cutting scan + 9-track workflow, causal claims
> 2x-verified where marked):
>
> - **Chip W-A — projection seam (#32 example editability + #33 expex parity,
>   subsumes #26):** ExampleCard.tsx hand-builds a `flex` lookalike of the
>   expex block (`:161` "recreate the example structure") + a read-only
>   BorrowedMainText whose schema lacks expex nodes; the EDIT button
>   (`:246`) is `disabled` because `onUpdateLatex` is wired only in omni-host,
>   not the float builder (`cards/floats/index.tsx`) or panel host
>   (`EditorPane.tsx:5476`). DEEP FIX: mount a read-only editor seeded with the
>   exampleBlock JSON via `buildEditorExtensions({surface:'float'})` (the
>   text-object float `example-block-body.tsx` already proves it) → kills the
>   3rd schema copy (backlog #11) AND gives always-on editing. Glosses/nested
>   xlists currently dropped (`Editor.tsx:1221-1260`).
> - **Chip W-B — popped-state seam (#34 selection + #36 gesture, both
>   confirmed x2):** #34 — `useAnchorHighlightReconciler.ts:266-271` stamps
>   `data-card-selected` on EVERY `[data-card-key]` incl. the chromeless
>   PanelCard root inside a float; `globals.css:2841` draws a 2px inset
>   rectangle around the inner body, not the window. FIX: a
>   `[data-floating-panel]:has([data-card-selected])` window-ring rule (docked
>   halo recipe) + suppress the inner outline in popped context; same class hits
>   hover. #36 — `FloatingPanel.tsx:679-685` wraps all children in a 0-threshold
>   grab handler; blocker selector (`:413-417`) lacks `[data-card]`, so a card
>   press arms panel-move (and 0px `pendingUndock`) before the card's 5px lift.
>   FIX: add `[data-card]` to the blocklist (dedup the 3 copies). Panel stays
>   drag-from-gaps (ratified default).
> - **Chip W-C — atom-delete contract (#37 confirmed x2 + footnote-orphan
>   sibling):** `useCitations.ts:213` deleteCitation filters the sidecar only,
>   no editor tx; `EditorPane.tsx:1112` syncFromEditor re-derives the card from
>   the live `\cite` atom on reload. Footnote does it right
>   (`Editor.tsx:1117` deleteFootnote → deleteLink → `tr.delete`);
>   `findInlineAtomPos` already handles `'citation'`. FIX (ratified: remove
>   atom + entry): compound `handleDeleteCitation` in EditorPane wired to all 4
>   call sites; also restore the removed `suppressOrphanRef` producer
>   (`footnote-sync.ts:7`) so footnote trash-delete stops resurrecting an orphan.
>   Drafts/unanchored citations have no atom → entry-only delete.
> - **Chip W-D — typography + title provenance (#30 + #31):** #30 —
>   `BODY_CLASS_TYPOGRAPHY.borrowed.fontSize = 15`
>   (`panel-typography.ts:46`) is a frozen px snapshot; main text is the live
>   `editorFontSize` rem pref → `--editor-font-size` (`EditorLayout.tsx:1317`).
>   RATIFIED: fixed −2px; derive in `usePanelBodyStyle` keyed on
>   override-absence; needs a non-cyclic root alias (PREF_TO_CSS row) since
>   RichTextField/BorrowedMainText write `--editor-font-size` into the nested PM
>   dom. Also revive the dead sans-tier `panelFontSize` pref. #31 —
>   `nextCardTitle()` (`panel-registry.ts:227`) is persisted at 6 creation
>   sites; no provenance flag. RATIFIED: stop persisting (pass `""`), suppress
>   collapsed+expanded, strip legacy titles matching `^<Label> \d+$` on load.
>   Sibling: todo seeds "Task N" into the BODY (`useTodos.ts:51`), tripping the
>   pristine-delete confirm.
> - **Chip W-E — cutter↔revision comment parity (#35):** CutterCommentCard
>   uses `PanelCard` + plain `<textarea>` + DIY collab wiring; RevisionComment
>   uses the shared `EditableCard` + RichTextField. The suggestion pair is
>   already converged (revision imports cutter's helpers). RATIFIED: migrate
>   CutterCommentCard onto EditableCard (rich-text body, auto collab); keep the
>   cut-excerpt as a labeled section. Extract the duplicated
>   FieldBlock/SuggestionTrailing helpers while there.
>
> **Ordering:** W-B before W-A (its selection fix benefits the floats W-A
> creates); W-C, W-D independent; W-E small, last. W-A & W-C both touch
> EditorPane.tsx (different fns) — sequence or merge carefully.


Items 30–37. User mandate: "many of these may be instances of broader
phenomena — the point of the spear — check for generalizations." Session-17
investigation workflow findings refine these in place.

## 30. Serif card bodies should track the main text size, one step smaller

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-D`) · **Area:** card typography

Borrowed-class bodies (archive, footnote, example) are a fixed 15px serif.
Desired: derive from the document's main text size minus a step (main 14 →
footnote ~12). Per-panel explicit size picks must still win.

## 31. Collapsed cards: show the title only when it's CUSTOM

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-D`) · **Area:** card panels / shared chrome

The new collapsed-title row also shows auto-generated titles ("Archive text
1", "Footnote 2"). Desired: generated titles never show in collapsed mode —
only user-authored ones. Likely deep fix: stop conflating generated and
custom titles at the data level (provenance), not a render heuristic.

## 32. Example cards: directly editable, no separate EDIT button

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-A`) · **Area:** card panels / examples

Example cards have an EDIT mode toggle (and the float-side button is
permanently disabled — subsumes item 26). Desired: directly editable like
every other editable card. Needs the editability story for doc-projected
content (the card edits the in-text exampleBlock).

## 33. Example card expex rendering diverges from the main text

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-A`) · **Area:** card panels / examples

The card's "(7) a." number font and alignment don't match the main-text
expex rendering (screenshot on file: number sits high/offset, different
spacing). Likely the borrowed-content parity class (related: item 11).

## 34. Popped-card selection should outline the float window, not square the text

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-B`) · **Area:** floats / selection

A selected popped card paints a highlight square around its TEXT — reads as
broken. Desired: selection = an outline around the whole float window;
docked halo unchanged.

## 35. Cutter comments should share the revision-comment layout

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-E`) · **Area:** card panels / comment family

CutterCommentCard's layout/structure drifted from RevisionCommentCard.
Desired: one shared comment-card structure (check the suggestion pair too).

Done: CutterCommentCard now renders through the canonical `EditableCard`
(rich-text RichTextField body, registry-derived collab claim, morph
chevron, AI-request footer) exactly like RevisionCommentCard. The one
unique element — the excised "Original" cut excerpt (`selectedText`) — is
kept as a section above the body via a new minimal, purely-additive
`aboveBody` slot on EditableCard. The DIY chrome (raw `<textarea>`, manual
`useCardClaim` wiring, partnerClaim dimming, headerTrailing
CollabCardTrailing) is deleted; comment writeback moved from the plain-text
path to the rich-text `updateCommentContent` path threaded through
panel/host/omni/floats. The suggestion pair was already converged — the
duplicated `FieldBlock` / `AuthorChip` / `SuggestionTrailing` / field maps
were extracted to `src/panels/_shared/suggestion-fields.tsx` (FieldBlock
parameterized by `panelKey`), consumed by both Cutter and Revisions.

## 36. Inside a floating panel, a card's grab-bar drags the PANEL

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-B`) · **Area:** floats / gestures

With a panel popped out, grabbing a card's grab-bar/header moves the whole
panel window instead of lifting the card. Card lift must win inside the
panel body; panel drag only from the panel's own chrome.

## 37. Deleting a citation card leaves the in-text atom; card resurrects on reload

**Reported:** 2026-06-12 · **Status:** done (2026-06-12, chip `W-C`) · **Area:** citations / data integrity

Create a citation, delete the card → the in-text \cite atom stays; on
reload the atom re-derives the card. Atom-bearing kinds' delete contract
must remove the atom + sidecar atomically (footnotes may already do this —
the pattern). Audit the delete-contract matrix across kinds.

---

## 38. Footnote-nested citation still resurrects on reload (W-C deferred edge)

**Reported:** 2026-06-12 (W-C review gate) · **Status:** done (2026-06-13, chip `R1`) · **Area:** citations / data integrity

Chip W-C fixed #37 for top-level `\cite` atoms (hard-delete removes atom +
entry). But a `\cite` living inside a footnote's `attrs.content` is NOT a
top-level doc atom, so `findInlineAtomPos` no-ops on delete — yet
`getCitations()` ([Editor.tsx:1487](src/components/Editor.tsx) via
`walkJsonContentForCitations` ~:337) DOES collect footnote-nested citations
into the panel, so on next mount the surviving nested `\cite` re-derives the
deleted card. Pre-existing systemic asymmetry (most panel mutations —
`updateCitationDisplay` too — only touch top-level), not introduced by W-C.
**Fix options:** (i) on delete, strip the nested `\cite` from the host
footnote's `attrs.content`; or (ii) stop collecting footnote-nested citations
into the deletable panel set. Also (W-C nit 2): add an integration pin for the
EditorPane→window→EditorLayout suppress-orphan seam (currently only the hook is
unit-tested; the synchronous-ordering guarantee rests on source inspection).

---

## 39. Example card staleness + read-only typeability + dead replaceExampleLatex (W-A nits)

**Reported:** 2026-06-12 (W-A review gate) · **Status:** done (2026-06-13, chip `R3`) · **Area:** examples / floats

W-A landed example cards as embedded editors (keystroke-sanctity verified). Three
deferred nits:
1. **Content-edit staleness:** the card re-seeds only when `rev.examples` bumps
   (add/remove), NOT on a content-only edit to the same example made in the MAIN
   editor — so the card shows stale text until the next structural change/remount
   (main is authoritative; no data loss unless the user then types into the stale
   card). Fix: a per-uuid example-content structural event the card can subscribe
   to (cheap, observer-driven), like the in-editor float's `useMainTransactionSync`
   but without the per-transaction cost.
2. **Read-only typeability:** the card editor is `editable:true` unconditionally;
   on a read-only/claimed doc the write-back tr lacks `ignoreReadOnly`, so it's
   rejected at dispatch — the user types, sees a local change, it silently drops.
   PRE-EXISTING and identical to the shipped `example-block-body.tsx` float — fix
   both together (gate float editability on main editability).
3. **Dead handle:** ~~`EditorHandle.replaceExampleLatex` is now orphaned (omni-host
   consumer removed) — delete or annotate.~~ DONE 2026-06-12: removed the declaration
   + implementation + the now-orphaned `parseLatex` import (tsc clean,
   `src/panels/Examples/` green). Still open: `docIdRef` not threaded to the card
   editor, so nested figure/graphics atoms render as pills not images (cosmetic);
   and the W-A write-back TEST hand-builds a replaceWith instead of driving
   `writeBackToMain` through the card onUpdate — strengthen it.

---

## 40. Example follow-up residue (R3 review nits)

**Reported:** 2026-06-13 (R3 review gate) · **Status:** done (2026-06-13, chip `#40-residue`) · **Area:** examples / floats

Two deferred items from the R3 gate (#39 work):
1. **example-item-body.tsx read-only bug:** lines ~335/346 still hardcode
   `editable: true` — the SAME latent bug R3 fixed in `example-block-body.tsx`
   + `ExampleCard.tsx`. An example-ITEM float on a read-only/partner-claimed doc
   accepts phantom typing the enforcer silently rejects. One-line fix: the
   identical `useMainEditable` + lock-step `setEditable` pattern.
   **DONE:** mirrored the example-block-body fix exactly — `useMainEditable(mainEditor)`
   gates `buildEditorExtensions({editable})` + the `useEditor` `editable` option +
   a `setEditable` reconciliation effect. Test
   `src/text-objects/floats/__tests__/example-item-body-readonly.test.tsx`
   (read-only float mounts non-editable; editable control).
2. **Echo-guard boundary test:** post-#39 the card's own write-back re-triggers
   the re-seed effect (via the new `contentRev`), and only the
   `editor.getJSON() === nextJson` compare (ExampleCard.tsx ~:265) prevents a
   mid-typing cursor reset. The new tests drive a MAIN-editor edit, not a CARD
   edit, so the echo path is unpinned. Add a test that types THROUGH the card
   editor (the fiber harness already exists in ExampleCardEditor.test.tsx) and
   asserts the cursor/selection survives — cheap insurance for a now-load-bearing
   invariant.
   **DONE:** two tests added to `ExampleCardEditor.test.tsx` (describe
   "ExampleCard re-seed cursor survival (#40 PART 2)"). **Finding:** the card's
   own write-back does a *full-block* `replaceWith`, which the step-inspector
   does NOT attribute to `exampleContentChangedUuids` (the replace range resolves
   to a between-blocks boundary, not inside the example), so the own-write does
   NOT bump `contentRev` — i.e. the "echo via contentRev" the original note
   assumed does not actually fire; line ~264 (`lastSyncedRef === nextJson`) /
   lack-of-signal is what protects the own-write path. The DETERMINISTIC,
   mutation-proven load-bearing caret invariant is the `setTextSelection` *restore*
   around the re-seed `setContent`: parking the card caret mid-text and driving a
   *foreign* main interior edit re-seeds the card while preserving the caret
   offset (4 → 4); removing the restore regresses it (4 → 14). The first test
   still types THROUGH the card editor and asserts the caret survives the
   self-write-back round-trip (no spurious re-seed) per the chip's spirit.

---

## 41. Omni unanchored / outside-focus bins — top gap + equal-height badge polish

**Reported:** 2026-06-15 · **Status:** open · **Area:** ui-chrome / Omni panel bins

Two corrections to the absolute-positioned "N unanchored" / "N outside focus" pill
bins that float at the top of the omni folder
([OmniViewPanel.tsx](src/panels/Omni/OmniViewPanel.tsx)):

**(1) Thin gap above the "unanchored" box (NOT focus-view-specific).** The
`OmniUnanchoredBin` is pinned flush to the folder top — `position: absolute; top: 0`
([:280](src/panels/Omni/OmniViewPanel.tsx:280)). Add a thin gap (e.g. `top: 4`)
between it and the manilla folder's top edge. This bin shows whenever there are
unanchored cards, independent of focus view (hence "not focus-view specific").

**(2) Equalize the two boxes' heights by shrinking the no-anchor badge.** The
unanchored pill is taller than the "outside focus" pill because its leading icon is
`BadgeOrphaned` — a **20px** (`w-5 h-5`) square with a diagonal cross-out
([panel-primitives.tsx:309](src/components/panel-primitives.tsx:309)) — whereas the
outside-focus pill uses a **10px** `◎` dot
([OmniViewPanel.tsx:359](src/panels/Omni/OmniViewPanel.tsx:359)). Desired: make the
no-anchor badge a **small squircle** (~dot-sized, ~10px), **same colors**
(`theme.badgeBg` / `theme.badgeBorder`), **no cross-out** (drop the `<svg>` diagonal
line). The two pills then share a height.

**Implementation notes:**
- `BadgeOrphaned` must get its **own** smaller dimensions — do NOT shrink the shared
  `BADGE_BASE` (`w-5 h-5`, [panel-primitives.tsx:274](src/components/panel-primitives.tsx:274)),
  which the count badge also uses.
- The change is **global** to `BadgeOrphaned`, which also renders in the bin's
  expanded orphan list ([OmniViewPanel.tsx:307](src/panels/Omni/OmniViewPanel.tsx:307))
  and the **FootnoteCard header** ([FootnoteCard.tsx:220](src/panels/Footnotes/FootnoteCard.tsx:220)).
  Verify the smaller, cross-out-less badge still reads as "orphaned" there (the
  `data-hint="No anchor in document"` tooltip carries the meaning).
- **Both corrections shift the unanchored pill's box**, so update the outside-focus
  bin's hardcoded stack offset `topPx={… ? 34 : 0}`
  ([OmniViewPanel.tsx:540](src/panels/Omni/OmniViewPanel.tsx:540)) to match the new
  (shorter pill + 4px top gap) bottom edge — otherwise the two bins overlap or gap.

---

## 42. Collapsed borrowed-body cards (footnote / archive / example) clip the 2nd preview line

**Reported:** 2026-06-15 · **Status:** open · **Area:** ui-chrome / card chrome

**Reported behavior** — a collapsed card should show its optional title + **two
full lines** of body text. Most kinds are fine, but **footnote and archive** (and
by the same mechanism, **example**) clip the **2nd** line mid-glyph — only its top
half shows.

**Root cause — a line-height mismatch between the clamp ceiling and the borrowed
renderer.** The collapsed body is clamped by `compressedBodyStyle(n)`
([panel-primitives.tsx:150](src/components/panel-primitives.tsx:150)), which sets
`lineHeight: 1.4` **and a hard ceiling** `maxHeight: calc(1.4em * n)`
([:167](src/components/panel-primitives.tsx:167)) — i.e. **2.8em** for 2 lines,
computed assuming line-height 1.4. But the **borrowed-class** kinds
(`CARD_REGISTRY[kind].bodyClass === "borrowed"` → footnote / archive / example,
`useBorrowedCompressed` at [:854](src/components/panel-primitives.tsx:854)) render
their collapsed body through **`BorrowedMainText`** (real prose with inline atoms)
at the editor/footnote body line-height ([:1038–1045](src/components/panel-primitives.tsx:1038)).
That line-height is **> 1.4**, so two rendered lines occupy **more than 2.8em** and
the ceiling clips line 2. Non-borrowed kinds render the plain `compressedSummary`
string directly at line-height 1.4, so two lines == exactly 2.8em and fit — hence
"good for most."

**Fix — align the ceiling with the actual rendered line-height.** When
`useBorrowedCompressed`, call `compressedBodyStyle(compressedLines, { lineHeight:
<the borrowed body's line-height> })` (the `compressedBody` from
`usePanelBodyStyle` at [:850](src/components/panel-primitives.tsx:850) carries it),
so the `maxHeight` ceiling matches the renderer — OR clamp the `BorrowedMainText`
itself to `compressedLines` using its own line-height rather than the 1.4-based
parent ceiling. Verify footnote / archive / example show two **full** lines and the
plain-summary kinds don't regress (they're already correct at 1.4).
