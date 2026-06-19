<!-- last-verified: 985d891 2026-06-19 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization, docs/architecture/VIRGIL.md#sidecar-and-panel-inventory -->
<!-- covers-code: src/hooks, src/lib/storage-fsa.ts, src/lib/types.ts, src/panels/panel-registry.ts, src/links/link-registry.ts, src/links/resolve-card-anchor.ts, src/lib/anchor-mint-signal.ts, src/text-objects/text-object-registry.ts, src/text-objects/LiftHost.tsx, src/lib/marginalia.ts, src/lib/actions/action-registry.ts, src/lib/actions/editor-actions-bridge.ts, src/lib/actions/action-icons.tsx, src/lib/tiptap/smart-insert.ts, src/lib/focus-view.ts, src/lib/identity, src/lib/bib-uid.ts, src/cards/has-content.ts, src/cards/lifecycle -->

# Architecture: Registries, Hooks, Persistence, Sidecars

Cross-cutting systems that most features touch.

## Single sources of truth (SSOTs)

| Concern | SSOT | Notes |
|---|---|---|
| Panel taxonomy | [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) (`PANEL_REGISTRY`) | Display labels, omni eligibility, default strip side. Card-kind satellite tables (`CARD_KEY_PREFIXES` / `CARD_TYPE_LABELS` / `CARD_TITLE_LABELS`) are now *derived* from `CARD_REGISTRY`; `getPanelByCardKind` derives from `CardMeta.panel` (the hand-kept polymorphic-panel map was retired in 27458d8) |
| Card kinds | [src/cards/card-registry.tsx](../../src/cards/card-registry.tsx) (`CARD_REGISTRY: Record<CardKind, CardMeta>`) | Card-system SSOT (27458d8), mirrors `TEXT_OBJECT_REGISTRY`. Per-kind meta: label, key prefix, theme key, owning panel, origin, anchored flag, marker type, lifecycle caps, stackable, `toFloatable`, plus a declarative `content: CardContentModel | null` descriptor (T4) and `morph` field. `CardKind` (16 kinds, UNCHANGED — `comment`→`revision-comment`, bare `suggestion` dropped from the spine) + derived predicates live in [src/cards/types.ts](../../src/cards/types.ts) + [src/cards/predicates.ts](../../src/cards/predicates.ts) (incl. `isArchivable` / `archiveRemovesAtom` for per-card archive). Data layer (`RevisionCard.kind`, `revisions.json`, Python) still uses `comment`/`suggestion`, bridged at float dispatch |
| Link kinds | [src/links/link-registry.ts](../../src/links/link-registry.ts) (`LINK_REGISTRY`) | Multiplicity, connector style, highlight behavior per link kind |
| TextObject kinds | [src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts) (`TEXT_OBJECT_REGISTRY`) | Closed kind union (paragraph, heading, list, list item, example item, atom blocks, linkedRange — 16 kinds total); per-kind meta drives grab-handle layout, float body component, drop adapter (wrap vs direct), move-source collector, source-marker round-trip. Adding a new TextObject kind = one entry here + `groups: "textObject"` on its node spec. See [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md) |
| Editor actions | [src/lib/actions/action-registry.ts](../../src/lib/actions/action-registry.ts) (`VIRGIL_ACTION_REGISTRY: Partial<Record<ActionId, ActionSpec>>`) | The single SSOT for EVERY action across ALL four surfaces (`ActionSurface` = grab-handle menu / gutter lightning / slash command / typed-LaTeX input rule — plus `keyboard`). Per-spec: category (`card`/`atom`/`block`/`format`), `surfaces`, applicability + selection-mode taxonomy, uniform collab read-only gate (rows grey out where the command would no-op). The two live menus (`DragHandleMenu`, `SelectionActionsMenu`→`ActionsMenuPanel`) now RENDER FROM the registry. PM→React dispatch via [src/lib/actions/editor-actions-bridge.ts](../../src/lib/actions/editor-actions-bridge.ts) (`set/getEditorActionsHandle`); icons in [src/lib/actions/action-icons.tsx](../../src/lib/actions/action-icons.tsx); block-atom inserts (math/figure/graphics) via [src/lib/tiptap/smart-insert.ts](../../src/lib/tiptap/smart-insert.ts) |
| Card themes | `CARD_THEMES` in [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) | `Record<PanelThemeKey, CardTheme>` — a mechanical fold over `DEFAULT_PANEL_COLORS` ([src/lib/panel-theme.ts](../../src/lib/panel-theme.ts)); 13 keys: citation, bib, footnote, note, highlight, archive, todo, cut, revision, report, example, aiRequest, error. The legacy `comment` alias is gone (registry `themeKey` *is* `PanelThemeKey`); `aiRequest`/`error` are non-overridable system accents (`SYSTEM_THEME_KEYS`). The highlight *text tint* still paints via the `tintColor` mark attr, separate from the `highlight` card accent |
| Auto-title labels | `CARD_TITLE_LABELS` + `nextCardTitle(kind, count)` in [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) | Per-CardKind label string (or `null` to opt out — comments / suggestions / citations / ai / bib / error don't auto-title). `nextCardTitle("note", n)` → `"Note 4"`. Since T6/C12 a fresh card is created blank + `titleAuto: true` (recorded provenance), not pre-filled; on load `resolveLoadedTitle(kind, title, titleAuto)` decides the effective title from the recorded bit (the `isAutoTitle` string-shape heuristic is demoted to a one-time legacy fallback, stamped via `resolveTitleAuto`) |
| Design tokens | [src/app/globals.css](../../src/app/globals.css) + [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) | Semantic CSS variables (`--surface`, `--ink-body`, `--accent`, etc.) |
| Type definitions | [src/lib/types.ts](../../src/lib/types.ts) | `VirgilSidecar`, `EditorStateData`, `Suggestion`, `ReviewRequest`, `Link`, etc. |

Before adding a new panel, link kind, or theme, extend the registry instead of creating a parallel table.

## Key hooks

All in `src/hooks/`. Full list (~50 files) is large; these are the ones most often touched:

| Hook | What it owns |
|---|---|
| `useDocument` | Main doc state + autosave queue; `paragraphUuids`, `paragraphTitles` maps. Exposes `flushNow` — an immediate doc-bundle write that cancels the 1500 ms debounce, fired on an anchor-UUID **mint** transaction (`isAnchorMintTransaction`, [src/lib/anchor-mint-signal.ts](../../src/lib/anchor-mint-signal.ts)) and on a drop-mode re-anchor COMMIT, so a freshly anchored paragraph's `%!v:<uuid>` reaches the `.tex` on the card's fast clock instead of the doc's slow autosave clock (anchor-persistence race) |
| `useCitations` | Citation refs + `.bib` loading; `commandFor(id)` serializes a card's `\cite{…}` for the drop spec's create-if-absent branch (returns null for a keyless draft, via the shared `citationCommandOrNull` keyless-citation predicate). When the identity-cascade flag is on, a citekey rename routes through the `IdentityCascade` (registers the `\cite{}` doc-rewrite migrator) and `replaceBibEntry`/`updateBibEntry` carry the durable `BibEntry.uid` so uid-keyed sidecars don't strand |
| `useFootnotes` | Footnote persistence + numbering |
| `useOrphanedFootnotes` | Durable per-doc home for orphaned footnotes (marker gone, body recoverable), backed by the `orphaned-footnotes.json` sidecar via `usePersistentState` (load-on-docId, debounced persist, docId-reset so orphans don't bleed cross-doc). Feeds the Footnotes + Search panels. Cutover gated behind `virgil:inline-atom-lifecycle` |
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
| `useViewPrefs` | Panel visibility, layout state, placements, and (since b706812) the per-view editor-decoration prefs that previously lived as EditorLayout local state — marginalia visibility (`showMarginalia`, `hiddenMarginaliaTypes`), section indicator / heading labels, divider levels + width, omni-view categories + per-side hide-all, four-sided editor margins (`editorLeftMargin` / `editorRightMargin` / `editorTopMargin` / `editorBottomMargin`; top/bottom added in d211464 so the page padding is fully four-sided), and (per-card archive) the per-panel `cardArchiveView` map (`active`/`archived`/`all`, via `setCardArchiveView`) + `suppressArchiveAtomWarning`. Sourced via the centralized [src/lib/dev-prefs-registry.ts](../../src/lib/dev-prefs-registry.ts) (single source consumed by both the cross-window mirror and the personal-prefs promotion script). On load, [`dropUnknownPanelIds`](../../src/hooks/dropUnknownPanelIds.ts) subtractively drops any panel id that is no longer in its carrier's live registry SSOT (`placements` → `PANEL_REGISTRY`, `omniCategories` → `OMNI_PANELS`, `printOptions.panels` → `PRINT_PANELS`), so a retired panel (e.g. `quotations`) can't round-trip through saved prefs or the defaults snapshot. The same module's `clampStack` sanitizes the band-stack rework's per-side `dockStack` (drops omni/blank sentinels, unknown/duplicate/cross-side ids, truncates to the stack ceiling); the panel-layout model moved from the old `activeLeft`/`activeRight` split sentinels to an ordered `dockStack` + `collapsedLeft/Right` + `blankLeft/Right` |
| `view-prefs-derived` (not a hook) | Leaf module of pure derived read-helpers over `ViewPrefs` (`dockedSideOf` / `dockStackTop` / `isPanelDocked`) for the band-stack model. Imports ONLY types from `useViewPrefs` (no runtime cycle / heavy storage chain), so route-derivation code paths import them from here; `useViewPrefs` re-exports them |
| `useMarginEdit` | Margin edit-mode state machine (d211464). Keyed on `Margins = Record<MarginSide, number>` with axis-lookup tables (`MARGIN_AXIS`, `MARGIN_OPPOSITE`, `MARGIN_MIN`, `MARGIN_CSS_VAR`) so one drag handler covers all four sides; adding a fifth side is one table-entry addition. Drives the four guide lines + glowing-blue Save/Cancel pill (see `ui-chrome.md` → Reading frame & margins) |
| `useFloatingMenuPosition` | Shared viewport-clamping placement helper (f7461e2). Action menu / Highlights submenu / DragHandleMenu route through it so popovers never bleed off-screen. RAF-batched + recomputed on scroll/resize. Two opt-in capabilities for the `<Menu>` primitive (off by default, existing callers byte-identical): `maxHeight` (clamps to the space available for the chosen placement + `overflowY:auto` so a tall list scrolls), and `trackAnchor` (a RAF-coalesced capture-phase scroll/resize re-anchor thunk — slash caret / bib-picker / tab-plus scroll re-reads unify onto it) |
| `usePersistentState` | IndexedDB persistence abstraction. `update()` debounces `persist()` ~300ms (2dc963d) with flush-on-unmount + flush-on-docId-change so safety isn't traded for the keystroke-cascade savings |
| `useInTextPositions` | Omni-view positioning. CHIP-B: a card whose first pid isn't a live anchorable node is skipped; deciding a *stored* uuid is dead + needs snapshot/mark recovery is no longer this helper's job — that's the anchor-recovery SSOT (`resolveCardAnchor`), run upstream by the gutter-marker builder, so the pids reaching this helper are already resolved-or-orphan-flagged |
| `useLivePosResolver` | Resolves a stored UUID / anchor index to a live in-doc position off the `DocStructureBus` snapshot (not a re-walked array), so jump-to / search-highlight read current positions without drifting on the keystroke that wraps a line (T5) |
| `useReconcileModeAAnchors` | Shared factory wrapping a card-source hook's `usePersistentState` `update` setter into a uniform `reconcileAnchors(editor)`, called once per doc-open. Repairs a Mode-A margin card whose stored paragraph UUID was lost to a reload race (the `%!v:` write didn't round-trip): funnels every card through the `resolveCardAnchor` ladder (uuid → mark → rung-2b → snapshot → orphan) in [src/links/resolve-card-anchor.ts](../../src/links/resolve-card-anchor.ts) + the `reconcileCardToResolved` mutator (backfills the self-healing snapshot, strips dead-mark residue, or rewrites the dead pid to a live same-text paragraph). Load-only (`buildResolveIndex` is O(doc), one index per pass), idempotent, never on a keystroke. Wired into `useNotes` / `useTodos` / `useArchive` / `useReports` / `useRevisions` / `useCutter` |
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
| `useCardLifecycleReconciler` | Subscribes to the card-lifecycle signal channel ([src/cards/lifecycle/card-lifecycle-signal.ts](../../src/cards/lifecycle/card-lifecycle-signal.ts)) and prunes/re-keys the global `cardStore` (selection/hover/expand slots) on a sidecar-card DELETE or kind-MORPH — the obligation the `DocStructureBus` can't carry for sidecar-backed kinds (report/note/cutter/revision) that have no doc node. Single emitter (`runCardLifecycleEvent` in [src/cards/lifecycle/run-event.ts](../../src/cards/lifecycle/run-event.ts)), single consumer; NOT a bus subscription (fires only on a trash/morph click) |
| `useIdentityBusConsumer` | The single inline-atom `DocStructureBus` consumer (the "+1 not +3"): opens ONE `onAnyChange` subscription, registers T1's id-regen policy, and lets Wave-2 themes register on the returned `IdentityBusConsumer` dispatcher via `registerPolicy` rather than opening their own subscriptions. Behind `virgil:identity-cascade` (default OFF). See the AGENTS.md keystroke-sanctity permitted-consumer list and the Identity cascade subsystem below |
| `useCitationResync` / `useInlineAtomLifecycle` | Wave-2 policies registered on `useIdentityBusConsumer`'s dispatcher (citation add-resync T5; inline-atom lifecycle T2) — in [src/links/_shared/](../../src/links/_shared/) alongside their `citation-resync-policy.ts` / `inline-atom-lifecycle-policy.ts`. Both gated behind the identity-cascade / inline-atom-lifecycle flags |

## Editor hot-path conventions (2dc963d)

Per-keystroke perf regressions chase one anti-pattern: a synchronous TipTap subscriber that does a doc traversal / LaTeX serialization / forced layout read / IndexedDB write / wide-tree React setter. The 2dc963d refactor codifies the shape of a well-behaved hot-path subscriber:

- **Subscribe to `update`, not `transaction`/`selectionUpdate`**, and gate on `tr.docChanged` so mark-only / selection-only transactions don't trigger a layout-reading recompute (see `TextObjectGrabHandle`). (The EditorLayout focus-mode hide now rides a ProseMirror node decoration — `focusViewPlugin` ([src/lib/focus-view.ts](../../src/lib/focus-view.ts)) stamps `.focus-hidden` on out-of-band top-level blocks, fed the UUID band by `useFocusMode`; this replaced the old injected `<style>` nth-child stylesheet + child-count tracker, and reaches React-NodeView blocks + the mirror pane for free.)
- **RAF-batch any compute that reads layout** (`useMarginalia.compute()`, `Marginalia` host-detection notify, `SelectionDragHandle` placement, `EditorMirror.updateState()`).
- **Debounce React state setters** that fan out via useMemos (`docVersion` in EditorPane and `editorDocVersion` in EditorLayout both ~100ms; `usePersistentState.update()` ~300ms with flush-on-unmount/docId-change).
- **WeakMap-memoize per-node serialization** keyed on the immutable PM node (`getExamples()` runs once per edited example block instead of N-per-keystroke).
- **`useRef` instead of `useState`** for values that are only read on transitions (`lastEditTime` → `pdfStale`); avoids a full re-render per character.
- **Lazy hook activation**: `useLibraryMasterBib(enabled)` — pass `false` until the doc actually has unresolved citation keys; the hook stays mounted (no conditional-hook violation) but skips the citation-js parse. `catalog-store` polling is refcounted via a single shared interval, zero polling when no consumers are mounted.

## Persistence layers

### File System Access API (the disk)

**Single boundary: [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts).** Every disk read/write goes through here. If you're tempted to call `handle.getFile()` or `writable.write()` anywhere else, route it through storage-fsa instead.

On load, `readDocBundle` assigns paragraph UUIDs and now writes the re-stamped `.tex` (+ `virgil.json` sidecar) back to disk opportunistically (`writeReStampedTexOnLoad`, 10e86d6) — parity with storage-dev, so a UUID minted for a paragraph that lacked a `%!v:` marker is durable BEFORE the editor mounts (not volatile until the next 1500 ms autosave; closes the production-only anchor-orphan-on-reload window). Fire-and-forget, routed through `enqueueDocWrite` with the active-handle / pipeline staleness guard so a read during a doc switch can't write to the wrong file, and preamble-preserving like `writeDocBundle`.

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
| `bib-review-requests.json` | Per-entry bibliography field/note reviews. `BibReviewRequest.entryUid` (T1) targets the durable `BibEntry.uid` so a citekey rename re-points nothing; `bibKey` is a human-readable mirror / legacy fallback | Bibliography cards |
| `annotations.json` | Per-entry bibliography annotations. Legacy flat `citekey → html` (`AnnotationsState`); under `virgil:identity-cascade` migrates non-destructively to uid-keyed `AnnotationsStateV2` (`{ v:2, byUid, orphanByKey }`) so a citekey rename never strands a note (BIB-A2-01) | Bibliography annotation editor |
| `orphaned-footnotes.json` | Durable orphaned-footnote bodies (versioned `{ version:1, orphans }`; absent ⇒ empty) | [src/hooks/useOrphanedFootnotes.ts](../../src/hooks/useOrphanedFootnotes.ts); Footnotes + Search panels |
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
3. **Popped out** — registered in `prefs.poppedOutCards` with key `${keyPrefix}:${id}`; the generic dispatcher `FloatHost` ([src/floats/FloatHost.tsx](../../src/floats/FloatHost.tsx) — AF's successor to `renderPoppedCard`) parses each key, resolves a `Floatable` via `CARD_REGISTRY[kind].toFloatable(id, ctx)` (ctx bag built in [editor-layout/floating-cards.tsx](../../src/components/editor-layout/floating-cards.tsx)), and mounts it in a `FloatWindow` under the unified `FloatChrome` header.

The popouts mount lives inside [EditorPane.tsx](../../src/components/EditorPane.tsx) at the editor root, gated on `viewPrefs && !viewPrefs.zenMode`, with a memoized `popoutsDeps: PoppedCardDeps` bag wired from EditorPane's per-doc hooks. The Reader passes no `viewPrefs` so the mount stays dormant. Zen mode hides the floats but retains their state.

Popout key prefixes for cards (DO NOT rename without migration — they're persisted; SSOT is the `keyPrefix` field on each `CARD_REGISTRY` entry, from which `CARD_KEY_PREFIXES` is now derived):
`note`, `highlight`, `footnote`, `archive`, `todo`, `bib`, `citation`, `revision` (for `revision-comment` cards), `cutter-comment`, `cutter-suggestion`, `revision-suggestion` (keyPrefix kept for the LEGACY persisted key `revision:s:<id>`, dual-read + migrated on load), `report`, `report-request`, `example`, `ai`, `error`. (The bare `suggestion` prefix and the legacy `cut` prefix were retired with the spine refactor / Cutter rebuild.)

**Block popouts** also live in `prefs.poppedOutCards` but use one unified prefix shape: `textobject:<kind>:<uuid>` (or `textobject:linkedRange:<anchorId>` for mark-backed range popouts). Emitted by `textObjectPopoutKey` in [src/text-objects/text-object-registry.ts](../../src/text-objects/text-object-registry.ts); parsed by `parseTextObjectPopoutKey`. `FloatHost` resolves these through `textObjectFloatable` ([src/text-objects/text-object-floatable.tsx](../../src/text-objects/text-object-floatable.tsx)), which reads `meta.floatBodyComponent` from `TEXT_OBJECT_REGISTRY` and renders the body inside the same unified `FloatWindow`/`FloatChrome`. Body components live in [src/text-objects/floats/](../../src/text-objects/floats/) — after the L3g–L3n chips **all 16 graspable kinds register a body** via `registerFloatBody` (from `floats/index.ts`): per-kind `ParagraphBody` / `HeadingBody` / `ListBody` (both list kinds) / `TexBlockBody` / `ExampleBlockBody` / `LinkedRangeBody` / `ListItemBody` / `ExampleItemBody` / `FigureBody` (figure + graphics), plus a shared `SingleBlockBody` for the bodyless single-block kinds (blockquote, codeBlock, displayMath, latexComment, titleField).

Legacy popout-key migration: boot-time read-side rewriter in `useViewPrefs.loadPrefs` rewrites `paragraph:` / `heading:` / `texBlock:` to the unified shape; `list:<uuid>` and the in-editor `example:<uuid>` keys go through a doc-aware post-load sweep in [src/text-objects/post-load-migrations.ts](../../src/text-objects/post-load-migrations.ts) wired from `EditorLayout.tsx`. The Examples panel-card prefix `example:<id>` (a sibling of `note:` / `todo:` / `bib:`) is stable and intentionally NOT migrated — the disambiguation is doc-aware (a uuid that resolves to an exampleBlock node is the in-editor popout; otherwise it's the panel-card prefix).

Floats spawn near their trigger element via `popCardAtAnchor` in EditorPane (which routes through `viewPrefs.toggleCardPopout` + `viewPrefs.setCardFloatPosition`); position helper at [src/components/editor-layout/spawn-position.ts](../../src/components/editor-layout/spawn-position.ts). A **header drag-lift** instead spawns the float at the docked card's own measured rect (`liftSpawnRect` in [src/floats/float-policy.ts](../../src/floats/float-policy.ts) — pop-out continuity; collapsed lifts grow to content, capped at 55 vh via `POPOUT_MAX_VH`). Initial float size per kind is declared in the registry (`meta.initialFloatSize`).

**Per-panel omni-item builders.** Each omni-eligible panel owns an `omni.tsx` next to its panel folder (e.g. [src/panels/Cutter/omni.tsx](../../src/panels/Cutter/omni.tsx), [src/panels/Errors/omni.tsx](../../src/panels/Errors/omni.tsx), [src/panels/Revisions/omni.tsx](../../src/panels/Revisions/omni.tsx), and the older builders for notes/footnotes/citations/etc.) exporting a `buildXOmniItems(args): OmniItem[]` function. The orchestrator-side host [src/components/editor-layout/panels/omni-host.tsx](../../src/components/editor-layout/panels/omni-host.tsx) imports each builder and concatenates the results into the per-side omni columns. When adding a new omni-eligible panel: flip `omniEligible: true` + set `omniSide` in `panel-registry.ts`, write `<panel>/omni.tsx` exporting the builder, re-export it from `<panel>/index.ts`, and import + invoke from `omni-host.tsx`.

**Dock-drag signal.** [src/components/editor-layout/dock-drag.ts](../../src/components/editor-layout/dock-drag.ts) exposes a module-level (not React Context) `{slotKey, rect}` store via `setDockDragTarget` / `getDockDragTarget` / `useDockDragTarget`. Producer (panel shell, on mousedown) writes the captured slot rect; consumers — the body-portaled [DockOutline](../../src/components/editor-layout/DockOutline.tsx) and EditorLayout's redock-on-mouseup handler — read it. Module-level scope is required because the producer and consumers sit in different parts of the React tree.

**Jump-to alignment.** All `onJump` callbacks accept an optional `sourceEl: HTMLElement | null` argument — typically the clicked card element (use `(e.currentTarget as HTMLElement).closest('[data-card]')`). When passed, `jumpToCard` aligns the in-text marker's vertical position to the card so the page doesn't lurch.

## Panel context

`PanelChromeProvider` in `panel-primitives.tsx` injects the current panel id so context-aware buttons (`PanelPopout`, `PanelClose`) know which panel they belong to without prop drilling.

## Card creation + pristine cards

Two related abstractions, both now mounted inside EditorPane:

- **`cardCreation` context** ([contexts/card-creation.tsx](../../src/components/editor-layout/contexts/card-creation.tsx) + [card-actions/card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts)) — collapses the historical "create + select + pop-at-anchor" dance into single `cardCreation.createNote/createCut/createTodo/createFootnote/createCitation/createReport/createReportRequest` calls. Each action trigger (the gutter `SelectionActionsMenu`, the `DragHandleMenu`) routes through it, so creation behavior stays consistent across entry points. (The old margin `MarginActionToolbar` and the redundant strip `ActionsStripButton` that also fed it were deleted in bcc583a and backlog #6 respectively.) The pop-at-anchor side now flows through `popCardAtAnchor` inside EditorPane (gated on `viewPrefs`).
- **`pristine-cards` context** + `usePristineCardManager` — tracks cards that were just created but never edited by the user; auto-discards them if the user closes/blurs without typing. Every card-bearing hook (`useNotes`, `useCutter`, `useTodos`, `useReports`, `useCitations`, `useFootnotes`) plugs into this. EditorPane owns the manager; EditorLayout still constructs a parallel manager because AIWindow + the click-away mutex effect read selection state on the shell side.

## System dialog primitive

[src/components/system-dialog.tsx](../../src/components/system-dialog.tsx) + [src/components/system-dialog-host.tsx](../../src/components/system-dialog-host.tsx) provide a shared modal primitive. `ConfirmDialog`, `NewDocumentModal`, `TexFilePickerModal`, and `DocumentClassMismatchDialog` are thin wrappers over it. See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for the dialog conventions.

## Unanchored-card safety (21933e0)

Anchored cards (notes, todos, cuts, archives, revisions, reports) no longer disappear silently when their host paragraph is deleted or their last anchor is dropped. Two coordinated pieces:

- **Unified delete path** — [src/cards/delete-margin-item.ts](../../src/cards/delete-margin-item.ts) (`deleteMarginItem`) is the single entry point every gutter-marker delete and panel-trash delete routes through. If the gesture removes the card's last anchor, it prompts to delete the whole card (using the "This item has text" confirm via `cardHasContent` in [src/cards/has-content.ts](../../src/cards/has-content.ts)); if other anchors remain, it just drops this link. `cardHasContent` is now a single declarative walker over each kind's `content: CardContentModel` descriptor on `CARD_REGISTRY` (T4) — replacing the per-kind `switch`, so panel-trash and gutter-marker delete-confirms can't miss a content field; the `morph` field's drop-set drives the lossy-morph confirm copy.
- **Paragraph-deletion guard** — `MarginaliaAnchorGuard` (TipTap extension in [src/lib/tiptap/linked-anchor.ts](../../src/lib/tiptap/linked-anchor.ts)) reads a ref of currently-anchored UUIDs from EditorPane (populated in `EditorPane.tsx` ~line 1867) and, when a transaction would delete a paragraph carrying an anchor or a `linkedAnchor` mark, re-inserts an empty placeholder at the mapped original position with the same UUID. Covers both gutter-marked paragraphs and Mode-B text-range paragraphs. Configured in `buildEditorExtensions` ([src/lib/editor-extensions.ts](../../src/lib/editor-extensions.ts) ~line 1766).

Together: only explicit user gestures (gutter delete or panel trash) destroy a card; incidental editor edits can't orphan one.

**Resolver-driven render + orphan dock (RC2).** The gutter-marker builder resolves each card's live paragraph through the anchor-recovery SSOT (`resolveCardAnchor`) rather than a raw uuid→pos lookup. A card that resolves to `source:'orphan'` (its uuid + mark + text-snapshot are all dead) is no longer silently culled — its `MarginaliaMarker` carries an `unanchored` flag ([src/lib/marginalia.ts](../../src/lib/marginalia.ts)) and the gutter surfaces it in a fixed "unanchored — click to re-pin" dock instead. `useMarginaliaRegistry` ([src/hooks/useMarginaliaRegistry.ts](../../src/hooks/useMarginaliaRegistry.ts)) also heals a gutter marker when its anchor block's DOM is swapped (list-item / heading hover-cull) with bounded observe-retry.

## Identity cascade (behind `virgil:identity-cascade`, default OFF)

[src/lib/identity/](../../src/lib/identity/) gives bibliography entries and inline atoms a durable internal id decoupled from the renameable citekey, so a rename / markerless re-parse never strands the surfaces that key on the old string (annotations, bib-review requests, float, panel selection — the BIB-A2-01 DATA-LOSS class). Pieces:

- **`BibEntry.uid`** — minted once and round-tripped via a `\vbid{}` marker in the `.bib` ([src/lib/bib-uid.ts](../../src/lib/bib-uid.ts)). A rename mutates `key`, never `uid`.
- **`IdentityCascade`** ([identity-cascade.ts](../../src/lib/identity/identity-cascade.ts)) — the single writer for any identity-changing op (`runIdentityChange`). Pure-logic; every uid-keyed surface registers a migrator so the cascade fans a rename out atomically (the `\cite{}` doc-rewrite is itself a migrator the citation hook registers, passing the live editor). Fires only on an explicit rename, never on a keystroke.
- **`useIdentityBusConsumer`** ([useIdentityBusConsumer.ts](../../src/lib/identity/useIdentityBusConsumer.ts)) + **`IdentityBusConsumer`** ([identity-bus-consumer.ts](../../src/lib/identity/identity-bus-consumer.ts)) — the single inline-atom `DocStructureBus` consumer (one `onAnyChange` subscription, `emitCount`-gated + O(1) bail); Wave-2 themes register ordered policies (`registerPolicy`) rather than opening their own subscriptions.
- Sidecar migration: **`sidecar-uid-migrate.ts`** re-keys legacy citekey-keyed sidecars to uids non-destructively (`AnnotationsStateV2.orphanByKey` catches unresolved keys); **`bib-cite-rewrite.ts`** rewrites `\cite{}` commands.
- Flag gates: **`identity-flag.ts`** (`virgil:identity-cascade`) + **`inline-atom-lifecycle-flag.ts`** (`virgil:inline-atom-lifecycle`). Flag-off keeps the legacy `updateBibKeyAndType` path so the existing suite stays green.

## Per-panel color overrides

Users can recolor any panel via the header color picker. The override routes through `deriveCardPalette` in [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts), which derives a full card palette (marker, badge, border, header, selected variants) from a single accent color.

## Drag / drop MIME map

The MIME constants live in [src/lib/marginalia.ts](../../src/lib/marginalia.ts). After the drop-button / unified drop-mode rework (chip H) the native **panel→gutter** and **gutter-pin re-anchor** paragraph-anchor drags were folded onto the unified drop-mode controller (re-anchoring now flows through the card drop button → `beginCardDropGesture`, not HTML5 DnD); the per-kind anchor MIMEs (`MIME_NOTE` / `MIME_TODO` / `MIME_ARCHIVE_ANCHOR` / `MIME_CUT` / `MIME_REPORT`) and the `panel-drops.ts` / `anchor-rebind.ts` event-bridges + `Revisions/mime.ts` were deleted. What remains:

- **`ANCHOR_DRAG_TYPES`** (vertical drop indicator suppress-set): now the lone residual `MIME_MARGINALIA_MOVE` — no live code produces it, kept only so `isAnchorDrag` stays a guard for any future native paragraph-anchor drag that opts back in.
- **Inline-insert** (no vertical indicator): citation, archive (restore), footnote, text-insert.

When a card kind is re-anchorable via the drop button, declare the `droppable` + `dropPlacement` facets on its `CARD_REGISTRY` entry and register its `dropSpec` (see `src/cards/types.ts` `CardMeta`) — these are facets on existing kinds, not new card kinds. For a genuinely new inline-insert DnD payload, add the `MIME_*` constant and keep it out of `ANCHOR_DRAG_TYPES`.

**Text moves** are deliberately narrow. The canonical text-move gestures are:

1. **Drag-to-pop-out** — the lift gesture on any TextObject via the unified [TextObjectGrabHandle](../../src/text-objects/TextObjectGrabHandle.tsx) (the single grab-handle component for paragraph / heading / list / list item / example item / atom block / selection-as-linkedRange). Selection lifts hydrate into `linkedRange` TextObjects at lift commit via `hydrateSelectionToTextObject` ([src/text-objects/hydrate-selection.ts](../../src/text-objects/hydrate-selection.ts)). Custom mousedown protocol, NOT HTML5 drag. The post-threshold lifted-overlay core (the translucent ghost↔popout clone) is hoisted out of the grab handle into the shared [LiftHost](../../src/text-objects/LiftHost.tsx) provider (`beginLift`, `terminalPolicy`), so a second producer — the popped-out text-object float's drop button — drives the same machinery.
2. **Drop-mode** — grabbing the card's drop button (the double-chevron, on the docked header / float chrome; the float-chrome drop button also lifts via `LiftHost`; req-7 retired the legacy Shift-drag-on-a-float-header entry) re-drops the block back into the doc at a visible placement bar. The block-source drop spec in [src/components/drop-mode/specs/textobject.ts](../../src/components/drop-mode/specs/textobject.ts) routes through `meta.dropAdapter` (wrap vs drop-direct) and `meta.collectMoveSource` (single node vs section range). A lifted `linkedRange` selection (cardKey `textobject:linkedRange:<id>`) is routed to a sibling [specs/text-range-move.ts](../../src/components/drop-mode/specs/text-range-move.ts) instead — it moves a text *slice* (not a whole node) to an inline cursor, or drops it as block content in a block gap (L3f-2). Feature A1–A3 also let block payloads drop into an expex example via a single left vertical drop-bar.
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
