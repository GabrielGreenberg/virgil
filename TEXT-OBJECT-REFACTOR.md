# Text-Object Refactor — A Unified Canonical Pathway

Working memo. Captures the design conversation that produced it, the implementation plan, and progress through the refactor. The implementing session should read this end-to-end before touching code, and consult it whenever a question arises about scope or shape.

---

## Progress (updated 2026-05-24, session 5 — polish phase, ongoing)

Branch: **`main`** (the refactor branch merged after session 4; session 5+ work lands directly on main as a polish phase). 11 G-level commits + several follow-on commits + 2 session-5 commits below.

### Landed

| # | Phase | Commit | Spirit |
|---|---|---|---|
| 1 | A1 + A3 | `c705d3e` | `exampleItem` becomes a first-class TextObject — it now carries a `uuid` attr and round-trips through `\vxid{xxxx}` in the LaTeX source, completing the family alongside `\vfid`/`\vcid`/`\vexid`. Deprecated `ANCHORABLE_NODES`/`ANCHORABLE_ATOMS` sets retired (the schema-based `isAnchorableNode` was already canonical; the deprecated sets had drifted to omit `figureBlock`/`graphicsBlock` and were dead weight). 5 round-trip tests in `src/lib/__tests__/example-item-roundtrip.test.ts`. |
| 2 | B + C1 | `8b2fa20` | Every persistent TextObject node now declares the `textObject` schema group. Top-level kinds get `"block textObject"` (lists keep `"block list textObject"`); sub-objects (`listItem`, `exampleItem`) get `"textObject"` alone. `linkedRange` membership lives in the registry, not the schema (mark, not node). Same commit widens `listItem.content` and `exampleItem.content` so `graphicsBlock` may sit mid-item (the parser + serializer were extended end-to-end; `texBlock`/`figureBlock` were intentionally NOT widened, per memo §6). 3 round-trip tests in `src/lib/__tests__/graphic-in-item-roundtrip.test.ts`. |
| 3 | C2 | `f089f95` | `src/text-objects/` skeleton — the SSOT. `types.ts` (TextObjectKind union, TextObjectRef, SelectionRef, TextObjectMeta, DropTarget/DropAction, TextObjectTransportPayload, MIME_TEXTOBJECT), `text-object-registry.ts` (16-kind registry + helpers `isTextObjectKind` / `textObjectForNode` / `textObjectPopoutKey` / `parseTextObjectPopoutKey` / `registerFloatBody`), `drop-adapters.ts` (per-kind wrap/no-wrap functions replacing the per-spec switches), `hydrate-selection.ts` (selection → linkedRange minting with anchorId reuse when a range is already covered), `handle-layout.ts` (one shared `computeHandleLeftEdge` utility replacing scattered placement math). Float body components are placeholders; Phase D5 wires real bodies via `registerFloatBody`. 21 unit tests in `src/text-objects/__tests__/`. |
| 4 | D2 + D3 + D4 | `69a4680` | Six grab-handle implementations collapsed into ONE editor-mounted `src/text-objects/TextObjectGrabHandle.tsx` backed by the registry. The 4-variant `DragHandlePassage` union → `TextObjectRef \| SelectionRef`. The new handle resolves the active TextObject by walking from the cursor / NodeSelection / mouse hover, places itself via `computeHandleLeftEdge` (registry-driven decoration safety), and dispatches click + lift via the shared `useDragHandleMenu` + `usePoppedCards` contexts. Sub-objects (`listItem`, `exampleItem`) get handles for the first time; atom blocks (`texBlock`, `graphicsBlock`, `displayMath`, `latexComment`, `figureBlock`) are reachable via mouse hover. Deletions: paragraph 6-dot lift in `Editor.tsx` ParagraphWithTitle (~160 lines), list 6-dot lift in `createListTitleNodeView` (~125 lines), heading 6-dot lift in `HeadingWithLabel` (~140 lines), exampleBlock popout button + dragstart ghost (`expex.ts` ~70 lines), `tex-block-drag-handle` JSX + `handleGripMouseDown` (`TexBlockNodeView.tsx` ~70 lines), `SelectionDragHandle.tsx` entirely. Also cleaned the zombie ref / handler / prop machinery that fed the grips (`onLiftParagraphRef`/`onToggleHeadingPopout`/`*IsPoppedRef` for every kind except texBlock; `refreshHeadingPopouts` / `refreshExamplePopouts` EditorHandle methods; corresponding prop-passing in `EditorPane.tsx`). CSS: `.selection-drag-handle` → `.text-object-grab-handle` (the new handle keeps the always-visible viewport-fixed behavior of the old selection handle, not the hover-gated `.par-drag-handle` behavior). Net: -1749 / +256 across 13 files. After D4, "is this graspable" is answered by `nodeType.isInGroup("textObject")` — single canonical predicate, single canonical component. |
| 5 | D10 | `af301fa` | Block-popout keys collapse onto a single `textobject:<kind>:<id>` prefix emitted by `textObjectPopoutKey`. The dispatcher in `floating-cards.tsx` gets one `case "textobject"` that parses the key via `parseTextObjectPopoutKey` and routes by kind to the existing per-kind floats (Phase D5 replaces this routing with the registry's `meta.floatBodyComponent`). Writers: `TextObjectGrabHandle.popoutKeyForLift` returns the unified shape for every TextObjectRef whose float is wired today (paragraph / heading / bulletList / orderedList / texBlock / exampleBlock); SelectionRef stays on `selection:<id>` (Phase E hydrates). `EditorPane.tsx`'s `texBlockIsPoppedRef` checks the new shape with a fallback to legacy keys. Read-side migration in `useViewPrefs.ts.loadPrefs()`: `paragraph:<id>` / `heading:<id>` / `texBlock:<id>` rewritten to unified shape (no doc walk needed); `selection:<id>` / `sel:<id>` dropped with console.warn (session-only). `list:<id>` and `example:<id>` legacy keys deferred to Phase F's doc-aware sweep — the dispatcher keeps `case "list"` as a transitional fallback so they still render. `case "selection"` and `case "example"` (panel-card prefix) remain as transitional / stable-contract surfaces. |
| 6 | D7 | `167c26f` | Marginalia / drop-ctx anchor field renamed to match what it actually represents — kind-agnostic, not paragraph-specific. `MarginaliaMarker.paragraphId` → `textObjectId`. Drop-ctx APIs (4 generic functions): `addParagraphLink` → `addTextObjectLink`, `removeParagraphLink` → `removeTextObjectLink`, `getAnchorParagraphIds` → `getAnchorTextObjectIds`, `paragraphSideReanchorSpec` → `textObjectSideReanchorSpec` (file renamed too: `drop-mode/util/paragraph-side-reanchor.ts` → `text-object-side-reanchor.ts`). Per-hook variants (11 method names across the 6 anchored-card hooks): `addNoteParagraphId` / `removeNoteParagraphId` and the parallel `Highlight`/`Todo`/`Archive`/`Quotation`/`Revision` variants → `*TextObjectId`. Link helper: `getLinkedParagraphIds` → `getLinkedTextObjectIds` (98 call sites). Deliberately NOT renamed per the plan's DO-NOT list: `data-link-*` DOM attrs (stable user-facing contract); `LinkResolution.paragraph.paragraphId` (single resolved match, not the multi-anchor field — asymmetry documented); `migrate-card.ts` (the migration shim itself); `SelectionRef.paragraphId` / `SelectionFloatData.paragraphId` (gesture-input anchor hints, distinct concept); `Link.anchor.paragraphIds` (Phase D8 restructures that whole shape); card-creation API params and `EditorHandle.ensureParagraphUuid` (deferred — function parameter / lib-API naming, future audit). Net: +290 / -284 across 46 files. |
| 7 | D8 | `5ad274d` | `Link.anchor` full restructure. The variant `type: "anchor"` → `"textObject"`; add `targetKind: TextObjectKind` (new field); rename `paragraphIds` → `textObjectIds`. `isModeB(link)` is now `link.anchor.type === "textObject" && link.anchor.targetKind === "linkedRange"` — a property of *what's being anchored to*, not a hidden flag. After D8, cards can in principle anchor to any TextObject kind (D9 is a one-line predicate change). `migrateCardLinks` extended to upgrade legacy sidecar links on read: `anchor.type "anchor"` → `"textObject"`, `paragraphIds` → `textObjectIds`, `targetKind` defaults to `"linkedRange"` if `textRange` present else `"paragraph"` (correct for ALL pre-D9 legacy data — no sub-object anchors existed; doc-walk targetKind inference deferred to F). 13 files touched, +398/−115; 6 new D8 migration tests in `migrate-card.test.ts` + 1 in `storage-roundtrip.test.ts`. |
| 8 | D5 + D6 | `6c8041d` | Float chrome unification + drop-spec collapse. Five per-kind floats (`ParagraphFloat`, `HeadingFloat`, `ListFloat`, `TexBlockFloat` + the to-be-deleted `SelectionFloat`) each re-implemented the same chrome — FloatCard wrapper, 6-line header with label + jump-to + close. New `src/text-objects/TextObjectFloat.tsx` is the ONE chrome; per-kind bodies live in `src/text-objects/floats/` (`paragraph-body.tsx`, `heading-body.tsx`, `list-body.tsx`, `tex-block-body.tsx`, `example-block-body.tsx` NEW, `float-title-field.tsx` shared title editor) and register via `registerFloatBody` from `floats/index.ts` (side-effect imported by `Editor.tsx`). Chrome owns: mount, header strip, jump-to/close. Body owns: content rendering + main↔float sync (TipTap-on-TipTap via the existing `useFloatMainSync`; CodeMirror sync stays per-kind for `tex-block-body`). The dynamic header label ("Chapter"/"Section"/"Subsection" or "Bullet list"/"Ordered list") arrives through a `setHeaderLabel` callback on `TextObjectFloatBodyProps` — only heading-body and list-body use it. `case "textobject"` dispatcher in `floating-cards.tsx` reduced from 33-line per-kind switch to 9 lines that read `meta.floatBodyComponent` and render `<TextObjectFloat>`. Drop-spec collapse: new `drop-mode/specs/textobject.ts` dispatches via `parseTextObjectPopoutKey` → walks doc for source + parent → classifies `DropTarget` (top-level / inside-compatible / inside-incompatible) → calls `meta.dropAdapter(...)` → executes wrap or drop-direct via the registry's `collectMoveSource` (default: single node; heading overrides to section-range). New registry field `meta.collectMoveSource?` + new helper `buildWrap` in `drop-adapters.ts`. `paragraph.ts`/`heading.ts` drop specs deleted; `drop-mode/registry.ts` SPECS record gets `textobject` → `textObjectDropSpec`. MIME cleanup: `MIME_PAR_CAPTURE`/`MIME_TEXT_CAPTURE` had no live producers (the per-NodeView grips that emitted them were deleted in D4); removed from `usePanelCapture.ts` (file deleted) and from StackIcon's consumer side. Float-to-stack drag continues through the in-app `virgil-stack-drop` event. `MIME_TEXTOBJECT` stays defined for Phase E's selection-hydration drag-out. Net: 23 files, +1724/−1371. After D5+D6 the architectural shape is in: chrome unified, drop dispatch routed through the registry, no per-kind cases anywhere in chrome or spec. |
| 9 | E | `1856e5a` | Selection hydration + multi-paragraph `linkedAnchor` LaTeX round-trip. Selections now hydrate into `linkedRange` TextObjects at lift commit via `hydrateSelectionToTextObject`, taking the same unified `textobject:linkedRange:<anchorId>` popout-key path as every other TextObject. New paired markers `\vlid{id}…\vlidend{id}` introduced in the parser + serializer — the linkedAnchor mark now has a true LaTeX-level round-trip (it was app-state-only before, persisted via the sidecar's `textSnapshot` and `reanchorByText`). Parser is defensive: unmatched `\vlid` openers stamp to end-of-paragraph and `console.warn`; orphan `\vlidend` closers silently dropped. Cross-paragraph spans handled by close-and-reopen at block boundaries in the serializer + a stack-based open-anchors walker in the parser. New `linked-range-body.tsx` reads its range from the live mark (no in-memory map). Card-anchor commit sites already routed through `createLinkedAnchor` correctly (no code change needed there). MIME_TEXTOBJECT emission via grab-handle dragstart deferred: the handle is mouse-driven, not HTML5-drag-driven; the MIME stays defined for future producers. Deletions: `SelectionFloat.tsx`, `selection-floats.ts`, `drop-mode/specs/selection.ts`, `case "selection"` from the dispatcher, `selection` SPECS entry. Net 18 files, +701/−583. 8 new round-trip tests in `linked-anchor-roundtrip.test.ts`. |
| 10 | F | `e86a264` | Doc-aware popout-key sweep + ergonomics. Once-per-doc-load post-load migration in `src/text-objects/post-load-migrations.ts` walks the editor doc to resolve legacy `list:<uuid>` (→ `textobject:bulletList:<uuid>` or `textobject:orderedList:<uuid>`) and `example:<uuid>` (→ `textobject:exampleBlock:<uuid>` IFF a matching exampleBlock exists; otherwise the Examples panel-card prefix passes through). Wired from EditorLayout via a new `migratePoppedOutCards(transform)` callback exposed by `useViewPrefs`. After the sweep, `case "list"` deleted from the dispatcher — the only remaining non-`case "textobject"` branch is `case "example"` (stable panel-card prefix). Ergonomics fold: `PER_KIND_FLOAT_SIZE` moves from `TextObjectGrabHandle.tsx` into `meta.initialFloatSize?` on the registry; `FloatSourceKind` widens to include `linkedRange` + `texBlock` (drops the unused `selection`); the linkedRange body now passes `kind="linkedRange"` to `SourceMissingBanner`. Deferred: `targetKind` reconciliation post-pass — pre-D9 data has no sub-object anchors so the "paragraph" default in `migrateCardLinks` is harmless; the proper fix is write-side in `addTextObjectLink` rather than a read-pass reconciliation. Optional `paragraphId` → `textObjectId` rename of card-creation API params also deferred (scope discipline). Net 9 files, +168/−37. |
| 11 | G | `e86a264` | Sample extension + agent-docs refresh + drop-spec matrix tests. Extends `samples/annotation-history` with a graphic mid-list-item, a graphic mid-example-item (\a/\b/\c items now carry explicit `\vxid` markers + xi01..xi04 ids), and a multi-paragraph `\vlid{ab12}…\vlidend{ab12}` span demonstrating the new round-trip. Refreshes `docs/agents/glossary.md` (collapses the five per-kind float entries into the unified `TextObjectFloat` chrome + per-kind body components; adds TextObject + linkedRange-float entries; updates Mode A/B to describe the D8 collapse), `docs/agents/architecture.md` (TextObject registry as new SSOT row; popout-key prefixes section rewritten for the unified `textobject:<kind>:<id>` shape + post-load sweep; MIME map updated for the unified `TextObjectGrabHandle` flow), `docs/agents/main-text.md` (Block nodes section now describes the schema-group predicate; Link architecture rewritten for the unified `targetKind` anchor shape; drop-mode bullet updated for the collapsed `textobject.ts` spec), `docs/agents/overview.md` (adds TextObjects to core concepts). All four docs bumped to `last-verified: e86a264 2026-05-22`. New `src/text-objects/__tests__/drop-spec-matrix.test.ts` covers the source-kind × target-context matrix (23 tests) via the registry's `dropAdapter` — exercises the listItem wrap rules (top-level/compat/incompat × bullet/ordered), exampleItem wrap rules, top-level drop-direct for every other kind, and that `heading` is the only kind with a `collectMoveSource` override today. |

After session 4 (commits 1–11): typecheck clean, full suite 188 passing (157 baseline + 8 round-trip from E + 23 drop-spec matrix from G) / 8 pre-existing failures (`usePersistentState.test.ts`, unrelated baseline).

### Session 5 — polish phase (2026-05-24)

The refactor's architectural shape is in; session 5 is the ergonomics layer that exercises it. The grab-handle UI was the natural place for follow-on work because (a) sub-objects had landed structurally in B+C1 but the grab handle never actually reached them, and (b) the hover model is what the abstraction was always meant to support. Commits 12–13 made the handle reach every kind and use hover discovery; commits 14–15 made it land in the right pixel by unifying the gutter columns under CSS variables (H3) and declaring per-kind vertical anchors via `meta.chromeAnchor` (H4). After H4, "where the handle goes" is fully expressed by the registry — adding a new TextObject kind requires no per-environment placement tweaks.

| # | Phase | Commit | Spirit |
|---|---|---|---|
| 12 | H1 — sub-object handle restoration | `0b031e3` | The walker descent + decorationSafety clamp fix. `walkAnchorableBlocks` ([src/lib/marginalia-blocks.ts](src/lib/marginalia-blocks.ts)) and `buildUuidDecorations` ([src/lib/tiptap/uuid-attr.ts](src/lib/tiptap/uuid-attr.ts)) were returning `false` on the first anchorable they hit, which hid sub-objects from BOTH the marginalia registry AND the `data-uuid` DOM decoration. Net effect: listItems / exampleItems / any nested kind never appeared in `walkAnchorableBlocks(editor)`, so the grab-handle's UUID→position lookup in `computePlacement` returned `undefined` and the handle silently hid itself. Architecturally this was a pre-refactor short-circuit that the B+C1 schema-group widening exposed — the bug class was "the walker stops at the first anchorable container," fixed by removing the `return false` in both call sites. Class-of-bug pass: `exampleItem` added to `DEFERRING_PARENTS` ([src/lib/anchor-uuid.ts](src/lib/anchor-uuid.ts)) so inner paragraphs of `\a/\b/\c` items don't mint independent UUIDs (parity with `listItem`/`blockquote`/`codeBlock`). Placement-layer fix in same commit: `TextObjectGrabHandle`'s `computePlacement` now derives `editorColumnLeft` from `editor.view.dom.getBoundingClientRect().left` (the `.ProseMirror` element) instead of the anchor DOM's left edge — for sub-objects the anchor DOM is INDENTED past the editor column, so the old code was using the sub-object's own DOM edge as the gutter ceiling and clamping `decorationSafety` out of effect. After H1, sub-object handles place correctly: listItem at editor.view.dom.left − safety(18) − HANDLE_GAP(8) = gutter; exampleItem same with safety(28). Net: 4 files, +28/−12. |
| 13 | H2 — hover-driven + multi-level handles | _this commit_ | The grab handle becomes a pure hover affordance, like a tooltip, and renders one handle per containing TextObject level. Resolution priority (new): (1) non-empty text selection → 1 SelectionRef handle; (2) NodeSelection on a TextObject → 1 handle for that node; (3) mouse hover over the editor → N handles, one per containing TextObject from innermost (atom block at `pos.inside` if any) to outermost (top-level kind found by walking `$pos.depth`). Cursor-based discovery is REMOVED (no fallback for the keyboard-only case — explicit user choice). Implementation: new `resolveTextObjectsAtMouse` returns `TextObjectRef[]`; `resolveActiveRefs` returns the array; `placement` state becomes `placements: Placement[]`; new inner `<GrabHandleRender>` component binds its own `mousedown` over a captured ref so click/drag dispatches deterministically to the kind the user actually clicked (the legacy "last-known-ref" indirection is gone). Mouse tracking is always-on (the previous gate on `sel.from === sel.to && !nodeSel` is removed). Editor-DOM `mouseleave` schedules a 120ms grace-period clear; each handle's own `mouseenter` cancels the clear so the user can move from the editor onto a handle without losing it. DOM listener attachment moved INTO `ensureSubscribed` (fixes a pre-existing fragility where listeners attached at useEffect-time would miss the editor if it wasn't ready yet — the poll mechanism re-subscribed to editor events but never re-attached DOM listeners). Visibility check switched to `anchorDom.getBoundingClientRect()` because `coordsAtPos(to)` returns `{0, 0}` for multi-line block containers like `exampleBlock` with deep content trees, causing false "above viewport" rejections. Companion fix in [src/text-objects/floats/list-body.tsx](src/text-objects/floats/list-body.tsx): the list float editor registered `ExampleItem` but not `GraphicsBlock`, so its schema construction blew up after Phase B's content-rule widening made `exampleItem.content` reference graphicsBlock. Added TexBlock / FigureBlock / FigureCaption / GraphicsBlock to list-body for parity with heading-body. Net: 2 files, +426/−375 (the bulk is the TextObjectGrabHandle restructure). |
| 14 | H3 — unified gutter chrome (CSS-variable SSOT) | `b453a44` | Two failure modes the user spotted on visual review: top-level handles parked 8px from content (hugging text, not in the gutter), and the legacy per-kind popout buttons (`.par-popout-btn`, `.expex-popout-btn`, etc.) still rendered on hover despite their JSX having been deleted in `69a4680` — CSS zombies. Architectural fix: introduce two CSS variables in `:root` — `--gutter-col-chevron: -44px` and `--gutter-col-handle-inset: 22px` — as the single source of truth for the editor's left-gutter columns. `.heading-fold-chevron` and `.tex-block-fold-chevron` consume the chevron variable; `useEditorViewportCache.ts` reads `--gutter-col-handle-inset` via `getComputedStyle` and exposes it as `cache.gutterInset` so the handle's JS placement matches the CSS chrome SSOT. `computeHandleLeftEdge` ([src/text-objects/handle-layout.ts](src/text-objects/handle-layout.ts)) becomes two-branch on `meta.isSubObject`: top-level kinds park at `contentLeft − baselineInset` (shared baseline column for all top-level kinds, independent of `decorationSafety`); sub-objects keep `contentLeft − safety − SUB_OBJECT_GAP` (renamed from HANDLE_GAP for clarity) so they indent into the parent's marker zone. Also retired all zombie chrome CSS (`.par-popout-btn`, `.heading-drag-handle`, `.tex-block-drag-handle`, `.expex-drag-handle`, `.expex-popout-btn`) and widened the expex grid column-gap from 0.5em → 0.8em so the inner exampleItem handle has visual room next to the marker. Per-kind popout buttons are formally retired — grab-handle drag is the only popout mechanism. `.par-left-margin-zone` CSS rule kept with a DEAD annotation; the JSX that emits it in three NodeViews (Editor.tsx paragraph + heading wrappers, expex.ts exampleBlock wrapper) is flagged for a follow-up sweep but defanged with `pointer-events: none`. Net: 6 files, +169/−22. |
| 15 | H4 — chromeAnchor (per-kind vertical anchor) | `a26e1fd` | After H3 landed the X axis cleanly, the user surfaced three more bugs on the Y axis: (a) untitled tex blocks' wrapper top sat above the visible code pod because `.par-title-annotation` rendered in flow above (paragraphs already had a `position: absolute; bottom: 100%` override for this; headings/lists too; tex blocks didn't); (b) inner exampleItem handles overlapped the outer `(1)` marker — `EXAMPLE_ITEM_MAX_MARKER_WIDTH = 28` assumed contentLeft sat past the marker (true for listItem with `list-style-position: outside`, NOT true for exampleItem whose marker is inside its own grid), so the formula was subtracting the marker width a second time; (c) the handle anchored to `coordsAtPos(from).top` which gave the line-box top, but for headings and TitleField the leading inside the line-box pushed cap-top 8–14px below it — handle floated above the text. Architectural fix: add `chromeAnchor: "text-top" \| "block-top"` to `TextObjectMeta` ([src/text-objects/types.ts](src/text-objects/types.ts)) and declare it per kind. text-top kinds (paragraph, heading, lists, examples, blockquote, codeBlock, titleField, linkedRange) measure the first rendered glyph via `Range.getBoundingClientRect()` over the first character; block-top kinds (texBlock, latexComment, displayMath, graphicsBlock, figureBlock) use the wrapper's visual top edge. The Range walker filters `contenteditable="false"` subtrees so the `+T` add-affordance, `Section`/`Title`/`Author` pod labels, and other chrome don't steal the anchor. `EXAMPLE_ITEM_MAX_MARKER_WIDTH` renamed to `EXAMPLE_ITEM_HANDLE_INDENT = 4` with explanatory docs about the inside-grid vs outside-bullet distinction (old name kept as a re-export alias). The CSS rule for `.par-title-annotation { position: absolute; bottom: 100% }` extended to cover `.tex-block:not(:has(.par-title-text))`. CSS for `.text-object-grab-handle` flips `align-items: center` → `flex-start` so the 6-dot SVG sits at the handle's top edge (= text glyph top), not centered in the 24px hit-area box. New helper `resolveSelectionChromeAnchor` walks the PM ancestor chain for SelectionRef placement so range selections inherit the containing block's anchor. Net: 6 files, +169/−22. |

After commits 12–15: typecheck clean. Handle.top now equals the first glyph's cap-top for text kinds and the visual-block top for framed kinds, measured per-kind from the registry. Sub-pixel residual (~0.8px) from the SVG's first-circle geometry (`cy=2, r=1.2`); acceptable.

### Current state cheat-sheet (read before touching code)

**Where things live:**
- Registry SSOT: [src/text-objects/text-object-registry.ts](src/text-objects/text-object-registry.ts) — 16 kinds; each has `isSubObject`, `isAtomBlock`, `decorationSafety`, `chromeAnchor` (post-H4: `"text-top" | "block-top"`), `parentKind?`, `dropAdapter`, `floatBodyComponent`, `initialFloatSize?`, `collectMoveSource?`.
- Gutter chrome CSS variables: [src/app/globals.css](src/app/globals.css) `:root` block — `--gutter-col-chevron: -44px` and `--gutter-col-handle-inset: 22px` (post-H3). Single source of truth for the editor's left-gutter columns; both CSS chrome (chevrons) and JS placement (handle) read from these.
- Grab handle: [src/text-objects/TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) — ONE editor-mounted component. Hover-driven (post-H2). Renders array of placements via inner `<GrabHandleRender>`.
- Float chrome: [src/text-objects/TextObjectFloat.tsx](src/text-objects/TextObjectFloat.tsx) + per-kind bodies in [src/text-objects/floats/](src/text-objects/floats/). Bodies register via `registerFloatBody(kind, BodyComponent)` from [src/text-objects/floats/index.ts](src/text-objects/floats/index.ts) (side-effect imported by `Editor.tsx`).
- Drop spec: [src/components/drop-mode/specs/textobject.ts](src/components/drop-mode/specs/textobject.ts) — one spec, routes via `meta.dropAdapter`.
- Walker: `walkAnchorableBlocks` in [src/lib/marginalia-blocks.ts](src/lib/marginalia-blocks.ts). Walks every level (post-H1). Used by the marginalia registry, the grab handle's UUID→pos lookup, and `ActiveTextObjectContext`.
- DOM decoration: `UuidAttrDecorator` in [src/lib/tiptap/uuid-attr.ts](src/lib/tiptap/uuid-attr.ts). Sets `data-uuid` on every anchorable node's outer DOM element (post-H1: includes sub-objects).
- UUID minting policy: `DEFERRING_PARENTS` in [src/lib/anchor-uuid.ts](src/lib/anchor-uuid.ts) — paragraphs nested inside `listItem` / `blockquote` / `codeBlock` / `exampleItem` (added post-H1) defer their identity to the parent.
- Canonical predicate: `isAnchorableNode(nodeType)` = `nodeType.spec.attrs?.uuid !== undefined`. Schema-based. No deprecated sets remain.

**Mode A/B is collapsed.** `Link.anchor` has shape `{ type: "textObject"; targetKind: TextObjectKind; textObjectIds: string[]; textRange?: ... }`. `isModeB(link)` = `link.anchor.targetKind === "linkedRange"`. Cards can in principle anchor to any TextObject kind (sub-objects, atom blocks, etc.); the marginalia layer's positioning still needs exercise for novel kinds.

**Hover-driven handle behavior (post-H2):**
- Mouse over text → handles for every containing TextObject from innermost to outermost. Typically 1 (top-level kind) or 2 (sub-object + parent top-level); up to 3 for `graphicsBlock` inside a `listItem`.
- Text selection (drag-select) → 1 SelectionRef handle (text-lift gesture; hydrates to linkedRange on commit).
- NodeSelection (e.g. click an atom block) → 1 handle for the selected node.
- Editor mouseleave → 120ms grace period before handles hide (lets the user reach the portal-rendered handle without losing it).
- No mouse position known → no handles. Cursor-based discovery is intentionally absent.

**Handle placement math (post-H4).**

*Horizontal* — `computeHandleLeftEdge` in [src/text-objects/handle-layout.ts](src/text-objects/handle-layout.ts) branches on `meta.isSubObject`:
- Top-level (`!isSubObject`): `handle.left = contentLeft − baselineInset` (= shared baseline column, contentLeft − 22 by default).
- Sub-object (`isSubObject`): `handle.left = max(contentLeft − decorationSafety − SUB_OBJECT_GAP, editorColumnLeft − baselineInset)`. The floor clamps sub-object handles on narrow viewports. `decorationSafety` is `BULLET_DECORATION_WIDTH = 18` for listItem (bullet glyph width — listItem.contentLeft is past the bullet via CSS `list-style-position: outside`) and `EXAMPLE_ITEM_HANDLE_INDENT = 4` for exampleItem (the inner marker is INSIDE the exampleItem's grid, so we only indent into the parent column-gap, not clear a marker width). `baselineInset` is read from `--gutter-col-handle-inset` via the EditorViewportCache (post-H3) so JS placement and CSS chrome share one knob.

*Vertical* — `computePlacement` in [src/text-objects/TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) branches on `meta.chromeAnchor` (post-H4):
- `"text-top"` (paragraphs, headings, lists, examples, blockquote, codeBlock, titleField, linkedRange): `handle.top = first-glyph-top` measured via `Range.getBoundingClientRect()` over the first character of the anchor's content. The walker filters `contenteditable="false"` subtrees so chrome (the `+T` affordance, pod labels) doesn't steal the anchor.
- `"block-top"` (texBlock, latexComment, displayMath, graphicsBlock, figureBlock): `handle.top = anchorRect.top` (the wrapper's visual top edge). For tex blocks, H4's CSS extension to `.par-title-annotation { position: absolute; bottom: 100% }` ensures the wrapper top collapses onto the pod top when there's no title.
- `align-items: flex-start` on `.text-object-grab-handle` (post-H4) puts the 6-dot SVG at the handle's top edge, so the first dot row lands at the chosen anchor Y.

The caller in `TextObjectGrabHandle` derives `editorColumnLeft` from `editor.view.dom.getBoundingClientRect().left` (the `.ProseMirror` element), NOT from the anchor DOM — this is what lets sub-object handles indent past their own DOM edge into the decoration zone.

### Open follow-ups (for future sessions)

These are not blocking the refactor's completeness; they are next-step extensions / cleanups that the refactor's abstractions make easy:

1. **Sub-object anchored cards.** D8 + H1 together unlocked the data path for "anchor a note/quote/todo to a listItem or exampleItem." The marginalia gutter positioning for non-top-level anchors hasn't been exercised end-to-end. The expected fix is just `Marginalia.tsx`'s position computation reading from the sub-object's `data-uuid` element (now present post-H1) — verify in dev preview by dragging a note onto a listItem and confirming the gutter marker sits next to the item.
2. **Atom-block discoverability.** `texBlock` / `graphicsBlock` / `displayMath` / `latexComment` / `figureBlock` only reveal their handles on mouse hover (atoms have no caret position). After H2, hover discovery works for all atoms at every depth. If keyboard accessibility becomes a priority, the natural follow-up is a "menu key while focused near an atom" shortcut. Out of scope for the refactor.
3. **Legacy doc UUID lazy-assign.** Pre-A1 docs without `\vxid` markers will have `exampleItem` nodes with `uuid: null`, which `walkAnchorableBlocks` filters out (`if (uuid)` guard). The proper fix is a lazy-mint pass on first cursor/hover in such items. Phase F noted but did not implement this.
4. **`%!v:` marker cleanup.** Docs saved between A1 and H1 may carry `%!v:` markers on inner paragraphs of `exampleItem`s (the deferring rule didn't apply yet). H1's `DEFERRING_PARENTS` addition prevents new ones; existing redundant markers are harmless (parser accepts them; the resolver returns the exampleItem regardless because of the deferring rule). No active migration needed.
5. **Float body parity audit.** H2 surfaced that `list-body.tsx` was missing GraphicsBlock — a schema-construction bug latent since Phase B. Audit: every float body that registers `StarterKit` (which provides `ListItem`) or `ExampleItem` must also register `GraphicsBlock`, because `listItem.content` and `exampleItem.content` reference it. Today: `heading-body`, `example-block-body`, and (post-H2) `list-body` are correct. `paragraph-body` / `linked-range-body` disable `listItem` via StarterKit config and don't register `ExampleItem`, so they're safe. Future bodies need to follow the heading-body pattern.
6. **Marginalia DOM positioning for atom-block anchored cards.** A card anchored to an atom (graphicsBlock, texBlock) needs marker placement at the atom's top edge — `useMarginaliaRegistry` reads the atom's DOM rect via the data-uuid decoration that H1 now applies. Should "just work" but hasn't been visually verified.
7. **`.par-left-margin-zone` dead-DOM cleanup.** H3 retired the legacy popout-button CSS that this 60×100% sensor div fed via `:has()` selectors. The CSS rule is annotated DEAD and defanged with `pointer-events: none`, but three NodeViews still emit the div: paragraph wrapper in [Editor.tsx](src/components/Editor.tsx:501), heading wrapper in [Editor.tsx](src/components/Editor.tsx:990), exampleBlock wrapper in [src/lib/tiptap/expex.ts](src/lib/tiptap/expex.ts:432). Mechanical removal — touches each NodeView's `dom.appendChild` setup. No functional impact.
8. **Titled tex block handle Y-anchor.** H4's CSS rule (`.tex-block:not(:has(.par-title-text)) > .par-title-annotation { position: absolute }`) only fires for UNTITLED tex blocks. Titled tex blocks keep the annotation in flow above the pod and the handle (chromeAnchor: "block-top") anchors at wrapper top = above the title row. Acceptable by design ("grip the whole titled block"); revisit if visual review disagrees.

### The spirit (re-stated for every session)

**Deep architectural fixes — not surgical patches.** This refactor exists because the existing consistency is enforced by team vigilance, not by design. Every parallel implementation §4 enumerates is something to delete or merge through the new pathway. Where you find drift (the deprecated `ANCHORABLE_NODES` set omitting `figureBlock`/`graphicsBlock`; `figureBlock` lumped with "atom blocks" when it's actually `content: "figureCaption?"`; the `EntityKind`/`TextObjectKind` name collision around `example`), surface and fix it as part of the refactor — don't leave the drift behind for the next vigilant person.

When fixing a reported case, look for the class of bug and the analogous siblings. When extending functionality (sub-object popout, multi-paragraph linkedAnchor, graphicsBlock-in-list, cards-on-any-text-object), the extensions should be trivial after the refactor — if they're not, the abstraction isn't right yet.

The H1 walker fix illustrates the principle: the bug was reported as "sub-object handles don't appear," but the root cause was the walker short-circuiting at the first anchorable — which simultaneously broke sub-object enumeration AND the `data-uuid` DOM decoration AND any future "cards anchored to sub-objects" feature. One line in two places fixed all three, plus the analogous `DEFERRING_PARENTS` rename for `exampleItem`. The H2 hover restructure illustrates the same principle in reverse: a UX request ("hover, not click") that was trivial because the registry + handle-layout + canonical predicate were already in place — the rewrite was a pure data-flow change, not new architecture.

Detailed session-1 plan (with all the cross-cutting concerns called out): `/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`. Session-5 plan: `/Users/gabriel/.claude/plans/i-want-to-finsih-zippy-wilkinson.md`.

---

## 1. Spirit and Ambition

Virgil currently has at least three parallel implementations of "graspable text unit":

- **Main-editor grab handles** — `SelectionDragHandle` (the 6-dot lift in the gutter), normalized via `DragHandlePassage`, dispatched via `DragHandleMenu`.
- **Per-node-view grips** — `texBlock`, `figureBlock`, `graphicsBlock`, `exampleBlock` each render their own grip/popout elements inside their TipTap NodeViews. Different code paths, different visual conventions, different drag payloads.
- **Float-internal grips** — `ParagraphFloat`, `HeadingFloat`, `ListFloat`, `SelectionFloat`, plus per-block popouts each have their own internal drag affordances.

Around those sit scattered registries: anchorable-node predicates, drag-handle passage unions, drop-mode specs, popout-key prefixes, MIME types for text-object transport, marginalia anchor fields. Today they behave consistently mostly because the team has been careful — the consistency is enforced by vigilance, not by design.

**This refactor introduces `TextObject` as the single canonical abstraction** for everything in Virgil that:
- has its own block-level position in the document (not inline)
- carries an identity that persists across edits
- can be grabbed, popped out, dropped, and anchored to

After the refactor, every parallel implementation routes through this one pathway. Adjusting the affordances of a TextObject ripples outward automatically.

**β-scope.** All other code edits halt until this ships. The refactor is conceptually unified and the implementation should match it: don't ship as a series of small patches. The architectural shape is the deliverable.

**Extend functionality where it is patchy.** Sub-object popout (list items, example items), drop-context adaptive wrapping, multi-paragraph `linkedAnchor`, cards attachable to sub-objects, `graphicsBlock` allowed inside `listItem` and `exampleItem` — these aren't bolted-on extras; they're tests of whether the new abstraction is right. If the abstraction is right, they become trivial extensions.

---

## 2. The TextObject Taxonomy (Closed Union)

Two families:

### A. Persistent nodes
TipTap block-level nodes with a `uuid` attr. Lifecycle = lifetime of the node.

**Top-level kinds:**
1. `paragraph`
2. `heading`
3. `bulletList`
4. `orderedList`
5. `blockquote`
6. `codeBlock`
7. `displayMath`
8. `titleField`
9. `latexComment`
10. `texBlock`
11. `figureBlock`
12. `graphicsBlock`
13. `exampleBlock`

**Sub-object kinds** (only meaningful inside a parent; if dropped outside, wrap into a fresh single-item parent — see §8):
14. `listItem` — parent kinds: `bulletList`, `orderedList` (source list kind carried in the dragged payload so the wrap reproduces it)
15. `exampleItem` — parent kind: `exampleBlock` (via `exampleItemList` wrapper)

### B. Persistent ranges
TipTap mark with id. Lifecycle = lifetime of the mark.

16. `linkedRange` — id is the `linkedAnchor.anchorId`. Created on selection-popout. Also created when a Mode B card is anchored to a range. May span multiple paragraphs (see §5).

### Excluded — NOT text objects
- Inline atoms: `footnote`, `citation`, `inlineMath`, `aiRequest`, `labelRef`, `latexCommandMark`
- Marks (other than `linkedAnchor`, which backs `linkedRange` but is itself not a TextObject)
- Structural sub-sub-objects: `exampleItemList` (wrapper), `figureCaption`, `exampleGloss`, `alignedGlossRow`, `proseGlossRow`, `glossCell`

---

## 3. Registry Shape (the new SSOT)

Sit alongside `src/panels/panel-registry.ts` and `src/links/link-registry.ts`. Name: `src/text-objects/text-object-registry.ts` (new top-level `text-objects/` directory mirroring `links/` and `panels/`).

Sketch (refine in implementation):

```ts
export type TextObjectKind =
  | "paragraph" | "heading"
  | "bulletList" | "orderedList" | "blockquote" | "codeBlock"
  | "displayMath" | "titleField" | "latexComment"
  | "texBlock" | "figureBlock" | "graphicsBlock" | "exampleBlock"
  | "listItem" | "exampleItem"
  | "linkedRange";

export interface TextObjectMeta {
  label: string;
  /** Sub-object kinds wrap into a fresh single-item parent when dropped outside. */
  isSubObject: boolean;
  /** For sub-objects: the parent kind to wrap into. listItem carries the source list kind in the payload to drive this. */
  parentKind?: TextObjectKind;
  /** Atom block (uses DOM-rect positioning, not coordsAtPos). */
  isAtomBlock: boolean;
  /** Range (linkedRange) vs node. */
  isRange: boolean;
  /** Px reserved to the right of the handle for bullet/marker decoration. See §7. */
  decorationSafety: number;
  /** Float component for popout (parameterized; replaces per-kind floats). */
  floatComponent: ComponentType<TextObjectFloatProps>;
  /** DragHandleMenu actions this kind exposes. */
  actions: ReadonlyArray<DragHandleAction>;
  /** Source-marker spec for .tex round-trip (if any). e.g. paragraph uses %!v:xxxx; exampleItem needs a new marker. */
  sourceMarker?: { command: string; idLength: 4 };
  /** Drop adapter — given a target context, can this kind drop directly, or does it need wrapping? */
  dropAdapter: (target: DropTarget) => DropAction;
}

export const TEXT_OBJECT_REGISTRY: Record<TextObjectKind, TextObjectMeta>;
```

The schema-side companion: add `groups: "textObject"` to the node spec of every persistent-node kind so PM's `nodeType.isInGroup("textObject")` is the canonical predicate. (`linkedRange` lives on a mark, not a node, so it's handled separately.)

---

## 4. Current Fragmentation to Retire

Every entry below is something to delete, merge, or refactor through the new pathway. Verify each in code before acting; this list is from the conversation's read of the architecture and may have drift.

| Surface | File(s) (verify) | Disposition |
|---|---|---|
| `isAnchorableNode` predicate | `src/lib/marginalia.ts` | Replace with `nodeType.isInGroup("textObject")`. Delete the deprecated `ANCHORABLE_NODES` and `ANCHORABLE_ATOMS` sets. |
| `DragHandlePassage` union | `src/components/editor-layout/card-actions/drag-handle-actions.ts` | Replace with `TextObjectRef = { kind: TextObjectKind; id: string }` (plus a separate `SelectionRef` for the gesture-input layer). `paragraph`/`heading`/`atomBlock` variants collapse into one. |
| `SelectionDragHandle` (main-editor grip) | `src/components/SelectionDragHandle.tsx` | Becomes the canonical single grab-handle component (renamed `TextObjectGrabHandle`). Accepts a `TextObjectRef \| SelectionRef`. Applies the indent rule from §7. Replaces the per-node-view grips. |
| Per-node-view grips | `src/lib/tiptap/tex-block.ts`, `src/lib/tiptap/figure-block.ts`, `src/lib/tiptap/graphics-block.ts`, `src/lib/tiptap/expex.ts` (for exampleBlock) | Delete the bespoke grip elements. Each NodeView still owns its content rendering, but the grab handle is contributed by the editor-level `TextObjectGrabHandle` infrastructure based on the node's TextObject membership. |
| Float components (per-kind) | `ParagraphFloat.tsx`, `HeadingFloat.tsx`, `ListFloat.tsx`, `SelectionFloat.tsx`, plus the example-block/tex-block popout floats | Collapse into one parameterized `TextObjectFloat` that delegates to a kind-specific body renderer registered in the TextObject registry. |
| Drop-mode specs | `src/components/drop-mode/specs/paragraph.ts`, `heading.ts`, `selection.ts`, plus `ai-request.ts`, `stack-pull.ts` | Collapse `paragraph` + `heading` + any other block-source specs into one `textObject.ts` spec parameterized by kind. `selection.ts` collapses too — selections hydrate into `linkedRange` text-objects at drop commit. `ai-request.ts` and `stack-pull.ts` likely stay (different payloads). |
| Popout key prefixes for blocks | `prefs.poppedOutCards` lookup, `src/components/editor-layout/floating-cards.tsx` | Today: `paragraph:<uuid>`, `heading:<uuid>`, `example:<uuid>` (the in-editor variant). New: unified `textobject:<kind>:<id>`. Migration: a one-time prefs upgrade on load that rewrites old keys to the new shape. |
| MIMEs for text-object transport | `MIME_PAR_CAPTURE`, `MIME_TEXT_CAPTURE` (`src/hooks/usePanelCapture.ts`?), plus float-body grips | One MIME: `application/x-virgil-textobject`. Payload includes `{ kind, id, sourceContext }` where `sourceContext` carries enough info to drive the drop adapter (e.g. for a `listItem` from a `bulletList`, the source list kind). |
| `Mode A` / `Mode B` distinction on Link | `src/links/link-registry.ts`, `src/links/links.ts`, `src/links/_shared/types.ts` | Collapse. The anchor target is just a `TextObjectKind`: persistent-node kinds = today's Mode A; `linkedRange` = today's Mode B. `isModeB(link)` becomes `link.anchor.targetKind === "linkedRange"`. The 3-kind `LinkKind` (footnote/citation/anchor) stays — that's about *what links to what*, not about *what's being anchored to*. |
| Marginalia anchor field | `src/lib/marginalia.ts` — `MarginaliaMarker.paragraphId` | Rename to `textObjectId`. The field is already kind-agnostic in spirit; the rename makes that explicit. Update consumers. |
| `EntityKind` union | `src/links/_shared/entity-hover.ts` | Audit. EntityKind is about *cards*, not about *what they anchor to*. Keep it as-is for cards (note/cut/revision/todo/archive/quotation/footnote/citation), but its definition should not duplicate or shadow `TextObjectKind`. |
| Multiple grip implementations in floats | Inside each float component | Delete per-float grip code; the unified `TextObjectGrabHandle` handles the gesture for the wrapped content. Floats can still have a header drag-region for window moves — that's separate from text-object gestures. |

---

## 5. Reinforcement Work (do these BEFORE the unification, in the same session)

### 5.1 `exampleItem` UUID + source marker

`exampleItem` does not have a `uuid` attr today. Add one.

For the source marker: today the family is `\vfid{xxxx}` (footnote), `\vcid{xxxx}` (citation), `\vexid{xxxx}` (example-block). Add `\vxid{xxxx}` (or similar — pick a non-colliding name) for `exampleItem`. Parser emits, serializer preserves.

Verify (the next session must check before depending):
- `listItem` UUID round-trip — `listItem` is in the deprecated `ANCHORABLE_NODES` set, but confirm the parser/serializer actually persist a `%!v:` anchor on listItems across save/reload. If not, fix it as part of this work.
- `figureBlock` and `graphicsBlock` `uuid` attrs — they should already be there (the schema-based `isAnchorableNode` detects them); verify.

### 5.2 Multi-paragraph `linkedAnchor`

The `Link` type uses `paragraphIds: string[]` (plural), suggesting multi-paragraph was anticipated. Today the linkedAnchor mark in practice anchors a range within one paragraph (Mode B's `textRange` carries one `paragraphId`).

Extend: a `linkedAnchor` mark with a given `anchorId` may exist on multiple ranges across multiple paragraphs, and the `linkedRange` text-object aggregates them. Practically:

- Parser/serializer must support `\vlid{<anchorId>}…end-anchor` markers (or equivalent) across paragraphs.
- Marginalia must position the marker next to the first line of the first paragraph in the range (already true for single-paragraph; extend).
- The float/popout for a multi-paragraph `linkedRange` shows the full ranged content.

Verify before depending: read the linkedAnchor mark schema to confirm what's already there. If multi-paragraph already works for the mark itself but the *Link* type's plumbing is the bottleneck, extension is mostly in the Link types and the marginalia/popout code.

---

## 6. Content-Rule Changes (schema)

User-confirmed nesting target = **(b)+**:

- `listItem.content` — extend to allow `graphicsBlock` (the `\includegraphics` kind). Today probably `paragraph block*`; widen to include `graphicsBlock` explicitly.
- `exampleItem.content` — same: allow `graphicsBlock`.

**Do NOT widen:**
- `texBlock` in `listItem` or `exampleItem` (not needed for now)
- `figureBlock` in `listItem` or `exampleItem` (never needed)

When tables are added later, the same change happens for the table kind. Build the content-rule extension in a way that makes "add another allowed inner kind" a one-line change, not a deep rewrite.

LaTeX round-trip implications:
- `\begin{itemize}` containing `\includegraphics` mid-item — parser must accept this; serializer must emit it.
- Expex with `\includegraphics` inside an `\a` item — same.

---

## 7. The Grab-Handle Indent Rule

**Architectural principle:** measurement-based, with per-kind customization declared in one place (the registry's `decorationSafety`), and a clamp to keep top-level handles in the gutter.

Algorithm:

```
handleRightEdge = elDOM.getBoundingClientRect().left
                - decorationSafety[textObjectKind]
                - HANDLE_GAP
handleRightEdge = max(handleRightEdge, editorColumnLeft - HANDLE_GAP)
```

Where:
- `elDOM.getBoundingClientRect().left` = the rendered content-box left edge of the text object's DOM element.
- `decorationSafety[kind]` = a per-kind reserved zone for things rendered to the left of content (bullets, ex-markers). Defaults to 0; non-zero for `listItem` and `exampleItem`.
- `HANDLE_GAP` = a small constant breathing space.
- The clamp ensures top-level paragraphs (which sit at the editor column edge) keep their handle out in the gutter — current behavior.

For `exampleItem`, the marker width varies by depth (cycles `1.`/`a.`/`i.`/`A.`/`I.`). Two acceptable strategies:
- **(a)** Hardcode the widest of the cycle (`iii.` worst case) as `decorationSafety` — simple, slightly wasteful at shallow depths.
- **(b)** Live-measure via `Range.getBoundingClientRect()` on the marker text — accurate, slightly more complex.

Start with (a). Escalate to (b) only if it visually breaks.

The function lives in one shared utility (e.g. `src/text-objects/handle-layout.ts`). Every grab-handle render reads from it. No per-kind grip components doing their own placement math.

---

## 8. Drop-Context Adapter

User's spec (verbatim from conversation):

> "if they are dropped down, outside of their native environment, they should just become object-level items, if the same kind. (So if you pull out an 'a. Example text' as a sub-object in an expex list... you can drop it down in another expex list, and it will stay a sub-object. if you drop it down in clear text, it becomes its own expex list. Mutatis mutandis for other list items.)"

Encoding:

The dragged payload `{ kind, id, sourceContext }` reaches a drop site. The drop site's context is one of:
- inside-same-parent-kind (e.g. inside another `bulletList` for a `listItem` from a `bulletList`)
- inside-cross-parent-kind (e.g. inside an `orderedList` for a `listItem` from a `bulletList` — for `listItem`, both parents accept it, so this is also "inside-same-parent-kind" in effect)
- inside-incompatible-parent (e.g. inside an `exampleBlock` for a `listItem`)
- inside-top-level (paragraph-level slot in the doc)

The registry entry's `dropAdapter` decides:
- Inside-compatible → drop directly as the sub-object.
- Inside-incompatible OR inside-top-level → wrap in a fresh single-item parent of `parentKind`. For `listItem`, the wrap kind comes from `sourceContext.parentKind` (so a `listItem` from a `bulletList` wraps into a fresh `bulletList`, even when dropped at top level). For `exampleItem`, always wraps into `exampleBlock`.

Same machinery for top-level kinds: dropping a `paragraph` into a `listItem`'s content (now legal per §6 for `graphicsBlock` — extend the principle?) should wrap if needed; but the explicit user-facing rule is currently sub-object-driven, so don't over-generalize.

The drop adapter is a function in the registry entry, NOT a per-case switch scattered across `drop-mode/specs/`.

---

## 9. Selection-on-Popout Hydration

The user gesture starts with a live text selection. It is NOT a TextObject yet — no id, no registry entry. It's an input to a gesture.

When the user commits a gesture that requires persistence (popping the selection into a float; anchoring a card to it; etc.), the gesture **hydrates** the selection into a `linkedRange` text-object:

1. Generate a fresh `anchorId` (4-char hex via `generateShortId()`).
2. Stamp a `linkedAnchor` mark with that `anchorId` over the selection's range. (May span multiple paragraphs per §5.2.)
3. Selection is now a `linkedRange` text-object with id = `anchorId`. All downstream code paths (float, popout key, drop spec, card anchor) key on it.
4. If the user dismisses the popout or unanchors all cards from the range with no remaining references, the mark can be reaped (existing `linkedAnchor` cleanup logic, audit it).

In code, this is one small function — `hydrateSelectionToTextObject(view, from, to): TextObjectRef`. Call sites: popout commit, card-anchor commit, drop-mode commit on a selection source.

**All popouts persist.** There is no "ephemeral selection float" category in the new world. If a popout is created, the selection is hydrated. (If we later want ephemeral previews, they live outside the popout system.)

---

## 10. Cards Anchored to Any TextObject (Mode A/B Collapse)

Today: Mode A = paragraph anchor; Mode B = paragraph + text range (linkedAnchor mark).

New world: a card's anchor is a `TextObjectRef`. The target kind determines layout/behavior:
- Persistent-node target → marker positioned at the node's first-line top (today's Mode A behavior, generalized).
- `linkedRange` target → marker positioned at the range's first-line top, with optional text-tint painting (today's Mode B).

This means cards become attachable to **any** text-object kind — including sub-objects (`listItem`, `exampleItem`) and atom blocks. Marginalia already keys on UUID, so most of this works once we extend; what needs care is the layout math for new kinds (e.g. a card anchored to an `exampleItem` should position next to that item's first line, not the surrounding `exampleBlock`'s top).

Cleanup to bundle:
- `isModeB(link)` becomes `link.anchor.targetKind === "linkedRange"`.
- `Link.anchor` shape unifies. Audit `src/links/_shared/types.ts` and `src/links/links.ts` for what splits and what stays.

---

## 11. Migration Considerations

- **Sub-object UUIDs in existing docs.** Once `exampleItem` has a `uuid` attr, existing docs (which don't have `\vxid` markers on example items) need IDs assigned on load. Lazy ID assignment on first parse is fine; round-trip writes them out the next time the doc is saved.
- **Popout-key migration.** Existing `prefs.poppedOutCards` entries with `paragraph:<uuid>`, `heading:<uuid>`, `example:<uuid>` prefixes need to migrate to `textobject:<kind>:<id>`. One-time read-side rewrite on prefs load.
- **Mode B link migration.** Existing Mode B links should map cleanly to the new shape — same anchorId, just refactored fields. Audit for any subtle shape changes.
- **Document version stamp.** Consider whether this refactor warrants bumping a doc-format version sentinel so future readers know they're seeing the new shape. Probably not necessary if the migration is purely additive (new attrs, new IDs), but worth thinking about.
- **No silent data loss.** Anything that fails to migrate should surface (toast, console warning) — do not silently drop popouts, anchors, or sub-object identities.

---

## 12. Files to Touch (initial inventory — verify and extend during the work)

This is a starter set, not exhaustive. The implementing session will discover more.

### New files
- `src/text-objects/text-object-registry.ts` — the SSOT.
- `src/text-objects/types.ts` — `TextObjectKind`, `TextObjectRef`, `TextObjectMeta`, `SelectionRef`.
- `src/text-objects/TextObjectFloat.tsx` — parameterized float.
- `src/text-objects/TextObjectGrabHandle.tsx` — unified grab handle (or refactor `SelectionDragHandle.tsx` into this).
- `src/text-objects/handle-layout.ts` — the indent-rule utility.
- `src/text-objects/hydrate-selection.ts` — selection → `linkedRange` hydration.
- `src/text-objects/drop-adapters.ts` — sub-object drop wrapping (registry exposes these as `dropAdapter`).

### Heavy edits (verify file paths)
- `src/lib/marginalia.ts` — replace `isAnchorableNode`, rename `paragraphId` → `textObjectId`.
- `src/components/SelectionDragHandle.tsx` — refactor into the unified handle.
- `src/components/editor-layout/card-actions/drag-handle-actions.ts` — replace `DragHandlePassage` with `TextObjectRef`.
- `src/components/DragHandleMenu.tsx` — actions per-kind from the registry.
- `src/lib/tiptap/expex.ts` — add `uuid` to `exampleItem`; widen `exampleItem.content` for `graphicsBlock`; emit/parse `\vxid` markers; delete in-node-view grip from `exampleBlock`.
- `src/lib/tiptap/tex-block.ts` — delete in-node-view grip.
- `src/lib/tiptap/figure-block.ts` — delete in-node-view grip.
- `src/lib/tiptap/graphics-block.ts` — delete in-node-view grip.
- `src/lib/tiptap/linked-anchor.ts` — verify multi-paragraph support; extend if needed.
- `src/lib/latex-parser.ts` and `src/lib/latex-serializer.ts` — round-trip the new `\vxid` markers; verify `listItem` `%!v:` round-trip; multi-paragraph `linkedAnchor` parsing.
- `src/links/link-registry.ts`, `src/links/links.ts`, `src/links/_shared/types.ts` — Mode A/B collapse into a single anchor-target shape.
- `src/components/drop-mode/specs/*.ts` — collapse block-source specs into one.
- `src/components/drop-mode/registry.ts` — wire to the new collapsed spec.
- `src/components/editor-layout/floating-cards.tsx` — unified popout dispatcher reading `textobject:<kind>:<id>` keys.
- `src/components/ParagraphFloat.tsx`, `src/components/HeadingFloat.tsx`, plus list/selection floats — collapse into the new `TextObjectFloat`. Many files DELETED here.
- `src/hooks/useViewPrefs.ts` — popout-key migration (read-side rewrite).
- `src/hooks/usePanelCapture.ts` (or wherever the MIMEs live) — unified MIME.

### Lighter edits
- Any consumer of `paragraphId` on marginalia markers (rename).
- Any consumer of `DragHandlePassage` (rename / reshape).
- Any consumer of `isAnchorableNode` (replace with `nodeType.isInGroup("textObject")`).
- Docs: `docs/agents/main-text.md`, `docs/agents/architecture.md` — describe the new model after the refactor lands.

---

## 13. Definition of Done

The refactor is done when ALL of the following hold:

1. **Single canonical predicate.** "Is this a text object?" is answered by `nodeType.isInGroup("textObject")` everywhere. The old `isAnchorableNode`, `ANCHORABLE_NODES`, `ANCHORABLE_ATOMS` are deleted.
2. **Single registry.** Adding a new text-object kind = one entry in `text-object-registry.ts` + adding the node to the `textObject` schema group. No edits to drop specs, float dispatchers, marginalia code, popout key handling, MIME registries, or DragHandleMenu code are needed.
3. **Single grab-handle component.** `TextObjectGrabHandle` is the only grab-handle implementation in the codebase. Per-node-view grips on `texBlock`/`figureBlock`/`graphicsBlock`/`exampleBlock` are deleted.
4. **Single float component.** `TextObjectFloat` (parameterized) is the only block-popout float. `ParagraphFloat`, `HeadingFloat`, `ListFloat`, `SelectionFloat`, and per-block popout floats are deleted (or reduced to thin kind-body renderers registered in the registry).
5. **Single drop spec for text objects.** The per-source-kind drop specs collapse into one parameterized spec; the drop-context adapter handles wrap/no-wrap.
6. **Unified MIME.** One MIME for text-object transport; old `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` deleted.
7. **Unified popout keys.** All block popouts use `textobject:<kind>:<id>`; old prefixes migrated.
8. **Sub-objects fully functional.** `listItem` and `exampleItem` can be popped out, dropped, drop-adapted (wrap if needed), and have cards anchored to them. `exampleItem` has a UUID with `\vxid` round-trip.
9. **`graphicsBlock` inside `listItem` and `exampleItem` works.** Schema permits it; LaTeX round-trip preserves it; grab handle positions correctly with `decorationSafety`; cards can anchor to it inside the nested context.
10. **Selection popout hydrates.** Popping out a selection creates a `linkedAnchor` mark with `anchorId` and treats the result as a `linkedRange` text-object. Persists across reload.
11. **Multi-paragraph `linkedRange`.** A selection spanning multiple paragraphs can pop out, persist, and be anchored to by cards.
12. **Mode A/B collapse.** `Link.anchor` has a single shape parameterized by `TextObjectKind`; `isModeB` becomes a derived check.
13. **Cards on any text object.** Notes/todos/quotations/etc. can be anchored to any text-object kind, including sub-objects and atom blocks; marginalia layout positions correctly.
14. **No silent data loss.** Existing docs and prefs migrate cleanly; nothing dropped without surfacing.
15. **Dev preview verified.** Walk through the dev doc (`virgil-data/doc_devtest`) and exercise: pop out a paragraph, a heading, a list, a list item, an example item, an example block, a tex block, a figure, a graphic, an image inside a list, an image inside an example, a selection. Drop them in various places. Anchor a note to a list item. Verify everything works.

---

## 14. Open Verifications (do these BEFORE depending on their state)

The conversation that produced this memo relied on architecture docs and the codebase index. Before depending on any of these, the implementing session must verify:

- **`listItem` `%!v:` round-trip.** Does the parser emit a `%!v:` anchor on `listItem`, and does the serializer preserve it? (It's in the deprecated `ANCHORABLE_NODES` set, but check.)
- **`figureBlock` and `graphicsBlock` UUID attrs.** Check the schemas; `isAnchorableNode` should detect them via schema-based detection.
- **`linkedAnchor` mark multi-paragraph status.** Read `src/lib/tiptap/linked-anchor.ts`. Does the mark naturally span paragraphs in PM, or is there logic that constrains it to one paragraph?
- **`Link.paragraphIds` actual usage.** Is the plural already meaningful (consumers handle N), or is it cosmetic with N=1 everywhere?
- **`SelectionFloat` persistence today.** Does it use `linkedAnchor` to persist or is it session-only? Inform the migration story.
- **Drop-mode spec list.** Confirm the actual file set in `src/components/drop-mode/specs/`.
- **MIME names** for text-object transport — confirm `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` are the only ones, or list any others.
- **Popout key prefix list** — confirm `paragraph:` / `heading:` / `example:` are the only block-popout prefixes.

---

## 15. Working Pattern for the Implementing Session

1. **Read this memo end-to-end.** Plus `AGENTS.md`, `docs/agents/main-text.md`, `docs/agents/architecture.md`.
2. **Run `/plan` first.** Produce a step-by-step plan that walks through §5 (reinforcement work), §6 (content rules), §3 (registry), §4 (unification), §7-§10 (cross-cutting), §11 (migration). Get user sign-off on the plan before writing implementation code.
3. **Verify all of §14** as the early steps of the plan.
4. **Build foundation, then migrate.** Order suggested: schema + registry + grab-handle + float skeleton (foundation) → then rewire each parallel implementation through it, deleting the old one as you go.
5. **Verify in the dev preview.** Use `virgil-data/doc_devtest` (the dev doc, reloaded from `samples/annotation-history/` if it gets choppy). Walk through every kind. Don't claim done without §13.15.
6. **Run typechecks and any test suite.** Don't bundle unrelated cleanup. The scope is large enough already.
7. **No out-of-scope refactoring.** This is wide horizontally, not deep vertically. Don't redesign panels, cards, or links beyond what's required by §4 and §10.

---

*This memo is a working planning document for a single refactor. Once the refactor lands, archive or delete it.*
