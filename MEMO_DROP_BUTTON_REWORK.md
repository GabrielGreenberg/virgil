# Drop-button / unified drop-mode rework — PLAN (implementation contract)

**Owner:** card-system maintenance manager · **Started:** 2026-06-16 · **Mode:** ultracode manager session
**Status:** ✅ COMPLETE — merged to `main` `12bad05` (tsc 0, full suite 1681/1681). Chips A·F·B+C·D·G·H merged `--no-ff`; E withdrawn (req-6 already satisfied). Unpushed tail — push held (deploys). Investigation artifacts: `docs/memos/drop-button-rework/`.
**Final fold (as built):** Family-2 (panel→gutter drag) **REMOVED** (all panels incl. Revisions); Family-1 (gutter-pin grab) **KEPT + folded onto the controller** via `MarginaliaMarker.entityKind` (no new field) — native-DnD gutter machinery + `anchor-rebind.ts` deleted.
**Behavior note (gate-flagged, accurate):** the fold is NOT strict mutation-equivalence — `report`/`report-request`/`revision-comment`/`revision-suggestion` gutter pins were SILENT no-ops in the old `anchor-rebind` table (`{todo,note,archive,cut}` only); the fold makes ALL margin pins uniformly re-anchorable (desirable EXPANSION). The folded pin now matches the drop-button UX: confirm-on-reanchor + multi-anchor collapse (both pending Gabriel's ratify; tune the pin to stay silent if undesired).
**OWED:** end-to-end live gesture walk (B+C's 8 liveChecksOwed + report/revision pin smoke tests).

> CENTRAL PRINCIPLE: unified/deep/architectural, derive from the SSOTs, capture the whole class,
> no parallel switches. This feature is a **new ENTRY POINT into an existing subsystem** (the
> drop-mode controller + the per-kind `dropSpec` facet) — NOT a new subsystem.

---

## 0. The ask (Gabriel's 7 requirements)
1. A **drop button** on the far-right of every card that has a text anchor (bib excepted), to the **left of the "X"** when the X shows.
2. Icon ≈ a **downward double-chevron** ("drop here" glyph).
3. **Grab (mousedown-drag) → the card immediately enters drop mode.**
4. Works to **anchor an unanchored** card OR **re-anchor an already-anchored** one.
5. **Per-kind placement:** some drop **in-text** (citations → the atom position); some **margin-only** (notes → a paragraph). Judgement calls per kind (delegated to us).
6. **Margin paragraph pick = the whole horizontal band:** anywhere in the paragraph's row inside the editor (incl. L/R margins), not just over the glyphs.
7. The old **Shift-grab** drop-mode entry is **retired.**

## 0b. Locked decisions (Gabriel, 2026-06-16)
- **Example card → NO button** (`droppable:false`, `dropPlacement:null`). Its block-move stays reachable via the existing lifted-overlay grab handle.
- **Highlights → KEEP the button** (margin drop; the lost Mode-B range is snapshotted to `originalAnchor` — current factory behavior).
- **Gutter margin-pin drag → FOLD onto the controller NOW** (the deepest path). See §8.
- (Folded by us, derivable from the spec) Atom-bearing kinds get **full** support: anchor-unanchored via a create-if-absent branch reusing the card's **existing** id; re-anchor = **silent move** (the inline path forbids `confirm` — an async modal freezes the ghost, in-text-atom-grab.ts:38-43); the button is **disabled on an empty draft** until it serializes to a valid command.
- (Folded by us) Icon = **two stacked lucide-`ChevronsDown` polylines**, sized to match `CardJumpChevron`; eyeball in preview.

---

## 1. Architecture — six unified moves, all derived from SSOTs

| # | Move | SSOT it derives from | Net new code |
|---|------|----------------------|--------------|
| 1 | `droppable` static facet gates the button | `CardMeta` (mirrors `poppable`) | 1 field + `isDroppable` predicate |
| 2 | `dropPlacement` static facet declares in-text vs margin | `CardMeta` + each spec's `allowedPlacements` | 1 field + `cardDropPlacement` predicate + dev assertion |
| 3 | ONE `CardDropButton` glyph/gesture, two mounts | `CardJumpChevron`/`PopoutButton` pattern | 1 primitive + neutral glyph |
| 4 | docked button drives `beginDropSession({inPlace:true, externalCommit:true})` | the controller (already has 3 non-float producers) | **no controller rewrite** |
| 5 | band-aware hit-test for margin (req-6) | the **shipped** grab-handle Y-band scan (Editor.tsx:839-851) | 1 `resolveBlockByBand` helper |
| 6 | inline anchor-the-unanchored (req-4) | the shared `inlineAtomMoveSpec` factory | 1 opt-in `createAtom` branch |

**Why it's deep, not surgical:** every requirement collapses onto the `dropSpec` facet + the
`beginDropSession` controller. No parallel tables, no per-kind if/else for placement (the dev
assertion pins declared policy ⇔ real `spec.allowedPlacements`).

### Empirically verified (read against real code, 2026-06-16)
- `beginDropSession({cardKey, origin, inPlace, externalCommit})` needs **no float** — `markSourceFloat` is `if(!inPlace)`-gated ([controller.ts:124](src/components/drop-mode/controller.ts:124),[:140](src/components/drop-mode/controller.ts:140)). 3 non-float producers already pass `inPlace:true`.
- Margin unanchored→anchor **already works**: `classifyDrop` returns `apply` on empty anchor list ([text-object-side-reanchor.ts:44](src/components/drop-mode/util/text-object-side-reanchor.ts:44)); `confirm` on re-anchor (:47).
- Inline unanchored→anchor is the **one real gap**: `locateAtom` returns null for an atomless card ([inline-atom-move.ts:226](src/components/drop-mode/util/inline-atom-move.ts:226)) → no-op.
- Shift-grab is **one branch**: [FloatingPanel.tsx:428-441](src/components/FloatingPanel.tsx:428).
- Margin re-anchor mutators converge: `anchor-rebind`'s `add/removeCardParagraphId` and the dropSpec's `ParagraphAnchorApi.add/removeTextObjectLink` both call `links.ts` `add/removeTextObjectLink` (types.ts:93-95) → **equivalent mutation** → the controller path can replace the native-DnD path.

---

## 2. SSOT facets (Chip A) — `src/cards/types.ts`, `card-registry.tsx`, `predicates.ts`
Add to `CardMeta` (beside `anchored`/`dropSpec`/`poppable`):
- `droppable: boolean` — literal per kind. Gates the button. **STATIC, not `dropSpec != null`** — `dropSpec` is installed by a boot-time side-effect import (`@/cards/drop-specs`, registry.ts:23) that `predicates.ts` can't import without a cycle, and a docked header can render before it loads → a dynamic gate could hide the button on first paint.
- `dropPlacement: "in-text" | "margin" | null`.

Predicates (mirror `isPoppable`:55 / `isAnchoredCardKind`:29): `isDroppable(k)`, `cardDropPlacement(k)`.

**Dev assertion** (mirror the `isInlineAtomCardKind` invariant, predicates.ts:100-113), run also as a vitest: `droppable` ⇔ a registered `dropSpec` exists AND `dropPlacement` ⇔ `spec.allowedPlacements` (in-text ⇔ inline-cursor; margin ⇔ paragraph-side). This is the safety net that keeps declared policy and mechanism from drifting — so the partition below is a guide; the assertion is the SSOT.

### Per-kind partition (req-5 judgement calls; assertion-pinned)
- **in-text** (`droppable:true`): `footnote`, `citation`.
- **margin** (`droppable:true`): `note`, `highlight`, `todo`, `report`, `report-request`, `archive`, `cutter-comment`, `cutter-suggestion`, `revision-comment`, `revision-suggestion` (+ any other registered paragraph-side dropSpec the assertion surfaces).
- **null** (`droppable:false`, no button): `bib`, `ai`, `error`, `example`.

---

## 3. The button (Chips B/C/D) — chrome
- **Glyph:** hand-author a neutral double-chevron-down SVG (two stacked `ChevronsDown` polylines, viewBox 0 0 24 24, e.g. `"6 5 12 11 18 5"` over `"6 12 12 18 18 12"`), sized to `CardJumpChevron`. Author it **neutral/shared** so both the card header AND `FloatChrome` consume it without `FloatChrome` importing card code.
- **Primitive `CardDropButton`** next to `CardJumpChevron`/`CardPopoutButton` (panel-primitives.tsx:490-546). A real `<button>`, `draggable=false`, mousedown `stopPropagation()+preventDefault()`, swallow `dragstart` (matches `CardJumpChevron`). Mousedown → `beginDropSession({cardKey, origin:{x,y}, inPlace:true, externalCommit:true})` then own `mouseup → commitDropSession`. Factor the gesture into ONE helper reused by both mounts.
  - Being a `<button>` auto-excludes it from the header drag-lift (`INTERACTIVE_CONTROL_SELECTOR`, drag-blocklist.ts:26-38, bail panel-primitives.tsx:1804) AND the float window-drag (`WINDOW_DRAG_BLOCK_SELECTOR`, FloatingPanel.tsx:425) — **no blocklist edits**.
- **Mount 1 — docked + omni** (one insertion; omni renders the same card): unified header cluster, after `{headerTrailing}` (panel-primitives.tsx:2011), before the jump/X block. Gated `isDroppable(kind)`. On docked it's the **rightmost** control (the X only renders when popped) — a net-new docked capability, matching req-1 ("left of X *if showing*").
- **Mount 2 — popped float** (chromeless card; header is `FloatChrome`): add **neutral** `canDrop`/`onDrop` props to `FloatChromeProps` (mirror `canJump`/`onJump`, FloatChrome.tsx:64-65); render a neutral drop button before the final `<PopoutButton variant="x">` (FloatChrome.tsx:117) = literally left of the X. Flow `canDrop` from `FloatWindow` via `cardFloatable()` reading `CARD_REGISTRY[kind].droppable` — **do NOT add a card import to FloatChrome** (keep neutrality). `bareWindow` floats (bib/ai) skip FloatChrome and are `droppable:false`. Deviant headers (`BibEntryCard`, `AiRequestCard`) are `droppable:false` → **zero edits**.

---

## 4. Controller reuse (Chip B helper) — docked entry, no rewrite
`beginDropSession` is reused verbatim. Docked `PanelCard` already stamps `data-card-key` (panel-primitives.tsx:1913) and has a live rect. The blue `Indicator` is viewport-relative/source-agnostic (Indicator.tsx:6-8) — no float needed for feedback; `InlineAtomGhost` stays absent for non-grab producers (current behavior). `postDrop:"close"` is safe from a docked source (`closeCardPopout` no-ops on a non-popped key). **Refresh** the stale "shift-mousedown on FloatingPanel header" doc-comment (controller.ts:2-13).

---

## 5. Band-aware hit-test (Chip E, req-6) — `src/components/drop-mode/hit-test.ts`
The gap is isolated: `hitTest` bails when `posAtCoords` is null (:58), which happens in the far L/R margin. The vertical band test for in-text (:97) and the paragraph-side fallback (:108) are already band-tolerant — the only glyph-coupled step is the **block PICK**. Add `resolveBlockByBand(editor,x,y)` reusing the **shipped** grab-handle Y-band wrapper scan (Editor.tsx:839-851, comment :811-821 literally states "regardless of where horizontally the cursor sits"). Route it **only** when the resolved placement is paragraph-side (driven by `spec.allowedPlacements`); keep `posAtCoords → resolveAnchorableBlock` byte-identical for between-blocks/inline-cursor so in-text atom precision is untouched. The band resolver **must mint a uuid** on the picked block if absent (as resolveAnchorableBlock does at :144-157) or the placement gets an empty `paragraphId`. Margins are the `.ProseMirror` element's own CSS padding (Editor.tsx:490), so `findEditorAtPoint` already returns the main editor there. **Selector completeness** for figure/graphics/tex/expex wrappers + inter-block gaps: start from the grab-handle selector; widen as preview testing shows gaps.

---

## 6. Commit unification (Chip F, req-4) — `inline-atom-move.ts` + footnote/citation drop-specs
- **Margin:** already complete (anchor + re-anchor + no-op) — zero spec changes (§1 verified).
- **Highlight (Mode-B range):** margin drop with range snapshot — already in the factory (text-object-side-reanchor.ts:60-75). Keep.
- **Inline create-if-absent:** add an **opt-in** `createAtom` factory param to the shared `inlineAtomMoveSpec`. When `resolve()` finds no atom AND `createAtom` is configured → `classifyDrop` returns `apply`; `applyDrop` inserts a fresh atom carrying the card's **EXISTING** `footnoteId`/`citationId` (must NOT mint a new id — commands.ts:198 / citation.ts mint fresh ids; reusing those orphans the card) at `placement.pos`. Branch is opt-in → the id-less in-text atom-grab path stays **byte-unchanged**. Inline path never returns `confirm` (would freeze the ghost) → inline re-anchor is a **silent move**. Empty-draft citation: button disabled until it serializes.

---

## 7. Shift-grab retirement (Chip G) — req-7
- **Delete** the `e.shiftKey` branch [FloatingPanel.tsx:428-441](src/components/FloatingPanel.tsx:428). **KEEP `beginDropSession`** (shared SSOT, 4 callers — deleting it breaks block grab handle, in-text atom grab, stack pull). Drop the now-dead import if any.
- **Leave alone (coexist):** in-text atom grab bails on shiftKey (a separate in-prose drag); all unrelated shiftKey uses (outline focus-expand, keyboard guards, math/figure Shift-Enter).
- **Docs:** `docs/agents/main-text.md:13,167-173`; `ui-chrome.md:190`; `glossary.md:149`. **Stale comments:** controller.ts:2-13; drop-mode/types.ts:2-7; Editor.tsx:504,1856; RichTextField.tsx:464; globals.css:3208-3267.
- **Pre-removal:** grep `src/**/__tests__` + drop-mode/FloatingPanel test dirs + keyboard-help for shift-gesture assertions.
- **ORDER:** must land **after** Chips C+D — the shift-grab is currently the **only** re-anchor entry for popped floats; remove it before the FloatChrome button exists and popped cards transiently lose re-anchoring.

---

## 8. THE FOLD (Chip H) — gutter margin-pin → controller  *(Gabriel: "fold now")*
Today the gutter `MarkerButton` is a native `draggable` (Marginalia.tsx:453, `onDragStart` sets `MIME_MARGINALIA_MOVE`). A document `dragover` resolves the target paragraph (elementFromPoint + `data-uuid` walk + ±dy micro-scan, :190-206) and paints the **same** `dropmode-bar-side` blue bar (:141); `drop` reads the MIME → `virgil-marginalia-reanchor` → `anchor-rebind.ts` `remove(old)+add(new)`. Archive markers ride the same event.

**Fold (Family 1 — the pin):** replace the pin's native `draggable`/`onDragStart` with a **mousedown → `beginDropSession({cardKey, inPlace:true, externalCommit:true})`** (derive the marker's cardKey from `m.type`+`m.entityId` via the `float:card:<kind>:<id>` grammar). The controller's band-aware hit-test (Chip E) + the dropSpec's `ParagraphAnchorApi` commit (verified mutation-equivalent, §1) replace the gutter `dragover`/`drop`/`showIndicator`/`virgil-marginalia-reanchor` machinery **for re-anchor**. Remove the redundant Family-1 DnD code + the `virgil-marginalia-reanchor` event + the `anchor-rebind` bridge (or repoint to the dropSpec). Archive pins fold the same way.

**The wrinkle — Family 2 (panel-card → gutter drops):** the SAME gutter `drop` handler also serves **live** card-from-panel drags (`MIME_NOTE/TODO/CUT/REPORT` set by ReportCard/ReportRequestCard/CutterCommentCard/CutterSuggestionCard → `virgil-*-drop` → `panel-drops.ts`). The new drop button **supersedes** these (you can now anchor/re-anchor those cards from the button). It also coexists with inline-insertion drags that fall through to the editor's `handleDrop` (Marginalia.tsx:235).

**Recommended fold scope (deepest, capture-the-class):** retire **both** families' native gutter DnD in favor of the button + controller, deleting the Marginalia gutter `dragover`/`drop`/indicator subsystem **except** the `isAnchorDrag`-false fall-through for inline-insertion drags. **REQUIRES** preview verification that the button fully covers cutter/report/note/todo anchoring first.
→ **This is the one fold sub-decision I want your explicit nod on in plan review** (it removes a live panel→gutter drag affordance). Fallback if you'd rather stage it: fold Family 1 now, file Family-2 retirement as an immediate follow-up chip.

---

## 9. Chip waves (worktree-isolated, per-step commits, staged paths)
**Wave 1 (foundation):**
- **A** — SSOT facets + predicates + dev-assertion test. `src/cards/{types.ts,card-registry.tsx,predicates.ts}` (+ test). *dependsOn: none.*

**Wave 2 (parallel, disjoint file domains, after A):**
- **B+C** — `CardDropButton` primitive + neutral glyph + docked/omni mount. `src/components/panel-primitives.tsx`. *dependsOn: A.*
- **D** — `FloatChrome` `canDrop`/`onDrop` + popped mount + `FloatWindow`/`cardFloatable` wiring. `src/floats/{FloatChrome,FloatWindow}.tsx`, `src/cards/floats/index.tsx`. *dependsOn: A, and the glyph from B (shared neutral icon).*
- **E** — band-aware hit-test. `src/components/drop-mode/hit-test.ts` (+ test). *dependsOn: none (parallel).*
- **F** — inline create-if-absent. `src/components/drop-mode/util/inline-atom-move.ts`, `src/panels/{Footnotes,Citations}/drop-spec.ts` (+ test). *dependsOn: none (parallel).*

**Wave 3 (after the buttons exist):**
- **G** — shift-grab retirement + docs/comments. `src/components/FloatingPanel.tsx` + docs. *dependsOn: C, D.*
- **H** — the fold. `src/components/Marginalia.tsx`, `anchor-rebind.ts`, `panel-drops.ts` (Family-2 per §8 decision). *dependsOn: C, D, E (needs band hit-test + the controller path proven).*

Cluster to minimize conflict: B+C own `panel-primitives.tsx`; D owns `floats/`; E owns `hit-test.ts`; F owns `inline-atom-move.ts`+panel drop-specs; G/H own FloatingPanel/Marginalia. `merge-tree --write-tree` conflict-check before every merge; `--no-ff` sequential; one `tsc` + `vitest --pool=threads` gate on merged main; **hold the push.**

## 10. Gate strategy
- **Cross-cutting / registry- / controller- / hit-test- / commit-touching chips (A, E, F, H)** → **full adversarial review Workflow** (4-5 lenses → refute high/medium → verdict).
- **Scoped chrome chips (B/C, D, G)** → **single strong skeptic Agent** each.
- **NEVER merge on chip self-verification alone.** Prove every added test has teeth (temp-revert the fix → RED).

## 11. Test strategy
Unit: facet/predicate coverage + the dev-assertion logic as a test; `inlineAtomMoveSpec` create-if-absent (apply not no-op when `createAtom` configured; asserts **existing** id reused; move path byte-unchanged when absent); side-reanchor unanchored→apply / different→confirm / same→no-op regression; `resolveBlockByBand` picks the right wrapper at extreme-left/right x where `posAtCoords` is null, mints uuid, leaves between-blocks/inline byte-identical; `lookupSpec` still routes every kind; the fold's marker-cardKey derivation.
Live preview (load `virgil-data/doc_devtest`; drive the **REAL** gesture — the cloneNode harness is unfaithful, [[preview_gesture_testing]]/[[preview_drop_spec_nondestructive_verify]]): docked-button drop commits **without a float**; far-gutter margin drop lands (req-6); in-text atom drop lands at the caret; unanchored footnote/citation gets a fresh atom with the card's id; shift-grab no longer triggers; **`__virgilBusStats().emitCount` stays flat on plain typing** (button gates on the STATIC facet, not a docVersion counter — keystroke sanctity).

## 12. Risks / guards
- Delete only the `e.shiftKey` **branch**, never `beginDropSession` (4 callers).
- Chip G after C+D or popped cards lose re-anchoring.
- Button mousedown MUST stopPropagation+preventDefault+draggable=false+swallow dragstart (else re-arms header drag-lift / window-drag / root HTML5 anchor drag).
- STATIC `droppable` facet is load-bearing (registration-timing) — not cosmetic.
- Inline create branch MUST reuse the card's existing id (fresh id orphans the card); opt-in so the atom-grab path is byte-unchanged.
- Keystroke sanctity: static facet, no per-keystroke effect; gesture is mousedown→mouseup scoped.
- Band-scan `querySelectorAll` on the ~16ms throttled mousemove is O(visible-blocks) — acceptable (grab handle does it un-throttled); spot-check a long doc.
- Fold (H): keep the `isAnchorDrag`-false inline-insertion fall-through; verify the button covers cutter/report/note/todo before deleting Family-2.

## 13. Open verifications (live-driven during impl, before each gate)
- Docked-button drop works with no float AND doesn't arm the header drag-lift.
- `posAtCoords` is null at extreme-left/right x (confirms the band scan is needed); `findEditorAtPoint` returns the MAIN editor for a margin point.
- dropSpec registration cannot precede first card render in a way that hides the button (confirms STATIC facet mandatory).
- No remaining shift-grab test/doc assertions before deleting the branch.
- (Fold) the controller commit for every margin kind produces the identical link mutation as today's `anchor-rebind` path.
