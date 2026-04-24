<!-- last-verified: 3de2062 2026-04-23 -->

# Glossary

Fast lookup from the user's vocabulary → code names + file paths. When the user uses a term you can't resolve, search here first before exploring the codebase.

If a user term isn't yet in this file, add it under **Pending terminology** at the bottom with a best-guess referent and today's date. The cleanup skill consolidates these on the next merge cycle.

---

## Structural UI

| User term | Code name(s) | Where |
|---|---|---|
| **Virgil bar** / **main toolbar** / **floating toolbar** | `MenuBar` (code name is misleading — it's the floating top toolbar) | [src/components/MenuBar.tsx](../../src/components/MenuBar.tsx) (default export); mounted via portal in [src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx) around line 4561. Docks "home" in the Virgil top bar by default; tears off to free-floating when dragged out (persisted as `prefs.menuLocation`) |
| **Menu toolbar** | Same as Virgil bar above | Same |
| **Left tool strip** / **left icon strip** / **sidebar navigation** (left) | Inline `<div data-strip-side="left">` — no dedicated component | `EditorLayout.tsx:4478` |
| **Right tool strip** / **right icon strip** / **sidebar navigation** (right) | Inline `<div data-strip-side="right">` | `EditorLayout.tsx:4797` |
| **Panel button** / **strip button** (individual icon in a strip) | `StripButton` | [src/components/editor-layout/drag-drop.tsx](../../src/components/editor-layout/drag-drop.tsx) |
| **Panel column** / **sidebar column** (the resizable column on either side) | `PanelColumn` | [src/components/editor-layout/panel-column.tsx](../../src/components/editor-layout/panel-column.tsx) |
| **Navigation strip** | No dedicated component — paragraph-nav chevrons live inside `MenuBar` | `MenuBar.tsx` around line 1205 |

## Toolbars inside the Virgil bar

| User term | Code name(s) | Where |
|---|---|---|
| **Formatting toolbar** / **format popup** | `AttachedPopover` anchored to A-glyph (no dedicated component) | `MenuBar.tsx` ~line 1058 |
| **Action toolbar** / **actions popup** (attached to Virgil bar) | `ActionButtonsRow` rendered inside an `AttachedPopover` anchored to 8-ray star | `ActionButtonsRow` at `MenuBar.tsx:484` |
| **Detached actions toolbar** (torn off and floating) | `DetachedActionsToolbar` — multi-instance; each tear-off spawns a new copy stored in `detachedActions[]` with its own id | `MenuBar.tsx:538`; mounted via portal in `EditorLayout.tsx` ~line 4613 |
| **Margin action toolbar** (per-column, shown when Omni-view is docked in a side) | `MarginActionToolbar` — rendered as `topOverlay` on `PanelColumn` | [src/components/MarginActionToolbar.tsx](../../src/components/MarginActionToolbar.tsx) |
| **View menu** / **three-dot menu** (on Virgil bar) | `ViewMenu` | `MenuBar.tsx:735` |
| **Block-type dropdown** (body/chapter/section/subsection) | `BlockTypeDropdown` | `MenuBar.tsx:176` |
| **Back / forward buttons** (paragraph nav) | Chevron pair, inline in MenuBar | `MenuBar.tsx` ~line 1205 |
| **Split screen toggle** | Inline button in MenuBar | `MenuBar.tsx` |
| **Close all panels** (X button) | Inline button in MenuBar | `MenuBar.tsx` |
| **Grab handle** (pill on Virgil bar for dragging) | `PodGrabHandle` | `MenuBar.tsx:371` |
| **Rotation knob** (toggles horizontal/vertical) | Inline SVG on the pod corner | `MenuBar.tsx` |
| **Dock-up button** (re-pins a dragged-out Virgil bar back to its home) | Inline button in MenuBar, rendered only when `!atHome` | `MenuBar.tsx` |

## Panels (what "panel" means)

All panels declared in [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) (`PANEL_REGISTRY` is SSOT). 11 card panels, 5 non-card panels.

### Card panels (have cards anchored in the document)

| Panel kind | Label | Card kind | Default strip | Theme |
|---|---|---|---|---|
| `notes` | Notes | `note` | right | emerald |
| `footnotes` | Footnotes | `footnote` | left | red |
| `citations` | Citations | `citation` | left | warm yellow |
| `bibliography` | Bibliography | `bib` | left | warm tan |
| `quotations` | Quotations | `quotation` | left | (default) |
| `examples` | Examples | `example` | left | (default) |
| `todo` | Todo List | `todo` | right | stone |
| `archive` | Archived Text | `archive` | right | amber/blue-grey |
| `revisions` | Revisions | `comment` (key prefix `revision`) | right | stone |
| `cutter` | Cutter | `cut` | right | red |
| `errors` | Errors | `error` | right | light red |

### Non-card panels

| Panel kind | Label | Default strip | Purpose |
|---|---|---|---|
| `outline` | Outline | left | Heading tree with edit/focus/lock |
| `search` | Search | left | Full-text search |
| `wordcount` | Word Count | right | Live word counts by section |
| `suggestions` | Suggestions | — | AI line-edit cards; not normally strip-mounted |
| `omni` | Omni-view | — | Two-column view aggregating all omni-eligible panels |

Each panel lives in `src/panels/<PanelFolder>/`.

## Main text elements

| User term | Code name(s) | Where |
|---|---|---|
| **Main text** | The TipTap editor document | [src/components/Editor.tsx](../../src/components/Editor.tsx) |
| **Heading** | TipTap `heading` node (levels 1–4 = Chapter/Section/Subsection/Subsubsection) | TipTap schema; block-type dropdown at `MenuBar.tsx:176` |
| **Paragraph** | TipTap `paragraph` node (carries `uuid` attr) | See `main-text.md` |
| **Paragraph title** | Stored in `virgil.json` sidecar (`ParagraphMeta.title`), **not** a Tiptap attr | Loaded in [src/hooks/useDocument.ts](../../src/hooks/useDocument.ts); shown in Omni view + search breadcrumbs |
| **Marginalia** | Gutter icons in left/right margin of main text, anchored to paragraphs | [src/components/Marginalia.tsx](../../src/components/Marginalia.tsx); metadata in [src/lib/marginalia.ts](../../src/lib/marginalia.ts); grid math in [src/lib/marginalia-grid.ts](../../src/lib/marginalia-grid.ts) |
| **Linked text** | Text carrying a `linkedAnchor` mark (Mode B) — connects to a card | [src/lib/tiptap/linked-anchor.ts](../../src/lib/tiptap/linked-anchor.ts) |
| **Footnote** (in text) | TipTap atom node `footnote` | [src/lib/tiptap/footnote.ts](../../src/lib/tiptap/footnote.ts) |
| **Citation** (in text) | TipTap atom node `citation` | [src/lib/tiptap/citation.ts](../../src/lib/tiptap/citation.ts) |
| **Inline math** | TipTap atom node `inlineMath` (`$…$`) | [src/lib/tiptap/math.ts](../../src/lib/tiptap/math.ts) |
| **Display math** | TipTap atom node `displayMath` (`$$…$$`) | Same file |
| **LaTeX comment** | TipTap node `latexComment` (`%…`) | [src/lib/tiptap/latex-comment.ts](../../src/lib/tiptap/latex-comment.ts) |
| **Label** | TipTap mark `label` (`\label{ref}`); `LabelRef` node for `\ref{}` / `\getref{}` / `\getfullref{}` with `refCommand` + `targetKind` attrs | [src/lib/tiptap/label.ts](../../src/lib/tiptap/label.ts) |
| **Title field** | TipTap node `titleField` for hoisted `\title{}`, `\author{}`, `\date{}` from preamble | [src/lib/tiptap/title.ts](../../src/lib/tiptap/title.ts) |
| **Example block** (expex `\ex`/`\pex`) | TipTap node `exampleBlock`; sub-items are `exampleItem`; glosses nest as `exampleGloss` → `alignedGlossRow`/`proseGlossRow` → `glossCell` | [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts) |

## Cards

| User term | Code name(s) | Where |
|---|---|---|
| **Card** | `PanelCard` (universal wrapper) or `EditableCard` (rich-text variant) | [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) |
| **Card theme** | `CARD_THEMES` dict (11 themes: footnote, note, archive, todo, bib, citation, comment, aiRequest, cut, error) | Same file |
| **AI request card** | `AiRequestCard` | Same file |
| **Orphaned card** (no anchor in document) | `BadgeOrphaned` + disabled `CardTargetIcon` | Same file |
| **In-text view** / **list view** (panel view modes) | `viewMode: "list" \| "in-text"` prop on `CardListPanel` | [src/panels/_shared/CardListPanel.tsx](../../src/panels/_shared/CardListPanel.tsx) |
| **Popped-out card** / **floating card** | `FloatCard` wrapping `FloatingPanel` | [src/components/FloatingCards.tsx](../../src/components/FloatingCards.tsx), [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) |
| **Floating panel** | `FloatingPanel` (portal, drag + resize) | [src/components/FloatingPanel.tsx](../../src/components/FloatingPanel.tsx) |

## General buttons

| User term | Code name(s) | Where |
|---|---|---|
| **Pop-up button** / **popout button** (toggles docked ↔ floating) | `PopoutButton` (generic), `CardPopoutButton` (card level), `PanelPopout` (panel level, context-aware) | `panel-primitives.tsx` |
| **Jump-to button** (page-with-arrow icon, jumps from card to in-text anchor) | `CardTargetIcon` / `TargetIcon` | `panel-primitives.tsx` |
| **"Can I request" button** / **request button** / **AI-request button** (8-ray star in panel headers) | `onAiRequest` callback rendered inline in `PanelHeader`; icon is the 8-ray sun-star (never a 5-point star) | `panel-primitives.tsx` (`PanelHeader`); icon spec in [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) |
| **Add button** (+ in panel header) | `onAdd` callback rendered inline in `PanelHeader` | `panel-primitives.tsx` |
| **Delete / trash button** (bottom-right of card, hover-reveal) | `CardTrashButton` | `panel-primitives.tsx` |
| **Menu delete item** (in three-dot menu) | `MenuDelete` | `panel-primitives.tsx` |
| **Three-dot menu** | `ItemMenu` | `panel-primitives.tsx` |
| **Grab handle** (6-dot grip on card header) | Inline SVG, appears when `grabHandle` prop is true | `panel-primitives.tsx` (`EditableCard` header) |
| **Text drag handle** (3-line icon on card body) | Inline SVG, appears when `onTextDragStart` prop is provided | `panel-primitives.tsx` |

## Link model

| User term | Code name(s) | Where |
|---|---|---|
| **Link** | `Link` type | [src/links/_shared/types.ts](../../src/links/_shared/types.ts) |
| **Link kind** | `LinkKind = "footnote" \| "citation" \| "anchor"` | Same |
| **Anchor** (the in-text side of a link) | `LinkAnchor` | Same |
| **Mode A** | Paragraph-only anchor (no text range) | `isModeB(link) === false`; see `src/links/links.ts` |
| **Mode B** | Paragraph + text-range anchor (linkedAnchor mark) | `isModeB(link) === true` |
| **DOM contract** | `data-link-id`, `data-link-kind`, `data-link-card` attrs on in-editor markers; `data-link-card` on cards | [src/links/link-registry.ts](../../src/links/link-registry.ts) |
| **Label candidate list** (ref popover) | `LabelInfo { label, kind, typeLabel, title }`; `kind ∈ {heading, equation, figure, table, label, example}` | [src/lib/labels.ts](../../src/lib/labels.ts) + [src/components/LabelRefPopover.tsx](../../src/components/LabelRefPopover.tsx) |

## Persistence & sidecars

| User term | Code name(s) | Where |
|---|---|---|
| **Sidecar** | JSON file alongside `.tex` in `virgil/` folder | Types in [src/lib/types.ts](../../src/lib/types.ts) (`VirgilSidecar`) |
| **Suggestions** | AI line-edit proposals | `suggestions.json`; [src/hooks/useSuggestions.ts](../../src/hooks/useSuggestions.ts) |
| **Revisions** (threads) | AI/user comment threads, anchored or paper-wide | `revisions.json`; [src/hooks/useRevisions.ts](../../src/hooks/useRevisions.ts) |
| **AI requests** | Queued requests for an agent to resolve | `ai-requests.json` |
| **Bib review requests** | Per-entry bibliography field/notes reviews | `bib-review-requests.json` |
| **FSA** (File System Access API) | Disk boundary — only place disk is touched | [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts) |

## System dialogs

| User term | Code name(s) | Where |
|---|---|---|
| **System dialog** (reusable modal primitive) | `SystemDialog` | [src/components/system-dialog.tsx](../../src/components/system-dialog.tsx) |
| **System dialog host** (top-level mount point) | `SystemDialogHost` | [src/components/system-dialog-host.tsx](../../src/components/system-dialog-host.tsx) |
| **Confirm dialog** | `ConfirmDialog` — thin wrapper over `SystemDialog` | [src/components/ConfirmDialog.tsx](../../src/components/ConfirmDialog.tsx) |
| **New document modal** | `NewDocumentModal` — uses `SystemDialog` | [src/components/NewDocumentModal.tsx](../../src/components/NewDocumentModal.tsx) |
| **Tex file picker** | `TexFilePickerModal` — uses `SystemDialog` | [src/components/TexFilePickerModal.tsx](../../src/components/TexFilePickerModal.tsx) |
| **Document class mismatch dialog** | `DocumentClassMismatchDialog` — uses `SystemDialog` | [src/components/DocumentClassMismatchDialog.tsx](../../src/components/DocumentClassMismatchDialog.tsx) |

## Card creation / pristine cards

| User term | Code name(s) | Where |
|---|---|---|
| **Card-creation helpers** (unified create-from-selection flow) | `cardCreation` context with `.createNote`, `.createCut`, `.createTodo`, `.createFootnote`, `.createCitation`, `.createQuotation` | [src/components/editor-layout/contexts/card-creation.tsx](../../src/components/editor-layout/contexts/card-creation.tsx) + [src/components/editor-layout/card-actions/card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts) |
| **Pristine card** (freshly-created, no user edits yet — auto-discarded if closed untouched) | `usePristineCardManager` + `pristine-cards` context | [src/hooks/usePristineCardManager.ts](../../src/hooks/usePristineCardManager.ts) + [src/components/editor-layout/contexts/pristine-cards.tsx](../../src/components/editor-layout/contexts/pristine-cards.tsx) |

## Name mismatches to keep in mind

- **"Virgil bar"** (user) = **`MenuBar`** (code). Code name is historical and misleading; don't confuse it with the three-dot View menu.
- **"Navigation strip"** (user) — no single component. Paragraph-nav chevrons are inline in `MenuBar`. Panel navigation (what's open) is split between left/right strips plus the Outline panel.
- **"Action toolbar"** (user) — three different shapes depending on state: attached popover (inside MenuBar), `ActionButtonsRow` (the buttons themselves), and `DetachedActionsToolbar` (when torn off — **multiple can coexist** after successive tear-offs).
- **"Formatting toolbar"** (user) — not a dedicated component, just an `AttachedPopover` with inline buttons.

## Pending terminology

_(Empty. Add entries here when the user uses a term not yet in the glossary.)_
