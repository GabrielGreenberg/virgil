# Prompt — Grab-handle overhaul + exhaustive reactor sweep (next session)

_Pick this up cold. Don't assume context._

## What you're doing and why

Text manipulation in Virgil is choppy. We did a thorough cursor/selection reactor audit (see `docs/perf/cursor-selection-reactor-audit.md`); the worst single offender is `useMarginalia`, which is being handled in `marginalia-overhaul-prompt.md`. **This session handles the second-worst offender — `TextObjectGrabHandle` — and then performs an exhaustive secondary sweep for the same class of problem everywhere else.**

The grab handle's specific issues are catalogued in `docs/perf/grab-handle-overhaul-findings.md`. **Read it before doing anything else.**

The sweep matters as much as the grab handle. The user's explicit instruction: _"do an exhaustive search to make sure there are no other places where it is doing serious watch work that doesn't have to be done, or serious compute work — like computing the position of off screen elements. Prefer deep architectural solutions that prevent similar problems from occurring over superficial surgical patches."_

That instruction has two parts:
1. **Find it.** Don't stop at the obvious. The reactor audit caught the headline cases; this sweep is looking for everything else.
2. **Fix it architecturally.** Surgical patches are how we got here. The right fix for a class of bug is a piece of shared infrastructure that makes the wrong pattern visibly wrong.

## Required reading before coding

1. **`docs/perf/cursor-selection-reactor-audit.md`** — the full audit. Sections 3, 5, and 6 especially.
2. **`docs/perf/grab-handle-overhaul-findings.md`** — the specific findings for `TextObjectGrabHandle`, including the seven cuts and the four architectural threads.
3. **`docs/perf/marginalia-overhaul-prompt.md`** — the parallel session for `useMarginalia`. **Important:** if that session has already landed, several of the architectural threads in this session (UUID-index plugin, near-viewport registry) may already exist. **Check first.** Reuse what's there; do not duplicate.
4. **`src/text-objects/TextObjectGrabHandle.tsx`** — the main subject. ~850 lines.
5. **`src/hooks/useEditorViewportCache.ts`** — existing viewport-cache pattern. Good prior art for "drive from native producer, share one cache."
6. **`AGENTS.md` + `docs/agents/overview.md`** — orientation. The Next.js / TipTap versions here have breaking changes from training data; read `node_modules/next/dist/docs/` or the TipTap source under `node_modules/@tiptap/` if any API feels uncertain. Don't guess.

## This is architectural, not surgical

Standing user preference (and memory `feedback_deep_architecture.md`): **deep architectural fixes over surgical patches.** For every cut in Phase 1, ask: what's the shared piece of infrastructure that would have prevented this AND would prevent the next analogous bug? Build that. The surgical version is a fallback, not the goal.

The end state of this session: writing the wrong-shaped reactor next time should be the harder path, not the easier one.

---

## Phase 1 — The seven cuts to `TextObjectGrabHandle`

All seven are listed in `grab-handle-overhaul-findings.md` Section 2 with file:line references. Implement all of them. Order suggested below; deviate if a later cut subsumes an earlier one.

### Cut 1 — Delete the legacy `.par-drag-handle` supersession (dead code)

Remove `Placement.superseded`, `Placement.paragraphUuid`, `supersededUuidRef`, the supersession refs (lines 393–397), the `useLayoutEffect` at 622–641, the cleanup `useEffect` at 643–657, and the matching equality checks at 146–147 of `src/text-objects/TextObjectGrabHandle.tsx`. Verify with `grep -rn "par-drag-handle" src/` — should be zero hits. Simplify `Placement` accordingly.

### Cut 2 — Scope mousemove to the editor DOM

`window.addEventListener("mousemove", onMouseMove)` at line 601 → attach to `editor.view.dom` instead. Adjust cleanup at line 613. **Architectural extension:** create a `useEditorDomEvent(editor, eventName, handler, options?)` helper in a sensible spot (probably `src/hooks/` or `src/lib/editor-events/`). Migrate this listener to use it. The helper handles attach/detach on editor change and on unmount. Apply it everywhere else in this file too (e.g. `scheduleRaf` callers for scroll could remain window-level since scroll happens on the scroll parent, not the editor DOM — verify).

### Cut 3 — Hover discovery: early-out on unchanged element

In `resolveTextObjectAtMouse` (lines 199–235), cache the last `document.elementFromPoint` result. If the new element is `===` the cached one and the cached ref hasn't been invalidated by a doc change, return the cached ref without doing `posAtCoords` or the ancestor walk. Invalidate the cache on `editor.on("update")` when `docChanged` is true.

### Cut 4 — Document `selectionchange` listener

Audit the actual need. Search for the Reader / `contenteditable=false` path:

```
grep -rn "contentEditable" src/ | grep -i false
grep -rn "editable: false" src/
grep -rn "isEditable" src/
```

If the Reader case still exists, gate the listener install on `!editor.options.editable` (or whatever the canonical "reader mode" predicate is) and document why. If it's gone, delete the listener and its handler. Either way the listener should not run in the normal editing path.

### Cut 5 — UUID → pos index plugin

This is the architectural thread that pays off most broadly. Create a ProseMirror plugin (suggested location: `src/lib/tiptap/uuid-pos-index.ts`) that maintains a `Map<string, number>` from UUID to current pos. Update via `transaction.mapping.map(pos)` on every transaction. Expose a `findPosByUuid(state, uuid): number | null` helper.

**Then migrate consumers**, starting with this file:
- `TextObjectGrabHandle.computePlacement` (line 281 `doc.descendants` block) → `findPosByUuid`.

Grep for other `doc.descendants(` callers that look up by uuid:

```
grep -rn "doc.descendants" src/ editor/ library/
```

For each one, decide: is this a UUID lookup (migrate) or a structural walk (leave alone)? **The migration must be done with the index plugin in mind** — design the plugin API to serve all of them. Coordinate with marginalia: if the marginalia overhaul has landed and introduced its own index, reuse and extend; do not fork.

### Cut 6 — Early-out in `onMouseMove` when a selection is active

Lines 544–554. Move the `sel.from === sel.to` check to the top of the handler. Return immediately if a selection is active, before touching `mousePosRef`. Trivial.

### Cut 7 — Split the giant `useEffect`

Lines 407–616 currently re-attach all window listeners when `cacheVersion` changes. Split into:

1. **Listener-install effect** with deps `[editorRef]` (or just `[]` if editorRef is stable per its `useRef` semantics). Calls `scheduleRef.current()`. Installs/cleans up the four DOM listeners exactly once per mount.
2. **Schedule-closure effect** with deps `[cacheRef, cacheVersion]`. Updates `scheduleRef.current` to a closure that captures the current cache.
3. **Editor-subscription effect** with deps `[editorRef]`. Handles `editor.on/off`.

This eliminates listener-churn on viewport-cache version ticks.

### Verification for Phase 1

After all seven cuts, run the dev preview against `samples/annotation-history` (load via `virgil-data/doc_devtest`):

- Grip docks correctly on click in every block type (paragraph, heading, list item, blockquote, codeBlock, texBlock, exampleBlock, figureBlock).
- Hover-to-surface still works for atom blocks (texBlock, displayMath, figureBlock, latexComment, graphicsBlock).
- Drag-to-lift still works (5px threshold spawns float).
- Click-to-open-menu still works.
- Selection grip docks correctly on a drag-selection.
- Scrolling while the grip is visible — grip stays placed correctly.
- Resize while the grip is visible — same.
- Multiple successive paragraph clicks — no flicker, no stale paragraphs being targeted.

---

## Phase 2 — The exhaustive sweep

After Phase 1 lands, search the entire codebase for the same class of bug. Don't restrict to `src/`. Touch `src/`, `editor/`, `library/`, anywhere else with code.

### What "the class of bug" is

The pattern is one or more of:

1. **Listening at window/document scope for editor-scoped work.** The reactor's job is bounded to the editor, but it's paying for every event in the app.
2. **Computing layout for off-screen elements.** No `IntersectionObserver` gate; geometry calls fire for content the user can't see.
3. **O(N) doc walks on every event** when O(1) lookup is possible. Search-by-uuid is the most common.
4. **Re-attaching DOM listeners on dep changes** that don't actually affect the listeners themselves.
5. **Multiple independent subscriptions to the same source event** (e.g. five hooks all subscribing to `selectionUpdate` to compute related things).
6. **Per-pixel mousemove/scroll work without RAF coalescing or element-boundary gating.**
7. **Dead code from completed migrations** — `useEffect`s, refs, fields that exist to support legacy paths that have already been removed.

### Concrete searches to run

Start from these greps. They are not exhaustive — use them as seeds and follow the call graphs.

```bash
# Window/document-scoped listeners (likely scope-too-wide candidates)
grep -rn 'window\.addEventListener\("mousemove"' src/ editor/ library/
grep -rn 'window\.addEventListener\("pointermove"' src/ editor/ library/
grep -rn 'document\.addEventListener\("selectionchange"' src/ editor/ library/
grep -rn 'window\.addEventListener\("scroll"' src/ editor/ library/
grep -rn 'window\.addEventListener\("resize"' src/ editor/ library/

# Geometry calls (each needs viewport-gating audit)
grep -rn 'getBoundingClientRect' src/ editor/ library/
grep -rn 'coordsAtPos' src/ editor/ library/
grep -rn 'posAtCoords' src/ editor/ library/
grep -rn 'elementFromPoint' src/ editor/ library/
grep -rn 'getComputedStyle' src/ editor/ library/

# O(N) doc walks
grep -rn 'doc\.descendants' src/ editor/ library/
grep -rn '\.descendants(' src/ editor/ library/

# Subscription sites — how many things listen to selection vs doc updates
grep -rn 'editor\.on("selectionUpdate"' src/ editor/ library/
grep -rn 'editor\.on("update"' src/ editor/ library/
grep -rn 'editor\.on("transaction"' src/ editor/ library/

# useEffect deps that include editor (potential re-subscription churn)
grep -rn 'useEffect' src/ -A 30 | grep -B 5 'editor\.on'

# IntersectionObserver — count usages. If it's near-zero, viewport-gating is missing.
grep -rn 'IntersectionObserver' src/ editor/ library/
grep -rn 'ResizeObserver' src/ editor/ library/
```

### For each finding

Decide: surgical fix, architectural fix, or no-op (false positive)? Prefer architectural where the same pattern appears 3+ times. Specific architectural pieces that this session may need to build:

- **`useEditorDomEvent(editor, eventName, handler, options?)`** — born in Cut 2, used wherever an editor-scoped DOM event listener is needed. After this exists, `window.addEventListener` in editor code should look anomalous.
- **`useActiveTextObject(editor)`** — Thread A from the findings memo. A single subscription that resolves the active TextObject ref once per `selectionUpdate` and exposes it via `useSyncExternalStore`. Consumers: `TextObjectGrabHandle`, `SelectionActionsMenu`, `ActionsStripButton`, `ActionsMenuPanel`, `useEditorUIState`, and anything else found in the sweep that re-derives this state independently.
- **UUID-pos index plugin** — Cut 5 / Thread B. Once it exists, `doc.descendants` for uuid lookup should be a banned pattern.
- **Near-viewport block registry** — Thread D. One `IntersectionObserver` shared by all layout-coupled reactors. Consumers ask "is block X currently in near-zone?" and get a synchronous answer. Off-screen layout compute disappears across the codebase.

### Specifically: off-screen element compute

The user called this out by name. Find every place that computes geometry for content that might be off-screen, and gate it. Common forms:

- A reactor that walks all blocks/cards/markers and calls `getBoundingClientRect` on each (regardless of whether they're visible).
- A reactor that runs `coordsAtPos` for positions that aren't in the viewport range.
- A reactor that draws SVG / positions floats / measures heights for collections of items without filtering by viewport intersection.

The reactor audit specifically flagged `LinkConnector` (floating variant) as doing bezier math for every connector including off-screen ones. Check whether that's been fixed; if not, fix it here, using the shared near-viewport registry.

### Deliverable from Phase 2

A second findings memo: `docs/perf/reactor-sweep-followup-findings.md`, documenting:

- Every additional offender found, with file:line and category (1–7 above).
- For each, the chosen fix (architectural / surgical / no-op) and the rationale.
- The final set of shared infrastructure introduced by this session and how to use it.
- A "principles" section, possibly extending Section 6 of the audit memo, codifying any new rules the sweep surfaced.

---

## Open questions to resolve before / during coding

1. **Does the Reader's `contenteditable=false` path still exist?** Determines whether Cut 4 deletes the `selectionchange` listener or gates it.
2. **Has the marginalia overhaul landed?** If yes, the UUID-index plugin and near-viewport registry may already exist. If no, this session may need to build them — and should design them with marginalia's needs in mind so that work can drop in cleanly later. **Check the state of `useMarginalia` and any new plugins under `src/lib/tiptap/` before designing.**
3. **Scroll listener — window or scroll-parent?** The current grab-handle code uses `window.addEventListener("scroll", onScroll, true)` with capture, which catches all scroll containers. Replacing with a scoped scroll-parent listener (like `useMarginalia` does via `findRowScroll()`) is probably correct but verify against multi-pane layouts (split editor, library reader, etc.).
4. **`useActiveTextObject` — context or hook?** A hook re-subscribes per consumer (cheaper than today but still N subscriptions). A context with one provider near `Editor.tsx` is one subscription total. The latter is probably right; confirm the consumer set first.
5. **UUID-index plugin — what counts as a "uuid attribute"?** Today the convention is `node.attrs.uuid`. Verify uniformly across all TextObject kinds and document any exceptions before encoding into the plugin.

---

## Style and process

- The file the user sees changes are LaTeX/text in the editor; nothing here changes user-facing behavior. **Don't add user-facing features, don't refactor unrelated code.**
- Update `src/STYLE_GUIDE.md` only if a UI decision in this work seems generalizable (per memory `style_guide.md`); otherwise leave it alone.
- For each commit, prefer **one logical cut per commit** — Cut 1, Cut 2, etc. — over a single mega-commit. The sweep findings can be one or more commits depending on the size of each architectural piece introduced.
- End your final summary with the literal word **"Done."** (per memory `feedback_signal_done.md`).
- Never chain `cd` / `git` with `&&` (per memory `feedback_git_commands.md`); prefer `git -C`.
- Don't commit unless the user explicitly asks (per harness defaults).

Good luck. The compounded win across Phase 1 + Phase 2 should be substantial; the architectural pieces should make the next analogous bug visibly hard to write.
