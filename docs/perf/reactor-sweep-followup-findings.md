# Reactor sweep — follow-up findings

_Date: 2026-05-23. Companion to `cursor-selection-reactor-audit.md`,
`grab-handle-overhaul-findings.md`, and `grab-handle-overhaul-prompt.md`._

## What landed in this session

Phase 1 (the seven grab-handle cuts) and the four top architectural fixes
from Phase 2 are in. The shared infrastructure they sit on is now
available for the rest of the codebase to adopt.

### Shipped infrastructure

| Piece | File | What it does |
|---|---|---|
| `walkAnchorableBlocks(editor)` + `resolveDomForUuid(editor, uuid)` | `src/lib/marginalia-blocks.ts` | Shared utilities extracted from `useMarginaliaRegistry`. Walk the doc once for `{uuid, pos, isAtom}` rows; resolve a block's DOM by UUID via the `data-uuid` decoration. **Banned pattern:** open-coded `doc.descendants` for UUID lookup. |
| `useEditorDomEvent(editor, event, handler, options?)` | `src/hooks/useEditorDomEvent.ts` | Attach a handler to `editor.view.dom` for a named event. Handler captured by ref → stable listener identity across re-renders. |
| `useEditorScrollParentEvent(editor, event, handler, options?)` | `src/hooks/useEditorDomEvent.ts` | Same shape but attaches to the editor's scroll parent via `findEditorScrollFor`. Use for scroll listeners on the editor's actual scroll source. |
| `ActiveTextObjectProvider` + `useActiveTextObject()` | `src/text-objects/active-text-object-context.tsx` | One subscription per editor for the resolved active TextObject (5-step priority, minus mouse hover). Mounted inside `Editor.tsx` to wrap the grab handle, selection actions menu, and slash popup. |
| (Pre-existing — call out for visibility) `useMarginaliaRegistry` | `src/hooks/useMarginaliaRegistry.ts` | The canonical near-viewport block registry. One `IntersectionObserver` (±800px), one `ResizeObserver` per observed block. Consumers call `getMetrics(uuid)` and get `null` for off-screen. **Current limitation:** instantiated per-consumer; only one consumer today (`Marginalia.tsx`). Lifting it to a shared context would let `useInTextPositions` and any other geometry-coupled reactor consume the same instance. |

### Net behavior change

- Grab handle no longer walks the doc to resolve known-UUID refs, no longer re-installs DOM listeners on viewport-frame version bumps, no longer ships the dead `.par-drag-handle` supersession path. `selectionchange` listener gated to Reader mode (`!editor.isEditable`). *(Corrected, Wave-4 P6: the original "no longer listens to global mousemove" claim was FALSE as written — a document-level mousemove listener is DELIBERATE and remains, so the hover zone can include the margin; it is bounded by the C7 viewport-frame `containsHoverZone` bail and routed through the layout-gesture park, and since Wave-2 C1 the hover resolve itself is the geometry service's `blocksAtY` cached-band lookup, with the O(doc) `[data-uuid]` sweep surviving only under the `virgil:geom-hover` kill-switch. The "viewport cache" this sweep referenced was deleted in Wave-2b C7 — the C7 service frame replaced it.)*
- `LinkConnector` skips bezier path generation when both endpoints are off-screen.
- `SlashCommandPopup` RAF-coalesces its scroll/resize-driven `coordsAtPos` recomputes; scroll listener moved to the editor's scroll parent.
- `SelectionActionsMenu` scroll listener moved to the editor's scroll parent (mousedown/mouseup stay global because the drag can complete outside the editor; resize stays global).
- `useInTextPositions` skips per-card `getBoundingClientRect` for items whose paragraph anchor sits outside the viewport ±600px.

---

## What still needs work (deferred to follow-up sessions)

Each entry: file:line, category (1-7 per `grab-handle-overhaul-prompt.md`
Phase 2), proposed fix, and whether it's surgical or architectural.

### Window-scoped listeners for editor-scoped work (category 1)

| File:line | What it does | Proposed fix | Type |
|---|---|---|---|
| `src/components/FloatingPanel.tsx:377` | Per-panel mousemove for drag-position tracking. Guarded by `dragStateRef`, so the body only runs during active drag — but the listener is installed at window scope always. | Migrate to a shared `useDragHandler({onDown, onMove, onUp})` helper built on `useEditorDomEvent`. Pointer-capture-based drag is the right primitive here. | Architectural |
| `src/components/panel-primitives.tsx:1642` | Window mousemove for panel positioning. Same shape. | Same: migrate to `useDragHandler`. | Architectural |
| `src/components/drop-mode/controller.ts:148` | Window mousemove for drop-mode cursor tracking. Drop-mode is editor-scoped (drag-and-drop into the prose). | Scope to `editor.view.dom` via `useEditorDomEvent`. Outside the editor the drop isn't valid. | Surgical |
| `src/hooks/useDragPosition.ts:53`, `useDragGap.ts:105`, `useMarginEdit.ts:256` | Three drag hooks, each independently installing window mousemove without RAF. | Build the `useDragHandler` utility and migrate all three. Net code reduction; the global pattern stops being copy-pasted. | Architectural |
| `library/components/LibraryView.tsx:159, 205`, `library/components/LeftList.tsx:210` | Library-side pointermove handlers for column-resize and list-row drag. | Same `useDragHandler` if applicable; or pointer-capture API directly. | Architectural |
| `src/components/EditorLayout.tsx:901, 1342, 2947` | Document-scoped `keydown` for app-level hotkeys. **Probably correct as-is** — these are app-wide keyboard shortcuts that should fire regardless of focus. | Audit each: confirm it's genuinely app-wide. If any are editor-scoped, migrate. | Audit |
| `src/components/EditorLayout.tsx:1431` | Document mousedown for click-outside. **Probably correct as-is** — click-outside genuinely needs global scope. | Confirm; leave if so. | Audit |

### Multiple subscriptions to the same source event (category 5)

| File:line | What it does | Proposed fix | Type |
|---|---|---|---|
| `src/hooks/useWordCount.ts:290-291` | Subscribes to both `update` and `selectionUpdate` on the editor. | Consume `useActiveTextObject` for the selection-derived part; keep an `update`-only subscription for the content-derived part. | Architectural |
| `src/components/SelectionActionsMenu.tsx:235-238` (still present) | Subscribes to `selectionUpdate`, `update`, `focus`, `blur` independently of the `ActiveTextObjectProvider` that wraps it. | Migrate to consume `useActiveTextObject()` for the selection part. Needs an extended API (`useActiveTextObjectSubscribe(cb)` that fires the callback without surfacing a value) since the menu's placement compute needs the raw `coordsAtPos(head)`, not the resolved ref. | Architectural |
| `src/components/ActionsStripButton.tsx:74-76` | `selectionUpdate` + `focus` + `blur` subscription. | Migrate to consume `useActiveTextObject()`. | Architectural |
| `src/hooks/useEditorUIState.ts:196-197` | `selectionUpdate` + `transaction` subscription for paragraph-uuid persistence. | Could migrate, but cursor-position persistence is debounced 400ms — wins are smaller here. Lower priority. | Architectural |

### O(N) doc walks (category 3)

`useMarginaliaRegistry.ts:291`, `useInTextPositions.ts:24-29`, and the
multiple `doc.descendants` callers in `Editor.tsx` / `EditorLayout.tsx`
were inventoried. Most are unavoidable structural walks (not UUID
lookups). Cases worth migrating to `walkAnchorableBlocks`:

- Any caller doing `doc.descendants` to find a block by UUID. Grep regex:
  `doc\.descendants\([^)]*node\.attrs\?\.uuid`.
- `getParagraphAnchorPositions` (`useInTextPositions.ts:24`) does a walk
  that's identical to `walkAnchorableBlocks` shape (`uuid → pos` for
  anchorable nodes). **Migrate to `walkAnchorableBlocks` directly** —
  exact same work, one less open-coded walk to maintain.

### Off-screen layout computation (category 2)

- `useMarginaliaRegistry` is now the canonical pattern. The off-screen
  gate for `useInTextPositions` landed this session in the form of a
  coarse `coordsAtPos` + viewport-range check (the registry can't be
  shared without a lift-to-context refactor).
- **Architectural follow-up:** lift `useMarginaliaRegistry` to a context
  provider so a single instance serves all geometry-coupled reactors
  (marginalia, in-text positions, eventually grab handle for
  hover-discovery prioritization). Single `IntersectionObserver` for the
  whole app instead of N per consumer.

### Re-attaching listeners on irrelevant dep changes (category 4)

- `src/components/SlashCommandPopup.tsx:67`: deps are
  `[state.open, state.open ? state.slashPos : -1, editorRef]`. The
  listener body uses refs, so reattaching on `slashPos` change is
  wasteful. Could be split similarly to Cut 7. Low priority — these
  listeners are short-lived (only while the popup is open).

### Per-pixel mousemove/scroll without RAF (category 6)

Mostly covered by Phase 1 + Phase 2. Remaining:

- The three drag hooks (`useDragPosition`, `useDragGap`, `useMarginEdit`)
  do per-pixel state updates without RAF. The `useDragHandler` helper
  proposed above would RAF-coalesce them as a side-effect.

### Dead code from migrations (category 7)

- `par-float-paragraph` class is set on float bodies in
  `src/text-objects/floats/paragraph-body.tsx:244` and
  `src/text-objects/floats/linked-range-body.tsx:220` but has no
  matching CSS rule after Cut 1's cleanup. Either delete the class
  application or restore the rule. Probably delete — the rule it had
  was scoping a `.par-drag-handle` rule that no longer exists.

---

## Principles addendum

Extending Section 6 of the audit memo with what this sweep surfaced:

1. **No window-scoped DOM listener in editor code unless the event is
   genuinely global.** Genuinely global = window resize, escape key,
   window blur, click-outside-everything. Anything else scopes to the
   editor DOM (via `useEditorDomEvent`) or the editor's scroll parent
   (via `useEditorScrollParentEvent`). After this rule, a
   `window.addEventListener` in a file under `src/components/` or
   `src/text-objects/` should look anomalous.

2. **Every reactor that reads geometry needs a viewport gate.** Either
   consume `useMarginaliaRegistry.getMetrics(uuid)` (returns `null` for
   off-screen, sourced from the canonical `IntersectionObserver`), or
   do a coarse `coordsAtPos` + scroll-parent-rect-range check before
   the heavier per-element `getBoundingClientRect`. Don't measure what
   the user can't see.

3. **One subscription per source event per editor.** If a hook subscribes
   to `selectionUpdate` or `transaction`, check whether
   `ActiveTextObjectProvider` already covers what it needs. If the
   provider's resolved-ref output isn't sufficient, extend the
   provider's API rather than adding a parallel subscription.

4. **UUID lookups go through `walkAnchorableBlocks` /
   `resolveDomForUuid`.** Open-coded `doc.descendants` walks for UUID
   resolution are now a lint-grep-banned pattern. Structural walks
   (counting blocks by kind, gathering all nodes of a type) are still
   fine.

5. **Listener install effects' dep arrays must contain only things that
   change the listener identity.** Cache versions, dynamic options,
   computed targets — those flow through refs, not deps. The
   listener-install effect should mount once per editor instance, not
   re-attach on every layout tick.

---

## Cross-references

- `docs/perf/cursor-selection-reactor-audit.md` — the original audit.
- `docs/perf/marginalia-overhaul-prompt.md` + the now-landed
  `useMarginaliaRegistry` — the source of the `IntersectionObserver`
  pattern this session built on.
- `docs/perf/grab-handle-overhaul-findings.md` + `…-prompt.md` — the
  immediate predecessors. Phase 1 of the prompt is now complete.
