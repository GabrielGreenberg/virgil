<!-- last-verified: 3a54711 2026-06-08 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#sidecar-and-panel-inventory -->
<!-- covers-code: src/hooks, src/lib/storage-fsa.ts, src/lib/types.ts, src/panels/panel-registry.ts, src/links/link-registry.ts, src/text-objects/text-object-registry.ts, src/lib/marginalia.ts -->

# Architecture: Registries, Hooks, Persistence, Sidecars

Cross-cutting systems that most features touch.

## Single sources of truth (SSOTs)

| Concern | SSOT | Notes |
|---|---|---|
| Panel taxonomy | [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) (`PANEL_REGISTRY`) | Display labels, omni eligibility, default strip side. Card-kind satellite tables (`CARD_KEY_PREFIXES` / `CARD_TYPE_LABELS` / `CARD_TITLE_LABELS`) are now *derived* from `CARD_REGISTRY`; `getPanelByCardKind` derives from `CardMeta.panel` (the hand-kept `POLYMORPHIC_CARD_PANEL` was retired in 27458d8) |
| Card kinds | [src/cards/card-registry.tsx](../../src/cards/card-registry.tsx) (`CARD_REGISTRY: Record<CardKind, CardMeta>`) | Card-system SSOT (27458d8), mirrors `TEXT_OBJECT_REGISTRY`. Per-kind meta: label, key prefix, theme key, owning panel, origin, anchored flag, marker type, lifecycle caps, stackable, `toFloatable`. `CardKind` (16 kinds — `comment`→`revision-comment`, bare `suggestion` dropped from the spine) + derived predicates live in [src/cards/types.ts](../../src/cards/types.ts) + [src/cards/predicates.ts](../../src/cards/predicates.ts). Data layer (`RevisionCard.kind`, `revisions.json`, Python) still uses `comment`/`suggestion`, bridged at float dispatch |
| Link kinds | [src/links/link-registry.ts](../../src/links/link-registry.ts) (`LINK_REGISTRY`) | Multiplicity, connector style, highlight behavior per link kind |
| TextObject kinds | [src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts) (`TEXT_OBJECT_REGISTRY`) | Closed kind union (paragraph, heading, list, list item, example item, atom blocks, linkedRange — 16 kinds total); per-kind meta drives grab-handle layout, float body component, drop adapter (wrap vs direct), move-source collector, source-marker round-trip. Adding a new TextObject kind = one entry here + `groups: "textObject"` on its node spec. See [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md) |
| Card themes | `CARD_THEMES` in [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) | footnote, note, archive, todo, bib, citation, comment, aiRequest, cut, error, report, highlight (yellow tint; defined in `panel-theme.defaults.json` under the `highlight` key, no dedicated `CARD_THEMES` entry — highlights paint via the `tintColor` mark attr, not the card-body theme) |
| Auto-title labels | `CARD_TITLE_LABELS` + `nextCardTitle(kind, count)` in [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) | Per-CardKind label string (or `null` to opt out — comments / suggestions / citations / ai / bib / error don't auto-title). Used at card creation: `nextCardTitle("note", existingCount)` → `"Note 4"` |
| Design tokens | [src/app/globals.css](../../src/app/globals.css) + [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) | Semantic CSS variables (`--surface`, `--ink-body`, `--accent`, etc.) |
| Type definitions | [src/lib/types.ts](../../src/lib/types.ts) | `VirgilSidecar`, `EditorStateData`, `Suggestion`, `ReviewRequest`, `Link`, etc. |

Before adding a new panel, link kind, or theme, extend the registry instead of creating a parallel table.

## Key hooks

All in `src/hooks/`. Full list (~50 files) is large; these are the ones most often touched:

| Hook | What it owns |
|---|---|
| `useDocument` | Main doc state + autosave queue; `paragraphUuids`, `paragraphTitles` maps |
| `useCitations` | Citation refs + `.bib` loading |
| `useFootnotes` | Footnote persistence + numbering |
| `useRevisions` | Revision/comment threads |
| `useSuggestions` | AI line-edit suggestion state |
| `useArchive` | Archived snippets |
| `useTodos` | Todo items |
| `useReports` | Reports (report + report-request cards) |
| `useExamples` | Expex example blocks (harvests `exampleBlock` nodes from editor doc) |
| `useCutter` | Cut items |
| `useWordCount` | Live word counts by section |
| `usePoppedCards` | Floating card registry (reads `prefs.poppedOutCards`) |
| `useLinkHighlight` / `useAnchorHighlightReconciler` / `useLinkedAnchorReconciler` | Three-surface hover/selection coupling (text, margin icon, panel card). 930b9f6 collapsed the previous `useCardHoverHighlight` + `useCardSelectionHighlight` pair into one idempotent reconciler (`useAnchorHighlightReconciler`) that paints both `data-card-hovered` and `data-card-selected` in a single pass. Mode B `.linked-anchor` spans get their own thin reconciler (`useLinkedAnchorReconciler`). All in `src/links/_shared/`; see `main-text.md` → Highlight coupling for the full set including the `useTextHoverBridge` + `usePanelCardHoverBridge` event listeners and the module-level `cardStore` |
| `useViewPrefs` | Panel visibility, layout state, placements, and (since b706812) the per-view editor-decoration prefs that previously lived as EditorLayout local state — marginalia visibility (`showMarginalia`, `hiddenMarginaliaTypes`), section indicator / heading labels, divider levels + width, omni-view categories + per-side hide-all, four-sided editor margins (`editorLeftMargin` / `editorRightMargin` / `editorTopMargin` / `editorBottomMargin`; top/bottom added in d211464 so the page padding is fully four-sided). Sourced via the centralized [src/lib/dev-prefs-registry.ts](../../src/lib/dev-prefs-registry.ts) (single source consumed by both the cross-window mirror and the personal-prefs promotion script) |
| `useMarginEdit` | Margin edit-mode state machine (d211464). Keyed on `Margins = Record<MarginSide, number>` with axis-lookup tables (`MARGIN_AXIS`, `MARGIN_OPPOSITE`, `MARGIN_MIN`, `MARGIN_CSS_VAR`) so one drag handler covers all four sides; adding a fifth side is one table-entry addition. Drives the four guide lines + glowing-blue Save/Cancel pill (see `ui-chrome.md` → Reading frame & margins) |
| `useFloatingMenuPosition` | Shared viewport-clamping placement helper (f7461e2). Action menu / Highlights submenu / DragHandleMenu route through it so popovers never bleed off-screen. RAF-batched + recomputed on scroll/resize |
| `usePersistentState` | IndexedDB persistence abstraction. `update()` debounces `persist()` ~300ms (2dc963d) with flush-on-unmount + flush-on-docId-change so safety isn't traded for the keystroke-cascade savings |
| `useInTextPositions` | Omni-view positioning |
| `usePristineCardManager` | Tracks freshly-created cards so they auto-discard if closed without edits; exposed via the `pristine-cards` context |
| `useDocumentStyle` | Per-document preamble preset. Reads/writes the style id to the doc settings sidecar and rewrites the preamble in place when the user picks a new style |
| `useStyleLibrary` | User-curated style entries shown in `ManageStylesModal` (apply / edit / duplicate / delete / save current preamble as a new entry) |
| `useZenMode` | Zen-mode pref + chrome-hide orchestration. Hides Virgil bar / strips / panels and extends the editor to window edges; restores on exit |
| `useHelperMode` | Helper-mode toggle — sets `data-helper-mode="on"` on `<body>`, enabling CSS hover callouts on all `[data-helper]` elements |
| `useCollab` | Turn-taking collaboration state machine: pen ownership, heartbeat, polling of `collab.json` sidecar, per-card focus claims, cursor-paragraph presence broadcast |
| `useRecentlyAddedTracker` | One-slot-per-kind tracker for just-created cards so panels can sort them to the top; auto-cleared when selection moves away |
| `useLatexCompile` | SwiftLaTeX pdfTeX compile + parsed-error extraction. On success, persists the resulting PDF next to the `.tex` (`pdfFilenameFromTex`) so the in-app PDF view (`library/components/PdfView.tsx`) can re-render without recompiling |
| `useDocNotificationStream` | Polls `<doc>/virgil/notifications.json` for completion entries written by editor-side skills; returns items appended since the doc-keyed last-seen timestamp in localStorage, for the consumer to toast |
| `useMyPapers` | Global "My Papers" list shown in the Library's My Papers pod (IndexedDB single shared record + BroadcastChannel sync). Decoupled from open document tabs: opening a doc anywhere never auto-adds, and removing a row never closes a tab |
| `useStack` | Cross-doc visual clipboard at the editor's bottom-left. Versioned envelope in localStorage (`virgil-stack-v1`), 200-item FIFO cap, cross-tab sync via the `storage` event. See `ui-chrome.md` → Stack |
| `useScrollActivityTracker` | Auto-hide scrollbars: paints `data-scroll-active` on the container while the user is actively scrolling/hovering, fades when idle |
| `useUpdateAvailable` | Service-worker update polling; exposes a "new version available" flag that drives the in-app refresh banner (per-folder skill sync) |
| `useAutoAddLibraryEntriesForCitations` | Watches new citation keys in the doc and auto-adds matching entries from the user's Virgil Library into the paper's bibliography (after the bibliography-search redesign in 91f253c / 240bfda) |
| `useEditorUIState` | Per-doc UI state hook factored out of EditorPane — tracks click-time selection / focus-mode / hover state etc. that several sibling hooks consume |
| `useResolvedFigureUrl` | Resolves a figure block's `source` to a renderable blob URL: looks up the cached raster by source fingerprint, rasterizes the source on miss (PDF → webp via `pdfjs-dist`; PNG/JPEG pass-through), and manages the blob-URL lifecycle |
| `useEditorViewportCache` | Module-level cache of per-viewport editor metrics (`editorRight`, `scrollTop`, etc.) so `SelectionActionsMenu` and `SelectionDragHandle` can place themselves without re-reading layout on every keystroke |

## Editor hot-path conventions (2dc963d)

Per-keystroke perf regressions chase one anti-pattern: a synchronous TipTap subscriber that does a doc traversal / LaTeX serialization / forced layout read / IndexedDB write / wide-tree React setter. The 2dc963d refactor codifies the shape of a well-behaved hot-path subscriber:

- **Subscribe to `update`, not `transaction`/`selectionUpdate`**, and gate on `tr.docChanged` so mark-only / selection-only transactions don't trigger a layout-reading recompute (see `TextObjectGrabHandle`). (The EditorLayout focus-mode logic switched back to a single injected `<style>` tag in 91ce009 — PM doesn't touch `<style>` elements so the rules survive transactions without needing a per-tx stamp pass.)
- **RAF-batch any compute that reads layout** (`useMarginalia.compute()`, `Marginalia` host-detection notify, `SelectionDragHandle` placement, `ActionsStripButton` tick, `EditorMirror.updateState()`).
- **Debounce React state setters** that fan out via useMemos (`docVersion` in EditorPane and `editorDocVersion` in EditorLayout both ~100ms; `usePersistentState.update()` ~300ms with flush-on-unmount/docId-change).
- **WeakMap-memoize per-node serialization** keyed on the immutable PM node (`getExamples()` runs once per edited example block instead of N-per-keystroke).
- **`useRef` instead of `useState`** for values that are only read on transitions (`lastEditTime` → `pdfStale`); avoids a full re-render per character.
- **Lazy hook activation**: `useLibraryMasterBib(enabled)` — pass `false` until the doc actually has unresolved citation keys; the hook stays mounted (no conditional-hook violation) but skips the citation-js parse. `catalog-store` polling is refcounted via a single shared interval, zero polling when no consumers are mounted.

## Persistence layers

### File System Access API (the disk)

**Single boundary: [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts).** Every disk read/write goes through here. If you're tempted to call `handle.getFile()` or `writable.write()` anywhere else, route it through storage-fsa instead.

Files on disk (per paper):
- `<name>.tex` — the paper (source of truth)
- `<name>.bib` (optional) — bibliography
- `virgil/` folder — sidecars (see below)
- `virgil/figures-cache/<sha>.webp` (optional) — rasterized output cached by source-content sha. PDF sources rasterize on the fly via `pdfjs-dist`; PNG / JPEG / WebP pass through unchanged. Companion `virgil/figures-cache/index.json` tracks `{sourcePath → sha}` so multiple `\includegraphics` with the same source share one raster. Surface: `readFigureSource` / `readFigureRaster` / `writeFigureRaster` / `deleteFigureRaster` / `readFigureIndex` / `writeFigureIndex` on the storage backend.

### IndexedDB

Used for: user preferences (`useViewPrefs`), tab state, folder handles, doc index. Not for paper content — that's always on disk.

### Sidecars in `virgil/`

All are JSON files. Schemas in [src/lib/types.ts](../../src/lib/types.ts).

| Sidecar | Purpose | Surfaced as |
|---|---|---|
| `virgil.json` | Per-paragraph metadata: titles, fingerprints | Omni view, search breadcrumbs |
| `suggestions.json` | AI line-edit proposals | **Revisions panel** (suggestion cards beside comments; `y`/`n`/`s` keyboard controls); progress bar lives in the Revisions panel header |
| `revisions.json` | Comment threads (anchored or paper-wide); legacy `GeneralRevision`/`TextRevision` shapes fold forward to one `Comment` type on read | Revisions panel |
| `ai-requests.json` | Queued requests for an agent to resolve | Per-panel "ask" affordances (Footnotes, Notes, Reports, Citations, Todo). Also fed by the **AI request bridge** ([src/lib/ai-request-bridge.ts](../../src/lib/ai-request-bridge.ts)), which collapses per-card sticky `aiRequest:true` flags on notes/todos/cutter-comments/revision-comments into a single drainable queue with `linkedTo`. Editor-side skills under `editor/` (see [editor/AGENTS.md](../../editor/AGENTS.md)) drain it |
| `notifications.json` | Per-doc inbox of completion entries written by editor-side skills | [src/hooks/useDocNotificationStream.ts](../../src/hooks/useDocNotificationStream.ts) polls and toasts unseen items |
| `bib-review-requests.json` | Per-entry bibliography field/note reviews | Bibliography cards |
| `editor-state.json` | Last-edited paragraph + collapsed section folds + misc editor state. Schema moved from PM positions to paragraph UUIDs in 7d702de so structural edits between sessions don't lose the target | Restored on reopen — scrolls back to the last paragraph and reapplies folds |
| `cutter.json` | Cutter cards (comments + suggestions) and optional word-count goal | Cutter panel; [src/hooks/useCutter.ts](../../src/hooks/useCutter.ts) |
| `collab.json` | Turn-taking collab state: pen holder, heartbeat timestamps, per-user presence entries (cursor paragraph, card focus claims) | [src/hooks/useCollab.ts](../../src/hooks/useCollab.ts); types/constants in [src/lib/collab.ts](../../src/lib/collab.ts) |
| `doc-settings.json` | Per-document settings (currently: `style` id for the preamble preset) | `useDocumentStyle` reads/writes; schema in [src/lib/document-settings.ts](../../src/lib/document-settings.ts) |

Agents never touch this app — they read the same `.tex`/`.bib` and write these sidecars. Virgil polls/watches and surfaces changes.

## EditorPane vs EditorLayout

After Path A 7.8: [src/components/EditorPane.tsx](../../src/components/EditorPane.tsx) is the **canonical editor surface**. Both the main app's doc branch (via [src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx)) and the Library Reader (via [library/components/PaperRender.tsx](../../library/components/PaperRender.tsx)) mount `<EditorPane>`. EditorPane owns the per-doc hooks (`useDocument`, `useLatexCompile`, `useNotes`, `useTodos`, `useCitations`, `useCollab`, `usePristineCardManager`, …), the docked MenuBar + detached toolbars, the panel rail (icon strip + active panel column), the floating panels block, and the canonical `DockOutline` / `CardLiftOutline`.

EditorLayout shrinks to the **shell wrapper**: tab/file management (`useFiles`), `useViewPrefs` ownership (the bundle is then handed back to EditorPane via the `viewPrefs` prop), top-bar dialogs (Preferences, Fonts, Margins, NewDoc, TexFilePicker, DocumentClassMismatch), the Virgil bar (which reads per-doc state from `paneState` populated via `onPaneStateChange`), the `activePane` switch (paper / library-outer / doc routing), the PDF view branch, and Code view. The PDF branch is a sibling of the EditorPane mount in the doc-branch ternary; Code view became a draggable **split-pane alongside EditorPane** in 8b9659c ([split-with-code.tsx](../../src/components/editor-layout/split-with-code.tsx) + `CodePaneSplitContext`), with code↔TipTap sync via [code-pane-bridge.ts](../../src/lib/code-pane-bridge.ts) (TipTap canonical). The `CodeEditor` (CodeMirror) state still lives in EditorLayout.

The two bundles passed to EditorPane:
- `viewPrefs: EditorPaneViewPrefs` — dock/float-shaped state (panel placements, focus state, undock/redock, card popouts, OutlineHost wiring). Reader passes none → main-app rail behavior stays dormant.
- `menuBar: EditorPaneMenuBarBundle` — toggle state + setters, para-nav, dialog openers, detached-toolbar refs from the shell. Reader passes none → docked MenuBar + detached toolbars stay dormant.

The `chrome` prop ([src/components/editor-layout/chrome-config.ts](../../src/components/editor-layout/chrome-config.ts)) gates feature visibility per surface: main app passes `FULL_CHROME`, Reader passes `READER_CHROME` (note-only action toolbar, no formatting toolbar, no MenuBar edit items, 6-kind panel whitelist).

## Panel / card rendering

Entry points for rendering a panel instance — both inside EditorPane:

1. **Rail-mounted**: `<PaneRail side="left|right">` (consumes `chrome.visiblePanelKinds` + `viewPrefs.prefs.placements` to split kinds across sides).
2. **Floating**: panels in `viewPrefs.prefs.poppedOutPanels` plus dock-slot panels render through `<FloatingPanel>` portals to body.

Cards inside a `CardListPanel`:
1. **In list** — iterated by `renderCard(item)`.
2. **In-text** — positioned via `inTextRenderItem` (uses `useInTextPositions`).
3. **Popped out** — registered in `prefs.poppedOutCards` with key `${keyPrefix}:${id}`; the popout dispatcher [renderPoppedCard](../../src/components/editor-layout/floating-cards.tsx) maps each key to a card component, which wraps itself in `FloatCard` from [src/components/FloatingCards.tsx](../../src/components/FloatingCards.tsx) (portal to body) when its `isPoppedOut` prop is true.

The popouts mount lives inside [EditorPane.tsx](../../src/components/EditorPane.tsx) at the editor root, gated on `viewPrefs && !viewPrefs.zenMode`, with a memoized `popoutsDeps: PoppedCardDeps` bag wired from EditorPane's per-doc hooks. The Reader passes no `viewPrefs` so the mount stays dormant. Zen mode hides the floats but retains their state.

Popout key prefixes for cards (DO NOT rename without migration — they're persisted; SSOT is the `keyPrefix` field on each `CARD_REGISTRY` entry, from which `CARD_KEY_PREFIXES` is now derived):
`note`, `highlight`, `footnote`, `archive`, `todo`, `bib`, `citation`, `revision` (for `revision-comment` cards), `cutter-comment`, `cutter-suggestion`, `revision-suggestion` (keyPrefix preserved as `revision-suggestion`; the live key is `revision:s:<id>`), `report`, `report-request`, `example`, `ai`, `error`. (The bare `suggestion` prefix and the legacy `cut` prefix were retired with the spine refactor / Cutter rebuild.)

**Block popouts** also live in `prefs.poppedOutCards` but use one unified prefix shape: `textobject:<kind>:<uuid>` (or `textobject:linkedRange:<anchorId>` for mark-backed range popouts). Emitted by `textObjectPopoutKey` in [src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts); parsed by `parseTextObjectPopoutKey`. The dispatcher in [floating-cards.tsx](../../src/components/editor-layout/floating-cards.tsx) reads `meta.floatBodyComponent` from `TEXT_OBJECT_REGISTRY` and renders the body inside the unified `TextObjectFloat` chrome. Body components live in [src/text-objects/floats/](../../src/text-objects/floats/) — after the L3g–L3n chips **all 16 graspable kinds register a body** via `registerFloatBody` (from `floats/index.ts`): per-kind `ParagraphBody` / `HeadingBody` / `ListBody` (both list kinds) / `TexBlockBody` / `ExampleBlockBody` / `LinkedRangeBody` / `ListItemBody` / `ExampleItemBody` / `FigureBody` (figure + graphics), plus a shared `SingleBlockBody` for the bodyless single-block kinds (blockquote, codeBlock, displayMath, latexComment, titleField).

Legacy popout-key migration: boot-time read-side rewriter in `useViewPrefs.loadPrefs` rewrites `paragraph:` / `heading:` / `texBlock:` to the unified shape; `list:<uuid>` and the in-editor `example:<uuid>` keys go through a doc-aware post-load sweep in [src/text-objects/post-load-migrations.ts](../../src/text-objects/post-load-migrations.ts) wired from `EditorLayout.tsx`. The Examples panel-card prefix `example:<id>` (a sibling of `note:` / `todo:` / `bib:`) is stable and intentionally NOT migrated — the disambiguation is doc-aware (a uuid that resolves to an exampleBlock node is the in-editor popout; otherwise it's the panel-card prefix).

Floats spawn near their trigger element via `popCardAtAnchor` in EditorPane (which routes through `viewPrefs.toggleCardPopout` + `viewPrefs.setCardFloatPosition`); position helper at [src/components/editor-layout/spawn-position.ts](../../src/components/editor-layout/spawn-position.ts). Initial float size per kind is declared in the registry (`meta.initialFloatSize`).

**Per-panel omni-item builders.** Each omni-eligible panel owns an `omni.tsx` next to its panel folder (e.g. [src/panels/Cutter/omni.tsx](../../src/panels/Cutter/omni.tsx), [src/panels/Errors/omni.tsx](../../src/panels/Errors/omni.tsx), [src/panels/Revisions/omni.tsx](../../src/panels/Revisions/omni.tsx), and the older builders for notes/footnotes/citations/etc.) exporting a `buildXOmniItems(args): OmniItem[]` function. The orchestrator-side host [src/components/editor-layout/panels/omni-host.tsx](../../src/components/editor-layout/panels/omni-host.tsx) imports each builder and concatenates the results into the per-side omni columns. When adding a new omni-eligible panel: flip `omniEligible: true` + set `omniSide` in `panel-registry.ts`, write `<panel>/omni.tsx` exporting the builder, re-export it from `<panel>/index.ts`, and import + invoke from `omni-host.tsx`.

**Dock-drag signal.** [src/components/editor-layout/dock-drag.ts](../../src/components/editor-layout/dock-drag.ts) exposes a module-level (not React Context) `{slotKey, rect}` store via `setDockDragTarget` / `getDockDragTarget` / `useDockDragTarget`. Producer (panel shell, on mousedown) writes the captured slot rect; consumers — the body-portaled [DockOutline](../../src/components/editor-layout/DockOutline.tsx) and EditorLayout's redock-on-mouseup handler — read it. Module-level scope is required because the producer and consumers sit in different parts of the React tree.

**Jump-to alignment.** All `onJump` callbacks accept an optional `sourceEl: HTMLElement | null` argument — typically the clicked card element (use `(e.currentTarget as HTMLElement).closest('[data-card]')`). When passed, `jumpToCard` aligns the in-text marker's vertical position to the card so the page doesn't lurch.

## Panel context

`PanelChromeProvider` in `panel-primitives.tsx` injects the current panel id so context-aware buttons (`PanelPopout`, `PanelClose`) know which panel they belong to without prop drilling.

## Card creation + pristine cards

Two related abstractions, both now mounted inside EditorPane:

- **`cardCreation` context** ([contexts/card-creation.tsx](../../src/components/editor-layout/contexts/card-creation.tsx) + [card-actions/card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts)) — collapses the historical "create + select + pop-at-anchor" dance into single `cardCreation.createNote/createCut/createTodo/createFootnote/createCitation/createReport/createReportRequest` calls. Each action trigger (the gutter `SelectionActionsMenu`, the strip `ActionsStripButton`, the `DragHandleMenu`) routes through it, so creation behavior stays consistent across entry points. (The old margin `MarginActionToolbar` that also fed it was deleted in bcc583a.) The pop-at-anchor side now flows through `popCardAtAnchor` inside EditorPane (gated on `viewPrefs`).
- **`pristine-cards` context** + `usePristineCardManager` — tracks cards that were just created but never edited by the user; auto-discards them if the user closes/blurs without typing. Every card-bearing hook (`useNotes`, `useCutter`, `useTodos`, `useReports`, `useCitations`, `useFootnotes`) plugs into this. EditorPane owns the manager; EditorLayout still constructs a parallel manager because AIWindow + the click-away mutex effect read selection state on the shell side.

## System dialog primitive

[src/components/system-dialog.tsx](../../src/components/system-dialog.tsx) + [src/components/system-dialog-host.tsx](../../src/components/system-dialog-host.tsx) provide a shared modal primitive. `ConfirmDialog`, `NewDocumentModal`, `TexFilePickerModal`, and `DocumentClassMismatchDialog` are thin wrappers over it. See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for the dialog conventions.

## Unanchored-card safety (21933e0)

Anchored cards (notes, todos, cuts, archives, revisions, reports) no longer disappear silently when their host paragraph is deleted or their last anchor is dropped. Two coordinated pieces:

- **Unified delete path** — [src/cards/delete-margin-item.ts](../../src/cards/delete-margin-item.ts) (`deleteMarginItem`) is the single entry point every gutter-marker delete and panel-trash delete routes through. If the gesture removes the card's last anchor, it prompts to delete the whole card (using the existing "This item has text" confirm via `hasCardContent` in [src/cards/has-content.ts](../../src/cards/has-content.ts)); if other anchors remain, it just drops this link.
- **Paragraph-deletion guard** — `MarginaliaAnchorGuard` (TipTap extension in [src/lib/tiptap/linked-anchor.ts](../../src/lib/tiptap/linked-anchor.ts)) reads a ref of currently-anchored UUIDs from EditorPane (populated in `EditorPane.tsx` ~line 1685) and, when a transaction would delete a paragraph carrying an anchor or a `linkedAnchor` mark, re-inserts an empty placeholder at the mapped original position with the same UUID. Covers both gutter-marked paragraphs and Mode-B text-range paragraphs. Configured in `buildEditorExtensions` ([src/lib/editor-extensions.ts](../../src/lib/editor-extensions.ts) ~line 1766).

Together: only explicit user gestures (gutter delete or panel trash) destroy a card; incidental editor edits can't orphan one.

## Per-panel color overrides

Users can recolor any panel via the header color picker. The override routes through `deriveCardPalette` in [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts), which derives a full card palette (marker, badge, border, header, selected variants) from a single accent color.

## Drag / drop MIME map

Paragraph-level anchor drops trigger the vertical drop indicator. Inline-insert drops don't. Both sets live in [src/lib/marginalia.ts](../../src/lib/marginalia.ts):

- **`ANCHOR_DRAG_TYPES`** (vertical indicator): marginalia-move, note, todo, archive-anchor, cut, report.
- **Inline-insert**: citation, archive (restore), footnote, text-insert.

When wiring a new draggable type, pick a category and register it — the drop indicator behaves correctly for free.

**Text moves** are deliberately narrow. The canonical text-move gestures are:

1. **Drag-to-pop-out** — the lift gesture on any TextObject via the unified [TextObjectGrabHandle](../../src/text-objects/TextObjectGrabHandle.tsx) (the single grab-handle component for paragraph / heading / list / list item / example item / atom block / selection-as-linkedRange). Selection lifts hydrate into `linkedRange` TextObjects at lift commit via `hydrateSelectionToTextObject` ([src/text-objects/hydrate-selection.ts](../../src/text-objects/hydrate-selection.ts)). Custom mousedown protocol, NOT HTML5 drag.
2. **Drop-mode** — shift-drag on a float's header re-drops the block back into the doc at a visible placement bar. The block-source drop spec in [src/components/drop-mode/specs/textobject.ts](../../src/components/drop-mode/specs/textobject.ts) routes through `meta.dropAdapter` (wrap vs drop-direct) and `meta.collectMoveSource` (single node vs section range). A lifted `linkedRange` selection (cardKey `textobject:linkedRange:<id>`) is routed to a sibling [specs/text-range-move.ts](../../src/components/drop-mode/specs/text-range-move.ts) instead — it moves a text *slice* (not a whole node) to an inline cursor, or drops it as block content in a block gap (L3f-2). Feature A1–A3 also let block payloads drop into an expex example via a single left vertical drop-bar.
3. **Inline-Atom grab** — the inline cousin of (1): grab an **Atom** (footnote / citation / `\ref` / inline math) directly in the prose and drag it to a new inline cursor. The atom *is* its own handle. A ProseMirror plugin ([src/lib/tiptap/inline-atom-grab.ts](../../src/lib/tiptap/inline-atom-grab.ts), in `buildEditorExtensions`) runs a mousedown→threshold→`beginDropSession` gesture (same drop-mode pipeline, inline-cursor placement); a no-drag press still fires the atom's click (open Card / edit popover). The single drop spec ([specs/in-text-atom-grab.ts](../../src/components/drop-mode/specs/in-text-atom-grab.ts), `atom-grab` prefix) resolves the source captured at grab and moves it same-editor, preserving the node. The 4-kind SSOT is `ATOM_REGISTRY` ([src/lib/tiptap/atom-registry.ts](../../src/lib/tiptap/atom-registry.ts)) — the inline sibling of `TEXT_OBJECT_REGISTRY`. No atom uses native HTML5 drag anymore.

`MIME_TEXTOBJECT = "application/x-virgil-textobject"` ([src/text-objects/types.ts](../../src/text-objects/types.ts)) is defined for future HTML5 drag-out producers (e.g. cross-app drag-to-Stack). Today no producer emits it — the grab handle is mouse-driven and the float-header drop-mode stays in-app via the `virgil-stack-drop` event. The legacy `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` MIMEs were retired in D5+D6.

## Keyboard: Tab in prose fields

Substantive prose fields (every TipTap editor, every multi-line `<textarea>`, the BibEntryCard annotation contentEditable) treat **Tab as indent**, not as focus-move. Tab inserts a literal `\t` at the cursor; Shift-Tab is a no-op in plain prose. The escape hatch is **Esc** — it blurs the field so the next Tab navigates panels normally. Single-line `<input>` fields (search, card titles, citation/bib keys, numeric/dialog inputs) are intentionally *not* affected and keep default focus-moving Tab.

Implementation: [src/lib/tiptap/tab-indent.ts](../../src/lib/tiptap/tab-indent.ts) (TipTap extension at priority 50, so list `sinkListItem` and the expex Tab handlers in [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts) win first); [src/hooks/useTabIndent.ts](../../src/hooks/useTabIndent.ts) (textarea / contentEditable handler).

## Preview / dev caveats

From the existing memory: the File System Access folder picker doesn't work inside the preview iframe. For UI verification, load the dev doc (`virgil-data/doc_devtest`) via the helper, not the picker. Worktrees need the symlink present; see `dev_doc_loading.md` in the agent's personal memory.

**Relocating `library-data/`.** The dev-library API route honors `VIRGIL_LIBRARY_PATH` (introduced in 6ad177f). Setting it in `.env.local` (or your shell) repoints `DATA_DIR` from `process.cwd() + "/library-data"` to the resolved path. Recommended fix for Turbopack instability when `library-data/.virgil/models/` (multi-GB ML weights) and `library-data/.virgil/queue/` (churning under skill runs) overwhelm the watcher's startup walk.

## Where NOT to look for business logic

- `src/app/` — almost pure Next.js scaffolding (manifest, layout, page, global styles). Real work happens in `components/`, `hooks/`, `lib/`, `links/`, `panels/`.
- Top-level config files (`next.config.ts`, `tsconfig.json`, `tailwind.config.*`) — only relevant when changing build/bundling behavior.

## Print

[src/lib/print.ts](../../src/lib/print.ts) orchestrates the print path triggered from the Virgil-bar print button → `PrintDialog` ([src/components/PrintDialog.tsx](../../src/components/PrintDialog.tsx)) → `window.print()`. Show/hide toggles for marginalia, footnotes, citations, comments, paragraph titles, etc. live in `useViewPrefs`. Appendix collection (e.g. all footnotes / comments rendered as a tail section) is in [src/components/PrintAppendices.tsx](../../src/components/PrintAppendices.tsx).

## Related docs

- UI structure → `ui-chrome.md`
- Editor content → `main-text.md`
- User vocabulary → `glossary.md`
- Library subsystem → [library/AGENTS.md](../../library/AGENTS.md) (sibling tree under `library/`, with its own components/hooks/lib/tiptap/scripts/skills)
- Editor skill bundle → [editor/AGENTS.md](../../editor/AGENTS.md) (`/editor/review` umbrella + per-kind subskills that fulfill `ai-requests.json` entries; bridged via [src/lib/ai-request-bridge.ts](../../src/lib/ai-request-bridge.ts))
- Project README → [README.md](../../README.md)
- Style guide → [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md)
