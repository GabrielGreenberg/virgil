# Card drop-button / unified drop-mode rework — integrated synthesis

Synthesis lead pass over five investigator digests (INV-1 chrome, INV-2 kinds-policy,
INV-3 drop-engine, INV-4 hit-test/band, INV-5 shift-retire). All load-bearing claims
re-verified against live code (see "Open verifications" for what the manager must still
prove). This is a PLAN skeleton — nothing here is implemented.

Gabriel's 7 requirements (verbatim intent):
1. A "drop" button on the far-right of every card that has a text anchor (bib excepted), to the LEFT of the X.
2. Icon = downward DOUBLE-CHEVRON ("drop here" glyph).
3. Mousedown-drag (grab) the button → card IMMEDIATELY enters drop mode.
4. Must ANCHOR an unanchored card OR RE-ANCHOR an already-anchored card.
5. Per-kind placement: in-text (citations → \cite atom) vs margin-only (notes → paragraph).
6. Margin pick = anywhere in the paragraph's HORIZONTAL BAND (incl. L/R margins, not just glyphs).
7. The old SHIFT-grab to enter drop-mode is RETIRED.

---

## 1. The unified architecture (the deepest solution)

Every requirement reduces to ONE thing the codebase already does almost completely — the
per-kind `dropSpec` facet on `CARD_REGISTRY` + the `beginDropSession` controller. The
feature is a **new entry point into an existing SSOT**, not a new subsystem. Six unified
moves, each derived from an existing SSOT, zero parallel switches:

1. **One anchorable predicate.** Add a static `droppable: boolean` (+ a `dropPlacement`
   facet, move 2) to `CardMeta` (`src/cards/types.ts:159-160`, beside `anchored`/`dropSpec`),
   set literally per kind, mirroring how `poppable` (`types.ts:179-186`) is decoupled from
   the boot-time-registered `toFloatable`. Add `isDroppable(k)` to `predicates.ts` mirroring
   `isPoppable` (`predicates.ts:55`). The button mounts iff `isDroppable(kind)`. bib/ai/error =
   `droppable:false`, so they need ZERO deviant-path edits — the button just never appears.
   **Why static, not `dropSpec != null`:** `dropSpec` is populated by a boot-time side-effect
   import (`@/cards/drop-specs`, pulled in on the drop-dispatch path at `registry.ts:23`).
   `predicates.ts` cannot import it without a cycle, AND a docked card header can render before
   the drop machinery loads, so a dynamic `dropSpec != null` gate could read `null` and wrongly
   hide the button on first paint. A static facet is registration-order-safe. Pin it to the
   real `dropSpec` registration with a dev assertion (mirroring `assertMorphCoverage` /
   the `isInlineAtomCardKind` invariant at `predicates.ts:100-113`).

2. **One per-kind placement facet.** Today the in-text-vs-margin partition is IMPLICIT —
   you must introspect `dropSpec.allowedPlacements` to know it (`["inline-cursor"]` =
   in-text via `inline-atom-move.ts:66`; `["paragraph-side"]` = margin via
   `text-object-side-reanchor.ts:32`). That is exactly the scattered switch the central
   design principle says to collapse. Add a declarative `dropPlacement: "in-text" | "margin"
   | "block" | null` facet to `CardMeta`. Requirement 5 becomes an O(1) registry read, not a
   spec-array probe. Keep `allowedPlacements` as the *mechanism the facet implies*, pinned
   by a dev assertion so the declared policy and the actual spec can't drift. The button still
   needs no per-kind branch: it calls `beginDropSession(cardKey)` and the existing
   `lookupSpec` → `dropSpec.allowedPlacements` route to the right placement.

3. **One drop-button component on the shared header.** Author ONE `CardDropButton` primitive
   next to `CardJumpChevron`/`CardPopoutButton` (`panel-primitives.tsx:490-546`), reused by
   BOTH render surfaces so the glyph + gesture live once:
   - **Docked + omni** (the omni column renders the SAME card component, so one insertion
     covers both): unified header cluster at `panel-primitives.tsx:2010-2021`, inserted
     after `{headerTrailing}` (`:2011`) and before the jump/X block (`:2012`). On a docked
     card the X is absent (`:2018` gated on `isPoppedOut`), so the drop button is simply the
     rightmost control — this is a net-NEW docked capability.
   - **Popped float** (a popped card is chromeless — its header moves up into `FloatChrome`):
     `FloatChrome.tsx:93-123`, inserted before the final `<PopoutButton variant="x">` (`:117`),
     i.e. literally "to the left of the X". Because `FloatChrome` is domain-neutral
     (`FloatChromeProps`, `FloatChrome.tsx:51-67`, imports nothing card-specific), the gate
     flows in as a new first-class `canDrop`/`onDrop` prop pair, mirroring `canJump`/`onJump`
     (`:64-65`), set by `cardFloatable()` (`src/cards/floats/index.tsx:72-132`) from
     `CARD_REGISTRY[kind].droppable`. Do NOT add a card import to FloatChrome — that breaks
     its neutrality invariant.

   The button is a real `<button>`, so it is auto-excluded from BOTH the header drag-lift
   (`INTERACTIVE_CONTROL_SELECTOR` includes `button`, `drag-blocklist.ts:26-38`,
   bail at `panel-primitives.tsx:1804-1805`) and the float window-drag
   (`WINDOW_DRAG_BLOCK_SELECTOR` includes `button`, bail at `FloatingPanel.tsx:425-427`) —
   no blocklist edits. Its own mousedown-drag MUST `stopPropagation()` + `preventDefault()`,
   set `draggable={false}`, and swallow `dragstart` (the card root is `draggable=true` for
   HTML5 anchor drags) — exactly the existing `CardJumpChevron` pattern.

4. **One generalized controller entry from a docked card.** `beginDropSession`
   (`controller.ts:90-128`) requires ONLY a parseable `cardKey`, an `origin {x,y}`, a
   per-doc `DropCtx` (registered once by `DropModeProvider`, not per-card), and a registered
   `DropSpec`. It does NOT require a float. The ONLY float-DOM touch is `markSourceFloat`
   (`controller.ts:124,140`), gated behind `if (!inPlace)`. Three producers already start
   sessions with no FloatingPanel — the in-text atom grab (`inline-atom-grab.ts:145`), the
   lifted-overlay grab handle (`TextObjectGrabHandle.tsx:868`), and the stack pull
   (`StackThumbnail.tsx:36`) — all passing `inPlace:true`. A docked `PanelCard` already
   stamps `data-card-key` (`panel-primitives.tsx:1913`) and has a live box via `innerRef`.
   So the button calls `beginDropSession({cardKey, origin, inPlace:true, externalCommit:true})`
   and owns its own `mouseup → commitDropSession`, exactly like the in-text-grab producer.
   No controller rewrite — `inPlace:true` reuses the existing skip. (The controller's
   "shift-mousedown on FloatingPanel header" doc-comment at `controller.ts:2-13` describes
   the *current sole card producer*, not an engine precondition; refresh it.)

5. **One band-aware hit-test.** Requirement 6 is a real gap, isolated to ONE site.
   `hitTest` (`hit-test.ts:39-113`) bails when `posAtCoords` is null (`:58`), which happens
   for a cursor in the far L/R margin beyond the prose glyphs. The vertical band test
   (`inText`, `:97`) already uses y only and is correct; `paragraph-side` (`:108-110`) is
   the unconditional fallback once a block resolves — already band-tolerant. The ONLY
   glyph-coupled step is the block *pick* (`posAtCoords → resolveAnchorableBlock`). The
   deep fix reuses a SHIPPED pattern: the grab-handle hover scan (`Editor.tsx:839-851`)
   already does exactly req-6 — a Y-band scan over `.par-title-wrapper.has-text,
   .list-title-wrapper.has-text` wrappers, with the doc comment (`:811-821`) literally
   stating "regardless of where horizontally the cursor sits (text, left gutter, right
   gutter)." Add a `resolveBlockByBand(editor,x,y)` in `hit-test.ts`, routed ONLY when the
   resolved placement would be `paragraph-side` (driven by `spec.allowedPlacements`), feeding
   the band-picked block into the unchanged `makeParagraphSidePlacement` (`hit-test.ts:622`).
   Keep `posAtCoords → resolveAnchorableBlock` byte-identical for `between-blocks` /
   `inline-cursor` so in-text atom precision (`makeInlineCursorPlacement`, `:648`) is
   untouched. The band resolver must mint a uuid on the picked block if absent
   (`resolveAnchorableBlock` does this at `:144-157`) or the placement gets an empty
   `paragraphId`. NOTE: the L/R margins ARE the `.ProseMirror` element's own CSS padding
   (`Editor.tsx:490-491`, `pl-[var(--editor-pl,88px)] pr-[var(--editor-pr,72px)]`), so
   `findEditorAtPoint` already SUCCEEDS in the margins — it's only the block pick that's
   glyph-coupled.

6. **The shift-grab retirement.** Requirement 7 is a one-branch deletion: remove the
   `if (e.shiftKey && cardKey && mode === "floating")` block at `FloatingPanel.tsx:428-441`.
   `beginDropSession` is a shared SSOT (4 callers) — KEEP it. The other shift gestures are
   unrelated (outline focus-expand, keyboard guards) and the in-text atom grab explicitly
   *bails on* shiftKey (`inline-atom-grab.ts:204-211`) — it is the non-shift in-prose drag,
   a separate coexisting affordance. Update the stale "shift-drag" narration in docs + code
   comments (see §6).

### How the two gaps (req 4) resolve

- **Margin kinds (unanchored → anchor):** ALREADY WORKS. `textObjectSideReanchorSpec`
  returns `apply` when `current.length === 0` (`text-object-side-reanchor.ts:44`) and
  `confirm` when anchored elsewhere (`:47-52`). Covers BOTH anchor-the-unanchored AND
  re-anchor with zero spec changes; `ParagraphAnchorApi` setters operate by entity id on
  the panel hooks, no float dependency.
- **In-text kinds (footnote/citation):** PARTLY BROKEN. `inlineAtomMoveSpec` is move-only —
  `locateAtom` (`inline-atom-move.ts:204-229`) scans for an EXISTING atom by id and returns
  null for an orphaned/unanchored card → `classifyDrop` → no-op. Re-anchoring an *anchored*
  footnote/citation works (the atom exists). **Anchoring an unanchored one needs a new
  create-if-absent branch** added to the SHARED `inlineAtomMoveSpec` factory: when source
  resolution finds no atom and an opt-in `createAtom` factory is configured, return `apply`
  and insert a freshly-built atom carrying the card's EXISTING id (footnoteId/citationId —
  do NOT mint a new id, that would orphan the card) at `placement.pos`. This collapses the
  "anchor unanchored inline card" and "draft-atom-create" cases into ONE capability with no
  parallel spec; the move path stays byte-unchanged because the branch is opt-in. This is
  the single non-trivial new mechanism in the whole plan and is gated behind a design call
  (does the button even support re-anchoring atom-bearing kinds — see designCalls).

---

## 2. SSOT facets to add/extend

`src/cards/types.ts` (`CardMeta`, near `anchored:141` / `dropSpec:160` / `poppable:186`):
- `droppable: boolean` — static, per-kind. Gates the button. `false` for bib/ai/error
  (and example, pending design call). Mirrors `poppable`'s decoupling from boot registration.
- `dropPlacement: "in-text" | "margin" | "block" | null` — declarative per-kind placement.
  in-text = footnote/citation; margin = note/highlight/todo/archive/report/report-request/
  revision-comment/revision-suggestion/cutter-comment/cutter-suggestion; block = example
  (if included); null = bib/ai/error. Drives req-5 dispatch without spec introspection.

`src/cards/predicates.ts`: add `isDroppable(k) = CARD_REGISTRY[k].droppable` (mirrors
`isPoppable`, `:55`) and `cardDropPlacement(k) = CARD_REGISTRY[k].dropPlacement` (mirrors
`isAnchoredCardKind`, `:29`). Add a dev assertion (mirroring the `isInlineAtomCardKind`
invariant at `:100-113`) pinning `droppable` ⇔ a registered `dropSpec`, and `dropPlacement`
⇔ that spec's `allowedPlacements`, so the declared facet and the mechanism can't drift.

Note: `revision-comment`/`revision-suggestion` share ONE `revisionDropSpec` instance
(`drop-specs/index.ts:39-40`) but must each declare the facet per-kind.

---

## 3. Per-render-surface chrome change

- Insert `CardDropButton` after `{headerTrailing}` (`panel-primitives.tsx:2011`), before the
  jump/X block (`:2012`). Gate: `isDroppable(kind)`. On docked it's the rightmost control;
  on popped-via-PanelCard it sits left of the jump/X (but popped cards are chromeless, so the
  real popped path is FloatChrome).
- Insert `CardDropButton` in `FloatChrome` before the final `<PopoutButton variant="x">`
  (`FloatChrome.tsx:117`), gated on a new `canDrop` prop. Add `canDrop`/`onDrop` to
  `FloatChromeProps` (`:51-67`) and flow them from `FloatWindow` → `cardFloatable()`
  (`src/cards/floats/index.tsx:72-132`) reading `CARD_REGISTRY[kind].droppable`.
- bareWindow floats (bib/ai) skip `FloatChrome` entirely (`FloatWindow.tsx:145-155`) and are
  `droppable:false` anyway — no edit.
- Deviant headers `BibEntryCard` (`BibEntryCard.tsx:452-565`) and `AiRequestCard`
  (`panel-primitives.tsx:2246-2394`) are `droppable:false` → no button, no code change.
- Icon: hand-authored double-chevron-down SVG (no icon library exists; the single
  chevron-down is `polyline "6 9 12 15 18 9"` at `panel-primitives.tsx:458`). Author two
  stacked down-chevron polylines (lucide `ChevronsDown` geometry, drawn by hand).

---

## 4. Hit-test band change

`resolveBlockByBand(editor,x,y)` in `hit-test.ts`, routed only for paragraph-side-resolving
specs, scanning the grab-handle wrapper set; band-picked block → unchanged
`makeParagraphSidePlacement` (`:622`). Mint uuid if absent. Keep `between-blocks` /
`inline-cursor` resolution byte-identical (preserves in-text atom precision at `:648`).
Selector-completeness (figure/graphics/tex/expex wrappers, inter-block gaps) is a design call.

---

## 5. Controller change

No structural change. The docked button calls `beginDropSession({cardKey, origin,
inPlace:true, externalCommit:true})` and owns its mouseup. Factor the shared button gesture
(mousedown → install move/up listeners → commitDropSession) into one helper reused by the
docked and popped mounts. Refresh the controller's stale "shift-mousedown on FloatingPanel
header" doc-comment (`controller.ts:2-13`). `postDrop:"close"` is safe from a docked source
(`closeCardPopout` is a pure filter that no-ops on a non-popped key, `useViewPrefs.ts:1375-1384`).

---

## 6. Shift retirement (code + docs)

- Delete the `e.shiftKey` branch at `FloatingPanel.tsx:428-441`; KEEP `beginDropSession`
  (4 callers). Verify the `beginDropSession` import isn't left dead in FloatingPanel.
- Docs: `docs/agents/main-text.md:13,167-173`; `docs/agents/ui-chrome.md:190`;
  `docs/agents/glossary.md:149`.
- Stale code comments: `controller.ts:2-13`; `drop-mode/types.ts:2-7`; `Editor.tsx:504,1856`;
  `RichTextField.tsx:464`; `globals.css:3208-3267`.
- Grep `src/**/__tests__` + FloatingPanel/drop-mode tests for assertions on the shift gesture
  before removal.

---

## 7. The genuine design calls (code can't decide these)

1. **example card — button or not?** It's `anchored:true` with a dropSpec, but its drop is a
   between-blocks block content-move, not an in-text/margin re-anchor. Reqs only describe
   in-text vs margin. RECOMMEND: exclude (`droppable:false`, `dropPlacement:null`) —
   `dropPlacement: "block"` exists only if included.
2. **Re-anchor atom-bearing kinds (footnote/citation) via the button — and create-if-absent?**
   The inline path forbids `confirm` (async modal freezes the ghost). Three sub-decisions:
   (a) does the button anchor an UNANCHORED footnote/citation at all → needs the new
   create-if-absent branch (§1, req-4); (b) does it RE-ANCHOR an already-anchored one →
   move marker silently vs disallow; (c) empty draft citation (no valid `\cite{key}` yet) →
   disable until it serializes vs silent no-op. RECOMMEND: anchor-unanchored = yes (build the
   create branch reusing the card id); re-anchor anchored = move silently (match current inline
   behavior, no confirm); empty draft = disable.
3. **Gutter-marker drag (Marginalia HTML5 DnD): coexist, retire, or fold onto the controller?**
   `Marginalia.tsx:261-357` re-anchors the SAME margin cards via a parallel native-DnD path
   (`virgil-marginalia-reanchor`), drawing the SAME blue side bar (`Marginalia.tsx:140-141`).
   It functionally overlaps the new button. RECOMMEND: coexist now (in-canvas directness is a
   distinct affordance); flag folding-onto-`beginDropSession` as a sized follow-up (deepest
   unification but larger than this scope).
4. **Exact double-chevron glyph + button hit-area/size.** No library; must be hand-drawn.
   RECOMMEND: two stacked `ChevronsDown` polylines in a `viewBox="0 0 24 24"`, sized to match
   `CardJumpChevron`.
5. **highlight (Mode-B text-range) margin-only drop semantics.** A margin paragraph-side drop
   degrades its text-range anchor (snapshotted to `originalAnchor`). RECOMMEND: margin-only
   with snapshot (current factory behavior) — exclude only if range re-anchor needs bespoke UX.
6. **Button visibility while unanchored vs anchored.** Always show for droppable kinds (the
   point of req-4 is anchoring the unanchored), EXCEPT possibly disable for atom-bearing kinds
   that can't create (decision 2). RECOMMEND: always visible; disable only the create case if
   decision 2 says no-create.

---

## 8. Open verifications (manager must re-prove against real code before committing)

1. **beginDropSession from a docked card with NO float** — verified inputs (controller.ts:90-128,
   inPlace-gated markSourceFloat); manager should LIVE-drive a docked-button drop in the preview
   to confirm the whole gesture (mousedown→move→mouseup→commit) works without a float and without
   arming the header lift.
2. **commit() path for req-4 cases** — verified: margin unanchored→anchor WORKS today
   (`text-object-side-reanchor.ts:44`); inline create-if-absent is UNIMPLEMENTED
   (`inline-atom-move.ts:204` returns null, no `node.create`). Confirm the create branch can reuse
   the card's existing id (footnoteId/citationId) and that the doc-level create paths
   (`commands.ts:198`, `citation.ts`) mint fresh ids that must NOT be reused.
3. **Req-6 far-margin band resolution** — verified the gap (`hit-test.ts:58` posAtCoords-null bail)
   and the reuse target (`Editor.tsx:839-851`). LIVE-measure `posAtCoords` at extreme-left/right x
   in the preview to confirm the band scan is needed (and that `findEditorAtPoint` returns the MAIN
   editor for a margin point, since margin specs are `targetScope:"main-only"`).
4. **Registration-timing of dropSpec vs first card render** — verified `@/cards/drop-specs` is a
   side-effect import on the drop-dispatch path (`registry.ts:23`). Confirm a docked card header
   can render BEFORE that import runs (if so, the static `droppable` facet is mandatory, not just
   preferred).
5. **Band-scan perf on a long doc** — `querySelectorAll(".par-title-wrapper…")` on the throttled
   ~16ms mousemove (`controller.ts:209-237`) is O(visible-blocks); the grab handle already does it
   un-throttled, but verify against AGENTS.md gesture sanctity on a large document.
6. **No remaining shift-grab consumers** — grep tests/docs/keyboard-help before deleting
   `FloatingPanel.tsx:428-441`.
