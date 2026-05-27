# Text-Object Refactor — A Unified Canonical Pathway

Working memo. Captures the design conversation that produced it, the implementation plan, and progress through the refactor. The implementing session should read this end-to-end before touching code, and consult it whenever a question arises about scope or shape.

---

## Progress (updated 2026-05-26, session 10 — grab-handle visibility regression resolved; portal moved out of pod's clipPath subtree)

Branch: **`main`** (the refactor branch merged after session 4; session 5+ work lands directly on main as a polish phase). 11 G-level commits + several follow-on commits + 2 session-5 commits + session 6/7/8/9 entries below.

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

### Session 6 — drag-handle action menu + hover-zone fix (2026-05-25)

Session 6 was UX restoration that surfaced two architectural extensions. (a) The drag-handle menu's destructive row had a lone red Archive at the bottom — no Duplicate, no Delete — and demoting Archive while adding the other two demanded a per-CardKind clone/delete SSOT (a fourth registry alongside `TEXT_OBJECT_REGISTRY` / `PANEL_REGISTRY` / `LINK_REGISTRY`) plus two generic walkers that contain zero per-kind branches. (b) The hover-to-handle pipeline was widened so the handle stays visible across the cursor's full travel from text into the gutter: the prior hit-test gated on `document.elementFromPoint(...)` being inside the editor's content DOM, so the handle vanished the moment the cursor crossed out of the prose. The fix extends `EditorViewportCache` (the editor-geometry SSOT introduced in H3) with hover-zone bounds and a coord-clamp helper, then rewrites the resolver to use them.

| # | Phase | Commit | Spirit |
|---|---|---|---|
| 16 | I1 — drag-handle lifecycle ops (Duplicate / Delete) + Card lifecycle SSOT | `_this commit_` | The popover ended at `archive` (the lone destructive entry, last in the list, red text); there was no Duplicate or Delete. New layout: 8 primary tools, divider, Duplicate (D, copy icon, black), divider, Archive (A, demoted to BLACK — no longer destructive), Delete (⌫, trash icon, RED). Architecturally, this required a new per-CardKind clone/delete SSOT because the prior dispatcher only knew how to talk to archive via ad-hoc deps (`archiveContent` / `updateArchiveSnippet` / `addArchiveTextObjectId`) on `DragHandleActionsDeps` — a per-kind enumeration in EditorPane. New `src/panels/card-lifecycle-registry.tsx` defines `CardLifecycle = { clone(sourceId): newId \| null; delete(id): void }` and the per-doc `CardLifecycleApi` shape (stable identity via a ref so the dispatcher's `useCallback` doesn't churn). Each per-doc sidecar hook gained a `clone*` method that deep-copies content + metadata, mints a fresh id, and writes the new card with empty links (rewireup deferred — see follow-up 10): `cloneFootnote` ([src/hooks/useFootnotes.ts](src/hooks/useFootnotes.ts)), `cloneCitation` ([useCitations.ts](src/hooks/useCitations.ts)), `cloneNote` + `cloneHighlight` ([useNotes.ts](src/hooks/useNotes.ts)), `cloneComment` + `cloneSuggestion` ([useRevisions.ts](src/hooks/useRevisions.ts)), `cloneComment` + `cloneSuggestion` ([useCutter.ts](src/hooks/useCutter.ts)). EditorPane assembles the registry from the live hooks via a `useMemo`, derives the stable API through `useCardLifecycleApi(registry)`, and passes it as a new `cardLifecycle` field on `DragHandleActionsDeps`. Two new generic walkers contain ZERO per-kind branches: `src/text-objects/duplicate-slice.ts` walks a PM `Slice`, remints uuids (registry-driven via `meta.sourceMarker?.idLength` to choose `generateShortId` vs `generateEntityId`), mints new ids for inline-atom card nodes (footnote/citation) via `lifecycle.clone(kind, oldId)`, and rewrites `linkedAnchor` marks with new `anchorId` + new `linkCard` after cloning the target card; `src/text-objects/delete-range.ts` walks `[from, to)`, enumerates inline atoms + linkedAnchor marks, and calls each kind's `lifecycle.delete`. The dispatcher's new `duplicate` and `delete` cases are one-line delegations to those walkers plus a single PM transaction; new `outerRangeFor(ed, ref)` returns the outer block bounds (heading collapses to section via the existing `collectMoveSource`). The `INLINE_ATOM_CARDS` lookup is a 2-entry map literal (`footnote` → `footnoteId`, `citation` → `citationId`) — adding a new sidecar-bearing inline-atom kind is one entry, not a switch arm. Per-kind action filtering still lives on `meta.actions`, so a future singleton kind can drop entries with a one-line registry change. Archive's existing path stays on its ad-hoc deps with an explicit `TODO(card-lifecycle)` at the dispatcher — see follow-up 9. Menu UI in [DragHandleMenu.tsx](src/components/DragHandleMenu.tsx): added `duplicate` + `delete` to the `DragHandleAction` union (mirrored in [types.ts](src/text-objects/types.ts) for the React-free copy); reorganized `MENU_ENTRIES`; added `IconDuplicate` (overlapping rounded rectangles) and `IconTrash` (lid + body) to [panel-icons.tsx](src/components/editor-layout/panel-icons.tsx); keyboard handler loosened so Backspace/Delete both fire the destructive `delete` action (display hint: ⌫). |
| 17 | I2 — grab-handle hover zone (row-wide hit zone) | `_this commit_` | Reported as "the grab bar disappears when I go to grab it." Class of bug: the hit-test in `resolveTextObjectsAtMouse` was `document.elementFromPoint(x, y)` AND-gated against `editor.view.dom.contains(hit)` — so the moment the cursor crossed out of the editor's content into the gutter (where the handle lives, 22px to the left via `--gutter-col-handle-inset`), the resolver returned `[]` and the handle vanished. The 120ms `MOUSE_LEAVE_GRACE_MS` plus the handle's own `onMouseEnter` covered the shortest possible cursor travel, but for slower moves or wider viewports the cursor died in the gutter before reaching the 10×14px handle. Architectural fix: introduce the hover-zone abstraction at the editor-geometry SSOT ([useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts), the cache that already owns `editorRight` / `gutterInset` / scroll bounds). New cache fields `contentLeft`, `hoverZoneLeft` (= `contentLeft − gutterInset − HOVER_GUTTER_PAD(8)`), `hoverZoneRight` (= `editorRight`), plus two stable helper methods `containsHoverZone(x, y)` (rectangle test, scroll-bounded on Y) and `clampXToContent(x)` (snap into the content column). All computed in the same `refresh()` pass as the existing metrics — same ResizeObserver lifecycle, no new instrumentation. Resolver rewrite: `resolveTextObjectsAtMouse(editor, cache, x, y)` is now zone-first + coord-clamp + ancestor-walk + vertical-contain guard. Step 1: if `(x, y) ∉ hoverZone`, return EMPTY. Step 2: vertical-band cache (`lastBoundsTop` / `lastBoundsBottom`) — same row + same zone returns the cached refs without recomputation. Step 3: `view.posAtCoords({ left: clampXToContent(x), top: y })` — PM's coord-to-pos machinery only resolves inside content, so we feed it the nearest content X at the same Y when the actual X is in the gutter. Step 4: the existing `$pos.depth` ancestor walk + `pos.inside` atom-block check, unchanged. Step 5: vertical-contain guard — the outermost resolved block's DOM rect (via `view.nodeDOM(outerPos)`) must vertically contain clientY; without this, hover in the empty area below the last paragraph would falsely pin to it. Listener relocation: the `mousemove` listener moves from `editor.view.dom` to `document`, gated by `cache.containsHoverZone`. One listener, one source of truth for "is the cursor in the row hover zone." `editor.view.dom.mouseleave` retired (zone exit is detected inside `onMouseMove` itself via a deferred grace timer, equivalent to the prior behavior). Scroll/resize invalidate the resolver cache because block rects change in clientY space even when the cursor stays still. `lastHitElement` (element-identity cache) replaced by `lastBoundsTop` / `lastBoundsBottom`. Drops `elementFromPoint` entirely — the abstraction is `(x, y) ∈ row` rather than `target DOM ∈ editor`. The 120ms leave grace stays as a safety net for the edge of the zone but becomes far less critical: the zone now covers the entire cursor travel path from text to handle. Verified in dev preview: gutter hover at x=447 (10px left of content=457) shows handle; boundary at x=427 correctly rejected, x=430 (just inside zone) accepted; cursor travel text→gutter (14 mousemove steps) keeps handle visible the entire way; hover above editor and right of content correctly rejected; menu opens from gutter approach with all 11 entries from I1. Net: 2 files, +124/−47. |

After commits 16–17: typecheck clean. The drag-handle popover now exposes all three lifecycle ops (Duplicate, Archive, Delete) via the same registry pattern that owns popout dispatch, drop adapters, and float bodies; the hover zone matches the visual row instead of the editor's content DOM, so the handle survives the cursor's travel from text to grip.

### Session 7 — action-menu diagnosis fixes (2026-05-26)

Diagnosis [docs/memos/ACTION-MENU-DIAGNOSIS.md](docs/memos/ACTION-MENU-DIAGNOSIS.md) identified 10 confirmed clusters (C1–C11, with C8 refuted by Phase B). Critical finding: C11 (heading × Highlight produced malformed LaTeX and silently stripped pre-existing linkedAnchor pairs elsewhere in the doc on the next save→reload). Session 7 lands all clusters in a single solutions pass; live verification on the dev-doc fixture confirms the critical C9+C11 data-loss fix.

| # | Cluster | Spirit |
|---|---|---|
| 18 | C9 + C11 — annotation/lifecycle range split | New `meta.collectAnnotationRange?` slot in [src/text-objects/types.ts](src/text-objects/types.ts), symmetric with `collectMoveSource`. Only heading declares it today — returns the heading-line bounds (`pos+1` to `pos + nodeSize - 1`, just the heading node's content). New `getHeadingLineRangeByUuid` helper in [src/lib/section-range.ts](src/lib/section-range.ts) does the walk. Dispatcher's `resolveRefRange` now takes a `forAction: "annotation" \| "lifecycle"` param; annotation actions (H/N/F/C/Q/T/E/X) use the heading-line range, lifecycle actions (D/A/⌫) use the section range. The `LIFECYCLE_ACTIONS` set in the dispatcher is the SSOT for which actions take which range. C11 falls out automatically: highlight on a heading now produces `\section{\vlid{...}heading text\vlidend{...}}` (well-formed LaTeX, `\vlidend` inside the braces' text-content range, no other linkedAnchors stripped on round-trip). Plan agent confirmed Cutter belongs on the annotation side per user clarification (it just attaches a card; doesn't move text). |
| 19 | C1 — per-kind action curation + visible-disabled menu | The `actions: ALL_ACTIONS` everywhere in the registry → curated per-kind into `PROSE_ACTIONS` (paragraph/heading/blockquote/listItem/exampleItem), `NON_PROSE_BLOCK_ACTIONS` (drops F/C/E for bulletList/orderedList/codeBlock/displayMath/latexComment/texBlock/figureBlock/graphicsBlock/exampleBlock), `TITLE_FIELD_ACTIONS` (drops C/D/A/⌫ for titleField — Cutter allowed per user clarification), `LINKED_RANGE_ACTIONS` (drops D for linkedRange). Menu render in [DragHandleMenu.tsx](src/components/DragHandleMenu.tsx) switches from `.filter` to `.map`: `MenuEntry.disabled` field decorates each entry; render shows greyed/unclickable disabled entries (visible-disabled per user clarification §7 q3); keyboard handler gates on `!hit.disabled` for both letter shortcuts and the Backspace/Delete path. New optional `reason?: string` on `MenuEntry` reserved for a future tooltip pass. |
| 20 | C5 — heading lifecycle confirm dialog | New `confirm: (opts) => Promise<boolean>` field on `DragHandleActionsDeps`; second `useConfirmDialog()` instance in [EditorPane.tsx](src/components/EditorPane.tsx) (distinct from the heading-lozenge × instance). New helper `confirmHeadingLifecycle` in [drag-handle-actions.ts](src/components/editor-layout/card-actions/drag-handle-actions.ts) reads the section's `nodes` from `collectMoveSource`, counts paragraphs + sub-headings + extracts the heading text, and surfaces a tone-aware dialog ("Delete the entire section?" / "This will delete the entire section ... — N paragraphs, M sub-headings"). Cancel returns silently before any mutation. Dispatcher's `dispatch` is now `async`; callers (menu + selection-actions) fire-and-forget. |
| 21 | C6 — last-child cascade | New `meta.removeOnEmptyChildren?: boolean` flag (true on bulletList / orderedList / exampleBlock; explicitly NOT set on blockquote — empty blockquote can be intentional per Plan agent). New `expandCascadeRange(doc, outer)` helper in [delete-range.ts](src/text-objects/delete-range.ts) walks up the parent chain from `outer.from`, swallowing wrappers whose content would be empty after the deletion. Also consults `INVISIBLE_WRAPPERS = new Set(["exampleItemList"])` for schema-internal wrappers that aren't TextObjects but ARE structural noise when empty. Computes the extended range *before* the delete transaction dispatches, so PM's content-rule auto-fill never gets a chance to inject a placeholder `\item %!v:<new>`. Dispatcher's Delete branch + Archive branch both use the helper. Verified end-to-end: deleting the only-child exampleItem fa07 also removes the parent exampleBlock fa06, and the LaTeX source shows the entire `\vexid{fa06}\pex ... \xe` block gone. |
| 22 | C10 — linkedRange paragraphId | Line 167 of the dispatcher used to set `paragraphId = ref.kind === "selection" ? ref.paragraphId : ref.id;` — for linkedRange, `ref.id` is the `anchorId`, not a paragraph uuid. Fixed by exporting `paragraphUuidAt` from [src/links/links.ts](src/links/links.ts) and using it for linkedRange: walk up from the resolved mark's `from` position to the containing paragraph. `targetKind` also flips to `"paragraph"` for linkedRange (the mark wraps text inside a paragraph), matching how Q/T cards in the rest of the system resolve. |
| 23 | C2 — bindAnchor for cloned cards (TEXT-OBJECT-REFACTOR follow-up #10 resolved) | Extended `CardLifecycle` with optional `bindAnchor(id, paragraphId, anchorId, anchorText)` op. Implemented in [useNotes.ts](src/hooks/useNotes.ts), [useRevisions.ts](src/hooks/useRevisions.ts), [useCutter.ts](src/hooks/useCutter.ts) — each calls its existing `setTextAnchorLink`. Idempotent: bails if the card already carries the anchorId. Wired into [EditorPane.tsx](src/components/EditorPane.tsx) for all 6 Mode B card kinds (note / highlight / comment / suggestion / cutter-comment / cutter-suggestion). New `rewireClonedAnchors` post-insert walker in the dispatcher's `duplicate` branch reads the cloned slice's `linkedAnchor` marks, parses `linkCard` → `(kind, cardId)`, finds the containing paragraph via `paragraphUuidAt`, reads the anchor text via `findAnchorIdRange`, and calls `lifecycle.bindAnchor(...)`. Card → editor jump-to from a cloned card now lands on the clone, not the source. Plan agent's idempotency guarantee is in the interface doc. |
| 24 | C3 — Mode A orphan sweep (TEXT-OBJECT-REFACTOR follow-up #11 resolved) | New `TextObjectOrphanGuard` PM extension in [linked-anchor.ts](src/lib/tiptap/linked-anchor.ts), sibling of `LinkedAnchorGuard`. Reads `diff.removedBlocks` from `DocStructureObserver` (O(1) typed delta — no doc walk), dispatches `virgil-textobject-orphaned` CustomEvents via `setTimeout(0)` with `{uuid, typeName}` payload. Mode A card hooks (useTodos / useQuotations / useArchive) add `useEffect` listeners that call `removeTextObjectLink` on cards referencing the orphaned uuid. useExamples not wired — examples are anchored by `\vexid{...}` directly, no `links[]` field. Plugin's keystroke-sanctity profile mirrors `LinkedAnchorGuard` exactly: bail when `removedBlocks` empty, deferred fan-out, O(removed) per transaction. Doc-comment in the plugin explains the overlap with `MarginaliaAnchorGuard` (which re-inserts uuid-bearing empty paragraphs for *anchored* blocks via `anchoredUuidsRef`) — the new guard is the safety net for blocks that AREN'T gutter-tracked, including cascade-extended wrapper deletions from C6. |
| 25 | C4 — archive via cardCreation (TEXT-OBJECT-REFACTOR follow-up #9 resolved) | The five ad-hoc archive deps on `DragHandleActionsDeps` (`archiveContent` / `updateArchiveSnippet` / `addArchiveTextObjectId` / `setSelectedArchiveId` / `pinRecentlyAddedArchive`) all retire. New `createArchiveSnippet` factory in [card-creation.ts](src/components/editor-layout/card-actions/card-creation.ts), peer of `createNote` / `createTodo` / etc. — takes `{text, content, paragraphId, targetKind, mode, anchorRect}` and handles the snippet creation + content update + Mode A link + panel selection + recent-pin all in one place. Dispatcher's `archive` branch is now symmetric with Delete: snapshot the slice content (rich JSON), cascade-extend the range, run `cleanupLinksInRange`, dispatch the delete transaction, then mint the snippet via `cardCreation.createArchiveSnippet`. Plan agent's push-back on overloading `CardLifecycle` with `create(payload: unknown)` was the right call — `cardCreation` is now the SSOT for "create a sidecar card of any kind from the dispatcher," `CardLifecycle` stays the SSOT for "operate on an existing card's lifecycle" (clone, delete, bindAnchor). |

After commits 18–25: typecheck clean. The dispatcher routes per *action type* (annotation vs lifecycle vs inline-insertion) AND per kind, via two parallel registry resolvers (`collectMoveSource` and `collectAnnotationRange`) plus the unified `cardCreation` factory. The card-lifecycle ecosystem grew one op (`bindAnchor`) and one sibling event (`virgil-textobject-orphaned`), each with the same architectural pattern as its existing counterpart. Zero per-kind switch arms added anywhere.

### Session 8 — action-menu post-resolution followup (2026-05-26)

Live testing of session 7's landing surfaced four bugs that the first pass either created or left for follow-up. All four landed in a single commit by extending the existing registry pattern (one new slot, one new helper, one new diagnostic infrastructure) plus a one-branch dispatcher symmetry fix. Plan: `/Users/gabriel/.claude/plans/if-you-look-you-ll-synchronous-crystal.md`. Detailed log: §9 of [docs/memos/ACTION-MENU-DIAGNOSIS.md](docs/memos/ACTION-MENU-DIAGNOSIS.md).

| # | Bug | Spirit |
|---|---|---|
| 26 | B1 — Duplicate crash on text-bearing paragraphs | `transformNode` in [src/text-objects/duplicate-slice.ts](src/text-objects/duplicate-slice.ts) called `node.type.create()` for every node, including text nodes (whose type rejects construction with "NodeType.create can't construct text nodes"). Latent in the walker since I1; user-visible after session 7's C1 curation surfaced Duplicate on every prose kind. Fix is one branch: `if (node.isText) return node.mark(newMarks);` (routes text nodes through `node.mark()` instead). Same edit promotes the walker to an invariant: every TextObject node leaves with a fresh uuid even if the source had none (uuid-less paragraphs no longer propagate empty strings into the clone). Adds tagged `DuplicateDiagnostics` collector (codes: `missing-source-uuid`, `orphan-inline-atom`, `missing-card-on-mark`, `unparseable-link-card`) — every silent-skip path now emits a diagnostic the dispatcher console.warns as a summary. Strip orphan linkedAnchor marks when the source card is missing (instead of carrying an empty `linkCard` forward). |
| 27 | B1 — Loud failure surface for Duplicate | New `notify` dep on `DragHandleActionsDeps`; implemented in [src/components/EditorPane.tsx](src/components/EditorPane.tsx) via a second `useConfirmDialog()` instance with `hideCancel: true`. Reuses the existing SystemDialog primitive — no new toast infra. Dispatcher's duplicate flow now surfaces: stale ref ("Could not find the source — close the menu and try again"), empty slice ("Nothing to duplicate"), schema rejection ("This kind cannot be duplicated here"). Pre-dispatch `tr.doc.check()` catches schema violations BEFORE dispatch so the doc is never half-modified — gracefully handles e.g. duplicate titleField if curation slips. Atom blocks now use `NodeSelection.create` post-insert (text-bearing kinds keep `TextSelection.near`); the only kind-aware branch in the dispatcher's duplicate path, and it's structural (uses `meta.isAtomBlock`). |
| 28 | B2 — Archive orphaned its own snippet | New helper [src/text-objects/anchor-resolution.ts](src/text-objects/anchor-resolution.ts) — `findPreviousAnchorableBlock(doc, pos)` walks backward from `pos − 1` for the nearest uuid-bearing TextObject. For container kinds (bulletList / orderedList / exampleBlock / exampleItemList), descends into the LAST child so the result is the user's intuitive "block immediately above" (last listItem, not the bulletList wrapper). Returns null at doc start. Dispatcher's `case "archive":` calls it with the cascade-extended `from` so a collapsing list anchors above the LIST, not above the now-orphan items, BEFORE deletion — surviving anchor is bound to the snippet instead of the to-be-deleted uuid. Selection-ref Archive keeps `ref.paragraphId` (source paragraph survives that case). `useArchive.ts`'s C3 orphan-sweep handler stays — now a safety net rather than a bug-paving stone. 9 unit tests in [src/text-objects/__tests__/anchor-resolution.test.ts](src/text-objects/__tests__/anchor-resolution.test.ts) cover the position matrix (first-paragraph, mid-paragraph, paragraph-after-heading, mid-listItem, last-listItem cascade, paragraph-after-displayMath, no-anchor-above). |
| 29 | B3 — Delete/Archive warnings via per-kind registry slot | New `meta.confirmDestructive?(doc, uuid, action, ctx): ConfirmDescriptor | null` slot on `TextObjectMeta` — parallel to `collectMoveSource` and `collectAnnotationRange`. Context is `{outerRange, hasAnchorsOrAtoms}` so the kind decides cheaply without re-walking. `null` return skips the dialog (used for empty paragraphs with no attached anchors, and unconditionally for `latexComment`). Helpers in [src/text-objects/text-object-registry.ts](src/text-objects/text-object-registry.ts) (`descriptorForSimpleBlock`, `descriptorForContainer`, `descriptorForHeading`) cover the common shapes — paragraph shows a text preview, lists report item counts, heading uses the existing section summary (moved out of the dispatcher's `confirmHeadingLifecycle` for the Archive/Delete cases; that helper stays standalone for the heading × Duplicate gate since Duplicate is non-destructive). New `ConfirmDescriptor` type in [src/text-objects/types.ts](src/text-objects/types.ts) is React-free; dispatcher widens to `ConfirmOptions` at call site. Dispatcher gate now: `if (action === "archive" || action === "delete") { const d = resolveDestructiveConfirm(...); if (d) await confirm(...) }` — every Archive/Delete consults the registry slot; the heading-only path is dead. |
| 30 | B4 — Cmd-Z after Delete did nothing | The dispatcher's post-action focus tail only refocused something when a card was created (`if (focusCardKey) focusNewCard(...)`); destructive actions don't create a card, so focus stayed on the body after the confirm dialog closed, and browser-level Cmd-Z routed to the window instead of the editor's TipTap History extension. Architectural symmetry fix: every drag-handle action either focuses the new card OR returns focus to the editor. One-branch addition: `if (focusCardKey) focusNewCard(focusCardKey); else { try { ed.view.focus(); } catch {} }`. Verified end-to-end: after Delete + dialog confirm, `document.activeElement === .ProseMirror`; synthetic Cmd-Z restored the deleted paragraph. |

After commits 26–30 (single commit `bf8f596`, 7 files, +996/−106): typecheck clean. The follow-up extends three existing registry slots (`confirmDestructive` joins `collectMoveSource` / `collectAnnotationRange`), adds one new helper module (`anchor-resolution.ts`), adds one new diagnostic infrastructure (`DuplicateDiagnostics`), and tightens the dispatcher with two architectural symmetries (focus-after-action, schema-check-before-dispatch). No new toast library, no new modal chrome, no new per-kind switches.

### Session 9 — cohesive grab-handle mop-up (2026-05-26)

Five reported issues (vertical alignment of "text-top" handles wrong for headings/titles/`exampleBlock`; tex blocks have no handles on hover; expex handles inconsistent; list sub-handles don't move between items inside same parent; handles render above page chrome on scroll) plus three mop-ups (A: `.par-left-margin-zone` dead-DOM sweep, B: leave-grace plumbing simplification, C: atom-block marginalia validation). The three architectural roots — geometry measurement, hover resolution, render layer — collapsed into one mechanism each. The same `[data-glyph-anchor]` registry slot solves issues 1, 3, the titled-tex-block follow-up (#8), AND mop-up C: one mechanism, four payoffs. Plan: `/Users/gabriel/.claude/plans/let-s-go-with-your-distributed-truffle.md`.

| # | Phase | Spirit |
|---|---|---|
| 31 | Phase 0 — `.par-left-margin-zone` dead-DOM sweep (mop-up A, follow-up #7 resolved) | Three NodeViews still emitted the legacy hover-sensor div whose CSS was annotated DEAD after the popout-button retirement. Deleted from [Editor.tsx](src/components/Editor.tsx) (paragraph + heading wrappers), [expex.ts](src/lib/tiptap/expex.ts) (exampleBlock wrapper + the matching `stopEvent` / `ignoreMutation` guards that referenced `leftZone`), and the `.par-left-margin-zone` rule from [globals.css](src/app/globals.css). |
| 32 | Phase 1 — `data-text-object-kind` on UuidAttrDecorator | One decoration, two attrs. [src/lib/tiptap/uuid-attr.ts](src/lib/tiptap/uuid-attr.ts) `buildUuidDecorations` and the diff-driven `addedBlocks` branch both emit `{ "data-uuid": uuid, "data-text-object-kind": node.type.name }`. Lets the new hover resolver read kind from DOM without a per-mousemove doc walk. |
| 33 | Phase 2 — `GlyphProbeDecorator` | New PM extension [src/lib/tiptap/glyph-probe.ts](src/lib/tiptap/glyph-probe.ts) wraps the first text character of every text-bearing TextObject in `<span data-glyph-probe>`. Inline spans' `getBoundingClientRect().top` IS the rendered glyph cap-top (browsers size inline rects by glyph metrics, not by line-height) — fixes the headings-above-text alignment bug at its root. Eligibility: `paragraph`, `heading`, `blockquote`, `codeBlock`, `listItem`, `exampleItem`, `titleField`. Same lifecycle pattern as `UuidAttrDecorator`: forward-map every transaction, consult `readPendingDiff` for adds/removes/content-changes (the content-change path rebuilds the probe because the first character's position may have moved relative to block start when editing). Structure-index map (`readDocStructure(newState).blocks`) gives uuid→pos for surgical rebuilds. Wired into [Editor.tsx](src/components/Editor.tsx) extension list next to `UuidAttrDecorator`. 9 unit tests in [src/lib/tiptap/__tests__/glyph-probe.test.ts](src/lib/tiptap/__tests__/glyph-probe.test.ts) cover the buildProbes algorithm across paragraph/heading/listItem/blockquote/empty/no-uuid/atom-skip/multi-block matrix. |
| 34 | Phase 3 — NodeView `[data-glyph-anchor]` emission | Per-kind override slot for compound containers and chrome-bearing kinds. `exampleBlock` NodeView ([expex.ts](src/lib/tiptap/expex.ts)) emits `data-glyph-anchor` on `.expex-number` (the `(1)` chip) — fixes the outer expex handle anchoring to first sub-item's first letter instead of the `(1)` row. `texBlock` NodeView ([TexBlockNodeView.tsx](src/components/TexBlockNodeView.tsx)) emits on `.tex-block-pod` — solves open follow-up #8 (titled-tex-block Y-anchor) because wrapper-top vs pod-top is no longer the question; the pod IS the anchor. Other atom NodeViews deferred (their wrapper-top is correct today). |
| 35 | Phase 4 — `measureHandleAnchorTop` consumer | [TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) — retired the TreeWalker + Range fallback `getTextGlyphTop`. New function reads override > probe > wrapper fallback. `block-top` kinds use the wrapper rect; `text-top` kinds use the probe pipeline. `computePlacement`'s text-top branch swaps to the new function. SelectionRef path keeps `coordsAtPos(from).top` (selections are mid-prose; the line-box-vs-cap-top gap only bites for first-character measurement of headings, which selections don't do). |
| 36 | Phase 5 — Hover resolver rewrite (DOM-truth via data-uuid + data-text-object-kind) | [TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) — `resolveTextObjectsAtMouse` replaced wholesale. Zone-gate via `cache.containsHoverZone`, clamp X into content column (so cursor over the gutter still resolves), then `document.elementFromPoint(probeX, clientY)?.closest("[data-uuid]")` ancestor walk — read `{kind, id}` directly from the DOM attrs set by Phase 1's extended decorator. Innermost-first ordering falls out of DOM hierarchy naturally; atoms (texBlock with CodeMirror inside, etc.) work uniformly because the browser is browser-truthful through contenteditable=false subtrees. Same pattern as [Marginalia.tsx](src/components/Marginalia.tsx)'s drag hit-test. Band cache deleted (`lastBoundsTop` / `lastBoundsBottom` / `lastHitResult` / `invalidateMouseResolverCache`) — `elementFromPoint` is ~µs; bookkeeping cost > save. Fixes issue 2 (tex blocks have no handles) and issue 4 (list sub-handles don't move between items in same parent — the cache was pinned to the outermost block's rect, so movement within the same parent didn't invalidate; without the cache, every mousemove re-resolves). |
| 37 | Phase 6 — Render into scroll container (issue 5) | New `[data-grab-handle-portal]` div mounted inside `.paper-render` ([EditorPane.tsx](src/components/EditorPane.tsx)) as a sibling of `.ProseMirror`. Handles render as `position: absolute` children with z-index 20 (above editor-interior at z:1, below pod cap at z:30). Scroll with the paper, clip naturally against the editor pod's sticky chrome. [useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts) extended with `paperEl: HTMLElement | null`, `paperRect: { top, left }`, and `toPortalCoords(viewportX, viewportY): { x, y }` helper that reads paperRect fresh per call (so scroll-time changes are picked up). [TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) `computePlacement` converts viewport→portal coords once at the end. Portal target resolved INLINE at render from `cacheRef.current.paperEl?.querySelector("[data-grab-handle-portal]")` (initially used a `portalRoot` state in a useEffect on cacheVersion; reverted to inline lookup after a hotfix attempt — see GRAB-HANDLE-VISIBILITY-FOLLOWUP memo). `window.scroll` listener kept (re-resolves on scroll for new hover position) but the `Math.max(candidateTop, scrollTop)` "sticky to viewport top" clamp dropped — that was a portal-to-body workaround. CSS `.text-object-grab-handle` flipped from `position: fixed; z-index: 1000` to `position: absolute; z-index: 20`. |
| 38 | Phase 7 — Plumbing simplification (mop-up B) | [TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) — once handles render inside the scroll container, pointer continuity from prose → gutter → handle is native; the leave-grace machinery existed only because portal-to-body decoupled the handle from its source. Deleted: `MOUSE_LEAVE_GRACE_MS`, `mouseOverHandleRef`, `leaveTimerRef`, `scheduleZoneLeave`, `onHandleEnter`/`onHandleLeave` callbacks, the per-handle `onMouseEnter`/`onMouseLeave` JSX wiring, the `elementFromPoint` overEditor check in `onHandleLeave`. `onMouseMove` simplified: outside zone → immediate `mousePosRef.current = null`; inside zone → set position + schedule. The leading comment block rewritten to reflect the new "portal inside scroll container" architecture. |
| 39 | Phase 8 — Atom-block marginalia (mop-up C, registry-slot reuse) | [useMarginaliaRegistry.ts](src/hooks/useMarginaliaRegistry.ts) `measureBlock` consults `[data-glyph-anchor]` for atoms (and prose where the override exists) BEFORE falling back to wrapper-top. One slot, two consumers — same registry mechanism as the handle's `measureHandleAnchorTop`. For titled tex blocks (which the H4 follow-up flagged as having wrapper-top above the pod), the marginalia marker now centers on the pod, not on the title-annotation-extended wrapper. Verification deferred to live preview. |

After commits 31–39 (single commit `f6a9b93`, 11 files, +804/−341): typecheck clean (pre-existing baseline error in `card-creation.ts` unrelated). 240 passing / 8 baseline failing in `usePersistentState.test.ts`. **Live preview regression: handles not visible.** A hotfix attempt (inline portalRoot resolution + z:20) landed in the same commit but didn't restore visibility. Investigation memo: [docs/memos/GRAB-HANDLE-VISIBILITY-FOLLOWUP.md](docs/memos/GRAB-HANDLE-VISIBILITY-FOLLOWUP.md). Resolved in session 10 below.

### Session 10 — grab-handle visibility resolution (2026-05-26)

The follow-up memo enumerated 7 hypotheses centered on stacking context, coord conversion, and render-path timing. None were correct. The actual root cause was a clipPath on `.editor-pane-pod` (`inset(0 -20px 0 -20px)`, intended to clip the pod's box-shadow vertically while bleeding 20px laterally) that quietly clipped handles in the gutter once session 9 moved them inside the pod's DOM subtree (previously they lived at `document.body` and so escaped the clip). The fix is one level of nesting: move the portal layer to the column instead of paper-render — outside the pod's clipPath, but still inside the row scroll container and in the same stacking context as the pod caps that legitimately want to cover handles on overflow.

| # | Bug | Spirit |
|---|---|---|
| 40 | Grab-handle visibility regression | Moved `[data-grab-handle-portal]` from inside `.paper-render` to a column-level sibling of `.editor-pane-pod` inside `[data-editor-col="true"]` ([EditorPane.tsx](src/components/EditorPane.tsx)). Column gets `position: relative` (positioning context, intentionally NOT a stacking context — no z-index, so the pod caps (z:30/31) and the handles (z:20) keep resolving in the root stacking context and the caps win on overlap). Cache resolver ([useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts)) now walks to `[data-editor-col="true"]` instead of `[data-editor-page="true"]`; `paperEl` name kept for diff minimization, JSDoc + inline comment clarified. [TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) — comments only; the `cacheRef.current.paperEl?.querySelector("[data-grab-handle-portal]")` resolution path works unchanged because the portal is still a descendant of the resolved element. Net effect: handles escape the pod's clipPath, scroll with the column inside the row scroll container, clip behind sticky pod caps (z:30/31) which sit alongside in the column. Verified live in the preview: handle at correct gutter x (left = contentLeft − 22, measured 435 = 457 − 22), handle Y aligns to glyph-probe top with 0px delta for paragraph + heading, hover out of zone hides the handle. Closes follow-up #0. |

### Current state cheat-sheet (read before touching code)

**Where things live:**
- Registry SSOT: [src/text-objects/text-object-registry.ts](src/text-objects/text-object-registry.ts) — 16 kinds; each has `isSubObject`, `isAtomBlock`, `decorationSafety`, `chromeAnchor` (post-H4: `"text-top" | "block-top"`), `parentKind?`, `dropAdapter`, `floatBodyComponent`, `initialFloatSize?`, `collectMoveSource?`, `collectAnnotationRange?` (post-session-7), `removeOnEmptyChildren?` (post-session-7), `actions` (post-I1 includes `duplicate` + `delete` + the prior `archive`; post-session-7 curated per-kind into `PROSE_ACTIONS` / `NON_PROSE_BLOCK_ACTIONS` / `TITLE_FIELD_ACTIONS` / `LINKED_RANGE_ACTIONS`), **`confirmDestructive?` (post-session-8)** for per-kind Delete/Archive confirm copy (returns `null` to skip).
- **Card lifecycle SSOT (post-I1):** [src/panels/card-lifecycle-registry.tsx](src/panels/card-lifecycle-registry.tsx) — per-CardKind `{ clone(sourceId): newId \| null; delete(id): void; bindAnchor?(id, paragraphId, anchorId, anchorText): void }` (the optional `bindAnchor` added in session 7). Per-doc (sidecar hooks are per-doc), populated by EditorPane via `useCardLifecycleApi(registry)`. Consumed by the duplicate/delete walkers via `getCardLifecycle(kind)`. Sibling of `PANEL_REGISTRY` / `LINK_REGISTRY`.
- **Duplicate / delete walkers (post-I1):** [src/text-objects/duplicate-slice.ts](src/text-objects/duplicate-slice.ts) (remints uuids + inline-atom ids + linkedAnchor marks; clones sidecar entries via the lifecycle registry; post-session-8 enforces always-mint uuid invariant + tagged `DuplicateDiagnostics` collector + text-node-aware fork via `node.mark()` instead of `node.type.create()`) and [src/text-objects/delete-range.ts](src/text-objects/delete-range.ts) (enumerates sidecar-bearing elements in a range and calls `lifecycle.delete`; post-session-7 adds `expandCascadeRange` for last-child collapse via `meta.removeOnEmptyChildren` + `INVISIBLE_WRAPPERS`). Both contain zero per-kind branches; the only kind-aware code is a 2-entry `INLINE_ATOM_CARDS` map literal.
- **Anchor resolution helper (post-session-8):** [src/text-objects/anchor-resolution.ts](src/text-objects/anchor-resolution.ts) — `findPreviousAnchorableBlock(doc, pos)` walks backward for the nearest uuid-bearing TextObject, descending into container last-children. Used by the dispatcher's Archive branch to bind the snippet to a SURVIVING anchor before the source block is deleted (was orphaning in the C4 landing). Pure; safe for action-time. 9 unit tests cover the position matrix.
- **Destructive-action confirm flow (post-session-8):** Each kind owns its own copy via `meta.confirmDestructive(doc, uuid, action, {outerRange, hasAnchorsOrAtoms})`. Empty paragraphs with no anchors return `null` → silent delete. The dispatcher's `resolveDestructiveConfirm` consults the slot for TextObjectRef and inlines a "(N-word passage)" descriptor for SelectionRef. Heading × Duplicate keeps a standalone `confirmHeadingLifecycle` gate (Duplicate is non-destructive; only headings warn).
- **Failure-surface dialog (post-session-8):** Second `useConfirmDialog()` instance in [src/components/EditorPane.tsx](src/components/EditorPane.tsx) with `hideCancel: true` provides a single-button "OK" SystemDialog as the `notify` dep on `DragHandleActionsDeps`. Used by the dispatcher's Duplicate flow for stale-ref / empty-slice / schema-rejection cases. No new toast library — reuses the established SystemDialog primitive.
- **Dispatcher focus invariant (post-session-8):** Every drag-handle action either focuses the new card (`focusCardKey`) OR returns focus to the editor (`ed.view.focus()`). The else-branch fixes Cmd-Z-after-Delete: prior dispatch tail left focus on body after the confirm dialog closed, so browser-level Cmd-Z was eaten by the window instead of routing to the editor's TipTap History extension.
- Gutter chrome CSS variables: [src/app/globals.css](src/app/globals.css) `:root` block — `--gutter-col-chevron: -44px` and `--gutter-col-handle-inset: 22px` (post-H3). Single source of truth for the editor's left-gutter columns; both CSS chrome (chevrons) and JS placement (handle) read from these.
- **Hover zone (post-I2):** [src/hooks/useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts) — same cache that holds `editorRight` / `gutterInset` / scroll bounds now also exposes `contentLeft`, `hoverZoneLeft`, `hoverZoneRight`, plus `containsHoverZone(x, y)` and `clampXToContent(x)`. The hover zone is the editor's content column widened leftward into the gutter so the cursor can travel from text to the grip without losing the handle.
- Grab handle: [src/text-objects/TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) — ONE editor-mounted component. Hover-driven (post-H2). Renders array of placements via inner `<GrabHandleRender>` (post-session-9: `position: absolute`, no per-handle leave callbacks). Listener attaches to `document` (post-I2), gated by `cache.containsHoverZone`. Resolver is zone-first + coord-clamp + `elementFromPoint → closest("[data-uuid]")` ancestor walk (post-session-9 Phase 5; previously posAtCoords + depth walk + band cache). Anchor measurement via `measureHandleAnchorTop`: `[data-glyph-anchor]` > `[data-glyph-probe]` > wrapper fallback (post-session-9 Phase 4). Portal target: `[data-grab-handle-portal]` inside `paper-render`, resolved inline at render from `cacheRef.current.paperEl` (post-session-9 Phase 6 + hotfix). **Visibility regression open** — handles render but invisible in live preview after session 9; see [docs/memos/GRAB-HANDLE-VISIBILITY-FOLLOWUP.md](docs/memos/GRAB-HANDLE-VISIBILITY-FOLLOWUP.md).
- Float chrome: [src/text-objects/TextObjectFloat.tsx](src/text-objects/TextObjectFloat.tsx) + per-kind bodies in [src/text-objects/floats/](src/text-objects/floats/). Bodies register via `registerFloatBody(kind, BodyComponent)` from [src/text-objects/floats/index.ts](src/text-objects/floats/index.ts) (side-effect imported by `Editor.tsx`).
- Drop spec: [src/components/drop-mode/specs/textobject.ts](src/components/drop-mode/specs/textobject.ts) — one spec, routes via `meta.dropAdapter`.
- Walker: `walkAnchorableBlocks` in [src/lib/marginalia-blocks.ts](src/lib/marginalia-blocks.ts). Walks every level (post-H1). Used by the marginalia registry, the grab handle's UUID→pos lookup, and `ActiveTextObjectContext`.
- DOM decoration: `UuidAttrDecorator` in [src/lib/tiptap/uuid-attr.ts](src/lib/tiptap/uuid-attr.ts). Sets `data-uuid` + **`data-text-object-kind` (post-session-9)** on every anchorable node's outer DOM element (post-H1: includes sub-objects). The kind attr lets the hover resolver read kind+id directly from DOM, no doc walk per mousemove.
- Glyph probe: `GlyphProbeDecorator` in [src/lib/tiptap/glyph-probe.ts](src/lib/tiptap/glyph-probe.ts) (post-session-9). Wraps the first text character of every text-bearing TextObject (paragraph / heading / blockquote / codeBlock / listItem / exampleItem / titleField) in `<span data-glyph-probe>`. The inline span's `getBoundingClientRect().top` IS the glyph cap-top — bypasses the line-box-vs-glyph gap that broke first-character Range measurement for headings.
- NodeView anchor overrides: `[data-glyph-anchor]` (post-session-9) on per-kind "visual top" elements. `exampleBlock` → `.expex-number`; `texBlock` → `.tex-block-pod`. Read by both `measureHandleAnchorTop` (handle Y placement) and `useMarginaliaRegistry.measureBlock` (atom marker centering) — one slot, two consumers.
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

*Vertical* — `computePlacement` in [src/text-objects/TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) calls `measureHandleAnchorTop(anchorDom, meta.chromeAnchor)` (post-session-9; previously a TreeWalker + Range path):
- `"text-top"` (paragraphs, headings, lists, examples, blockquote, codeBlock, titleField, linkedRange): priority is `[data-glyph-anchor]` > `[data-glyph-probe]` > `anchorDom.getBoundingClientRect().top`. The probe is an inline span around the first text character (emitted by `GlyphProbeDecorator`); inline-span rects are sized by glyph metrics, so `.top` is the cap-top regardless of line-height. The override is a NodeView-declared "visual top" element for kinds whose first PM-managed char isn't the visual anchor (`exampleBlock` → `.expex-number`).
- `"block-top"` (texBlock, latexComment, displayMath, graphicsBlock, figureBlock): also consults `[data-glyph-anchor]` first (texBlock → `.tex-block-pod`, so titled tex blocks anchor to the pod regardless of title presence — solves H4 follow-up #8). Falls back to `anchorRect.top` (wrapper's visual top edge) when no override.
- `align-items: flex-start` on `.text-object-grab-handle` (post-H4) puts the 6-dot SVG at the handle's top edge, so the first dot row lands at the chosen anchor Y.

*Portal coords* (post-session-9 Phase 6): the viewport coords above are converted to portal-relative via `cache.toPortalCoords(viewportX, viewportY)`, which subtracts paper-render's `getBoundingClientRect()` top/left fresh per call. Handles render as `position: absolute` children of `[data-grab-handle-portal]` inside `paper-render`, so they scroll with the content and clip naturally against the editor pod's sticky chrome.

The caller in `TextObjectGrabHandle` derives `editorColumnLeft` from `editor.view.dom.getBoundingClientRect().left` (the `.ProseMirror` element), NOT from the anchor DOM — this is what lets sub-object handles indent past their own DOM edge into the decoration zone.

### Open follow-ups (for future sessions)

These are not blocking the refactor's completeness; they are next-step extensions / cleanups that the refactor's abstractions make easy:

0. **Grab-handle visibility regression. [RESOLVED — session 10, 2026-05-26.]** Root cause was a clipping bug not on the hypothesis list: `.editor-pane-pod` carries `clipPath: 'inset(0 -20px 0 -20px)'` (intended to clip the pod's box-shadow vertically while letting it bleed 20px laterally). Session 9 moved the portal from `document.body` (outside the pod's DOM subtree) into `.paper-render` (inside the pod), bringing handles into the clipPath's blast radius — handles render ~22px left of the pod's left edge, beyond the 20px lateral allowance. Fix: move the `[data-grab-handle-portal]` div one level up, from inside `.paper-render` to a column-level sibling of the pod inside `[data-editor-col="true"]`. The portal still scrolls with content (inside `[data-virgil-row-scroll]`), clips behind sticky caps (z:30/31) and the row's overflow, but ESCAPES the pod's clipPath subtree. Three files changed: [EditorPane.tsx](src/components/EditorPane.tsx) (column gets `position: relative`; portal mount moves to be the pod's sibling), [useEditorViewportCache.ts](src/hooks/useEditorViewportCache.ts) (cache walks to `[data-editor-col="true"]` instead of `[data-editor-page="true"]`), [TextObjectGrabHandle.tsx](src/text-objects/TextObjectGrabHandle.tsx) (comments only — `cacheRef.current.paperEl?.querySelector("[data-grab-handle-portal]")` still resolves correctly). Verified live: handle at correct gutter x (435 = contentLeft 457 − inset 22), handle Y aligns with glyph-probe top with 0px delta for paragraph + heading, out-of-zone hover hides handle. Memo + resolution detail: [docs/memos/GRAB-HANDLE-VISIBILITY-FOLLOWUP.md](docs/memos/GRAB-HANDLE-VISIBILITY-FOLLOWUP.md).
2. **Atom-block discoverability.** `texBlock` / `graphicsBlock` / `displayMath` / `latexComment` / `figureBlock` only reveal their handles on mouse hover (atoms have no caret position). After H2, hover discovery works for all atoms at every depth. If keyboard accessibility becomes a priority, the natural follow-up is a "menu key while focused near an atom" shortcut. Out of scope for the refactor.
3. **Legacy doc UUID lazy-assign.** Pre-A1 docs without `\vxid` markers will have `exampleItem` nodes with `uuid: null`, which `walkAnchorableBlocks` filters out (`if (uuid)` guard). The proper fix is a lazy-mint pass on first cursor/hover in such items. Phase F noted but did not implement this.
4. **`%!v:` marker cleanup.** Docs saved between A1 and H1 may carry `%!v:` markers on inner paragraphs of `exampleItem`s (the deferring rule didn't apply yet). H1's `DEFERRING_PARENTS` addition prevents new ones; existing redundant markers are harmless (parser accepts them; the resolver returns the exampleItem regardless because of the deferring rule). No active migration needed.
5. **Float body parity audit.** H2 surfaced that `list-body.tsx` was missing GraphicsBlock — a schema-construction bug latent since Phase B. Audit: every float body that registers `StarterKit` (which provides `ListItem`) or `ExampleItem` must also register `GraphicsBlock`, because `listItem.content` and `exampleItem.content` reference it. Today: `heading-body`, `example-block-body`, and (post-H2) `list-body` are correct. `paragraph-body` / `linked-range-body` disable `listItem` via StarterKit config and don't register `ExampleItem`, so they're safe. Future bodies need to follow the heading-body pattern.
6. **Marginalia DOM positioning for atom-block anchored cards. [LIKELY-RESOLVED — session 9, 2026-05-26.]** Session 9 Phase 8 wired `[data-glyph-anchor]` into `useMarginaliaRegistry.measureBlock`'s atom path. For titled tex blocks the marker now centers on `.tex-block-pod` rather than the title-annotation-extended wrapper. Visual verification deferred to the GRAB-HANDLE-VISIBILITY-FOLLOWUP resolution session (need handles + markers visible first).
7. **`.par-left-margin-zone` dead-DOM cleanup. [RESOLVED — session 9, 2026-05-26.]** Session 9 Phase 0 deleted the div from all three NodeViews (paragraph + heading wrappers in [Editor.tsx](src/components/Editor.tsx), exampleBlock wrapper in [expex.ts](src/lib/tiptap/expex.ts) + the `leftZone` references in `stopEvent`/`ignoreMutation`), and the CSS rule from globals.css.
8. **Titled tex block handle Y-anchor. [RESOLVED — session 9, 2026-05-26.]** Session 9 Phase 3 emitted `data-glyph-anchor` on `.tex-block-pod` in [TexBlockNodeView.tsx](src/components/TexBlockNodeView.tsx). The handle's `measureHandleAnchorTop` reads this for BOTH titled and untitled tex blocks — anchor is the pod top regardless of title presence. The fragile `:not(:has(.par-title-text))` CSS workaround is no longer load-bearing.
9. **Archive in the lifecycle registry. [RESOLVED — session 7, 2026-05-26.]** The five ad-hoc archive deps on `DragHandleActionsDeps` (`archiveContent` / `updateArchiveSnippet` / `addArchiveTextObjectId` / `setSelectedArchiveId` / `pinRecentlyAddedArchive`) retired. New `createArchiveSnippet` in [card-creation.ts](src/components/editor-layout/card-actions/card-creation.ts) — peer of `createNote` / `createTodo` / etc. Dispatcher's archive branch is now symmetric with Delete: snapshot rich content, `expandCascadeRange`, `cleanupLinksInRange`, `tr.delete`, then mint snippet via `cardCreation.createArchiveSnippet`. Plan agent pushed back on overloading `CardLifecycle` with `create(payload: unknown)`; the resolution is `cardCreation` as the SSOT for "create a sidecar card from the dispatcher" (peer of `CardLifecycle`'s clone/delete/bindAnchor). Cluster C4 in [docs/memos/ACTION-MENU-DIAGNOSIS.md](docs/memos/ACTION-MENU-DIAGNOSIS.md).
10. **Cloned card link rewireup. [RESOLVED — session 7, 2026-05-26.]** Extended `CardLifecycle` with optional `bindAnchor(id, paragraphId, anchorId, anchorText)`. Implemented in [useNotes.ts](src/hooks/useNotes.ts), [useRevisions.ts](src/hooks/useRevisions.ts), [useCutter.ts](src/hooks/useCutter.ts) — each calls `setTextAnchorLink`. Idempotent: bails if the card already carries the anchorId. Dispatcher's `duplicate` branch now runs `rewireClonedAnchors` post-insert: walks the inserted slice for linkedAnchor marks, parses `linkCard` → `(kind, cardId)`, calls `lifecycle.bindAnchor(...)`. Card → editor jump-to from a cloned card now lands on the clone. Cluster C2 in [docs/memos/ACTION-MENU-DIAGNOSIS.md](docs/memos/ACTION-MENU-DIAGNOSIS.md).
11. **Mode A paragraph-link orphans on delete. [RESOLVED — session 7, 2026-05-26.]** New `TextObjectOrphanGuard` PM extension in [linked-anchor.ts](src/lib/tiptap/linked-anchor.ts), sibling of `LinkedAnchorGuard`. Reads `diff.removedBlocks` from `DocStructureObserver` (O(1) typed delta), dispatches `virgil-textobject-orphaned` CustomEvents via `setTimeout(0)` with `{uuid, typeName}` payload. Mode A card hooks (useTodos / useQuotations / useArchive) added listeners that call `removeTextObjectLink` on cards referencing the orphaned uuid. useExamples not wired — examples are anchored by `\vexid{...}` directly, no `links[]` field. Cluster C3 in [docs/memos/ACTION-MENU-DIAGNOSIS.md](docs/memos/ACTION-MENU-DIAGNOSIS.md).

### The spirit (re-stated for every session)

**Deep architectural fixes — not surgical patches.** This refactor exists because the existing consistency is enforced by team vigilance, not by design. Every parallel implementation §4 enumerates is something to delete or merge through the new pathway. Where you find drift (the deprecated `ANCHORABLE_NODES` set omitting `figureBlock`/`graphicsBlock`; `figureBlock` lumped with "atom blocks" when it's actually `content: "figureCaption?"`; the `EntityKind`/`TextObjectKind` name collision around `example`), surface and fix it as part of the refactor — don't leave the drift behind for the next vigilant person.

When fixing a reported case, look for the class of bug and the analogous siblings. When extending functionality (sub-object popout, multi-paragraph linkedAnchor, graphicsBlock-in-list, cards-on-any-text-object), the extensions should be trivial after the refactor — if they're not, the abstraction isn't right yet.

The H1 walker fix illustrates the principle: the bug was reported as "sub-object handles don't appear," but the root cause was the walker short-circuiting at the first anchorable — which simultaneously broke sub-object enumeration AND the `data-uuid` DOM decoration AND any future "cards anchored to sub-objects" feature. One line in two places fixed all three, plus the analogous `DEFERRING_PARENTS` rename for `exampleItem`. The H2 hover restructure illustrates the same principle in reverse: a UX request ("hover, not click") that was trivial because the registry + handle-layout + canonical predicate were already in place — the rewrite was a pure data-flow change, not new architecture.

Detailed session-1 plan (with all the cross-cutting concerns called out): `/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`. Session-5 plan: `/Users/gabriel/.claude/plans/i-want-to-finsih-zippy-wilkinson.md`. Session-9 plan: `/Users/gabriel/.claude/plans/let-s-go-with-your-distributed-truffle.md` (includes the post-landing hotfix attempt and the diagnosis that motivated the visibility-followup memo).

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
