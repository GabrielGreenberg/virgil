<!-- last-verified: 592874b 2026-04-23 -->

# Architecture: Registries, Hooks, Persistence, Sidecars

Cross-cutting systems that most features touch.

## Single sources of truth (SSOTs)

| Concern | SSOT | Notes |
|---|---|---|
| Panel/card taxonomy | [src/panels/panel-registry.ts](../../src/panels/panel-registry.ts) (`PANEL_REGISTRY`) | Display labels, card kinds, key prefixes, view-mode defaults, omni eligibility, default strip side |
| Link kinds | [src/links/link-registry.ts](../../src/links/link-registry.ts) (`LINK_REGISTRY`) | Multiplicity, connector style, highlight behavior per link kind |
| Card themes | `CARD_THEMES` in [src/components/panel-primitives.tsx](../../src/components/panel-primitives.tsx) | 11 themes (footnote, note, archive, todo, bib, citation, comment, aiRequest, cut, error, quotation falls back to default) |
| Design tokens | [src/app/globals.css](../../src/app/globals.css) + [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) | Semantic CSS variables (`--surface`, `--ink-body`, `--accent`, etc.) |
| Type definitions | [src/lib/types.ts](../../src/lib/types.ts) | `VirgilSidecar`, `EditorStateData`, `Suggestion`, `ReviewRequest`, `Link`, etc. |

Before adding a new panel, link kind, or theme, extend the registry instead of creating a parallel table.

## Key hooks

All in `src/hooks/`. Full list (41 files) is large; these are the ones most often touched:

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
| `useCutter` | Cut items |
| `useWordCount` | Live word counts by section |
| `usePoppedCards` | Floating card registry (reads `prefs.poppedOutCards`) |
| `useLinkHighlight` | Hover/selection highlight coupling between text and margin icons |
| `useViewPrefs` | Panel visibility, layout state, placements, all user-layout prefs |
| `usePersistentState` | IndexedDB persistence abstraction |
| `useInTextPositions` | Omni-view positioning |
| `usePristineCardManager` | Tracks freshly-created cards so they auto-discard if closed without edits; exposed via the `pristine-cards` context |

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
| `suggestions.json` | AI line-edit proposals | Suggestions panel; `y`/`n`/`s` keyboard controls |
| `revisions.json` | Comment threads (anchored or paper-wide) | Revisions panel |
| `ai-requests.json` | Queued requests for an agent to resolve | Per-panel "ask" affordances (Footnotes, Notes, Quotations, Citations, Todo) |
| `bib-review-requests.json` | Per-entry bibliography field/note reviews | Bibliography cards |
| `editor-state.json` | Cursor position, selection, misc editor state | Restored on reopen |

Agents never touch this app — they read the same `.tex`/`.bib` and write these sidecars. Virgil polls/watches and surfaces changes.

## Panel / card rendering

Entry points for rendering a panel instance:

1. **Sidebar-mounted**: `renderPanelWithChrome(panelId, side)` in EditorLayout (around line 3524).
2. **Floating**: same function, wrapped in `FloatingPanel`, mounted as portal (~line 4962).

Cards inside a `CardListPanel`:
1. **In list** — iterated by `renderCard(item)`.
2. **In-text** — positioned via `inTextRenderItem` (uses `useInTextPositions`).
3. **Popped out** — registered in `prefs.poppedOutCards` with key `${keyPrefix}:${id}`; rendered via `FloatCard` from [src/components/FloatingCards.tsx](../../src/components/FloatingCards.tsx).

Popout key prefixes (DO NOT rename without migration — they're persisted):
`note`, `footnote`, `archive`, `todo`, `bib`, `citation`, `revision`, `quotation`, `cut`, `ai`, `error`.

## Panel context

`PanelChromeProvider` in `panel-primitives.tsx` injects the current panel id so context-aware buttons (`PanelPopout`, `PanelClose`) know which panel they belong to without prop drilling.

## Card creation + pristine cards

Two related abstractions, both mounted in EditorLayout:

- **`cardCreation` context** ([contexts/card-creation.tsx](../../src/components/editor-layout/contexts/card-creation.tsx) + [card-actions/card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts)) — collapses the historical "create + select + pop-at-anchor" dance into single `cardCreation.createNote/createCut/createTodo/createFootnote/createCitation/createQuotation` calls. Each handler on the Actions toolbar and the Margin toolbar routes through it, so creation behavior stays consistent across entry points.
- **`pristine-cards` context** + `usePristineCardManager` — tracks cards that were just created but never edited by the user; auto-discards them if the user closes/blurs without typing. Every card-bearing hook (`useNotes`, `useCutter`, `useTodos`, `useQuotations`, `useCitations`, `useFootnotes`) plugs into this.

## System dialog primitive

[src/components/system-dialog.tsx](../../src/components/system-dialog.tsx) + [src/components/system-dialog-host.tsx](../../src/components/system-dialog-host.tsx) provide a shared modal primitive. `ConfirmDialog`, `NewDocumentModal`, `TexFilePickerModal`, and `DocumentClassMismatchDialog` are thin wrappers over it. See [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md) for the dialog conventions.

## Per-panel color overrides

Users can recolor any panel via the header color picker. The override routes through `deriveCardPalette` in [src/lib/panel-theme.ts](../../src/lib/panel-theme.ts), which derives a full card palette (marker, badge, border, header, selected variants) from a single accent color.

## Drag / drop MIME map

Paragraph-level anchor drops trigger the vertical drop indicator. Inline-insert drops don't. Both sets live in [src/lib/marginalia.ts](../../src/lib/marginalia.ts):

- **`ANCHOR_DRAG_TYPES`** (vertical indicator): marginalia-move, quotation, note, todo, archive-anchor, cut.
- **Inline-insert**: quote, citation, archive (restore), footnote, ai-request, text-insert.

When wiring a new draggable type, pick a category and register it — the drop indicator behaves correctly for free.

## Preview / dev caveats

From the existing memory: the File System Access folder picker doesn't work inside the preview iframe. For UI verification, load the dev doc (`virgil-data/doc_devtest`) via the helper, not the picker. Worktrees need the symlink present; see `dev_doc_loading.md` in the agent's personal memory.

## Where NOT to look for business logic

- `src/app/` — almost pure Next.js scaffolding (manifest, layout, page, global styles). Real work happens in `components/`, `hooks/`, `lib/`, `links/`, `panels/`.
- Top-level config files (`next.config.ts`, `tsconfig.json`, `tailwind.config.*`) — only relevant when changing build/bundling behavior.

## Related docs

- UI structure → `ui-chrome.md`
- Editor content → `main-text.md`
- User vocabulary → `glossary.md`
- Project README → [README.md](../../README.md)
- Style guide → [src/STYLE_GUIDE.md](../../src/STYLE_GUIDE.md)
