# INV-4 — Hit-testing & band-targeting for MARGIN drops

Read-only investigation. Goal: pin the EXACT hit-test mechanism today, and define the precise band-targeting change for MARGIN kinds (requirement 6) that leaves IN-TEXT caret targeting (atoms) glyph-precise.

Repo root: `/Users/gabriel/Programming/virgil`. Every file:line below is cited from the live source on `main` (HEAD 2fe534d at snapshot).

---

## TL;DR (the integrated answer)

**Today's mechanism** (`src/components/drop-mode/hit-test.ts:39-113`):

1. `findEditorAtPoint(x, y)` (`target-registry.ts:45`) — `document.elementsFromPoint` walks to the first registered `.ProseMirror`. The page L/R margins ARE inside the `.ProseMirror`'s box (the gutter padding is applied AS the `.ProseMirror` element's own `padding` via `editorProps.attributes.class` — `Editor.tsx:490-491`: `pl-[var(--editor-pl,88px)] pr-[var(--editor-pr,72px)]`), so a cursor in the L/R margin still lands ON `.ProseMirror` and this step succeeds.
2. `editor.view.posAtCoords({left:x, top:y})` (`hit-test.ts:54`) — ProseMirror's coords→pos. This is the SINGLE glyph-coupled step on the margin path. In the left/right padding it clamps to the nearest text position on that visual line — usually the right paragraph, but it is NOT band-defined and gets fragile in inter-block gaps / extreme margins (and returns null on failure → whole hit-test bails).
3. `resolveAnchorableBlock(editor, pos)` (`hit-test.ts:132-204`) — walks `$pos` up to the nearest `isAnchorableNode` (any node whose schema declares a `uuid` attr — `marginalia.ts:41-43`), minting a uuid if missing, returning its `{blockPos, uuid, dom}`.
4. Band classification (`hit-test.ts:96-98`): `blockRect = block.dom.getBoundingClientRect(); inText = y ∈ [top,bottom]; inGap = !inText`.
5. Placement loop in spec-priority order (`hit-test.ts:101-111`): `between-blocks` (needs `inGap`), `inline-cursor` (needs `inText`), `paragraph-side` (NO geometry guard — unconditional fallback → `makeParagraphSidePlacement`).

**Is MARGIN (paragraph-side) targeting band-based today?** *Partly, by accident.* The `paragraph-side` BRANCH is already band-friendly (it has no `inText` guard and `makeParagraphSidePlacement` only needs `block.dom` + cursorX — `hit-test.ts:108-110, 622-646`). BUT the block it operates on is chosen by `posAtCoords` (a glyph/line probe), NOT by a paragraph row-band test. So the *selection of WHICH paragraph* is glyph-line-derived, not "anywhere in the paragraph's horizontal band." Requirement 6 wants the block PICK itself to be band-based: cursor anywhere in the paragraph's Y-row (incl. L/R margins) → that paragraph.

**The deep change** (one place, derived from the SSOTs): introduce a `paragraph-band` block-resolver that, FOR MARGIN-ONLY SPECS, picks the block by Y-row hit-test over per-paragraph DOM rects — reusing the EXACT pattern the grab-handle hover already ships (`Editor.tsx:839-851`: `querySelectorAll(".par-title-wrapper.has-text, .list-title-wrapper.has-text")` + `clientY ∈ [r.top, r.bottom]`) — instead of `posAtCoords`. In-text/inline-cursor (atom) resolution stays on `posAtCoords`+`coordsAtPos` (untouched, glyph-precise). The two paths are ALREADY separated by `Placement` kind and by `spec.allowedPlacements`, so widening the margin path cannot degrade the atom path. The convergence target already exists in three places (grab-handle band, Marginalia HTML5 `findUuidAt` probe, `useMarginaliaRegistry` row metrics) — reuse one, don't reinvent.

---

## 1. How `Placement` is computed today (the full pipeline)

### Entry: `hitTest(x, y, spec, sourceCardKey, mainEditor)` — `hit-test.ts:39-113`

```
46  const editor = findEditorAtPoint(x, y);
47  if (!editor) return null;
48  if (!editor.isEditable) return null;
49  if (spec.targetScope === "main-only" && editor !== mainEditor) return null;
50  if (isSelfDrop(editor, sourceCardKey)) return null;
54  posResult = editor.view.posAtCoords({ left: x, top: y });   // ← glyph/line probe
58  if (!posResult) return null;
...
93  const block = resolveAnchorableBlock(editor, posResult.pos);
94  if (!block) return null;
96  const blockRect = block.dom.getBoundingClientRect();
97  const inText = y >= blockRect.top && y <= blockRect.bottom;
98  const inGap = !inText;
101 for (const kind of spec.allowedPlacements) {       // spec-priority order
102   if (kind === "between-blocks" && inGap)  return makeBetweenBlocksPlacement(...);
105   if (kind === "inline-cursor" && inText)  return makeInlineCursorPlacement(...);
108   if (kind === "paragraph-side")           return makeParagraphSidePlacement(...);
109 }
```

**Three placement kinds** (`types.ts:39-66`): `between-blocks` (insertPos + horizontal bar), `paragraph-side` (paragraphId + side + vertical gutter bar), `inline-cursor` (pos + line-height caret bar).

### `findEditorAtPoint` — `target-registry.ts:45-59`
`document.elementsFromPoint(x,y)` top-to-bottom; first element that is/contains a registered `.ProseMirror` wins. Registration is the `.ProseMirror` root DOM (`registerDropTarget`, `target-registry.ts:27-36`). **Load-bearing geometry fact:** the editor's L/R page margins are the `.ProseMirror`'s own CSS `padding` (`Editor.tsx:490-491`), so a point in the margin is inside the element's border-box and `elementsFromPoint` returns `.ProseMirror` → this step succeeds in the margins. (Confirmed by the doc comment at `Editor.tsx:474-477`: "left default 88 = 72px marginalia gutter + 8px breathing strip… Right 72 sits flush against the 72px right gutter.")

### `posAtCoords` — `hit-test.ts:53-58`
The ONE glyph/line-coupled call on every path. ProseMirror maps a viewport point to the nearest document position; inside L/R padding it resolves to the nearest text pos on that visual row. It is the source of the "must be over text" feel for the block PICK, and it returns `null` (→ whole hit-test bails) when it can't resolve (e.g. far outside any line box).

### `resolveAnchorableBlock` — `hit-test.ts:132-204`
Walk `$pos.depth → 0` for the nearest `isAnchorableNode` ancestor; mint a uuid if absent (dispatches a `setNodeMarkup` tx with `addToHistory:false`). If no anchorable ancestor (cursor at depth-0 gap), fall back to the nearest top-level child by |pos−childRange| distance (`hit-test.ts:168-203`). Returns `{blockPos, depth, uuid, dom}` where `dom = editor.view.nodeDOM(blockPos)`. **Note:** this is a `posAtCoords`-derived pick, NOT a Y-row pick.

### `makeParagraphSidePlacement` — `hit-test.ts:622-646` (the MARGIN constructor)
```
627  const blockRect = block.dom.getBoundingClientRect();
628  const side = cursorX < blockRect.left + blockRect.width/2 ? "left" : "right";
631  const BAR_OFFSET = 8;
632  const x = side==="left" ? blockRect.left-BAR_OFFSET : blockRect.right+BAR_OFFSET-2;
633  rect = { x, y: blockRect.top, width: 2, height: blockRect.height };
639  return { kind:"paragraph-side", editor, paragraphId: block.uuid, side, rect };
```
It needs only `block.dom` + `cursorX` — it does NOT need the cursor to be over glyphs. So the side branch is intrinsically band-tolerant; the only glyph-coupling is upstream (the block PICK via `posAtCoords`).

---

## 2. IN-TEXT (atom) targeting — must stay glyph-precise

`makeInlineCursorPlacement` — `hit-test.ts:648-663`:
```
651  coords = editor.view.coordsAtPos(pos);     // pos came from posAtCoords (step 2)
655  height = max(8, coords.bottom - coords.top);
656  rect = { x: coords.left-1, y: coords.top, width: 2, height };
662  return { kind:"inline-cursor", editor, pos, rect };
```
This is exact glyph caret targeting: `posAtCoords` → `pos` → `coordsAtPos(pos)` → 2px line-height bar. Citation / footnote / inline-math re-anchoring rides this (`allowedPlacements` defaults to `["inline-cursor"]` — `util/inline-atom-move.ts:56,66`). **It is gated on `inText` (`hit-test.ts:105`) and on the spec listing `inline-cursor`**, so it is fully independent of the margin path. Band-widening the margin path touches neither `posAtCoords`+`coordsAtPos` nor this branch.

---

## 3. `target-registry.ts` — what targets are registered & how a spec chooses its type

- **Registered targets** = TipTap EDITORS, not placement kinds. `registerDropTarget(editor)` keys `editorByDom: Map<.ProseMirror, Editor>` (`target-registry.ts:20,27-36`). The main editor + every `RichTextField` card body register on mount (per the module doc, `target-registry.ts:1-6`).
- **A spec chooses its placement type(s) via `DropSpec.allowedPlacements`** (`types.ts:209-211`, "Listed in priority order; first matching geometry wins"). The hit-test loop intersects `spec.allowedPlacements` with the cursor geometry (`hit-test.ts:101-111`).
- **Spec lookup** is `lookupSpec(cardKey)` (`registry.ts:49-63`): parses the float/legacy key; `textobject:*` → `textObjectDropSpec` (or `text-range-move` for `linkedRange`); a card kind → `CARD_REGISTRY[kind].dropSpec` (the SSOT, folded via `import "@/cards/drop-specs"` — `registry.ts:23`); transient `atom-grab`/`stack-pull` → `TRANSIENT_SPECS`.
- **Per-kind placement today:**
  - MARGIN-only kinds (note, highlight, todo, archive, cutter-comment/-suggestion, revision/-suggestion, report/-request) all = `textObjectSideReanchorSpec({...})` with `allowedPlacements: ["paragraph-side"]` (`util/text-object-side-reanchor.ts:28,32`). Wired per panel at `src/panels/{Notes,Todo,Archive,Cutter,Revisions,Reports}/drop-spec.ts`.
  - IN-TEXT atom kinds (footnote, citation) = inline-atom-move specs, `["inline-cursor"]` (`util/inline-atom-move.ts:66`).
  - Block content (paragraph/heading/etc.) = `textObjectDropSpec`, `["between-blocks"]` (`specs/textobject.ts:42`).
  - Stack-pull accepts all three (`specs/stack-pull.ts:24-28`).

**Implication for the rework:** per-kind IN-TEXT-vs-MARGIN judgement (requirement 5) is ALREADY encoded as `allowedPlacements` on each kind's `dropSpec`. The new drop-button (requirements 1-4) should `beginDropSession` against the SAME spec lookup; requirement 6 is satisfied by changing how the `paragraph-side` BLOCK is resolved — not by adding any new switch.

---

## 4. The deep change: band-based MARGIN targeting, in-text untouched

### 4a. Existing per-paragraph row source to REUSE (don't reinvent)

Three live band/row sources already exist; the new path should converge on one:

1. **Grab-handle hover band** — `Editor.tsx:839-851` (THE canonical pattern):
   ```
   840  const wrappers = dom.querySelectorAll(".par-title-wrapper.has-text, .list-title-wrapper.has-text");
   844  for (const w of wrappers) { const r = w.getBoundingClientRect();
   846    if (e.clientY >= r.top && e.clientY <= r.bottom) { found = w; break; } }
   ```
   The doc comment (`Editor.tsx:811-821`) states the rationale verbatim: the gutter "is OUTSIDE the contenteditable… Y-based detection on the scroll container keeps the band lit for the full row the paragraph occupies, regardless of where horizontally the cursor sits (text, left gutter, right gutter)." **This IS requirement 6's exact semantics, already shipped for the grab handle.** Each `.par-title-wrapper` / `.list-title-wrapper` is the per-block wrapper NodeView produces (`editor-extensions.ts:172,451`; expex variant `expex.ts:720`) and carries the block's identity; the marginalia registry and `text-metrics.ts:168,186` already key off these same wrappers.

2. **Marginalia HTML5-drag band** — `Marginalia.tsx:190-213`: `findUuidAt(x,y)` = `elementFromPoint(x,y).closest("[data-uuid]")`, with vertical probes `[-4,4,-10,10,-20,20]` when the pointer is in a gap (`Marginalia.tsx:198-206`). This is band-ISH (point + vertical probe) and is the PROVEN margin re-anchor picker for the legacy gutter-icon drag — confirming requirement 6 is the behavior the marginalia drag already targets and the new drop-mode path should converge on. Note it lives on the marginalia HOST (`data-marginalia-host`, `EditorPane.tsx:3987`), which the drop-mode controller does NOT use.

3. **`useMarginaliaRegistry` row metrics** — `getMetrics(uuid) → {top, lineCount, lineHeight, …}` (`useMarginaliaRegistry.ts:46,206`), already host-relative per-paragraph row geometry, used by `Marginalia.tsx:135,153-154` to draw the side indicator. This is uuid-keyed (needs the uuid first), so it's a *render-time* source, not a *pick-time* source — useful for drawing the bar once the band-pick yields a uuid, less so for the pick itself.

**Recommendation:** make the band PICK reuse pattern (1) — the `.par-title-wrapper.has-text` / `.list-title-wrapper.has-text` Y-row scan, scoped to `editor.view.dom` — because (a) it is the exact requirement-6 semantics already in production, (b) it gives the block wrapper DOM directly (→ `getBoundingClientRect` for the side-bar rect AND a `[data-uuid]`/nodeDOM bridge for the uuid), and (c) it needs NO `posAtCoords`. For the side-bar RECT, keep `makeParagraphSidePlacement`'s existing math (`hit-test.ts:622-646`) — it already only consumes `block.dom` + cursorX.

### 4b. Where to make the change (deepest, single-site)

Introduce a Y-row block resolver alongside `resolveAnchorableBlock` in `hit-test.ts` (e.g. `resolveBlockByBand(editor, x, y)`), and route to it **only when the active spec's allowed placements are margin-only** (i.e. `spec.allowedPlacements` is exactly `["paragraph-side"]`, or more generally when the cursor geometry will resolve to `paragraph-side`). Concretely, in `hitTest`:

- Keep step 1 (`findEditorAtPoint`) and the scope/self-drop guards unchanged (`hit-test.ts:46-50`).
- For a `paragraph-side`-bearing spec: BEFORE the `posAtCoords` call, attempt `resolveBlockByBand` (scan `editor.view.dom.querySelectorAll(".par-title-wrapper.has-text, .list-title-wrapper.has-text")`, pick the wrapper whose `getBoundingClientRect()` Y-band contains `y`; resolve its `[data-uuid]` / nearest anchorable block). If it hits, skip `posAtCoords` entirely and go straight to `makeParagraphSidePlacement` with that block + cursorX. This makes "anywhere in the paragraph's horizontal band incl. L/R margins" sufficient, exactly as requirement 6 asks.
- For `between-blocks` / `inline-cursor` specs: leave the `posAtCoords` → `resolveAnchorableBlock` → `inText/inGap` path BYTE-IDENTICAL (`hit-test.ts:52-111`). Atom/in-text precision is preserved because that path never touches the new band resolver.

This is one new resolver + one branch in `hitTest`, derived from `spec.allowedPlacements` (the SSOT for per-kind placement) and reusing the shipped grab-handle band pattern. No parallel switch, no per-kind table, no change to any `dropSpec`.

### 4c. Edge cases the band resolver must honor (open-verification flags)

- **Inter-block gaps / titled blocks:** the grab-handle scan only matches `.has-text` wrappers; a cursor in the vertical gap BETWEEN two paragraphs hits no wrapper band. The marginalia path solves this with vertical probes (`Marginalia.tsx:200-206`). The band resolver should either (a) snap to the nearest wrapper by Y-distance (mirroring `resolveAnchorableBlock`'s nearest-child fallback, `hit-test.ts:168-203`) or (b) reuse the ±dy probe. **Design-call: which fallback.** Recommend nearest-by-Y for determinism.
- **Card-body editors:** margin specs are `targetScope:"main-only"` (`util/text-object-side-reanchor.ts:33`; `hit-test.ts:49` already rejects non-main). The band scan is scoped to one `editor.view.dom`, so this is consistent — but confirm the scan runs on `mainEditor.view.dom` for main-only specs even when `findEditorAtPoint` returned the main editor (it will, since the margin IS the main `.ProseMirror`).
- **uuid minting on a read of a band wrapper:** the grab-handle scan reads wrappers but the drop path needs a `block.uuid`. `resolveAnchorableBlock` mints a uuid via a dispatched tx when absent (`hit-test.ts:144-157`); the band resolver must do the same (bridge wrapper → nodeDOM/pos → mint). The legacy marginalia path handles the no-uuid case via `_pos:NNN` synthetic IDs + `ensureAnchorUuid` on drop (`Marginalia.tsx:247-255`) — a second proven minting bridge to consider reusing.
- **Keystroke/gesture sanctity:** `hitTest` runs on the throttled mousemove (~16ms, `controller.ts:209-237`). `querySelectorAll(".par-title-wrapper.has-text, …")` is O(visible-blocks) per move — bounded, no doc walk — consistent with the existing grab-handle scan that already runs on raw `mousemove` (`Editor.tsx:839,854`). Acceptable but worth a perf note; the grab handle does it un-throttled today, so the throttled drop path is strictly lighter.

---

## 5. Convergence with the gutter-marker (Marginalia) drag — CONFIRMED

The legacy gutter-icon drag (`MarkerButton` HTML5 `draggable`, `Marginalia.tsx:493-507`) already does band-style paragraph picking via `findUuidAt` + vertical probes (`Marginalia.tsx:190-213`) and draws the SAME blue side bar — explicitly: `indicator.className = "marginalia-drop-indicator dropmode-bar-side"` with the comment "Same blue token the drop-mode controller uses for its paragraph-side indicator — both gestures land here visually" (`Marginalia.tsx:140-141`). So the NEW drop-button path and the legacy gutter drag should converge on ONE band-pick. The Indicator already renders `paragraph-side` with `dropmode-bar-side` (`Indicator.tsx:29-31`), matching the marginalia bar — visual convergence is already in place; only the PICK mechanism differs (drop-mode = `posAtCoords`; marginalia = `elementFromPoint`+probe). Unifying the PICK on the band scan closes that gap and lets the retired shift-grab (req 7) and the new drop-button share the marginalia drag's proven margin behavior.

---

## 6. Loose ends / things the code can't decide

- **Whether to widen the band path for ALL `paragraph-side`-capable specs (incl. stack-pull's mixed list) or only the margin-only specs.** Stack-pull lists `["between-blocks","inline-cursor","paragraph-side"]` (`specs/stack-pull.ts:24-28`); for it, the band path would only apply when geometry falls through to `paragraph-side`. Cleanest rule: run the band PICK whenever the resolved placement WOULD be `paragraph-side`; keep `posAtCoords` for the other two. This needs the band-pick to be tried first and the `between-blocks`/`inline-cursor` geometry still computed from `posAtCoords` — i.e. the two resolvers coexist within one `hitTest` rather than an either/or. (Design-call.)
- **The exact wrapper selector set.** `Editor.tsx:841` uses `.par-title-wrapper.has-text, .list-title-wrapper.has-text`. Expex blocks add `.expex-par-wrapper` (`expex.ts:720`) and there are figure/graphics/tex React-NodeView blocks that are NOT `.par-title-wrapper`. Confirm which anchorable kinds need a margin drop target and that the selector covers them (or fall back to `[data-uuid]` band scan à la marginalia for completeness). (Open-verification.)
- **`posAtCoords` margin behavior was reasoned-from-layout, not run.** I did not execute a live probe of `posAtCoords` at an extreme-left x. The claim that it "usually resolves to the right paragraph but is not band-defined" is from ProseMirror semantics + the existing code's reliance on a separate band scan for the grab handle (which exists precisely because point-hit on the gutter is unreliable, `Editor.tsx:813-821`). Worth a live confirmation in the dev preview before finalizing the resolver fallback rule.
