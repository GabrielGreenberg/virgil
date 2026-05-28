# Lifted-Overlay Refactor — Working Memo

Working memo for the four-session refactor that evolves Virgil's
TextObject lift gesture from "instant popout on threshold cross" to a
Notion-style two-mode drag (in-editor ghost overlay, in-gutter popout,
same dimensions throughout).

The architectural priors sit in [TEXT-OBJECT-REFACTOR.md](TEXT-OBJECT-REFACTOR.md):
that refactor unified Virgil's 16 graspable text kinds through one
registry, one grab handle, one float chrome, and one drop spec. This
arc evolves the lift gesture itself, building on that foundation.

The multi-session meta-plan lives at
`/Users/gabriel/.claude/plans/1-fine-2-ok-silly-hinton.md` — read it for
the full context, the 9 architectural decisions baked in, and the
per-session spec.

---

## Progress

| # | Stage | Commit | Spirit |
|---|---|---|---|
| 1 | L1 — lifted-overlay primitive + paragraph wiring | c446e3b | New `LiftedTextOverlay` primitive renders a portal-rendered ghost of the source block that follows the cursor at source-rect dimensions during a lift gesture; chrome flips between `ghost` (cursor in editor content) and `popout` (cursor in gutter/beyond) via CSS as the cursor crosses the content rect. Wired only for `paragraph` via the new `meta.liftMode: "lifted-overlay"` registry slot — the 15 other kinds default to the legacy `instant-popout` path. Source rect captured ONCE at threshold cross (against `anchorDom.getBoundingClientRect()`, not the handle); cursor offset preserved so the visual stays "stuck" to the user's grab point. Release in popout mode spawns the real popout at the overlay's current rect with source-derived dimensions. Release in ghost mode falls through to the L1→L2 bridge: the legacy `popOutAtRect(cardKey, legacySpawn)` call with the old cursor-centered `floatSizeFor(kind)` rect. The bridge is the defining staging artifact of this commit — a single conditional in `onUp` plus the legacy spawn computation, gated by `finalMode === "ghost"`. L2 deletes the bridge and routes ghost-mode release into the drop-mode placement engine. New `containsContentZone(x, y)` cache helper sits next to `containsHoverZone` and gates the chrome flip — the hover zone includes the gutter (correct for handle visibility), the content zone does not (correct for ghost-vs-popout). Document-leave forces popout mode (same defensive pattern the drop-mode controller uses). cardLiftHandoff/cardLiftTarget signals NOT emitted on the new path — the popout (if it spawns) lands at the overlay's terminal rect, so there's no in-flight handoff animation to perform; the legacy 15 kinds keep them. |
| 2 | L1.5 — chrome + font polish | c4475ca | Chrome + font polish addressing four feel-check items from L1's dev-preview verification: (A) computed-typography inheritance on the overlay — cloneNode preserves DOM but loses CSS-inherited rules once the portal mounts outside `.ProseMirror`'s ancestor chain, so the overlay captures `getComputedStyle(anchorDom)` at threshold-cross and applies font/color/spacing properties as inline styles on the overlay root, restoring font + width parity with the source; (B) base-as-ghost CSS — the L1 base rule defaulted to `opacity: 1` and ghost was a layered override, so mount briefly showed opacity 1 before transitioning to 0.6 (a visible fade-in); L1.5 makes base = ghost (opacity 0.6, transparent, no border, no shadow) so mount renders correct immediately, and `[data-lift-mode="popout"]` is the deviation; (C) transparent-text ghost — replaced the dashed border + surface-muted background with no chrome at all (semi-opaque text only), per spec; the popout flip from "nothing" to "white bg + border + shadow" is now visually unmissable, which incidentally resolves item D (the user's "popout doesn't happen on the fly" was a perception artifact of low contrast, not a logic bug — the on-the-fly flip in `TextObjectGrabHandle` was already correct); bonus removed double padding on the clone body (the clone carries its own `.ProseMirror p` padding). Two files touched (`LiftedTextOverlay.tsx`, `globals.css`); no logic changes anywhere. |
| 3 | L1.6 — strip linkedAnchor state attributes | e95e3d1 | Clone-sanitization extension: strip linkedAnchor state attributes (data-link-highlight, data-tint-color, data-card-hovered, data-card-selected, data-paragraph-kind) recursively from the clone during the useMemo setup. Resolves "outline + opaque text" appearance reported in L1.5 dev-preview (the clone's link-highlight chrome was painting over the overlay's transparent ghost base, also making the ghost↔popout chrome flip invisible mid-gesture). No CSS, no architectural changes; ~10 LOC in LiftedTextOverlay.tsx. |
| 4 | L1.7 — boundary at editor pod + full popout chrome | 3d66ba6 | Two unrelated polish items in one commit. (A) `containsContentZone` predicate switches from `.ProseMirror`'s text content rect (`contentLeft`/`editorRight`, inside the editor's white padding) to `.editor-pane-pod`'s outer rect. Cache resolves the pod via `editorEl.closest(".editor-pane-pod")` and exposes four new fields (`podLeft/podRight/podTop/podBottom`) included in the prev↔current comparison; the predicate name is preserved for diff minimisation but its JSDoc is rewritten to reflect pod-rect semantics. Falls back to `rect.left`/`rect.right`/`scrollTop`/`scrollBottom` if the pod walk fails (defensive — early mount, unexpected DOM). Matches the user's mental model: ghost while the cursor is anywhere in the white pod (incl. the padding around text); popout the instant the cursor crosses into the manila column. (B) `LiftedTextOverlay` gains a header row in popout mode — label (`TEXT_OBJECT_REGISTRY[ref.kind].label`) + chevron SVG + X SVG, visually mirroring `TextObjectFloat.tsx:93-125`. Header positioned `absolute; bottom: 100%` above the body so the body's grip-point doesn't shift when the chrome engages; `display: none` + `opacity: 0` in ghost, `display: flex` + `opacity: 1` (120ms ease) in popout. Body's top corners go square in popout mode; header's top corners carry the radius. Icons are visual-only (overlay has `pointer-events: none`; no shared component extracted yet — opportunity for future L4 cleanup). Files: `src/hooks/useEditorViewportCache.ts`, `src/text-objects/LiftedTextOverlay.tsx`, `src/app/globals.css`. |
| 5 | L1.8 | 95989a8 | One-line CSS fix: moved `overflow: hidden` from `.lifted-text-overlay` (root) to `.lifted-text-overlay__body`. L1.7's absolutely-positioned header (bottom: 100%, sits above the overlay) was being clipped by the root's overflow rule, leaving the popout chrome silently invisible mid-gesture even though the DOM and JS state were correct. Body retains the clip for clone-overflow safety. |
| 6 | L1.9 — sibling-portal header (diagnosed: stale bundler + fragile architecture) | TBD | Diagnostic + structural fix. ROOT CAUSE: L1.8's source-side overflow move WAS correct, but Turbopack's incremental CSS bundler retained the stale `.lifted-text-overlay { overflow: hidden }` declaration in `.next-preview/dev/static/chunks/` — bundle timestamp 29 minutes BEFORE the source edit, never re-bundled despite HMR. The dev preview kept clipping the L1.7 `bottom: 100%` header silently, hiding the L1.8 fix from the user's view; the user's repeated "nothing fixes it" feedback was an artifact of stale-bundle invisibility, not a real architectural failure. Confirmed by `stat` (source 22:27, bundle 21:58) + inspecting the bundled CSSStyleSheet rules via `preview_eval`. STRUCTURAL FIX: render the popout header as a portal SIBLING of the overlay (both inside `[data-lifted-overlay-portal]`) instead of an absolutely-positioned descendant. JS owns header geometry inline (`left: overlayLeft - 1`, `top: overlayTop - HEADER_HEIGHT`, `width: sourceWidth + 2`, `height: 24`). The overlay's box no longer constrains the header at all — any future `overflow: hidden` on the overlay root (rule conflict, stale bundle, devtools edit) cannot re-clip the header. CSS selector chain changes from descendant (`.lifted-text-overlay[data-lift-mode="popout"] .lifted-text-overlay__header`) to attribute-on-self (`.lifted-text-overlay__header[data-lift-mode="popout"]`); the header carries its own `data-lift-mode` driven by the same prop. Removes the overflow-visible-on-root invariant from the design. Files: `src/text-objects/LiftedTextOverlay.tsx`, `src/app/globals.css`. |
| 7 | L1.10 | <commit-hash> | Body-padding parity: add `padding: 16px 32px` to `.lifted-text-overlay__body` matching paragraph-body's `px-8 py-4`. The clone text now reflows the same width as the released popout's body so the visual handoff at release is seamless. L3 generalizes per-kind padding via registry. |

---

## Current state cheat-sheet (read before L2)

**Where the primitive lives:**
- New file [src/text-objects/LiftedTextOverlay.tsx](src/text-objects/LiftedTextOverlay.tsx) — portal-rendered overlay. Props: `{ ref, anchorDom, grabOffsetX, grabOffsetY, sourceWidth, sourceHeight, cursorX, cursorY, mode, cache }`. The component is "dumb" — parent owns cursor + mode, the overlay just renders. cloneNode-sanitization happens once in `useMemo` (strips `contenteditable` recursively, removes ids to avoid live-source collision, sets `pointer-events: none`). **L1.5:** a sibling `useMemo` captures `getComputedStyle(anchorDom)` at mount and applies font-family/size/weight/style/variant/line-height/letter-spacing/color/text-align/text-indent/text-transform/font-feature-settings as inline styles on the overlay root — the portal sits outside `.ProseMirror`'s ancestor chain, so CSS inheritance through the DOM doesn't carry the editor's typography to the clone. **L1.7:** the JSX renders a `__header` element (label from `TEXT_OBJECT_REGISTRY[ref.kind].label` + inline chevron + X SVGs) above the `__body`; CSS hides it in ghost mode and fades it in (120ms) in popout mode via `position: absolute; bottom: 100%` so the body's grip-point doesn't shift on mode flip. Icons are visual-only mimics of `TextObjectFloat.tsx:93-125` (no shared header component yet).
- Portal mount in [src/components/EditorPane.tsx](src/components/EditorPane.tsx) — `[data-lifted-overlay-portal]` div, column-level sibling of `[data-grab-handle-portal]` (both inside `[data-editor-col="true"]` — escapes the pod's clipPath that would otherwise swallow descendants beyond ±20px lateral).
- Chrome CSS in [src/app/globals.css](src/app/globals.css) — **L1.5 layout:** base `.lifted-text-overlay` = ghost (opacity 0.6, transparent background, no border, no shadow — semi-opaque text only), so mount renders the correct state with no fade-in artifact. `[data-lift-mode="popout"]` is the deviation (opacity 1, surface background, pod border, ambient shadow — matches TextObjectFloat's chrome). No explicit `[data-lift-mode="ghost"]` rule. Transitions on opacity/border-color/box-shadow/background-color ONLY — NOT on `top`/`left`/`width`/`height` (those must be instant for cursor tracking).

**Where the dispatch sits:**
- [src/text-objects/TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) `beginGesture` — at threshold cross, reads `meta.liftMode` for the resolved ref. `"lifted-overlay"` → capture source rect + grab-offset, mount overlay, mousemove drives cursor + mode, mouseup commits per mode. `"instant-popout"` (default for everything except paragraph) → existing path, unchanged.
- Cache extension at [src/hooks/useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts) — `containsContentZone(x, y)` sibling of `containsHoverZone`, plus the parallel field in the `EditorViewportCache` type and `EMPTY_CACHE`. **L1.7:** predicate now reads `.editor-pane-pod`'s outer rect (resolved via `editorEl.closest(".editor-pane-pod")` in `refresh()` and exposed as `podLeft/podRight/podTop/podBottom` cache fields) instead of the `.ProseMirror` text content rect. Falls back to the editor's own `rect.left`/`rect.right`/`scrollTop`/`scrollBottom` if the pod walk fails.

**The L1→L2 bridge (the line L2 deletes):**
- Inside `TextObjectGrabHandle.beginGesture`'s `onUp`, when `finalMode === "ghost"` and the lifted-overlay path was taken: calls `poppedRef.current?.popOutAtRect(cardKey, legacySpawn)` with the cursor-centered `floatSizeFor(ref.kind)` rect. Comment marker: `// L2: replace with drop-commit via beginDropSession({ ..., inPlace: true })`. Without this, ghost-mode release would silently drop and the user would have no in-editor commit between L1 landing and L2 landing.

**What L2 replaces / extends:**
- Delete the L1 bridge in `beginGesture.onUp`.
- Extend `beginDropSession({ cardKey, origin, inPlace? })` in [src/components/drop-mode/controller.ts](src/components/drop-mode/controller.ts) with the `inPlace` flag (skips `markSourceFloat` + the source-dimming `data-drop-mode-source` attribute since the source isn't popped during ghost mode).
- At threshold cross for `liftMode === "lifted-overlay"`, immediately call `beginDropSession({ ..., inPlace: true })` alongside mounting the overlay. The drop session's hit-test + Indicator run alongside the overlay (overlay handles chrome + visual; drop-mode handles placement indication + commit).
- On release: popout-mode cancels the drop session AND spawns at the overlay's rect; ghost-mode lets the drop session resolve (it'll call `spec.applyDrop` per the placement, which moves the source).

**What stays untouched in L1:**
- Drop-mode integration (L2).
- The 15 non-paragraph kinds (L3 flips them; the registry slot is a string enum so the per-kind list of opt-ins is visible on the registry table).
- `initialFloatSize` constants (L4 retires them once the source rect drives every popout's initial dimensions).
- `cardLiftHandoff` / `cardLiftTarget` on the legacy path (the 15 instant-popout kinds keep their lift animation).

**Known L3 caveat:** `texBlock`'s CodeMirror won't cloneNode usefully — the editor's view-side rendering isn't carried by `cloneNode(true)`. L3 will need to choose between a placeholder version, a screenshot, or accepting a degraded visual for that one kind. Not L1's problem.

---

## Open feel-check items (for the L1↔L2 dialogue)

After L1 lands and before L2 starts, the user and the manager session
dialogue about the visual feel in dev preview. Candidate items:

- Ghost chrome — dashed border weight + color, opacity level, background tone. Currently `1px dashed var(--border-light)` + 60% opacity + `var(--surface-muted)`. Easy to push lighter / heavier.
- Transition timing between modes — currently 120ms ease on opacity/border/background/box-shadow. May want shorter for snappier feel or longer for smoother.
- Cursor-offset feel — does the source visual feel "stuck" to the cursor at the grab point? L1 captures the offset from the source's top-left at threshold cross; if it feels off, the alternative is capturing from the handle's top-left (and offsetting the source visual accordingly).
- Boundary-detection sensitivity — `containsContentZone` is currently `[contentLeft, editorRight] × [scrollTop, scrollBottom]`. Should the user be able to brush the edge without flipping modes? (Tighten by inset? Add hysteresis?)
- Drag-start threshold — 5px today; might want a tweak for the new gesture's feel.

Adjustments fold into L2's commit or a tiny L1.5 polish commit, manager's call.

---

## Reference

- Multi-session meta-plan: `/Users/gabriel/.claude/plans/1-fine-2-ok-silly-hinton.md`
- Architectural priors: [TEXT-OBJECT-REFACTOR.md](TEXT-OBJECT-REFACTOR.md)
- Codebase orientation: [AGENTS.md](AGENTS.md)
