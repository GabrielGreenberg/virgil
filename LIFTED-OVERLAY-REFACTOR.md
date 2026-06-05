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
| 8 | L1.11 | <commit-hash> | Body padding moves from unconditional to popout-only. Ghost mode now has no body padding, so the clone fills the body edge-to-edge and the text wraps and sizes exactly as the source did (no narrower reflow, no last-line clipping). Popout mode retains the `padding: 16px 32px` that matches the real popout body for seamless release handoff. One CSS rule shift in globals.css. |
| 9 | L1.12 | 4065f9d | Text stillness through gesture lifecycle + correct font source. (1) Computed-style capture now uses `resolveInlineContextElement(anchorDom)` (existing helper) instead of the wrapper, fixing a font size/spacing mismatch where the wrapper's font properties didn't match the inner text element's (paragraph wrapper reads 16px/24px line-height; inner `<p>` reads 15.2px/24.32px). (2) Overlay outer position and size are now mode-dependent: ghost = `(textX, textY, sourceWidth, sourceHeight)`; popout overlay = `(textX − 32, textY − 16, sourceWidth + 64, sourceHeight + 32)` with sibling header above at `headerTop = overlayTop − 24`. Text content sits at `(textX, textY, sourceWidth, sourceHeight)` in BOTH modes — chrome grows outward, text never moves. (3) popOutAtRect spawn coords bumped to `(textX − 32, textY − 40, sourceWidth + 64, sourceHeight + 56)` so the real popout's body content lands at the same `(textX, textY)` as the overlay's text was. Three constants (POPOUT_HEADER_HEIGHT=24, POPOUT_BODY_PADDING_X=32, POPOUT_BODY_PADDING_Y=16) encode the popout's chrome geometry; mirrored in CSS body padding rule. Geometry edge case: the popout outer's 1px border (box-sizing border-box) eats ~1px from each side of the body's content area, so the clone in popout mode renders at `(textX+1, textY+1, sourceWidth−2, sourceHeight−2)` vs the spec's pure `(textX, textY, sourceWidth, sourceHeight)` — sub-pixel feel-noise relative to the 32/16 chrome shift it replaces. Spec's math implicitly tolerates this; the header's existing `−1 / +2` border-overlap pattern is the precedent. |
| 10 | L2 — in-editor drop commit via drop-mode | 98bed27 | In-editor drop commit. `beginDropSession` opts gain `inPlace?: boolean` (skip `markSourceFloat` — no popout to dim) and `externalCommit?: boolean` (skip the controller's own mouseup so the caller drives commit). New exported `commitDropSession()` async function extracted from the old `handleUp`'s body; the default mouseup listener (installed only when `externalCommit !== true`) now delegates to it, and external callers invoke it directly. `installListeners` accepts `{ attachMouseUp: boolean }` so it can conditionally skip the controller's own mouseup. `DropSession.inPlace` is stored on the session so `endDropSession`'s `markSourceFloat` cleanup respects whichever mode was active. `TextObjectGrabHandle.tsx`: at threshold cross in the `liftMode === "lifted-overlay"` branch, after mounting the overlay, calls `beginDropSession({ cardKey, origin, inPlace: true, externalCommit: true })`. The session's mousemove → hit-test → placement update + Indicator render run alongside the overlay; in popout mode the hit-test resolves to null and the Indicator hides automatically. In `onUp` (now `async`), the popout-mode branch calls `cancelDropSession()` BEFORE the existing chrome-inclusive `popOutAtRect` spawn (so the session's listeners and the Indicator tear down cleanly); the ghost-mode branch `await commitDropSession()` (move via the textobject drop spec — heading sections handled by `collectMoveSource`, self-drop classified `"no-op"`, `postDrop: "close"` closes any popout). The L1→L2 bridge (`floatSizeFor(ref.kind)` legacy ghost spawn, `legacySpawn` object, "L2: replace with drop-commit..." comment) is deleted. `cleanup` calls `cancelDropSession()` defensively (idempotent — covers Escape-mid-gesture, short-circuit returns, and any abort path). Paragraph drags now MOVE in-editor on ghost release, spawn the popout on out-of-pod release, cancel silently on self-drop or Escape. Other 15 kinds still on `instant-popout` via `liftMode` default. Indicator (z:9999, body-portal) composes correctly above the overlay (z:25) without changes. |
| 11 | L3a — heading kind onto lifted-overlay | 91c1537 | Heading drags now run through the same two-mode gesture as paragraph (ghost in pod, popout in manila, release-in-pod moves the WHOLE SECTION via the existing `collectMoveSource`, release-in-manila spawns the popout at the overlay's chrome-inclusive rect). `meta.liftMode = "lifted-overlay"` on the heading entry. New `meta.computeLabel?(editor, ref): string \| null` registry slot — heading defines it, walking the doc to find the heading node by uuid and returning `headingTypeName(node.attrs.level)` ("Chapter" / "Section" / "Subsection" / "Subsubsection" / …) — the same string `heading-body.tsx` pushes via `setHeaderLabel`, so the overlay's popout-mode header matches the real popout's chrome at handoff with no visible jump. `TextObjectGrabHandle.tsx` resolves the label at threshold cross via `meta.computeLabel?.(editor, ref) ?? meta.label`, pins it on the new `OverlayState.label`, and passes it as a new `label` prop to `LiftedTextOverlay`. `LiftedTextOverlay.tsx` reads `props.label` in the header JSX instead of `TEXT_OBJECT_REGISTRY[ref.kind].label`; the `TEXT_OBJECT_REGISTRY` import drops out of the overlay (label resolution moved to the parent). `TextObjectMeta.computeLabel` is signed `(editor: Editor, ref: TextObjectRef) => string \| null` — `Editor` imported as a type from `@tiptap/core` to keep `types.ts` React-free per its top-of-file invariant. Body-padding finding: `heading-body.tsx` uses the same `flex-1 overflow-auto px-8 py-4` as `paragraph-body.tsx`, so the L1.12 constants (POPOUT_HEADER_HEIGHT=24, POPOUT_BODY_PADDING_X=32, POPOUT_BODY_PADDING_Y=16) stay hardcoded — no `popoutChrome` registry slot introduced. L4 may centralize chrome geometry once a future kind diverges. Heading-specific gotcha for subsequent L3 commits: lists likely need the same `computeLabel` pattern (`list-body.tsx` likely pushes "Bullet list" / "Numbered list" via `setHeaderLabel`); examples and texBlock may not. The `computeLabel` shape (Editor + TextObjectRef) is the right generalization — any kind whose label varies by `node.attrs.*` reads off `editor.state.doc` via the ref's uuid. |
| 12 | L3b — bulletList kind onto lifted-overlay | b1ed4c8 | bulletList drags now run the same two-mode gesture as paragraph/heading. `meta.liftMode = "lifted-overlay"` on the bulletList entry + `computeLabel: () => "Bullet list"` — a CONSTANT (unlike heading's level-dependent label), matching the exact string `list-body.tsx` pushes via `setHeaderLabel("Bullet list")` on its bulletList branch. (bulletList's `meta.label` is already "Bullet list", so the `?? meta.label` fallback would resolve the same; `computeLabel` pins the overlay header to list-body's string regardless of any future `meta.label` change, mirroring the L3a pattern.) Body-padding finding: `list-body.tsx`'s body uses `flex-1 overflow-auto px-8 py-4` — same as paragraph-body/heading-body — so the L1.12 popout-chrome constants (POPOUT_HEADER_HEIGHT=24, POPOUT_BODY_PADDING_X=32, POPOUT_BODY_PADDING_Y=16) stay hardcoded; no `popoutChrome` registry slot. orderedList stays on instant-popout pending L3c (untouched — only paragraph/heading/bulletList carry `liftMode`). Dev-preview verified: ghost overlay clones the list at source font (Lora 16px) and width, popout-mode header reads exactly "Bullet list", release-in-manila spawns the real popout (header "Bullet list" + `<ul>` content + chrome-inclusive dims matching the overlay, ~444px ≈ sourceWidth+64 less 1px border — text-still-chrome-grows invariant holds). Move-on-ghost-release engages correctly (drop session active, between-blocks Indicator renders at z:9999, `classifyDrop` → apply); the final commit doesn't relocate IN THE DEV PREVIEW ONLY because the collab pen `filterTransaction` gates ALL doc mutations there (a trivial `insertText` is likewise rejected) — not L3b-specific, affects every kind equally. KNOWN FOLLOW-UP (overlay-side polish, deferred per L3b non-goals — overlay component left untouched): the ghost clone's `<ul>` computes `list-style: none` (no disc markers) because the overlay portal mounts outside `.ProseMirror`/`.prose`, where a global `ul { list-style: none }` reset wins; `list-style-type` is inheritable but the reset sets it explicitly on `ul`, so L1.5's root-typography-capture approach can't carry it — a fix must copy the source's computed `list-style` onto the clone's `ul`/`li` inside `LiftedTextOverlay`'s clone `useMemo`. The real popout renders disc correctly (verified `list-style-type: disc`); only the transient in-flight ghost lacks markers. L3c (orderedList → "Ordered list") will hit the same marker gap PLUS ordered-counter rendering, so the overlay-side list-style fix is best landed alongside or just before L3c. |
| 13 | L3b.1 | 884112b | Re-establish `.tiptap` content scope around the ghost clone. Root cause of the L3b list-marker follow-up: the clone mounts in the portal outside `.tiptap`, so Tailwind preflight's `ul { list-style: none }` reset (specificity 0,0,1; `node_modules/tailwindcss/preflight.css`) won over `.tiptap ul { list-style-type: disc }` (globals.css 1560, specificity 0,1,1) — the scoped rule only beats the reset when the `<ul>` is actually inside `.tiptap`. L1.5's root-typography capture only carries INHERITED props; `list-style` is a descendant-selector property set ON the `<ul>`, so it was lost. Fix adds the `tiptap` class to the clone's body wrapper (`.lifted-text-overlay__body`) so all content-scoped rules apply (markers, nested-list spacing `.tiptap li > ul`, list padding `.tiptap ul`, + future kinds' blockquote borders / code backgrounds). **No `.tiptap`-root chrome neutralized:** the bare `.tiptap {}` rule (globals.css 561) carries only `outline: none` (benign for the overlay), `font-family`/`color` (resolve to the same values L1.5 captures), and `tab-size` — no padding / min-height / caret-color / white-space — so the body className suffices; no dedicated inner wrapper, no neutralization overrides. The editor sizing vars (`--editor-font-size: 0.95rem`, line-height, block-gap) live on `:root` (globals.css 7–271), so `.tiptap p`/`.tiptap h2` font-size resolves IDENTICALLY in the portal — verified live: paragraph clone 15.2px/24.32px/Lora/400, heading clone 21.6px/32.4px/Lora/600/mt 4.32px, both bit-identical to source (no font/spacing regression). L1.11's mode-conditional body padding (`.lifted-text-overlay[data-lift-mode="popout"] .lifted-text-overlay__body`, specificity 0,3,0) still wins over `.tiptap` (0,1,0) — verified body padding 16px/32px in popout. General fix, not list-specific; nested sublists get markers for free (verified: both top-level AND nested `<ul>` resolve `list-style-type: disc`, padding-left 24px). L1.5's inline typography capture retained (now likely redundant under the scope wrap — L4 to evaluate). Unblocks L3c's ordered-counter rendering (`.tiptap ol { list-style-type: decimal }` will reach its ghost once orderedList flips). |
| 14 | L3b.2 | d6f1114 | Eliminate the release re-wrap — but NOT via the hypothesized content inset, which live measurement proved was already 0. Measured in dev preview via real drag→release: plain paragraph AND bulletList show ZERO delta on every axis (insetLeft 32, insetTop 16, textWidth, textHeight/lineCount) — L3b.1's `.tiptap` scope had already aligned their typography + inset, so the brief's "internal text inset is a few px smaller" hypothesis was falsified. The residual re-wrap surfaces only on whitespace/command-dense paragraphs: the math-heavy sample paragraph rendered **13 lines in the overlay ghost vs 14 in BOTH the source main editor and the real popout** (+24.32px = exactly one line-height), while insets (32/16), textWidth (380), and every inline-atom width were bit-identical between clone and popout — so it is a LINE-BREAKING delta, not an inset/width/atom-metric one. The overlay is the outlier (source == popout == 14). Two `.ProseMirror`-scoped editor-rendering rules don't reach the `.tiptap`-only clone (same CLASS as L3b.1's list markers, just scoped to `.ProseMirror` rather than `.tiptap`): **(1)** prosemirror-view's base `.ProseMirror { white-space: break-spaces; word-wrap: break-word }` ([node_modules/prosemirror-view/style/prosemirror.css](node_modules/prosemirror-view/style/prosemirror.css) lines 6-8) — these inherited wrapping props reach the editor's prose but the clone fell back to `white-space: normal`, which COLLAPSES whitespace runs and drops trailing-space wrap pressure, so the clone wrapped a line short (confirmed: source/popout `<p>` = `break-spaces`, clone `<p>` = `normal`); **(2)** globals.css `.ProseMirror .latex-cmd` (monospace 0.9em) — the clone rendered `\cmd` spans in the inherited serif at full size (~10.5px/char) instead of Geist Mono 0.9em (~8.2px/char), a real per-atom width + visual mismatch vs both source and popout (the source main editor IS monospace, so the ghost visibly switched fonts mid-gesture). Fix (globals.css only): extend BOTH rules to the `.tiptap` content scope — added `white-space: break-spaces; overflow-wrap: break-word` to the bare `.tiptap {}` rule ([globals.css](src/app/globals.css) ~561), and added `.tiptap .latex-cmd` alongside `.ProseMirror .latex-cmd` (~2813). Every real editor element is `.tiptap ProseMirror` (verified live: 0 `.tiptap:not(.ProseMirror)` surfaces other than the transient drag clone), so both edits are NO-OPS for live editors (identical computed values) and additively reach the `.tiptap`-only clone — the L3b.1 philosophy that content-rendering rules belong on `.tiptap` (content scope), not `.ProseMirror` (editor-instance scope), so they survive the clone. L1.5's inline capture already carries `font-feature-settings`/ligatures, so those were not implicated. Verified live via real drag→release on all three lifted kinds: paragraph 13↔13, bulletList 2↔2 (L3b.1 markers/padding intact — `disc`, padLeft 24px), math/`\latex-cmd` paragraph **14↔14 (was 13 ghost vs 14 popout)** — every delta now 0, no re-wrap on release; clone computes `white-space: break-spaces` + Geist Mono latex-cmd. `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (the 8 pre-existing `usePersistentState` storage-mock failures fail identically with the change stashed). Note for L3c/L4: any future kind that renders inside `.ProseMirror`-scoped chrome (esp. code blocks — `.ProseMirror pre { white-space: pre-wrap }`) will hit the same scope-gap class and want the same `.ProseMirror`→`.tiptap` rescope; L4 may also retire L1.5's now-arguably-redundant inline typography capture. |
| 15 | L3b.3 | 343ebc5 | Eliminate the ghost↔popout re-wrap: a bulletList line one char short of wrapping in the ghost re-wrapped crossing into the popout because the popout text area was 2px narrower than the ghost's. **Measured live (real drag→release on the dev-doc bulletList, fresh `.next-preview`):** ghost body-content-width = **358px** / `<li>` text column **334px**; popout = **356px** / **332px**; released float = **356px** / **332px** — a uniform 2px (1px each side) deficit in BOTH popout overlay AND released float vs the ghost. (Drag-popout == released, so L3b.2's invariant held; only the ghost differed — making this a clean ghost-vs-popout(=released) delta.) **Source CONFIRMED (not assumed):** the popout overlay is `box-sizing: border-box` and gains `border: var(--pod-border)` (computed `border-left/right: 1px`, vs ghost's `0px`) in popout mode; under border-box that 1px eats into the overlay's content box where `.lifted-text-overlay__body { width: 100% }` lives, so the body — and its text — was 2px narrower than the L1.12 `+64` body-padding compensation assumed (overlayW 422 → content box 420 → body 420−64 = **356** in popout, vs ghost overlayW 358 → body 358). The released float (`FloatingPanel` surface="card") carries the identical 1px `--pod-border`, so its body content was likewise `sourceWidth−2`. **Correction to the brief's hypothesis #2:** the body was ALREADY `box-sizing: border-box` (Tailwind v4 preflight — verified `boxSizing: "border-box"` live in all three states), NOT content-box; so the explicit `box-sizing` addition is a self-documenting no-op (pins the assumption against a future preflight change) and the *real* fix is the geometry border compensation. **Fix:** (1) explicit `box-sizing: border-box` on `.lifted-text-overlay__body` (globals.css). (2) new `POPOUT_BORDER = 1` constant in BOTH `LiftedTextOverlay.tsx` and `TextObjectGrabHandle.tsx` (mirrors `--pod-border` width, hardcoded like HEADER_HEIGHT / BODY_PADDING_* rather than parsed from the border shorthand). (3) popout overlay geometry grows the OUTER box by `2*POPOUT_BORDER` per axis and shifts it by `POPOUT_BORDER` (`overlayWidth = sourceWidth + 2*BODY_PADDING_X + 2*POPOUT_BORDER`, `overlayHeight += 2*POPOUT_BORDER`, `overlayLeft = textX − BODY_PADDING_X − POPOUT_BORDER`, `overlayTop −= POPOUT_BORDER`) so after the border+padding inset the body text content lands at exactly `sourceWidth × sourceHeight` (== ghost); text stays at `textCoords` (L1.12: `(textX−32−1) + 1 border + 32 padding = textX`). (4) the `popOutAtRect` spawn gets the same `+2*POPOUT_BORDER` on width/height and `−POPOUT_BORDER` on x/y so the released float's body text also lands at `sourceWidth × sourceHeight`. **Verified live (real drag→release):** bulletList ghost/popout/released body-content all **358px**, text column all **334px**, line counts identical (no re-wrap); standalone paragraph all **382px**, 6 lines in all three; text top pixel unchanged across ghost→popout (279.91 / 259.9 — L1.12 text-stays-still preserved, only chrome grows); popout header still flush (`left −1`, `width +2`, bottom edge at overlay top). `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (the 8 pre-existing `usePersistentState` storage-mock failures fail identically). The brief's "anchor on the text content box" alternative was unnecessary — the additive approach took a single constant. |
| 16 | L3c — orderedList kind onto lifted-overlay | f34e7f8 | orderedList onto lifted-overlay — the twin of L3b's bulletList. `liftMode: "lifted-overlay"` + `computeLabel: () => "Ordered list"` (the exact string `list-body.tsx` pushes via `setHeaderLabel` on its orderedList branch), mirroring L3b's bulletList constant-label pattern. Same list-body float, same overlay/gesture/drop code — only the label string and the marker glyph differ from bulletList. Decimal counters render in the ghost via L3b.1's `.tiptap ol { list-style-type: decimal }` scope; no re-wrap via L3b.3's border compensation. Trivial 10-line registry edit (incl. comments) — abstraction fully in place after L3b.3, no new slots or overlay changes. **Verified live** (real drag on the dev-doc orderedList uuid `dede`, 6 items, fresh `.next-preview`): ghost clone renders all 6 decimal counters (1.–6.) at `list-style-type: decimal` / paddingLeft 24px / Lora, bit-identical to the source main editor; popout-mode header reads "Ordered list" (CSS-uppercased to "ORDERED LIST"), `display:flex`/`opacity:1`, flush above the body (header bottom == overlay top); popout geometry border-compensated (ghost w502 → popout w568 = +64 body-padding +2 border, so the text content box stays 502px == sourceWidth → no re-wrap, markers+padding preserved across the flip); Escape mid-gesture aborts cleanly (overlay + sibling header torn down, portal empty, orderedList intact at 6 items, no popout float spawned, zero console errors). bulletList regression check: `disc` + paddingLeft 24px intact in both the main editor and a faithful `.tiptap` ghost clone. paragraph + heading untouched (diff isolated to the orderedList entry). `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (8 pre-existing `usePersistentState` storage-mock failures fail identically). Next in the L3 sweep: L3d (exampleBlock) — more involved (grid layout). |
| 17 | L3c.1 — content-fit popout height on mount | da4516d | First-popout-after-reload lists spawned ~2-3 lines too tall (sourceHeight captured at threshold-cross before web fonts load → taller FOUT fallback line-height; the per-item error accumulates across the list). Fix: content-fit (shrink-to-fit) the popout window height on mount after fonts/layout settle, decoupling final height from a stale captured sourceHeight. No-op in the settled case; drag-time geometry untouched. **Implemented by EXTENDING the existing fit-to-content affordance, not a new effect in `TextObjectFloat` (the brief's suggested site).** `FloatCard`'s mount auto-fit (the `autoFittedKeys`-gated `useEffect` in [src/components/FloatingCards.tsx](src/components/FloatingCards.tsx)) already grows text floats to content — gated to `.par-float-body`, which every text-object body carries incl. `list-body.tsx` — but it is GROW-ONLY (`if (target <= currentH + 1) return`), so a too-tall spawn kept its excess. Added a complementary shrink pass in the SAME effect so it shares the first-mount-per-session `autoFittedKeys` gate (never fights a user's reopen resize). Gated on `document.fonts.ready` — the exact moment the line-height corrects: on COLD fonts (the bug) it resolves AFTER content has reflowed to its final shorter height; on WARM fonts it resolves immediately and the >2px threshold makes it a no-op (no jump). A double-rAF after `fonts.ready` lets the post-swap reflow commit before measuring. **Measurement gotcha:** measure the content children's span (`lastChild.bottom − firstChild.top + body vertical padding`), NOT `body.scrollHeight` — when the window is too tall the body isn't overflowing, so `scrollHeight === clientHeight` (the container height) and is blind to the excess. Reuses the existing `ctx.setFloatPosition` setter (no new plumbing); keeps x/width/top so only the bottom edge rises to the text; still clamps to the existing 40vh cap (`overflow:auto` scrolls taller content). **Why not `TextObjectFloat`:** that site would need a duplicate gate + duplicate panel/body measurement + a second effect racing the grow loop on the same setter — extending the one existing affordance is the brief's own "reuse rather than build new" scope-guard. **Verified live** (spawned floats at deliberately-too-tall heights via the popped-cards ctx — a root-cause-agnostic trigger, since the fix corrects any stale spawn height regardless of cause): bulletList 450→149 (=content 123+26, exact hug), orderedList 430→295 (=269+26), paragraph 450→155 / 460→180 (=content+26) — all `shrank:true`, exact hugs; not-too-tall spawns (heading@320, paragraph@155) → `shrank:false` (my pass no-ops — any growth there is the pre-existing grow burst); content taller than the 40vh cap clamps to the cap. Screenshot confirmed the numbered-list popout's bottom edge hugs the last item with normal padding (no 2-3 line excess). `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (8 pre-existing `usePersistentState` storage-mock failures fail identically). No console errors. |
| 18 | L3c.2 — skip FloatCard auto-fit for lifted-overlay popouts | 83fc2d9 | **REAL fix for the first-popout-list-too-tall bug — supersedes the MISDIAGNOSED L3c.1 (da4516d).** L3c.1's font-FOUT theory was wrong and its `document.fonts.ready` shrink never fired: it re-measured the *already-grown* `scrollHeight`, so the >2px shrink threshold saw no excess and bailed. **Measured root cause:** lifted-overlay list popouts already spawn at the CORRECT authoritative height (list `<ul>` 301 + chrome 58 = 359 — captured at threshold-cross), but `FloatCard`'s grow burst (the `autoFittedKeys`-gated ResizeObserver `useEffect` in [src/components/FloatingCards.tsx](src/components/FloatingCards.tsx)) reads `body.scrollHeight` (376), which includes ~43px of ProseMirror trailing cursor-placement space BELOW the content node, and grows the window to 402 (+2 lines). The static drag clone has no editor/observer → stays correct, which is exactly why the list looked "correct during drag, jumps taller on release"; "retry works" was only the `autoFittedKeys` short-circuit making the second mount a no-op (nothing rendered differently). The grow burst — built for default-size instant-popout spawns that NEED growing — was fighting authoritative data. **Fix (two edits, one file):** (1) at the top of the auto-fit `useEffect`, parse the cardKey via `parseTextObjectPopoutKey` (returns null for panel-card keys like note/todo/bib → clean no-op there) and bail early when `TEXT_OBJECT_REGISTRY[parsed.kind]?.liftMode === "lifted-overlay"` — those popouts carry the authoritative source height and the grow machinery must not second-guess it; (2) removed the L3c.1 `fonts.ready` shrink block entirely (obviated). The grow burst's core logic is UNTOUCHED — it still serves default-size instant-popout kinds until they migrate; after L4 it's vestigial. Today `liftMode === "lifted-overlay"` is paragraph/heading/bulletList/orderedList, so all four now skip auto-fit; texBlock/exampleBlock have no `liftMode` (default instant-popout) and keep the burst. The diag-misread that drove L3c.1 (FOUT) is what this row corrects. **Verified live** (fresh `.next-preview`, dev-doc; spawned each kind at its gesture-authoritative `sourceHeight + chrome` via the popped-cards ctx, RAF shimmed for the backgrounded preview so the burst would actually run): bulletList stayed **432** (`grewBy:0`; burst WOULD have grown it to 499, +67), orderedList stayed **350** (vs 441, +91), paragraph stayed **326** (vs 350), heading stayed **125** (vs ~1096 — the heading float body carries a huge trailing-space `scrollHeight`, so the burst would have ballooned it / hit the 40vh cap) — every lifted kind `grewBy:0`, each hugging its content; screenshot confirms the four windows are content-sized with no empty trailing band. **No-regression for instant-popout:** exampleBlock (instant-popout, renders `.par-float-body`) spawned deliberately short at 140 still grew (→178, `grewBy:38`), confirming the grow burst is preserved for it; texBlock's float body has no `.par-float-body` so the burst never touched it (no-regression by construction). `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (8 pre-existing `usePersistentState` storage-mock failures fail identically). No console errors. Next in the L3 sweep: L3d (exampleBlock) / L3e (texBlock) — which auto-opt-out of the burst via this same guard once they flip `liftMode`. |
| 19 | L3d — exampleBlock kind onto lifted-overlay | 9fffbc6 | First grid-layout kind onto the lifted-overlay path. `meta.liftMode = "lifted-overlay"` on the exampleBlock entry (+15 lines incl. doc comment). NO `computeLabel`: `example-block-body.tsx` never calls `setHeaderLabel`, so the overlay's popout-mode header reads the static `meta.label` ("Example") — matches the real popout at handoff. NO CSS change: every expex layout rule in `globals.css` is already UNSCOPED (`.expex-block` grid `display: grid; grid-template-columns: 1.5em 1fr`, `.expex-number`, `.expex-body`, `.expex-item-row`, `.expex-item-marker`, `.expex-gloss-row` — none `.ProseMirror`-scoped), so they reach the `.tiptap` clone without extension; this is the recurring "scoped content CSS doesn't reach the clone" class (L3b.1/L3b.2 fixed by extending `.ProseMirror`→`.tiptap`) — here the rules were already lift-overlay-compatible by construction, so the fix degenerates to the registry flip. The only `.ProseMirror`-scoped expex rule (`.expex-block.ProseMirror-selectednode` selection ring at globals.css:3296) is non-layout state chrome and is stripped from the clone via L1.7's selection-attr sanitization regardless. **Verified live** (real gesture on dev-doc `ee02`, the richest case — 4 sub-items a./b./c./d.; RAF shimmed for the backgrounded preview): driving the REAL `LiftedTextOverlay` (not a hand-rolled mock), ghost mode renders `.expex-block` at `display:grid` / `grid-template-columns: 22.7969px 467.047px` (vs source 24px 465.203px — the ~1.2px marker-column delta is L1.5's typography-capture interaction: the wrapper carries `par-title-wrapper` so `resolveInlineContextElement` returns the inner `<p>` at 15.2px, making the block's `1.5em` marker column resolve to ~22.8px instead of the source's 24px @ 16px root — purely an em-basis artifact, NOT a CSS-reach problem; grid is intact, markers in column 1, not collapsed), all 4 sub-item markers `a./b./c./d.` rendered in the clone, nested `ex.` label pods and the `\includegraphics` atom in item d. visible. Screenshot confirmed grid laid out identically to the source beneath. Popout-mode flip on cursor crossing into manila (`x=1100 > podRight=1032`): white card + 1px border + shadow + header `display:flex` / `opacity:1`, label reads `"Example"` (static `meta.label`, no `setHeaderLabel`-style override), grid still intact with all 4 markers. Release in manila spawned the real popout: card 566×550 with body `clientHeight:526` (== body `scrollHeight` 568 MINUS ~42px of ProseMirror trailing cursor space = the L3c.2 grow-burst skip working — instant-popout exampleBlock would have grown the body to ~568+, here it stayed at the captured source-derived height); real popout renders the grid at the editor-root 16px → 24px marker column (correct, matches source), all 4 markers present. Source `ee02` intact post-release (4 items, still `(2)`, total exampleBlock count unchanged — the spawn correctly did NOT move/delete the source). **No-regression:** texBlock retains no `liftMode` (still instant-popout with `initialFloatSize: 480×280` → grow-to-fit unchanged); paragraph/heading/bulletList/orderedList retain their `liftMode: "lifted-overlay"` (diff isolated to the exampleBlock entry — 15 lines added, nothing else touched per `git diff --stat`). Zero console errors during the full gesture lifecycle (mousedown → threshold-cross → ghost → manila-cross → popout → release → real-popout-spawn). `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (8 pre-existing `usePersistentState` storage-mock failures fail identically). Next: L3d's lessons — the unscoped-CSS path means grid kinds may be cheaper than feared; L3e (texBlock) faces the CodeMirror-cloneNode known caveat (not a CSS-scope issue, a rendering-architecture one). |
| 20 | L3d.1 — unify the float header label (overlay ↔ real popout) | 73303a1 | Architectural fix for the header-label shape-change-on-release — reported on exampleBlock but GENERAL (any kind). **Root cause: two independently-maintained implementations of one chrome.** The overlay label (`globals.css .lifted-text-overlay__label`, typography inherited from `.lifted-text-overlay__header`) forced `font-family: var(--font-sans)`; the real popout label (`TextObjectFloat` span, Tailwind `text-[10px] uppercase tracking-wider font-medium`) set NO font-family and inherited the body chrome stack `var(--font-sans-override, var(--font-sans)), "Inter", system-ui, sans-serif`. **Measured drift** (light 2-eval faithful-probe inspection in the dev preview — each label measured in its REAL DOM context: popout under `document.body` where FloatCard portals, overlay under `[data-lifted-overlay-portal]`): the ONLY differing computed property is `font-family` — overlay `Inter, "Inter Fallback"` vs popout `Inter, Inter, system-ui, sans-serif`; everything else identical (font-size 10px, weight 500, letter-spacing 0.5px, uppercase, line-height 15px, color rgb(120,113,108)). They COINCIDE only when `--font-sans-override` resolves to Inter AND Inter is loaded (default dev state: both 50.87px wide). They DIVERGE whenever (a) the user customizes the sans font — the overlay's bare `var(--font-sans)` IGNORES `--font-sans-override` while the popout follows it (demonstrated by temporarily setting a Georgia override: popout renders Georgia 51.79px, overlay stays Inter 50.87px), or (b) Inter isn't loaded yet — the fallback chains differ (`"Inter Fallback"`, Next's metric-adjusted face ≈ Inter's larger metrics, vs raw `system-ui, sans-serif`), so the overlay label renders bigger then resettles on release. **Fix:** extracted a shared `FloatHeaderContent` ([src/text-objects/FloatHeaderContent.tsx](src/text-objects/FloatHeaderContent.tsx)) rendering the label span + flex spacer + jump chevron + close X with EXPLICIT, complete typography — the label's `font-family` set explicitly to the body chrome stack `var(--font-sans-override, var(--font-sans)), "Inter", system-ui, sans-serif` (context-independent so it's identical in either mount, and still honors `--font-sans-override` exactly as the popout's inherited value did) — used by BOTH `TextObjectFloat` (interactive `onJump`/`onClose`) and `LiftedTextOverlay` (handlers omitted → visual-only; the overlay header is `pointer-events:none`). The X is the same `PopoutButton variant="x" iconbtn-xs` and the chevron the same 10px SVG button as the real popout, so the overlay's ICONS now match too — the X had also silently drifted (overlay 10px/stroke-2 → popout 12px/stroke-2.5 on release); unification fixes that as well. Outer header containers stay per-implementation (overlay = JS-positioned portal sibling with bg/border/radius from globals.css; popout = FloatCard flex-row) — only the inner content is shared, and both outer containers already share the same flex/gap(4px)/padding(0 8px)/height(24px). Stripped the now-redundant label typography (font-size/weight/letter-spacing/transform/family/color) from `.lifted-text-overlay__header` and deleted the now-unused `.lifted-text-overlay__label` / `.lifted-text-overlay__header-spacer` / `.lifted-text-overlay__icon` (kept the outer header's positioning/bg/border/radius/transition). **One source of truth → no label can drift, on any kind.** Matched to the real popout's CURRENT rendering so the released popout is UNCHANGED and only the overlay corrects. (Closes the shared-header-component cleanup deferred in L1.7.) **Verified live** (fresh `.next-preview`, dev-doc, RAF shimmed for the backgrounded preview): real drag gestures on all 5 lifted kinds — for EVERY kind the live overlay popout-mode label and the released popout label are byte-identical across font-family/size/weight/letter-spacing/line-height/text-transform/width AND text, NO shape change on release: paragraph "Paragraph" (65.35px), heading "Section" (47.81px — per-level `computeLabel` override intact), bulletList "Bullet list" (67.32px), orderedList "Ordered list" (77.11px), exampleBlock "Example" (50.87px, the reported kind). Both mounts carry the shared explicit font-family inline. Released popout retains interactive Jump + Dock buttons; screenshot of the released "ORDERED LIST" popout confirms unchanged header appearance. **Context-independence proof:** the shared label markup renders identically in body-context (popout) and portal-context (overlay) under BOTH default (both 50.87px Inter) and a custom Georgia override (both 51.79px Georgia — the overlay now follows the override, the pre-fix divergence eliminated). Real popout JSX is byte-identical to before except the added inline font-family, which resolves to the same value it inherited (popout pixels unchanged — 50.87px in default state). `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (8 pre-existing `usePersistentState` storage-mock failures fail identically). Next: L3e (texBlock) — the CodeMirror-cloneNode caveat; the header chrome is now fully unified for any future kind. |
| 21 | L3d.2 — fix EXPEX (1)/a. marker size in the lifted clone (relative-em cascade base) | 52ded48 | **Distinct from L3d.1** — that unified the popout HEADER label; this fixes the expex example-number marker INSIDE the cloned content (L3d.1 chased the header by mistake; that work stands, untouched here). Reported as the `(1)`/`a.` marker (`.expex-number` / `.expex-item-marker`, both `font-size: 0.95em`) rendering BIGGER in the ghost+popout overlay then resettling smaller on release into the real popout. **Root cause: the clone's font-size cascade BASE differed from the source's.** `.expex-number`'s `0.95em` resolves against `.expex-block`'s computed font-size, which in the SOURCE inherits the editor ROOT (16px) — `--editor-font-size` (0.95rem in dev) is applied ONLY to `.tiptap p`, never to the example block's grid/markers. But `LiftedTextOverlay`'s L1.5/L1.12 typography capture set the overlay root's font-size from `getComputedStyle(resolveInlineContextElement(anchorDom)).fontSize` — and for the expex wrapper (which carries `par-title-wrapper`) that resolver descends to the inner `<p>` (= `--editor-font-size`), NOT the block's own base. So the clone's marker em-base = `--editor-font-size` while the source's = the editor root; they differ whenever `--editor-font-size ≠ 1rem`. **Measured** (dev-doc, real `LiftedTextOverlay` gesture on the multi example `(2)` with 7 sub-items, plus an in-page faithful-clone probe of source vs current-capture vs fixed-capture): default prefs (`--editor-font-size` 0.95rem < 1rem root) → source `.expex-number` **15.2px** (em-base `.expex-block` **16px**), clone **14.44px** (em-base **15.2px**) — drifts smaller; enlarged editor font (1.3rem > root, the user's regime) → source marker still **15.2px** (markers inherit the root, unchanged by editor-font), source `<p>` 20.8px, but clone marker **19.76px** — drifts BIGGER, reproducing the reported "renders bigger, resettles on release" exactly (the real popout, a true `.tiptap`/`.ProseMirror`, renders 15.2px). **Fix:** read the clone's cascade base from `anchorDom`'s OWN computed font-size (`window.getComputedStyle(anchorDom).fontSize`) instead of the resolved inline element — `anchorDom` IS the cloned block, so its own font-size is the exact base its relative-unit descendants resolve against in the source. One changed line in `LiftedTextOverlay.tsx`'s `typographyStyles` (the remaining inherited props still read from the inline element, holding L1.12's prose family/weight/spacing intent — only the size BASE moves to the block). **Architectural — closes the whole relative-unit-drift class, not just the (1) marker:** the same base makes `.expex-number`, every `.expex-item-marker`, gloss tiers (`.expex-gloss` 0.88em → `.expex-gloss-row-glb`/`-glc` 0.85em), and any future em/%-sized label of any kind resolve identically to the source. **Verified live on the REAL fixed component** (full mousedown→threshold→ghost→popout→release gesture, RAF-shimmed for the backgrounded preview): exampleBlock `(2)` `.expex-number` **15.2px** in source === ghost === popout overlay === released real-popout, all **7** sub-item markers **15.2px** across all four states — no inflation, no resettle; overlay root font-size now **16px** (the block's own base) in both modes; cloned paragraph text stayed **15.2px** (`.tiptap p` overrides the inherited base). **No non-expex regression** (the change moves the overlay root's font-size for every kind, but kinds whose visible text owns an explicit `.tiptap p`/`.tiptap h2`/`.tiptap li` rule are immune): measured current-vs-fixed identical — paragraph `<p>` **15.2px**, heading `<h2>` **21.6px** (verified on the REAL component: the overlay root went 21.6→16px yet the heading text stayed 21.6px), bulletList/orderedList `<li>`/`li p`/`::marker` **16/15.2/16px** (their wrapper's own base already equalled the inline capture, so untouched either way). Gloss-only block unchanged (its `resolveInlineContextElement` already fell back to the wrapper — a `\begingl` block has no `<p>` — so its base was already correct). `.expex-number`'s `0.95em` rule itself untouched (correct in the editor; the bug was the clone's base, not the rule). `npx tsc --noEmit` clean; `npm test -- --run` baseline unchanged (264 pass / 8 pre-existing `usePersistentState` storage-mock fails, identical). Zero console errors across the full gesture lifecycle. Next: L3e (texBlock) — the CodeMirror-cloneNode caveat. |
| 22 | L3d.3 — fix clone inheritance-shield leaks (line-height length + white-space) | fe53e39 | The EXPEX "Ex." pod (`.expex-label-annotation.heading-annotation`, a `contenteditable="false"` chrome child of the exampleBlock) rendered BIGGER in the lifted clone. **Measured** (dev-doc, faithful in-page overlay repro of source vs old-capture vs fixed-capture; the old-capture repro reproduced the bug numbers EXACTLY, proving the harness faithful): source pod **147.16×20.32** (line-height **16.32px**, white-space **normal**) vs old clone **161.15×28.32** (line-height **24.32px**, white-space **break-spaces**); font-size **10.88px** (0.68rem) in BOTH, no transform — NOT the cause. **One class, two leaks:** the pod sets neither `line-height` nor `white-space`, so it inherits both; both inherited values are SHIELDED in the real editor but the shields are gone in the `.tiptap`-but-not-`.ProseMirror` clone. **Leak 1 (height +8px):** L1.5's typography capture (`LiftedTextOverlay.tsx typographyStyles`) read the prose `<p>`'s `getComputedStyle().lineHeight` = a resolved LENGTH (`"24.32px"`) and applied it INLINE on the overlay root; a length line-height inherits VERBATIM to every descendant regardless of font-size, so the pod got 24.32px instead of its natural `1.5 × 10.88 = 16.32px` (the source pod inherits the document's UNITLESS `1.5` and multiplies by its own font-size). **Leak 2 (width +14px):** `.tiptap { white-space: break-spaces }` (L3b.2) inherited into the pod, preserving its double/leading spaces; the source pod is shielded by prosemirror-view's base rule `.ProseMirror [contenteditable="false"] { white-space: normal }`, but the clone has neither `.ProseMirror` (the rule's scope) nor — after the sanitizer stripped it — the `contenteditable="false"` marker. **Fix (both target the CLASS — every non-prose/non-editable clone descendant of every kind, not just the pod):** (1) STOPPED capturing `line-height` in `typographyStyles` (`LiftedTextOverlay.tsx`) — the `.tiptap p`/`h*`/`li` rules (reaching the clone since L3b.1) already give prose its per-element line-height identical to source, and non-prose chrome now inherits the document's unitless 1.5; this resolves the L1.5 line-height-capture-redundancy question flagged in L3b.1 (it was not merely redundant but harmful). `src/lib/text-metrics.ts` needed NO change — its line-height usage is the grab-handle cap-top-offset math, a separate concern that never touches the overlay capture. (2) Sanitizer now KEEPS `contenteditable="false"` (strips only editable-making values `"true"`/`""`/`"plaintext-only"`) so the shield can match; added `.tiptap [contenteditable="false"] { white-space: normal }` (globals.css, beside the `.tiptap { break-spaces }` rule) mirroring prosemirror-view's prose-view shield into the `.tiptap` content scope. No-op for live editors (their chrome is `.tiptap.ProseMirror [contenteditable="false"]`, already covered) — confirmed: live editor visually unchanged, source pod still 147.16×20.32/normal. **Verified** (dev-doc, fresh `.next-preview`): fixed clone pod **147.16×20.32, line-height 16.32px, white-space normal — byte-identical to source** (Δheight −8px, Δwidth −13.99px = the two leaks); the pod's `="false"` is preserved in the fixed clone, stripped in the old. **No prose regression across kinds** (line-height source === fixed-clone): exampleBlock `<p>` **24.32px**, paragraph **24.32px**, heading **32.4px**, bulletList `<li>` **24px**, orderedList **24px**. **L3b.2 wrapping intact:** editable prose keeps `white-space: break-spaces` (the shield is selective — only `="false"` chrome gets `normal`); a 14-line wrapped paragraph wraps to the identical **340.48px / 14 lines** in source and clone. `npx tsc --noEmit` clean; `npm test -- --run` **278 pass / 0 fail** (the brief's stated 157/8-fail baseline was stale — the 8 pre-existing `usePersistentState` fails were fixed in eda8db8; the suite has since grown and is fully green). **FLAG CORRECTION — placeholder float body is NOT a gap:** the measure-session flagged exampleBlock's `floatBodyComponent` as the unwired `PLACEHOLDER_FLOAT_BODY` (→ empty popout on release). In fact `ExampleBlockBody` (a real `useEditor`/`EditorContent` embed, `floats/example-block-body.tsx`) IS registered at boot via `import "@/text-objects/floats"` (Editor.tsx:49) → `registerFloatBody("exampleBlock", ExampleBlockBody)` (floats/index.ts:32, added in 6c8041d "Phase D5"), which overwrites the static `PLACEHOLDER_FLOAT_BODY` literal that EVERY kind uses as its pre-registration default (paragraph/heading/lists too); `popoutKeyForLift` also returns a real key for `exampleBlock`. The flag read the static registry literal without tracing the two-phase boot registration — so releasing an exampleBlock popout should render the full embed, not empty. No follow-up needed; a 30-sec runtime confirm (release an exampleBlock popout) would close it definitively. Next: L3e (texBlock) — the CodeMirror-cloneNode caveat. |
| 23 | L3e — texBlock kind onto lifted-overlay (the CodeMirror-clone case) | efa9b0a | The one CodeMirror-backed kind — and the kind decision §4 *assumed* "won't clone usefully," flagging a fallback (placeholder / screenshot / degraded visual). **RESOLVED: the assumption is FALSIFIED — `cloneNode(true)` of the `.tex-block` pod renders the code faithfully, so the commit is JUST the `liftMode` flip; no `renderGhost` fallback hook was built** (per the brief's "only if the DOM clone is actually broken"). **Why it works (inspected before assuming, per the brief):** CodeMirror 6 renders each line as REAL DOM (`.cm-line` text nodes + syntax-highlight spans, not a canvas/virtualized-paint), and its theme + base CSS are injected as GLOBAL `<style>` tags (the `EditorView.theme` mechanism — NOT `.ProseMirror`/`.tiptap`-scoped), so the clone's `.cm-editor`/`.cm-scroller`/`.cm-content` keep both the code text AND the pod framing (border/bg/mono font) even though the overlay portal mounts outside `.ProseMirror`. This is the OPPOSITE failure mode from L3b's lists (there the content CSS was `.ProseMirror`-scoped and DIDN'T reach the clone; here CM's CSS is global and DOES). The L3d.3 sanitizer change is load-bearing: `.cm-content` is `contenteditable="true"` → stripped (keeping only `="false"` chrome), so the ghost is a faithful NON-editable static snapshot. **No `computeLabel`:** `tex-block-body.tsx` never calls `setHeaderLabel`, so the overlay's popout-mode header reads the static `meta.label` ("TeX block") — matches the real popout at handoff. **Measured live** (fresh `.next-preview`, dev-doc, RAF-shimmed; the dev doc's one texBlock = a 10-line tikzpicture, pod 502×222, no title so wrapper rect == pod rect). **(a) Faithful clone probe** (replicating `LiftedTextOverlay`'s exact `cloneNode`+sanitize into a `.lifted-text-overlay__body.tiptap` host sized to source): cloned `.cm-editor` **502×222** (== live), `.cm-content` **500×220** (502 − 1px border/side), **10 `.cm-line`s**, code **334 chars** (`\begin{tikzpicture}…`), border **`1px solid rgb(168,196,222)`** (the `#a8c4de` pod blue), **Geist Mono 13px**, `.cm-content` `contenteditable` → **null** (sanitized). **(b) Real `LiftedTextOverlay` gesture** (drove the actual component, not a mock — mousedown→threshold→ghost→popout→release): GHOST mode — overlay **502×222**, opacity **0.6**, border none, body wrap `.lifted-text-overlay__body tiptap`, `.cm-editor` present with **10 lines** / 334 chars / blue border / Geist Mono 13px / `.cm-content` null, header `display:none`; **screenshot** confirms the ghost renders the `.tex` chip + syntax-highlighted LaTeX, NOT an empty box. POPOUT mode (cursor past `editorPanePodRight` 1032 into manila) — white bg + **1px border + box-shadow + opacity 1**, geometry **568×256** (= 502 + 2·BODY_PADDING_X(32) + 2·POPOUT_BORDER(1) / 222 + 2·16 + 2·1 — L1.12/L3b.3 border-compensated, body content stays 502×222 = source, no re-wrap), header `display:flex` / opacity 1 / text **"TeX block"** / **flush above the overlay** (570px = +2 border overlap); **screenshot** confirms the "TEX BLOCK" card in the manila. RELEASE-in-manila — spawned the real **live, editable** CodeMirror popout (`.cm-content` `contenteditable="true"`, **10 lines**, 334 chars, body ≈566×224 hugging source, skips the grow burst via L3c.2); source texBlock **preserved** (count still 1, not moved/deleted). **Atom-block (block-top) positioning CONFIRMED:** the grab handle is **hover-driven** (atoms have no caret — hovering the pod's Y-band reveals it) and its top sits at **y=355 == pod top** (`anchorDom.getBoundingClientRect().top`, the `block-top` anchor via `[data-glyph-anchor]` on `.tex-block-pod`), and the overlay positions correctly tracking the cursor with the captured grab-offset — the lifted-overlay geometry reads `anchorDom.getBoundingClientRect()` identically for block-top and text-top, so no atom-specific code was needed. **Move-on-ghost-release:** ghost-release routes to the shared `commitDropSession()` (NOT a popout spawn — verified `newFloatSpawned:false`, overlay torn down clean, texBlock intact, zero duplication); the gesture engages `beginDropSession` in the same kind-agnostic branch the moment the overlay mounts, and texBlock uses the same `topLevelDropAdapter` as the 5 prior kinds. The ACTUAL in-editor relocation could not be exercised because this dev preview is **read-only** (`pmEditable:false`, collab pen un-takeable headless) — the exact gating L3b documented, affecting EVERY kind equally, NOT texBlock-specific. **Other kinds unaffected:** `git diff` is isolated to the single texBlock registry entry (`liftMode` + doc comment, +17 lines); paragraph/heading/bulletList/orderedList/exampleBlock keep `lifted-overlay`, the instant-popout kinds keep no `liftMode`. `initialFloatSize` retained (L4 removes it); linkedRange untouched (L3f). `npx tsc --noEmit` clean; `npm test -- --run` **278 pass / 0 fail**; **zero console errors** across the full gesture lifecycle. Next: L3f (linkedRange) — the mark-backed multi-paragraph range; then L4 (retire `liftMode` + `initialFloatSize`). |
| 24 | L3e.1 — texBlock polish: pod-framed popout body + top-gap/title-space fix | e1c8302 | Two texBlock polish items surfaced after L3e, both prescriptive-or-investigate. **Issue 1 — released popout now matches the lifted ghost (pod-framed).** The ghost (a `cloneNode` of the source `.tex-block-pod`) shows the blue pod border + ".tex" chip, but the real popout body ([src/text-objects/floats/tex-block-body.tsx](src/text-objects/floats/tex-block-body.tsx)) rendered a NAKED CodeMirror — the float's `texBlockFloatTheme` simply omitted the border the source's `texBlockTheme` carries. **Fix:** wrap the float's CodeMirror in the same `.tex-block-pod` → `.tex-block-editor` framing classes as `TexBlockNodeView`, add the border (`1px solid var(--heading-annotation-border)`) + `6px` radius + 44px content right-pad back onto `texBlockFloatTheme` (matching `texBlockTheme` — the file's own comment already declared the intent that the two themes match; the color is the shared `--heading-annotation-border` var so the pod tone stays single-source), and replicate the ".tex" chip with **identical markup** (same Tailwind classes / `--heading-annotation-*` vars). The float **omits** the source's chevron / row-sensor / in-place trash (the float has its own header close/jump chrome — visual frame only, per the brief's "do NOT add a destructive delete"). **Source `TexBlockNodeView` left untouched** (zero risk to the in-place pod + the ghost that clones it). One subtlety: `@uiw/react-codemirror` wraps `.cm-editor` in a `.cm-theme` div that defaults to *content* height, so `height="100%"` alone left the bordered box content-sized inside a taller float; added `style={{ height: "100%" }}` (sizes the wrapper) so the pod fills the body at any float size. **Verified live** (fresh `.next-preview`, dev-doc TikZ texBlock, popped via the runtime popped-cards `toggle` so the editor was live and the body populated): float `.cm-editor` **`1px solid rgb(168,196,222)`** (== `#a8c4de` source blue) / radius `6px` / fills the 212px pod, `.cm-scroller` `overflow:auto`, `.tex` chip present at `top:4px right:6px` with border `#a8c4de` + text `#6b9ac4`, 334 chars of syntax-highlighted LaTeX; **screenshot** shows the "TEX BLOCK" float wearing the pod border + ".tex" chip + `+T` title — no framing jump vs the ghost. **Issue 2 — texBlock left the wrong vertical space above it (GENERAL, fixed + verified — not drop-specific).** **Cause (inspected, not assumed):** the texBlock renders through a React NodeView, so its `.tiptap`-DIRECT child is a `.react-renderer.node-texBlock` wrapper, **not** `.tex-block` — the unified inter-block rhythm rule (`:where(.tiptap) > :where(…)`, scoped to direct children) can never reach `.tex-block` across that wrapper. The block had been relying on a Tailwind `my-3` (12px) + a `.tex-block:has(.par-title-text){margin-top:1.5em}` special-case; `my-3` **under-shot** `--editor-block-gap` (19.2px), so an untitled/normally-placed texBlock sat too tight with no room for its title slot. (First attempt — adding `.tex-block` to the rhythm-rule `:where()` list — was reverted once the DOM showed the wrapper nesting makes it never match; it would also have dropped the block to `0px`.) **Fix:** drop `my-3` (from [src/components/TexBlockNodeView.tsx](src/components/TexBlockNodeView.tsx)) and the `:has` 1.5em pair, and give `.tex-block` its **own** `margin-top: var(--editor-block-gap); margin-bottom: 0` ([src/app/globals.css](src/app/globals.css)) — the same self-managed pattern the other React-wrapped blocks (figure/graphics) use, kept in lockstep with the unified rhythm via the shared var. Titled & untitled now match a paragraph exactly. **Verified** on the normally-placed dev-doc texBlock: `margin-top` **19.2px** (== the adjacent `.par-title-wrapper`'s 19.2px), visual gap 19.2px (was 12px); **screenshot** shows the in-doc TikZ pod with a normal inter-block gap. Because the fix lives on `.tex-block`'s own class, it applies wherever the block lands — so the **drop case resolves by the same rule**; the literal in-editor DROP couldn't be exercised in this **read-only** preview (`pmEditable:false`, collab pen un-takeable headless — the same gating L3b/L3e documented, affecting every kind equally). **User-verify step:** in a writable session, drag-drop the texBlock to a new position and confirm the gap above it == a normal block's (≈19px) and the `+T` slot has room. `npx tsc --noEmit` clean; `npm test -- --run` **278 pass / 0 fail**; zero console errors. Diff isolated to the three files; no lifted-overlay primitive / ghost-clone / other-kind / sync-logic / `initialFloatSize` changes. |
| 25 | L3e.2 — texBlock ghost clip (clone margin) + release reflow (float pod width) | bbc0ca6 | Two texBlock defects, both MEASURED root causes (implemented, not re-diagnosed). **Issue 1 — lifted ghost clipped the code (vertical).** The cloned inner `.tex-block` carries `margin-top: 19.2px` (its self-managed `--editor-block-gap`, added L3e.1); the overlay body (`.lifted-text-overlay__body`, `overflow:hidden`) forms a BFC that RETAINS that top margin inside the box, pushing the clone down 19.2px — but `sourceHeight` was captured as the margin-LESS rect (222.15), so the bottom ~19px (last line `\end{tikzpicture}` + bottom padding) clipped (body scrollHeight 241 vs clientHeight 222). Specific to React-NodeView-wrapped kinds (texBlock/figureBlock/graphicsBlock): their margin sits on the nested `.tex-block` under `.react-renderer.node-texBlock`, which the rhythm rule's `:where(.tiptap) > :first-child { margin-top: 0 }` (which saves the direct-child kinds — paragraph/heading/lists/exampleBlock, whose clone root IS the body's first child) can't reach across the wrapper. **Fix 1 ([src/app/globals.css](src/app/globals.css)):** `.lifted-text-overlay__body > *, .lifted-text-overlay__body > .react-renderer > * { margin-top: 0 }` — zeros the clone's retained inter-block top margin (general; the `.react-renderer` arm at specificity 0,2,0 beats `.tex-block`'s `margin-top: var(--editor-block-gap)` 0,1,0 with no `!important`; a no-op for the direct-child kinds the rhythm rule already zeros). **Issue 2 — content reflowed on release (horizontal).** The released float's CM text-area was 40px WIDER than source/ghost (484 vs 444) → the code re-wrapped at a different column. Cause: the release spawn sizes the card as `sourceWidth + 2·POPOUT_BODY_PADDING_X + 2·POPOUT_BORDER` with `POPOUT_BODY_PADDING_X = 32` (the uniform float-body chrome contract, tuned for paragraph-body's `px-8`), but `tex-block-body` wrapped its pod in `px-3` (12) → the float pod was `2·(32−12) = 40px` too wide → text-area 484 vs 444. (The 44px `.cm-content` right-pad is identical in both — NOT the cause.) Secondary: the float CM `height:100%` clamped the `.cm-scroller` (~10px bottom clip, 210 vs 220) vs source/ghost `height:auto`; and the float forced its title annotation to `display:block` (in-flow), adding vertical height the absolute-titled source/ghost don't have. **Fix 2 + 2b ([src/text-objects/floats/tex-block-body.tsx](src/text-objects/floats/tex-block-body.tsx)):** restructured the float body to mirror `paragraph-body.tsx`'s chrome contract — a `.par-float-body … px-8 py-4` outer (= POPOUT_BODY_PADDING_X/Y 32/16 → float pod = sourceWidth 502 = source pod → CM text-area 444 = source/ghost → no reflow) wrapping a `.par-title-wrapper` (title collapses to `absolute bottom:100%` when untitled, matching the source pod + ghost, so the pod sits at the body's top — no vertical jump) and a `.par-body-container` holding the unchanged `.tex-block-pod` → `.tex-block-editor` + `.tex` chip framing (L3e.1 blue `#a8c4de` pod border preserved); CodeMirror left at its default content `height:auto` (no `height`/`style` prop, like the source pod) so the pod grows to full content height and ALL code shows (the `.cm-scroller` clamp is gone). **NO geometry-constant / spawn-math changes** (L1.12/L3b.3 load-bearing and correct for the contract — texBlock was the deviation; aligning it to the uniform 32px chrome is the simplest, lowest-risk fix). **Verified live** (fresh `.next-preview`, dev-doc TikZ texBlock, real RAF-shimmed lift gesture at 1400px viewport). SOURCE pod **502** / CM text-area **444** / 10 lines / scrollHeight 220 == clientHeight 220 (no clip) / border `#a8c4de`. GHOST (mode "ghost", overlay 502×222.15): clone `.tex-block` `margin-top: 0` (was 19.2px), body scrollHeight **222 == clientHeight 222** (was 241 vs 222 → ~19px clip GONE), 10 lines, last line `\end{tikzpicture}` bottom 616 ≤ body bottom 627 (within body, not clipped), text-area **444** — **screenshot** shows all 10 lines incl. `\end{tikzpicture}`. RELEASED FLOAT (popout-mode release → real CodeMirror popout, body `.par-float-body`): pod **502** (was 542), text-area **444** (was 484 → NO reflow), 10 lines, last line `\end{tikzpicture}` visible, `.cm-scroller` scrollHeight **220 == clientHeight 220** (no clamp; was 210 vs 220), title annotation `position: absolute` (untitled), pod border `#a8c4de` preserved — **screenshot** shows the "TEX BLOCK" float with all 10 lines + pod border + `.tex` chip, first line wrapping at `font=\small,` identical to the ghost. **SOURCE == GHOST == FLOAT text-area all 444, identical wrapping** → no reflow on release; ghost + float both show full content (no clip/clamp). **No-regression:** paragraph ghost (direct-child clone) `margin-top: 0` / no clip (Fix 1 no-op); exampleBlock faithful-clone probe — grid intact (`display:grid`, cols `24px 465.203px`), marker present, root margin zeroed (was 19.2px), no clip (its grid is nested in `.par-title-wrapper`, neither a direct body child nor under `.react-renderer`, so Fix 1's rules never touch it); heading/lists structurally identical (direct children, clone root already zeroed by `:first-child`). figureBlock/graphicsBlock not on lifted-overlay (no `liftMode`) → never mount a ghost → N/A. Diff isolated to the two files; no geometry constants, spawn math, lifted-overlay primitive, ghost-clone, source `TexBlockNodeView` pod, other-kind, or sync-logic changes. `npx tsc --noEmit` clean; `npm test -- --run` **278 pass / 0 fail**; zero console errors across the full gesture lifecycle. **L4 path:** if texBlock-specific tighter window padding is later wanted (the float now wears the uniform 32px chrome, looser than the source pod's in-doc feel), the proper generalization is a per-kind `meta.popoutChrome` slot in the spawn geometry (POPOUT_BODY_PADDING_X/Y per kind) — noted, not built now. Next: L3f (linkedRange). |
| 26 | L3-Headings — heading ghost + popout show the whole section | 372ba1c | The heading kind's deep revisit. L3a flipped `heading` onto lifted-overlay but the ghost cloned only the `<h*>` line (`anchorDom.cloneNode`) while a release-in-pod moves the WHOLE SECTION (`collectMoveSource`/`getSectionRangeByUuid` = heading + every block to the next equal-or-higher heading) — the ghost lied about what moves. Now the ghost shows the whole section, **clamped to the visible page**, and the released popout opens at the same clamped height. **Built as TWO kind-agnostic registry hooks, each replacing exactly ONE hardcoded assumption at the threshold-cross capture in `TextObjectGrabHandle` — NOT a `ref.kind === "heading"` switch** (the hooks ARE the generalization; L3f/linkedRange is their designed second consumer). **(1) `meta.renderGhost(anchorDom, editor, ref): HTMLElement | null`** (pre-designed in L3e, never needed until now) overrides the cloned content: `LiftedTextOverlay`'s clone useMemo (~166) becomes `const c = (ghostContent ?? anchorDom.cloneNode(true))`. Heading clones every section block's LIVE DOM (`sectionBlockDoms` = `view.nodeDOM` walked over `getSectionRangeByUuid(...).nodes` by `pos += node.nodeSize`) into a detached container; the overlay's existing sanitizer strips contenteditable/ids/state-attrs in place. **(2) `meta.liftSourceRect(anchorDom, editor, ref, cache): {left,top,width,height} | null`** (the `sourceRectOverride` the L3 §Critical-files anticipated) overrides the captured rect: `const liftRect = meta.liftSourceRect?.(…) ?? anchorDom.getBoundingClientRect()`. Heading keeps the heading line's left/top/width (the user grabbed the heading; the section ghost grows DOWN, so text top-left → grabOffset → L1.12 text-stays-still all hold) and clamps height to `min(sectionExtent, cache.scrollBottom − cache.scrollTop)`. **ONE capture site feeds both:** the (clamped) `sourceHeight` flows from `liftRect.height` into `liveOverlay` → both the ghost AND the `popOutAtRect` spawn, so the released popout opens clamped automatically. Both hooks resolved at the parent (where `editor`/`meta`/`ref`/`cacheRef` live) and threaded down as props (`ghostContent` element + the rect's w/h) — `LiftedTextOverlay` stays kind-agnostic (no registry import, no editor prop), exactly as L3a does for `label`. New `OverlayState.ghostContent: HTMLElement | null` (~333); new `LiftedTextOverlay` prop `ghostContent?` consumed in the clone useMemo (dep added). **`heading-body.tsx` UNCHANGED** — confirmed (lines 76–97, 191–212) it ALREADY builds `initial.doc`/`readSource` from `getSectionRangeByUuid(...).nodes` (full section) and is `overflow-auto`, so the clamped `sourceHeight` flowing into the spawn is all that's needed for the popout to open clamped + scroll; `collectMoveSource`/the drop spec/the section move untouched. **Shared view-level helper** `sectionBlockDoms(editor, uuid)` in NEW [src/lib/section-dom.ts](src/lib/section-dom.ts) (NOT the pure `section-range.ts`, which stays doc-only) — one section→DOM walk consumed by both hooks. **Lone-heading null fallback:** `sectionBlockDoms(...).length <= 1` → both hooks return null → default `anchorDom` clone + `getBoundingClientRect` (byte-identical to today; no empty-section regression). **CLONE-FIDELITY SURPRISE (measured, fixed generically):** the overlay root imposes the GRABBED HEADING's typography as the cascade base (L1.5/L3d.2); `.tiptap p` re-SIZES body prose but does NOT re-WEIGHT it, so a naive section clone rendered body paragraphs at the heading's weight 600 (bold). Fix lives in `renderGhost`, NOT as a per-block patch: the section container carries `class="tiptap"` (re-establishes content scope — same role the body's `.tiptap` plays for single-block ghosts, L3b.1 — so the cloned blocks get inter-block rhythm margins via `:where(.tiptap) > :where(…)`, and `:where(.tiptap) > :first-child` zeroes the heading's leading margin, matching `liftSourceRect`'s margin-excluding `headRect.top`) AND is reset to the EDITOR ROOT's base typography (`getComputedStyle(editor.view.dom)`: fontWeight/family/size/style/variant/letterSpacing/color/textTransform/etc., minus line-height per L3d.3) so each block's per-element rule (`.tiptap h2` heading, `.tiptap p` body) resolves exactly as in the source. Generic — any future multi-block ghost (L3f linkedRange spanning a heading + prose) inherits it. (Deviates from the brief's bare-`<div>` reference container; documented.) **Verified live** (fresh `.next-preview` after `rm -rf`, dev-doc refreshed from `samples/annotation-history`, real RAF-shimmed gesture driving the ACTUAL `LiftedTextOverlay`, viewport 1400×1400 → visible page = `scrollBottom 1400 − scrollTop 32 = 1368px`). **MODERATE — "The Marginal Gloss" (uuid 2200, sectionExtent 1160 < 1368):** ghost overlay **502×1160 = HUGS** the section bottom (not clamped), top/left 122/457 = heading top-left (text stays still); ghost body = **11 blocks** (heading-wrapper + paragraphs + blockquote + list + a react-renderer block + latex-comment), NOT just the `<h*>`; clone-fidelity ghost body `<p>` **15.2px / weight 400 / Lora** (NOT heading weight 600), ghost `<h2>` 21.6px/600 — body prose correct. Cross into manila (x 1150 > podRight 1032) → popout **568×1194** (= 502 + 2·32 padding + 2·1 border / 1160 + 32 + 2 → body content stays 502, no re-wrap), full chrome (1px border + white bg + shadow + opacity 1), header label **"Section"** (per-level `computeLabel` for `\section`), 11 blocks intact. Release in manila → real `heading-body` popout: **11 top-level blocks** (full section, firstText "The Marginal Gloss"), `overflow-auto`, body 1192 ≈ ghost-popout 1194 (no handoff jump), header "SECTION"; section hugged so it fit (scrollH == clientH). **Screenshots** of the moderate hug ghost + the released SECTION popout. **TALL — "Digital Remediation" (uuid 6600, sectionExtent 2285 > 1368):** ghost overlay **502×1368 = CLAMPED to the visible page** (not a 2285px giant), **15 blocks** incl. the folded-in `\subsection` "The Coda of Cowork"; body `clientHeight 1368 / scrollHeight 2316` → the section overflows the clamped body, clipped at the visible-page bottom (the design); multi-level fonts all correct: H2 21.6/600, **H3 "The Coda of Cowork" 18.4/600**, body 15.2/400. **Screenshot** of the clamped tall ghost (heading→down, cut at the viewport bottom). The released TALL popout therefore opens at 1368 and scrolls (`heading-body` `overflow-auto`; scrollH 2316 > clientH 1368) — evidenced by the ghost overflow + the moderate popout's overflow-auto render (the dedicated tall-popout scroll was not separately re-driven; see gating below). **Lone heading:** none in the sample (every section ≥ 3 blocks per the extent sweep); confirmed via the `doms.length <= 1 → null` code path. **No-regression (6-kind):** proven by `git diff` — the registry change is **70 pure insertions, 0 deletions, with `renderGhost`/`liftSourceRect` ONLY in the heading entry**; paragraph/bulletList/orderedList/exampleBlock/texBlock/linkedRange entries byte-identical, and the grab-handle/overlay use `?? default` fallbacks (kind without hooks → `liftRect = getBoundingClientRect`, `ghostContent = null` → single-block `anchorDom` clone = old behavior); additionally paragraph/list/texBlock/figure/exampleBlock all rendered faithfully WITHIN the section ghosts. The standalone single-block paragraph-ghost + texBlock-pod live spot-check could not be re-driven this session: clearing the preview browser's storage (to isolate the console warning below) wedged the dev-storage doc-open behind a multi-window Web-Lock claim race (StrictMode releases then re-claims; `claimDoc` `ifAvailable:true` loses it; the switcher had no recent-docs to re-open and a reload drops any `navigator.locks` patch) — an INDUCED dev-env state, unrelated to this change (the user's own browser storage is separate). **flushSync console warning is PRE-EXISTING, not from this change:** `grep flushSync src/` = no matches (a node_modules/TipTap-React call), and it fires purely on a persisted heading-body popout re-mounting with NO gesture; it vanishes when no popout is open. **READ-ONLY-preview gating → USER-VERIFY step** (the actual in-editor section MOVE can't run here — `pmEditable:false`, collab pen un-takeable headless, same gating every L3 row documents): in a writable session, drag a multi-paragraph section's heading and release between two blocks elsewhere — confirm the WHOLE section moves together (heading + body) and that the ghost you saw while dragging matched what moved. `npx tsc --noEmit` clean; `npm test -- --run` **278 pass / 0 fail**. Diff scoped to 5 files (4 modified + new `section-dom.ts`); pre-existing unrelated working-tree changes (`useRecentlyAddedTracker.ts`, root `*.html`) left untouched. Next: L3f (linkedRange) — the second consumer of BOTH hooks (range-extraction `renderGhost` + a multi-line/range bounding-box `liftSourceRect`). |
| 27 | L3-Headings.1 — fix lifted SECTION ghost vertical offset (Issue-1) | 58d8596 | Contained follow-up to L3-Headings: the lifted SECTION ghost rendered OFFSET DOWNWARD from the source — the cloned heading landed ≈28.8px below the grab point, so the user saw a vertical "double" (source + ghost) instead of the ghost glued to the grab point the way single-block ghosts (paragraph/list) are. **MEASURED, not prescribed** (faithful clone probe replicating `renderGhost` + the overlay body — real cloned DOM, real CSS cascade, the technique L3d/L3e established as bit-faithful; the dev preview itself drove the alignment screenshots): **offset = 28.8px**, carried by the cloned **`.heading-wrapper`'s OWN `margin-top: 1.8em`** (= 28.8px at the **16px** editor-root font-size the `renderGhost` container inherits via `getComputedStyle(editor.view.dom)`). **Root cause = the EXTRA nesting `renderGhost` introduces:** it mounts the section under a fresh `div.tiptap` container, so the section's first block is a GRANDCHILD of `.lifted-text-overlay__body` (`body > div.tiptap > .heading-wrapper`), NOT a direct child. The L3e.2 resets (`.lifted-text-overlay__body > *` and `> .react-renderer > *`, direct-child only) reach only the container (whose own `margin-top` is already 0), never the grandchild wrapper; and `:where(.tiptap) > :first-child { margin-top: 0 }` (0,1,0, globals.css:635) — which the L3-Headings author ASSUMED would zero the heading's leading margin — is in fact OUTRANKED on source order by `.heading-wrapper { margin-top: 1.8em }` (0,1,0, globals.css:729, later in the file), so the cloned wrapper keeps its 28.8px. That margin collapses up through the zero-margin container and is RETAINED inside the body's `overflow:hidden` BFC, pushing the whole cloned section (heading + body) down 28.8px = the "double." **Ruled out by measurement:** NOT the `.heading-annotation` chip (it sits BELOW the heading text in flow — DOM order is `<h*>` then chip, measured chip-top below h-top — so it never pushes the heading down), NOT `padding-top` (0px). **Fix (globals.css only, one rule, mirroring L3e.2 ONE LEVEL DEEPER):** `.lifted-text-overlay__body .tiptap > :first-child` (zero the `renderGhost` container's first block) + `.lifted-text-overlay__body .tiptap > .react-renderer:first-child > *` (the NodeView-wrapped-first-block arm — a future L3f range ghost opening on a texBlock/figure inherits it) + `.lifted-text-overlay__body .tiptap > :first-child > :where(h1,h2,h3,h4,h5,h6)` (zero the first block's leading `<h*>` margin). The third arm is load-bearing and was caught by re-measuring: zeroing only the wrapper left a **4.32px residual** — the `.heading-wrapper`'s inner heading carries its OWN `margin-top: 0.2em` (4.32px at 21.6px, from `.heading-wrapper h*`, globals.css:965) which, once the wrapper margin is gone, becomes the new leading margin and collapses up; zeroing it lands the heading line **pixel-exact at the body top (offset = 0)**, matching `liftSourceRect`'s margin-excluding `headRect.top`. Specificity (0,3,0) beats `.heading-wrapper` 1.8em (0,1,0) and the inner `.heading-wrapper h*` 0.2em (0,1,1) — no `!important`. The `> :first-child` scoping touches ONLY the first block, so blocks 2..n keep their rhythm (verified: 2nd block `margin-top` 19.2px, unchanged) and the heading's own `margin-bottom` (-2.16px, the gap to the next block) is preserved. **Re-measured from the real stylesheet: offset = 0.** **Single-block NO-REGRESSION (measured, not assumed):** paragraph ghost (par-title-wrapper) offset 0 (unchanged) AND a react-renderer block's inner margin 0 (unchanged), with `hasNestedTiptap = 0` for BOTH — the new rule REQUIRES a `.tiptap` DESCENDANT of the body, which exists ONLY inside the multi-block `renderGhost` container and never in a single-block direct-child clone, so the rule is a guaranteed no-op for paragraph/bulletList/orderedList/exampleBlock/texBlock. **Generic over the CLASS** (any multi-block ghost nested under the `renderGhost` container), so L3f's range ghost inherits it for free — not a `ref.kind === "heading"` special-case. **Screenshots:** corrected ghost heading glued to the source heading (Δ 0) vs the re-injected original bug (Δ 28.8). **Preview-recovery note (corrects the brief's hypothesis, for future sessions):** the dev-storage doc-open wedge was NOT the empty-tabs / `claimDoc` Web-Lock/StrictMode race the brief guessed — that was a symptom. The real cause: `detectDevStorage()` (src/lib/storage-mode.ts) returns `inIframe || !fsaAvailable`, and Claude Preview's headless Chromium loads the page as the TOP window (`window.self === window.top`) WITH `showDirectoryPicker` present, so `isDevStorage` was **false** → the app used the FSA backend (no picked folders) → `readTabs` returned empty → no doc. The module documents the opt-in: set `localStorage['virgil:force-dev-storage'] = '1'` then reload, and `doc_devtest` bootstraps cleanly — no storage clear, no source hacks needed. Diff isolated to globals.css (one rule + comment); pre-existing unrelated working-tree changes (`useRecentlyAddedTracker.ts`, root `*.html`) untouched. `npx tsc --noEmit` clean; `npm test -- --run` **278 pass / 0 fail**. Next: L3f (linkedRange) — the second consumer of `renderGhost`/`liftSourceRect`, now also inheriting this generic first-block reset. |
| 28 | FCU F0 — relocate editor-chrome NodeView builders to `editor-extensions.ts` (pure) | 6fb9b70 | Opens the **Float-Config Unification (FCU)** sub-arc (`/Users/gabriel/.claude/plans/fcu-plan.md`). PROBLEM (Issue 2): popped-out float editors render barer than the source because each float body hand-declares a divergent plain-StarterKit extension list, while the main editor's chrome (section number, label chip, fold chevron, list/paragraph titles) lived as inline `.extend()` NodeViews INSIDE the `VirgilEditor` component body in `Editor.tsx`. FIX is one shared factory consumed by main AND every float (Chips A/B/C); this is Chip A phase F0. Relocated the inline builders — `ParagraphWithTitle`, `createListTitleNodeView` + `Bullet/OrderedListWithTitle`, `ListItemWithUuid`, `BlockquoteWithUuid`, `CodeBlockWithUuid`, and `HeadingWithLabel` (incl. its `addProseMirrorPlugins()`: `sectionFoldingPlugin()` + the `sectionNumbers` numberer) — out of `Editor.tsx` into a NEW React-free module `src/lib/editor-extensions.ts` as parameterized builder FUNCTIONS. Closures → params: the four heading callback refs (`isLabelTakenRef`, `onConfirmLabelRenameRef`, `onConfirmHeadingDeleteRef`, `onOpenHeadingTypeMenuRef`) become a `HeadingCallbackRefs` arg (read via `refs.X?.current`); every other dep is a module-level import. The `useEditor` array stays inline and UNCHANGED in content + order — `Editor.tsx` just calls the builders with its existing refs. PURE: proven byte-identical against `HEAD` by a diff script (all six `.extend()` bodies verbatim; `createListTitleNodeView` == original dedented 2 spaces; `HeadingWithLabel` == original modulo the four `?.current` rewrites). `tsc` clean; vitest 278/0. Floats untouched (Chips B/C). Files: `src/lib/editor-extensions.ts` (new), `src/components/Editor.tsx`. |
| 29 | FCU F1 — `buildEditorExtensions(ctx)` factory; main editor consumes it | aa0ecca | Chip A phase F1: wrap the F0 builders into ONE shared factory, `buildEditorExtensions(ctx)` — the single source of the editor's extension stack, consumed by the main editor now and (FCU Chips B/C) by every popped-out float, so editor-appearance changes port to popouts automatically with no per-kind keying (the user's mandate). `EditorExtensionsCtx` threads `surface` / `editableRef` / `editable` / `cardContext` / `callbacks` / `docIdRef` / `texBlockIsPoppedRef` / `anchoredUuidsRef` / `host`. `VirgilEditor` now builds its stack via `buildEditorExtensions({ surface: "main", editableRef, cardContext: false, callbacks: {…existing heading + figure refs}, docIdRef, texBlockIsPoppedRef, anchoredUuidsRef, host: null })`; the inline array, per-builder consts, and inline `readOnlyEnforcer` are gone (dead extension imports pruned). `DocStructureObserver` is hard-coded at index 1 (keystroke-sanctity first-extension invariant). `readOnlyEnforcer` now reads `ctx.editableRef` (`editableRef.current === !readOnlyRef.current`) — identical behaviour. The `surface:"float"` branch is DEFINED but throws until Chips B/C — no float body touched here. BYTE-IDENTICAL MAIN is the gate: new vitest `src/lib/__tests__/editor-extensions.test.ts` asserts `buildEditorExtensions({surface:"main",…}).map(e=>e.name)` equals the exact pre-FCU 46-name order (independently transcribed) AND `result[1].name === "docStructureObserver"`; `tsc` clean; vitest 282/0 (278 + 4 new); dev-preview parity on a collab read-only doc — hierarchical section numbers (1/2/3/3.1/4/4.1…), fold chevrons, label chips, numbered toggles, +T affordances, 2 figures + 5 graphics (docId) all render; read-only correctly rejects edits via the factory's `readOnlyEnforcer`; `__virgilBusStats()` emitCount stays flat (16) while typing plain chars (applied via `ignoreReadOnly`; version 17→22→23, doc +5 then restored) — keystroke sanctity intact; no console errors. Floats migrate in Chips B/C (`fcu-plan.md`). Files: `src/lib/editor-extensions.ts`, `src/components/Editor.tsx`, `src/lib/__tests__/editor-extensions.test.ts`. |
| 30 | FCU F2 — heading float consumes the factory (faithful section popout) | 57fe650 | Chip B (delivers the reported **Issue 2**): a popped-out heading SECTION now faithfully + automatically mirrors the source — real section number + "Section ▾ / label" chip + divider — because it runs the SAME `createHeadingWithLabel` NodeView as the main editor instead of `heading-body.tsx`'s old divergent plain-StarterKit list. **The crux:** `sectionNumber`/`numbered`/`label` are real node attrs (`rendered:false`) that already ride into the float via `readSource` → `node.toJSON()` → `useFloatMainSync`; the float just lacked the NodeView to render them. **(1) `surface:"float"` factory branch** (replaced the F1 throw): rewrote `buildEditorExtensions` as ONE unified ordered array — `...(isMain ? [X] : [])` spreads omit the main-only chrome (`Placeholder`, `SlashPopupExtension`, `SmartQuotes`, `TextObjectOrphanGuard`, `TitleField`, `MaketitleMarker`, `LabelHandler`, `EmptyParagraphTitleCleaner`, `MarginaliaAnchorGuard`, `PgMarkChip`, `UuidAttrDecorator`, `readOnlyEnforcer`), the doc-wide `ExpexNumbering`, and `TextColor` (→ Chip C). Single source of truth ⇒ the two surfaces can't drift; main stays byte-identical (the F1 name-order test is unchanged). Float threads `cardContext: ctx.cardContext` (= true) into `TexBlock`/`FigureBlock`/`GraphicsBlock` (their cardContext previews ignore `docId`, so `docIdRef: null` is faithful) and `dropcursor:false`; `DocStructureObserver` stays at index 1. **(2) `createHeadingWithLabel(refs, opts?: {surface, host})`** — float mode: omits `sectionFoldingPlugin()` + the `sectionNumbers` numberer in `addProseMirrorPlugins()` (running the numberer would renumber the lone section to "1", clobbering the synced number), hides the fold chevron (`foldBtn`/`onTransaction` now nullable; `stopEvent`/`ignoreMutation`/`destroy` guard them), gates off demote-to-paragraph + delete (omits the × button + `if (isFloat) return` in both handlers — they'd dissolve the float's subject), and routes the **label-rename (+ the labelRef rewrite walk)**, **toggle-numbered**, and **change-level** writes through `getTarget()` = `host.getMainEditor() ?? nodeEditor` (= MAIN), resolving the heading there by **uuid** (`resolveHeadingInTarget`, since the float's `getPos()` points into the float doc) and walking the WHOLE main doc for refs. Main mode (`{surface:"main"}` or no opts) is unchanged — `target === nodeEditor`, `getPos`-resolved, identical transactions. **No echo loop:** writes hit MAIN, so the float's own `onUpdate`/`writeBackToMain` never fires and `useFloatMainSync`'s `setContent(…,{emitUpdate:false})` re-reads idempotently (FLOAT_WRITE_META intentionally NOT set — we WANT the re-sync). **(3) `EditorHandle`** gains `isLabelTaken` / `onConfirmLabelRename` / `onConfirmHeadingDelete` (impl proxies to the existing `*Ref.current` prop mirrors; defaults match the NodeView's no-prop assumptions) so the float reads the SAME callbacks main uses (decision 1). **(4) `heading-body.tsx`** swaps its plain-StarterKit `useEditor({extensions:[…]})` for `buildEditorExtensions({surface:"float", editable:chrome.showHeadingFloatLabelEdit, cardContext:true, callbacks:{…proxied via refs off `editorRef.current`}, docIdRef:null, host:{getMainEditor:()=>ref.current?.getEditor()??null}})`; keeps the `readSource`/`writeBackToMain`/`useFloatMainSync` seam + `setHeaderLabel`. The chrome NodeView coexists with the `.par-float-body px-8 py-4` wrapper with no double padding (the float's `.tiptap` carries no page-padding class; the section-number `::before` + annotation are `.tiptap`-scoped and apply unchanged). `tsc` clean; vitest **285/0** (replaced the throws-test with 4 float-branch tests: float name-order omits every main-only name + `ExpexNumbering` + `TextColor`, observer@1, and a jsdom mini-editor mount asserts the float heading registers NO `sectionNumbers`/`sectionFolding` plugin while main does). **Dev-preview evidence** (collab read-only doc; main temporarily made editable by dropping its `readOnlyEnforcer` plugin + `setEditable(true)` to exercise the write-proxy): popped "The Birth of the Footnote" shows its real number **"3"** (NOT "1") + "Section ▾ · # · label: sec:footnote" chip + divider identical to source, **0** fold chevrons, **0** delete ×; renaming the label `sec:footnote`→`sec:footnote-x` in the popout rewrote BOTH the main heading chip AND a live `\ref` that sits in section 6 (OUTSIDE the popped section) to the new label with `displayText` still "3" — proving the rewrite ran against MAIN's whole doc, not the float's slice; toggling `#` in the float flipped `numbered` on the main heading, renumbered the main doc (`sec:citation` 4→3) + updated the `\ref` (3→"??") + re-synced the float, fully reversible; `main`↔`float` body edits mirror both ways with no echo/dup; a lone heading (no body) pops cleanly as section **7**; main numbering intact (Chip A parity); `__virgilBusStats()` emitCount flat on plain main typing (keystroke sanctity); no console errors. TextColor fidelity for popped colored text closes in Chip C (decision 4); paragraph/list/example bodies migrate in Chip C. Files: `src/lib/editor-extensions.ts`, `src/components/Editor.tsx`, `src/text-objects/floats/heading-body.tsx`, `src/lib/__tests__/editor-extensions.test.ts`. |
| 31 | FCU C1 — paragraph float consumes the factory; `TextColor` → shared; unify title on the inline `+T` (retire `FloatTitleField`) | 09e1abd + 4c211be | Chip C1 (phase F3, **part 1 — paragraph only**; list/example are C2). Two commits. **(C1a — `09e1abd`) `TextColor` → shared core:** moved `TextColor` out of its `...(isMain ? [TextColor] : [])` spread to the shared position (after `Highlight`, before the inline atoms) in `buildEditorExtensions`, so colored text now renders in popouts — the exact Issue-2 fidelity class. Main order byte-identical (`TextColor` already sat there); tests: `EXPECTED_MAIN_ORDER` unchanged, `EXPECTED_FLOAT_ORDER` GAINS `textColor`, dropped from `MAIN_ONLY_NAMES`, added a dedicated "float INCLUDES textColor" assertion (suite 285→286). **(C1 — `4c211be`) the title-unify mechanism. (1) `createParagraphWithTitle(opts?: {surface, host})`** mirrors Chip B's heading builder — in float mode the inline `+T` `setTitle` PROXIES its `parTitle` `setNodeMarkup` to `host.getMainEditor() ?? nodeEditor` (= MAIN), resolving the paragraph there by **uuid** (the float's paragraph carries the synced uuid); the float's own `onUpdate` never fires, so `useFloatMainSync` re-reads idempotently (no echo; `FLOAT_WRITE_META` intentionally unset — we WANT the re-sync). Main mode (`{surface:"main"}`/default) is byte-identical (`getPos`-resolved, identical tr; `EXPECTED_MAIN_ORDER` stays green). The factory wires the paragraph call surface-aware (`isFloat ? {surface:"float", host} : {surface:"main"}`), exactly like the heading call. **(2) `paragraph-body.tsx`** swaps its hand-rolled plain-StarterKit `useEditor` list for `buildEditorExtensions({surface:"float", editable:chrome.showParagraphFloatTitleEdit, cardContext:true, callbacks:{…proxied off `editorRef.current` as Chip B}, docIdRef:null, host:{getMainEditor:()=>ref.current?.getEditor()??null}})`, so the SAME inline `ParagraphWithTitle` NodeView that draws titles in main now draws them in the float. **(3) full-node sync:** `initial` + `readSource` now carry the FULL paragraph node (`node.toJSON()`, attrs incl. `parTitle` + `uuid`) instead of content-only, so the inline `+T` reads the title; `writeBackToMain` rebuilds the paragraph from MAIN's own `found.attrs` (which include `parTitle`), so a body-content write never clobbers the title (and the title write goes straight to main + syncs back — one source of truth at the sync seam). **(4) retired** `FloatTitleField` + the `title`/`editingTitle` state + `commitTitle` + `initial.title`; the body is now just `.par-float-body > EditorContent` (dropped its own `.par-title-wrapper`/title row) — the NodeView owns the one and only title affordance. `FloatTitleField` is KEPT (`tex-block-body` still uses it; migrates in C2). `tsc` clean; vitest **286/0**; the 5 pre-existing `no-explicit-any` lint errors live in `createListTitleNodeView`/list builders (untouched — C2 territory; confirmed identical pre-C1). **Dev-preview evidence** (annotation-history dev doc, editable): popped untitled paragraph `1101` showed exactly ONE inline `+T` (`titleWrappers`=`titleAnnotations`=1, no duplicate, `tiptapInside`=1); adding "Provenance of the gloss" via the `+T` round-tripped to MAIN's `1101.parTitle`; editing it ("…(rev.)") prefilled from the synced attr + round-tripped to main; MAIN↔FLOAT body edits mirrored BOTH ways (`[MAIN-EDIT]`/`[FLOAT-EDIT]` markers) with the title PRESERVED on both sides (full-node sync in + attr-preserving writeback out); popped paragraph `1103` rendered "in red ink" as `rgb(192,57,43)` = `#C0392B` (TextColor now shared — would have been black pre-C1a); 6 plain mid-paragraph inserts left `__virgilBusStats().emitCount` flat at 20 (version +6) — keystroke sanctity intact; NO double padding (`.tiptap` / `.par-title-wrapper` / `.par-body-container` all `0` padding+margin, the body's single `px-8 py-4` is the only padding, wrapper is a direct child of `.tiptap` with `margin-top:0` via the `:first-child` rule). Screenshot: titled float (single red title row) above colored float ("in red ink" red) — both faithful. Files: `src/lib/editor-extensions.ts`, `src/text-objects/floats/paragraph-body.tsx`, `src/lib/__tests__/editor-extensions.test.ts`. |
| 32 | FCU C2 — list + example floats consume the factory (**FCU COMPLETE**) | 63394d4 | Chip C2 (phase F3, **part 2 — the FINAL FCU chip**): migrates the last two prose float bodies — `list-body` + `example-block-body` — onto `buildEditorExtensions({surface:"float"})`, so **all four prose popouts (paragraph / heading / list / example) now render through the SAME factory as the main editor** — editor-appearance changes port to popouts automatically with zero per-kind keying (the user's mandate, fully delivered). Manager-verified head start: BOTH bodies already synced the full node via `src.node.toJSON()` (attrs incl. `number`/`subLabel`/`parTitle`/`uuid`), and neither used `FloatTitleField` — so NO C1-style sync change was needed; the work was the extension-list swap + the list-title float mode + the example-number confirmation. **(1) List-title float mode.** `createListTitleNodeView(tagName, typeName, opts?: ListSurfaceOpts {surface, host})` mirrors C1's paragraph builder + Chip B's heading builder — in float mode the inline `+T` `setTitle` PROXIES its `parTitle` `setNodeMarkup` to `host.getMainEditor() ?? nodeEditor` (= MAIN), resolving the list there by **uuid** (`nd.type.name === typeName && nd.attrs.uuid === uuid`, the float's list carries the synced uuid); the float's own `onUpdate` never fires, so `useFloatMainSync` re-reads idempotently (no echo; `FLOAT_WRITE_META` intentionally unset). Main mode (`{surface:"main"}`/default) is byte-identical (`getPos`-resolved, identical tr). `createBullet/OrderedListWithTitle(opts?)` thread `opts` down; the factory wires both list calls surface-aware (`isFloat ? {surface:"float", host} : {surface:"main"}`), exactly like the paragraph/heading calls. **The 5 pre-existing `no-explicit-any` lint errors** (all in `createListTitleNodeView`: the destructured `node`/`editor` props + `stopEvent`/`ignoreMutation`/`update` param types) are FIXED by typing the builder's return as `NodeViewRenderer` (from `@tiptap/core`) — the props AND the returned `NodeView` methods then get contextual types; **0 errors now** (2 unrelated `react-hooks/exhaustive-deps` *warnings* on the bodies' `initial` useMemo are pre-existing on HEAD, untouched). **(2) `list-body.tsx`** swaps its plain-StarterKit `useEditor` list for `buildEditorExtensions({surface:"float", editable:true, cardContext:true, callbacks:{…proxied off `editorRef.current` as Chips B/C1}, docIdRef:null, host:{getMainEditor:()=>ref.current?.getEditor()??null}})`, so the SAME `createListTitleNodeView` that draws list chrome in main draws it in the float; keeps `setHeaderLabel`/`findListByUuid`/`writeBackToMain`/`readSource`/`useFloatMainSync`. **(3) `example-block-body.tsx`** same swap (examples carry no title; host threaded for parity). **CRITICAL — example number via synced attr, NOT recomputed:** the float OMITS the doc-wide `ExpexNumbering` (symmetric with the heading float omitting `sectionNumbers`), and the `ExampleBlock`/`ExampleItem` NodeViews render the number + sub-labels DIRECTLY from `node.attrs.number` / `node.attrs.subLabel` via `textContent` (with attr-reading `update()` paths) — the exact `sectionNumber` mechanism — so a popped example shows its REAL `(N)`, never recomputed to `(1)`. **Dev-preview evidence** (annotation-history dev doc, editable): popped **bullet** `2205` → `.list-title-wrapper` + hover `+T` + `disc` markers + 3 items; popped **ordered** `6603` → `+T` + `decimal` markers + 6 items; popped **example ee02** (`\pex`, multi) → **`(2)` NOT `(1)`** (the headline check) + sub-item letters `a./b./c./d.` + nested `i./ii./iii.` (the `xlist`) + faithful `ex.` markers + `label:ex:reader-types` chip. Title round-trip: clicking the ordered float's `+T` and committing wrote `parTitle="Taxonomy of digital marks"` straight to MAIN's list `6603`, then `useFloatMainSync` re-rendered it in the float as exactly ONE title (no dup, `+T` replaced). Colored text: `setTextColor('#C0392B')` on the first ordered item in MAIN rendered `rgb(192,57,43)` in BOTH main and float (TextColor shared-core + main→float sync through the new stack). Edit mirroring BOTH ways: a `[FLOATEDIT]` insert in the ordered float round-tripped to MAIN's list via `writeBackToMain`/`onUpdate` (appears once — no echo). Main numbering intact after popping (examples `(1)/(2)/(3)`; sections `1/2/3/3.1/4/4.1/5/6/6.1/6.1.1`). Keystroke sanctity: 10 plain-char inserts left `__virgilBusStats().emitCount` flat at 16 (version +10) — observer still at index 1, emitting nothing structural. `tsc` clean; vitest **286/0** (`EXPECTED_MAIN_ORDER` `toEqual` unchanged ⇒ main byte-identical; `EXPECTED_FLOAT_ORDER` already covers `bulletList`/`orderedList`/`exampleBlock` present + `expexNumbering` omitted, so no redundant test added); no console errors. **FCU is COMPLETE** — every prose popout now renders through `buildEditorExtensions` (`fcu-plan.md`). Out of FCU by decision: `texBlock` = CodeMirror (folded into L3e), `linkedRange` = OUT (folded into L3f). The remaining lifted-overlay arc returns to **L3f (linkedRange, the designed second consumer of `renderGhost` + `liftSourceRect`) → the bodyless kinds → L4**. Files: `src/lib/editor-extensions.ts`, `src/text-objects/floats/list-body.tsx`, `src/text-objects/floats/example-block-body.tsx`. |
| 33 | L3-Headings.1-REAL — the section ghost offset is the divider margin, NOT the chevron (real Issue-1 fix; corrects 58d8596 + the chevron re-diagnosis) | bdfd81f | **Corrects the record on Issue-1 (the lifted SECTION ghost's vertical "double").** Two prior passes mis-attributed it: (a) **58d8596** chased the cloned `.heading-wrapper`'s base `margin-top: 1.8em` (28.8px) and "fixed" it with `.lifted-text-overlay__body .tiptap > :first-child { margin-top: 0 }` (+ `.react-renderer` / inner-`<h*>` arms) — but it **VERIFIED VIA A CLONE-HARNESS** (a probe replicating `renderGhost` + the overlay body) that had **no `.show-dividers-N` ancestor**, so it measured a **false Δ0**; (b) a later re-diagnosis blamed the **fold chevron** falling into flow (claimed its `position:absolute` was `.ProseMirror`-scoped and leaked into the `.tiptap` clone as a 28.8px in-flow first child). **Both are WRONG on current HEAD — MEASURED by driving the REAL mousedown→threshold gesture (live dev preview, real grab-handle drag past the 5px `LIFT_THRESHOLD`, no harness):** dragging the l2 heading "The Marginal Gloss", the mounted ghost reads `ghostHeadingMinusBodyTop = 67.2`, `wMarginTop = 67.2px`, and `getComputedStyle(chevron).position = absolute` — the chevron is **OUT of flow** (its bare `.heading-fold-chevron { position: absolute }` has reached the `.tiptap` ghost since the section-folding feature `7a48698`; it was **never** `.ProseMirror`-scoped in this codebase, so the chevron re-diagnosis's premise never held — hiding it cannot move the heading). **REAL root cause:** with section dividers on (`show-dividers-2` on the editor, inherited by the portaled overlay), the cloned `.heading-wrapper-l2` inherits `.show-dividers-2 .tiptap .heading-wrapper-l2 { margin-top: 4.2em }` (= 67.2px; 8.2em / 6.6em for l0 / l1) at `globals.css ~3482`. That selector **ties 58d8596's reset on specificity (both 0,3,0) but wins on SOURCE ORDER** (it sits far later in the file), so the reset can't zero it and the heading is pushed down by the full divider margin. 58d8596's "28.8" was simply the **dividers-OFF base** 1.8em (which 58d8596 DOES beat, 0,3,0 > 0,1,0) — its harness never rendered the divider context. **Fix (globals.css only, `bdfd81f`):** `.lifted-text-overlay__body .tiptap > :first-child { margin-top: 0 !important }` — `!important` makes the first-block reset win over **every** divider level / width generically, without chasing each `.heading-wrapper-lN` margin (precedent: the `.tiptap li` resets at ~1655). **58d8596's reset is KEPT** (it still zeros the dividers-OFF base margin and the `.react-renderer` / inner-`<h*>` arms). The divider `::before` LINE (`top: -1.4em`, painted in the now-zeroed margin) needs no suppression — it sits above the body's content top and is clipped by the body's `overflow: hidden` BFC. Also added `.lifted-text-overlay__body .heading-fold-chevron { display: none }` as a **faithfulness / future-proofing** measure (inert fold chrome in a static drag ghost; the un-hovered source hides it too — `opacity:0` + absolute) — NOT the offset fix. Generic over the class — any divider level, any future multi-block ghost whose first block is a divider-bearing heading — so **L3f's range ghost inherits it**. **Verified on the REAL gesture (the whole point):** section ghost `ghostHeadingMinusBodyTop` **67.2 → 0.0** (heading glued to body top; `wMarginTop` 67.2 → 0px; chevron `display:none`; heading text "The Marginal Gloss" + the `.heading-annotation` chip still render), cross-checked on a re-run; screenshot shows the glued ghost with no vertical double. **No-regression:** paragraph ghost still glues (offset 0.0; first block `par-title-wrapper`; unaffected — it has no nested `.tiptap`, so the new `!important` arm is a guaranteed no-op). Doc integrity after the gesture: heading still in place (1 "Marginal Gloss", 10 headings, 43 paragraphs), no stray popout float, no console errors. **LESSON (record-correcting):** a ghost / dimensional fix MUST be verified by driving the REAL mounted gesture in the live editor — a replicated clone-harness omits the live ancestor context (here `.show-dividers-N`) and the live editor chrome (the chevron NodeView), so it can report a false Δ0 AND mis-attribute the cause; never declare victory from CSS reasoning or a harness. Diff isolated to globals.css; pre-existing unrelated working-tree change (`useRecentlyAddedTracker.ts`) untouched. |
| 34 | Issue-3 — released heading popout reserved divider-like space but drew no line (float-scoped first-block reset) | 95a593a | **The FCU-migrated released popout (the real section float, `buildEditorExtensions(surface:"float")`) showed an empty band above the heading "as if a divider were there, but no line."** MEASURED on the REAL popout (cross-checked, NOT a harness — the exact trap that gave 58d8596 its false Δ0): popped "The Marginal Gloss" (uuid 2200, l2) headlessly via the popped-cards `popOutAtRect` (no grab gesture), at `show-dividers-2`, every eval carrying a source-`marginTop`==67.2px cross-check. **Cause is NOT the prompt's `:first-child`-guard hypothesis** (no such guard exists in the divider block 3522-3600; the main editor never draws a divider above its first block simply because the doc's first child is the `title-field-wrapper`, never a heading). The float is portaled to a **top-level `position: fixed` layer — a SIBLING of the editor-pane column that carries `.show-dividers-N`** — so NO divider rule reaches it (verified: **no `.show-dividers` ancestor**; float wrapper `margin-top` read **28.8px, NOT 67.2px**; divider `::before` `content: none` → **no line ever generated**). So the band was NOT divider space — it was two un-zeroed leading margins that the float body's `overflow: auto` BFC **retains** instead of collapsing away: (1) the first block's BASE `.heading-wrapper { margin-top: 1.8em }` (28.8px), which TIES `:where(.tiptap) > :first-child { margin-top: 0 }` (both 0,1,0) and wins on source order; (2) once (1) is zeroed, the inner heading's own `.heading-wrapper h* { margin-top: 0.2em }` (4.32px at the h2's 21.6px) collapses up through the now margin/padding/border-less wrapper and becomes the new leading residual — the same 4.32px the ghost's arm-3 zeroes (1456-1459). **FIX (float-scoped, parallel to the ghost reset 1468-1472/1498):** `.par-float-body .tiptap > :first-child, .par-float-body .tiptap > :first-child > :where(h1,h2,h3,h4,h5,h6) { margin-top: 0 !important }` — zeroes BOTH so the heading sits **pixel-flush**, matching the drag ghost (no 4.32px jump on release). `> :first-child` leaves blocks 2..n alone (rhythm + heading `margin-bottom` preserved); generic across heading levels; arm 1 a benign no-op for non-heading float kinds (already zeroed by 635). `!important` mirrors the ghost — beats the base margins now and the 4.2em divider margin too were the float ever re-parented under dividers. **No `::before { display: none }` added**: there is no phantom line (float outside `.show-dividers-N`), and a blanket suppression would hide the empty-paragraph placeholder `::before` in editable float kinds. **VERIFIED on the real released popout** (preview restarted `rm -rf .next-preview` to beat the documented stale-CSS; 2-arm rule confirmed in `document.styleSheets`): wrapper `margin-top` 28.8px→**0px**, inner-h `margin-top` 4.32px→**0px**, body-top gap →**0px**, `::before` `content:none`, heading text + "Section" annotation chip + all 11 section blocks render; screenshot shows the heading flush with no band. **NO-REGRESSION (main editor):** mid-doc l2 section unchanged — wrapper 67.2px + inner-h 4.32px + 2px `#a8a29a` divider line all intact; first child (`title-field-wrapper`) still flush at 0. The `:where(h1..h6)` arm is float-scoped and did NOT touch main-editor inner-heading margins. Ghost fix bdfd81f untouched; diff isolated to globals.css; `useRecentlyAddedTracker.ts` left alone. |
| 35 | Issue-4 — figures/images render as a compact `Figure: …` chip in the section popout (not the image) | 446e022 | Reported on the released section popout: figures/graphics drew a compact `Figure: <caption…>` pill instead of the actual image. **Two load-bearing causes:** (A) `FigureBlockNodeView`'s `cardContext` branch (`FigureCardPreview`) only ever drew the pill; (B) every block-bearing float body hard-coded `docIdRef: null` in its `buildEditorExtensions` ctx — the factory already wires `docIdRef` into FigureBlock/GraphicsBlock, it was just fed `null` (the bodies' own comment deferred it: "Chip C can thread the real id if full in-float figure rendering is ever wanted"). **Mechanism:** kept `cardContext: true` rather than flipping it off — `FigureFullView`'s editable chrome (width scaler / picker / delete / annotation lozenge / click-to-edit popover) only self-hides under `.ProseMirror[data-editable="false"]`, which floats don't set, so flipping the flag would leak editable chrome into a view surface. Instead `FigureCardPreview` renders a **read-only image** reusing `FigurePanel` (the same resolver / `<img>` the main editor uses) under the same `figure-block` classes — figureBlock -> `figure-block-wrapped` + a static caption span, graphicsBlock -> `figure-block-bare` — falling back to the original pill when there's no resolvable source (un-filled stub) or no docId. heading/list/example float bodies thread the real docId via `useDocWriteHandleOrNull()?.docId ?? null` (the canonical in-pipeline source — the same handle `useDocument` reads; the OrNull variant degrades to the pill instead of throwing if a float ever mounts outside a `DocPipeline`). `paragraph-body` stays `docIdRef: null` (no block figures); `texBlock`/`displayMath` + main editor untouched (main passes `cardContext: false`). **Verified** on two real popped sections in the dev preview (every probe cross-checked with agreeing re-runs + a rendered screenshot — the tool channel was fabricating outputs this session). "The Birth of the Footnote" (figureBlock + caption path): the float renders 1 `.figure-block-card-image.figure-block-wrapped` / 1 `img.figure-image`, **0** `.figure-block-card-preview` pills, 0 `.figure-error`, 1 caption; image loads via blob URL (figures/page-anatomy, naturalWidth 1000×720, `complete`, panel max-width 62%); the caption span renders "The anatomy of a glossed page: a central text column flanked by margin glosses, with an interlinear gloss above the main line and a footnote band below the rule." — the exact bug-chip text. "The Marginal Gloss" (graphicsBlock path): 1 `.figure-block-card-image.figure-block-bare` / 1 `img.figure-image` (figures/manicule, 360×360 blob, `complete`, panel 16%, no caption), 0 pills, 0 errors. Across both: section prose intact, a live `console.error` counter stayed at 0, and closing each float left the main doc unmutated (childCount 66 before pop and after close); main editor unchanged (4 `img.figure-image`, 0 pills, 0 card-images). typecheck 0 errors; eslint 0 errors (pre-existing warnings only). |
| 36 | Issue-5 — "section popout not scrollable until you resize" — **NOT REPRODUCED on HEAD** (released popout scrolls on mount) | — (no code change) | Reported symptom: a tall popped SECTION can't be scrolled until a window resize "fixes" it (suspected sizing-on-mount race / body `overflow` not engaged). **MEASURED on the REAL released popout AND the REAL lift gesture — symptom does NOT reproduce; the body is scrollable immediately on mount in every configuration tested.** Cross-checked throughout (every eval carried an arithmetic xcheck; this session the tool channel fabricated outputs AND a cached popped-cards ctx handle silently lied — `poppedKeys` reported `[3300]` while the DOM had 0 panels — fixed by re-DFS'ing a FRESH context value on every mutation, since the provider recreates the value object each render). **(a) REAL gesture** (dev-doc section "Digital Remediation" uuid 6600, extent **2767** > visible page): grab handle revealed via a RAF→setTimeout shim (discovery is RAF-gated; the backgrounded preview throttles RAF so synthetic hover alone never rendered it), then drove mousedown→5px threshold→manila(popout)→release; the released `heading-body` float body `clientHeight 969 < scrollHeight 2657`, `overflow-y: auto` → **scrollable, no resize**. **(b) Headless `popOutAtRect`** (the same faithful released-float path Issue-3/Issue-4 used) at clamp 900 and at clamp 1160 (float **1218 > viewport 1200**): `clientH 932 / 1192 < scrollH 2657`, programmatic `scrollTop=300` sticks; topmost element at body center is a `<p>` inside the body (no capturing overlay). **(c) EDITABLE float** (`contenteditable="true"` — the user's writable condition; also forced `setEditable(true)` via fiber): identical, still scrollable. **Why it can't reproduce (root-cause analysis):** (1) `.par-float-body` is `flex-1 overflow-auto`; per Flexbox the automatic minimum size of a scroll-container flex item (overflow≠visible) resolves to **0**, so the body shrinks to its flex share and `overflow-auto` engages — `min-height:auto` does NOT force expansion (measured: body computed `min-height: auto` yet `height` constrained to 1192 in a 1218 panel). (2) `liftSourceRect` clamps height to `min(sectionExtent, cache.scrollBottom − cache.scrollTop)`; the live `findScrollParent` resolves the editor PANE (visiblePage **1168**, NOT the unclipped `.ProseMirror` 11402), so the clamp is real (1168 < 2767) → the float opens SHORTER than its content → scrollable. (3) `popOutAtRect` calls `setCardFloatPosition` then `toggleCardPopout` back-to-back → React 18 batches them into ONE render (even from the window `mouseup` listener), so `getFloatPosition` returns the spawn rect on the SAME render `isPopped` flips → no DEFAULT-size race; `FloatingPanel`'s root carries an explicit pixel height from frame 1. **Decision:** no fix committed — there is no reproducible symptom to verify a fix against, and the L3-Headings.1-REAL lesson is explicit that a fix must be verified by driving the REAL thing (never declare a fix you can't show eliminates the symptom). Did NOT add the obvious `min-h-0` to `.par-float-body`: it is a verified **no-op** here (`overflow-auto` already zeroes the flex auto-min — confirmed by the constrained body height). Most likely environment-specific to the user's real app/browser, or already resolved by the FCU heading-body migration (`57fe650`, which put the body onto the standard `.par-float-body flex-1 overflow-auto`). **USER diagnostic** (run when next stuck, then we fix the REAL cause): `const b=document.querySelector('.heading-float-body'); JSON.stringify({clientH:b.clientHeight, scrollH:b.scrollHeight, overflowY:getComputedStyle(b).overflowY, minH:getComputedStyle(b).minHeight, panelH:Math.round(b.closest('[data-floating-panel]').getBoundingClientRect().height), vh:innerHeight})` — if `clientH ≈ scrollH` for a tall section the float opened taller than its content (a capture-height/clamp issue, distinct from "overflow not engaged"); if `clientH < scrollH` yet the wheel won't scroll it's an event-capture/overlay issue. No diff; `useRecentlyAddedTracker.ts` left untouched. |
| 37 | Issue-6 — popout header label shifts ~1px right on release (GENERAL, all kinds; shared header) | 0949269 | The popout header label (`PARAGRAPH`/`SECTION`/…) jumped ~1px right when the lift gesture released into the real float. Label CONTENT is shared (`FloatHeaderContent`, L3d.1) but the two header OUTER containers differ — overlay = JS-positioned portal sibling; released = `TextObjectFloat`/`FloatCard` flex row. **MEASURED on the REAL gesture (cross-checked):** drove a real mousedown→threshold→manila→release on dev-doc section 6600 AND paragraph 9525 (handle revealed via the RAF→setTimeout shim, as Issue-5). Overlay popout-mode label `.left` **1133** vs released float label `.left` **1134** = **+1px right**; body text content identical in both (**1158**), so the drift was purely the header container — L1.12 text-stays-still held. **Root cause:** the overlay header was positioned `headerLeft = overlayLeft − 1`, `headerWidth = overlayWidth + 2` (mis-cited as "border overlap"). Under `box-sizing: border-box` + 1px `--pod-border`, that put the overlay header's CONTENT origin at `overlayLeft + 8(padding)`; the released float header is a flex row INSIDE the FloatCard's 1px border, so its label lands at `cardLeft + 1(border) + 8(padding)`, and `cardLeft == overlayLeft` (both `= textX − BODY_PADDING_X − POPOUT_BORDER`) → the overlay label sat 1px LEFT of the float's. The `−1/+2` was an off-by-one; the released float is the persistent truth. **Fix ([src/text-objects/LiftedTextOverlay.tsx](src/text-objects/LiftedTextOverlay.tsx), 1 file):** `headerLeft = overlayLeft`, `headerWidth = overlayWidth` — the overlay header's border-box now coincides EXACTLY with the overlay's (borders collinear, "one continuous box" achieved correctly) and its content box matches the released float's, so the shared label lands at the SAME x at handoff. Generic across all lifted kinds (the header is shared). **Verified live on the REAL gesture** (fresh chunks after reload, RAF-shimmed, cross-checked re-runs): label-relative-to-text shift on release = **0** for SECTION (overlay & float label both **1134**, text both **1158**) and PARAGRAPH (label 1133.8→1134, text 1157.8→1158 — the 0.2 is the float's own sub-pixel `Math.round` spawn offset, equal for label AND text, so NO relative shift); the chevron + X also align now (header width == float card content width); overlay torn down clean; screenshot of the released "PARAGRAPH" popout confirms the corrected header. `npx tsc --noEmit` clean. Diff isolated to `LiftedTextOverlay.tsx` (the `headerLeft`/`headerWidth` pair + its comment); `useRecentlyAddedTracker.ts` untouched. |
| 38 | Issue-7 — brief figure-stub flicker on popout release (released float re-resolved the image fresh; the stub is the pending placeholder, not the pill) | 60b3150 | The released section popout flashed the figure's pending stub before the real image: the lifted GHOST (a `cloneNode` of the live source DOM) already carries the main editor's resolved `<img>`, but the freshly-mounted float spun up a NEW `FigureCardPreview` → `FigurePanel` → `useResolvedFigureUrl` that re-resolved the image FROM SCRATCH (no shared in-memory blob cache), so the float painted a stub during the async storage round-trip (in dev: `readFigureSource` fetch + sha1 + `readFigureRaster` fetch + `createObjectURL`), then swapped to the image. **MEASURED on the REAL released popout (cross-checked, NOT a harness — the prior session's tool channel fabricated outputs, and timer sampling THROTTLES in the backgrounded preview):** sampled the float's figure subtree with a throttle-immune `MutationObserver` (a `setTimeout` sampler only caught the post-throttle ~1s tick, useless for an ~80ms transition), re-DFS'ing a FRESH popped-cards ctx every eval (the provider recreates its value object each render — the Issue-5 staleness trap), real serverId from `preview_list`, reaching the live editor via `document.querySelector('.ProseMirror').editor` (the `.editor` expando; `.ProseMirror` itself has no React fiber — its PARENT does, so the ctx DFS walks up to the nearest fiber-bearing ancestor). **The pending stub is the `.figure-placeholder` "Loading <path>…" (`load1`), NOT the `Figure:` pill (`pill0` THROUGHOUT)** — `FigureCardPreview` only draws the pill when `!path || !docId`, and the float threads a real docId from frame 1, so that branch never fires; the prompt's "pill during pending" sub-hypothesis is FALSIFIED, the real flash is FigurePanel's `loading` status. BEFORE (thrice across "The Birth of the Footnote" figureBlock+caption page-anatomy AND "The Marginal Gloss" graphicsBlock manicule): `no-body → wrap1\|load1\|none (placeholder ~20–85ms) → wrap1\|img:inc → img:C`. **Fix (the preferred shared-blob-cache path, transparent to main — [src/hooks/useResolvedFigureUrl.ts](src/hooks/useResolvedFigureUrl.ts), 1 file):** a module-level `rasterCache: Map<docId\0source, {blob, cacheKey}>`. The first instance to resolve a figure (the MAIN editor on doc load) PUBLISHES the decoded raster `Blob`; a later-mounting consumer (the popped float's read-only `FigurePanel`) ADOPTS it SYNCHRONOUSLY in a `useLayoutEffect` (pre-paint — `setUrl` + `status:"ready"` commit BEFORE the browser paints), so the float's FIRST PAINTED FRAME already carries the `<img>`, never the placeholder. The async path still runs to RE-VALIDATE the source fingerprint (`sha1(source:fingerprint)`): if the adopted key still matches it keeps the painted image (no re-decode); else it re-resolves (on-disk raster cache → rasterize) and swaps, revoking the stale URL. We cache the **Blob, not an object URL** — each consumer mints + revokes its OWN URL from the shared Blob, so there's no cross-instance revocation hazard and the Blob outlives any single URL. `refresh()` evicts the in-memory entry so a manual reload truly re-rasterizes. `useEffect`→`useLayoutEffect` is the only main-editor-visible change and is a NO-OP on cold load (cache miss → identical async path; the pre-paint adopt fires only when the cache is already warm). **VERIFIED on the real released popout (fresh `.next-preview`, cross-checked + re-run on both figures + screenshot of the rendered figure):** float mount → **`wrap1\|load0\|img:inc:0` on the FIRST figure-bearing frame (img PRESENT, 0 placeholder, 0 pill), completing to `img:C` in 2–3ms** — page-anatomy nw **1000**, manicule nw **360** (cross-checks vs the Issue-4 record); the `load1` state is GONE. No layout shift (the `<img>` is present + panel-sized from frame 1); **0 pills / 0 loading / 0 errors** anywhere; the genuinely-EMPTY figure still shows the pill (`FigureBlockNodeView` untouched — the pill branch returns BEFORE `FigurePanel`/the resolver); MAIN editor unchanged (4 `img.figure-image` all `complete`, `childCount` 67 before pop AND after close, doc unmutated); 0 console errors. `npx tsc --noEmit` 0 errors; `eslint` 0 problems (removed a now-unused `exhaustive-deps` disable the rewrite obviated); `vitest` **286/0**. **USER-VERIFY step** (this dev preview re-pops via the same faithful `popOutAtRect` released-float path Issue-3/Issue-4 used, and the float's figure resolution is identical whether spawned by the real gesture or headlessly): in a writable session, drag-release "The Birth of the Footnote" and confirm the page-anatomy figure appears with no `Figure:…` / `Loading…` stub flash. **Non-goals respected:** ghost / `renderGhost` / `liftSourceRect` / the scroll+header issues untouched; figures stay read-only in the float; main-editor figure rendering changes ONLY by gaining the transparent shared cache; the pre-existing `useRecentlyAddedTracker.ts` working-tree change left untouched (commit scoped to the one hook). |
| 39 | Issue-7b — RESIDUAL figure flicker on popout release (paint/decode-timing, not DOM-state) | e015581 | Follow-up to Issue-7 (`60b3150`): the shared-Blob cache made the stub flash SHORTER (the fetch+sha1+raster round-trip is gone) but the user STILL saw a brief flicker on the real drag-release. **Measured residual cause — fresh object URL → re-decode (the prime suspect, confirmed not assumed):** Issue-7 cached the decoded **Blob** but had each consumer mint its OWN `URL.createObjectURL` on its OWN `<img>`. A fresh object URL is a NEW resource → a browser decoded-image-cache MISS → the bytes are re-decoded before the element can paint. **Headless decode-cost proxy** (mint a FRESH `createObjectURL` from a figure's cached Blob on a `new Image()` and time `img.decode()` — NOT `img.complete`, which lies about paint — vs reusing the main editor's already-live URL string; cross-checked, two agreeing runs + a warm-up-controlled run): a warm reused URL resolves in **~0.1ms** (decode-cache hit), a fresh URL re-decodes EVERY time — **~2ms for page-anatomy (1000×720), ~5ms for citation-graph (2160×1320)** (cost ∝ image size). That 1+ unpainted frame is the flash: the lifted GHOST (a `cloneNode`) copies the main editor's `<img src>`, so it reuses the warm URL and paints instantly; the released FLOAT minted a DIFFERENT (fresh) URL → cold decode → its first composited frame had no pixels. **The asymmetry between ghost (warm URL) and float (fresh URL) WAS the residual.** **Why Issue-7's verification missed it:** it sampled the float's figure subtree with a `MutationObserver` and read `img.complete` — both measure DOM PRESENCE (placeholder removed, `<img>` added, resource loaded), NOT paint/decode; the `<img>` was present + `complete` on frame 1 while still UN-decoded, so the probe scored "no flash" with a paint-timing gap intact. **Fix (figure-scoped option A — shared, REFCOUNTED object URL; [src/hooks/useResolvedFigureUrl.ts](src/hooks/useResolvedFigureUrl.ts), 1 file, BUILDS ON Issue-7's Blob cache, does NOT revert it):** a second module-level `urlCache: Map<JSON([docId,source,cacheKey]), {url, refs}>`. Every consumer (main-editor `FigurePanel`, the popped float's read-only `FigurePanel`, and — via cloneNode — the ghost) now references the SAME object-URL string via `acquireSharedFigureUrl`/`releaseSharedFigureUrl`; the URL is revoked only at refcount 0. A reused string hits the browser's decoded-image cache → the float's `<img>` paints on frame 1 with no re-decode — the SAME fast path the ghost was already on. **Refcounting solves the cross-instance revocation hazard Issue-7 sidestepped by never sharing a URL** (the main-editor figure holds a ref for the life of the open doc, so a float adopting/closing only moves the count 1↔2 — no consumer ever revokes a live URL out from under another). The retained `rasterCache` (Blob) is what lets the synchronous adopt path recover the `cacheKey` — and thus the `urlCacheKey` — BEFORE the async fingerprint check. The key is `JSON.stringify([docId,source,cacheKey])` (NUL-free, collision-proof; a raw `\0` join embeds a control byte that makes git treat the file as binary — caught + fixed mid-implementation). **Option B (deferred ghost teardown) NOT needed:** making the float paint on frame 1 also closes the SECONDARY teardown-handoff gap — the synchronous `setOverlay(null)` after `popOutAtRect` (TextObjectGrabHandle.tsx) is seamless because the float's first painted frame already carries the image, so there's no window with neither ghost nor painted float. Kept (A) alone — figure-scoped, one hook. **Verified (fresh `.next-preview`, cross-checked, real serverId from `preview_list`, live editor via `document.querySelector('.ProseMirror').editor`):** on the headless popped-cards re-pop path (which ISOLATES the prime suspect — no ghost is shown/torn down there, so it tests fresh-vs-shared URL alone), the float's figure `<img>` src now **EQUALS the main editor's URL string** (`sameUrl: true`, re-run 3×) for BOTH paths — "The Birth of the Footnote" (figureBlock+caption, page-anatomy nw **1000**) AND "The Marginal Gloss" (graphicsBlock/bare, manicule nw **360**); the float img decodes **warm (0.1ms, then 0ms on a second call)** even when the float renders at a different display size (306px vs main 186px — the fix is size-robust); **0 `.figure-placeholder` / 0 pills / 0 `.figure-error`** in either float; MAIN editor unchanged (4 `img.figure-image` all `complete`); screenshot confirms the manicule rendered as the real image in the popped section. `npx tsc --noEmit` 0 errors; `eslint` 0 problems; `vitest` **286/286**; 0 console errors across the full pop→close lifecycle. **rAF is THROTTLED in the backgrounded Claude preview** (a 5-frame cadence probe HUNG at 30s), so paint-aware FRAME-counting on the REAL ghost→float gesture can't run headlessly — and the grab handle needs a trusted hover synthetic events can't supply. **USER-VERIFY (required):** in a writable foreground session, run the provided paint-aware rAF probe and drag-release "The Birth of the Footnote" into the manila gutter — expect **0 unpainted frames** across the ghost→float handoff (the figure is there the instant the popout appears, no Loading…/blank frame). **Record correction:** Issue-7's row reported "img PRESENT, 0 placeholder on the first figure-bearing frame" as proof of no flash — that DOM-state measurement (`MutationObserver` + `img.complete`) UNDER-measured paint; the `<img>` was present-but-undecoded, so a ~2–5ms re-decode gap survived. Paint/decode timing (this row), not `MutationObserver`+`img.complete`, is the correct probe. **Non-goals respected:** Issue-7's Blob cache retained + extended (not reverted); ghost / `renderGhost` / `liftSourceRect` / scroll+header untouched; figures stay read-only in the float; the genuinely-empty figure still shows the pill (`FigureBlockNodeView` untouched — the pill branch returns BEFORE `FigurePanel`/the resolver, which my change never reaches); the pre-existing `useRecentlyAddedTracker.ts` working-tree change left untouched (commit scoped to the one hook). |

---

## Current state cheat-sheet (post-L3b.1)

**Where the primitive lives:**
- New file [src/text-objects/LiftedTextOverlay.tsx](src/text-objects/LiftedTextOverlay.tsx) — portal-rendered overlay. Props: `{ ref, anchorDom, grabOffsetX, grabOffsetY, sourceWidth, sourceHeight, cursorX, cursorY, mode, label, cache }`. The component is "dumb" — parent owns cursor + mode + label, the overlay just renders. cloneNode-sanitization happens once in `useMemo` (strips `contenteditable` recursively, removes ids to avoid live-source collision, sets `pointer-events: none`). **L1.5:** a sibling `useMemo` captures `getComputedStyle(anchorDom)` at mount and applies font-family/size/weight/style/variant/line-height/letter-spacing/color/text-align/text-indent/text-transform/font-feature-settings as inline styles on the overlay root — the portal sits outside `.ProseMirror`'s ancestor chain, so CSS inheritance through the DOM doesn't carry the editor's typography to the clone. **L3b.1:** the body wrapper now also carries the `tiptap` class, so the clone renders inside a re-established `.tiptap` content scope — the editor's descendant-selector content rules (list markers `.tiptap ul/ol`, nested-list spacing `.tiptap li > ul`, list padding, blockquote borders, code backgrounds) reach the clone even though the portal is outside `.tiptap`'s ancestor chain. This is the descendant-rule counterpart to L1.5's capture, which carries only INHERITED properties (so it could never restore `list-style`, set on the `<ul>` itself). No `.tiptap`-root chrome needed neutralizing — the bare `.tiptap {}` rule is just `outline: none` + font/color/tab-size, all benign for the overlay; the editor sizing vars are `:root`-global so `.tiptap p`/`h2` resolve identically in the portal, and L1.11's popout body padding still wins on specificity. L1.5's inline capture is retained but likely redundant under the scope (L4 to evaluate). **L1.7:** the JSX renders a `__header` element (label + inline chevron + X SVGs) above the `__body`; CSS hides it in ghost mode and fades it in (120ms) in popout mode via `position: absolute; bottom: 100%` so the body's grip-point doesn't shift on mode flip. Icons are visual-only mimics of `TextObjectFloat.tsx:93-125` (no shared header component yet). **L3a:** the header label arrives as the new `label` prop — the parent resolves it once at threshold cross via `meta.computeLabel?.(editor, ref) ?? meta.label`, so per-instance overrides (heading → "Chapter" / "Section" / "Subsection" per `headingTypeName(node.attrs.level)`) match the real popout's chrome at handoff. The `TEXT_OBJECT_REGISTRY` import dropped out of the overlay.
- Portal mount in [src/components/EditorPane.tsx](src/components/EditorPane.tsx) — `[data-lifted-overlay-portal]` div, column-level sibling of `[data-grab-handle-portal]` (both inside `[data-editor-col="true"]` — escapes the pod's clipPath that would otherwise swallow descendants beyond ±20px lateral).
- Chrome CSS in [src/app/globals.css](src/app/globals.css) — **L1.5 layout:** base `.lifted-text-overlay` = ghost (opacity 0.6, transparent background, no border, no shadow — semi-opaque text only), so mount renders the correct state with no fade-in artifact. `[data-lift-mode="popout"]` is the deviation (opacity 1, surface background, pod border, ambient shadow — matches TextObjectFloat's chrome). No explicit `[data-lift-mode="ghost"]` rule. Transitions on opacity/border-color/box-shadow/background-color ONLY — NOT on `top`/`left`/`width`/`height` (those must be instant for cursor tracking).

**Where the dispatch sits:**
- [src/text-objects/TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) `beginGesture` — at threshold cross, reads `meta.liftMode` for the resolved ref. `"lifted-overlay"` → capture source rect + grab-offset, resolve label via `meta.computeLabel?.(editor, ref) ?? meta.label` (L3a), mount overlay, **also start a drop session via `beginDropSession({ cardKey, origin, inPlace: true, externalCommit: true })`** (L2); mousemove drives cursor + mode, mouseup commits per mode (ghost → `await commitDropSession()`; popout → `cancelDropSession()` then `popOutAtRect` with chrome-inclusive coords). `"instant-popout"` (default for the remaining 14 kinds after L3a) → existing path, unchanged.
- Cache extension at [src/hooks/useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts) — `containsContentZone(x, y)` sibling of `containsHoverZone`, plus the parallel field in the `EditorViewportCache` type and `EMPTY_CACHE`. **L1.7:** predicate now reads `.editor-pane-pod`'s outer rect (resolved via `editorEl.closest(".editor-pane-pod")` in `refresh()` and exposed as `podLeft/podRight/podTop/podBottom` cache fields) instead of the `.ProseMirror` text content rect. Falls back to the editor's own `rect.left`/`rect.right`/`scrollTop`/`scrollBottom` if the pod walk fails.

**Where the in-editor commit lives (L2):**
- [src/components/drop-mode/controller.ts](src/components/drop-mode/controller.ts) — `beginDropSession` opts gain `inPlace?: boolean` (skip `markSourceFloat`, since no popout exists to dim during the in-editor gesture) and `externalCommit?: boolean` (skip installing the controller's own mouseup; the caller drives commit/cancel). `DropSession.inPlace` is stored so `endDropSession`'s `markSourceFloat` cleanup honors it. New exported async `commitDropSession()` carries the body of the old `handleUp` (placement → `classifyDrop` → apply / confirm / no-op); the default mouseup listener (installed only when `externalCommit !== true`) delegates to it, and external callers (the lifted-overlay gesture) call it directly. `installListeners` now accepts `{ attachMouseUp: boolean }`.
- The existing `textobject` drop spec at [src/components/drop-mode/specs/textobject.ts](src/components/drop-mode/specs/textobject.ts) handles the move — already does delete-then-insert via `collectMoveSource` (heading sections move as whole ranges), self-drop returns `"no-op"`, `postDrop: "close"` keeps any popout state coherent. No changes in L2.
- The [src/components/drop-mode/Indicator.tsx](src/components/drop-mode/Indicator.tsx) renders at z:9999 (body portal) and composes above the lifted overlay (z:25) without changes; it hides automatically in popout mode because the hit-test returns no placement outside the editor.

**What stays untouched after L3a:**
- The 14 remaining non-paragraph/non-heading kinds (subsequent L3 commits flip them; the registry slot is a string enum so the per-kind list of opt-ins is visible on the registry table).
- `initialFloatSize` constants (L4 retires them once the source rect drives every popout's initial dimensions). `floatSizeFor` still feeds the instant-popout legacy path AND the in-flight concurrent-delete fallback in the lifted-overlay branch (anchorDom missing at threshold cross).
- `cardLiftHandoff` / `cardLiftTarget` on the legacy path (the 14 instant-popout kinds keep their lift animation).
- Existing shift-drag from popped-out floats (FloatingPanel.tsx, StackThumbnail.tsx) — they call `beginDropSession` without `inPlace`/`externalCommit`, so the controller installs its own mouseup and dims the source float as before.

**Registry slots in the meta (post-L3a):**
- `liftMode?: "instant-popout" | "lifted-overlay"` — L1 staging; flipped on `paragraph` (L1) and `heading` (L3a).
- `computeLabel?: (editor: Editor, ref: TextObjectRef) => string | null` — L3a; per-instance label override for the overlay's popout-mode header. `heading` defines it (maps `node.attrs.level` → `headingTypeName(level)` mirroring `heading-body.tsx`'s `setHeaderLabel`). When omitted or returns null, the parent falls back to the static `meta.label`. The `Editor` type is imported from `@tiptap/core` to keep `types.ts` React-free. Subsequent L3 commits for kinds whose body uses `setHeaderLabel` (likely `bulletList`/`orderedList` → "Bullet list"/"Numbered list") will define `computeLabel` analogously.
- `renderGhost?: (anchorDom, editor, ref) => HTMLElement | null` — L3-Headings; overrides the lifted GHOST's content. Default (absent) = sanitized `anchorDom.cloneNode(true)`. `heading` defines it: clones the whole section's block DOM (`sectionBlockDoms` over `getSectionRangeByUuid`'s node range) into a detached `.tiptap` container reset to the editor-root base typography (so body prose doesn't inherit the grabbed heading's weight). Returns null for a lone heading → default clone. Resolved at the parent (`TextObjectGrabHandle` threshold-cross), threaded to `LiftedTextOverlay` as the `ghostContent` prop (overlay stays kind-agnostic, same pattern as `label`). The overlay sanitizes the returned element in place.
- `liftSourceRect?: (anchorDom, editor, ref, cache) => {left,top,width,height} | null` — L3-Headings; overrides the source rect captured at threshold-cross. Default (absent) = `anchorDom.getBoundingClientRect()`. `heading` keeps the heading line's left/top/width and clamps height to `min(sectionExtent, cache.scrollBottom − cache.scrollTop)` (the visible page). The returned w/h size BOTH the ghost AND the released popout (one capture site → `liveOverlay.sourceHeight` → `popOutAtRect`); left/top set the grab offset. `cache: EditorViewportCache` (type-only import in `types.ts`, erased — keeps the React-free invariant). Returns null for a lone heading → default rect. **L3f (linkedRange) is the designed second consumer of BOTH hooks** (range-extraction `renderGhost` + a multi-line/range bounding-box `liftSourceRect`), so building the pair now makes L3f near-trivial — the abstraction paying off as the meta-plan intends.

**Known L3 caveat:** `texBlock`'s CodeMirror won't cloneNode usefully — the editor's view-side rendering isn't carried by `cloneNode(true)`. L3 will need to choose between a placeholder version, a screenshot, or accepting a degraded visual for that one kind. Not L1/L2's problem.

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

---

## Issue-8 + Issue-9 — Released-popout page fidelity (view-toggle classes + figure numbers) — 2026-05-30

**Commits:** `5b43579` (Issue-8), `b4f8642` (Issue-9).

**One shared root (the FCU mandate).** A released TextObject float is a *separate*
TipTap editor that `PoppedCardsProvider` React-portals to the floating-cards layer
(~`document.body`), **outside** `.editor-pane-column`. So the popout silently
diverges from the page on anything the page derives from its column context:
(8) the `menuBar`-driven *view-toggle CSS classes*, and (9) *doc-wide-computed
numbers* (figure numbers) that the float deliberately stops recomputing. The
lifted **ghost** is correct in both cases because it renders *inside* the editor
column. Fix the class, not the symptom: re-derive the page's view classes on the
float, and render the synced numbers.

### Issue-8 — released section popout showed NO divider bars (+ latent par-title / latex-comment / heading-label / divider-width drift)
- **Cause (measured).** The page builds its view-toggle classes on
  `.editor-pane-column` only — `EditorPane.tsx:3484`, a template literal off the
  `menuBar` bundle: `hide-par-titles` (`showParTitles===false`),
  `hide-latex-comments`, `hide-heading-labels`, the `dividerClassName` memo
  (`[...menuBar.activeDividerLevels].map(l => `show-dividers-${l}`)`, ~1703-1707),
  and `dividers-width-${menuBar.dividerWidth}`. The divider CSS
  (`.show-dividers-N .tiptap .heading-wrapper-lN[::before]`, globals.css ~3557-3582)
  **requires that `.show-dividers-N` ancestor**. The released float is portaled
  out of the column, so it has no such ancestor → zero dividers (and likewise no
  hide-*/width parity).
- **Reaching `menuBar` from a float body (the seam).** Float bodies consume
  `useEditorChrome()`, which returns an `EditorChromeConfig` (chrome-context.tsx) —
  it did **not** carry `menuBar` (there is *no* `useMenuBar`/`MenuBarContext`; the
  bundle is `useState` in EditorLayout, passed to EditorPane as a prop). Added
  `menuBar?: EditorPaneMenuBarBundle` (type-only inline import → no runtime cycle)
  to `EditorChromeConfig` and populated it where EditorPane already builds the
  chrome value: `EditorPane.tsx:2935` → `value={{ ...chrome, menuBar }}` (`menuBar`
  in scope). `EditorChromeProvider` already wraps the popped-cards layer in the
  **React** tree, so the DOM portal is irrelevant — context flows by React tree,
  and every float body now reads `chrome.menuBar`.
- **Fix (shared, not per-kind).** New `viewToggleClasses(menuBar)` helper in
  `chrome-config.ts` mirrors the `.editor-pane-column` className exactly. Applied
  to the `.par-float-body` wrapper of all six float bodies (paragraph, heading,
  list, tex-block, linked-range, example-block). Every future popout kind inherits
  page-faithful view state for free.
- **CASE (a) — no bar above the float's OWN first heading.** Once the float carries
  `.show-dividers-N`, its first child (the section's own heading) would paint a
  divider `::before`. One targeted globals.css rule (next to the Issue-3 reset):
  `.par-float-body .tiptap > [class*="heading-wrapper-l"]:first-child::before { content: none; }`
  — subsections aren't `:first-child` so they keep their bars (case b). Deliberately
  NOT a blanket `::before { display:none }` (that would kill empty-paragraph
  placeholders in editable floats).
- **Issue-3 band-aid reconciliation.** The Issue-3 float reset
  (`.par-float-body .tiptap > :first-child { margin-top: 0 !important }`, 95a593a)
  is **NOT redundant and does NOT conflict — it is now load-bearing.** It zeros
  *margin* (orthogonal to CASE (a)'s *bar*): now that the float sits under
  `.show-dividers-N`, the 4.2em divider margin applies to the first heading-wrapper,
  and this `!important` reset is exactly what cancels it (the comment already
  anticipated "were the float layer ever re-parented under `.show-dividers-N`").
  Kept verbatim.

### Issue-9 — released popout dropped the "Figure 1:" caption prefix
- **Cause (measured).** Figure numbers are doc-wide computed by the `sectionNumbers`
  plugin (`editor-extensions.ts`), which sets a real serialized `figureNumber` attr
  on `figureBlock` (schema `figure-block.ts`, default null, renderHTML →{}). The
  float correctly omits the numberer (else it'd renumber its lone figure to 1); the
  number **rides in via the synced node attr** (`node.toJSON()`).
  `FigureCardPreview` (FigureBlockNodeView.tsx) rendered only `figure-caption-text`,
  dropping the `figure-caption-label` "Figure N:" prefix that `FigureFullView`
  shows.
- **Fix.** `FigureCardPreview` now reads `node.attrs.numbered` / `node.attrs.figureNumber`
  and renders the `figure-caption-label` span ("Figure {n}: ") exactly as
  `FigureFullView` — read-only `<span>`, no recomputation.

### Verification
- `tsc --noEmit` clean (0 errors); eslint 0 errors (only pre-existing warnings on
  the touched files); vitest 286/286 full + figure-roundtrip & editor-extensions
  37/37.
- Real released popout (cross-checked, two agreeing runs): popping "Antiquity and
  the Scroll" (l1, with l2 subsections + a figure) yields a `.par-float-body` with
  `show-dividers-1 show-dividers-2 show-dividers-3 dividers-width-full`; the
  section's own l1 heading has no painted `::before` (margin 0); the l2 subsections
  paint bars (`::before` height 1px, margin 67.2px); the figure caption reads
  "Figure 1:" — matching the page; ghost unchanged.
- **Tooling caveat (this session).** The tool channel repeatedly *fabricated* file
  contents for nonexistent paths (e.g. a phantom `useMenuBar`/`MenuBarContext` and a
  phantom `PoppedCardBody.tsx`) and fabricated `preview_eval` results (a bogus
  serverId + the wrong `code` param "succeeding"), plus severe delivery-lag.
  Defended by trusting only multi-source-agreeing greps over the real tree, real
  Python tracebacks, git blobs, and `tsc`/eslint/vitest as oracles.

### Issue-10 — released popout dropped the figure label lozenge (the blue `\label` chip)
- **The accretion smell (why this kept happening).** `FigureCardPreview`
  (`FigureBlockNodeView.tsx`) is a *parallel, hand-built* read-only render of a figure,
  taught the page's chrome one piece at a time: Issue-4 gave it the image
  (`FigurePanel`), Issue-9 the "Figure N:" caption prefix — and the blue `\label`
  lozenge was still missing, so a popped section showed the figure but not its label
  chip (present and correct in the lifted ghost, which clones the live page DOM). Each
  fix patched the same divergent render. The lozenge was the third such gap; the bug
  *is* the accretion.
- **Measured first — and corrected the brief.** The blue chip is **not** a
  `LabelInlineChip` (no such file exists; that name was a fabricated read in the
  planning session). The real lozenge is **`FigureAnnotation`** (`FigureAnnotation.tsx`),
  which `FigureFullView` renders interactively (`<FigureAnnotation editor … label
  onConfirmRename onConfirmDelete/>`), drawing the chip from `node.attrs.label`. `label`
  is a declared `figureBlock` attr (`figure-block.ts:71`, default `""`), so it **rides
  into the float via `node.toJSON()`** exactly like `figureNumber` did for Issue-9 — a
  render-only gap, not a sync gap. CSS `.figure-block .figure-annotation` is
  always-visible (no hover/opacity gate; *not* hidden by `data-editable="false"`) and
  scoped under `.figure-block`, which the float wrapper already carries — so no CSS
  change was needed.
- **Fix — share the real component, not a third copy.** Taught `FigureAnnotation` a
  `readOnly` mode (`editor`/`getFigurePos`/`onConfirm*` now optional; every interactive
  callback guarded; rename / delete / numbered-toggle / click-to-edit gated off in the
  render). `FigureCardPreview` now renders the **same** `<FigureAnnotation readOnly
  label numbered/>` the page uses, gated on `isFigure && label`. The float's lozenge is
  the page's lozenge minus interaction, so any future change *inside* the lozenge ports
  to the float automatically. Opt-in by construction: `FigureFullView` passes no
  `readOnly` → `readOnly=false` makes every `readOnly ? undefined : X` resolve to `X`,
  so the page render is byte-for-byte unchanged (and `tsc`/eslint/vitest confirm).
- **Honest scope — this is the lozenge-reuse form, not a full render-path unification.**
  `FigureCardPreview` is *still* a parallel hand-built render of the figure-row +
  caption. The image (`FigurePanel`) and now the lozenge (`FigureAnnotation`) are shared
  components, but the **caption** stays divergent by necessity: `FigureFullView` renders
  it as an editable `NodeViewContent` child (load-bearing for ProseMirror), while the
  read-only preview renders static `node.firstChild.textContent`. The accretion risk
  therefore survives on the caption/row surface. **Recommended follow-up:** factor a
  shared `FigureVisual` presentational component (figure-row + figure-caption wrapper +
  "Figure N:" prefix + lozenge placement) used by both views, with the caption passed as
  a slot (`<NodeViewContent/>` for the page, `<span>{text}</span>` for the preview) and
  interactivity gated — closing the remaining gap so no figure affordance can silently
  go missing again.
- **Verification (real released popout, cross-checked).** `rm -rf .next-preview` + fresh
  dev server; popped "The Birth of the Footnote" (heading id `3300`, which contains
  `fig:bands`) headlessly via a fresh-DFS'd `PoppedCardsContext.popOutAtRect`
  (`isPopped` confirmed true after re-render). The released float's
  `.figure-block-card-image` shows: the image; `figure-caption-label` "Figure 1:" + full
  caption text; **and** a `.figure-annotation` reading "Figure # · label: fig:bands" (no
  `×` — delete gated off), `.figure-label-text` = "fig:bands", computed `color`
  `rgb(107,154,196)`/`#6b9ac4` + border `rgb(168,196,222)`/`#a8c4de` — identical blue to
  the page lozenge. Page baseline unchanged (both `fig:bands`/`fig:wide` keep their
  lozenges); ghost untouched (`renderGhost` not modified); no console errors (read-only
  render needs no editor); float closed afterward (doc restored). `tsc --noEmit` 0
  errors; eslint 0 errors (only the pre-existing `<img>` warning on the touched file);
  vitest 286/286.

## Issue-11 — Drag overlay (ghost + popout chrome) stacked behind the Virgil bar; should be fully forward like a released float — 2026-05-31

**Commit:** `bf80d47`.

**Symptom.** During a drag, the lifted overlay (the ghost AND popout-mode
chrome) rendered above the editor text but BEHIND the Virgil bar (the sticky
top chrome strip). A released popout sits above everything incl. the bar, so
the drag overlay should match it — the drag popout is the released popout
that hasn't landed yet; drag and release must share one stacking model.

**Cause (measured live, cross-checked) — NOT a trapped stacking context.**
Walking from the overlay portal up to `<html>` finds ZERO stacking-context
ancestors: `editor-pane-column` is deliberately `position:relative` with no
z-index (its own comment says so), and every wrapper up to `body` is
static/auto, so the overlay's z resolves directly in the ROOT context, same
as the bar. Two real causes stacked:

1. a raw z-gap — overlay `z:25` < the bar's sticky `z:30` (both in root); and
2. the DECISIVE one — geometric CLIPPING. The overlay portaled into the
   column-level `[data-lifted-overlay-portal]`, which lives inside the editor
   scroll container (`div.flex.flex-1`, `overflow-y:auto`) whose top edge
   sits flush under the bar; the bar lives OUTSIDE that container. An
   absolutely-positioned child of the column portal is clipped at the
   container's top edge regardless of z. Proven: a probe child at `z:99999`
   is still clipped at the bar's bottom (y=32) — `elementFromPoint` at y<32
   returns the bar, the probe only appears at y>=32. So z-index ALONE could
   never lift the overlay over the bar.

**Fix.** Re-portal the overlay + sibling header from the column portal to
`document.body` with `position:fixed` and viewport coords — the SAME layer +
coordinate model released floats (`FloatingPanel`) and the drop indicator
(`drop-mode/Indicator.tsx`) already use — at `z:1200`, the released-float
layer (`FloatCard`'s `1200 + indexHint` in FloatingCards.tsx), not a magic
number. A body-level box escapes the scroll-container clip; the z then orders
it above the bar (`z:30`) and the pod caps (`z:30/31`) and below the drop
indicator (`z:9999`, body-fixed, still composing on top). Cursor tracking is
PRESERVED: the column portal only ever placed the overlay at the cursor's
VIEWPORT position (`toPortalCoords` subtracted the live column rect each
frame), so `position:fixed` at the raw viewport coords (`cursor − grabOffset`)
lands at the identical pixel — and stays glued through scroll without a
per-frame rect read. The now-unused `cache` prop (LiftedTextOverlay + its
call site in TextObjectGrabHandle) and the dead `[data-lifted-overlay-portal]`
div (EditorPane.tsx) were removed; the `.lifted-text-overlay` CSS base
position was set to `fixed` to match the inline value.

**Verify.** tsc clean; vitest 286/286; eslint no NEW errors (the lone error —
`react-hooks/immutability` on `c.style.pointerEvents` in the `ghostContent`
clone path — is pre-existing at HEAD and out of scope). Live on the dev
server, cross-checked across two agreeing runs: `.lifted-text-overlay` +
`__header` compute `z:1200`, overlay CSS `position:fixed`; the dead column
portal is gone (`querySelectorAll` length 0); a body-level `position:fixed
z:1200` box (== the new overlay) at a point INSIDE the bar (y=8) is NOT
clipped and paints over the bar (`elementFromPoint` returns it), where the
old column-portal `z:99999` child was clipped at y=32. Ghost↔popout chrome
flip is driven by the parent's `mode` prop (untouched); the drop indicator
(z:9999) still composes on top; released floats / grab-handle portal
unchanged. Real-drag visual is user-driven (the grab handle needs a TRUSTED
hover): drag a paragraph/section up near the Virgil bar and confirm the
floating block passes OVER the bar.

## Issue-12 — ONE source for view-toggle classes across all three content surfaces (page column + released float + drag ghost); fixes the missing ghost dividers — 2026-05-31

**Commit:** `2d32a62` (this memo is the separate follow-up, per the arc's code+memo pairing).

**User mandate.** "There are other things subject to show/hide — section
dividers, % comments, perhaps stuff I make in the future. Will this all be
automated, or do I have to come back for each one? I'd STRONGLY prefer a
unified architectural solution, so all of that just percolates into pop-outs
automatically." Motivating bug: "when I pop-out a section, the divider bars are
missing in the GHOST, but show up on release." Same architectural gap — closed
once.

**The 3-layer architecture.** A view toggle (dividers, % comments, par-titles,
heading-labels, divider-width, any future hide-labels / labels-on-hover) flows
through three layers; full automation needs all three unified:
1. **Toggle state → class tokens** — `viewToggleClasses(menuBar)`
   (`chrome-config.ts`), the single producer of `hide-par-titles` /
   `hide-latex-comments` / `hide-heading-labels` / `show-dividers-<lvl>` /
   `dividers-width-<n>` (returns `""` for no menuBar / Reader).
2. **The CSS those classes gate** — ALL ancestor-agnostic:
   `.hide-heading-labels .heading-annotation`, `.hide-par-titles
   .par-title-annotation`, `.hide-latex-comments .latex-comment`,
   `.show-dividers-N .tiptap .heading-wrapper-lN(::before)`, and
   `.dividers-width-*` (sets cascading `--divider-inset-*` vars the `::before`
   reads). They key on the toggle class as an ANCESTOR (or self), NEVER on
   `.editor-pane-column` — so any surface whose ROOT carries the class gets
   the behavior for free, no per-surface CSS.
3. **The surfaces that carry the classes** — THREE: the page column
   (`.editor-pane-column`), the released float body (`.par-float-body`), and
   the drag-ghost overlay (`.lifted-text-overlay`).

**The finding (correcting a fabricated mis-read).** Before Issue-12: column ✓
(hand-built inline className), float ✓ (consumes `viewToggleClasses` since
Issue-8), **drag ghost ✗ — the un-migrated third surface.** The column did NOT
"sort divider levels while the float doesn't" — that "they already drift" claim
was a tool-channel FABRICATION. The column's deleted `dividerClassName` useMemo
did `[...levels].map(...)` and `viewToggleClasses` does `for (const lvl of
levels)` — both iterate the SAME `Set` in insertion order, token-for-token
identical in every state. NO sort was introduced; the column refactor is
byte-identical.

**Why the ghost lost its dividers.** Issue-11 (`bf80d47`) re-portaled the
overlay to `document.body` to clear the Virgil bar. That dropped the
`.show-dividers-N` ancestor the ghost had inherited while it portaled INSIDE
`.editor-pane-column`, so the `.show-dividers-N .tiptap .heading-wrapper-lN`
rule no longer reached the ghost body and the bars vanished mid-drag (they
reappeared on release because the float carries the class explicitly via
Issue-8). The ghost was simply never migrated to consume the one source.

**The three-part fix (one commit).**
- **(A) Page column consumes the one source.** `EditorPane.tsx` now computes
  `const viewToggleCls = viewToggleClasses(menuBar)` (replacing the redundant
  `dividerClassName` useMemo, deleted) and the column className is
  `` `editor-pane-column${viewToggleCls ? ` ${viewToggleCls}` : ""}` `` —
  byte-identical output to the old hand-built expression in every state.
- **(B) Drag ghost becomes the third consumer (THE BUG FIX).**
  `TextObjectGrabHandle` reads `menuBar` via `useEditorChrome()` (it renders
  inside EditorPane's `EditorChromeProvider` — the same seam the floats use),
  builds `viewToggleClasses(menuBar)`, mirrors it into a ref (idiom of
  `poppedRef` / `dragHandleMenuRef`), pins it on `OverlayState` at
  threshold-cross (toggle state can't change mid-gesture — same rationale as
  the `label` prop), and threads it as a new `viewToggleCls` prop to
  `LiftedTextOverlay`, which appends it to the `.lifted-text-overlay` ROOT
  className (ancestor of the `.tiptap` body). The ghost now honors EVERY
  toggle, restoring correct pre-Issue-11 behavior.
- **(C) Stale comments corrected.** The Issue-1 (globals.css ~1504) and Issue-3
  (~1545) comments no longer claim the ghost "renders INSIDE `.show-dividers-N`
  via ancestry" — post-Issue-11 the ghost is body-portaled, and Issue-12
  supplies `.show-dividers-N` EXPLICITLY on the overlay root, the same
  mechanism the float uses on `.par-float-body`. Load-bearing rationale kept;
  also fixed the stale `~3482` line-ref (the divider rule sits at ~3600).

**Issue-1's first-block reset is load-bearing AGAIN.** With `.show-dividers-N`
back on the ghost root, the first heading's 4.2em divider margin returns, and
`.lifted-text-overlay__body .tiptap > :first-child { margin-top: 0 !important }`
(globals.css ~1528) re-becomes the rule that glues the first heading flush (its
`::before` clipped by the body BFC) while subsequent headings render their bars
— mirroring the float reset at ~1575. Kept; verified untouched.

**Future cleanup (noted, NOT done — scope creep).** The first-block `!important`
reset is duplicated across the ghost (~1528) and float (~1575) surfaces; a
shared rule could unify them. Deferred.

**The headline (the user's requirement, structurally guaranteed).** All three
surfaces now embed the ONE `viewToggleClasses(menuBar)` output. A NEW view
toggle (e.g. the user-named hide-labels / labels-on-hover) = ONE line in
`viewToggleClasses` + ONE ancestor-agnostic CSS rule → it reaches the page,
every popout, AND the drag ghost automatically. Same principle as FCU's shared
`buildEditorExtensions`.

**Verify.** Working tree: vitest **308/308** (286 baseline + 22 new).
`editor-layout/__tests__/view-toggle-classes.test.ts` proves the column
className is byte-identical to the pre-Issue-12 expression over a fixture table
AND that column / float / overlay carry exactly `viewToggleClasses`' tokens in
the same order (single-source proof). `text-objects/__tests__/lifted-overlay-view-toggle.test.tsx`
mounts the real `LiftedTextOverlay` (jsdom) and asserts the handed toggle
tokens land on the `.lifted-text-overlay` root (and an empty string leaves it
exactly `lifted-text-overlay`). tsc clean on the working tree; eslint no NEW
problems (the lone error — `react-hooks/immutability` on `c.style.pointerEvents`
in the clone path — is pre-existing at HEAD, out of scope). NOTE: HEAD carries
a SEPARATE pre-existing tsc error (`card-creation.ts` passes `"archive"` to
`RecentlyAddedKind`) that the user's in-flight `useRecentlyAddedTracker.ts`
change fixes; left untouched per scope, so the Issue-12 code commit inherits it
in isolation while the working tree stays green. The LIVE in-drag ghost cannot
be driven headlessly (the grab handle needs a TRUSTED hover) and a clone-harness
is unfaithful, so the headless check is class-presence on the rendered overlay
root; the in-drag visual is a USER-VERIFY step: with dividers ON, drag a section
and confirm the divider bars show in the ghost DURING the drag, matching the
page and the released popout, first heading glued (no vertical "double").

## Issue-13 — Cap lifted-section popout height to a viewport fraction so the popped window fits on screen — 2026-06-01

**Commit:** `b8ab56d` (this memo is the separate follow-up, per the arc's code+memo pairing).

**Symptom.** Popping out a multi-page section spawned a popout window ~the
section's full visible height that ran off the bottom of the screen — and it
started with the drag GHOST (same height). The user is fine with the ghost
surfacing material beyond the editor's bottom margin (a general UX feature) but
wanted a MAXIMUM height so the popped window always fits on screen, scrolling
internally for the overflow.

**Single-capture-site cause (measured on the REAL released popout, cross-checked
— arithmetic == empirical).** The lift gesture has ONE capture site
(`TextObjectGrabHandle.tsx`, where `sourceHeight = liftRect.height` is
resolved); that one value feeds BOTH the ghost (`LiftedTextOverlay` renders the
ghost body at exactly `sourceHeight`) AND the released-popout spawn
(`popOutAtRect` height = `sourceHeight + 58` chrome). The post-spawn
auto-fit/grow-burst is gated OFF for lifted-overlay kinds
(`FloatingCards.tsx:96`), so the spawn height STICKS. Heading's `liftSourceRect`
clamped height to `min(sectionExtent, visiblePage)` where `visiblePage =
cache.scrollBottom − cache.scrollTop` ≈ the scroll-container's full visible
height — which was both (a) **heading-only** (paragraph/list/example/texBlock
have NO `liftSourceRect`, so a long one was uncapped) and (b) **chrome- and
position-blind**: it capped to ~full viewport while the spawn ADDS 58px of
chrome and positions the window at the grab point with no bottom-fit clamp →
window taller than the viewport, positioned mid-screen → overflow.

**Measured BEFORE** (dev-doc "Digital Remediation" section, real released popout
via the popped-cards `popOutAtRect` path; cross-checked across two window widths
— `sectionExtent` 2673 / 2997, both > `visiblePage`): at `innerHeight 900`,
`visiblePage 868`, captured `sourceHeight = min(extent, 868) = 868` → spawn
height `868 + 58 = 926` > `innerHeight 900` — **taller than the viewport
regardless of position**; rendered float `height 926, top 100, bottom 1026 →
+126px off the bottom`, body `clientHeight 900 / scrollHeight 2633` (it scrolled,
but the WINDOW overflowed the screen).

**The fix — a GENERAL viewport-fraction cap at the single capture site (the
CLASS, not a heading patch).**
1. **Cap `sourceHeight` at capture** (`TextObjectGrabHandle.tsx`):
   `cappedSourceHeight = capPopoutHeight(liftRect.height, window.innerHeight)`.
   One site → caps the ghost (= `sourceHeight`) AND the released popout
   (= `sourceHeight + chrome`) for EVERY lifted kind, so the two stay identical
   — **no size jump on release** (the L1.12 text-stays-still /
   chrome-grows-outward invariant holds). A MAX, not a floor: short content
   (`liftRect.height < cap`) is unchanged; left/top/width untouched, so the grab
   offset is unchanged.
2. **Clamp the spawn Y** (`TextObjectGrabHandle.tsx`): compute the window height
   first, then `spawnY = Math.max(SPAWN_FIT_MARGIN, Math.min(intendedY,
   innerHeight − SPAWN_FIT_MARGIN − overlayHeight))` (`SPAWN_FIT_MARGIN = 20`,
   mirroring FloatingCards' auto-fit `adjustedY` margin + FloatingPanel's
   `innerHeight − 40` fit convention). With height ≤ ~55% viewport + 58 chrome a
   valid Y always exists; `Math.max` keeps the top on screen for a grab near the
   viewport bottom. (Computed before the `overlayRect` literal — no mutation of
   the const, so no `react-hooks/immutability` lint.)
3. **Simplify heading's `liftSourceRect`** (`text-object-registry.ts`): dropped
   the `min(sectionExtent, visiblePage)` clamp (and the now-unused `cache`
   param — a 3-arg impl is assignable to the 4-arg type) → returns the full
   `sectionExtent`. The general cap (#1) now fits it for every kind, subsuming
   the redundant, chrome/position-blind heading-only clamp. `heading-body`
   (full-section overflow-auto view) untouched; the type comment updated.
4. **One source for the policy** (`text-object-registry.ts`): new exported
   `POPOUT_MAX_VH = 0.55` (user-chosen 2026-06-01, the 50–60% range) + a shared
   `capPopoutHeight(naturalHeight, viewportHeight)` helper consumed by BOTH the
   new lift cap AND the existing instant-popout auto-fit grow cap
   (`FloatingCards.tsx`, was a separate local `0.4`). ONE "how tall can a popout
   be" policy → no parallel un-shared copies. (Deliberate, prompt-sanctioned
   side effect — "don't change the grow-burst mechanism *beyond the shared
   constant*": the instant-popout auto-fit cap moves 0.40 → 0.55. It is reached
   only by instant-popout floats that auto-grow past the cap — practically
   ≈linkedRange (lifted-overlay kinds early-return at `:96`) — making their
   interim max consistent with the lifted kinds' and the user's comfort range;
   benign, content scrolls.)

**Measured AFTER** (same real popout, fresh `.next-preview`, cross-checked):
captured `sourceHeight = capPopoutHeight(extent, 900) = min(extent, floor(900 ×
0.55) = 495) = 495` → spawn height `495 + 58 = 553`; rendered float `height 553,
top 79, bottom 632` — **fully on-screen (268px clearance below; top + height 632
≤ innerHeight − 20 = 880)**, body `clientHeight 527 / scrollHeight 2942,
overflow: auto` → scrolls the ~2415px overflow internally. The capped content
area (495) is exactly `floor(0.55 × 900)`; the float did NOT auto-grow (the
lifted-overlay auto-fit gate held → no regression). Screenshot: the "Digital
Remediation" section popout in the upper viewport with clear space below, real
section chrome (number "6" + "Section ▾ · label: sec:digital" chip), scrollable.
**BEFORE 926 (+126 off) → AFTER 553 (fits, scrolls).**

**Verify.** `tsc` clean; `eslint` no NEW problems (per-file on the 4 touched
source files + the new test: identical to baseline — the 3 pre-existing
`FloatingCards` `rules-of-hooks` errors from `if(!ctx) return null` and the
grab-handle warnings are untouched; the `react-hooks/immutability` error in the
clone path is pre-existing / out of scope); `vitest` **312/312** (308 baseline
unchanged + 4 new). New headless test
`src/text-objects/__tests__/popout-height-cap.test.ts` pins `POPOUT_MAX_VH ===
0.55` (∈ [0.5, 0.6]), proves `capPopoutHeight` is a MAX not a floor (short
content unchanged; tall content → `floor(vh × 0.55)`, incl. the measured 2673 →
495 case), and proves the fit invariant — a capped popout + 58 chrome + 2×20
margins ≤ viewport for vh ∈ [600..2000] — so a valid on-screen spawn-Y always
exists.

**Ghost = popout height, no release jump — USER-VERIFY via a real trusted-hover
drag.** The live drag GHOST cannot be driven headlessly (the grab handle needs a
trusted hover; a clone-harness is unfaithful — the L3-Headings.1-REAL lesson),
so this is the one user-verify step. Verified in CODE that the ghost height IS
the capped `sourceHeight` (`LiftedTextOverlay.tsx` overlayHeight = `sourceHeight`
in ghost mode / `sourceHeight + chrome` in popout) and the spawn uses the same
`sourceHeight + chrome`, so capping the one value bounds the ghost AND the popout
identically; the headless unit test asserts the cap math. **USER step:** in a
writable session, with a long multi-page section, drag its heading slowly —
confirm (a) the GHOST is bounded to ~55% of the viewport (not the full section
height), (b) on release into the gutter the popped window matches the ghost's
height (no size jump), and (c) the window fits fully on screen and its body
scrolls to reveal the rest. Repeat on a long paragraph/list/example/texBlock
(the cap is general, not heading-only) and on a SHORT paragraph (must open at its
natural, uncapped height).

**No regressions.** Short sections/paragraphs and other kinds open at their
natural (uncapped) height (the cap is a max, not a floor); no width change (only
height is capped; `sourceWidth` / `overlayRect.width` untouched); the
lifted-overlay auto-fit gate still holds (the capped popout is not re-grown);
Issue-8/9/10/12 popout-fidelity paths untouched. Diff scoped to 4 source files +
1 new test (`b8ab56d`); the pre-existing working-tree changes
(`useRecentlyAddedTracker.ts`, `EditorPane.tsx`, `useMarginEdit.ts`,
`EDITOR_SKILLS_BRAINSTORM.html`) left untouched and out of the commit.

**Preview-op note (for future sessions).** A freshly-restarted `.next-preview`
booted the page at **`innerHeight 0` (0×0 window)** — the documented "0×0
default kills hover-zone math" gotcha — which silently zeroed the cap math in the
first measurement eval (`cap 0`, `extent 2997` reflowed at the degenerate size);
`preview_resize(1280×900)` restored it. Cross-check `window.innerHeight` is
non-zero before trusting any viewport-fraction measurement. Every measurement
eval carried a `6*7` sentinel to catch fabricated tool output (the arc's known
hazard); all returned 42.

## L3f-1 — Decouple the plain selection-grab from annotation: a cardless, invisible anchor (kills the green highlight) — 2026-06-01

**Commit:** `5820e92` (this memo is the paired follow-up).

**Reframe.** The last body-having kind was framed as "linkedRange," but the
real target is: **a plain text SELECTION grab is a transient action — it must
leave NO side-panel card and NO visible highlight** (an under-the-hood id to
track the range is fine). The `linkedAnchor` annotation kinds (note /
highlight / cut / revision) are a SEPARATE, legitimate thing that keeps its
colour + card. This is **piece 1 of 3** of the reframed L3f; pieces 2
(selection as a first-class lifted-overlay grab) and 3 (within-text caret
drop) follow.

**The bug + cause.** A plain selection grab routes through
`hydrateSelectionToTextObject` (`src/text-objects/hydrate-selection.ts`),
which stamped a `linkedAnchor` mark with ONLY `anchorId`. But the mark's
`kind` attr DEFAULTS to `"note"` (`linked-anchor.ts:25`), so `renderHTML`
derived `data-link-card="note:"` and CSS painted the grabbed text green
(`globals.css` `.linked-anchor[data-link-card^="note:"] → #15803d`, surfaced
via the note highlight-toggle / hover / selected). A transient grab was being
dressed as a note annotation.

**The fix (class-level) — a transient, cardless, INVISIBLE anchor for the
plain grab.**
1. **Sentinel.** `hydrateSelectionToTextObject` gains an opt-in `{ transient }`
   param; when set it stamps `kind:"transient"` on the minted mark. Passed
   `true` ONLY by the plain grab (`TextObjectGrabHandle.tsx:680`).
2. **renderHTML.** The DOM-attr policy moved to a pure, unit-tested helper
   `linkedAnchorRenderAttrs` (`src/lib/tiptap/linked-anchor-attrs.ts`): a
   transient mark (`kind:"transient"`, no `linkCard`) OMITS `data-link-card`
   entirely; every other anchor is byte-identical to before; an explicit
   `linkCard` always wins (so a real card attached later overwrites the
   sentinel and the anchor colours up the moment it becomes an annotation).
3. **CSS.** `.linked-anchor:not([data-link-card]) { --link-anchor-color:
   transparent; background: none; }` — because the hover / selected / show-hl
   backgrounds are all `color-mix(... var(--link-anchor-color) ...)`, the
   transparent var neutralises them too. No green, no amber fallback, no tint,
   regardless of the highlight toggles or hover.
4. **Lifecycle (no litter).** New guarded `removeTransientAnchor` (`links.ts`)
   strips the handle — but ONLY if the mark is actually transient, so a grab
   that REUSED a real annotation's range (full-coverage reuse) never deletes
   that note/highlight/cut/revision on close. Driven by
   `useTransientAnchorCleanup` (`src/text-objects/`), a `poppedOutCards`
   watcher mounted in `EditorLayout` (editor-aware; catches every close path —
   float X, Cmd-W, Escape, programmatic).

**Scoped to the plain grab only.** Card-anchor commits (note/highlight/cut/
revision from a selection) do NOT route through
`hydrateSelectionToTextObject` — they use `createLinkedAnchor` /
`updateLinkedAnchorCard` (`links.ts:751/809`), which set `kind`/`linkCard`/
`tintColor` directly. They keep their colour + card, untouched.

**Re-grounding (the arc's read-corruption defence paid off).** The brief
claimed `hydrateSelectionToTextObject` was shared by multiple call sites
(plain grab + card commits + drop commits, per its header doc); a
cross-checked `grep` (Read + `git grep`) proved only ONE real caller today —
the plain grab. The header doc's "Phase E call sites" were aspirational/stale
(corrected in the doc). `linkedRange` has no `liftMode`, so the selection grab
is INSTANT-POPOUT, not lifted-overlay — the brief's cancel/move-commit cleanup
sites (`~985/~1015`) belong to the lifted-overlay path a selection won't reach
until piece 2, so they're not wired here; the real lifecycle is close-driven.
`closeCardPopout` (`useViewPrefs:1352`) has no editor, and the editor-aware
close handlers live in the off-limits `EditorPane`, so cleanup was hung off
the `poppedOutCards` source-of-truth in `EditorLayout` instead. The existing
`useLinkedAnchorReconciler` (single owner of "every linkedAnchor must back a
live card") remains a backstop — it already sweeps cardless marks on
collection change — and the linkedAnchor mark is app-state (stripped on `.tex`
export, re-applied only from a card's `links[]`), so a transient mark does not
survive reload.

**Verify.** `tsc` clean; `eslint` 0 errors (117 = baseline, no new); `vitest`
**319/319** (312 baseline + 7 new in `linked-anchor-attrs.test.ts`: transient
→ no `data-link-card`; note/highlight/cut/revision→comment fallbacks +
explicit `linkCard` unchanged). Live on the dev doc (fresh `.next-preview`,
every eval `6*7`-sentinelled, two agreeing runs): injecting a `kind:"transient"`
mark + a `note:`/`highlight:` mark and reading the rendered spans — transient =
no `data-link-card`, computed `background rgba(0,0,0,0)` WITH
`data-show-hl-note="true"`; note = `data-link-card="note:…"`, green
`oklab(…/0.18)`; highlight = `data-link-card="highlight:…"` + `data-tint-color`,
amber `lab(…/0.35)`. The guard classified the transient as removable and the
note as protected; applying guarded removal to both dropped the transient and
left the note. The transparent rule was confirmed present in
`document.styleSheets`.

**No regressions.** Note/highlight/cut/revision creation + rendering untouched
(non-transient `renderHTML` output byte-identical); the `linked-range-body`
float (still `PLACEHOLDER_FLOAT_BODY`) and the annotation kinds unchanged; the
4 pre-existing working-tree files (`EDITOR_SKILLS_BRAINSTORM.html`,
`EditorPane.tsx`, `useMarginEdit.ts`, `useRecentlyAddedTracker.ts`) left
untouched and out of the commit (`5820e92`).

## L3f-2 — The plain selection as a first-class lifted-overlay grab: range ghost + pop-out + within-text move — 2026-06-01

**What it does.** A plain text SELECTION now grabs like every other kind: a
lifted-overlay **ghost** of the marked range follows the cursor (no green —
it rides L3f-1's transient, cardless, invisible anchor), **release in the
gutter** pops the existing bidirectional `linked-range-body` float (text stays
in the doc, syncs), **release in the page over text** MOVES the run to the
inline caret. `linkedRange` is the hardest kind — a MARK over a RANGE, not an
element — so it proves the `renderGhost` / `liftSourceRect` abstraction (built
for heading) generalizes: heading was the first multi-block ELEMENT consumer;
linkedRange is the first mark-backed RANGE consumer. SCOPE: within-text only
(inline-cursor placement); the between-paragraphs (block-gap) drop + wrapping
policy is **L3f-3, out of scope** (block gaps stay inert).

**The pieces.**
1. **`liftMode: "lifted-overlay"`** on the `linkedRange` registry entry — the
   selection grab flips from instant-popout to the two-mode drag.
2. **Range-aware lift gate** (`TextObjectGrabHandle.tsx`). Today the gate bails
   to a legacy cursor-spawn when `resolveAnchorDom` is null — which is ALWAYS
   true for a range (it's mark-backed, no anchor element). Restructured: resolve
   `anchorDom`, compute `isRange = meta.isRange`, then `liftRect =
   meta.liftSourceRect?.(anchorDom, …) ?? anchorDom?.getBoundingClientRect() ??
   null` and `ghostContent = meta.renderGhost?.(anchorDom, …) ?? null`. A SINGLE
   bail `if (!liftRect || (isRange && !ghostContent))` covers both an element
   whose DOM vanished (no rect → legacy, IDENTICAL to the prior `!anchorDom`
   path) and a range whose mark couldn't be resolved. The element path
   (anchorDom present) is behaviorally byte-for-byte unchanged: `liftRect`
   still defaults to the bounding rect, `ghostContent` stays null unless the
   kind defines `renderGhost`, and the `isRange && …` clause never fires
   (`isRange === false` for every non-linkedRange kind). `OverlayState.anchorDom`
   + the overlay's `anchorDom` prop widen to `HTMLElement | null`; the overlay's
   clone path uses `ghostContent` in place (already does for heading) and its
   typography capture early-returns `{}` when `anchorDom` is null (the range
   ghost carries its own typography). The shared `renderGhost`/`liftSourceRect`
   meta signatures widen `anchorDom` to `HTMLElement | null`; heading's
   `liftSourceRect` gains an inert `if (!anchorDom) return null` guard.
3. **`renderGhost` on `linkedRange`** — resolve the marked range
   (`findLinkedAnchorRange`), build a live DOM `Range` over
   `view.domAtPos(from)…domAtPos(to)`, `cloneContents()` into a `.tiptap`
   container. `cloneContents` over an inline range yields bare text/spans
   WITHOUT the `<p>`/`<h*>` wrapper, so `.tiptap p`/`.tiptap h*` can't size it —
   the container copies the SOURCE block's resolved typography (the range is
   homogeneous inline content of one block; heading copies the editor ROOT
   because its clone holds whole blocks that re-apply per-element rules).
4. **`liftSourceRect` on `linkedRange`** — same range → DOM `Range` →
   `getClientRects()` → union, anchored at the FIRST rect's top-left (the
   selection START, so the grab offset + L1.12 text-stays-still hold) with
   **width = the union's full span (`unionRight − unionLeft`)**, NOT measured
   from the start rect's left (a multi-line selection beginning mid-line has a
   short first rect; `unionRight − first.left` under-sizes the ghost — measured
   live: 91px vs the correct 302px column width). The general `POPOUT_MAX_VH`
   cap downstream fits a tall multi-line range on screen (subsumes any per-hook
   clamp, like heading post-Issue-13).
5. **Pop-out (gutter release)** reuses the existing `popOutAtRect` → bidirectional
   `linked-range-body` float. Untouched (the same spawn every kind uses; only the
   gesture that reaches it changed).
6. **Within-text move (page release over text)** — new DropSpec
   `src/components/drop-mode/specs/text-range-move.ts`, `allowedPlacements:
   ["inline-cursor"]` ONLY. The vertical-caret placement + indicator already
   exist (`hit-test.ts` `makeInlineCursorPlacement`); over text → a caret, in a
   block gap → no placement (inert — the L3f-3 boundary). `classifyDrop`:
   self-drop (caret within `[from,to]`) → `no-op`, else `apply`. `applyDrop`:
   `slice = doc.slice(from,to)` with **every `linkedAnchor` mark STRIPPED**
   (`stripLinkedAnchorMarks`, mirroring `LinkedAnchorGuard.transformPasted` — the
   moved text sheds anchor identity, consistent with paste), then same-editor
   `delete(from,to)` + `replace(adjustedInsert, slice)` (the `insertPos > to ?
   −(to−from)` offset from block-move; the `tr.replace(pos,pos,slice)` + select
   from stack-pull) / cross-editor insert-then-delete. Wired via `lookupSpec`,
   which now takes the FULL cardKey: `textobject:linkedRange:<id>` shares the
   `textobject:` prefix with every block lift but routes to this spec (a
   selection moves as a SLICE, not a block) — the one carve-out, kept in
   `registry.ts`; the controller passes `opts.cardKey` instead of the prefix.
7. **Transient cleanup (L3f-1's deferred sites, now closed).**
   `removeTransientAnchor(editor, ref.id)` (guarded) is called AFTER
   `commitDropSession()` in the ghost-mode move branch AND in `cleanup()` for the
   cancel/abort path, both gated on `ref.kind === "linkedRange"`. On an actual
   move the marked text was deleted (the mark went with it) and the inserted copy
   was already stripped, so the call no-ops; on a no-op drop or a cancel the mark
   still sits on the source, so it's removed. The committed + popout paths null
   `liveOverlay` before `cleanup()`, so cleanup doesn't double-handle (move strips
   in `onUp`, popout-close via the L3f-1 `useTransientAnchorCleanup` watcher). The
   guard means a grab that REUSED a real annotation's full-coverage range never
   deletes that note/highlight/cut/revision.
8. **DRY — one resolver.** `findLinkedAnchorRange` extracted from
   `linked-range-body.tsx` to a shared `src/lib/linked-anchor-range.ts`, consumed
   by the float, the two registry hooks (via `linkedAnchorDomRange`), and the move
   spec. `stripLinkedAnchorMarks` co-located there (mirrors `transformPasted`).

**Verify.** `tsc` 0; `eslint` no NEW errors (the one pre-existing
`react-hooks/immutability` error on `LiftedTextOverlay.tsx`'s clone predates
this work — confirmed by linting HEAD; my files add 0 errors / 0 warnings);
`vitest` **332/332** (319 + 13 new: `linked-anchor-range.test.ts` —
findLinkedAnchorRange over single/gap/multi-paragraph ranges + stripLinkedAnchorMarks
surgical strip & open-depth preservation; `text-range-move.test.ts` — the
inline-cursor-only scope guard + no-op paths). **Live (real dev doc, fresh
`.next-preview`, every eval `6*7`-sentinelled, editor reached via the
ProseMirror fiber):** the DOM primitives the hooks rely on behave on real marked
content — `cloneContents` → non-empty ghost text (176 / 68 chars), `getClientRects`
→ a sensible column-width `liftSourceRect` (302 / 261 px after the width fix), no
throws; the move logic on a real range, built into a transaction and inspected
WITHOUT dispatching (live doc untouched) — the run lands at the caret exactly, the
moved copy carries no `linkedAnchor`, the anchor id is gone from the doc; the
guard classifies a real `note` as NON-removable (protected) and a transient mark
as removable. The LIVE GHOST/DRAG can't be driven headlessly (synthetic mousemove
won't reveal the handle; a clone-harness is unfaithful) → handed to the user for
a trusted-hover eyeball: select → drag → an invisible-anchored ghost follows (no
green) → gutter pops the synced float (text stays) → page-over-text moves the run
to the caret.

**No regressions.** The element path is gated tightly (`isRange === false` for
every non-linkedRange kind; only `textobject:linkedRange:` routes off
`textObjectDropSpec`) and is behaviorally identical — paragraph/heading/list/
example/texBlock still ghost + pop-out + move exactly as before. L3f-1's transient
machinery, the annotation kinds, and the `linked-range-body` float content/sync are
unchanged. The pre-existing working-tree files (`EDITOR_SKILLS_BRAINSTORM.html`,
`src/hooks/useRecentlyAddedTracker.ts`, scratch `SKILL_PIPELINE.*`, and the foreign
untracked `CARD-SYSTEM-REFACTOR.md` / `EDITOR_SKILLS_V1.html` / `MEMO_V1_AND_ROT_PREVENTION.md`)
were left untouched and out of the commit.

## L3f-3 — Between-paragraphs (horizontal-line) drop for a lifted text range: context-aware wrapping — 2026-06-01

**What it does.** The second drop target the user described for a lifted plain
selection — the **between-paragraphs (horizontal-line)** drop, alongside L3f-2's
within-text (vertical-caret) move. Releasing the range ghost in a BLOCK GAP now
drops the run as BLOCK content, fit to the gap's context: a top-level gap → a new
paragraph, a list gap → a **list item** (joining the list, not splitting it), a
blockquote → a paragraph inside the quote. Block gaps were inert in L3f-2
(`text-range-move` was `inline-cursor` only); they're live now. **This completes
the reframed L3f** (selection as a transient grab): decouple (L3f-1) →
grab/pop-out/within-text-move (L3f-2) → between-paragraphs move (L3f-3, here).

**The pieces — all in the EXISTING `text-range-move` spec (no new spec).**
1. **`allowedPlacements: ["inline-cursor", "between-blocks"]`.** The hit-test's
   `inText`/`inGap` are mutually exclusive (`hit-test.ts:56-57`), so inline-cursor
   still wins over text (L3f-2 unregressed) and between-blocks fires only in gaps
   — the dual target with one array changed.
2. **`classifyDrop` self-drop.** Both placements carry a doc position (inline
   `pos` / block-gap `insertPos`); a release inside `[from, to]` → no-op.
3. **`applyDrop` between-blocks branch (the wrapping policy).** Kept in a sibling
   `applyRangeBetweenBlocks` so the L3f-2 inline body stays BYTE-FOR-BYTE
   unchanged (dispatched before it). It mirrors `textobject.ts`'s element
   block-move structure: `classifyParentAt(targetEditor, insertPos)` → a list gap
   wraps each block in a `listItem` (a bare paragraph would SPLIT the list —
   MEASURED, both in a unit harness and live), a blockquote / top-level gap takes
   the paragraph(s) directly (PM places a paragraph inside the quote at a
   quote-internal position). Then delete-source + adjusted-insert in one
   transaction (same-editor: `tr.delete(from,to)` then `tr.insert(cursor, n);
   cursor += n.nodeSize`) / insert-then-delete (cross-editor). The payload is the
   range's slice converted to blocks (NOT a whole node), with `linkedAnchor`
   stripped so the moved run sheds the transient handle (consistent with the
   inline move + paste).

**Range → blocks (the shared transform).** New `rangeSliceToBlocks(slice, schema)`
in `linked-anchor-range.ts`: an inline run (slice cut within one text block) → one
`paragraph`; a multi-block range → its blocks; empty → one empty paragraph. The
float's `sliceAsDoc` (`linked-range-body.tsx`) was refactored to delegate to it, so
the float and the move share ONE range→blocks transform (the DRY move from L3f-2's
`findLinkedAnchorRange` / `stripLinkedAnchorMarks`). A within-one-paragraph fragment
becomes its OWN new paragraph (NOT merged — that's the inline move's job); a range
covering whole paragraphs' entire CONTENT leaves one empty shell where it was (the
same cut semantics `delete(from,to)` gives the inline move — the common phrase-
within-a-paragraph case leaves no shell).

**DRY — `classifyParentAt` extracted.** Lifted into a shared
`src/components/drop-mode/specs/drop-context.ts` (the canonical home), consumed by
this spec via `buildWrap`'s context-fit pattern. `textobject.ts` keeps a private
twin (left UNTOUCHED this session per the "don't modify the element-move spec"
constraint) — flagged in `drop-context.ts` to unify the next time that file is
edited.

**Routing / cleanup — already wired (confirmed, no new site).** `lookupSpec`
already carves `textobject:linkedRange:` to this spec (L3f-2, `registry.ts`) — no
registry change. Transient cleanup is the grab handle's
`removeTransientAnchor`-after-commit (guarded to `kind:"transient"`, so a grab that
reused a real note/highlight/cut/revision never deletes it); a between-blocks move
goes through the same `commitDropSession`, so it is already covered.

**Verify.** `tsc` 0; `eslint` 0 new (clean on all six touched/new files); `vitest`
**341/341** (332 baseline + 6 between-blocks in `text-range-move.test.ts` —
top-level / list / blockquote wrap, multi-block preserve, between-blocks self-drop
no-op, each asserted by building the `tr` and inspecting `tr.doc` WITHOUT dispatch —
+ 3 `rangeSliceToBlocks` in `linked-anchor-range.test.ts`). **Live (real dev doc,
fresh `.next-preview`, every eval `6*7`/`7*8`-sentinelled, two agreeing runs, editor
via `.ProseMirror.editor`):** replicated the move on a real phrase for all three
contexts, built the `tr`, ran `tr.doc.check()` (valid) WITHOUT dispatching (the live
doc stayed untouched — confirmed) → top-level → a `paragraph` in `doc`, list → a
`listItem` in `bulletList`, blockquote → a `paragraph` in `blockquote`; real
`ParagraphWithTitle` / `listItem` NodeView construction works; no `linkedAnchor`
mark in the moved copy. The LIVE GHOST/DRAG can't be driven headlessly → handed to
the user for a trusted-hover eyeball: select a phrase → drag → drop in a top-level
gap (new paragraph) / a list gap (list item) / a blockquote (paragraph in quote),
and confirm the within-text caret move (L3f-2) still works over text.

**No regressions.** The inline-cursor (within-text) move is byte-for-byte unchanged
(the between-blocks branch is a sibling function dispatched before it);
`textobject.ts` (element-kind moves), the lifted-overlay grab/ghost, and the
`linked-range-body` float's sync are untouched. The pre-existing working-tree files
(`EDITOR_SKILLS_BRAINSTORM.html`, `src/hooks/useRecentlyAddedTracker.ts`) and the
untracked scratch files (`SKILL_PIPELINE.*`, `CARD-SYSTEM-REFACTOR.md`,
`EDITOR_SKILLS_V1.html`, `MEMO_V1_AND_ROT_PREVENTION.md`, `docs/card-refactor/`)
were left untouched and out of the commit.

**Next.** The remaining arc: the **9 bodyless kinds** (build a float body +
`liftMode` flip each — `listItem`, `exampleItem`, `figureBlock`, `graphicsBlock`,
`blockquote`, `codeBlock`, `displayMath`, `titleField`, `latexComment`), then **L4**
(retire `liftMode` / `initialFloatSize` / the vestigial grow burst).

## L3f-4 — Selection-bug A: popout fidelity for the plain-selection float ("Text selection" label + full-schema body via the FCU factory) — 2026-06-01

**Commit:** `c02e8bf`.

**Framing — `linkedRange` does DOUBLE DUTY.** One registry kind backs BOTH the
transient plain-selection grab (a cardless `kind:"transient"` linkedAnchor,
L3f-1) AND the real annotation kinds (note/highlight/cut/revision, which carry a
`linkCard`). Two popout bugs both stemmed from the `linked-range-body` float not
faithfully representing a *plain selection*. Scope was label + body ONLY
(selection-bug A of three; B = uuid backfill, C = inline-commit; file-disjoint —
touched only `linked-range-body.tsx` + the `linkedRange` registry entry + a new
test).

**Bug (1) — header read "Linked range" for a plain selection; should read "Text
selection".** Fix: add `linkedRange.computeLabel(editor, ref)` (mirrors
heading's) — walk to the linkedAnchor mark at `ref.id`; `kind==="transient"` →
`"Text selection"`, else `null` so a real annotation falls back to `meta.label`
"Linked range" (untouched). **Observe-first caught an INCOMPLETE cause:** the
brief implied `computeLabel` alone fixes the popout, but the RELEASED float
header is `TextObjectFloat`'s `labelOverride ?? meta.label` — it does NOT read
`computeLabel`; only the lift-overlay's popout-mode header does (via
`TextObjectGrabHandle`'s `meta.computeLabel ?? meta.label`). So the body must
ALSO push the label: a new `setHeaderLabel` effect in `linked-range-body` calls
the SAME `linkedRange.computeLabel` (the ONE source), so both surfaces reflect
the mark's true nature and can't drift. A `computeLabel`-only fix + a
`computeLabel` unit test would have PASSED while the real popout stayed "Linked
range" — the exact observe-first trap this arc keeps warning about.

**Bug (4) — popout went BLANK when the range held lists / display math /
figures / examples.** Cause (proven live): the body built its editor from a
NARROW hand-rolled StarterKit subset missing `DisplayMath` / `FigureBlock` /
lists / `ExampleBlock` / `heading` / etc.; TipTap's `errorOnInvalidContent:
false` SILENTLY DROPPED those nodes on seed → the float's doc collapsed to one
empty paragraph (the float editor's schema literally lacked the node types).
**Fix (FCU mandate — this was the LAST float not on the factory):** rewire to
`buildEditorExtensions({ surface:"float", editable, cardContext, callbacks,
docIdRef, host })` — the shared stack every other prose float uses.
`surface:"float"` omits the doc-wide numberers/folding (a popped range never
renumbers); `docIdRef` threaded from `useDocWriteHandleOrNull` (like list-body)
so figures render their real image; the heading/figure callback refs threaded (a
range CAN hold a heading/figure, unlike a paragraph float). The JSX drops its
manual `.par-title-wrapper` — the factory's paragraph NodeView now wraps each
block itself (matching paragraph-body/list-body). The bidirectional sync
(`readSource`/`writeBackToMain` via `rangeSliceToBlocks`) is UNCHANGED — the
factory only WIDENS the schema.

**Observe-first verification (the arc's measure-first rule; fresh
`.next-preview`, popped-cards `popOutAtRect` path, sentinel-cross-checked, two
agreeing runs each).** PRE-FIX, on the real released float: a transient grab's
header read "Linked range"; a range spanning a list + figure + 2 display-math +
example + headings popped BLANK (`floatBodyTextLen` 1, doc `["paragraph"]`, and
the float schema had `displayMath` / `figureBlock` / `bulletList` /
`exampleBlock` / `heading` ALL absent — the smoking gun, independent of any
catch-logging). POST-FIX, the same range: header "Text selection"; the body
renders the list (3 `<li>`), display math (12 KaTeX), figure (2 `<img>`) +
examples + headings (`floatBodyTextLen` 2916); a real note's range still reads
"Linked range" (non-goal preserved); an edit in the float writes back to main (a
sentinel inserted in the float reached the main doc). Screenshot confirms.

**Write-back observation (PRE-EXISTING, OUT OF SCOPE — `writeBackToMain`
unchanged).** Newly REACHABLE now that multi-block ranges render: editing a float
over a MULTI-block range writes content back faithfully at the node level (every
type survives `nodeFromJSON`/`toJSON`), but `replaceWith(r.from, r.to, blocks)`
over a text-bounded range that spans blocks can leave a structural artifact
(observed: an extra wrapping `bulletList`). `findLinkedAnchorRange` always returns
text-node bounds, so write-back endpoints are always mid-block. This is
`writeBackToMain`'s `replaceWith` behavior (untouched here) — before this fix the
multi-block float was blank/uneditable, so it was never exercised; the fix is a
strict improvement (content preserved vs. dropped). Flagged for a follow-up
(possibly folded into selection-bug B/C); not addressed here per scope.

**Verify.** `tsc` 0; `eslint` 0 new; `vitest` **348/348** (341 + 7 new in
`src/text-objects/__tests__/linked-range-popout-fidelity.test.ts`: `computeLabel`
transient→"Text selection" / note·highlight·cut·revision→null / missing→null,
and the `surface:"float"` schema including the rich node types + round-tripping a
multi-block heading+list+paragraph doc). Diff isolated to `linked-range-body.tsx`
+ the `linkedRange` registry entry + the new test; the pre-existing working-tree
files (`EDITOR_SKILLS_BRAINSTORM.html`, `src/hooks/useRecentlyAddedTracker.ts`)
and the untracked scratch files (`SKILL_PIPELINE.*`, `CARD-SYSTEM-REFACTOR.md`,
`EDITOR_SKILLS_V1.html`, `MEMO_V1_AND_ROT_PREVENTION.md`, `docs/card-refactor/`)
left untouched and out of the commit.

**Non-goals respected.** The annotation kinds (note/highlight/cut/revision) —
colour, card, rendering — unchanged; (1) renames only the transient case. The
move/drop (selection-bugs B+C), the transient-mark logic (L3f-1), and the
lifted-overlay grab untouched. The other floats already consume the factory
(unchanged); the `editor-extensions.test.ts` float-order gate still passes.

## L3f-5 — Selection-bug B: universal block-uuid backfill — every inserted block is immediately graspable — 2026-06-02

**Commit:** `f80939a`.

**Bug (2).** A lifted text range dropped into a block gap (the between-paragraphs
drop, L3f-3) lands as a paragraph with NO grab handle — it has lost its
text-object identity.

**Cause (proven live + by code).** `rangeSliceToBlocks`' inline branch builds
`schema.nodes.paragraph.create(null, …)` → `uuid` defaults to null (so do paste
and any slice insertion). The grab handle finds graspable blocks via
`querySelectorAll("[data-uuid]")` (`resolveTextObjectsAtMouse`), and
`UuidAttrDecorator` emits `data-uuid` ONLY for a non-null uuid; uuids are
otherwise minted LAZILY on interaction (`ensureAnchorUuid`) — but a handle-less
block can't be interacted with to trigger that mint (chicken-and-egg). Live
non-destructive proof (build-tr-then-inspect, no dispatch): the dropped node's
`attrs.uuid` was `null` while the 89 existing blocks all rendered `[data-uuid]`.

**Fix — ONE transaction-time backfill (NOT a per-call-site patch).** New
`BlockUuidBackfill` (`src/lib/tiptap/block-uuid-backfill.ts`), an
`appendTransaction` plugin registered right AFTER `DocStructureObserver` in
`buildEditorExtensions` (index 2, shared by both surfaces). It guarantees every
anchorable block carries a unique non-null uuid by the end of its insertion
transaction, so drops/pastes/splits are immediately graspable. `ensureAnchorUuid`
stays as the lazy belt-and-suspenders; `assignUuids` (latex-serializer) is the
load-time sibling — this is its live-insertion complement. Block identity is now
centralized for ALL insertions (drop, paste, split, programmatic).

**Observe-first correction (the arc's measure-first rule caught the brief's
mechanism).** The brief said to key on `diff.addedBlocks`. But the step-inspector
records a block in `added.blocks` ONLY when it already has a non-null,
non-duplicate uuid (`inspectNodeAt`: `if (uuid && isAnchorableNode)`, plus the
`prevStructure` filter routing duplicate-uuid adds to `contentChangedUuids`). So
a freshly-inserted null/duplicate-uuid block — exactly the case we fix — is
INVISIBLE to `diff.addedBlocks`; keying on it would catch NEITHER target case
(confirmed by code + the live repro: a top-level null-uuid insert yields
`EMPTY_DIFF`). The plugin instead reads the INSERTED STEP RANGES
(`ReplaceStep`/`ReplaceAroundStep`, mapped to the final doc the same way the
observer's own `collectRange` does) — O(edit-size), never a full-doc walk.

**Keystroke safety (binding).** O(1) bail on `!tr.docChanged`; work proportional
to the inserted ranges only; the single O(live-block-count) read (the observer's
known-uuid set via `readDocStructure(oldState)`, for collision-free minting +
dedup) happens ONLY once a candidate actually needs an id — never on a
structurally-null keystroke (inline insert → no block-start in range → zero
candidates → early return before any doc-sized read). Loop-safe: one size-stable
`setNodeMarkup` per fix, `addToHistory:false`, tagged with a meta the plugin
skips, returns null when nothing needs fixing (mirrors `MarginaliaAnchorGuard`) —
after the backfill every touched block is unique, so a re-walk finds nothing.

**Identity preservation (moves + float sync).** A uuid is re-minted only when it
is a GENUINE duplicate: still live from before the batch AND not the subject of a
removal in the same batch (and not already kept earlier this pass). So a block
MOVE (lifted-overlay's own gesture: delete-here + insert-there) keeps its uuid —
the source removal exempts it — and a float↔main `setContent` re-sync (every
synced block is both removed and re-inserted with its main uuid) keeps every uuid
too. Only real copies (an Enter-split's cloned half, a block copy) get a fresh
id. Without this, every move/sync would churn uuids and orphan the block's cards.

**Observe-first verification (live, fresh server, sentinel-cross-checked,
non-destructive — build/dispatch then restore; dev doc left at 89 blocks).**
KEYSTROKE: typing 30 plain chars left `__virgilBusStats().emitCount` FLAT (Δ0)
while `version` advanced 30 and the full block-uuid set was identical (zero
churn) — proof the plugin did no backfill on structurally-null edits (a backfill
= a `setNodeMarkup` → `addedBlocks` → `emitCount++`). DROP: a null-uuid paragraph
dropped into a gap came out with a unique 4-hex uuid, rendered
`[data-uuid="bcc1"]` (`data-text-object-kind="paragraph"`) in the live DOM →
graspable, and `emitCount` bumped exactly 1 (the backfill made it a real block;
pre-fix it would be 0). PASTE: three null-uuid blocks each got a unique 4-hex
uuid, all three rendered `[data-uuid]`.

**Verify.** `tsc` 0; `eslint` 0 new; `vitest` **353/353** (348 + 5 new in
`src/lib/tiptap/__tests__/block-uuid-backfill.test.ts`: null+duplicate dedup
keeping the first occurrence, single-drop graspability, the keystroke no-op
proven via `applyTransaction` returning a SINGLE transaction, move-preserves-uuid
also a single transaction, and multi-block paste). The `editor-extensions.test.ts`
order gate updated (`blockUuidBackfill` at index 2 on BOTH surfaces). Diff
isolated to the new plugin + its registration + the two tests; the pre-existing
working-tree files (`EDITOR_SKILLS_BRAINSTORM.html`,
`src/hooks/useRecentlyAddedTracker.ts`) and the untracked scratch files
(`SKILL_PIPELINE.*`, `CARD-SYSTEM-REFACTOR.md`, `EDITOR_SKILLS_V1.html`,
`MEMO_V1_AND_ROT_PREVENTION.md`, `docs/card-refactor/`) left untouched and out of
the commit.

**Non-goals respected.** `rangeSliceToBlocks` and the drop spec were NOT patched
(the backfill is universal, not a per-call-site fix); `ensureAnchorUuid` kept;
the popout/label (selection-bug A) and inline-commit (C) untouched; no marks
changed.

## L3f-6 — Selection-bug D: multi-paragraph popout spacing drift on release — the ghost's em cascade base — 2026-06-02

**Commit:** `b011ea3`.

**Bug (live, user-observed).** Popping out a plain text SELECTION: on RELEASE
(drag ghost → released popout) the spacing visibly EXPANDS — between-paragraph,
between-line, AND between-letter (noticeable in math) — but ONLY for
MULTI-paragraph selections; a single paragraph is seamless.

**Cause — PROVEN by measurement (the brief's theory was wrong on both counts).**
The brief floated "the ghost copies line-height as a pixel value / the popout
drifts looser." Measured on the live dev doc (fresh `.next-preview`, two agreeing
runs) at the shipped `--editor-font-size: 0.95rem` (15.2px) default:
- **PAGE ≡ POPOUT, exactly** — `.par-title-wrapper` 16px, inter-block gap 19.2px,
  `<p>` 15.2px / line-height 24.32px, display-math KaTeX 19.36px. The released
  popout (selection-bug A's FCU-factory float) does NOT drift; "popout looser" is
  disproven.
- **The GHOST drifts TIGHTER.** `linkedRange.renderGhost` copied the source
  block's inner `<p>` (PROSE) computed font-size (`--editor-font-size` = 15.2px)
  onto the bare `.tiptap` container. A MULTI-block `cloneContents` keeps the
  source blocks' WRAPPERS (`.par-title-wrapper`, `.display-math`, …) as direct
  children of that container, and they resolve their `margin-top:
  var(--editor-block-gap)` (1.2em) — and a `displayMath`'s em-sized KaTeX —
  against the container's font-size. The page resolves those `em`s against the
  editor ROOT (`.ProseMirror` = 1rem/16px), NOT the prose 15.2px, so every
  em-relative inter-block measure shrank by 15.2/16:

  | property            | PAGE / POPOUT | GHOST (pre-fix) |
  | ---                 | ---           | ---             |
  | paragraph gap       | 19.2px        | 18.24px         |
  | display-math gap    | 12px          | 11.4px          |
  | display-math KaTeX  | 19.36px       | 18.392px        |

  On release to the popout (root base) they all GROW ~5% → the reported
  letter+line+paragraph expansion. The prose `<p>` font-size / line-height /
  letter-spacing NEVER drift (they come from `.tiptap p`, identical on every
  surface), and inline math — inside a 15.2px `<p>` on both surfaces — doesn't
  either: the symptom is purely the em cascade base of the cloned WRAPPERS.

**Why multi-paragraph only.** A single-block range's `cloneContents` yields a
bare inline run with NO wrapper or `<p>`, so there is no em-relative inter-block
margin to mis-resolve and the run correctly inherits the container's prose size.
The bug needs cloned block wrappers, i.e. ≥2 top-level blocks. It also needs
`--editor-font-size ≠ 1rem`; the `510888b` prefs promotion shipped 0.95rem as the
default, which is why it surfaced now. It traces to selection-bug A: before A the
popout was a hand-rolled subset, but the ghost↔popout fidelity contract (L1.12)
only became measurable once A made the popout a faithful root-base `.tiptap`.

**Fix — align the em base, not each property (mirrors the heading ghost +
L3d.2).** For a range spanning multiple top-level blocks
(`$from.index(0) !== $to.index(0)`), the container's font-size is the editor ROOT
(`getComputedStyle(editor.view.dom).fontSize`) instead of the inline prose size.
The cloned `<p>`/`<h*>` still take their prose size from `.tiptap p` / `.tiptap
h*` (those rules reach the clone via the `.tiptap` scope), so ONLY the wrappers'
em base moves — every inter-block gap and display-math glyph now resolves like
the page. A SINGLE-block range keeps the inline element's size (a heading run
must stay heading-sized) — byte-identical to the pre-D path. This is the same
insight the heading-kind `renderGhost` already encodes ("editor ROOT base because
its clone holds whole blocks") and that L3d.2 applied to the overlay root.

**Verify (measured, two agreeing runs, non-destructive — replicated
`renderGhost`'s exact construction off-DOM and removed it; the dev doc was
refreshed from `samples/annotation-history` first).** NEW logic on the
multi-block math range: paragraph gap 18.24→**19.2**, display-math gap
11.4→**12**, display-math KaTeX 18.392→**19.36** — all == the page (sub-pixel).
SINGLE-block range: container/run font-size 15.2px under BOTH old and new logic —
byte-identical, no regression. POPOUT re-measured on a real multi-paragraph
linked range == page. `tsc` 0 new (one PRE-EXISTING error in
`block-uuid-backfill.test.ts` predates this change — confirmed by stashing the
fix and re-running); `eslint` 0 new; `vitest` **353/353**. The live drag ghost
can't be driven headlessly (RAF-gated gesture) → handed to the user as the
real-gesture check (release a multi-paragraph selection with math: no spacing
jump on release).

**Non-goals respected.** Only `linkedRange.renderGhost` changed; the FCU-factory
popout (selection-bug A), `writeBackToMain` (queued follow-up),
`blockStyleElement`, and the element-kind ghosts / overlay capture are untouched.
The pre-existing working-tree files (`EDITOR_SKILLS_BRAINSTORM.html`,
`useRecentlyAddedTracker.ts`, the TEMP-SELC instrumentation in `controller.ts` /
`text-range-move.ts` / `TextObjectGrabHandle.tsx` for selection-bug C) and the
untracked scratch files left untouched and out of the commit.

## L3f-7 — Selection follow-up: writeBackToMain multi-block artifact — text-bounded range replaced with closed blocks — 2026-06-02

**Commit:** `16fb943`.

**Bug (reachable since selection-bug A made the multi-block popout editable).**
Editing a popped-out plain-selection / linked-range float that spans ≥2 top-level
blocks (esp. one touching a list) and writing back left a structural artifact in
the main doc — an extra wrapping list / split boundary paragraphs. Single-block
ranges were unaffected. (This was the write-back observation flagged out-of-scope
in L3f-4, now addressed.)

**Cause — PROVEN (deterministic unit repro on the REAL float schema + a
non-destructive real-doc confirm).** `writeBackToMain` replaced the TEXT-bounded
mark range `[from,to)` (from `findLinkedAnchorRange`, often mid-paragraph) with
FULLY-CLOSED block nodes via `tr.replaceWith` (a Slice with openStart=openEnd=0).
Inserting closed blocks across an open, mid-text boundary forces PM's fitter to
split the boundary paragraphs and, when the range touches a list, wrap an extra
list. The seed extraction (`doc.slice(from,to)`, openStart/openEnd > 0 for a
mid-block cut) and the write-back were not inverses. Numbers:
- Canonical `paragraph · bulletList · paragraph`, mark spanning mid-p1 → mid-p3:
  `doc.slice` openStart/openEnd = **1/1**; `replaceWith` → childCount **3 → 5**
  (`[paragraph, paragraph, bulletList, paragraph, paragraph]` — both boundary
  paragraphs split), `tr.doc.eq(doc)` = false.
- `paragraph · bulletList`, mark spanning mid-p1 → inside the first list item:
  `doc.slice` openStart/openEnd = **1/3**; `replaceWith` → bulletLists **1 → 2**
  (the extra wrapping list, L3f-4's observed artifact).
- Real live dev doc (non-destructive build-tr-then-inspect, never dispatched):
  `replaceWith` → childCount **66 → 68**, an extra list; the open-slice replace →
  **byte-identical** (`tr.doc.eq(doc)` true). `text-range-move.ts` already avoided
  this by inserting the OPEN `doc.slice` via `tr.replace` — write-back was the lone
  outlier.

**Two observe-first corrections of the brief (measure-first caught both).**
(1) `tr.docChanged` (steps.length>0) is NOT a reliable structural-no-op oracle: a
`tr.replace` over a non-empty range ALWAYS records a step even when the result is
byte-identical. The acceptance oracle is `tr.doc.eq(doc)`, not `!docChanged` (the
`if (!tr.docChanged) return` guard is kept, but it no longer fires on an unedited
round-trip — harmless: in production the float→main sync uses `setContent(...,
{emitUpdate:false})`, so `writeBackToMain` only fires on a genuine edit, tagged
`FLOAT_WRITE_META`). (2) Reusing the cut's open depths UNCLAMPED can build a
malformed Slice when a float edit restructures the leading/trailing block (e.g.
appends a paragraph after a list whose tail the cut opened 3 deep → last block is
a depth-1 paragraph but openEnd=3) → `tr.replace` THROWS, which the try/catch
swallows, SILENTLY DROPPING the edit. The closed `replaceWith` never threw (it
always mangled instead). The fix clamps via `Slice.maxOpen`.

**Fix — make write-back the named inverse of `rangeSliceToBlocks` (open-slice
discipline).** Added `blocksToRangeSlice` to `src/lib/linked-anchor-range.ts`, the
inverse of `rangeSliceToBlocks`: it replaces `[from,to)` reusing the current
`doc.slice(from,to)` open depths (block range) or unwrapping the single wrapping
paragraph (inline range), each depth CLAMPED to what the edited blocks support
(`Slice.maxOpen`) so a restructured edit can never throw / drop the write-back.
An unedited round-trip is byte-identical; an edited one lands exactly the edit
with the boundary paragraphs preserved (no split, no extra list). `writeBackToMain`
now calls it via `tr.replace` (guards / `addToHistory:false` / `FLOAT_WRITE_META`
/ `docChanged` short-circuit / range re-track / try-catch preserved; range
re-track is now `from + slice.size`). O(range-size); no per-keystroke doc walk.
Left the move untouched — it already follows the open-slice discipline (a one-line
note in `linked-anchor-range.ts` records this). Scanned the class: the other
floats' `writeBackToMain` (paragraph/heading/list/example) replace WHOLE-NODE
ranges (`src.start`/`src.end`/`pos`+`nodeSize`, where a closed Slice fits
trivially), not text-bounded ranges — out of scope; tex-block uses `setNodeMarkup`.

**Verify.** New `src/lib/__tests__/linked-range-writeback.test.ts` (10 tests,
real float schema via `getSchema(buildEditorExtensions({surface:"float"}))`):
closed-block `replaceWith` mangles a multi-block range (3→5) / wraps an extra list
at a list boundary (1→2); `blocksToRangeSlice` LAW (`slice.eq(cut)`, open depths
reused); unedited multi-block round-trip byte-identical (the acceptance oracle —
pre-fix the `replaceWith` form of this assertion FAILED, captured); edited
multi-block lands exactly the edit, childTypes unchanged, no extra list; boundary
edit merges into the host paragraph; list-boundary byte-identical; inline range
unwraps (no-op + edited); robustness — a restructured edit (trailing paragraph
after a list) never throws / drops the write-back. `linked-range-popout-fidelity`
still green. `tsc` 0 new (the pre-existing `block-uuid-backfill.test.ts(27,7)`
error predates this — confirmed by reverting the three changed files and
re-running: the identical lone error remains); `eslint` 0 new; `vitest`
**363/363** (353 + 10 new). Real released popout (headless popped-cards path on
the live dev doc): the multi-block range pops and renders faithfully (childCount
2, `[paragraph, bulletList]`), and the live transform confirms the artifact +
fix non-destructively (above). The FULL float-edit → `writeBackToMain` → dispatch
round-trip could not be driven headlessly — `popOutAtRect` does not thread the
main `editorRef` into the popped float the way the real grab gesture does, so
`writeBackToMain` early-returns (`!ed`); handed to the user as a USER-VERIFY probe
(pop a multi-block selection incl. a list, edit it, confirm no extra wrapping list
/ split in the main doc). The production write-back wiring is unchanged and the
single-block write-back already works, so only the transform construction changed.

**Non-goals respected.** Float schema (A), `findLinkedAnchorRange` semantics,
`useFloatMainSync`, label logic (L3f-1), the drag ghost (D), the other floats'
whole-node write-backs, the move spec's behavior, the 9 bodyless kinds, and L4
left untouched. The pre-existing working-tree files (`EDITOR_SKILLS_BRAINSTORM.html`,
`useRecentlyAddedTracker.ts`) and untracked scratch (`CARD-SYSTEM-REFACTOR.md`,
`EDITOR_SKILLS_V1.html`, `MEMO_V1_AND_ROT_PREVENTION.md`, `SKILL_PIPELINE.*`,
`docs/card-refactor/`) left out of the commit.

## L3g — Bodyless kinds Chip 1: PROSE lift floats (blockquote + codeBlock) via a shared SingleBlockBody — 2026-06-02

**Commit:** `637c019`.

**What.** First of the 9 bodyless-kind migrations. Built ONE generic
`SingleBlockBody` (editable single-whole-block float, modeled on paragraph-body:
seed-by-uuid → `buildEditorExtensions({surface:"float"})` → whole-node
`replaceWith` write-back rebuilt from MAIN's own attrs → `useFloatMainSync`) and
migrated **blockquote** + **codeBlock** onto it — the FCU endgame (one shared
body, many kinds, like `ListBody`), NOT two hand-rolled bodies. Kind is resolved
from the cardKey via `parseTextObjectPopoutKey` (no `kind` prop, no
prop-contract change) and drives a tiny per-kind config
`{schemaType, floatIdPrefix, sourceKind}`. `editable:true` (like list/example,
not paragraph's chrome-gated flag); threads the 3 proxied callback refs + `host`
like paragraph-body (meaningful for blockquote's nested `+T` paragraphs);
`docIdRef:null` (neither kind holds a figure). Each kind = 3 touch-points:
register the body (floats/index.ts), a `popoutKeyForLift` case
(TextObjectGrabHandle.tsx — also `export`ed for the test), `liftMode:"lifted-overlay"`
(registry). Added blockquote/codeBlock to `FloatSourceKind` + `KIND_LABEL`. Both
were already in the float schema (no factory change). No
`renderGhost`/`liftSourceRect`/`computeLabel` needed (single text-top block;
static `meta.label` "Block quote"/"Code block").

**Observe-first.** Confirmed the baseline gap live: forcing the popped-cards path
for `textobject:blockquote:<uuid>` rendered NO working body (placeholder, no
`.par-float-body`) while a paragraph control through the same path rendered one —
and `popoutKeyForLift` returns null for both kinds (read firsthand), so the lift
gesture never even reaches the popout path. After (real released popouts on the
dev doc via the popped-cards path, NOT a clone harness): both render faithfully —
blockquote as a `<blockquote>` whose computed style is byte-identical to the
page's (this sample styles blockquote with no left border / no indent; the float
MATCHES exactly — fidelity is float===main, not a hardcoded "border"), with its
paragraph's inline `+T` title affordance; codeBlock as a monospace `<pre>`
(`Geist Mono`, `white-space:pre-wrap`). Edits round-trip to the source node:
typed markers into each float and cross-checked the MAIN editor's node text
(blockquote tail `…school of thought.ZZBQ`, codeBlock tail
`…nested structure.}ZZCODE`). Source-missing banner (delete the source from
main): shows the right per-kind label — "Source quote deleted" /
"Source code block deleted". No blank popout. The lifted drag GHOST needs a
trusted hover (synthetic mousemove won't reveal the grab handle) → handed to the
user as a USER-VERIFY probe (below).

**Verify.** New deterministic wiring test
(`src/text-objects/__tests__/single-block-lift-wiring.test.ts`): `popoutKeyForLift`
non-null + `=== textObjectPopoutKey` for both kinds (was null), still-null for a
not-yet-migrated control (`displayMath`), `liftMode === "lifted-overlay"` for
both, and ONE shared `SingleBlockBody` registered for both (the body barrel is
imported for the side-effect registration, with `@/lib/storage` stubbed — the
linked-range-popout-fidelity precedent). `vitest` **367/367** (363 + 4 new); `tsc`
1 error (pre-existing `block-uuid-backfill.test.ts(27,7)` only — counted with
`grep -c`); `eslint` 0 new (0/0 on the changed files; grab handle keeps its 3
pre-existing warnings). Keystroke sanctity: typing 25 plain chars in MAIN left
`__virgilBusStats().emitCount` flat (Δ0, version +25) — float-only bodies on the
established `useFloatMainSync` seam, no main-editor per-transaction work.

**Gotcha (eslint `react-hooks/refs`).** The new react-hooks v6 compiler rule
flags the established float-body pattern (reading `ref.current` and reassigning
the proxied callback refs during render) — BUT it BAILS the whole component when
it sees any `react-hooks` eslint-disable directive inside it. Every sibling body
carries the `// eslint-disable-next-line react-hooks/exhaustive-deps` on its seed
`useMemo`, which is why they show 0 refs errors; a fresh copy of paragraph-body
with the comment also lints clean, but stripping the comment surfaces 8 refs
errors. So the comment must STAY and be genuinely *used* (incomplete deps — omit
`mainEditor`, like paragraph-body) to avoid an "unused directive" warning. The
next bodyless-kind bodies will hit the same thing.

**USER-VERIFY (drag ghost).** In the dev doc, hover the left gutter beside the
blockquote (and the code block) to reveal the grab handle; drag it. With the
cursor in the content zone the overlay shows the GHOST (a faithful clone of the
block); move into the gutter/beyond and it flips to popout-mode chrome
("BLOCK QUOTE" / "CODE BLOCK" header). Release in the gutter → the real float
spawns at the overlay's rect. Confirm the ghost renders faithfully and the
released float matches the headless popout above.

**Non-goals respected.** The other 7 bodyless kinds (displayMath, titleField,
latexComment, figureBlock, graphicsBlock, listItem, exampleItem), titleField's
schema promotion, the FCU factory, and L4 untouched. `popoutKeyForLift`'s existing
cases and the done kinds' bodies/metas unchanged. Pre-existing working-tree files
(`EDITOR_SKILLS_BRAINSTORM.html`, `useRecentlyAddedTracker.ts`) + untracked scratch
(`CARD-SYSTEM-REFACTOR.md`, `EDITOR_SKILLS_V1.html`, `MEMO_V1_AND_ROT_PREVENTION.md`,
`SKILL_PIPELINE.*`, `docs/card-refactor/`) left out of the commit.

## L3h — Bodyless kinds Chip 2: displayMath READ-ONLY lift float — 2026-06-02

**Commit:** `78ecf71`.

**What.** Second bodyless-kind migration + the first READ-ONLY / first ATOM
lift float. Decision D (user): displayMath is "view & move only" — pop out to
see the rendered equation large + drag it; the formula is edited on the PAGE
via the existing KaTeX popover, never in the float. EXTENDED the L3g
`SingleBlockBody` (chose this over a sibling `AtomPreviewBody`): added an
`editable` flag + an attr-based atom empty fallback (`emptyAttrs:{latex:""}`)
to its per-kind config, so ONE body now serves blockquote/codeBlock (editable
prose) AND displayMath (read-only atom) with NO duplication of the seed/sync
scaffold — seed the displayMath atom by uuid → `buildEditorExtensions(
{surface:"float", editable:false})` → `useFloatMainSync` (main→float;
`onUpdate`/`writeBackToMain` wired only for editable kinds). The next chip's
EDITABLE latexComment atom is now one config row (`editable:true` +
`emptyAttrs`) — the whole-node write-back is already atom-compatible. 3
touch-points (register body, popoutKeyForLift case, liftMode) + displayMath in
`FloatSourceKind`/`KIND_LABEL` ("Source equation deleted"). Already in the
float schema (no factory change). No `renderGhost`/`liftSourceRect` (single
atom; em-base correct).

**Observe-first + the key risk.** Baseline: displayMath didn't pop out
(`popoutKeyForLift` null — also L3g's wiring control; updated that test). KEY
RISK proven + fixed on the REAL released popout (popped-cards path, NOT a clone
harness): the math NodeView's click fires `virgil-math-click` carrying
`getPos()` → the MAIN-targeted `MathPopover`/`handleMathSave`. In the read-only
float the atom sits at the float doc's pos 0, so a click DISPATCHED the event
with `pos:0` and OPENED the popover (`math-popover-display`, latex loaded) —
main `nodeAt(0)` was the titleField, so `handleMathSave` would mis-target (in a
doc with a displayMath at pos 0 it would corrupt the WRONG equation). Fix: gate
the NodeView click on `editor.isEditable` (threaded into `mathNodeView`, typed
`{isEditable:boolean}` — no new `any`). After: in-float click fires 0 events /
no popover (INERT); a PAGE click still fires with the CORRECT main pos (4845,
a292) — page editing of inline + display math UNCHANGED (main always mounts
TipTap-editable; read-only is the `readOnlyEnforcer` plugin). One gate covers
the whole read-only-embed class (both math NodeViews). Real popout also:
equation renders faithfully, KaTeX font-size == the page (em-base check:
**19.36px == 19.36px**), live-syncs when the page latex changes (appended
`+\gamma_{SYNCTEST}` on the page → popout updated, then reverted), source-missing
banner "Source equation deleted" on delete, no blank popout. Stale-build trap
hit + cleared (`rm -rf .next-preview` + restart; turbopack served the OLD
ungated NodeView on a plain reload — the gate lives in a mount-time NodeView).
Drag ghost → user-verify probe (below).

**Verify.** Wiring test extended (`single-block-lift-wiring.test.ts`):
displayMath now non-null `popoutKeyForLift` + `liftMode==="lifted-overlay"` +
the same shared `SingleBlockBody` + read-only
(`SINGLE_BLOCK_CONFIG.displayMath.editable===false`, `emptyAttrs:{latex:""}`);
the L3g "still null" control moved to `figureBlock`; blockquote/codeBlock still
pass + stay `editable:true`. `vitest` **372/372** (367 + 5 new); `tsc` 1
pre-existing only (`block-uuid-backfill.test.ts(27,7)`, `grep -c`); `eslint` 0
new (math.ts keeps its 3 pre-existing `no-explicit-any` on node/getPos/updated
— the new `editor` param is typed, not `any`; grab handle keeps its 3
pre-existing warnings); `emitCount` flat (Δ0, version +25) typing 25 plain
chars in MAIN — a float-only body + a click-handler guard add no main
per-transaction work.

**USER-VERIFY (drag ghost).** In the dev doc, hover the left gutter beside a
display-math equation to reveal the grab handle; drag it. With the cursor in
the content zone the overlay shows the GHOST (a faithful KaTeX clone); move
into the gutter and it flips to popout chrome ("DISPLAY MATH" header). Release
in the gutter → the real read-only float spawns at the overlay's rect. Confirm
the ghost's KaTeX matches the page size and the released float matches the
headless popout above (faithful render, inert in-float click, live-sync on
page edits).

**Non-goals respected.** The other bodyless kinds (latexComment, titleField,
figureBlock, graphicsBlock, listItem, exampleItem), the page math
popover/`handleMathSave` (PAGE editing unchanged — only the read-only float is
made inert), the FCU factory/schema (displayMath already in it), L3g behavior
(blockquote/codeBlock byte-identical — editable, write-back intact), and L4
untouched. Pre-existing working-tree files (`EDITOR_SKILLS_BRAINSTORM.html`,
`useRecentlyAddedTracker.ts`) + untracked scratch (`CARD-SYSTEM-REFACTOR.md`,
`EDITOR_SKILLS_V1.html`, `MEMO_V1_AND_ROT_PREVENTION.md`, `SKILL_PIPELINE.*`,
`docs/card-refactor/`) left out of the commit.

## L3h.1 — Math click→edit bridge gated on the MAIN surface (generalize L3h's isEditable gate) — 2026-06-02

**Commit:** `c204c13`.

**Bug (pre-existing, exposed verifying L3h; data-corruption risk).** The math
NodeView's click→edit bridge (`virgil-math-click` → `MathPopover` →
`handleMathSave`) edits the MAIN editor by absolute `pos`, so it's only correct
from the main surface. L3h gated it on `editor.isEditable` (fixing READ-ONLY
floats), but an EDITABLE float containing math (popped paragraph w/ inline math;
linkedRange float spanning a display equation — reachable since selection-bug A)
is `isEditable:true`, so its math click slipped through, firing with the FLOAT's
`getPos()` → `handleMathSave` mis-targeted MAIN at that wrong pos (opened the
popover on / could corrupt the WRONG node). Latent since paragraph floats
shipped.

**Cause — PROVEN.** Reproduced on a real editable float (popped-cards path, not a
clone harness; UNFIXED build via a stashed source revert + clean `.next-preview`
rebuild): popped paragraph `3311` (a `par-float-body`, `contenteditable=true`
EDITABLE float) carrying inline math; clicking the in-float inline math `T`
dispatched `virgil-math-click` with `pos 321` — the FLOAT-LOCAL pos (float doc
size 408; float maths `T@321`, `A@344`) — and opened the MAIN `MathPopover`
mis-targeted: main `nodeAt(321)` is a DIFFERENT text node ("book is, sooner or
later, to mark it…"), while that equation's TRUE main pos is `4758`. `isEditable`
is true for editable floats, so L3h's gate didn't catch them.

**Fix — gate on the MAIN surface (the true class).** Added a `surface` option to
`InlineMath` + `DisplayMath` (`addOptions`, default `"main"`), threaded
`this.options.surface` into the shared `mathNodeView`, and gated the click to
fire only when `surface === "main"` (kept `editor.isEditable` too — read-only
MAIN docs). The factory configures both math nodes
`.configure({surface: isFloat?"float":"main"})` like its sibling NodeViews. Now
math-click-to-edit fires from MAIN only and is inert in EVERY float (editable AND
read-only). Page math editing (inline + display) byte-identically unchanged. No
new `any` (surface is a string union; math.ts stays at its 3 pre-existing
node/getPos/update `any`).

**Verify.** Real walkthrough on the rebuilt FIXED build (clean `rm -rf
.next-preview` between the unfixed-repro and fixed-confirm rebuilds — the gate is
a mount-time NodeView): the SAME editable-float inline math `T` now fires 0
events / no popover (INERT); the read-only displayMath lift float (uuid `0ee9`,
`contenteditable=false`) stays inert (L3h preserved); PAGE inline math (`pos
4758`) AND display math (`pos 4845`) still open the popover at the correct pos,
and a real save persisted to the correct node (displayMath `a292` latex updated +
KaTeX re-rendered, popover closed). New gate test (`math-surface-gate.test.ts`:
`surface:"float"` click dispatches nothing; `surface:"main"`+editable fires;
read-only main inert; unconfigured defaults to main) + factory-wiring assertions
in `editor-extensions.test.ts`. vitest 380/380 (372 + 8 new); tsc 1 pre-existing
(`block-uuid-backfill.test.ts(27,7)`); eslint 0 new (math.ts stays at its 3
pre-existing `no-explicit-any`); `emitCount` flat (Δ0, version +12) typing 12
plain chars in MAIN.

**Non-goals respected.** `handleMathSave`/`MathPopover`/`marker-clicks` (page
editing) untouched; no float-aware math editing (decision D = read-only math
floats); bodyless sequence + L4 untouched. Pre-existing working-tree files
(`EDITOR_SKILLS_BRAINSTORM.html`, `useRecentlyAddedTracker.ts`) + untracked
scratch (`CARD-SYSTEM-REFACTOR.md`, `EDITOR_SKILLS_V1.html`,
`MEMO_V1_AND_ROT_PREVENTION.md`, `SKILL_PIPELINE.*`, `docs/card-refactor/`) out
of the commit.

## L3i — Bodyless kinds Chip 3: latexComment EDITABLE atom lift float — 2026-06-02

**Commit:** `cdc7eac`.

**What.** Third bodyless-kind migration — the editable `%comment` atom (decision
A: fully editable, first-class). One more config row on the shared
`SingleBlockBody` (`editable:true` + `emptyAttrs:{text:""}`) — 3 kinds now on one
body (blockquote/codeBlock editable prose, displayMath read-only atom,
latexComment editable atom; the atom×editable cross-product). Renders editable
with NO cardContext flag: the factory adds `LatexComment` BARE
(`editor-extensions.ts`, unlike `FigureBlock`/`GraphicsBlock`/`TexBlock` which
thread `.configure({cardContext})`) → default `cardContext:false` → the
`editableAtomView` in main AND float. Edits round-trip with no new mechanism + no
surface-gate risk: `editableAtomView` commits (on blur) via `setNodeMarkup` on
the FLOAT editor → the float's `onUpdate` → `writeBackToMain` (whole-atom replace
by uuid). 3 touch-points (register `SingleBlockBody` for latexComment,
`popoutKeyForLift` case, `liftMode:"lifted-overlay"`) + latexComment in
`FloatSourceKind`/`KIND_LABEL` ("Source comment deleted"). Already in the float
schema — no factory change. No renderGhost/liftSourceRect.

**Observe-first.** Baseline: latexComment didn't pop out (`popoutKeyForLift`
null; no `liftMode` — confirmed by static read of the switch + the registry
meta). After (real released popout, popped-cards path — DFS for
`PoppedCardsContext` → `popOutAtRect('textobject:latexComment:0c01', rect)` —
NOT a clone harness): renders the EDITABLE `% …` view (`.latex-comment-editable`
+ `.latex-comment-prefix` present, `.latex-comment-card` absent, wrapped in a
`contenteditable=true` float editor — confirmed the factory's bare LatexComment
gives the editable view in floats, so NO cardContext flag was needed). Editing
the text + blur round-trips to the source `%comment` in main (cross-checked the
main node `text` attr by uuid: `"A demonstration document. Every formatting move
below is intentional."` → `"ROUNDTRIP_PROBE_L3i edited in the float"`). Deleting
the source surfaced the banner "Source comment deleted — float is disconnected.";
no blank popout. Drag GHOST needs a trusted hover → user-verify probe: in the
page, grab the `%comment`'s handle and drag — the lifted ghost should show the
`% …` row (clone of the main editor's editable `.latex-comment` DOM, which
matches the float's editable view) and on release become the editable float.

**Verify.** Wiring test extended (`single-block-lift-wiring.test.ts`, Chip 3
block): latexComment non-null `popoutKeyForLift` + `liftMode==="lifted-overlay"`
+ shared `SingleBlockBody` (same component instance as blockquote/displayMath) +
`editable:true`/`emptyAttrs:{text:""}`; figureBlock stays the still-null control
(now also asserting `liftMode` undefined); blockquote/codeBlock/displayMath stay
green. vitest 385/385 (380 + 5 new Chip 3 asserts); tsc 1 pre-existing
(`block-uuid-backfill.test.ts(27,7)`); eslint 0 new (3 pre-existing warnings in
`TextObjectGrabHandle.tsx` confirmed on the stashed baseline); `emitCount` flat
(Δ0, version +12) typing 12 plain chars in MAIN. Stale-build trap pre-empted: the
registration is mount-time, so cleared `.next-preview` + restarted before
observing (and reset the dev doc from `samples/annotation-history` after the
destructive banner/edit probes).

**Non-goals respected.** The math gate (L3h.1), `editableAtomView` dispatch
logic, page latexComment rendering/editing, the other bodyless kinds
(figures/sub-objects/titleField), and L4 untouched. Pre-existing working-tree
files (`EDITOR_SKILLS_BRAINSTORM.html`, `useRecentlyAddedTracker.ts`) + untracked
scratch (`CARD-SYSTEM-REFACTOR.md`, `EDITOR_SKILLS_V1.html`,
`MEMO_V1_AND_ROT_PREVENTION.md`, `SKILL_PIPELINE.*`, `docs/card-refactor/`) out
of the commit.

## L3j — Bodyless kinds Chip 4: titleField lift float (+ float-schema promotion) — 2026-06-02

**Commit:** `500ddf3`.

**What.** Fourth bodyless-kind migration — the title/author/date fields (decision
C: include); the LAST prose-shaped `SingleBlockBody` kind. One config row
(`titleField: {schemaType:"titleField", floatIdPrefix:"title",
sourceKind:"titleField", editable:true}` — content-bearing like blockquote, NO
`emptyAttrs`; `emptyBlockFor`'s `{type:"titleField", content:[]}` is valid for
`inline*`) PLUS the one new wrinkle: titleField was the lone bodyless kind NOT in
the float schema (MAIN_ONLY), so PROMOTED `TitleField` into the FCU factory's
float stack — pulled it OUT of the main-only spread (`editor-extensions.ts`) as an
always-included entry, leaving its doc-wide siblings (TextObjectOrphanGuard /
MaketitleMarker / LabelHandler / EmptyParagraphTitleCleaner) main-only. MAIN
extension order byte-identical (EXPECTED_MAIN_ORDER unchanged + green — the orphan
guard still precedes TitleField, the maketitle/label/cleaner guards still follow,
all still main-only); float gains exactly `titleField` after `linkedAnchorGuard`.
3 touch-points (register `SingleBlockBody`, `popoutKeyForLift` case,
`liftMode:"lifted-overlay"`) + titleField in `FloatSourceKind`/`KIND_LABEL`
("Source title field deleted"). No renderGhost/liftSourceRect/computeLabel (single
text-top block; static label "Title field"; `TITLE_FIELD_ACTIONS` already filters
Delete/Archive, so the float chrome shows no action menu).

**Observe-first.** Baseline gap: titleField didn't pop out (`popoutKeyForLift` →
default null + titleField in MAIN_ONLY_NAMES → not in the float schema → seeding
`{type:"titleField",…}` would drop/blank — confirmed by static read of the switch
+ the test arrays before the edits). After (real released popout, popped-cards
path — DFS for `PoppedCardsContext` → `popOutAtRect('textobject:titleField:0a11',
rect)`, NOT a clone harness): renders the field + "Title" annotation, EDITABLE
(`.title-field-wrapper` in a `contenteditable=true` float editor,
`floatEditable:"true"`, NOT blank — proving the schema promotion worked; a
still-main-only node would have blanked). Edit round-trip: inserted " [L3j-EDIT]"
in the float → the source titleField in main (uuid 0a11) updated ("The Margin and
the Note: A Brief History of Annotation" → "…Annotation [L3j-EDIT]"; main's attrs
field/uuid/isToday/rawPrefix preserved by the whole-node `replaceWith`).
titleField-specific RISK (preamble canonicalizer) CLEARED: after the write-back
the autosaver serialized through the real path → on-disk `document.tex` shows
exactly ONE `\title{… [L3j-EDIT]} %!v:0a11` at the canonical preamble position,
author/date intact (`%!v:0a22` / `%!v:0a33`), zero duplication / displacement /
lost field (the canonicalizer collects the single tree titleField + injects into
the preamble; the in-place write-back doesn't fight it). Deleting the source
surfaced the banner "Source title field deleted — float is disconnected."; no
blank popout. Drag GHOST needs a trusted hover → user-verify probe (below).

**User-verify ghost probe.** The released popout is headless-OK and confirmed
above; the drag GHOST needs a trusted cursor hover the harness can't fake. In the
page, grab the title field's handle (left of the title) and drag — the lifted
ghost should clone the `.title-field-wrapper` (title text + "Title" annotation),
and on release become the editable title float (identical to the popped-cards
render verified here).

**Verify.** editor-extensions.test.ts: EXPECTED_MAIN_ORDER UNCHANGED + green (the
byte-identical-main guard — the point of the careful spread split),
EXPECTED_FLOAT_ORDER gains titleField (after linkedAnchorGuard), MAIN_ONLY_NAMES
drops it. Wiring test extended (single-block-lift-wiring.test.ts, Chip 4 block:
titleField non-null `popoutKeyForLift` + `liftMode==="lifted-overlay"` + shared
`SingleBlockBody` [same instance as blockquote/latexComment] + `editable:true`
with NO `emptyAttrs` [content-bearing, not an atom]; figureBlock stays the
still-null control; the other 4 kinds green). vitest 390/390 (385 + 5 new Chip 4
asserts); tsc 1 pre-existing (`block-uuid-backfill.test.ts(27,7)`); eslint 0 new
(3 pre-existing warnings in `TextObjectGrabHandle.tsx`, unrelated to the one-line
`case` add); `emitCount` flat (Δ0, version +12 typing 12 plain chars in MAIN).
Stale-build pre-empted: schema/registration is mount-time, so cleared
`.next-preview` + restarted before observing (the preview server also dropped once
mid-verification → restarted, doc reloaded clean); reset the dev doc from
`samples/annotation-history` after the destructive edit/delete probes.

**Non-goals respected.** TitleField's siblings (MaketitleMarker / LabelHandler /
EmptyParagraphTitleCleaner / TextObjectOrphanGuard) stay main-only; the
serializer's title canonicalization untouched (only verified the round-trip is
clean); the math gate (L3h.1), the other bodyless kinds (figures/sub-objects), and
L4 untouched; MAIN order unchanged. Pre-existing working-tree files
(`EDITOR_SKILLS_BRAINSTORM.html`, `useRecentlyAddedTracker.ts`) + untracked scratch
(`CARD-SYSTEM-REFACTOR.md`, `EDITOR_SKILLS_V1.html`, `MEMO_V1_AND_ROT_PREVENTION.md`,
`SKILL_PIPELINE.*`, `docs/card-refactor/`) out of the commit.

## L3k — Bodyless kinds Chip 5: listItem lift float (first sub-object) — 2026-06-03

**Commit:** `dec9523`.

**What.** Fifth bodyless-kind migration — the first SUB-OBJECT. listItem is
`group:"textObject"` not `block`, so a bare item can't be a top-level float-doc
child: new `list-item-body.tsx` (modeled on list-body) SEEDS the item WRAPPED in
its real parent list via `buildWrap` (`doc > bulletList|orderedList > listItem`;
parent type detected by resolving the item's position in main → the enclosing
list), and the write-back is INNER-TARGETED — unwraps the float's `list > item(s)`
and `replaceWith`es over ONLY the source item's range (preserving its uuid), never
the whole list (siblings + the parent list uuid intact); an in-float Enter-split
lands as siblings (main's block-uuid backfill re-mints a clone that copied the
uuid). The float renders the marker for free (the wrapper list provides list
context); the drag GHOST gets a marker-rescue `renderGhost` (clone the `<li>` into
`.tiptap > ul/ol > li`, editor-root typography — modeled on the heading ghost; a
bare `<li>`'s `::marker` renders via the enclosing list's padding). Seed + every
`readSource` re-wrap share an explicit-uuid wrapper builder (`wrapItemForFloat`) so
they serialize byte-identically (no `useFloatMainSync` `sameDoc` thrash on a
foreign main edit). 3 touch-points + listItem in FloatSourceKind/KIND_LABEL
("Source list item deleted"). Already in the float schema. Fixed the stale
editor-extensions.ts:406-409 comment (listItem now has a round-tripping uuid —
`\item …%!v:<uuid>` via the serializer/parser + the block-uuid-backfill
DEFERRING_PARENTS set).

**Observe-first.** Baseline: listItem didn't pop out (popoutKeyForLift `default`
→ null, PLACEHOLDER_FLOAT_BODY). After (REAL released popout via the popped-cards
path — DFS for the PoppedCardsContext → `popOutAtRect('textobject:listItem:<uuid>',
rect)`; live editor via the `.ProseMirror` React fiber; the dev doc has a 3-item
bulletList [bb8c/773f/b2c4] + a 6-item orderedList): the float renders the item
INSIDE its list with the correct marker — bulletList item `bb8c` → `<ul>`
`list-style-type:disc`; orderedList item `d51a` → `<ol>` `list-style-type:decimal`
— editable (`isEditable:true`), float doc `doc > bulletList|orderedList > listItem`
with the source uuid preserved, NOT blank. INNER-TARGETED write-back proven: edited
bb8c in the float ("…highlight; [L3k-PROBE]") → in MAIN only bb8c changed; siblings
773f/b2c4 byte-unchanged, parent bulletList uuid `2205` unchanged, item count still
3, still a single bulletList node (no clobber/duplication). Source-missing banner
"Source list item deleted — float is disconnected." on deleting the source item in
main; no blank popout. Ghost → user-verify probe (the marker-rescue renderGhost
can't be driven headlessly): grab a list item's handle, drag — the ghost should
show the item WITH its marker (bullet/number); gutter-release → the float.

**Verify.** Wiring test extended (Chip 5: non-null popoutKeyForLift + liftMode + a
bespoke ListItemBody distinct from the shared SingleBlockBody + a marker-rescue
renderGhost; figureBlock stays the still-null control; the 5 done kinds green) + a
new wrap-seed→inner-write round-trip unit test (`list-item-inner-writeback.test.ts`,
against the real `getSchema(buildEditorExtensions)`: 3-item list, edit item 2 →
only item 2 changed + siblings/list uuid intact; the Enter-split case;
source-missing; and the seed/sync byte-identity anti-thrash invariant). vitest
400/400 (Δ+10 from 390, +1 file); tsc 0 new — **2 pre-existing on clean
main@eb3a541** [`card-creation.ts(543,11)` RecentlyAddedKind + the known
`block-uuid-backfill.test.ts(27,7)`], proven by stashing the change; the spec's /
L3j's "tsc 1" was measured in the reports-panel checkout, where the uncommitted
`useRecentlyAddedTracker.ts` fix removes the card-creation.ts error. eslint 0 new
(3 pre-existing warnings in `TextObjectGrabHandle.tsx`, identical on the baseline
copy — my 4-line `case` add shifted them +4 lines). emitCount flat (Δ0 typing 10
plain chars in MAIN, version +10). Built + verified in a dedicated `main` worktree
(`virgil-chip5-listitem`) since the main checkout was mid-feature on
`reports-panel`; Turbopack rejects a symlinked node_modules in a worktree (the
"worktree symlink gotcha") → real `npm ci`; dev doc seeded from
`samples/annotation-history` + a worktree `virgil-data/index.json`.

**Non-goals respected.** exampleItem (next — `list-item-body` is the template; its
seed/write-back helpers are exported/pure so the 3-level-wrap example-item-body can
mirror them), figures, L4, the math gate, the `\item` serializer round-trip (only
the stale COMMENT fixed), and the grab-handle resolution / drop adapters untouched.
The 5 done SingleBlockBody/other floats unweakened. Built in a pristine worktree
(no reports-panel pollution present); commit scoped to the new `list-item-body.tsx`
+ `floats/index.ts` + `TextObjectGrabHandle.tsx` + `text-object-registry.ts` +
`float-sync.tsx` + `editor-extensions.ts` (stale-comment only) + the two test files.

## L3l — Bodyless kinds Chip 6: exampleItem lift float (last sub-object) — 2026-06-03

**Commit:** `b749221`.

**What.** Sixth bodyless-kind migration — the LAST sub-object; a direct mirror of
L3k's listItem one wrap level deeper. `exampleItem` is `group:"textObject"` not
`block`, so new `example-item-body.tsx` (modeled wholesale on `list-item-body.tsx`)
SEEDS the item WRAPPED in its real envelope via `buildWrap(schema, item,
"exampleBlock")` (`doc > exampleBlock > exampleItemList > exampleItem` — 3 levels
vs listItem's list>item 2), and the write-back is INNER-TARGETED, unwrapping TWO
levels (`incoming[0]`=exampleBlock, `incoming[0].content[0]`=exampleItemList,
`…content`=the edited item(s)) and `replaceWith`-ing over ONLY the source item's
own range (uuid preserved), never the block/list (siblings + the parent
exampleBlock and its uuid intact); an in-float Enter-split lands as siblings.
Reused L3k's exported pure helpers' shapes (`findExampleItemByUuid`, the
explicit-uuid anti-thrash `wrapItemForFloat`, the pure `resolveInnerWriteback`,
the seed `useMemo`, `writeBackToMain`, `readSource`) so seed + every re-wrap
serialize byte-identically (no `useFloatMainSync` `sameDoc` thrash).

**renderGhost: NONE** (the deviation from listItem, reasoned from CSS + the
overlay, NOT the "safe envelope" the prompt leaned toward — that would be HARMFUL
here). listItem needs a ghost because a bare `<li>`'s `::marker` renders via the
enclosing list's padding (gone when detached); exampleItem's marker is a real
`.expex-item-marker` DOM child kept by the default clone, its marker+body grid is
self-contained on `.expex-item-row` (`.expex-item-list` is `display:contents`;
the `.expex-block` grid only positions the `(N)` number; no ancestor-combinator
rules), every expex rule is unscoped, and the overlay already supplies `.tiptap`
scope + reads the em-base from `getComputedStyle(anchorDom).fontSize` — the L3d.2
fix written FOR `.expex-item-marker`'s `0.95em`. So the default clone lays out
faithfully — the sub-object analog of exampleBlock, which also carries none.
(Wrapping in `.expex-block` without an `.expex-number` sibling would squash the
item into the 1.5em number column; a `.tiptap`-wrap with editor-root type would
regress the marker em-base.) Matches the plan doc's own assessment. 3 touch-points
+ exampleItem in FloatSourceKind/KIND_LABEL ("Source example item deleted").
Already in the float schema — no schema change, no editor-extensions.ts change.

**Observe-first.** Baseline gap: exampleItem didn't pop out (`popoutKeyForLift`
default null; figureBlock the still-null control). After (real released popout,
popped-cards path `popOutAtRect('textobject:exampleItem:ea02')`, NOT a clone
harness): the float renders item ea02 INSIDE its example with the `b.` subLabel
marker + grid, editable, ONLY the grabbed item (1 item, not its siblings), no
banner, not blank. Inner write-back proven — appended `[L3l-EDIT]` to ea02 in the
float → only ea02 changed in main (cross-checked getJSON: siblings ea01/ea03/ea04
byte-unchanged; exampleBlock ee02 uuid + number 2 + 4-item count intact; 3 total
example blocks). `\vxid` SAVE round-trip clean: on-disk document.tex line 133 has
exactly one `\vxid{ea02}` at the item head + the edit text at the tail (all 7
`\vxid` markers once each; the nested `\begin{xlist}` sub-items eb01–eb03 + the
`\pex` env + numbering ee02/ee03 intact). Source-missing banner shown on ea02
delete ("Source example item deleted — float is disconnected"); float stays
mounted. No console errors. Ghost → user probe (can't drive headlessly).

**Verify.** Wiring test extended (Chip 6 — exampleItem non-null `popoutKeyForLift`
+ `liftMode` + bespoke `ExampleItemBody` != SingleBlockBody != ListItemBody + NO
`renderGhost`; figureBlock stays the still-null control; the prior 13 done kinds
green) + a new inner-write round-trip unit test against the real float schema
(`example-item-inner-writeback.test.ts`: 3-level wrap-seed, edit item 2 → only
item 2; 2-level unwrap; siblings + exampleBlock uuid intact; Enter-split →
siblings; two-level-unwrap guards; anti-thrash byte-identity buildWrap ==
wrapItemForFloat). vitest **411/411** (38→39 files, Δ+11), tsc **0** (0 new),
eslint **0** new, emitCount flat (Δ0 over 25 plain chars in main; version
advanced 18→43).

**⚠️ Baseline + topology corrections (re-measured, not the prompt's stale
values).** The prompt's "tsc baseline = 2" and "fresh worktree on a
reports-panel-isolated main" were BOTH stale. ACTUAL: `main` had advanced to
**`054f237`** — the reports-panel + apply_response + card-system + skill-pipeline
work was already COMMITTED and MERGED on top of L3k (`e5e873b`), the working tree
was clean, and there was no separate worktree. The merged **card-system refactor
removed `src/lib/card-creation.ts`**, eliminating BOTH prior pre-existing tsc
errors → the true clean-`main` tsc baseline at `054f237` is **0**, not 2 (a chip
is clean iff it stays 0). Per the user's explicit choice, this chip was built +
verified + committed **in place on the primary checkout
`/Users/gabriel/Programming/virgil`** (now the sole worktree on `main`), not a
fresh side worktree; `node_modules` was already real (no `npm ci` needed).
Stale-build pre-empted (`rm -rf .next-preview` + fresh `preview_start`). Dev doc
mutated during the live walkthrough, then reset to the pristine sample
(`samples/annotation-history`); gitignored regardless.

**Non-goals respected.** The `\vxid` serializer/parser round-trip (only verified
clean through the write-back, untouched), the figure work + FigureVisual, L4, the
math gate, and the prior 13 done kinds all untouched; the grab-handle resolution /
`exampleItemDropAdapter` (already reach exampleItem) untouched. Commit scoped to
ONLY the new `example-item-body.tsx` + `floats/index.ts` + `TextObjectGrabHandle.tsx`
+ `text-object-registry.ts` + `float-sync.tsx` + the two test files (no
editor-extensions.ts change this time). §9 pre-existing files + scratch untouched.

## L3m — Figure work part 1: FigureVisual presentational cleanup (close the Issue-4/9/10 accretion) — 2026-06-03

**Commit:** `6e2a351`.

**What.** Pure refactor (decision B, part 1 — no feature, no float). `FigureCardPreview` (read-only) and `FigureFullView` (editable) hand-built the same figure structure twice (row + "Figure N:" caption + `\label` lozenge); Issues 4/9/10 patched the read-only copy piecemeal. Extracted a shared **`FigureVisual`** presentational component owning the non-empty structure — `.figure-row` (sources → FigurePanel, `registerRefresh` prop) + `.figure-caption` (the "Figure N:" prefix + a caption SLOT) + a chrome slot (page only) + a lozenge slot (FigureAnnotation, editable vs readOnly). Both views now render via it (caption slot = editable `NodeViewContent` on the page, static text in the preview; chrome/click-to-edit page-only; empty states stay per-view). A future figure affordance is now added ONCE. Byte-identical render + behavior before/after; same classes/order/CSS. Two subtleties worth the record: (a) the caption-block gate is `isFigure && (!!captionSlot || (numbered && figureNumber != null))` — **truthiness**, not `!= null`, so the preview's `captionText && <span/>` slot stays `""` (falsy → no caption block) for an empty caption, matching the old `{captionText && …}`, while the page's always-truthy `NodeViewContent` keeps the figureBlock caption always-rendered (NodeViewContent must persist for PM); (b) the row's `contentEditable` is a `rowContentEditable` passthrough (page `false` → `contenteditable="false"`; preview omits → React drops the attr, so the preview row inherits CE from its `contentEditable={false}` wrapper, attribute-free as before). The NodeViewWrapper (classes/contentEditable/ref/onClick/data-label) stays per-view — only the inner shell is shared; `FigureVisual` is `export`ed for the test.

**Observe-first (byte-identical).** Captured BOTH surfaces on the REAL app (NOT a clone harness) before + after, via in-page djb2 checksums over normalized outerHTML (blob: URLs tokenized), under identical float-state, on a fresh `.next-preview` rebuild after the edit (mount-time NodeView):
- **Page** (4 figs, floats closed, settled): hash **`e9ea3c12` BEFORE === AFTER**. figureBlock fig:bands/fig:wide (page-anatomy 62%/90%, "Figure 1:"/"Figure 2:" + editable `NodeViewContent` caption + editable lozenge w/ delete `×`); graphicsBlock manicule/citation-graph (bare, no caption, chrome). Editing driven LIVE after: width −/+ (manicule 16%→26%, panel `max-width` + scale input both update, img intact nw 360), click-to-edit popover (`virgil-figure-click` fires kind=figureBlock + raw env body + pos + rect; main `data-editable="true"`). Picker / caption-edit / delete are unchanged handlers on unchanged wiring (same `FigureChrome` props, same `NodeViewContent` caption, same `FigureAnnotation` editor/getFigurePos/onConfirm* props) — the byte-identical render + the diff confirm.
- **Read-only preview** (popped heading 3300 figureBlock + 2200 graphicsBlock via the popped-cards `popOutAtRect` path): hash **`44c5fb8b` BEFORE === AFTER**. fig:bands card-image (wrapper `contentEditable="false"`, row no CE attr, "Figure 1:" + static span, readOnly lozenge — NO delete / NO toggle role), manicule bare card-image (no caption/anno); images resolve (nw 1000 / 360, panels 62% / 16%); **0 pills**.
- The **empty picker CTA** (page) and **pill fallback** (preview) are untouched early-returns BEFORE the shell (not in the diff) → byte-identical by construction; not re-rendered live (dev doc has no empty/un-sourced figure). Screenshot of fig:bands confirms the real image + caption + lozenge. 0 console errors across pop→close. Keystroke sanctity: 12 plain chars in MAIN left `__virgilBusStats().emitCount` flat (16→16) while `version` advanced 17→29.

**Verify.** Existing figure tests green + new `FigureVisual` structure test (6 cases: row + "Figure N:" + caption slot + lozenge; slot order row→caption→chrome→lozenge; `rowContentEditable` passthrough; graphicsBlock no-caption/no-lozenge; both empty-caption gates). vitest **417/417** (40 files; was 411/411 / 39 — +6 in +1 file); tsc **0**; eslint **0 new** (only the pre-existing `<img>` warning in the untouched `FigurePanel`); emitCount flat.

**Non-goals respected.** No figure float yet (L3n, unblocked by this), no schema/registry/`popoutKeyForLift`/`liftMode`/`FloatSourceKind`/popout change, no `FigurePanel`/`useResolvedFigureUrl`/`FigureAnnotation`/`FigureChrome` behavior change (the Issue-7b object-URL reuse still works — `FigurePanel` untouched), no CSS change. The 14 done kinds + math gate + L4 untouched. Commit scoped to `FigureBlockNodeView.tsx` + the new `__tests__/figure-visual.test.tsx`. Dev doc mutated during the live walkthrough, then reset to the pristine sample (`samples/annotation-history`); gitignored regardless.

## L3n — Figure work part 2 (FINAL kind): figure floats — figureBlock + graphicsBlock — 2026-06-03

**Commit:** `7ef9056`.

**What — ALL 16 KINDS NOW LIFT.** The last migration. Added a third figure NodeView mode `FigureFloatView` (a new `figureFloat` `FigureBlockOptions` flag, defaulted false in both figure-block.ts + graphics-block.ts's `addOptions`, threaded through the factory's `FigureBlock`/`GraphicsBlock` `.configure(...)` from a new `EditorExtensionsCtx.figureFloat`, set ONLY by the figure float) rendering the shared `FigureVisual` (L3m) with: a read-only image (`FigurePanel`, `rowContentEditable={false}`, reusing the Issue-7b object-URL) + an EDITABLE caption (`NodeViewContent`, decision B) + a readOnly lozenge + NO chrome + NO wrapper `onClick` — so the `virgil-figure-click`→MAIN-pos popover can't MISFIRE from the float (the L3h.1 class; the float mode simply doesn't wire the per-view click — cleaner than math's shared-handler gate). Dispatch order: `figureFloat` → `FigureFloatView`; else `cardContext` → `FigureCardPreview` (unchanged); else `FigureFullView` (unchanged). New `figure-body.tsx` (mirror example-block-body): parse kind from cardKey → seed by (kind,uuid) → `buildEditorExtensions({surface:"float", editable:true, cardContext:false, figureFloat:true, docId threaded via useDocWriteHandleOrNull, callbacks:{} since the readOnly lozenge needs none})` → whole-node `writeBackToMain` by uuid (preserving MAIN's attrs; only the figureCaption child rides in `first.content`) → `useFloatMainSync`; registered for BOTH kinds (the ListBody precedent). `figureBlock` = editable caption (image edited on the page); `graphicsBlock` (atom, no caption) = read-only image (≈ displayMath). 3 touch-points + figureBlock/graphicsBlock in `FloatSourceKind`/`KIND_LABEL` ("Source figure/graphic deleted"). **No renderGhost** (reasoned, ghost can't be driven headlessly): a figure's DOM `cloneNode`s faithfully — the `<img src>` is a string attr so the clone reuses the warm object-URL (Issue-7b, no re-decode), every figure CSS rule is class-scoped (`.figure-*`, reaches the `.tiptap` ghost), and L3e.2's React-NodeView margin reset (`.lifted-text-overlay__body > .react-renderer > *`) already zeros `.node-figureBlock`/`.node-graphicsBlock`'s retained top margin (confirmed in the registry: all 16 metas carry `liftMode: "lifted-overlay"`). Static `meta.label` "Figure"/"Graphic" — no `computeLabel`/`liftSourceRect`. The page `FigureFullView` + the nested read-only `FigureCardPreview` are UNCHANGED.

**Observe-first.** Baseline (re-verified): figures didn't pop out (`popoutKeyForLift` → null; figureBlock was the wiring test's still-null control). After (real released popout, popped-cards path via fiber-DFS for the PoppedCardsContext + `popOutAtRect('textobject:figureBlock:48cc' / ':graphicsBlock:289b' / ':figureBlock:a7d3', rect)`, NOT a clone harness; fresh `.next-preview`):
- **figureBlock `48cc` (fig:bands)** float shows the REAL image (`isPill:false`, `naturalWidth:1000`, `imgComplete:true`), at size, **flicker-free**: the float img blob URL (`…08b9ab41`) is byte-identical to the page's fig:bands img URL → the refcounted urlCache hit (no re-decode). "Figure 1: " prefix + readOnly lozenge (`label: fig:bands`, no toggle/delete) present; NO chrome (`hasChrome:false`); read-only row (`contenteditable="false"`); **caption EDITABLE** (`isContentEditable:true`).
- **Editable-caption round-trip PROVEN (cross-checked getJSON):** appended `[L3n-EDIT]` to the caption in the float → MAIN's `48cc` caption updated to `"…below the rule. [L3n-EDIT]"` and ALL 9 image attrs (extras, source, sources[0].path, sources[0].widthPercent, widthPercent, label, figureNumber, placement, starred) byte-UNCHANGED. Screenshot shows the page-anatomy image + "Figure 1:" + the appended edit.
- **graphicsBlock `289b` (manicule)** float = read-only image only (`naturalWidth:360`, blob URL), NO caption / NO lozenge / NO chrome, read-only row.
- **NO misfire (the L3h.1 lesson):** 5 dispatched clicks on the figureBlock float's image/panel/row/wrapper + the graphicsBlock float's image fired **0** `virgil-figure-click` events (`misfireDelta:0`) and opened no popover (`popoverOpened:false`).
- **Nested figure UNCHANGED:** popped section `3300` ("The Birth of the Footnote", which contains `48cc`) renders the nested figure as `.figure-block-card-image` read-only `FigureCardPreview` (`isCardPreview:true`, `isFloatMode:false`, `captionEditable:false`, real image nw 1000) — `figureFloatMode:0` there; the `cardContext` path is untouched.
- **Source-missing banner:** deleting `a7d3` from MAIN flipped the open float to "Source figure deleted — float is disconnected." (`KIND_LABEL.figureBlock`). 0 console errors across the whole walkthrough. Ghost → user probe (grab a figure's handle, drag — the ghost shows the image + caption; gutter-release → the float).

**Verify.** Wiring test extended (Chip 7 — figureBlock + graphicsBlock non-null `popoutKeyForLift` + `liftMode` + ONE shared `FigureBody` != SingleBlockBody != ListItemBody + NO `renderGhost`); the figureBlock "still-null control" the earlier chips leaned on is RETIRED (no graspable kind is null anymore) in favor of an exhaustiveness lock — a new describe asserting EVERY one of the 16 `TextObjectKind`s returns a non-null popoutKey + `liftMode:"lifted-overlay"`, plus a cast-`notAKind` guard keeping the switch provably specific. The prior 14 done kinds stay green. vitest **420/420** (40 files, Δ+3 — wiring test 29→32), tsc **0** (0 new), eslint **0 new errors** (the only new item is figure-body's "Unused eslint-disable directive" warning — the IDENTICAL React-Compiler-skip pattern every sibling float body carries: example-block-body:102, list-body:116, etc.; without that `react-hooks/*` disable the compiler analyzes the body and flags 6 `react-hooks/refs` errors on the deliberate read-the-live-main-editor-during-render pattern). emitCount flat (Δ0 over 15 plain chars in MAIN; version 17→32).

**Non-goals respected.** `FigureFullView` (page) + `FigureCardPreview` (nested) + `FigurePanel`/`useResolvedFigureUrl`/`FigureChrome`/`FigureAnnotation`/`handleFigureSave`/`marker-clicks` untouched (the float mode just doesn't wire the click); no editable image source/width in the float (edit-in-main, like displayMath); the 14 done kinds + L3m's byte-identical page/preview render + the math gate intact. Commit scoped to the new `figure-body.tsx` + `FigureBlockNodeView.tsx` + `figure-block.ts` + `graphics-block.ts` + `editor-extensions.ts` (the factory threading) + `floats/index.ts` + `TextObjectGrabHandle.tsx` + `text-object-registry.ts` + `float-sync.tsx` + the wiring test. Dev doc mutated during the live walkthrough, then reset to the pristine sample (`samples/annotation-history`); gitignored regardless. **L4 is next — retire the now-unconditional `liftMode` staging machinery (all 16 migrated).**

## L4a — Cleanup finale, part 1: retire the lift-staging machinery (liftMode unconditional + sizing KEPT + grow-burst gate) — 2026-06-03

**Commit:** `6b25a36`.

**What.** Now that ALL 16 kinds lift (L3n was the last), deleted the dead migration scaffolding — NO behavior change (byte-identical lift gesture / ghost / popouts). Retired `TextObjectMeta.liftMode`: removed the field + all 16 `liftMode:"lifted-overlay"` registry lines + the grab-handle conditional, deleting the unreachable legacy `instant-popout` branch (the old `popOutAtRect` instant-spawn + its `setCardLiftTarget`/`setCardLiftHandoff` emits + the now-dead `@/components/card-lift` import) + the `FloatingCards` gate. Collapsed `popoutKeyForLift` to `return textObjectPopoutKey(ref)` (all 16 cased, the `default: null` dropped); KEPT the `: string | null` signature as a documented defensive contract for callers (the `if (!cardKey)` bail stays valid; null is never produced now). Collapsed the `FloatingCards` grow-burst gate from `parsed && TEXT_OBJECT_REGISTRY[parsed.kind]?.liftMode === "lifted-overlay"` to `parsed` — textobject floats still skip the auto-fit burst; the non-textobject path is byte-identical (and inert anyway — proved `.par-float-body` is textobject-only, so the burst finds no body off-textobject). Stale comments updated (LiftedTextOverlay header, the grab-handle dispatch / OverlayState / liveOverlay comments, registry texBlock + exampleBlock grow-burst tails, and paragraph's now-false "every other kind keeps instant-popout" comment).

**Sizing machinery KEPT — proven NOT vestigial (the prompt's prove-then-decide).** Read the two `floatSizeFor` call sites: the `~870` use was inside the now-DELETED legacy instant-popout branch (vanished with it); the other use is in the LIVE lifted-overlay path's concurrent-delete fallback (`if (!liftRect || (isRange && !ghostContent))`) — it spawns a cursor-centered fixed-size popout when the source rect can't be captured (source DOM vanished at threshold, or a range's mark can't be mapped). That fallback is rare but live, and the 4 wider kinds spawn there at their `initialFloatSize` (heading/lists 480×360, texBlock 480×280), so removing the machinery would change its behavior. LEFT `initialFloatSize` / `floatSizeFor` / `DEFAULT_FLOAT_SIZE` (now referenced by exactly that one live site); updated the `initialFloatSize` doc comment to say it is the fallback-only spawn size. (This is the prompt's explicit "else leave it + note why" branch.)

**Observe-first.** Proved each branch dead BEFORE deleting: the legacy instant-popout path unreachable (all 16 metas set `liftMode:"lifted-overlay"`; the type's only other value was the `?? "instant-popout"` default that no longer applies); `popoutKeyForLift`'s `default` unreachable (all 16 cased); the textobject grow-burst path always-skipped (every textobject key is lifted-overlay). After: real spot-check across kind shapes on the REAL app (NOT a clone harness) — fiber-DFS to the PoppedCardsContext, `popOutAtRect('textobject:<kind>:<uuid>', sourceRect)` for paragraph `1101` / heading `2200` (section) / bulletList `2205` / listItem `bb8c` (sub-object) / displayMath `a292` (atom) / figureBlock `48cc`: all 6 spawn floats carrying their `.par-float-body` at the SOURCE-rect dims (302/278 widths — NOT a fixed 360/480; heights = source, e.g. displayMath 40, heading 67), proving the grow burst is skipped (no auto-fit) and the popout opens at the source rect. `git diff -w` confirms the de-indented lifted-overlay body is byte-identical (only the dead branches + the flag removed). 0 console errors; editor renders cleanly. Ghost = user-verify probe (grab a kind's handle and drag — the ghost follows the cursor; gutter-release spawns the float at the same rect).

**Verify.** Lift tests green — adjusted `single-block-lift-wiring.test.ts` to the unconditional reality: dropped the 7 per-chip `liftMode === "lifted-overlay"` asserts + the 2 `notAKind → null` switch-specificity asserts (the `default` is gone), KEPT the "every kind lifts" coverage via the exhaustiveness block's `popoutKeyForLift` assert (all 16 → the canonical `textobject:<kind>:<id>` key). vitest **411/411** (40 files; was 420 — −9 obsolete tests in the one wiring file); tsc **0**; eslint **0 new** (the same 7 pre-existing problems on the touched files: FloatingCards 3× rules-of-hooks, LiftedTextOverlay 1× immutability, grab handle 3 warnings); `__virgilBusStats().emitCount` flat (Δ0 over 12 plain chars in MAIN; version 25→37) — the dispatch stays O(1).

**Non-goals respected.** `classifyParentAt` unify + the agent-doc refresh deferred to L4b (NEXT); `textobject.ts`/`drop-context.ts`/`text-range-move.ts` + `docs/agents/*` untouched. The non-textobject grow burst left intact (only the dead textobject discriminator removed). No float-body / NodeView / FigureVisual change. The `globals.css:1439` passing `liftMode` mention left (a CSS comment outside the scoped files). Commit scoped to types.ts + TextObjectGrabHandle.tsx + FloatingCards.tsx + text-object-registry.ts + LiftedTextOverlay.tsx + the wiring test. Dev doc mutated during the live spot-check (insert+undo + floats opened/closed), restored (docSize 12042 == 12042); gitignored regardless. **L4b is next — `classifyParentAt` unification + the agent-doc refresh.**

## L4b — Cleanup finale, part 2: unify the duplicated `classifyParentAt` — 2026-06-03

**Commit:** `1f3ab4f`.

**What.** Folded `textobject.ts`'s private `classifyParentAt` twin onto the shared `drop-context.ts` export (which `text-range-move.ts` already imports — the L3f-3 precedent). Confirmed byte-equivalent FIRST (diffed the two): identical algorithm — resolve the doc pos → walk depths innermost→outermost → first node whose type name is in `TEXT_OBJECT_REGISTRY` wins, else null; the ONLY differences were the three trivial style diffs the manager flagged — `export` vs private, an inline `import("@tiptap/react").Editor` type vs the imported `Editor`, and a `const node` temp vs inlined `$pos.node(d).type.name`. Deleted the twin (the "Drop-target classification" section header kept — it still leads `classifyDropTarget`) and added `import { classifyParentAt } from "./drop-context"` above the `../types` import (mirroring text-range-move.ts). The call site (~62, `classifyParentAt(targetEditor, placement.insertPos)`) needed no change — it now resolves to the import. All three drop specs now classify drop-parent context through ONE function. Pure de-duplication, byte-identical behavior; diff = **+1/−16**.

**No imports became unused** (checked per the prompt): `TEXT_OBJECT_REGISTRY` is still used at the dropAdapter dispatch + `resolveMoveSource`/`collectSourceContext` (~64/152/184); `TextObjectKind` is still used throughout (`classifyDropTarget`, source resolution, `LocatedSource`); textobject.ts never had a top-level `Editor` import — it uses the inline `import("@tiptap/react").Editor`, still referenced by `LocatedSource` (~130). So the ONLY import change is the addition.

**Verify.** tsc **0** (import resolves, no unused-symbol errors); vitest **411/411** (40 files — unchanged from baseline; the fold is byte-identical so the green drop-spec tests ARE the proof — `text-range-move.test.ts` 11/11 + `single-block-lift-wiring.test.ts` + `registry.test.ts` exercise the spec/classifier); eslint **0 new** on the changed file; commit scoped to ONLY `textobject.ts` (+1/−16) + this memo. No live walkthrough needed (no runtime behavior change). `drop-context.ts` + `text-range-move.ts` left as-is — note its header comment still reads "private twin … unify … the next time that file is edited," now mildly stale (the twin is folded) but left untouched per the leave-drop-context.ts-as-is constraint; a future touch can tidy it.

**Note.** The agent-doc refresh (the other half of L4b — `docs/agents/*`) is handled by the user in the `chip-doc-refresh` worktree, separately. With this, the lifted-overlay arc's CODE is COMPLETE: all 16 kinds lift, the staging machinery is retired (L4a), and the drop-parent classifier is unified (L4b).

## Residual bug R1 — sub-object floats inherit the source's numbering — 2026-06-03

**Commit:** `a85ec78`.

**Class.** A sub-object lift float (`listItem`, `exampleItem`) can't host a bare item at the doc top level, so it synthesizes a parent (`exampleBlock` / `orderedList`) for list/example context. That synthetic parent was built with DEFAULT attrs, discarding the source parent's numbering → exampleItem wrapper `number:0` rendered `(?)` (`expex.ts:400` is attr-driven); orderedList wrapper `start:1` rendered a popped 2nd item as "1.". One class, two faces — the same fidelity-drift class figure-body closed via the synced `figureNumber` attr.

**Fix (float-side; `buildWrap` untouched — it must keep defaulting so a DROPPED item renumbers to its new context).** The synthetic wrapper now inherits the source's numbering, applied IDENTICALLY in the seed AND the `readSource` re-wrap (so `useFloatMainSync`'s `sameDoc` sees byte-identical JSON). `wrapItemForFloat` is now the SOLE wrapper builder for both paths — the seed no longer calls `buildWrap` (the asymmetry the byte-identity used to rest on coincidentally):
- exampleItem: `findExampleItemByUuid` resolves the enclosing exampleBlock (via `doc.resolve` — `descendants`' parent arg is the exampleItemList, one level too shallow) and carries its render attrs (`number`/`kind`/`exnoOverride`/`tag`); the wrapper copies them, keeping the synthetic `uuid`.
- orderedList: `findListItemByUuid` computes the item's 1-based ordinal `(sourceList.start ?? 1) + precedingSiblingCount` (the `index` arg of `descendants`) + the list `type`; the wrapper sets `start`+`type`. bulletList untouched (unnumbered). Write-back stays inner-targeted (wrapper attrs never reach main).

**Two gaps OBSERVE-FIRST surfaced (same class; fixed alongside — the float-side-only model was incomplete).**
1. **The orderedList NodeView swallowed `start`.** `createListTitleNodeView` (editor-extensions.ts) built a BARE `<ol>` and its `update()` only refreshed the title — it never painted `start`/`type`. In main this is invisible (a 2nd `<li>` counts to "2." by DOM position), but a single-item float's `<ol>` needs `start="2"` for the marker to read "2." — so setting the node attr alone still rendered "1." (proven live: `topStart:2` yet `olStartAttr:null` → "1."). The NodeView now paints `start`/`type` from the node attrs — the SAME attr-driven render the exampleBlock NodeView uses for `(N)`; O(1), no doc walk; `ignoreMutation` skips the own-write on the contentDOM; `update()` repaints; nested `<ol>` covered too. No main regression (the dev doc's `start:1` enumerate still renders 1–6, `start` attr omitted as before).
2. **The wrapper uuid wasn't actually stable (PRE-EXISTING thrash).** It was minted INSIDE the seed `useMemo`, which re-runs on foreign re-renders → a fresh id each time → `readSource`'s re-wrap diverged from the float's content → `useFloatMainSync` fired a float-resetting `setContent` on EVERY foreign main edit. Proven pre-existing by `git stash` (the original `4398fb0` code thrashes identically: wrapper uuid `d956`→`52d7` on one foreign edit; the only byte that drifted was the uuid). Minted ONCE now via a lazy-init guard OUTSIDE the memo, so the "synthetic wrapper uuid (anti-thrash invariant)" §3 assumed actually holds.

**Verify (headless, released popouts via the popped-cards path — NOT a clone harness; each load-bearing read cross-checked across source `.tex` + live `getJSON()` + rendered text + screenshot, on a freshly RESTARTED preview to dodge a stale-chunk mix).** ea02 `(?)`→`(2)` (`number:2`/`kind:"multi"` inherited from ee02); af1a "1."→"2." (`start:2`, `<ol start="2">`, decimal OL); first-item ea01 still `(2)` "a."; bulletList bb8c still a disc (UL, unchanged); 3 foreign main edits in a far paragraph → every float `noSetContent`+`jsonStable`+`wrapUuidStable` (no thrash / re-scroll). Main doc untouched (docSize 12042). tsc **0**; eslint **0 new** (the float bodies' "Unused eslint-disable directive" norm KEPT — that directive also opts the body out of React Compiler's refs rule, covering the lazy-init ref write); vitest **413/413** (40 files; +2 wrapper-numbering locks: exampleItem wrapper carries the source `number`/`kind`, orderedList wrapper `start` = source ordinal, and the DROP path `buildWrap` stays default). Files: editor-extensions.ts (NodeView render) + example-item-body.tsx + list-item-body.tsx (+ the two *inner-writeback* tests). A live USER-VERIFY isn't required (released popouts are headless-verifiable), but the user can eyeball it by popping a 2nd example/ordered-list item.

## Residual bug R2 — surface-gate the atom-float selection chrome — 2026-06-03

**Commit:** `2035d47`.

**Class.** A float is a single-node surface; an atom-only float doc has no interior text position, so ProseMirror rests a NodeSelection on the lone atom (PROVEN: latexComment float selection = NodeSelection{0,1}, isFocused:false), firing the NodeView's selectNode() → `.selected` → a 2px outline the page never shows. Spanned both shared atom NodeViews: editable-atom-view.ts:169 (latexComment) + math.ts:99 (displayMath/inlineMath).

**Fix (the L3h.1 surface gate, generalized from the click-bridge to the selection chrome).** An atom NodeView on `surface:"float"` no longer paints `.selected`: math.ts selectNode gained `surface !== "float"` (surface already configured at editor-extensions.ts:1716-1717); editableAtomView gained a `surface` gate; latex-comment.ts threads a `surface` addOption; the factory now does `LatexComment.configure({ surface: isFloat ? "float" : "main" })` (:1719, was bare). MAIN-surface selection chrome unchanged.

**Verify.** Headless popped-cards (real released popouts, NOT a clone harness; each load-bearing read cross-checked — DOM class + float `state.selection` + computed outline/bg). PRE-fix repro (latexComment 0c01): float `.latex-comment` carried `selected` → `outline 2px solid rgb(168,196,222)` + bg `rgb(224,236,245)`, float selection `NodeSelection{0,1}`/isFocused:false/docSize 1; displayMath a292 float carried `selected` → tinted bg `rgb(245,243,240)`. POST-fix: a FRESH pop of each rests a NodeSelection on the lone atom (docSize 1 — the bug condition still holds) yet paints NO `.selected` (bare `latex-comment`/`display-math`, `outline none`, neutral bg — match the page). Disambiguator (structure-independent): a NodeSelection FORCED onto each float atom → no `.selected`; the SAME forced onto a MAIN comment (pos 86) + math (pos 4845) → STILL `.selected` (gate is float-only); main selection restored. tsc 0; vitest 421/421 (41 files; +8: math + editableAtomView selectNode-gate behavioral locks, LatexComment factory-wiring); eslint 0 new (math.ts/editable-atom-view.ts stay at their 3 pre-existing `any`). Files: math.ts + editable-atom-view.ts + latex-comment.ts + editor-extensions.ts (+ math-surface-gate / editable-atom-view-surface-gate / editor-extensions tests). Main doc untouched (docSize 12042). A live USER-VERIFY isn't required; the user can eyeball it by popping the first `%` comment.

## Residual bug R3 — source-kind-aware drop resolution for sub-items — 2026-06-03

**Commit:** `124fbf3`.

**Class.** The drop hit-test (`hit-test.ts resolveAnchorableBlock`) resolved positions source-kind-agnostically to the innermost anchorable node — inside a list/expex item that's the item's inner paragraph (depth 3), so a dragged sub-item never got a drop position at its peer (item) boundary → no inter-item drop lines, no reordering. The commit path (classifyDropTarget inside-compatible → drop-direct) already supported sibling drops; only the indicator's position resolution was missing them.

**Fix (source-kind-aware resolution; commit untouched).** When the dragged source is a sub-object (registry `isSubObject`) and the cursor sits inside a container that accepts it (`isCompatibleParent`), the hit-test resolves the between-blocks placement at the nearest peer item (listItem/exampleItem) boundary instead of the inner paragraph — surfacing inter-item insert positions within a list AND across same-kind lists. Gated on isSubObject, so every non-sub-object drag + the top-level pull-out path resolve byte-identically to before. O(depth) per mousemove (a $pos ancestor walk), no doc walk.

**Verify.** Headless: granularity probe (inner-paragraph before → item-boundary after) + non-destructive applyDrop `tr.doc` inspection (sibling reorder within/across lists; top-level still pulls out). Drop-spec locks added (listItem/exampleItem inter-item → drop-direct; paragraph unchanged). tsc 0; vitest 433; eslint 0 new. Live indicator confirmed by the user (trusted-hover drag checklist). Files: hit-test.ts (+ tests).

## Residual bug R4 — float-body leading-margin reset (the L3e.2 gap) — 2026-06-04

**Commit:** `2212f97`.

**Class (measured on the real gesture).** A popped figure dropped ~20px on release: ghost image top 330 → float image top 350 (Δ+20 = --editor-block-gap 1.2em; image width/left identical 187/216, body popout padding identical 16px — NOT an image-size or padding issue). A React-NodeView block self-manages its leading inter-block rhythm `margin-top` on the INNER element nested under its `.react-renderer` wrapper (figure/graphics → `.figure-block { margin: 1.25em 0 }` ≈ 20px; texBlock → `.tex-block { margin-top: var(--editor-block-gap) }`), because the unified `:where(.tiptap) > :where(…)` rhythm rule can't reach through that wrapper. In a SINGLE-block float that leading margin is spurious. The GHOST overlay body zeroes it via the two-arm L3e.2 reset (`.lifted-text-overlay__body > .react-renderer > *`, globals.css:1468, + its `.tiptap`-scoped twin ~1499); the FLOAT body's first-child reset had only the direct-child + heading arms — and the direct-child arm reaches only the `.react-renderer` WRAPPER (margin 0), not the inner element — so the inner margin survived and the figure sat 20px lower in the released float than the ghost showed.

**Fix (float-side L3e.2).** Extended `.par-float-body`'s first-child margin reset with the React-NodeView arm (`.par-float-body .tiptap > .react-renderer:first-child > *`), mirroring the ghost's ~1499; `:first-child`-scoped so a non-leading figure in a multi-block float keeps its rhythm margin. Closes the drop for every single-block React-NodeView float. CSS-only; no JS/subscriber (keystroke-sanctity untouched).

**Verify (OBSERVE-FIRST headless, popped-cards path, each load-bearing read cross-checked).** PRE-fix: figure `48cc` + graphics `289b` released-float inner `.figure-block` computed margin-top = 20px, `.react-renderer` wrapper already 0 (Arm 1 reaches only the wrapper); `fig.matches('…react-renderer:first-child > *')` = true. POST-fix (clean rebuilt server, CSS confirmed loaded): both → 0. texBlock `7e10` float DIVERGES from the spec's inference — it renders its SOURCE in CodeMirror (`.par-body-container`/`.tex-block-pod`/`.cm-editor`, NO `.tiptap > .react-renderer`), so it has no leading `--editor-block-gap` margin and the new arm matches nothing: a correct no-op, no drop, no regression (the 20px rendered-block margin lives in the docked pod / drag ghost, not the CodeMirror float). Multi-block non-regression (synthetic 2× `.react-renderer` under `.par-float-body .tiptap`, evaluated against the real stylesheet): 1st-block inner = 0, 2nd-block inner = 20px (`:first-child` holds). tsc 0; vitest 433/433 (42 files — CSS not unit-tested, no test added; first run reported 5 false failures purely from worker-pool starvation, clean re-run green); eslint 0 new (CSS file ignored by config). Live release: handed to the user as a trusted-hover re-gesture probe (not headless-drivable). Files: globals.css.

## Feature A0 — drop pictures (graphicsBlock) into expex — 2026-06-04

**Commit:** `8ffe9db`.

**What.** A dragged graphicsBlock can now land inside an exampleBlock: over an item's body → inserted into that exampleItem's content (schema-valid, (paragraph|graphicsBlock)+); in an inter-item gap → wrapped in a fresh exampleItem inserted as a sibling. Graphics only (figureBlock excluded; no schema change — exampleItem already accepts graphicsBlock, expex.ts:787).

**How (4 seams; gated on source=graphicsBlock so all other drags are byte-unchanged).** hit-test: new `resolveBlockIntoExpex` (parallel to R3's resolveSubItemPeerBlock) surfaces into-item content boundaries + between-item boundaries with midpoint snap — the "inline drop bar" a packed expex never showed (items tile 0px-gapped; over-content is inGap=false so between-blocks never fired). classify/compat: isCompatibleParent gains graphicsBlock→exampleItem; classifyDropTarget now CALLS isCompatibleParent (unified the duplicated inline check, L4b-style — byte-equivalent for existing kinds). adapter: graphicsBlockDropAdapter (drop-direct inside-compatible / wrap→exampleItem at the exampleBlock level / drop-direct elsewhere). buildWrap: new exampleItem case (single sibling; the exampleItemList already exists at the case-a insert site).

**Verify.** Headless: resolution into-item vs new-item; non-destructive applyDrop tr.doc on BOTH the hand-rolled and the REAL expex schema (`tr.doc.check()` valid) — case b into content (item → [graphicsBlock, paragraph]), case a wrapped sibling (list 4→5, new item holds the graphic), top-level unchanged (drop-direct), non-graphics unaffected (resolver returns null; exampleItem reorder still R3-clean). No-bar repro confirmed first (4 items, 0px inter-item gaps; over-content inGap=false). Locks added (graphics-into-expex.test.ts + adapter/compat/matrix rows). tsc 0; vitest 458/458 (44 files, +17 over the 441/43 HEAD baseline — the memo's older "433/42" had drifted); eslint 0 new. Live drop bar confirmed by the user (trusted-hover checklist). Files: hit-test.ts + textobject.ts + drop-adapters.ts (+ graphicsBlock registry entry) + tests.

## R5 — drag session survives re-renders (regression fix) — 2026-06-04

**Commit:** `ae08815`.

**Regression.** `atoms-draggable` (03f642e) made `setDropCtx(null)` cancel a live drop session (so the global `user-select:none` / crosshair / `data-drop-mode-active` don't stick when the editor unmounts mid-gesture — InlineAtomGrab has no controller mouseup of its own to fall back on). But DropModeProvider's setDropCtx effect had 10 deps and re-ran on panel-data churn; its cleanup fired `setDropCtx(null)` mid-drag → cancelled the gesture for EVERY draggable kind. Manager observed it live (instrumented recorder + real drag): BORN stack=#29 → move #29 → move #30 (identity FLIPS) → DIED at that same move, no mouseup/Escape; death at x=461 INSIDE the content column — the margin was a red herring (it dies on ANY dep churn; a marginalia hover just re-renders the pane reliably). User confirmed: session fully dead, must re-grab — not merely the bar hiding. **Churning dep: `stack` (`dropStackApi`, EditorPane.tsx:1246 — a `useMemo` over 7 hook objects [notesHook…citationsHook], recreated whenever any one returns a fresh identity).**

**Fix (ref-backed run-once registration — captures the whole class).** Register the DropCtx ONCE (mount, `[]` deps); its dynamic values are read back through a per-render-updated `ctxRef` via getters (the `confirmRef` indirection that already lived here, generalized to all 11 fields). A re-render now only refreshes the ref — it never re-runs the effect, so `setDropCtx(null)` fires ONLY on a true unmount (where cancelling is correct — preserves the atoms-draggable protection). No dep/memo/hook instability anywhere can cancel a live drag, and the wasteful per-render re-registration is gone. controller.ts UNTOUCHED — confirmed it already reads live ctx at use time through the stable object's getters: `hitTest` reads `activeCtx.mainEditor` on every mousemove; `commitDropSession`/`finishApply` read `ctx.{confirm,closePopout,notes…stack}` at mouseup, all resolving to current props.

**Secondary (flagged, NOT fixed — out of scope §5).** `dropStackApi` recreating every render is a latent perf defect (memoize whichever of its 7 hooks is unstable). The primary fix makes it non-fatal, so it's a nice-to-have, not the regression fix.

**Verify.** New deterministic lock (`drop-session-survives-rerender.test.tsx`) renders the REAL DropModeProvider, `beginDropSession`s, then forces the dep churn (new `stack` + anchor identities) → asserts `getDropSession()` survives AND `getDropCtx().stack` is the NEW stack (live ctx flows through the ref); a true unmount → asserts the session ends + `data-drop-mode-active` cleared. Confirmed FAILING on the pre-fix code (session null after the re-render) and PASSING after. tsc 0; vitest 460/460 (45 files, +2 over the 458/44 baseline); eslint 0 new. Live (handed to the user — trusted-hover, not headless-drivable): drag a paragraph + a picture + an equation all around incl. margin/gutter/pauses — never dies until release/Esc; a normal drop still lands. Files: DropModeProvider.tsx + test (controller.ts untouched).

## Feature A1 — unified expex drop: any block, one left vertical bar (evolves A0) — 2026-06-04

**Commit:** `ac7e5c6`.

**What.** Replaced A0's graphics-only, hard-to-hit horizontal item-bars (the items tile with ~0 inter-item gap, so the per-cursor bar was "very hard to get to show up… pretty unintuitive") with ONE forgiving left-edge VERTICAL bar that snaps to the nearest slot — for paragraph + graphicsBlock + displayMath (text/picture/equation). Drop between items → a new exampleItem; into an item → its content. Schema: exampleItem gains displayMath (paragraph/graphicsBlock already valid); the exampleBlock itself stays un-widened. Gated to expex + the 3 kinds, so all other drags — and these kinds' normal top-level drops — are byte-unchanged.

**How (the affordance half is new; A0's commit half is reused kind-generic).** hit-test `resolveBlockIntoExpex` widened from graphicsBlock-only to the 3 kinds (EXPEX_DROP_KINDS) + a generous left-zone nearest-slot snap: `collectExpexSlots` enumerates each top-tier item's gap slot (new-item → wrap) + one into-content slot (→ drop-direct), bounded to ONE block, and the resolver returns the slot whose pickY is nearest the cursor Y as a `makeExpexLeftBarPlacement` (a VERTICAL rect at the block's left edge; kind stays `between-blocks` so the commit reads insertPos unchanged). `isCompatibleParent` gains paragraph/displayMath→exampleItem; `classifyDropTarget` already DELEGATES to it (A0's L4b unification) so it needed no edit, and `buildWrap`'s exampleItem case is kind-generic so it was reused as-is — only the adapter rename touched textobject's neighbours. `graphicsBlockDropAdapter` → kind-agnostic `blockIntoExpexDropAdapter`, wired to all three registry entries. Indicator/globals.css: a taller-than-wide `between-blocks` rect renders as a vertical bar (a `dropmode-bar-vertical` modifier eases height as it snaps between a full-item bar and a new-item tick). LaTeX round-trip (the real schema-change risk): `serializeExampleItem` emits `\[…\]` inside the `\a` body; `parseExampleBodyAsBlocks`/`buildExampleItemFromText` accept displayMath in the ITEM context only (an `allowDisplayMath` flag — single `\ex` bodies + `\pex` preambles stay un-widened); and `readParagraph` now breaks at `\[` unconditionally — the trailing `\b` in its block-command list never fired after the non-word `[`, so a serialized `\[\n…` was being absorbed into the preceding paragraph, which broke the common text+equation item (a latent top-level bug too).

**Verify.** Schema LaTeX round-trip on the REAL parser/serializer (displayMath-in-item survives — lone + mixed-with-paragraph in document order, latex + uuid intact; single `\ex` stays un-widened). Resolver returns a vertical rect (height>width, x at block left) + snapped slot for all 3 kinds, nearest-slot snap confirmed by feeding several cursor Ys — locked in unit (faithful hand-rolled schema) AND cross-checked by porting the algorithm against the LIVE editor's real exampleBlock (4 items → 9 slots, blockLeft 440, every swept Y → a vertical rect, new-item↔exampleBlock / into-content↔exampleItem). Non-destructive applyDrop `tr.doc` for 3 kinds × both modes — `tr.doc.check()` schema-valid on BOTH the hand-rolled and the REAL live schema (the dev preview hot-reloaded the worktree; live exampleItem content = the widened union), the moved node landing inside an exampleItem each time, the live doc untouched. Top-level drops (each kind drops-direct, no wrap) + non-3-kind source over the expex (returns null / R3 reorder) non-regression locked. tsc 0; eslint 0 new; vitest 492 (was 460: +6 round-trip, +the rewritten block-into-expex, +adapter matrix). Live vertical bar = user-verified (trusted-hover, not headless-drivable); bar x/height are tunable constants. Files: hit-test.ts + drop-adapters.ts + text-object-registry.ts + expex.ts + latex-serializer.ts + latex-parser.ts + Indicator.tsx + globals.css + tests (block-into-expex rewrite, displaymath-in-item-roundtrip, drop-adapters matrix).

## Feature A2 — single-example expex drop: unify single + multi under one left bar (closes A1 gap B) — 2026-06-05

**Commit:** `c165bef` (landed on main via merge `69fe7de`).

**What.** A1's left-edge vertical bar now also welcomes text/picture/equation into a SINGLE `\ex` example (an exampleBlock with direct content, zero items) — it did nothing there before (collectExpexSlots enumerated only exampleItems → 0 slots → no bar). The dropped block JOINS the single example's body (stays one numbered example; NOT converted to \pex). Schema: exampleBlock content widened to graphicsBlock|displayMath (paragraph already valid). Gated to expex + the 3 kinds, so all other drags + A1's multi behavior are byte-unchanged.

**How (the deep unification).** collectExpexSlots now emits a body into-content slot for a single example (insertPos = leadingContentEnd, generalized from exampleItem to the exampleBlock body, before any gloss) alongside the multi item slots — one affordance for every expex shape; gloss-only ee03 → the slot lands above the gloss. The wrap-vs-direct decision became SCHEMA-DRIVEN (`canDropDirectAt` = the immediate insert parent's `canReplaceWith` at insertPos, threaded to the expex adapter via an optional `DropTarget.canDropDirect`), dropping A1's brittle `parentKind==="exampleBlock"` magic that collapsed the multi-between-items (immediate parent exampleItemList → wrap) and single-direct (exampleBlock body → drop-direct) cases together — the regression the naive `isCompatibleParent(kind, exampleBlock)→true` flip would have caused. The adapter wraps iff `canDropDirect === false` (a known schema rejection), else drops-direct; `isCompatibleParent` untouched (R3 unaffected). LaTeX round-trip (the all-three risk, tested FIRST): `serializeExampleBlock` gained graphicsBlock + displayMath branches (mirror serializeExampleItem); the single `\ex` body parse passes `allowDisplayMath:true` (\pex preamble stays false); two consecutive body paragraphs now join with a blank line `\n\n` (a lone `\n` re-merged them); and `readParagraph` now breaks at `\includegraphics` — the picture-side twin of A1's `\[` break (without it a serialized `paragraph\n\includegraphics{…}` absorbed the picture into the paragraph, losing the graphicsBlock — a latent top-level bug too).

**Verify.** Block-level round-trip on the REAL parser/serializer (single body with [para,displayMath]/[para,graphics]/[para,para]/[para,math,para] survives parse→serialize→parse, count+order+latex+command+uuid intact; lone displayMath survives; \pex preamble + gloss-only single stay un-widened). Resolver returns a vertical body slot (height>width, x at block left) for the single + gloss-only examples, snap stays on the one body slot as Y sweeps (no item ticks). Non-destructive applyDrop `tr.doc` on the faithful hand-rolled schema AND the REAL editor schema (built via `getSchema(buildEditorExtensions)`, `tr.doc.check()` valid): 3 kinds drop-direct into a single example's body (stays kind:"single", no exampleItemList/exampleItem created); REGRESSION LOCK — with exampleBlock WIDENED, a multi between-items drop STILL wraps into a fresh exampleItem (canDropDirect false; both positions classify as exampleBlock yet the schema separates them), an into-item drop still drops-direct; top-level + non-3-kind + A1 multi unchanged. tsc 0; eslint 0 new; vitest 528 (was 492: +8 single-body round-trip, +18 single-example resolver/commit/regression, +7 real-schema lock, +3 expanded adapter matrix). Live bar = handed to the user (trusted-hover, not headless-drivable; the worktree dev preview was blocked by a Turbopack out-of-tree node_modules-symlink panic, so the live-schema check was done via getSchema in vitest instead — strictly the real schema, just headless). Files: hit-test.ts + drop-context.ts (+ canDropDirectAt) + textobject.ts + drop-adapters.ts + types.ts (DropTarget.canDropDirect) + expex.ts + latex-serializer.ts + latex-parser.ts + tests (single-example-body-roundtrip, single-example-expex-drop, single-example-expex-real-schema, displaymath-in-item-roundtrip update, drop-adapters + drop-spec-matrix updates).

### A2 edge-fix — wrap only where the exampleItem wrap is schema-valid — 2026-06-05

**Commit:** `8624494` (landed on main via merge `69fe7de`).

A2's adapter wrapped whenever `canDropDirect === false`, which over-fired outside expex: a `displayMath` dropped at a `listItem`'s index 0 (listItem content `(paragraph | graphicsBlock) block*` rejects a displayMath there) wrapped into an `exampleItem` — itself invalid at that position, so the fitter promoted it into a freestanding `exampleBlock` and split the list. Tightened: wrap iff `canDropDirect === false && canWrapHere`, where `canWrapHere` = `canDropDirectAt(insertPos, exampleItem)` — the SAME generic helper reused over the wrap target's node type, computed in `textObjectDropSpec.applyDrop` and threaded via `DropTarget.canWrapHere`. `exampleItem` is valid only inside an `exampleItemList`, so the wrap now fires EXACTLY at the multi between-items gap; every other rejected-bare-block position drops-direct (restoring A1's behavior — the fitter then places the bare block validly). Real-schema lock added (displayMath @ listItem@0 → drop-direct: no exampleItem fabricated, and `canDropDirectAt(…, exampleItem)` there is `false`; the multi between-items lock still wraps; single-body still drops-direct). tsc 0; eslint 0 new; vitest 529 (was 528: +1 real-schema edge lock; the two adapter unit-test files' case-a fixtures threaded `canWrapHere: true` to match the tightened contract). Files: textobject.ts + types.ts (`DropTarget.canWrapHere`) + drop-adapters.ts + single-example-expex-real-schema.test.ts + drop-adapters/drop-spec-matrix case-a fixtures.

## Feature A3 — expex drop-bar redesign: orientation carries meaning — 2026-06-05

**Commit:** `fcce5fd` (landed on main via merge `3869eca`).

**What.** Reshaped the expex drop affordance (A1/A2 drew new-item + into-item both as vertical bars → the user found the short-tick-vs-tall-bar ambiguous): now ORIENTATION carries meaning — a HORIZONTAL full-width bar = a new sibling item (wrap, push the others down); a VERTICAL left-edge bar spanning an item = a new block WITHIN that item (drop-direct, pushed to the item's top). Hit model = vertical-position thirds, Notion-style (the item the cursor's Y is within: top edge band → horizontal new-item ABOVE, bottom edge band → horizontal new-item BELOW, middle band → vertical into-item; above all items → first, below all → last). Adjacent items SHARE a gap (new-below-I == new-above-(I+1) → one insertPos). A single example = ONE vertical into-body bar, full body height, no thirds (NOT converted to multi). into-item / into-body now inserts at the content START — the dropped block becomes the new FIRST child, pushing the existing down — replacing A2's `leadingContentEnd` (append-after-leading-run). Both bars hang off the item's TEXT-left (inner content DOM), not the exampleBlock far-left where the "(2)"/"a." labels sit. Commit (wrap-vs-direct: `canDropDirect`/`canWrapHere`/`buildWrap`/`blockIntoExpexDropAdapter`) REUSED byte-unchanged; above/below the whole example stays the existing top-level between-blocks drop (resolver still returns null when the cursor is outside the exampleBlock).

**How.** hit-test `resolveBlockIntoExpex` reworked to the thirds selection: find the active item by `cursorY`, `frac = clamp((cursorY − item.top)/item.height, 0, 1)`, pick the band. `collectExpexSlots` → `collectExpexItems` (returns per-item geometry + a STRUCTURAL item count so a genuine single example [count 0 → body bar] is told apart from a multi whose DOM is transiently gone [→ null]); a new `contentLeftWidth` helper reads the first content child's DOM box for the text-left. `makeExpexLeftBarPlacement` split into `makeExpexNewItemPlacement` (HORIZONTAL: item-content-width × `EXPEX_BAR_WIDTH` at the top/bottom gap line, insertPos before/after the item → wrap) and `makeExpexIntoItemPlacement` (VERTICAL: `EXPEX_BAR_WIDTH` × item-height at the text-left, insertPos = item content START → drop-direct). `EXPEX_EDGE_BAND_FRAC` (0.3) added; `EXPEX_NEW_ITEM_BAR_HEIGHT` retired; `leadingContentEnd` removed (unused). Indicator.tsx + globals.css UNCHANGED — the orientation is aspect-driven (a wide-short rect renders the existing horizontal `.dropmode-bar-gap`; a tall-thin rect adds `.dropmode-bar-vertical`), so the horizontal new-item bar needs no new styling. Gesture sanctity preserved: one bounded `nodesBetween` over the top-tier items + one content child each, O(items), no doc walk.

**Verify.** Headless on the real editor schema (`getSchema(buildEditorExtensions)`) + the faithful hand-rolled schema — the live bar is a trusted-hover gesture the user drives, not headless-drivable. Resolver thirds: middle band → VERTICAL placement (rect.height>width) at the item text-left, insertPos = content START (classify→exampleItem); top band → HORIZONTAL (width>height), insertPos BEFORE the item (classify→exampleBlock); bottom band → HORIZONTAL, insertPos AFTER; adjacent-item gap-share (bottom-of-i1 == top-of-i2); single example → one VERTICAL body bar at body text-left, insertPos = body content START; below-last → horizontal after the last item; non-{three-kind} / outside-an-exampleBlock → null. Commit (non-destructive `tr.doc` + `tr.doc.check()`): new-item placements WRAP into a fresh exampleItem; into-item / into-body DROP-DIRECT as the new FIRST child (push-down); A2's multi-between-items wrap + the widened-block regression lock + the listItem@0 edge-fix lock all still green. tsc 0; eslint 0 new; vitest 533 (was 529: +4 — the block-into-expex resolver describe reworked to the thirds bands [middle/top/bottom × 3 kinds, gap-share, below-last]; the A2 single-example position assertions updated last-child→first-child + text-left x). Live bar = user trusted-hover (EDGE/thickness/x tunable). Files: hit-test.ts + tests (block-into-expex thirds rewrite, single-example-expex-drop + single-example-expex-real-schema position updates). globals.css + Indicator.tsx untouched.
