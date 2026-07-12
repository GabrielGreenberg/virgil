<!-- last-verified: 72d1c0db 2026-07-12 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology, docs/architecture/VIRGIL.md#latex-round-trip-vocabulary, docs/architecture/VIRGIL.md#uuid-marker-emission -->
<!-- covers-code: src/lib/tiptap, src/links, src/lib/marginalia.ts, src/lib/latex-parser.ts, src/lib/latex-serializer.ts, src/text-objects, src/hooks/useReconcileModeAAnchors.ts, src/lib/anchor-mint-signal.ts -->

# Main Text: Editor, Content Model, Links, Marginalia

The main text is a TipTap/ProseMirror editor rendering LaTeX source meaningfully while preserving the raw LaTeX underneath.

## Editor

**[src/components/Editor.tsx](../../src/components/Editor.tsx)** (~1770 lines) wraps TipTap's `useEditor`. Since the FCU refactor it builds its extension list from the shared `buildEditorExtensions(ctx)` factory in [src/lib/editor-extensions.ts](../../src/lib/editor-extensions.ts) (the same factory every float editor consumes), then layers on keyboard shortcuts, selection handling, custom plugins, and wires up `onUpdate` → parent. Also mounts the margin `SelectionActionsMenu` (lightning-bolt button → `ActionsMenuPanel`) at the editor root.

After 2309137 the paragraph schema's `draggable` was flipped to `false` so PM no longer registers root-level paragraph DnD scaffolding; `handleDOMEvents.dragstart` is simplified to swallow residual native browser drags from `contenteditable`. The only surviving text-move paths are drag-to-pop-out (6-dot lift via `SelectionDragHandle` in the main editor margin) and drop-mode (grabbing a card's drop button — the double-chevron on the card header). Strip-icon drops, panel-body drops, and main-editor selection HTML5 drag plumbing are all gone.

After Path A 7.8, the Library Reader mounts the canonical `<EditorPane>` (which wraps `Editor.tsx`), so there is no longer a parallel `library/tiptap/` extension set. PgMarkChip — the only Library-only extension — has been folded into the unified set at [src/lib/tiptap/pgmark.ts](../../src/lib/tiptap/pgmark.ts); it's harmless on docs without `\pgmark{N}`.

Key props: `initialContent: JSONContent`, `onUpdate: (doc) => void`, `highlightText`, `highlightRange` (position-based highlight takes priority over text).

## Block nodes

All carry a `uuid` attr so they can serve as marginalia anchors. `isAnchorableNode()` in [src/lib/marginalia.ts](../../src/lib/marginalia.ts) detects this directly off the schema: `nodeType.spec.attrs?.uuid !== undefined`.

The `textObject` schema group is the single canonical answer to "is this graspable?" — paragraph, heading, list, list item, blockquote, codeBlock, displayMath, titleField, latexComment, texBlock, figureBlock, graphicsBlock, exampleBlock, exampleItem are all members. `linkedRange` (range-backed via the `linkedAnchor` mark) is a TextObject too but lives outside the schema group since it's a mark, not a node. See [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md) for the full taxonomy and [src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts) for the per-kind meta that drives grab-handle layout, float body, and drop adapter.

| Node | LaTeX | Notes |
|---|---|---|
| `paragraph` | (plain) | Baseline text container |
| `heading` | `\part` / `\chapter` / `\section` / `\subsection` / `\subsubsection` / `\paragraph` / `\subparagraph` | Levels 0–6 (vocabulary in [src/lib/heading-types.ts](../../src/lib/heading-types.ts)); supports `label` mark (`\label{}`). Per-heading control strip uses [src/components/HeadingTypeMenu.tsx](../../src/components/HeadingTypeMenu.tsx) |
| `bulletList` / `orderedList` | `\itemize` / `\enumerate` | Nested; optional `listPreamble` |
| `blockquote` | `\begin{quote}…\end{quote}` | |
| `codeBlock` | `\begin{verbatim}…\end{verbatim}` | |
| `displayMath` | `$$…$$` | Atom node |
| `texBlock` | `%!vtex:begin <uuid>` … `%!vtex:end <uuid>` (block-level raw LaTeX passthrough, edited inside a CodeMirror pod; popoutable like `exampleBlock`) | Atom block; `selectable:false`; node-view in `TexBlockNodeView.tsx` |
| `titleField` | hoisted `\title{}` / `\author{}` / `\date{}` | Round-trips via `\title`/`\author`/`\date` commands; the `fromPreamble` flag was dropped in 35824df |
| `maketitleMarker` | `\maketitle` | |
| `latexComment` | `%…` | Editable block node (`content: "text*"`, `marks: ""` + a non-editable `% ` widget prefix) — remodeled from an atom in 5ac7b847 (text now lives in `node.textContent`, not `attrs.text`). In `TEXT_OBJECT_REGISTRY` the old `isAtomBlock` flag was split (task 066) into `selectsAsNode:false` (duplicates/refs resolve to its inner text range) + `isMeaningfulBlockAtom:true` (still gated out of heading/insert targets as a non-prose unit); its `marks: ""` also greys the dead Highlight action via `MARKLESS_BLOCK_ACTIONS` |

**Paragraph titles are NOT a Tiptap attr.** They're stored in the `virgil.json` sidecar (`ParagraphMeta.title`), loaded in [src/hooks/useDocument.ts](../../src/hooks/useDocument.ts) as `paragraphTitles: Map<uuid, string>`. They appear in Omni view and search breadcrumbs — not inline in the editor.

## Inline atoms and marks

TipTap extensions in [src/lib/tiptap/](../../src/lib/tiptap/):

| Name | Kind | LaTeX | File |
|---|---|---|---|
| `footnote` | atom node | `\footnote{…}` (also `\thanks{…}` via the `thanks: true` attr — round-trips through the same node, surfaces as an "ACKNOWLEDGEMENT" card in the Footnotes panel/omni with badge "A", and does **not** consume the footnote counter) | `footnote.ts` |
| `citation` | atom node | `\citep{…}` etc. | `citation.ts` |
| `inlineMath` | atom node | `$…$` (rendered via KaTeX after ef8a8ce; click opens an inline edit popover — editable in embedded card/float editors too after EX-F4-02, since `virgil-math-click` now carries the owning editor and `handleMathSave` routes `setNodeMarkup` into THAT editor) | `math.ts` |
| `displayMath` | atom node | `$$…$$` and `\[…\]` (KaTeX-rendered, click-to-edit; same embedded-surface routing as `inlineMath`) | `math.ts` |
| `texBlock` | atom block | `%!vtex:begin <uuid>` … `%!vtex:end <uuid>` raw LaTeX passthrough | `tex-block.ts` |
| `figureBlock` | non-atom block — schema `content: "figureCaption?"`. Structured attrs: `extras` (the env body sans `\caption`/`\label`, source-of-truth for round-trip), `source[]`, `widthPercent`, `label`. Caption text lives in the `figureCaption` child node (`content: "inline*"`) so citations, footnotes, math, and inline marks work natively; a bold "Figure N:" prefix renders ahead of the caption and re-numbers via the `sectionNumbers` plugin. A blue label lozenge under the caption mirrors the heading annotation (Figure chip, # numbered toggle, label slot with conflict detection, hover-revealed delete). Click anywhere outside the caption opens `NodeEditPopover` for raw-LaTeX editing of `extras`; on save the popover dispatches `setNodeMarkup` (the EX-F4-02 twin routes `virgil-figure-click`/`handleFigureSave` by the owning editor, so figures are editable inside embedded float surfaces — `FigureFloatView`/`FigureFullView` — not just the main doc). Round-trip via the figure raster cache (see architecture.md). | `figure-block.ts` |
| `figureCaption` | child block of `figureBlock` (`content: "inline*"`) | (rendered as the prose after `\caption{…}`; serializer emits it back into the env body) | `figure-caption.ts` |
| `graphicsBlock` | atom block | bare `\includegraphics[...]{source}` (outside a `figure` env) — same popover + raster cache as `figureBlock` | `graphics-block.ts` |
| `latexComment` | editable block node | `%…` (native `content: "text*"`, `marks: ""` + `% ` widget prefix; NOT an atom since 5ac7b847 — registry facets `selectsAsNode:false`/`isMeaningfulBlockAtom:true`, task 066) | `latex-comment.ts` |
| `label` | mark | `\label{ref}` | `label.ts` |
| `labelRef` | node | `\ref{…}` / `\getref{…}` / `\getfullref{…}` (attr `refCommand` selects command; `targetKind` tags heading vs example). Body-positioned example `\label`s (on an example's body line, not header-adjacent) resolve to the right number via the `collectExampleBodyLabels` SSOT ([src/lib/example-refs.ts](../../src/lib/example-refs.ts)) — consulted by the parse/reload map, the live-doc ref refresh, and the create/popover resolver (62d20bcb) | `label.ts` |
| `linkedAnchor` | mark | (invisible by default; a `tintColor` attr makes the mark paint its range with a persistent color — used by Highlight cards for the Adobe-style yellow swatch. The tint survives kind transitions, so spawning a sibling note over a highlight's range keeps the yellow) | `linked-anchor.ts` |
| `latexCommandMark` | mark | raw LaTeX in text | `latex-command.ts` |
| `textColor` | mark | `\textcolor[HTML]{RRGGBB}{…}` (round-trips through the serializer; `\usepackage{xcolor}` auto-injected into preambles missing it, and `CLASSIC_PREAMBLE` ships it). Driven by the `ActionsMenuPanel` color swatch + `SelectionColorPopover`. | `text-color.ts` |
| `SlashPopupExtension` | PM plugin | typing `\` in prose opens an inline popup of Virgil's `VIRGIL_COMMANDS` list (declared in `commands.ts`); every command now resolves to a row of `VIRGIL_ACTION_REGISTRY` in [src/lib/actions/action-registry.ts](../../src/lib/actions/action-registry.ts), but via TWO dispatch paths: atom/card commands (`cite`/`footnote`/`ref`/`example`) plus the structural-wrapper toggles (`list`/`itemize`/`enumerate`/`quote`/`quotation` — bug sweep #6, which need the live editor's `.chain()`) go through the PM→React bridge `getEditorActionsHandleFor(view).runAction(<id>, { surface: "slash" })` from [src/lib/actions/editor-actions-bridge.ts](../../src/lib/actions/editor-actions-bridge.ts) (per-editor under multi-doc keep-alive; the atom/card commands also need React-land `cardCreation`); the pure-ProseMirror commands (`title`/`author`/`date`/`chapter`/`section`/`subsection`/`subsubsection`/`tex`) call the registry row's `spec.run(ctx)` directly via the local `runViewOnlyAction(<id>, view)` helper — NO bridge. Arrows + Enter inserts. Suppressed inside an unmatched `{` group or up against another `\name`. State lives in module-level `slashPopupStore`. | `slash-popup.ts` |
| ~~`archiveMarker`~~ | — | **Removed in 6ad177f.** Archive cards still work via the Archive panel; the in-editor invisible-anchor node and its click bridge are gone. | — |
| `exampleBlock` / `exampleItemList` / `exampleItem` / `exampleGloss` / `alignedGlossRow` / `proseGlossRow` / `glossCell` + `ExpexNumbering` plugin | nodes | expex package: `\ex`/`\pex`/`\a`/`\xlist`/`\begingl…\endgl`/`\gla`/`\glb`/`\glft`. `exampleItemList` is a recursive wrapper — nested `\xlist` tiers reuse the same wrapper node so the marker cycle (1 → a → i → A → I) compounds with depth. `exampleBlock` content schema is `(paragraph | exampleGloss | exampleItemList | bulletList | orderedList | graphicsBlock | displayMath)*` after 9dd0992 + Feature A2 (which added `graphicsBlock | displayMath` so a dropped picture/equation can join a single example's body directly) — itemize/enumerate now interleave freely inside an example, with the parser dropping (not fallback-paragraphing) unknown block types so `\vfid{}` / `\vcid{}` markers no longer double on save → reload. `ExampleBlockOptions.cardContext` (default `false`; set on card/float surfaces, #47) suppresses the example's own par-title strip — the absolutely-positioned "+T" annotation that would otherwise overlay the card header and collide with the host's `CardBodyTitle`; the in-doc editable example keeps its +T. | `expex.ts` |
| Standard marks | bold, italic, underline, code | `\textbf`, `\emph`, `\underline`, `\texttt` | StarterKit + custom |

Barrel export in [src/lib/tiptap/index.ts](../../src/lib/tiptap/index.ts); also re-exported from [src/lib/tiptap-extensions.ts](../../src/lib/tiptap-extensions.ts).

**Shared card-context atom sub-schema.** The inline atoms consumed inside card bodies (footnote, citation, labelRef, inlineMath) and block atoms (displayMath, graphicsBlock) are declared once in [src/lib/tiptap/borrowed-schema.ts](../../src/lib/tiptap/borrowed-schema.ts) (`buildBorrowedAtomSchema()`). Both `RichTextField` (editable card bodies) and `BorrowedMainText` (read-only borrowed prose) compose from this single source; the main editor is held to the same atom set by a contract test (`borrowed-schema.test.ts`). Before this, each surface hand-copied the extension list and could silently drift.

### Atoms are graspable (text-bound mobility)

The four canonical **Atoms** — `footnote`, `citation`, `labelRef` (`\ref`), `inlineMath` — are drag-and-droppable to a new inline cursor: the atom is its own grab handle. This realizes the Ontology's "text-bound mobility" affordance ([VIRGIL.md §Ontology](../architecture/VIRGIL.md)). SSOT is [`ATOM_REGISTRY`](../../src/lib/tiptap/atom-registry.ts) (the inline sibling of `TEXT_OBJECT_REGISTRY`); the gesture is [`InlineAtomGrab`](../../src/lib/tiptap/inline-atom-grab.ts) (a `handleDOMEvents.mousedown` plugin in `buildEditorExtensions`) → the existing drop-mode inline-cursor pipeline → [`inTextAtomGrabSpec`](../../src/components/drop-mode/specs/in-text-atom-grab.ts) (same-editor, captured source, node preserved). See `architecture.md` → Drag/drop MIME map → "Inline-Atom grab". A plain click still opens the atom's Card/popover (no-drag); no atom uses native HTML5 drag. (The id-less kinds — `\ref`, inline math — resolve via a position captured at grab, [inline-atom-source.ts](../../src/components/drop-mode/util/inline-atom-source.ts).)

### Creating an inline atom never scrolls

The four Atoms (footnote/citation/`\ref`/inlineMath) are `selectable:false` precisely so inserting one never forces a viewport scroll. Every React-side create helper now routes through ONE primitive — [`insertInlineAtom`](../../src/lib/tiptap/insert-inline-atom.ts) (the inline sibling of `smartInsertBlock`): it focuses with `{ scrollIntoView: false }`, `insertContent`s the atom (replacing any selection, e.g. footnote-from-selection / inline-math-wrap), and never dispatches `.scrollIntoView()`. Before this, the hand-rolled `editor.chain().focus().insertContent(…)` inherited `focus()`'s default deferred `scrollIntoView` and parked the brand-new atom under the sticky chrome ("the new footnote lands just out of view at the top"). The optional **`at` argument** carries the **captured-position contract** for deferred-popover commits (citation / `\ref` create): when given, the chain `setTextSelection`s to that trigger-time pos (clamped to the live doc — no scroll, since `setTextSelection` adds none) before inserting, so the atom lands where the user invoked even though the live selection drifted while the popover was open. The companion safety net for *intentional* scrolls (block inserts, jump-to-link) is [`chromeAwareScrollMargin`](../../src/lib/tiptap/chrome-scroll-margin.ts) — a live-reading `editorProps.scrollMargin` whose `top` tracks `--chrome-top` + `--editor-pt` so a deliberate `scrollIntoView()` lands below the MenuBar strip and reading-mask, not beneath them.

> **Keystroke-sanctity note (move ↔ structure observer).** A footnote/citation atom MOVE is a same-id delete+insert in one transaction. The `DocStructureObserver` step-inspector now (a) maps each step's range with the per-step `tr.mapping.slice(stepIndex)` against `tr.docs[stepIndex]` — the full mapping mis-mapped every step past the first, so multi-step moves dropped the re-inserted atom — and (b) emits the moved entry as `changedFootnotes`/`changedCitations` (carrying the new pos) so the structure index folds in the new position instead of leaving a stale/dropped one (which corrupted footnote renumbering). See [step-inspector.ts](../../src/lib/tiptap/doc-structure/step-inspector.ts) + [structure-index.ts](../../src/lib/tiptap/doc-structure/structure-index.ts).

## UUID stability across parse cycles

The parser writes invisible ID anchor commands into the LaTeX source so round-tripping doesn't regenerate IDs (which would break any UI state keyed by those IDs):

- `\vfid{<id>}` — precedes each footnote
- `\vcid{<id>}` — precedes each citation
- `\vexid{<id>}` — precedes each example block
- Paragraph/block IDs (`%!v:xxxx` comment markers) — stored in the Tiptap tree, re-emitted during serialization

In-source IDs use the **4-char hex** short-id format (`generateShortId(existing?)`). The same generator powers paragraph anchors and the three `\v*id` markers; each emit site collects existing ids of the relevant kind from the doc and passes them as the collision-avoidance set. Sidecar-only IDs (notes, todos, comments, etc.) still use full UUIDs (`generateEntityId`) since they never appear in `.tex`. Mixed long/short IDs in the same file round-trip cleanly — the parser accepts arbitrary strings in the brace.

Round-trip files: [src/lib/latex-parser.ts](../../src/lib/latex-parser.ts) (`.tex` → JSONContent), [src/lib/latex-serializer.ts](../../src/lib/latex-serializer.ts) (JSONContent → `.tex`). Paragraph UUID mapping in [src/lib/latex-paragraph-map.ts](../../src/lib/latex-paragraph-map.ts).

`NODE_UUID_REGEX` and `NODE_UUID_ANCHOR` live in [src/lib/uuid.ts](../../src/lib/uuid.ts).

**Typographic glyphs round-trip too.** Accents / special-letters (`\'e`↔é, `\v{s}`, `\c{c}`, `\ss`, `\o`, …), en/em dashes (`--`↔–, `---`↔—), and `\ldots`↔… are mapped **bidirectionally** through one typography table — [src/lib/latex-typography.ts](../../src/lib/latex-typography.ts) — wired into the parser, serializer, and `footnote-content.ts`. The mapping skips code/verbatim/math/`latexCommand` spans; directly-typed glyphs normalize-on-save back to canonical LaTeX commands (the smart-quote precedent), so the `.tex` source stays canonical while the editor shows composed glyphs.

## Link architecture

**SSOT: [src/links/link-registry.ts](../../src/links/link-registry.ts).** Types in [src/links/_shared/types.ts](../../src/links/_shared/types.ts). Resolvers/creators/deleters in [src/links/links.ts](../../src/links/links.ts).

### Three kinds

| Kind | Anchor | Marker (in text) | Multiplicity | Card kind(s) |
|---|---|---|---|---|
| `footnote` | inline atom (footnote node) | superscript number | 1:1 | footnote |
| `citation` | inline atom (citation node) | styled pill | 1:1 | citation |
| `anchor` | any TextObject (`targetKind`) — paragraph, heading, list item, example item, atom block, or linkedRange | margin icon (+ optional text highlight for `linkedRange`) | many | note, highlight, revision, cut, archive, todo, report |

### Anchor shape (Mode A / Mode B unified)

Phase D8 collapsed the Mode A vs Mode B distinction into a derived check on a single `targetKind: TextObjectKind` field. The anchor shape:

```ts
type LinkAnchor =
  | { type: "inline-atom"; nodeName: "footnote" | "citation"; pos }
  | {
      type: "textObject";
      targetKind: TextObjectKind;       // any TextObject kind
      textObjectIds: string[];          // node uuid(s) (or anchorId, for linkedRange)
      margin: { side: "left" | "right" };
      paragraphSnapshot?: string;       // Mode-A self-healing whole-paragraph text snapshot
      textRange?: { anchorId; textSnapshot };  // present iff targetKind === "linkedRange"
    };
```

`paragraphSnapshot` is the **Mode-A self-healing snapshot** (additive + optional; added in 4f94fed, [_shared/types.ts](../../src/links/_shared/types.ts)). A normalized whole-paragraph text capture taken at write time (`captureParagraphSnapshot` in [links.ts](../../src/links/links.ts)) — captured both at card **creation** and at every drop **re-anchor** ([addTextObjectLink](../../src/links/links.ts) threads it). On reload it lets the reconciler re-find a paragraph by text when its `%!v:` UUID lost the autosave race and got re-minted. It is to Mode A what `textRange.textSnapshot` is to Mode B. Legacy snapshot-less links keep UUID-only behavior until they're backfilled on the next load.

**Mode A** (legacy term) = `targetKind !== "linkedRange"`. The card is anchored to one or more TextObject nodes by uuid; no inline mark.

**Mode B** (legacy term) = `targetKind === "linkedRange"`. The card is anchored to a `linkedAnchor` mark range (Phase E now also persists this range to LaTeX via `\vlid{}` / `\vlidend{}` paired markers). The `textRange.textSnapshot` is the canonical recovery path when the mark vanishes — `reanchorByText` in [src/links/links.ts](../../src/links/links.ts) searches the doc by text content. `LinkedAnchorKind` (the mark's `kind` attr) now covers `note | highlight | todo | revision | cutter-comment | cutter-suggestion | report | report-request` — **todo gained Mode-B text-range parity with note/cutter/revision in fa7b898** (created from a selection), so `useLinkedAnchorReconciler` ([src/links/_shared/useLinkedAnchorReconciler.ts](../../src/links/_shared/useLinkedAnchorReconciler.ts)) takes `todos` in its alive-set or the next collection sweep reaps the todo's mark as an orphan.

**Restore on reload (sidecar-authoritative — BUG1 fix).** The `.tex` parse does **not** drop the in-doc `linkedAnchor` mark — it RESURRECTS every `\vlid`/`\vlidend` pair as a HARDCODED `kind:"note"`/`linkCard:""` mark (the serializer dropped kind/linkCard/tintColor on the way out), so a revision/cutter/todo/report/highlight span reloads MISLABELED as a note and the sidecar `links[]` are the only surviving record of its true kind + tint. **One** load-time pass reconciles this: `reapplyModeBAnchors(...)` ([src/links/_shared/reapply-mode-b-anchors.ts](../../src/links/_shared/reapply-mode-b-anchors.ts)), invoked once per doc-open from `EditorPane.tsx`'s reconcile effect, calls `EditorHandle.applyLinkedAnchors(records)`, which delegates to the **one** shared `applyLinkedAnchorsImpl(editor, records)` ([src/links/_shared/apply-linked-anchors.ts](../../src/links/_shared/apply-linked-anchors.ts) — imported by both the `Editor.tsx` handle and the RC-B tests so they can't drift). It makes the SIDECAR authoritative over the parser's hardcoded default: a record whose mark is **absent** → re-stamp from the snapshot text via `reanchorByText`; **present & DISAGREES** (kind or tintColor mismatch) → re-stamp the existing range IN PLACE with the correct kind/tint (`addToHistory:false`, `linkCard` preserved); **present & AGREES** → skip (idempotent). This is the load-time reconcile that earlier docs described as living in `EditorLayout.applyLinkedAnchors` (the v0.1.56 reapply-mode-b-anchors change said it was "retired"): there used to be a second writer there racing the EditorPane load reconcile; the load-time role now lives in this shared impl, so there is exactly one load-time owner. Ordering is load-bearing: re-apply runs BEFORE the six per-panel `reconcileAnchors(editor)` calls so healthy un-re-anchored Mode-B cards win the resolver's live-mark rung; re-anchored hybrids (a Mode-B card that also carries a clean Mode-A link) are excluded so their dead anchorId isn't re-stamped at the old paragraph.

On the **absent** path, `reanchorByText` is passed **no cardId**, so the restored mark carries an empty `linkCard`. The per-kind reload tint therefore derives purely from the legacy `kind` attr via the SSOT crosswalk `dataLinkCardTokenForLegacyMarkKind` ([src/cards/legacy-token-crosswalk.ts](../../src/cards/legacy-token-crosswalk.ts)), consumed by `linkedAnchorRenderAttrs` ([src/lib/tiptap/linked-anchor-attrs.ts](../../src/lib/tiptap/linked-anchor-attrs.ts)) to emit `data-link-card="<token>:"`. Before 7e3e29f the hand-rolled switch covered only note/highlight/cut/revision, so a restored todo/cutter/report span fell through to an empty token and lost its tint on reload. (The data-link-card token namespace was unified onto the spine kind in 2066323 — the two revision kinds now emit the spine `revision-comment:`/`revision-suggestion:` token, so the render fallback, `updateLinkedAnchorCard`, and the CSS all agree.)

**Anchor-recovery resolver (SSOT).** [src/links/resolve-card-anchor.ts](../../src/links/resolve-card-anchor.ts) is the single pure resolver every consumer (load reconcile + render cull + Mode-B re-apply) funnels through to answer "what paragraph does this card live on NOW?" `buildResolveIndex(editor)` builds ONE O(doc) index per pass (live uuids, anchorId→paragraph, normalized-text→paragraph); `resolveCardAnchor(card, editor, index)` then resolves each card O(1) against it down a fixed ladder — **uuid → mark → rung-2b self-heal → snapshot → orphan** (uuid STRICTLY before snapshot). `reconcileCardToResolved` is the lone pure card mutator: on a `uuid` resolution it backfills a missing `paragraphSnapshot` from live text and strips a residual dead-mark `linkedRange` hybrid; on a `snapshot` resolution it rewrites `textObjectIds[0]` and **converts** a relocated Mode-B link into a clean Mode-A paragraph link. The six panel hooks (notes/todos/cutter/revisions/reports/archive) drive this on load via `useReconcileModeAAnchors` ([src/hooks/useReconcileModeAAnchors.ts](../../src/hooks/useReconcileModeAAnchors.ts)), exposing a uniform `reconcileAnchors(editor)` the EditorPane effect calls once per doc-open (load-only, idempotent, never on a keystroke). A card resolving to `source:'orphan'` (uuid + mark + snapshot all dead) is surfaced in a fixed "unanchored — click to re-pin" margin dock (`unanchored` flag on `MarginaliaMarker`) rather than silently culled. The legacy per-card `reconcileModeAAnchors` / `findParagraphIdBySnapshot` / `isModeAOrphaned` helpers in [links.ts](../../src/links/links.ts) are kept exported for their own tests only — no production code imports them.

**Re-anchor CONVERTS Mode-B → Mode-A (RC1).** A paragraph-side drop re-anchor of a selection-note no longer folds the new paragraph into the surviving `linkedRange` link; `addTextObjectLink` gates `targetKind === "paragraph"` out of the Mode-B fold and writes a fresh clean Mode-A link (threading the snapshot), and the resolver/reconcile heal any residual hybrid on the next load.

**Immediate doc-bundle flush on UUID mint.** An anchor-UUID mint (`setNodeMarkup(... uuid)` with `addToHistory:false`) is tagged with `ANCHOR_MINT_META` ([src/lib/anchor-mint-signal.ts](../../src/lib/anchor-mint-signal.ts)); the autosave subscriber reads the tag off TipTap's `update` event and forces an immediate doc-bundle flush so the paragraph UUID lands on the card's fast clock instead of the 1500 ms doc autosave (closing the orphan race at the source). Strictly meta-gated — a plain keystroke never triggers it.

Derivation helper: `isModeB(link)` is now `link.anchor.type === "textObject" && link.anchor.targetKind === "linkedRange"` — kept for ripple minimization, the underlying check is fully derived.

Legacy sidecar shapes (`anchor.type: "anchor"` with `paragraphIds`) migrate on read via `migrateCardLinks` in [src/links/migrate-card.ts](../../src/links/migrate-card.ts).

### DOM contract (uniform across all kinds)

In-editor markers (footnote atom, citation atom, linkedAnchor mark span) carry:

```
data-link-id="<uuid>"
data-link-kind="footnote | citation | anchor"
data-link-card="<cardKind>:<cardId>"
```

Panel cards carry `data-link-card="<cardKind>:<cardId>"`; multi-anchor cards also carry `data-link-ids="<id1> <id2> …"` (space-separated).

### Resolution

`resolveLink(link, editor)` returns:
- Inline atom: `{ kind: "inline-atom", pos, nodeSize, domEl }`
- Text range (Mode B): `{ kind: "text-range", from, to, domEl }`
- Paragraph (Mode A): `{ kind: "paragraph", paragraphId, pos, domEl }`

`jumpToLink()` is the user-facing "go to" action — triggered by the jump-to button on each card.

### Highlight coupling

Hover and selection are unified across the three linked surfaces (text, margin icon, panel card) via a `cardStore` ([src/links/_shared/anchored-card-store.ts](../../src/links/_shared/anchored-card-store.ts)) holding `{ expandedSet, selection: AnchoredCardRef | null, hover: AnchoredCardRef | null }`. **Per-doc, not module-global (the context seam, bcee4b4c).** Under multi-doc keep-alive several papers mount at once; a single module store would co-mingle selection/expansion/hover across docs. So the store is an INSTANCE (`createCardStore()`), one per docId, resolved through a registry (`getCardStore(docId)`) and surfaced to the React tree via `CardStoreContext` + `<CardStoreProvider>` (mounted once per pane inside EditorPane, the per-doc card-surface root). React context propagates through portals by tree position, so popped-out floating cards rendered inside EditorPane's subtree observe the right doc's store. Read hooks (`useSelection`/`useExpandedSet`/`useHover`/`useIs*`) read the CONTEXT store; imperative callers get the instance threaded in (`useCardStore()` for descendants, `getCardStore(docId)` for the EditorPane body / EditorLayout shell). A `defaultCardStore` backs the context default for consumers mounted outside a provider (tests, app-level dialogs). `useSyncExternalStore` gives observability without a common ancestor. Hover any one of the three surfaces and all three light up; click a card or margin icon and selection propagates. Selection is *single*: at most one card is selected within a doc.

Per-card integration is one line: `const ac = useAnchoredCard({ kind, id }); return <PanelCard {...ac.props} selected={ac.selected} ... />`. The hook returns the `data-card-key`, mouse handlers, and selected/hovered booleans every anchored card needs. No per-card-kind hover handlers anywhere; adding a new anchored card kind is just `ANCHORED_CARD_KINDS` + this 3-line pattern.

- [src/links/_shared/anchored-card-store.ts](../../src/links/_shared/anchored-card-store.ts) — per-doc `cardStore` (`createCardStore`/`getCardStore`/`CardStoreProvider`/`useCardStore`) + `useIsSelected` / `useIsExpanded` / `useIsHovered` / `useSelection` / `useExpandedSet` / `useHover`.
- [src/links/_shared/useAnchoredCard.ts](../../src/links/_shared/useAnchoredCard.ts) — the single hook every anchored panel card calls.
- [src/links/_shared/usePlacement.ts](../../src/links/_shared/usePlacement.ts) — card → text alignment: when `cardStore.selection` changes via a user gesture, scroll the editor so the closest anchor aligns with the selected card's vertical position. (Text/marginalia → card alignment is the inverse and still flows through `openForCard`.)
- [src/links/_shared/entity-hover.ts](../../src/links/_shared/entity-hover.ts) — `EntityKind` union (the anchored kinds `note`/`highlight`/`footnote`/`citation`/`report`/`report-request`/`example`/`todo`/`archive`/`revision-comment`/`revision-suggestion`/`cutter-comment`/`cutter-suggestion`, i.e. `ANCHORED_CARD_KINDS`) and generic resolvers (`findEntity`, `cardKeyForEntity`, `entityToAnchorId`).
- [src/links/_shared/useLinkHighlight.ts](../../src/links/_shared/useLinkHighlight.ts) — paints `data-link-highlight="hover" | "active"` on `.linked-anchor` spans (Mode B text ranges).
- [src/links/_shared/useAnchorHighlightReconciler.ts](../../src/links/_shared/useAnchorHighlightReconciler.ts) — single idempotent reconciler that paints both `data-card-hovered` and `data-card-selected` on resolved anchors *and* on matching panel cards (via `data-card-key`) in one pass. 930b9f6 unified the two previously-separate hover/selection hooks here so the two states share lookup and never desync. **Three paint surfaces, two mechanisms (6949dd3/9db5a97):** (1) in-editor NODE/atom anchors (Mode-A blocks + footnote/citation atoms) are painted via a ProseMirror **decoration** — `AnchorHighlightDecorator` ([src/lib/tiptap/anchor-highlight-deco.ts](../../src/lib/tiptap/anchor-highlight-deco.ts), registered in `buildEditorExtensions`); the reconciler resolves each to live PM coords and pushes the complete target list through `setAnchorHighlightTargets` (a meta-only tx, keystroke-safe), so PM owns the attrs and never redraws the node (this killed the listItem/heading hover-cull at the root). (2) in-editor Mode-B `.linked-anchor` mark spans and (3) panel cards stay on **raw setAttribute** — a mark span is not a `Decoration.node`-owned block (and a `Decoration.inline` would wrap the text in a fresh child, missing the `.linked-anchor[data-card-*]` CSS), and panel cards are plain React DOM.
- [src/links/_shared/useLinkedAnchorReconciler.ts](../../src/links/_shared/useLinkedAnchorReconciler.ts) — thin sibling reconciler for Mode B text ranges (the `.linked-anchor` spans inside the editor).
- [src/links/_shared/request-marks.ts](../../src/links/_shared/request-marks.ts) — persistent marker-associated text highlight for OPEN AI-requested cards (9f6a134e). While a card carries `aiRequest:true`, one EditorPane effect stamps a `pending-ai-*` `linkedAnchor` tint over the card's anchor span (keyed on the aiRequest set + the load-order data-loss gate, keystroke-safe); a `requestHighlightLink` branch in `linksForRef` mirrors `appliedChangeLink` so card/marker hover lights the same span. Mode-B cards are excluded (a second mark would clobber their span); the orphan reapers skip the `pending-ai-*` family by kind.
- [src/links/_shared/useTextHoverBridge.ts](../../src/links/_shared/useTextHoverBridge.ts) — single delegated `mouseover`/`mouseout`/`click` listener on `editor.view.dom`. Resolves linkedAnchor spans, citation atoms (`[data-citation-id]`), footnote atoms (`[data-footnote-id]`); on Mode B click, dispatches `virgil-linked-anchor-click` for the bridge in `event-bridges/marker-clicks.ts` to route via `openForCard`.
- [src/links/_shared/usePanelCardHoverBridge.ts](../../src/links/_shared/usePanelCardHoverBridge.ts) — single document-level listener that reads `data-card-key` to translate panel card hovers into entity hovers.

Margin markers carry no hover props — each marker self-subscribes to the `cardStore` (`useIsHovered` in `Marginalia.tsx`, painted as `data-card-hovered`) using its `entityKind` + `entityId`, so there's no prop threading from a parent loop. The marker rows themselves are built in `EditorPane.tsx`'s `marginaliaMarkers` useMemo — the live margin-marker builder, gated on the `useStructuralRevisions` counters (`rev.anchors` / `rev.blocks`), never a raw update counter (keystroke sanctity).

## Drop mode

Grabbing a card's **drop button** (the double-chevron — rightmost control on the docked card header, left of the X when the card is popped into a float) puts the app into **drop mode** — a visual indicator (paragraph-side / between-blocks / inline-cursor bar) tracks the cursor over valid placements, and a popped-out source float dims and goes click-through. Releasing drops the payload back into the editor; releasing outside any target cancels. (The legacy Shift-grab-on-a-float-header entry was retired in req-7.)

- Entry: `beginDropSession({ cardKey })` in [src/components/drop-mode/controller.ts](../../src/components/drop-mode/controller.ts). The four producers that start a session are the card drop button (`CardDropButton` → `beginCardDropGesture`, shared by the docked header + the float-chrome button), the in-text inline-atom grab ([inline-atom-grab.ts](../../src/lib/tiptap/inline-atom-grab.ts)), the lifted-overlay grab handle ([TextObjectGrabHandle.tsx](../../src/text-objects/TextObjectGrabHandle.tsx)), and `StackThumbnail` (with cardKey `stack-pull:<id>`).
- **Lifted-overlay gesture core ([LiftHost.tsx](../../src/text-objects/LiftHost.tsx)).** The lift-overlay machinery — the `LiftedTextOverlay` ghost that follows the cursor and the post-threshold `beginLift` core — was **extracted out of `TextObjectGrabHandle` into a shared `LiftHost` provider** (mounted in EditorPane as the lowest common ancestor of the grab handle AND the float spine). It now has **two producers**, distinguished by `beginLift({ terminalPolicy })`: the in-editor **grab handle** drives `terminalPolicy: "grab"` (release-in-margin pops a float, release-on-page moves the block); the **popped-out text-object float's drop button** drives `terminalPolicy: "float"` (ghost-only — no popout, since the float is already open; release over editor content moves the block and closes the float, release outside cancels). See `ui-chrome.md` → Floating panels & cards for the float-button wiring.
- Provider: [src/components/drop-mode/DropModeProvider.tsx](../../src/components/drop-mode/DropModeProvider.tsx). Indicator: [Indicator.tsx](../../src/components/drop-mode/Indicator.tsx). Hit-testing: [hit-test.ts](../../src/components/drop-mode/hit-test.ts).
- Per-payload behavior is a `DropSpec` keyed by card-key prefix in [registry.ts](../../src/components/drop-mode/registry.ts). The block-source specs collapsed into one [specs/textobject.ts](../../src/components/drop-mode/specs/textobject.ts) (D5+D6) — it parses the `textobject:<kind>:<id>` cardKey, walks the doc for source + parent, classifies the target context (top-level / inside-compatible / inside-incompatible), and routes through `meta.dropAdapter` (wrap vs drop-direct) and `meta.collectMoveSource` (single node vs section range). Adding a new TextObject kind = one registry entry; no edit to the spec. Other specs in [specs/](../../src/components/drop-mode/specs/) (`stack-pull`) carry different payloads. Each panel that participates also re-exports its spec via a panel-local `drop-spec.ts` (Archive, Citations, Cutter, Examples, Footnotes, Notes, Reports, Revisions, Todo).
- CSS for the placement bars lives in [src/app/globals.css](../../src/app/globals.css) (`.dropmode-bar-*`).

## Marginalia

**[src/components/Marginalia.tsx](../../src/components/Marginalia.tsx)** renders the margins (left and right of the editor). Metadata + types live in [src/lib/marginalia.ts](../../src/lib/marginalia.ts); grid-layout math in [src/lib/marginalia-grid.ts](../../src/lib/marginalia-grid.ts).

- **Columns per side**: 2 (`MARGINALIA_COLS`)
- **Icon size**: 22px squares with 2px row gap
- **Positioning**: line-aligned per paragraph; scroll-synced via `useSyncExternalStore`
- **Re-anchor**: a margin pin is re-anchored through the unified **drop-mode** controller (chip H), not native DnD — grabbing a pin calls `beginCardDropGesture` with a `float:card:<kind>:<id>` key built from the marker's `entityKind`. The legacy `MIME_MARGINALIA_MOVE` DataTransfer drag was retired; that MIME survives only as the lone never-produced member of `ANCHOR_DRAG_TYPES` (a residual `isAnchorDrag` suppress-guard).
- **Marker placement + healing**: the per-block `IntersectionObserver` registry [src/hooks/useMarginaliaRegistry.ts](../../src/hooks/useMarginaliaRegistry.ts) supplies live anchor metrics. When an anchor block's DOM element is **swapped** (a listItem/heading whose `data-uuid` Decoration.node gets redrawn — e.g. the old raw-setAttribute hover path), its IO LEAVE distinguishes a real viewport-leave (`el.isConnected`) from a detach (`!isConnected`) and arms a bounded RAF to re-observe the fresh element, so a live anchored block with a desired marker is never left culled (8cbd5ea). The deeper fix for that redraw class is the decoration-based hover reconciler (see Highlight coupling above).
- **Unanchored dock**: a card whose anchor resolves to `source:'orphan'` (uuid + mark + snapshot all dead) can't be line-aligned, so instead of culling it the margin surfaces it in a fixed "unanchored — click to re-pin" dock (the `unanchored` flag on `MarginaliaMarker`).

### Marker types (`MARKER_META`)

`note`, `archive`, `revision`, `cut`, `todo`, `report`, `error`. Each has a color palette (primary, background, border) customizable per-panel via the header color picker (`deriveCardPalette` in [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts)). Note that **Highlight cards do not appear in the marginalia** — they're a pure text-tint feature (`tintColor` attr on the `linkedAnchor` mark), so there is no `highlight` MarkerType.

### MIME drop types

After the chip-H drop-mode fold (PHASE 1/2, 296280a/79ccdad), the paragraph-anchor MIMEs (`MIME_NOTE`, `MIME_TODO`, `MIME_ARCHIVE_ANCHOR`, `MIME_CUT`, `MIME_REPORT`) were **removed** — those panel→margin / margin-pin re-anchor drags now go through the drop-mode controller. The surviving `MIME_*` constants in [src/lib/marginalia.ts](../../src/lib/marginalia.ts) are now ONLY inline-insertion payloads (`MIME_CITATION`, `MIME_FOOTNOTE`, `MIME_ARCHIVE`, `MIME_TEXT_INSERT`) plus `MIME_SELECTION_ANCHOR` (the selection-chip → panel drag). `ANCHOR_DRAG_TYPES` is now just `[MIME_MARGINALIA_MOVE]` (a residual never-produced suppress token).

### Adding a new marginalia type

From the header comment in `src/lib/marginalia.ts` (rewritten after the chip-H drop-mode fold):
1. Add the token to `MarkerType` (`src/cards/types.ts`), declare it on the owning card kind(s) in `CARD_REGISTRY` (`markerType` field), and add a presentation row to `MARKER_META` (label / defaultSide / icon — panel + accent derive from the registry via `src/cards/marker-meta.ts`).
2. Register a `dropSpec` for each owning card kind (the `textObjectSideReanchorSpec` factory in [src/components/drop-mode/util/text-object-side-reanchor.ts](../../src/components/drop-mode/util/text-object-side-reanchor.ts), wired to a `ParagraphAnchorApi` sub-bag on the `DropCtx`) so the margin pin can re-anchor through the unified drop-mode controller; wire that sub-bag in `EditorPane`'s `DropModeProvider`.
3. Emit the marker in `EditorPane.tsx`'s `marginaliaMarkers` builder carrying `entityKind` (the real `CardKind`) so the pin's `beginCardDropGesture` builds the correct `float:card:<kind>:<id>` key.

## Citations & bibliography

- Citation commands (natbib + biblatex families, `~20+` commands) declared in [src/lib/cite-commands.ts](../../src/lib/cite-commands.ts).
- `.bib` parsed via citation-js in [src/lib/bib-parser.ts](../../src/lib/bib-parser.ts).
- Bibliography search/filter in [src/lib/bib-search.ts](../../src/lib/bib-search.ts).
- **Creating a citation = a deferred-commit POPOVER** (the shared create controller — see below). The explicit create surfaces (slash `\cite`, the lightning grid cell, the grab-bar 'Citation' action) open [`CitationCreatePopover`](../../src/panels/Citations/CitationCreatePopover.tsx) OVER THE TEXT at the caret (cursor auto-focused in a citekey search). Picking citekeys STAGES them (chips); the real `\cite{…}` atom + margin card materialize only on commit (the OK button, or click-away / Escape) and only when ≥1 key is staged — so the margin never flashes a blank pristine card mid-pick. The popover reuses [`CitekeyPicker`](../../src/panels/Citations/CitekeyPicker.tsx) (`keepOpenOnPick`) for the paper-bib + library search. **Typed LaTeX is the exception**: `\cite{key}` (full) and `\cite ` / `\citep ` (bare) stay atom-first — the user typed the exact command, so it inserts synchronously, preserving the command verbatim. Subsequent edits (prenote/postnote, command type, add/remove keys) happen in the margin card at its standard position.
- The in-panel builder (`+ Add citation` → unanchored draft) lives in [src/panels/Citations/CitationsPanel.tsx](../../src/panels/Citations/CitationsPanel.tsx) — a separate, deliberately not-over-the-text flow.
- **Container-owned citations nest (footnote OR example).** A `\cite` that lives *inside* a footnote's body OR an `exampleBlock`'s body is tagged with a generalized `nestedInContainerId: { kind: "footnote" | "example", id }` on its `CitationEntry` by the `DocStructureObserver`'s load-only `buildInitial` pass (footnote-body cites also keep the legacy `nestedInFootnoteId`, same id, for back-compat; example cites use only the generalized field). The render side (`nest-footnote-children.ts`, now a unified `nestContainerChildren` engine) reads `nestedInContainerId` to nest the cite **under its container's card** in the docked Citations panel ("in examples" / "in example N") and the omni, rather than as a free-standing card. Example nesting was Phase 2a (2b283abf); footnote nesting was Phase 2. The tag is stamped only at load (`applyDiff` carries the prior owner forward across in-place edits/moves; a cite moved *out* of its container self-heals on the next reload). References have no card, so there's nothing to nest there.
- Bibliography panel shows only `.bib` entries actually referenced in the document, formatted per CSL style.

### Shared inline-atom create popover (citation + `\ref`)

Citation and `\ref` are both created through ONE deferred-commit lifecycle controller. A trigger surface calls `ctx.openAtomCreate(kind)` — the seam on `ActionContext` ([action-registry.ts](../../src/lib/actions/action-registry.ts)), supplied by EditorPane's bridge for the slash surface and by `ActionsMenuPanel` for lightning; the grab-bar dispatcher dispatches the same event at the passage end. It computes the caret rect AND captures the insertion **position** at trigger time, then hops the `virgil-atom-create-popover` event ([src/lib/actions/atom-create.ts](../../src/lib/actions/atom-create.ts)) that EditorLayout consumes into ONE `atomCreateRequest` state. That state mounts the per-kind body — `CitationCreatePopover` (deferred, multi-key, OK button) for citation, `LabelRefPopover` **create-mode** for `\ref` (single label, commit-on-pick). The captured `pos` is the `insertInlineAtom` **`at`** the commit lands the atom at — robust to selection drift while the popover is open. Keystroke-safe by construction: the popover is a React portal `<input>` that never touches the PM doc, so typing in it emits zero structural transactions. `\ref`'s **edit-existing** path (clicking a live `\ref` → `virgil-label-ref-click` → `activeRef*`) is a separate render and is untouched. The `atomCreateRequest` carries the **owning editor**, so a `\ref`/`\cite` triggered from inside a footnote editor commits into THAT editor (`owner ?? main`) — mirroring the `inlineMath`/figure owning-editor routing above — and footnote-nested `\ref`/`\cite` now round-trip (`footnote-content.ts` serializes `labelRef`, previously dropped on save).

## Split-screen editing

Two editor columns rendered from the **same** Tiptap document state — edits in one appear in the other. Panel visibility per side is tracked separately. See [src/components/editor-layout/split-editor-panes.tsx](../../src/components/editor-layout/split-editor-panes.tsx).

## Section folding

Collapsible sections (hides everything under a heading until next sibling heading). See [src/lib/section-folding.ts](../../src/lib/section-folding.ts).
