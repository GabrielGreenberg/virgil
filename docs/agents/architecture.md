<!-- last-verified: a293e60 2026-05-07 -->

# Architecture: Registries, Hooks, Persistence, Sidecars

Cross-cutting systems that most features touch.

## Single sources of truth (SSOTs)

| Concern | SSOT | Notes |
|---|---|---|
| Panel/card taxonomy | [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) (`PANEL_REGISTRY`) | Display labels, card kinds, key prefixes, view-mode defaults, omni eligibility, default strip side |
| Link kinds | [src/links/link-registry.ts](../../src/links/link-registry.ts) (`LINK_REGISTRY`) | Multiplicity, connector style, highlight behavior per link kind |
| Card themes | `CARD_THEMES` in [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) | 11 themes (footnote, note, archive, todo, bib, citation, comment, aiRequest, cut, error, quotation falls back to default) |
| Auto-title labels | `CARD_TITLE_LABELS` + `nextCardTitle(kind, count)` in [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) | Per-CardKind label string (or `null` to opt out — comments / suggestions / citations / ai / bib / error don't auto-title). Used at card creation: `nextCardTitle("note", existingCount)` → `"Note 4"` |
| Design tokens | [src/app/globals.css](../../src/app/globals.css) + [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) | Semantic CSS variables (`--surface`, `--ink-body`, `--accent`, etc.) |
| Type definitions | [src/lib/types.ts](../../src/lib/types.ts) | `VirgilSidecar`, `EditorStateData`, `Suggestion`, `ReviewRequest`, `Link`, etc. |

Before adding a new panel, link kind, or theme, extend the registry instead of creating a parallel table.

## Key hooks

All in `src/hooks/`. Full list (46 files) is large; these are the ones most often touched:

| Hook | What it owns |
|---|---|
| `useDocument` | Main doc state + autosave queue; `paragraphUuids`, `paragraphTitles` maps |
| `useCitations` | Citation refs + `.bib` loading |
| `useFootnotes` | Footnote persistence + numbering |
| `useRevisions` | Revision/comment threads |
| `useSuggestions` | AI line-edit suggestion state |
| `useArchive` | Archived snippets |
| `useTodos` | Todo items |
| `useQuotations` | Quotation groups |
| `useExamples` | Expex example blocks (harvests `exampleBlock` nodes from editor doc) |
| `useCutter` | Cut items |
| `useWordCount` | Live word counts by section |
| `usePoppedCards` | Floating card registry (reads `prefs.poppedOutCards`) |
| `useLinkHighlight` / `useCardHoverHighlight` / `useCardSelectionHighlight` | Three-surface hover/selection coupling (text, margin icon, panel card). All in `src/links/_shared/`; see `main-text.md` → Highlight coupling for the full set including the `useTextHoverBridge` + `usePanelCardHoverBridge` event listeners |
| `useViewPrefs` | Panel visibility, layout state, placements, all user-layout prefs |
| `usePersistentState` | IndexedDB persistence abstraction |
| `useInTextPositions` | Omni-view positioning |
| `usePristineCardManager` | Tracks freshly-created cards so they auto-discard if closed without edits; exposed via the `pristine-cards` context |
| `useDocumentStyle` | Per-document preamble preset. Reads/writes the style id to the doc settings sidecar and rewrites the preamble in place when the user picks a new style |
| `useZenMode` | Zen-mode pref + chrome-hide orchestration. Hides Virgil bar / strips / panels and extends the editor to window edges; restores on exit |
| `useHelperMode` | Helper-mode toggle — sets `data-helper-mode="on"` on `<body>`, enabling CSS hover callouts on all `[data-helper]` elements |
| `useCollab` | Turn-taking collaboration state machine: pen ownership, heartbeat, polling of `collab.json` sidecar, per-card focus claims, cursor-paragraph presence broadcast |
| `useRecentlyAddedTracker` | One-slot-per-kind tracker for just-created cards so panels can sort them to the top; auto-cleared when selection moves away |
| `useLatexCompile` | SwiftLaTeX pdfTeX compile + parsed-error extraction. On success, persists the resulting PDF next to the `.tex` (`pdfFilenameFromTex`) so the in-app PDF view (`library/components/PdfView.tsx`) can re-render without recompiling |

## Persistence layers

### File System Access API (the disk)

**Single boundary: [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts).** Every disk read/write goes through here. If you're tempted to call `handle.getFile()` or `writable.write()` anywhere else, route it through storage-fsa instead.

Files on disk (per paper):
- `<name>.tex` — the paper (source of truth)
- `<name>.bib` (optional) — bibliography
- `virgil/` folder — sidecars (see below)

### IndexedDB

Used for: user preferences (`useViewPrefs`), tab state, folder handles, doc index. Not for paper content — that's always on disk.

### Sidecars in `virgil/`

All are JSON files. Schemas in [src/lib/types.ts](../../src/lib/types.ts).

| Sidecar | Purpose | Surfaced as |
|---|---|---|
| `virgil.json` | Per-paragraph metadata: titles, fingerprints | Omni view, search breadcrumbs |
| `suggestions.json` | AI line-edit proposals | **Revisions panel** (suggestion cards beside comments; `y`/`n`/`s` keyboard controls); progress bar lives in the Revisions panel header |
| `revisions.json` | Comment threads (anchored or paper-wide); legacy `GeneralRevision`/`TextRevision` shapes fold forward to one `Comment` type on read | Revisions panel |
| `ai-requests.json` | Queued requests for an agent to resolve | Per-panel "ask" affordances (Footnotes, Notes, Quotations, Citations, Todo) |
| `bib-review-requests.json` | Per-entry bibliography field/note reviews | Bibliography cards |
| `editor-state.json` | Cursor position, selection, misc editor state | Restored on reopen |
| `cutter.json` | Cutter cards (comments + suggestions) and optional word-count goal | Cutter panel; [src/hooks/useCutter.ts](../../src/hooks/useCutter.ts) |
| `collab.json` | Turn-taking collab state: pen holder, heartbeat timestamps, per-user presence entries (cursor paragraph, card focus claims) | [src/hooks/useCollab.ts](../../src/hooks/useCollab.ts); types/constants in [src/lib/collab.ts](../../src/lib/collab.ts) |
| `doc-settings.json` | Per-document settings (currently: `style` id for the preamble preset) | `useDocumentStyle` reads/writes; schema in [src/lib/document-settings.ts](../../src/lib/document-settings.ts) |

Agents never touch this app — they read the same `.tex`/`.bib` and write these sidecars. Virgil polls/watches and surfaces changes.

## EditorPane vs EditorLayout

After Path A 7.8: [src/components/EditorPane.tsx](../../src/components/EditorPane.tsx) is the **canonical editor surface**. Both the main app's doc branch (via [src/components/EditorLayout.tsx](../../src/components/EditorLayout.tsx)) and the Library Reader (via [library/components/PaperRender.tsx](../../library/components/PaperRender.tsx)) mount `<EditorPane>`. EditorPane owns the per-doc hooks (`useDocument`, `useLatexCompile`, `useNotes`, `useTodos`, `useCitations`, `useCollab`, `usePristineCardManager`, …), the docked MenuBar + detached toolbars, the panel rail (icon strip + active panel column), the floating panels block, and the canonical `DockOutline` / `CardLiftOutline`.

EditorLayout shrinks to the **shell wrapper**: tab/file management (`useFiles`), `useViewPrefs` ownership (the bundle is then handed back to EditorPane via the `viewPrefs` prop), top-bar dialogs (Preferences, Fonts, Margins, NewDoc, TexFilePicker, DocumentClassMismatch), the Virgil bar (which reads per-doc state from `paneState` populated via `onPaneStateChange`), the `activePane` switch (paper / library-outer / doc routing), the PDF view branch, and the Code view branch. The PDF and Code branches are siblings of the EditorPane mount in the doc-branch ternary; CodeMirror still lives in EditorLayout per Path A D1 (deferred).

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

Popout key prefixes for cards (DO NOT rename without migration — they're persisted; SSOT in `CARD_KEY_PREFIXES`):
`note`, `footnote`, `archive`, `todo`, `bib`, `citation`, `revision` (for `comment` cards), `suggestion`, `cutter-comment`, `cutter-suggestion`, `revision-suggestion`, `quotation`, `example`, `ai`, `error`. (The legacy `cut` prefix was retired with the Cutter rebuild.)

**Block popouts** also live in `prefs.poppedOutCards` but use prefixes that are NOT card kinds: `paragraph:${uuid}`, `heading:${uuid}`, and `example:${uuid}` (the in-editor block popout, distinct from the Examples panel's `example` card popout that happens to share the prefix). They render `ParagraphFloat` / `HeadingFloat` / an example float (in `src/components/`) instead of a card; the heading float pulls its body via [src/lib/section-range.ts](../../src/lib/section-range.ts). The example-block popout is wired through `ExampleBlockOptions` in [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts). New floats spawn near their trigger element via `popCardAtAnchor` in EditorPane (which routes through `viewPrefs.toggleCardPopout` + `viewPrefs.setCardFloatPosition`); position helper at [src/components/editor-layout/spawn-position.ts](../../src/components/editor-layout/spawn-position.ts).

**Per-panel omni-item builders.** Each omni-eligible panel owns an `omni.tsx` next to its panel folder (e.g. [src/panels/Cutter/omni.tsx](../../src/panels/Cutter/omni.tsx), [src/panels/Errors/omni.tsx](../../src/panels/Errors/omni.tsx), [src/panels/Revisions/omni.tsx](../../src/panels/Revisions/omni.tsx), and the older builders for notes/footnotes/citations/etc.) exporting a `buildXOmniItems(args): OmniItem[]` function. The orchestrator-side host [src/components/editor-layout/panels/omni-host.tsx](../../src/components/editor-layout/panels/omni-host.tsx) imports each builder and concatenates the results into the per-side omni columns. When adding a new omni-eligible panel: flip `omniEligible: true` + set `omniSide` in `panel-registry.ts`, write `<panel>/omni.tsx` exporting the builder, re-export it from `<panel>/index.ts`, and import + invoke from `omni-host.tsx`.

**Dock-drag signal.** [src/components/editor-layout/dock-drag.ts](../../src/components/editor-layout/dock-drag.ts) exposes a module-level (not React Context) `{slotKey, rect}` store via `setDockDragTarget` / `getDockDragTarget` / `useDockDragTarget`. Producer (panel shell, on mousedown) writes the captured slot rect; consumers — the body-portaled [DockOutline](../../src/components/editor-layout/DockOutline.tsx) and EditorLayout's redock-on-mouseup handler — read it. Module-level scope is required because the producer and consumers sit in different parts of the React tree.

**Jump-to alignment.** All `onJump` callbacks accept an optional `sourceEl: HTMLElement | null` argument — typically the clicked card element (use `(e.currentTarget as HTMLElement).closest('[data-card]')`). When passed, `jumpToCard` aligns the in-text marker's vertical position to the card so the page doesn't lurch.

## Panel context

`PanelChromeProvider` in `panel-primitives.tsx` injects the current panel id so context-aware buttons (`PanelPopout`, `PanelClose`) know which panel they belong to without prop drilling.

## Card creation + pristine cards

Two related abstractions, both now mounted inside EditorPane:

- **`cardCreation` context** ([contexts/card-creation.tsx](../../src/components/editor-layout/contexts/card-creation.tsx) + [card-actions/card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts)) — collapses the historical "create + select + pop-at-anchor" dance into single `cardCreation.createNote/createCut/createTodo/createFootnote/createCitation/createQuotation` calls. Each handler on the Actions toolbar and the Margin toolbar routes through it, so creation behavior stays consistent across entry points. The pop-at-anchor side now flows through `popCardAtAnchor` inside EditorPane (gated on `viewPrefs`).
- **`pristine-cards` context** + `usePristineCardManager` — tracks cards that were just created but never edited by the user; auto-discards them if the user closes/blurs without typing. Every card-bearing hook (`useNotes`, `useCutter`, `useTodos`, `useQuotations`, `useCitations`, `useFootnotes`) plugs into this. EditorPane owns the manager; EditorLayout still constructs a parallel manager because AIWindow + the click-away mutex effect read selection state on the shell side (see "Future work" in `master-plan-the-status-buzzing-music.md`).

## System dialog primitive

[src/components/system-dialog.tsx](../../src/components/system-dialog.tsx) + [src/components/system-dialog-host.tsx](../../src/components/system-dialog-host.tsx) provide a shared modal primitive. `ConfirmDialog`, `NewDocumentModal`, `TexFilePickerModal`, and `DocumentClassMismatchDialog` are thin wrappers over it. See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for the dialog conventions.

## Per-panel color overrides

Users can recolor any panel via the header color picker. The override routes through `deriveCardPalette` in [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts), which derives a full card palette (marker, badge, border, header, selected variants) from a single accent color.

## Drag / drop MIME map

Paragraph-level anchor drops trigger the vertical drop indicator. Inline-insert drops don't. Both sets live in [src/lib/marginalia.ts](../../src/lib/marginalia.ts):

- **`ANCHOR_DRAG_TYPES`** (vertical indicator): marginalia-move, quotation, note, todo, archive-anchor, cut.
- **Inline-insert**: quote, citation, archive (restore), footnote, ai-request, text-insert.

When wiring a new draggable type, pick a category and register it — the drop indicator behaves correctly for free.

## Keyboard: Tab in prose fields

Substantive prose fields (every TipTap editor, every multi-line `<textarea>`, the BibEntryCard annotation contentEditable) treat **Tab as indent**, not as focus-move. Tab inserts a literal `\t` at the cursor; Shift-Tab is a no-op in plain prose. The escape hatch is **Esc** — it blurs the field so the next Tab navigates panels normally. Single-line `<input>` fields (search, card titles, citation/bib keys, numeric/dialog inputs) are intentionally *not* affected and keep default focus-moving Tab.

Implementation: [src/lib/tiptap/tab-indent.ts](../../src/lib/tiptap/tab-indent.ts) (TipTap extension at priority 50, so list `sinkListItem` and the expex Tab handlers in [src/lib/tiptap/expex.ts](../../src/lib/tiptap/expex.ts) win first); [src/hooks/useTabIndent.ts](../../src/hooks/useTabIndent.ts) (textarea / contentEditable handler).

## Preview / dev caveats

From the existing memory: the File System Access folder picker doesn't work inside the preview iframe. For UI verification, load the dev doc (`virgil-data/doc_devtest`) via the helper, not the picker. Worktrees need the symlink present; see `dev_doc_loading.md` in the agent's personal memory.

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
- Project README → [README.md](../../README.md)
- Style guide → [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md)
