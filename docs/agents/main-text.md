<!-- last-verified: a293e60 2026-05-07 -->

# Main Text: Editor, Content Model, Links, Marginalia

The main text is a TipTap/ProseMirror editor rendering LaTeX source meaningfully while preserving the raw LaTeX underneath.

## Editor

**[src/components/Editor.tsx](../../src/components/Editor.tsx)** (~3257 lines) wraps TipTap's `useEditor`. It registers all custom extensions, keyboard shortcuts, selection handling, custom plugins, and wires up `onUpdate` → parent.

After Path A 7.8, the Library Reader mounts the canonical `<EditorPane>` (which wraps `Editor.tsx`), so there is no longer a parallel `library/tiptap/` extension set. PgMarkChip — the only Library-only extension — has been folded into the unified set at [src/lib/tiptap/pgmark.ts](../../src/lib/tiptap/pgmark.ts); it's harmless on docs without `\pgmark{N}`.

Key props: `initialContent: JSONContent`, `onUpdate: (doc) => void`, `highlightText`, `highlightRange` (position-based highlight takes priority over text).

## Block nodes

All carry a `uuid` attr so they can serve as marginalia anchors. `uuid` detection uses `isAnchorableNode()` in [src/lib/marginalia.ts](../../src/lib/marginalia.ts).

| Node | LaTeX | Notes |
|---|---|---|
| `paragraph` | (plain) | Baseline text container |
| `heading` | `\chapter` / `\section` / `\subsection` / `\subsubsection` | Levels 1–4; supports `label` mark (`\label{}`) |
| `bulletList` / `orderedList` | `\itemize` / `\enumerate` | Nested; optional `listPreamble` |
| `blockquote` | `\begin{quote}…\end{quote}` | |
| `codeBlock` | `\begin{verbatim}…\end{verbatim}` | |
| `displayMath` | `$$…$$` | Atom node |
| `titleField` | hoisted `\title{}` / `\author{}` / `\date{}` | Has `fromPreamble` flag |
| `maketitleMarker` | `\maketitle` | |
| `latexComment` | `%…` | Atom node |

**Paragraph titles are NOT a Tiptap attr.** They're stored in the `virgil.json` sidecar (`ParagraphMeta.title`), loaded in [src/hooks/useDocument.ts](../../src/hooks/useDocument.ts) as `paragraphTitles: Map<uuid, string>`. They appear in Omni view and search breadcrumbs — not inline in the editor.

## Inline atoms and marks

TipTap extensions in [src/lib/tiptap/](../../src/lib/tiptap/):

| Name | Kind | LaTeX | File |
|---|---|---|---|
| `footnote` | atom node | `\footnote{…}` | `footnote.ts` |
| `citation` | atom node | `\citep{…}` etc. | `citation.ts` |
| `inlineMath` | atom node | `$…$` | `math.ts` |
| `displayMath` | atom node | `$$…$$` | `math.ts` |
| `latexComment` | node | `%…` | `latex-comment.ts` |
| `label` | mark | `\label{ref}` | `label.ts` |
| `labelRef` | node | `\ref{…}` / `\getref{…}` / `\getfullref{…}` (attr `refCommand` selects command; `targetKind` tags heading vs example) | `label.ts` |
| `linkedAnchor` | mark | (invisible) | `linked-anchor.ts` |
| `latexCommandMark` | mark | raw LaTeX in text | `latex-command.ts` |
| `archiveMarker` | node | invisible anchor for archive links | `archive-marker.ts` |
| `aiRequest` | node | invisible marker | `ai-request.ts` |
| `exampleBlock` / `exampleItemList` / `exampleItem` / `exampleGloss` / `alignedGlossRow` / `proseGlossRow` / `glossCell` + `ExpexNumbering` plugin | nodes | expex package: `\ex`/`\pex`/`\a`/`\xlist`/`\begingl…\endgl`/`\gla`/`\glb`/`\glft`. `exampleItemList` is a recursive wrapper — nested `\xlist` tiers reuse the same wrapper node so the marker cycle (1 → a → i → A → I) compounds with depth. | `expex.ts` |
| Standard marks | bold, italic, underline, code | `\textbf`, `\emph`, `\underline`, `\texttt` | StarterKit + custom |

Barrel export in [src/lib/tiptap/index.ts](../../src/lib/tiptap/index.ts); also re-exported from [src/lib/tiptap-extensions.ts](../../src/lib/tiptap-extensions.ts).

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
| `anchor` | paragraph UUID **or** text range (linkedAnchor mark) | gutter icon (+ optional text highlight) | many | note, revision, cut, archive, todo, quotation |

### Mode A vs Mode B (anchor kind only)

- **Mode A** — paragraph-only. Card stores only `paragraphIds`; no inline mark in editor.
- **Mode B** — paragraph + text range. Card stores `anchor.textRange` with `anchorId` (the `linkedAnchor` mark id) and `textSnapshot`; editor has the `linkedAnchor` mark on the range.

Derivation helper: `isModeB(link)` in `src/links/links.ts`.

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

Hover and selection are unified across the three linked surfaces (text, margin icon, panel card) via a single `(hoveredEntityId, hoveredEntityKind)` state pair in `EditorLayout.tsx`. Hover any one and all three light up; click a card or margin icon and selection propagates. No per-card-kind hover handlers anywhere.

- [src/links/_shared/entity-hover.ts](../../src/links/_shared/entity-hover.ts) — `EntityKind` union (`note`/`cut`/`revision`/`todo`/`archive`/`quotation`/`footnote`/`citation`) and generic resolvers (`findEntity`, `cardKeyForEntity`, `entityToAnchorId`).
- [src/links/_shared/useLinkHighlight.ts](../../src/links/_shared/useLinkHighlight.ts) — paints `data-link-highlight="hover" | "active"` on `.linked-anchor` spans (Mode B text ranges).
- [src/links/_shared/useCardHoverHighlight.ts](../../src/links/_shared/useCardHoverHighlight.ts) — paints `data-card-hovered` on resolved anchor elements *and* on matching panel cards (via `data-card-key`).
- [src/links/_shared/useCardSelectionHighlight.ts](../../src/links/_shared/useCardSelectionHighlight.ts) — selection counterpart, paints `data-card-selected`.
- [src/links/_shared/useTextHoverBridge.ts](../../src/links/_shared/useTextHoverBridge.ts) — single delegated `mouseover`/`mouseout`/`click` listener on `editor.view.dom`. Resolves linkedAnchor spans, citation atoms (`[data-citation-id]`), footnote atoms (`[data-footnote-id]`); on Mode B click, dispatches `virgil-linked-anchor-click` for the bridge in `event-bridges/marker-clicks.ts` to route via `openForCard`.
- [src/links/_shared/usePanelCardHoverBridge.ts](../../src/links/_shared/usePanelCardHoverBridge.ts) — single document-level listener that reads `data-card-key` to translate panel card hovers into entity hovers.

Margin markers carry a generic `hovered` prop (boxShadow ring) and `onHover` callback applied uniformly across every kind in `EditorLayout.tsx`'s `marginaliaMarkers` useMemo.

## Marginalia

**[src/components/Marginalia.tsx](../../src/components/Marginalia.tsx)** renders the gutters (left and right of the editor). Metadata + types live in [src/lib/marginalia.ts](../../src/lib/marginalia.ts); grid-layout math in [src/lib/marginalia-grid.ts](../../src/lib/marginalia-grid.ts).

- **Columns per side**: 2 (`MARGINALIA_COLS`)
- **Icon size**: 22px squares with 2px row gap
- **Positioning**: line-aligned per paragraph; scroll-synced via `useSyncExternalStore`
- **Drag**: MIME `MIME_MARGINALIA_MOVE` to re-anchor a marker

### Marker types (`MARKER_META`)

`quote`, `note`, `archive`, `revision`, `cut`, `todo`. Each has a color palette (primary, background, border) customizable per-panel via the header color picker (`deriveCardPalette` in [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts)).

### Per-paragraph MIME drop types

`MIME_QUOTATION`, `MIME_NOTE`, `MIME_TODO`, `MIME_ARCHIVE_ANCHOR`, `MIME_CUT`, `MIME_SELECTION_ANCHOR` — see [src/lib/marginalia.ts](../../src/lib/marginalia.ts) for the full list and which are `ANCHOR_DRAG_TYPES` (trigger the vertical drop indicator).

### Adding a new marginalia type

From the header comment in `src/lib/marginalia.ts`:
1. Add MIME constant; include in appropriate drag category.
2. Add entry to `MarkerType` and `MARKER_META`.
3. Add drop handler in `Editor.tsx`'s `handleDrop` chain.
4. Wire event listener and marker generation in `EditorLayout.tsx`.

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
