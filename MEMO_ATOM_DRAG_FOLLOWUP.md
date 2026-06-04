# Atom-drag — follow-up memo (two UI-polish issues)

_Written 2026-06-04, after the atom-drag feature landed (commit `1c0c52b` on branch `atoms-draggable`)._

## Where we are

Inline **Atoms** (footnote, citation, `\ref`, inline math) are now drag-and-droppable to a new inline cursor — the atom is its own handle. The gesture works **functionally and correctly** (verified live: all four kinds move, footnote renumber correct, card follows, no orphan, keystroke-sanctity clean). What remains is **drag visual polish** — two issues, both about how the drag *looks*, not whether it works.

Architecture recap (the surface the two issues touch):
- **`InlineAtomGrab`** ([src/lib/tiptap/inline-atom-grab.ts](src/lib/tiptap/inline-atom-grab.ts)) — a `handleDOMEvents.mousedown` ProseMirror plugin (in `buildEditorExtensions`). On mousedown over an atom it returns `true` (PM skips its own mousedown — kills the NodeSelection scroll-jump) but does **not** `preventDefault`. On movement past an 8px threshold it captures the source and `beginDropSession(...)`, then owns mouseup → `commitDropSession()`.
- **Drop-mode controller** ([src/components/drop-mode/controller.ts](src/components/drop-mode/controller.ts)) — on `beginDropSession` it sets `document.body.setAttribute("data-drop-mode-active","true")` + `body.style.cursor = "crosshair"` (lines ~112-113), cleared in `endDropSession` (~129). The blue inline-cursor placement bar (`.dropmode-bar-inline`) is rendered by [Indicator.tsx](src/components/drop-mode/Indicator.tsx), mounted via [DropModeProvider.tsx](src/components/drop-mode/DropModeProvider.tsx).
- **The block precedent for a dragging ghost**: [src/text-objects/LiftedTextOverlay.tsx](src/text-objects/LiftedTextOverlay.tsx) — a portal-rendered, `position:fixed`, body-level ghost that follows the cursor during a TextObject lift. It's a sanitized `cloneNode(true)` of the source DOM, `pointer-events:none` (so the live cursor under it still drives hit-testing), `.tiptap`-wrapped so content-scoped CSS reaches the clone. It is driven by the React component `TextObjectGrabHandle` via `setOverlay({...})` per frame. CSS: `.lifted-text-overlay*` in [globals.css](src/app/globals.css) (~1325+).

---

## Issue 1 — drag draws a native text selection instead of (just) the blue drop cursor

**Symptom (user):** grabbing a footnote and moving it draws a *text selection* (the browser's blue highlight) rather than cleanly showing the blue inline drop cursor.

**Root cause:** `InlineAtomGrab`'s mousedown returns `true` without `event.preventDefault()`. The atom NodeView is `contenteditable=false`, but it sits inside the `contenteditable=true` editor, so pressing on the atom and dragging across the surrounding text makes the browser start/extend a **native text selection**. The blue drop cursor *does* show (verified `indicatorShown: true`) — it's just competing with the unwanted selection highlight. The block grab handle ([TextObjectGrabHandle](src/text-objects/TextObjectGrabHandle.tsx)) doesn't hit this because its handle is a *separate margin element*; the inline grab starts **on the content**, so it needs its own suppression.

**Recommended fix (layered, low-risk):**
1. **CSS, keyed on the existing attribute** — add to [globals.css](src/app/globals.css):
   ```css
   body[data-drop-mode-active="true"], body[data-drop-mode-active="true"] * { user-select: none; }
   ```
   The controller already stamps `data-drop-mode-active` for the whole session, so this suppresses *new* selection for every drop gesture (harmless for the block/float ones). One rule, no JS.
2. **Clear the selection that already formed pre-threshold** — at the threshold-cross in `InlineAtomGrab` (right after `beginDropSession` succeeds), call `window.getSelection()?.removeAllRanges()`. `user-select:none` prevents *new* selection but doesn't clear an in-progress one (the ~8px before threshold).
3. **(Try, then keep if it works) `event.preventDefault()` in the mousedown** — this stops the selection from ever starting, eliminating even the pre-threshold flash. **MUST verify the no-drag click still opens the Card** (preventDefault on mousedown normally does *not* block the subsequent `click`, but the whole click-vs-drag path depends on it — test it). If the click breaks, drop this step and rely on (1)+(2).

**Verify:** grab each atom kind, drag across text — no blue text-selection highlight appears, only the inline drop bar (+ the ghost from Issue 2). A plain click still opens the Card/popover.

---

## Issue 2 — show a ghost of the atom floating with the cursor (model: the TextObject ghost)

**Want (user):** for all four atoms, a translucent ghost of the atom should float along with the mouse during the drag — modeled after the TextObject lifted-overlay ghost.

**Why it doesn't exist yet:** the inline-grab reuses the drop-mode pipeline, which gives the *placement* indicator (blue bar) but no *dragged-object* visual. The block lift has a ghost because `TextObjectGrabHandle` (a React component) renders `<LiftedTextOverlay>` and drives it per-frame. `InlineAtomGrab` is a **ProseMirror plugin (non-React)**, so it can't `setState` a React overlay directly — it needs a module-level store + a React subscriber (the same shape the drop-mode `Indicator` already uses: module-level `session` ← controller, React `Indicator` subscribes).

**Recommended design (simplified LiftedTextOverlay):**
1. **New module store** `src/components/drop-mode/inline-atom-ghost.ts` (sibling of the drop-mode controller): holds `{ html: string | null, cursorX, cursorY, grabOffsetX, grabOffsetY } | null` + `setGhost / updateGhostCursor / clearGhost` + a `subscribe`/`getSnapshot` for `useSyncExternalStore` (mirror `controller.ts`'s `emitSession`/listeners, or `src/links/_shared/anchored-card-store.ts`).
2. **`InlineAtomGrab` writes the store** ([inline-atom-grab.ts](src/lib/tiptap/inline-atom-grab.ts)):
   - On threshold-cross: clone the atom DOM (`atomEl.cloneNode(true)`), sanitize (strip `contenteditable`, ids, `data-*` state attrs; keep the class — `.footnote-marker`/`.citation-node`/`.label-ref-node`/`.inline-math` carry the look), capture `grabOffset = {cursorX - atomRect.left, cursorY - atomRect.top}`, and `setGhost(...)`.
   - The plugin already has a window `mousemove` listener (`onMove`); post-threshold it currently does nothing — have it call `updateGhostCursor(e.clientX, e.clientY)` so the ghost tracks smoothly (unthrottled; cheap — just coords).
   - On mouseup/cancel/cleanup: `clearGhost()` (alongside `clearInlineAtomSource()`).
3. **New React component** `InlineAtomGhost` (e.g. `src/components/drop-mode/InlineAtomGhost.tsx`) — `useSyncExternalStore` on the ghost store; when present, portal to `document.body` a single `position:fixed` box at `(cursorX - grabOffsetX, cursorY - grabOffsetY)`, `pointer-events:none`, wrapped in a `.tiptap` container (so scoped atom CSS resolves — same reasoning as LiftedTextOverlay's `.tiptap` wrap), `opacity ~0.85`, `dangerouslySetInnerHTML` the sanitized clone. Mount it once next to `<DropModeIndicator>` in [DropModeProvider.tsx](src/components/drop-mode/DropModeProvider.tsx) (or in EditorPane where the Indicator lives).
4. **CSS** — `.inline-atom-ghost` in [globals.css](src/app/globals.css): `position:fixed; z-index` matching the overlay layer (~1200, above the drop bar); `pointer-events:none; opacity:.85`; a subtle shadow so it reads as "lifted". Keep it tiny (sized to the atom, not the source rect — atoms are small).

**Keystroke-sanctity:** the ghost is gesture-only (no per-keystroke / per-transaction work) — the plugin stays pure `handleDOMEvents`. Don't add doc walks.

**Verify:** grab each atom kind; a translucent copy of the atom follows the cursor; releasing/Esc removes it; the blue drop bar still tracks the inline cursor underneath (the ghost's `pointer-events:none` keeps the live cursor driving `posAtCoords`).

---

## Shared verification harness (both issues — preview gotchas that cost time last session)

- Dev doc `virgil-data/doc_devtest` (refresh from `samples/annotation-history`) has all four atoms (8 footnotes, 16 citations, 3 refs, 3 inline-math). Set `localStorage['virgil:force-dev-storage']='1'`.
- **Resize the preview to ~1400×900 first** (`preview_resize {width:1400,height:900}`) — the default iframe is tiny (≈423×495) and the editor content renders *wider* than it, so `elementFromPoint`/hit-test fail for editor coords and the gesture silently no-ops.
- **After restarting a dead dev server on the same port, force a full `location.reload()`** — the iframe otherwise keeps stale in-memory JS (deep lib edits don't HMR cleanly).
- Reach the editor via the `__reactFiber$` DFS off `.ProseMirror`'s parent (see `preview_editor_internals_access` memory). Drive the gesture with synthetic `MouseEvent`s: `mousedown` on the atom el, then window `mousemove`s past 8px to a target ~60px below, then `mouseup`. The live atom DOM uses `data-footnote-id` (NodeView), not `data-link-id`.

---

## NEXT-SESSION PROMPT (ready to paste)

> Continue the atom-drag work on branch `atoms-draggable` (feature already shipped at commit `1c0c52b`). Two **drag-visual polish** issues remain — see `MEMO_ATOM_DRAG_FOLLOWUP.md` for full root-cause + design. Honor the CENTRAL DESIGN PRINCIPLE (deep/unified over surgical). Do BOTH:
>
> **(1) Suppress the native text-selection during an inline-atom drag.** Grabbing+dragging an atom currently draws a browser text-selection highlight competing with the blue drop cursor, because `InlineAtomGrab`'s mousedown returns `true` without `preventDefault` and the grab starts on editable content. Fix with: a CSS `user-select:none` rule keyed on the existing `body[data-drop-mode-active="true"]` (in `globals.css`), plus `window.getSelection()?.removeAllRanges()` at the threshold-cross in `src/lib/tiptap/inline-atom-grab.ts`. Then try adding `event.preventDefault()` to the mousedown to kill the pre-threshold flash — **but verify the no-drag click still opens the Card** and back it out if not.
>
> **(2) Add a ghost of the atom that floats with the cursor**, modeled on the TextObject lifted-overlay ghost (`src/text-objects/LiftedTextOverlay.tsx`) but much simpler (no header, no mode, sized to the small atom). Because `InlineAtomGrab` is a ProseMirror plugin (not React), drive it through a new module-level store (`src/components/drop-mode/inline-atom-ghost.ts`) that the plugin writes (sanitized `cloneNode` of the atom + grab offset on threshold; cursor update on every mousemove; clear on mouseup/cancel) and a new React subscriber `InlineAtomGhost` (portal `position:fixed`, `pointer-events:none`, `.tiptap`-wrapped, `opacity:.85`) mounted next to `<DropModeIndicator>` in `DropModeProvider.tsx`. CSS class `.inline-atom-ghost` in `globals.css`.
>
> Verify live in the Claude Preview for **all four atom kinds** (footnote, citation, `\ref`, inline math): no stray text-selection, a translucent atom ghost tracks the cursor, the blue inline drop bar still tracks underneath, a plain click still opens the Card/popover, and `window.__virgilBusStats()` `emitCount` stays flat on plain typing. **Preview gotchas (don't lose time):** `preview_resize` to 1400×900 first; force a full reload after any dev-server restart; the dev doc must have `localStorage['virgil:force-dev-storage']='1'`. Then run `npx tsc --noEmit` + `npx vitest run` + lint the new files, and commit.
