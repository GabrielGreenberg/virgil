# Grab-Handle Visibility Regression — Session 10 Followup

**Status: RESOLVED (2026-05-26, session 10).** Root cause was NOT in any of the 7 ranked hypotheses below — it was a clipping bug none of them named: `.editor-pane-pod` has `clipPath: 'inset(0 -20px 0 -20px)'` ([EditorPane.tsx:3764](../../src/components/EditorPane.tsx)). Negative right/left values *extend* the clip 20px laterally beyond the pod, which was intended to let the pod's box-shadow bleed sideways without bleeding vertically. Handles render at viewport `contentLeft − gutterInset = contentLeft − 22`, roughly 10–14 px LEFT of the pod's left edge after accounting for the cap structure — that's 0–4 px BEYOND the 20px clip allowance, so handles were silently clipped to invisible. Pre-session-9 handles portaled to `document.body` (outside the pod's DOM subtree) so the pod's clipPath never reached them. Session 9 moved the portal INTO `paper-render` (descendant of the pod), bringing handles into the clipped region.

**Fix:** moved the `[data-grab-handle-portal]` div from inside `.paper-render` to a column-level sibling of the pod inside `[data-editor-col="true"]`. The portal is now OUTSIDE the pod's clipPath subtree, but still:
- scrolls with content (column lives inside `[data-virgil-row-scroll]`);
- clips behind the sticky pod caps (top z:30, bottom z:31) which sit alongside in the column and win in the root stacking context against the handle's z:20;
- clips against the row scroll container's overflow.

Three files changed: [EditorPane.tsx](../../src/components/EditorPane.tsx) (column gets `position: relative`; portal mount moved); [useEditorViewportCache.ts](../../src/hooks/useEditorViewportCache.ts) (cache walks to `[data-editor-col="true"]` instead of `[data-editor-page="true"]`); [TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx) (comments only). Verification: handles render at correct gutter x (left = contentLeft − 22, verified 435 = 457 − 22); handle Y aligns to glyph-probe top with 0px delta for both paragraph and heading; hover out of zone hides handle; typecheck and tests baseline-clean.

**Why the memo's hypothesis ranking missed this:** hypotheses A–G all focused on stacking, coord conversion, or render-path timing. None inspected the pod's CSS for `clipPath`. The Plan agent that validated the fix flagged it specifically when asked to verify clipping behavior — the actual clipPath was sitting two reads of source away (in the pod's inline style block).

The historical investigation plan below is preserved for posterity.

---

## Historical investigation plan (pre-resolution)

The narrative below was the work-in-progress before the actual root cause was found. The clipPath wasn't in the hypothesis list because the visibility-followup memo focused on the portal target / stacking / coord layers and didn't audit the parent's CSS. Keep this as a record of the diagnosis path so future visibility bugs in this area know what to check first.

---

## 1. What changed in session 9 (recap of what we're debugging)

Commit: `f6a9b93` (11 files, +804 / −341). Plan: `/Users/gabriel/.claude/plans/let-s-go-with-your-distributed-truffle.md`.

**Geometry** (issues 1, 3, follow-up #8, mop-up C — all consume one mechanism):
- New `GlyphProbeDecorator` PM extension: [src/lib/tiptap/glyph-probe.ts](../../src/lib/tiptap/glyph-probe.ts). Wraps first text char of every text-bearing TextObject in `<span data-glyph-probe>`.
- NodeViews emit `[data-glyph-anchor]`: `.expex-number` in [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts), `.tex-block-pod` in [src/components/TexBlockNodeView.tsx](../../src/components/TexBlockNodeView.tsx).
- New `measureHandleAnchorTop(anchorDom, chromeAnchor)` in [TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx) — override > probe > wrapper fallback.
- Same `[data-glyph-anchor]` slot consumed by [src/hooks/useMarginaliaRegistry.ts](../../src/hooks/useMarginaliaRegistry.ts) `measureBlock` for atom-block marginalia (mop-up C).

**Hover resolution** (issues 2, 4):
- `UuidAttrDecorator` ([src/lib/tiptap/uuid-attr.ts](../../src/lib/tiptap/uuid-attr.ts)) now emits `data-text-object-kind` alongside `data-uuid`.
- `resolveTextObjectsAtMouse` rewritten to `elementFromPoint → closest("[data-uuid]")` ancestor walk reading kind+id from DOM attrs.
- Band cache deleted (`lastBoundsTop` / `lastBoundsBottom` / `lastHitResult` / `invalidateMouseResolverCache`).

**Render layer** (issue 5, mop-up B):
- New `<div data-grab-handle-portal />` mounted as sibling of `.ProseMirror` inside `.paper-render` in [src/components/EditorPane.tsx](../../src/components/EditorPane.tsx) (the conditional render block right before `</div>` closes `paper-render`, around line 4099–4116). Wrapper styles: `position: absolute; inset: 0; pointer-events: none`.
- `useEditorViewportCache` ([src/hooks/useEditorViewportCache.ts](../../src/hooks/useEditorViewportCache.ts)) extended with `paperEl`, `paperRect`, `toPortalCoords(viewportX, viewportY)` helper.
- Handle CSS: `position: fixed; z-index: 1000` → `position: absolute; z-index: 20`.
- `Math.max(candidateTop, scrollTop)` "sticky to viewport top" clamp dropped.
- Hotfix attempt (in the same commit, after first noticing the regression): `portalRoot` state deleted, replaced with inline `cacheRef.current.paperEl?.querySelector("[data-grab-handle-portal]")` resolution at render time. Goal was to eliminate a render-vs-effect timing race where placements were portal-relative but portal target was still `document.body`.

**Plumbing** (mop-up B): `MOUSE_LEAVE_GRACE_MS`, `mouseOverHandleRef`, `leaveTimerRef`, `scheduleZoneLeave`, `onHandleEnter`/`onHandleLeave`, per-handle `onMouseEnter`/`onMouseLeave` JSX wiring all deleted.

## 2. Symptom + what we know works

**Symptom:** Hover anywhere in the editor — no handle appears in the gutter. User-reported: "completely disappeared." Not a flicker; sustained absence.

**Verified clean:**
- `npm run typecheck`: passes (the pre-existing `card-creation.ts` error is baseline noise).
- `npm test`: 240 passing / 8 baseline failing in `usePersistentState.test.ts` (unrelated).
- 9 new `src/lib/tiptap/__tests__/glyph-probe.test.ts` tests pass — probe positioning algorithm is correct on synthetic docs.
- Code review traced through `computePlacement` math by hand for a representative case and it produces sensible portal-relative coords.

**What we didn't verify (live):**
- Whether the `[data-grab-handle-portal]` div actually appears in DOM at runtime.
- Whether `cacheRef.current.paperEl` resolves to the right element.
- Whether `placements` state gets populated when hovering (vs. staying empty).
- Whether the handle DOM element renders at all (vs. rendering but invisible).

**This is the critical first move next session:** inspect the live DOM. Don't theorize further until we know which layer is broken.

## 3. Live diagnostics — RUN THESE FIRST

Open the dev preview, open DevTools, and walk through:

### 3.1 Is the portal wrapper in DOM?
```js
document.querySelectorAll('[data-grab-handle-portal]')
```
Expected: ≥ 1 element (one per editor pod on the page). If 0, the JSX insertion is wrong — see §4.A. If found, note its parent and `getBoundingClientRect()`.

### 3.2 Is the cache populating paperEl?
TextObjectGrabHandle stores the cache in a ref; we can't read it from outside React. Add a temporary `console.log` to the cacheVersion useEffect — log `cacheRef.current.paperEl`, `cacheRef.current.paperRect`, `cacheRef.current.contentLeft`. Expected: non-null paperEl, sensible rect values, contentLeft > 0. (Remove the log after diagnosis.)

### 3.3 Does the hover resolver return refs?
Add a temporary `console.log` to `resolveTextObjectsAtMouse` logging `clientX`, `clientY`, `hit?.tagName`, `cur?.getAttribute("data-uuid")`. Hover over a paragraph and check. Expected: hit is a text-node-bearing element inside `.ProseMirror`, cur walks up to find the paragraph's `data-uuid` element, return value is non-empty.

If refs come back empty: the `data-uuid` decoration or the `data-text-object-kind` extension isn't applied to the DOM. Verify with `document.querySelectorAll('[data-uuid]')` — should return many elements (one per anchorable). And `document.querySelectorAll('[data-text-object-kind]')` — should return the same count.

### 3.4 Are placements computed?
Log `placements` in the React component (add a `useEffect(() => console.log("placements", placements), [placements])`). Expected: array of length ≥ 1 when hovering, with valid `{left: number, top: number}`. If empty when hovering: §3.3's resolver issue or `computePlacement` returns null (visibility check rejects, anchorDom not found, etc.).

### 3.5 Are handles in DOM at all?
```js
document.querySelectorAll('.text-object-grab-handle')
```
Expected: ≥ 1 element when hovering (matching `placements.length`). If 0: React isn't rendering them (placements stays empty, or createPortal returns null). If ≥ 1 but invisible: inspect the element's computed style and getBoundingClientRect — see §4.B/C.

### 3.6 Is the handle at sensible coords?
For a found handle:
```js
const h = document.querySelector('.text-object-grab-handle');
console.log(h.style.top, h.style.left, h.getBoundingClientRect(), getComputedStyle(h).zIndex);
```
Expected: `top`/`left` are small positive numbers (portal-relative coords inside paper-render's content box, which can be tens of thousands of pixels for a long doc). The `getBoundingClientRect()` should put the handle near a visible paragraph's gutter. If coords are wildly off (e.g., negative, or in the millions), the coord conversion is wrong — §4.C.

## 4. Hypotheses ranked

### A. Portal wrapper not in DOM (or wrong location) — **MOST LIKELY**

The JSX I added in `EditorPane.tsx` (lines 4099–4116):

```jsx
)}
{/* Grab-handle portal root — ... */}
<div
  data-grab-handle-portal
  style={{
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
  }}
/>
```

Bare `data-grab-handle-portal` (no value) in React JSX. I verified this pattern works elsewhere in the codebase ([data-marginalia-host](../../src/components/EditorPane.tsx:3747), [data-editor-pod-cap](../../src/components/EditorPane.tsx:3675) — both used as bare attributes). But it's worth confirming the actual rendered HTML has the attribute. Run §3.1.

If absent: try writing `data-grab-handle-portal=""` explicitly. React sometimes elides bare boolean-ish attrs for non-standard names, even though `data-marginalia-host` works (those might be in different React versions or there's a subtle difference).

### B. Stacking context / z-index — **LIKELY**

`paper-render` is `position: relative` without z-index → NOT a stacking context root. The portal wrapper is `position: absolute` without z-index → NOT a stacking context root. So the handle's `z-index: 20` resolves against whatever DOES create a stacking context further up the chain — likely the row scroll container or the body.

In that root context, OTHER positioned elements with higher z-index visually beat the handle. Candidates inside the editor:
- LoadingScreen: `z-50` (only `!ready`)
- Sticky pod cap (`data-editor-pod-cap`): `z-30` — but only in its sticky strip
- Sticky breadcrumb: `z-20` — equal to handle, last-rendered wins. The breadcrumb is in a different DOM subtree (column-level vs paper-internal), but stacking is per stacking-context, so visual overlap zones could be ambiguous.
- Margin-edit overlay (`data-margin-frame`): `z-25`, sticky inside paper-render — covers the full reading frame when margin-edit mode is active. **Note:** this is conditional (`{marginEditMode && viewPrefs && ...}`); if the user has margin-edit accidentally active, every handle is hidden behind it. Worth checking via `document.querySelector('[data-margin-frame]')`.

Diagnostic: §3.6 reads `getComputedStyle(h).zIndex`. If it's `20` but handle is hidden: try raising to `35` (above pod cap), `50` (above LoadingScreen), `100`. If raising fixes it: identify WHAT was covering it (DevTools "Layers" panel or `document.elementsFromPoint(handleX, handleY)`).

### C. Coord conversion produces unreachable coords — **POSSIBLE**

`toPortalCoords` subtracts `paperEl.getBoundingClientRect().{left,top}` from viewport coords. The portal wrapper has `inset: 0` of `paper-render`, so the wrapper's top-left in viewport coords IS `paperEl.getBoundingClientRect().{left,top}`. Children of the wrapper with `position: absolute; top: N` render at viewport-coord `paperRect.top + N`.

For a normal hover (paragraph at viewport y=400, paper-render at viewport y=100), the math gives:
- `candidateTop = 400` (cap-top of the glyph)
- `toPortalCoords(left, 400)` returns `y = 400 - 100 = 300`
- Handle at `position: absolute; top: 300` inside wrapper
- Wrapper's top in viewport = 100
- Handle visual position = 100 + 300 = 400 ✓

For a paragraph deep in a long scrolled doc:
- paper-render starts at viewport y=-3000 (scrolled way past the top)
- visible paragraph at viewport y=400
- `toPortalCoords(left, 400)` returns `y = 400 - (-3000) = 3400`
- Handle at `top: 3400` inside wrapper
- Wrapper's top = -3000 (in viewport coords)
- Handle visual position = -3000 + 3400 = 400 ✓

Math is right. But if `paperEl.getBoundingClientRect()` returns unexpected values (e.g., the paper-render element somehow has a CSS `transform` that changes its bounding box), coords could be off.

Diagnostic: §3.6 will reveal if `top`/`left` are absurd. Also check `paperEl`'s computed style — any `transform`, `will-change`, `contain`?

**Sub-hypothesis C2:** the wrapper's `inset: 0` produces dimensions different from what I expect. `inset: 0` on a `position: absolute` element should fill the containing block. But `paper-render`'s containing block for absolutes is itself (`position: relative`). Its height = flow children's height. The wrapper, being out of flow, doesn't contribute. So wrapper dims = paper-render's content box = editor height. Should be huge for a normal doc.

If wrapper dims are 0: children with `top: 3400` are positioned 3400px below the wrapper's top-left point (which is a 0×0 point). Children render at viewport-coord wrapper-top + 3400, which is the same as if the wrapper had dimensions. So 0 dims shouldn't matter for positioning. BUT, browsers sometimes treat 0-dim absolute parents weirdly. Diagnostic: `document.querySelector('[data-grab-handle-portal]').getBoundingClientRect()`.

### D. The cache effect never populates `paperEl` — **POSSIBLE but tested-against**

`useEditorViewportCache` runs `refresh()` only when its `editor` parameter changes. The hook is called as `useEditorViewportCache(editorRef.current)`. On initial render, `editorRef.current` is null (parent's `useEffect` at [Editor.tsx:3260](../../src/components/Editor.tsx) hasn't run yet). On the next re-render after the editor mounts, `editorRef.current` is set → hook receives the editor → effect runs → cache populates → setVersion bumps → cacheVersion useEffect re-renders → portal target found.

If TextObjectGrabHandle never re-renders after the editor mounts, the cache stays empty forever. The old code worked despite this same chain, so something must trigger the re-render. Best guess: `useEditor` from Tiptap causes multiple state changes during init, which propagate to TextObjectGrabHandle.

Diagnostic: §3.2 logs `cacheRef.current.paperEl`. If always null: the re-render chain is broken. Possible fixes:
- Pass `editor` as a prop (or via context) instead of via a ref so React re-renders the cache hook when the editor changes.
- Add a manual `useState` poll that re-renders when `editorRef.current` flips from null to non-null.

### E. The new hover resolver returns empty refs — **POSSIBLE**

Diagnostic §3.3. If empty, sub-causes:
- `containsHoverZone` returns false (cache not populated → all zeros).
- `elementFromPoint(probeX, clientY)` returns null (cursor in a region with no hittable element).
- `closest("[data-uuid]")` returns null (no `data-uuid` element above the hit element — could mean `UuidAttrDecorator` isn't applying, see §3.3 last sentence).
- `isTextObjectKind(kind)` returns false (the `data-text-object-kind` attr's value doesn't match the registry's `TextObjectKind` union — maybe Phase 1 set the attr but with the wrong value).

For the last one: `document.querySelector('[data-text-object-kind]')?.getAttribute('data-text-object-kind')` — expected `"paragraph"`, `"heading"`, etc.

### F. NodeView `[data-glyph-anchor]` interferes — **UNLIKELY but check**

The new attributes on `.expex-number` and `.tex-block-pod` shouldn't break anything — they're inert hints. But it's worth verifying they're present: `document.querySelectorAll('[data-glyph-anchor]')` returns ≥ 1 if the dev doc has an exampleBlock or texBlock.

### G. The portal `pointer-events: none` propagation — **NO, but mentioned for completeness**

`pointer-events: none` on the wrapper doesn't affect children's rendering (only hit-testing). Children with `pointer-events: auto` (each handle) are hit-testable. Rendering is unaffected. NOT a candidate.

## 5. Fix candidates per hypothesis

### Fix A.1 — Verify portal div renders, write attr explicitly
```jsx
<div
  data-grab-handle-portal=""  // ← explicit empty string instead of bare
  style={{ ... }}
/>
```

### Fix A.2 — Mount portal one level up
If `paper-render`'s containing-block geometry is the issue, mount the portal at `editor-pane-pod` level (which is also `position: relative` and `data-marginalia-host`). Update `useEditorViewportCache` to resolve `paperEl` as `editor.view.dom.closest('[data-marginalia-host]')` instead.

### Fix B.1 — Raise z-index to 50
```css
.text-object-grab-handle { z-index: 50; }
```
Loses the "pod cap covers scrolled-past handle" property — handles would draw OVER the sticky cap. Use only if §3 confirms a z-index issue and a more nuanced fix isn't viable.

### Fix B.2 — Make paper-render a stacking context
```jsx
<div className="paper-render" data-editor-page="true" style={{ position: "relative", zIndex: 0 }}>
```
Explicit `z-index: 0` on `paper-render` (combined with its existing `position: relative`) creates a stacking context. Then handle's z:20 is scoped to paper-render's context, NOT competing with z:30 pod cap (which is in the OUTER context — at the column level — so pod cap visually beats paper-render entirely when their boxes overlap, which is the desired clip behavior). Inside paper-render, handle's z:20 beats any in-editor positioned content reliably.

This is probably the RIGHT architectural fix — currently the architecture assumes paper-render creates a stacking context but doesn't explicitly do so.

### Fix C.1 — Switch the conversion to a `transform: translate`
Instead of `position: absolute; top: portalY; left: portalX`, use `transform: translate(portalX, portalY)` on a 0-size element. Sometimes browsers handle transform differently for absolute children of 0-dim parents.

### Fix D.1 — Force re-render on editor-ready
Replace `editorRef` with `useState<Editor | null>` in VirgilEditor. Pass the state down. When the editor changes, the state setter triggers a re-render of TextObjectGrabHandle, which then receives the live editor in `useEditorViewportCache`.

OR: in TextObjectGrabHandle, add a local `useEffect` that polls `editorRef.current` and calls a `forceUpdate()` (state setter) when it becomes non-null.

### Fix E.1 — Verify UuidAttrDecorator runs
If `data-uuid` elements don't exist in DOM at all, the decorator isn't applied. Check `editor.extensionManager.extensions` for `UuidAttrDecorator`. It should be in the list (Editor.tsx imports + wires it).

## 6. Suggested order of operations next session

1. **Run all §3 diagnostics in order** — don't theorize past the first failure.
2. **If §3.1 fails (no portal div)**: Fix A.1. Re-test.
3. **If §3.2 fails (paperEl null)**: Fix D.1. Re-test.
4. **If §3.3 fails (no refs)**: Verify `data-uuid` decorations exist; if not, debug `UuidAttrDecorator`.
5. **If §3.4 fails (no placements)**: Check `computePlacement` return value via log — figure out which check rejects.
6. **If §3.5 fails (no handle DOM)**: createPortal returned null — placements empty OR portal target null.
7. **If §3.6 shows wrong coords**: Fix C.1 / debug coord conversion.
8. **If everything in §3 looks normal but handles still invisible**: Fix B.2 (paper-render explicit stacking context). This is the most likely outcome if all the JS-side state is correct.

## 7. Last resort: temporary revert

If two sessions of investigation don't resolve it and visibility regression is blocking other work, the controlled rollback path is:

**Revert ONLY Phase 6 + Phase 7** (the render layer + plumbing simplification). Keep Phases 0–5 + 8 (the geometry + hover resolver + marginalia changes — those solve issues 1, 2, 3, 4, and the followup #6/#7/#8, AND there's no evidence they're broken).

Concretely:
- Restore `.text-object-grab-handle { position: fixed; z-index: 1000; }` in [globals.css](../../src/app/globals.css).
- Restore `createPortal(..., document.body)` in [TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx) (drop the `livePortalRoot` lookup; just use `document.body`).
- In `computePlacement`: drop the `const portal = cache.toPortalCoords(...)` conversion; return `{ left, top: candidateTop, ref }` with the `Math.max(candidateTop, scrollTop)` clamp restored.
- In `GrabHandleRender` JSX: `position: fixed` instead of `absolute`.
- Restore the leave-grace machinery: `MOUSE_LEAVE_GRACE_MS`, `mouseOverHandleRef`, `leaveTimerRef`, `scheduleZoneLeave`, `onHandleEnter`/`onHandleLeave`. (Or — better — DROP these even on revert, since the new elementFromPoint-based resolver doesn't depend on them; the only reason they were needed in the old architecture was the portal-to-body decoupling. Verify by manually testing handle-hover persistence.)
- Remove the `<div data-grab-handle-portal />` from [EditorPane.tsx](../../src/components/EditorPane.tsx).
- KEEP: `useEditorViewportCache`'s `paperEl`/`paperRect`/`toPortalCoords` additions (harmless, may be useful later when re-attempting).

After the revert, issue 5 (handles overlay topbar/chrome on scroll) is back. Note in the visibility memo that issue 5 needs a different approach (e.g., clip-path on the handle's CSS to respect the pod's visible bounds — a non-portal-based clipping strategy).

## 8. Reference index

**Session-9 commit:** `f6a9b93` "Grab-handle mop-up: geometry probe + DOM-truth resolver + scroll-clipped portal"

**Plan:** `/Users/gabriel/.claude/plans/let-s-go-with-your-distributed-truffle.md` (includes the hotfix-attempt diagnosis at the top, before the original 9-phase plan).

**Refactor memo update:** [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md) §"Session 9" — full enumeration of phase landings.

**Touched files:**
- [src/text-objects/TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx) — phases 4, 5, 6, 7 + hotfix. The component under investigation.
- [src/lib/tiptap/uuid-attr.ts](../../src/lib/tiptap/uuid-attr.ts) — phase 1: added `data-text-object-kind`.
- [src/lib/tiptap/glyph-probe.ts](../../src/lib/tiptap/glyph-probe.ts) — phase 2: NEW probe decorator.
- [src/lib/tiptap/__tests__/glyph-probe.test.ts](../../src/lib/tiptap/__tests__/glyph-probe.test.ts) — 9 unit tests, all pass.
- [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts) — phase 0 (drop `.par-left-margin-zone`), phase 3 (emit `data-glyph-anchor` on `.expex-number`).
- [src/components/Editor.tsx](../../src/components/Editor.tsx) — phase 0 (drop par-left-margin-zone), phase 2 wiring (add `GlyphProbeDecorator` to extensions).
- [src/components/TexBlockNodeView.tsx](../../src/components/TexBlockNodeView.tsx) — phase 3 (`data-glyph-anchor` on `.tex-block-pod`).
- [src/components/EditorPane.tsx](../../src/components/EditorPane.tsx) — phase 6 (mount `[data-grab-handle-portal]` inside `paper-render` around line 4099).
- [src/hooks/useEditorViewportCache.ts](../../src/hooks/useEditorViewportCache.ts) — phase 6 (add `paperEl`, `paperRect`, `toPortalCoords`).
- [src/hooks/useMarginaliaRegistry.ts](../../src/hooks/useMarginaliaRegistry.ts) — phase 8 (`measureBlock` consults `[data-glyph-anchor]`).
- [src/app/globals.css](../../src/app/globals.css) — phase 0 (drop `.par-left-margin-zone` rule), phase 6 (`.text-object-grab-handle` `position: fixed` → `absolute`, `z-index: 1000` → `20`).

**Existing comparable patterns (DON'T re-invent — model on these):**
- [src/components/Marginalia.tsx:222–231](../../src/components/Marginalia.tsx) — `elementFromPoint → closest("[data-uuid]")` hit-test (this is the model for the new hover resolver — verify it actually still works in the live preview to rule out a system-wide regression).
- [src/lib/marginalia-blocks.ts:45–57](../../src/lib/marginalia-blocks.ts) `resolveDomForUuid` — `[data-uuid]` query precedent.
- The existing `EditorScrollbar` component portal pattern (mentioned in session-9 exploration) — another example of in-scroll-container rendering.

**Scroll-container DOM chain** (from session-9 exploration):
```
[data-virgil-row-scroll]           ← the scroll element (overflow: auto)
  → EditorPane root
    → editor-pane-root              (display: flex row)
      → data-editor-col             (editor-pane-column, display: flex col)
        → editor-pane-pod           (data-marginalia-host, position: relative)
          → Marginalia              (sibling of paper-render)
          → paper-render            (data-editor-page="true", position: relative)
            → margin overlay        (conditional, z-25 sticky)
            → VirgilEditor outer    (flex flex-col flex-1 min-w-0)
              → EditorContent       (renders .ProseMirror)
              → TextObjectGrabHandle  (renders nothing in this position — portals)
              → SelectionActionsMenu / SlashCommandPopup (portal-rendered)
            → PrintAppendices      (conditional, display:none in non-print)
            → <div data-grab-handle-portal />  ← NEW in session 9
```

The sticky chrome (`data-editor-pod-cap` at z-30, breadcrumb at z-20) is INSIDE `editor-pane-column`, OUTSIDE `editor-pane-pod`.

## 9. What to NOT do

- **Don't revert blindly.** The architecture is sound and earns its keep on issues 1–4. Diagnose first.
- **Don't add yet more state to TextObjectGrabHandle.** The hotfix already removed `portalRoot` state to avoid timing races. Adding state back is the wrong direction.
- **Don't try multiple fixes at once.** Each fix candidate is testable in isolation; combining them muddles the diagnosis.
- **Don't optimize the `elementFromPoint` resolver yet.** If it's slow, deal with it AFTER visibility. (It isn't slow — that's why the band cache was deletable.)

## 10. Success criteria

The visibility regression is RESOLVED when:
1. Hover any paragraph → grab handle appears in the gutter at the paragraph's cap-top.
2. Hover any heading → handle aligns to the cap-top, NOT above the line.
3. Hover exampleBlock → outer handle aligned with `(1)` row; sub-handles aligned with `a./b./c.` rows. Move between items → sub-handle re-anchors.
4. Hover tex block → handle appears (anywhere in the pod). Anchors to pod top for both titled and untitled.
5. Hover lists → outer + sub-handle, sub-handle moves between items.
6. Scroll past a paragraph → handle scrolls behind the sticky pod cap (NOT over it).
7. Scrolled off-screen → handle no longer visible.

At that point: update this memo to "RESOLVED", note which fix worked, and close out follow-up #0 in [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md).
