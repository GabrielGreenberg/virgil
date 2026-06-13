<!-- last-verified: aa5e40f 2026-06-13 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology, docs/architecture/VIRGIL.md#latex-round-trip-vocabulary, docs/architecture/VIRGIL.md#uuid-marker-emission -->
<!-- covers-code: src/lib/tiptap, src/links, src/lib/marginalia.ts, src/lib/latex-parser.ts, src/lib/latex-serializer.ts, src/text-objects -->

# Main Text: Editor, Content Model, Links, Marginalia

The main text is a TipTap/ProseMirror editor rendering LaTeX source meaningfully while preserving the raw LaTeX underneath.

## Editor

**[src/components/Editor.tsx](../../src/components/Editor.tsx)** (~2010 lines) wraps TipTap's `useEditor`. Since the FCU refactor it builds its extension list from the shared `buildEditorExtensions(ctx)` factory in [src/lib/editor-extensions.ts](../../src/lib/editor-extensions.ts) (the same factory every float editor consumes), then layers on keyboard shortcuts, selection handling, custom plugins, and wires up `onUpdate` → parent. Also mounts the gutter `SelectionActionsMenu` (lightning-bolt button → `ActionsMenuPanel`) at the editor root.

After 2309137 the paragraph schema's `draggable` was flipped to `false` so PM no longer registers root-level paragraph DnD scaffolding; `handleDOMEvents.dragstart` is simplified to swallow residual native browser drags from `contenteditable`. The only surviving text-move paths are drag-to-pop-out (6-dot lift via `SelectionDragHandle` in the main editor margin) and drop-mode (shift-drag on a float header). Strip-icon drops, panel-body drops, and main-editor selection HTML5 drag plumbing are all gone.

After Path A 7.8, the Library Reader mounts the canonical `<EditorPane>` (which wraps `Editor.tsx`), so there is no longer a parallel `library/tiptap/` extension set. PgMarkChip — the only Library-only extension — has been folded into the unified set at [src/lib/tiptap/pgmark.ts](../../src/lib/tiptap/pgmark.ts); it's harmless on docs without `\pgmark{N}`.

Key props: `initialContent: JSONContent`, `onUpdate: (doc) => void`, `highlightText`, `highlightRange` (position-based highlight takes priority over text).

## Block nodes

All carry a `uuid` attr so they can serve as marginalia anchors. Detection is schema-based via the `textObject` schema group: `nodeType.isInGroup("textObject")`. `isAnchorableNode()` in [src/lib/marginalia.ts](../../src/lib/marginalia.ts) is now a one-line wrapper over that predicate.

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
| `latexComment` | `%…` | Atom node |

**Paragraph titles are NOT a Tiptap attr.** They're stored in the `virgil.json` sidecar (`ParagraphMeta.title`), loaded in [src/hooks/useDocument.ts](../../src/hooks/useDocument.ts) as `paragraphTitles: Map<uuid, string>`. They appear in Omni view and search breadcrumbs — not inline in the editor.

## Inline atoms and marks

TipTap extensions in [src/lib/tiptap/](../../src/lib/tiptap/):

| Name | Kind | LaTeX | File |
|---|---|---|---|
| `footnote` | atom node | `\footnote{…}` (also `\thanks{…}` via the `thanks: true` attr — round-trips through the same node, surfaces as an "ACKNOWLEDGEMENT" card in the Footnotes panel/omni with badge "A", and does **not** consume the footnote counter) | `footnote.ts` |
| `citation` | atom node | `\citep{…}` etc. | `citation.ts` |
| `inlineMath` | atom node | `$…$` (rendered via KaTeX after ef8a8ce; click opens an inline edit popover) | `math.ts` |
| `displayMath` | atom node | `$$…$$` and `\[…\]` (KaTeX-rendered, click-to-edit) | `math.ts` |
| `texBlock` | atom block | `%!vtex:begin <uuid>` … `%!vtex:end <uuid>` raw LaTeX passthrough | `tex-block.ts` |
| `figureBlock` | non-atom block — schema `content: "figureCaption?"`. Structured attrs: `extras` (the env body sans `\caption`/`\label`, source-of-truth for round-trip), `source[]`, `widthPercent`, `label`. Caption text lives in the `figureCaption` child node (`content: "inline*"`) so citations, footnotes, math, and inline marks work natively; a bold "Figure N:" prefix renders ahead of the caption and re-numbers via the `sectionNumbers` plugin. A blue label lozenge under the caption mirrors the heading annotation (Figure chip, # numbered toggle, label slot with conflict detection, hover-revealed delete). Click anywhere outside the caption opens `FigurePopover` for raw-LaTeX editing of `extras`; on save the popover dispatches `setNodeMarkup`. Round-trip via the figure raster cache (see architecture.md). | `figure-block.ts` |
| `figureCaption` | child block of `figureBlock` (`content: "inline*"`) | (rendered as the prose after `\caption{…}`; serializer emits it back into the env body) | `figure-caption.ts` |
| `graphicsBlock` | atom block | bare `\includegraphics[...]{source}` (outside a `figure` env) — same popover + raster cache as `figureBlock` | `graphics-block.ts` |
| `latexComment` | node | `%…` | `latex-comment.ts` |
| `label` | mark | `\label{ref}` | `label.ts` |
| `labelRef` | node | `\ref{…}` / `\getref{…}` / `\getfullref{…}` (attr `refCommand` selects command; `targetKind` tags heading vs example) | `label.ts` |
| `linkedAnchor` | mark | (invisible by default; a `tintColor` attr makes the mark paint its range with a persistent color — used by Highlight cards for the Adobe-style yellow swatch. The tint survives kind transitions, so spawning a sibling note over a highlight's range keeps the yellow) | `linked-anchor.ts` |
| `latexCommandMark` | mark | raw LaTeX in text | `latex-command.ts` |
| `textColor` | mark | `\textcolor[HTML]{RRGGBB}{…}` (round-trips through the serializer; `\usepackage{xcolor}` auto-injected into preambles missing it, and `CLASSIC_PREAMBLE` ships it). Driven by the `ActionsMenuPanel` color swatch + `SelectionColorPopover`. | `text-color.ts` |
| `SlashPopupExtension` | PM plugin | typing `\` in prose opens an inline popup of Virgil's `VIRGIL_COMMANDS` list (declared in `commands.ts`); arrows + Enter inserts. Suppressed inside an unmatched `{` group or up against another `\name`. State lives in module-level `slashPopupStore`. | `slash-popup.ts` |
| ~~`archiveMarker`~~ | — | **Removed in 6ad177f.** Archive cards still work via the Archive panel; the in-editor invisible-anchor node and its click bridge are gone. | — |
| `exampleBlock` / `exampleItemList` / `exampleItem` / `exampleGloss` / `alignedGlossRow` / `proseGlossRow` / `glossCell` + `ExpexNumbering` plugin | nodes | expex package: `\ex`/`\pex`/`\a`/`\xlist`/`\begingl…\endgl`/`\gla`/`\glb`/`\glft`. `exampleItemList` is a recursive wrapper — nested `\xlist` tiers reuse the same wrapper node so the marker cycle (1 → a → i → A → I) compounds with depth. `exampleBlock` content schema is `(paragraph | exampleGloss | exampleItemList | bulletList | orderedList | graphicsBlock | displayMath)*` after 9dd0992 + Feature A2 (which added `graphicsBlock | displayMath` so a dropped picture/equation can join a single example's body directly) — itemize/enumerate now interleave freely inside an example, with the parser dropping (not fallback-paragraphing) unknown block types so `\vfid{}` / `\vcid{}` markers no longer double on save → reload. | `expex.ts` |
| Standard marks | bold, italic, underline, code | `\textbf`, `\emph`, `\underline`, `\texttt` | StarterKit + custom |

Barrel export in [src/lib/tiptap/index.ts](../../src/lib/tiptap/index.ts); also re-exported from [src/lib/tiptap-extensions.ts](../../src/lib/tiptap-extensions.ts).

**Shared card-context atom sub-schema.** The inline atoms consumed inside card bodies (footnote, citation, labelRef, inlineMath) and block atoms (displayMath, graphicsBlock) are declared once in [src/lib/tiptap/borrowed-schema.ts](../../src/lib/tiptap/borrowed-schema.ts) (`buildBorrowedAtomSchema()`). Both `RichTextField` (editable card bodies) and `BorrowedMainText` (read-only borrowed prose) compose from this single source; the main editor is held to the same atom set by a contract test (`borrowed-schema.test.ts`). Before this, each surface hand-copied the extension list and could silently drift.

### Atoms are graspable (text-bound mobility)

The four canonical **Atoms** — `footnote`, `citation`, `labelRef` (`\ref`), `inlineMath` — are drag-and-droppable to a new inline cursor: the atom is its own grab handle. This realizes the Ontology's "text-bound mobility" affordance ([VIRGIL.md §Ontology](../architecture/VIRGIL.md)). SSOT is [`ATOM_REGISTRY`](../../src/lib/tiptap/atom-registry.ts) (the inline sibling of `TEXT_OBJECT_REGISTRY`); the gesture is [`InlineAtomGrab`](../../src/lib/tiptap/inline-atom-grab.ts) (a `handleDOMEvents.mousedown` plugin in `buildEditorExtensions`) → the existing drop-mode inline-cursor pipeline → [`inTextAtomGrabSpec`](../../src/components/drop-mode/specs/in-text-atom-grab.ts) (same-editor, captured source, node preserved). See `architecture.md` → Drag/drop MIME map → "Inline-Atom grab". A plain click still opens the atom's Card/popover (no-drag); no atom uses native HTML5 drag. (The id-less kinds — `\ref`, inline math — resolve via a position captured at grab, [inline-atom-source.ts](../../src/components/drop-mode/util/inline-atom-source.ts).)

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

## Link architecture

**SSOT: [src/links/link-registry.ts](../../src/links/link-registry.ts).** Types in [src/links/_shared/types.ts](../../src/links/_shared/types.ts). Resolvers/creators/deleters in [src/links/links.ts](../../src/links/links.ts).

### Three kinds

| Kind | Anchor | Marker (in text) | Multiplicity | Card kind(s) |
|---|---|---|---|---|
| `footnote` | inline atom (footnote node) | superscript number | 1:1 | footnote |
| `citation` | inline atom (citation node) | styled pill | 1:1 | citation |
| `anchor` | any TextObject (`targetKind`) — paragraph, heading, list item, example item, atom block, or linkedRange | gutter icon (+ optional text highlight for `linkedRange`) | many | note, highlight, revision, cut, archive, todo, report |

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
      textRange?: { anchorId; textSnapshot };  // present iff targetKind === "linkedRange"
    };
```

**Mode A** (legacy term) = `targetKind !== "linkedRange"`. The card is anchored to one or more TextObject nodes by uuid; no inline mark.

**Mode B** (legacy term) = `targetKind === "linkedRange"`. The card is anchored to a `linkedAnchor` mark range (Phase E now also persists this range to LaTeX via `\vlid{}` / `\vlidend{}` paired markers). The `textRange.textSnapshot` is the canonical recovery path when the mark vanishes — `reanchorByText` in [src/links/links.ts](../../src/links/links.ts) searches the doc by text content.

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

Hover and selection are unified across the three linked surfaces (text, margin icon, panel card) via a module-level `cardStore` ([src/links/_shared/anchored-card-store.ts](../../src/links/_shared/anchored-card-store.ts)) holding `{ selection: AnchoredCardRef | null, hover: AnchoredCardRef | null }`. Module scope, not React Context — selection has to be visible to EditorLayout, EditorPane (which also mounts in the Library reader), and every popped-out floating card rendered through a portal. `useSyncExternalStore` gives observability without a common ancestor. Hover any one of the three surfaces and all three light up; click a card or margin icon and selection propagates. Selection is *single*: at most one card is selected across the entire UI.

Per-card integration is one line: `const ac = useAnchoredCard({ kind, id }); return <PanelCard {...ac.props} selected={ac.selected} ... />`. The hook returns the `data-card-key`, mouse handlers, and selected/hovered booleans every anchored card needs. No per-card-kind hover handlers anywhere; adding a new anchored card kind is just `ANCHORED_CARD_KINDS` + this 3-line pattern.

- [src/links/_shared/anchored-card-store.ts](../../src/links/_shared/anchored-card-store.ts) — `cardStore` module + `useIsSelected` / `useIsHovered` / `useSelection`.
- [src/links/_shared/useAnchoredCard.ts](../../src/links/_shared/useAnchoredCard.ts) — the single hook every anchored panel card calls.
- [src/links/_shared/usePlacement.ts](../../src/links/_shared/usePlacement.ts) — card → text alignment: when `cardStore.selection` changes via a user gesture, scroll the editor so the closest anchor aligns with the selected card's vertical position. (Text/marginalia → card alignment is the inverse and still flows through `openForCard`.)
- [src/links/_shared/entity-hover.ts](../../src/links/_shared/entity-hover.ts) — `EntityKind` union (the anchored kinds `note`/`highlight`/`footnote`/`citation`/`report`/`report-request`/`example`/`todo`/`archive`/`revision-comment`/`revision-suggestion`/`cutter-comment`/`cutter-suggestion`, i.e. `ANCHORED_CARD_KINDS`) and generic resolvers (`findEntity`, `cardKeyForEntity`, `entityToAnchorId`).
- [src/links/_shared/useLinkHighlight.ts](../../src/links/_shared/useLinkHighlight.ts) — paints `data-link-highlight="hover" | "active"` on `.linked-anchor` spans (Mode B text ranges).
- [src/links/_shared/useAnchorHighlightReconciler.ts](../../src/links/_shared/useAnchorHighlightReconciler.ts) — single idempotent reconciler that paints both `data-card-hovered` and `data-card-selected` on resolved anchor elements (gutter markers) *and* on matching panel cards (via `data-card-key`) in one pass. 930b9f6 unified the two previously-separate hover/selection hooks here so the two states share lookup and never desync.
- [src/links/_shared/useLinkedAnchorReconciler.ts](../../src/links/_shared/useLinkedAnchorReconciler.ts) — thin sibling reconciler for Mode B text ranges (the `.linked-anchor` spans inside the editor).
- [src/links/_shared/useTextHoverBridge.ts](../../src/links/_shared/useTextHoverBridge.ts) — single delegated `mouseover`/`mouseout`/`click` listener on `editor.view.dom`. Resolves linkedAnchor spans, citation atoms (`[data-citation-id]`), footnote atoms (`[data-footnote-id]`); on Mode B click, dispatches `virgil-linked-anchor-click` for the bridge in `event-bridges/marker-clicks.ts` to route via `openForCard`.
- [src/links/_shared/usePanelCardHoverBridge.ts](../../src/links/_shared/usePanelCardHoverBridge.ts) — single document-level listener that reads `data-card-key` to translate panel card hovers into entity hovers.

Margin markers carry no hover props — each marker self-subscribes to the `cardStore` (`useIsHovered` in `Marginalia.tsx`, painted as `data-card-hovered`) using its `entityKind` + `entityId`, so there's no prop threading from a parent loop. The marker rows themselves are built in `EditorPane.tsx`'s `marginaliaMarkers` useMemo — the live gutter-marker builder, gated on the `useStructuralRevisions` counters (`rev.anchors` / `rev.blocks`), never a raw update counter (keystroke sanctity).

## Drop mode

Shift-grabbing a popped float's grab bar puts the app into **drop mode** — the source float dims and goes click-through, and a visual indicator (paragraph-side / between-blocks / inline-cursor bar) tracks the cursor over valid placements. Releasing drops the payload back into the editor; releasing outside any target cancels.

- Entry: `beginDropSession({ cardKey })` in [src/components/drop-mode/controller.ts](../../src/components/drop-mode/controller.ts) — called by `FloatingPanel`'s shift-drag and by `StackThumbnail` (with cardKey `stack-pull:<id>`).
- Provider: [src/components/drop-mode/DropModeProvider.tsx](../../src/components/drop-mode/DropModeProvider.tsx). Indicator: [Indicator.tsx](../../src/components/drop-mode/Indicator.tsx). Hit-testing: [hit-test.ts](../../src/components/drop-mode/hit-test.ts).
- Per-payload behavior is a `DropSpec` keyed by card-key prefix in [registry.ts](../../src/components/drop-mode/registry.ts). The block-source specs collapsed into one [specs/textobject.ts](../../src/components/drop-mode/specs/textobject.ts) (D5+D6) — it parses the `textobject:<kind>:<id>` cardKey, walks the doc for source + parent, classifies the target context (top-level / inside-compatible / inside-incompatible), and routes through `meta.dropAdapter` (wrap vs drop-direct) and `meta.collectMoveSource` (single node vs section range). Adding a new TextObject kind = one registry entry; no edit to the spec. Other specs in [specs/](../../src/components/drop-mode/specs/) (`stack-pull`) carry different payloads. Each panel that participates also re-exports its spec via a panel-local `drop-spec.ts` (Archive, Citations, Cutter, Examples, Footnotes, Notes, Reports, Revisions, Todo).
- CSS for the placement bars lives in [src/app/globals.css](../../src/app/globals.css) (`.dropmode-bar-*`).

## Marginalia

**[src/components/Marginalia.tsx](../../src/components/Marginalia.tsx)** renders the gutters (left and right of the editor). Metadata + types live in [src/lib/marginalia.ts](../../src/lib/marginalia.ts); grid-layout math in [src/lib/marginalia-grid.ts](../../src/lib/marginalia-grid.ts).

- **Columns per side**: 2 (`MARGINALIA_COLS`)
- **Icon size**: 22px squares with 2px row gap
- **Positioning**: line-aligned per paragraph; scroll-synced via `useSyncExternalStore`
- **Drag**: MIME `MIME_MARGINALIA_MOVE` to re-anchor a marker

### Marker types (`MARKER_META`)

`note`, `archive`, `revision`, `cut`, `todo`, `report`, `error`. Each has a color palette (primary, background, border) customizable per-panel via the header color picker (`deriveCardPalette` in [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts)). Note that **Highlight cards do not appear in the marginalia** — they're a pure text-tint feature (`tintColor` attr on the `linkedAnchor` mark), so there is no `highlight` MarkerType.

### Per-paragraph MIME drop types

`MIME_REPORT`, `MIME_NOTE`, `MIME_TODO`, `MIME_ARCHIVE_ANCHOR`, `MIME_CUT`, `MIME_SELECTION_ANCHOR` — see [src/lib/marginalia.ts](../../src/lib/marginalia.ts) for the full list and which are `ANCHOR_DRAG_TYPES` (trigger the vertical drop indicator).

### Adding a new marginalia type

From the header comment in `src/lib/marginalia.ts`:
1. Add MIME constant; include in appropriate drag category.
2. Add the token to `MarkerType` (`src/cards/types.ts`), declare it on the owning card kind(s) in `CARD_REGISTRY` (`markerType` field), and add a presentation row to `MARKER_META` (label / defaultSide / icon — panel + accent derive from the registry via `src/cards/marker-meta.ts`).
3. Add drop handler in `Editor.tsx`'s `handleDrop` chain.
4. Wire event listener and marker generation in `EditorPane.tsx` (the live gutter-marker builder).

## Citations & bibliography

- Citation commands (natbib + biblatex families, `~20+` commands) declared in [src/lib/cite-commands.ts](../../src/lib/cite-commands.ts).
- `.bib` parsed via citation-js in [src/lib/bib-parser.ts](../../src/lib/bib-parser.ts).
- Bibliography search/filter in [src/lib/bib-search.ts](../../src/lib/bib-search.ts).
- Insert-citation UI in [src/components/CitationBuilder.tsx](../../src/components/CitationBuilder.tsx).
- Bibliography panel shows only `.bib` entries actually referenced in the document, formatted per CSL style.

## Split-screen editing

Two editor columns rendered from the **same** Tiptap document state — edits in one appear in the other. Panel visibility per side is tracked separately. See [src/components/editor-layout/split-editor-panes.tsx](../../src/components/editor-layout/split-editor-panes.tsx).

## Section folding

Collapsible sections (hides everything under a heading until next sibling heading). See [src/lib/section-folding.ts](../../src/lib/section-folding.ts).
