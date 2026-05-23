# Grab-handle overhaul — findings memo

_Date: 2026-05-23. Companion to `cursor-selection-reactor-audit.md`._

## TL;DR

The `TextObjectGrabHandle` (`src/text-objects/TextObjectGrabHandle.tsx`) is the second-worst reactor in the editor after `useMarginalia`. It listens to **selection changes, doc changes, global scroll, global resize, global mousemove, and document selectionchange** — and on every one of those, it does an O(N) walk of the doc plus 2–3 `coordsAtPos` calls plus a DOM hit-test. It carries ~60 lines of dead code from a completed migration. And it has a `useEffect` that re-attaches all four window listeners on every viewport-cache version tick.

There are seven concrete cuts. More importantly, the offenses cluster into four **architectural threads** that, if pulled, would prevent this class of bug from recurring across the codebase — not just in this one file.

---

## 1. The misconception worth correcting

The natural intuition is: _"the grab handle only matters when there's a selection — it shouldn't need to listen for cursor moves."_ That intuition is wrong, and the reason is worth writing down because it affects how we reason about cuts.

The grab handle is no longer the **selection** drag handle. It is the **single canonical grip for every block in the document** plus for live selections. It replaced (per its own docstring):

- `SelectionDragHandle` (the old selection-only handle)
- The per-NodeView grips inside `ParagraphWithTitle`, `HeadingWithLabel`, the list `NodeView`, `TexBlockNodeView`, `ExampleBlock`

A single instance, mounted at the editor level, has to dock next to **whichever block the user is currently in** — whether that's via selection, caret, or (for atom blocks like `texBlock` / `displayMath` / `figureBlock` / `latexComment` / `graphicsBlock`) mouse hover. The 5-step resolution priority in the docstring (lines 16–27 of the source) makes this explicit. Cursor moves are 60–70% of the events it has to handle. Mousemove exists to surface the handle on atom blocks that can't accept a caret.

So the question is not "why does it watch cursor / mouse at all" but "is it watching too broadly and computing too eagerly." Answer: yes, significantly.

---

## 2. The seven cuts

Each cut is independently shippable. They're listed in suggested order — cheap wins first, then larger restructures.

| # | Cut | What it removes | Why it's safe | Expected savings |
|---|---|---|---|---|
| **1** | **Delete the legacy `.par-drag-handle` supersession** | `Placement.superseded`, `Placement.paragraphUuid`, the `supersededUuidRef`, lines 393–397, the `useLayoutEffect` at 622–641, the cleanup `useEffect` at 643–657, the equality checks at 146–147. | Grep confirms no `.par-drag-handle` references anywhere in `src/`. The Phase D4 migration that was supposed to delete it has shipped; this is pure dead code running `querySelector` on every placement change. | Small per-keystroke, but it's all overhead today. Also reduces complexity of the placement struct. |
| **2** | **Scope the mousemove listener to `editor.view.dom`** instead of `window` (line 601). | The window-global mousemove subscription. | The hover-discovery only matters when the mouse is over the editor. Today every pixel of mouse movement anywhere on screen — over panels, menus, other monitors — enters the handler. | Big. Mousemove is the highest-frequency event in the app. This eliminates most idle-CPU cost from mouse movement outside the editor. |
| **3** | **Bail early if `document.elementFromPoint` returns the same element as last time** in `resolveTextObjectAtMouse`. | Per-pixel hover re-computation when the mouse hasn't crossed an element boundary. | The hover answer only changes when the mouse crosses into a different DOM node. Dragging the mouse 1px inside the same paragraph cannot change the resolved ref. | Big during mouse-over-editor idle. |
| **4** | **Drop the document `selectionchange` listener** (line 602, handler 555–597) — or scope it to non-contenteditable-mode-only. | The DOM→PM selection-mirror handler. | The comment says it's "for the Reader's contenteditable=false case." In normal editing, ProseMirror's own `selectionUpdate` already fires on the same DOM event. Today we do the work twice. If the Reader still needs it, scope by `editor.options.editable` or by a Reader-only mount flag. | Medium. Every selection change does a DOM-range read + `posAtDOM × 2`. |
| **5** | **Replace `doc.descendants` walk for known-uuid refs** (line 281) with a `uuid → pos` cache maintained by a ProseMirror plugin. | The O(N) doc walk on every placement compute for non-selection refs. | A ProseMirror plugin can maintain a `uuid → pos` index via `transaction.mapping` — O(1) lookup, O(log N) update per change. This is also useful for `useMarginalia`, the link bridge, paragraph-context helpers, and anything else that needs to find a block by UUID. | **Large on long docs.** This is one of the worst offenders during typing on a 500-paragraph doc. |
| **6** | **Add an early-out at the top of `onMouseMove`**: if `sel.from !== sel.to`, return before storing `mousePosRef`. | Useless state-write churn during active selection drags. | Lines 550–553 already gate-out scheduling when a selection is active. But we still write `mousePosRef.current = …` on every move. Early-returning before the write lets the engine elide the entire handler body when a selection is active. | Small but free. |
| **7** | **Split the giant `useEffect`** (407–616). The placement compute closure depends on `cacheRef` + `cacheVersion`; the listener install does not. | Listener-churn on every viewport-cache version tick. | Today, when the editor resizes (which bumps `cacheVersion`), the whole effect tears down and re-installs all four window listeners. The listeners themselves don't depend on `cacheVersion` — only the `schedule()` closure does. Split into (a) a one-time listener-install effect that calls a stable `scheduleRef.current()`, and (b) an effect that updates the ref when `cacheRef` / `cacheVersion` changes. | Small per resize, but cleaner and eliminates a class of listener-leak risk. |

### Cuts to be cautious about (and why)

- **Removing the cursor-position subscription entirely.** Breaks the core promise: grip follows caret. Don't.
- **Removing `mousemove` entirely.** Atom blocks (`texBlock`, `displayMath`, `figureBlock`, `latexComment`, `graphicsBlock`) have no way to surface the grip otherwise — there's no caret to land. Scope (#2) and gate (#3); don't kill.
- **Removing `selectionchange`** without first confirming the Reader's contenteditable=false path is gone or covered elsewhere. The handler exists for a reason; the question is whether that reason still applies in 2026 builds.

---

## 3. The architectural threads (deep fixes that prevent recurrence)

The seven cuts are surgical. The point of doing them all in one pass is that they cluster into four cross-cutting patterns. Each pattern is a place where a piece of shared infrastructure would make this class of bug structurally hard to write again.

### Thread A — Centralized "active TextObject" subscription

Today, `TextObjectGrabHandle`, `SelectionActionsMenu`, `ActionsStripButton`, `ActionsMenuPanel`, and `useEditorUIState` all separately compute "what TextObject is the caret/selection in." Each subscribes independently to `selectionUpdate` and does its own resolver walk. This is wasted work AND inconsistent — they could disagree on edge cases.

**Architectural fix:** A single `useActiveTextObject(editor)` hook (or context) that subscribes once per editor and exposes the resolved ref as a tearable observable. Consumers subscribe via `useSyncExternalStore`. The resolver becomes the **only** thing reading selection on `selectionUpdate`.

This is the same insight that drives `useEditorViewportCache`: one cache, shared, derived from the native source. Apply it to selection-derived state too.

### Thread B — UUID → pos index as ProseMirror plugin

Today, `doc.descendants` walks for "find the block with uuid X" exist in:

- `TextObjectGrabHandle.computePlacement` (line 281)
- `useMarginalia` (full sweep, every keystroke)
- Likely several link-resolution paths under `src/links/` and `editor/` (verify in the follow-up)

Each is O(N). A ProseMirror plugin maintaining a `Map<uuid, pos>` via `transaction.mapping` is O(1) lookup, with O(log N) updates only on structural transactions. The plugin is the single source of truth; all consumers use it. Doc-walks for UUID lookup become a lint-grep-banned pattern.

### Thread C — No window-scoped listeners for editor concerns

`window.addEventListener("mousemove" / "scroll" / "resize")` and `document.addEventListener("selectionchange")` appear in `TextObjectGrabHandle`, `SelectionActionsMenu`, `useMarginalia`, `FloatingPanel`, and (per the audit) probably several other places. The handlers are doing editor-scoped work but listening at the document or window level — paying for every event in the app regardless of relevance.

**Architectural fix:** scope to `editor.view.dom` (or a designated editor scroll-parent) wherever the work is editor-specific. For the rare case where a global listener is genuinely needed (e.g. drag-with-capture), use pointer-capture or a single shared dispatcher, not N independent global listeners.

A helper utility — `useEditorDomEvent(editor, "mousemove", handler)` — would make the right choice the easy choice. The wrong choice (window listener) becomes the visible outlier.

### Thread D — Viewport-aware compute gate

Right now, the grab handle's placement clamps out-of-viewport refs late — after it's already done `coordsAtPos × 2`, the DOM hit-test, and the doc walk. The marginalia case is worse — measures the whole doc regardless of what's on screen.

The audit memo's Section 6 names the principle: **scope reactor work to the viewport.** An `IntersectionObserver` per-block, with a sparse cache of "currently in near-zone," lets every layout-reading reactor consult one canonical "is this block worth measuring?" predicate. Off-screen blocks return `null` immediately; the bezier-routing, grip-placement, marginalia, etc. all skip work for them.

A shared `useNearViewportBlocks(editor)` registry would serve all consumers.

---

## 4. Cross-references

- **`docs/perf/cursor-selection-reactor-audit.md`** — the full inventory and architectural principles. This memo's Section 3 threads map onto the audit's Section 6 principles 1, 2, 5, 6.
- **`docs/perf/marginalia-overhaul-prompt.md`** — the prior follow-up session. The architectural threads here overlap with what that session is implementing for marginalia (Thread B and Thread D especially). Coordinate: if the marginalia overhaul lands first, the UUID-index plugin and the near-viewport registry should be designed for reuse from day one — not bolted on for the grab handle later.

---

## 5. What this memo is _not_ saying

- It's not saying the grab handle is wrong to watch cursor moves. It has to — that's its job.
- It's not saying every window listener is bad. Pointer capture, real global events (escape key, window blur), and a few others legitimately need window scope.
- It's not promising any specific frame-budget win from any one cut. The wins compound; the point is to ship them as a set and measure the result against a long doc under typing load.

The follow-up prompt is `grab-handle-overhaul-prompt.md`.
