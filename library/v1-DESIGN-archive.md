# Virgil Library

A per-user, local-first store of PDFs referenced by your writing — with
page-accurate linearized text, citation alignment, and per-document
notes. The Library appears as a **shadow tab** paired with each document
tab.

This doc captures the concept, goals, architecture, and what v1 leaves
on the table. Update it whenever a Library-related decision feels
generalizable.

---

## Concept

While writing a document in Virgil, you accumulate a bibliography of
sources. The Library is where those sources *physically* live — not as
entries in a `.bib` file, but as actual PDFs with extracted text,
searchable and cross-referenced against the document's citations.

Each open document tab in Virgil has a sibling "Library" pill attached
to the right. Clicking it flips the main editor area into a split view:
a list of library items on the left, a detail pane (metadata, per-doc
notes, page-marked linearized text) on the right. Closing the pill
collapses it back to a `+Lib` affordance next to the doc tab.

## Goals

1. **Storehouse** — one folder on disk, user-picked, holds every PDF
   the user has referenced across every Virgil document.
2. **Linearization** — every PDF is converted to JSON with
   **paragraph-granular** text and **print page numbers** (the ones the
   publisher printed, not PDF page indexes — falling back to PDF page
   numbers when the PDF has no printed page numbers).
3. **Searchable foundation** — (deferred to v2) the linearized text is
   the substrate for quote-building, annotated bibliographies, and
   summaries. v1 stores it well so that later tooling has something
   coherent to read.
4. **Citation alignment** — a view that shows which `.bib` entries in
   the current doc have a PDF in the library, which don't, which
   library items are processing, and which have no matching `.bib`
   entry at all. Surfaces the gap.

## Non-goals (v1 explicitly)

- Virgil does **not** run OCR, text extraction, or citekey inference.
  Cowork owns that.
- No embedded PDF viewer in the detail pane — text-only preview.
- No search/quote-building UI.
- No Quotations-panel integration (`Quote.libraryItemId`, "Add as
  Quotation" from a library passage) — the existing Quotations panel
  is untouched.
- No in-editor `\cite{}` hover popovers surfacing library status.
- No cross-document aggregation of notes or quotes.
- No `Cmd-L` keybind to toggle doc↔library pane (noted optional, dropped
  from v1 to avoid stomping the browser's address-bar shortcut; consider
  `Alt-L` when we bring it back).

## Division of labor

| Responsibility | Virgil (this code) | Cowork (backend) |
|---|---|---|
| Pick library folder | ✓ | |
| Read manifest & item files | ✓ | |
| List/detail UI | ✓ | |
| Citation alignment (visual) | ✓ | |
| Per-doc overlay (notes) | ✓ | |
| Drop PDF into inbox/ | ✓ | |
| Watch inbox/, extract, OCR | | ✓ |
| Assign UUID per item | | ✓ |
| Produce `meta.json`, `text.json` | | ✓ |
| Infer / assign `citekey` | | ✓ |
| Maintain `library-index.json` | | ✓ |

Virgil is strictly a reader of the library folder (plus writes into
`inbox/`). Cowork is the only writer of item folders and the manifest.

---

## Filesystem contract (Virgil-defined)

One user-picked folder, shared across every open document. Cowork reads
and writes; Virgil reads and drops into `inbox/`.

```
<libraryFolder>/
├── library-index.json         # authoritative manifest — Virgil polls this
├── <uuid>/
│   ├── source.pdf             # original PDF
│   ├── meta.json              # richer than manifest row; read on demand
│   ├── text.json              # paragraph-granular linearization
│   └── status.json            # optional, diagnostic only
├── <uuid>/
│   └── …
└── inbox/                     # Virgil writes here; Cowork consumes
    └── some-paper.pdf
```

**Keying is by UUID**, not citekey or filename. Citekeys are mutable
(Cowork assigns and may revise) and filenames are user-facing (and
therefore unreliable).

### `library-index.json`

The single file Virgil polls. Cowork rewrites it whenever item state
changes. Everything Virgil's list view needs lives on this row:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-04-20T12:34:56Z",
  "items": [
    {
      "id": "0f3a…",                // UUID folder name
      "status": "ready",            // pending | extracting | ocring | ready | failed
      "citekey": "Smith2020",       // optional, Cowork-assigned
      "title": "…",
      "authors": ["…"],
      "year": 2020,
      "doi": "…",                   // optional
      "pageCount": 24,
      "hasPrintPageNumbers": true,  // false → text.json uses pdfPage everywhere
      "updatedAt": "2026-04-20T12:30:00Z"
    }
  ]
}
```

Virgil tolerates a missing or malformed manifest — both render as an
empty library (the UI shows "drop PDFs here or use +PDF").

### `<uuid>/meta.json`

Superset of the manifest row: adds `abstract`, `publisher`, `journal`,
`volume`, `issue`, `isbn`, `url`, `bibtex`, plus a free-form `extra`
record. Read only when the user selects the item.

### `<uuid>/text.json`

The linearization contract. Array of pages, each with an array of
paragraphs:

```jsonc
{
  "itemId": "0f3a…",
  "pages": [
    {
      "printPage": "42",          // string — roman numerals possible (xiv)
      "pdfPage": 50,              // 1-indexed PDF page
      "printPageMissing": false,  // true → printPage falls back to pdfPage
      "paragraphs": [
        { "id": "p1", "text": "…", "kind": "body" }
        // kind ∈ body | heading | footnote | caption | list-item
      ]
    }
  ]
}
```

`printPage` is a **string** so Cowork can emit roman numerals for front
matter and preserve original formatting (e.g., "42a"). Paragraph `id` is
stable within the item so future tooling can point at a passage (quotes,
annotations) via `(itemId, paragraphId)`.

### `<uuid>/status.json` (optional)

Human-readable diagnostic detail. Not authoritative — the manifest's
`status` wins. Useful for surfacing OCR errors:

```jsonc
{
  "status": "failed",
  "message": "Encrypted PDF",
  "error": "…",
  "updatedAt": "…"
}
```

---

## Virgil-side architecture

### Module layout

```
src/lib/library/
├── DESIGN.md              ← you are here
├── library-types.ts       ← all shared types
├── library-folder.ts      ← pick + persist the global folder handle
├── library-manifest.ts    ← readManifest(handle) → LibraryManifest
├── library-item.ts        ← readItemMeta / readItemText / readItemStatusDetail
├── library-alignment.ts   ← citekey ⇄ bib-key matching helpers
└── library-inbox.ts       ← copyToInbox / copyAllToInbox

src/hooks/
├── useLibrary.ts          ← global manifest store (module-level singleton)
└── useLibraryOverlay.ts   ← per-doc notes sidecar

src/components/library/
├── LibraryTabView.tsx     ← orchestrator — list + detail split
├── LibraryListRow.tsx     ← one row
├── LibraryDetailPane.tsx  ← metadata, notes, text preview
├── LibraryFolderPicker.tsx← first-run picker
├── LibraryPermissionGate.tsx
└── BibLibraryChip.tsx     ← rendered inside BibEntryCard
```

### Data flow

1. **Handle discovery.** On first use, `useLibrary` reads
   `library-folder-handle` from IndexedDB. If absent →
   `folderState: 'none'` → `<LibraryFolderPicker />` renders. If present
   but permission is `'prompt'` or `'denied'` →
   `folderState: 'needs-permission'` → `<LibraryPermissionGate />`.
   Otherwise `'ready'` and we load the manifest.
2. **Manifest polling.** `useLibrary` is backed by a module-level store
   (`useSyncExternalStore`) so every Library tab across every doc shares
   the same manifest data. Refresh triggers:
   - once on first mount,
   - on `window.focus`,
   - every 8s while the hook has subscribers,
   - manually via the **Refresh** button or after an `+PDF` drop.
3. **Per-item reads.** `LibraryDetailPane` lazy-reads `meta.json` and
   (if `status === 'ready'`) `text.json` via `readItemMeta` /
   `readItemText` when the user selects an item. Invalidation key is
   `library.revision`, which bumps on every manifest re-read.
4. **Per-doc overlay.** `useLibraryOverlay(docId)` reads/writes
   `virgil/library-overlay.json` inside the doc's project folder. v1
   tracks only `notesByItemId: Record<itemId, markdown>`.

### Tab-strip integration

`TabsState` in [doc-index.ts](doc-index.ts) gained two fields:

- `libraryOpenFor: string[]` — doc ids with the pill currently attached.
- `activePane: 'doc' | 'library'` — which half of the current pair is
  visible.

`useFiles` owns this state and exposes `openLibraryFor`,
`closeLibraryFor`, `activateDocPane`, `activateLibraryPane`, and
`toggleActivePane`. Opening a doc auto-pairs its library; closing a doc
closes its library.

`EditorLayout` renders each doc tab together with either:

- an attached library **pill** (when the library is open for that doc), or
- a tiny `+Lib` button (when closed).

When `activePane === 'library' && currentDocId`, the main content area
renders `<LibraryTabView docId={currentDocId} />` instead of the editor
or code view.

### Bibliography-panel integration

`BibEntryCard` gained an opt-in `libraryChip` slot in its header.
`BibliographyPanel` uses `useLibraryItems()` to build a
citekey → manifest-item map, then renders a `<BibLibraryChip />` per
entry:

| Chip | Meaning |
|---|---|
| `✓ library` (green) | Cowork has processed an item with this citekey. |
| `⋯ processing` (amber) | Item exists but status is pending / extracting / ocring. |
| `! failed` (red) | Cowork failed to process this item. |
| `— no PDF` (gray) | No library item carries this citekey. |

### Cross-navigation via window events

Rather than thread callbacks through the deep bibliography prop tree,
chip clicks dispatch a window `CustomEvent<'virgil-open-library'>` with
payload `{ citekey?, itemId? }`. Two listeners:

- **`EditorLayout`** calls `activateLibraryPane(currentDocId)` to flip
  the pane.
- **`LibraryTabView`** resolves the `itemId` (directly, or by looking
  up `citekey` in the manifest), sets it as selected, and resets the
  filter so the row is visible. If no match → filters to "unmatched"
  so the user can see the gap.

This pattern is a good candidate to generalize if other panels need
cross-navigation later (e.g., notes → library, editor → library).

### Ingestion — `+PDF` / Finder drop

Two entry points, both land in the same place:

- **In-app +PDF button** (`LibraryTabView`) — calls
  `showOpenFilePicker` (PDFs, multi-select), then `copyAllToInbox`
  writes each File into `<libraryFolder>/inbox/`. Name collisions get a
  timestamp suffix rather than silent overwrite.
- **Finder drop** — user places PDFs directly in the library folder
  (usually `inbox/`). Cowork is expected to watch the folder and move
  them under new UUIDs.

Virgil never creates or modifies item directories itself.

---

## What Cowork has to produce, minimally, for v1 to be useful

1. A valid `library-index.json` with at least one item at
   `status: 'ready'`.
2. That item's folder must contain `meta.json` (at least `id` and
   `title`) and `text.json` matching the shape above.
3. For alignment to light up, the item's `citekey` must equal a key in
   the current doc's `references.bib`.

Everything else (authors, year, DOI, abstract, `hasPrintPageNumbers`)
degrades gracefully.

---

## Future phases

### Phase 2 — Quotations & quote-pulling

- Extend `Quote` in `src/lib/types.ts` with optional `libraryItemId` and
  structured `printPage` / `paragraphId` fields.
- "Add as Quotation" button in `LibraryDetailPane` turns a selected
  passage into a Quotations-panel card bound to the library item.
- Quotations panel surfaces each quote's library back-link (click →
  library tab → jump to paragraph).

### Phase 3 — Search

- Client-side lexical search (MiniSearch) over all `text.json` files;
  indexed lazily as the detail pane is first opened.
- Results grouped by library item, snippets show print-page numbers.
- Optional Cowork-side semantic search as a second channel, same UI.

### Phase 4 — Editor ↔ library weaving

- Hover a `\cite{key}` in the editor → popover with library status
  (`✓ library / ⋯ processing / — no PDF`) and a one-click jump.
- Missing PDFs surface a "Find for me" button that hands off to Cowork
  (DOI resolver, arXiv, Unpaywall).
- Library rows gain a "cite this in current doc" affordance that
  inserts `\cite{key}` at the editor cursor.

### Phase 5 — Richer overlays

- Per-doc tags and reading status (`read`, `skim`, `todo`, `verified
  quote`).
- Cross-doc aggregation ("show everywhere I've used this paper").
- Per-doc quote inventory synced with the Quotations panel.

### Phase 6 — Embedded PDF viewer

- Right-click a paragraph in the text preview to open that page in an
  embedded pdfjs viewer, so the user can verify Cowork's linearization
  against the source.

### Phase 7 — Writable Cowork channel

- Promote the inbox from "drop PDFs" to a full request channel:
  Virgil writes intent files (`inbox-request.json`) expressing what
  PDFs to fetch, what citekeys to try first, etc. Cowork answers by
  updating the manifest.

---

## Known trade-offs and pending decisions

- **Polling cost.** 8-second polling is wasteful when the manifest is
  stable. Consider a `manifest-version.txt` one-byte file Cowork bumps,
  so Virgil only re-reads the full JSON on change.
- **Multiple Library tabs polling independently.** Each mounted
  `useLibrary` subscriber runs its own interval. Not incorrect, but at
  scale move to a single ref-counted interval.
- **Global vs per-doc permission coupling.** Today the Library tab only
  renders once the document's folder permission is granted (because
  `LibraryTabView` uses `useCitations(docId)` to read `references.bib`).
  Acceptable for v1, but a user should be able to browse the library
  even without doc permission. Fix by making the bib-join lazy.
- **Chip-click jump across docs.** An event dispatch activates the
  library pane for the *current* doc. If the user wants to inspect a
  library item while a different doc is active, they need to switch
  tabs first. Acceptable.
- **Notes are plain text.** Markdown would be fine; rich text would
  conflict with the existing notes sidecar conventions. v1 ships
  plaintext; future work can swap to the same `normalizeRichContent`
  pipeline `useNotes` uses.
- **UUID opacity in Finder.** Users peeking in the folder see
  `0f3a-…/source.pdf`, not `Smith2020.pdf`. Cowork could symlink a
  human-readable copy, or Virgil could offer an "Open in Finder" that
  resolves the item to its folder.

---

## Verification checklist

- **Folder flow.** Open any doc → `+Lib` appears. Click → picker
  renders → pick a folder → tab renders (empty state). Reload → folder
  remembered, permission re-grant only if revoked.
- **Manifest flow.** Drop a hand-crafted `library-index.json` + one
  `<uuid>/` folder into the library folder → after focus / refresh the
  list populates. Edit the manifest → next refresh picks it up.
- **Pair flow.** Open doc → pill auto-pairs. Close pill → doc stays.
  Close doc → pill disappears. Click doc tab vs pill → pane swaps.
- **Alignment.** `references.bib` has `Smith2020`; manifest item's
  `citekey` is `Smith2020` → row shows "cited here"; Bibliography panel
  row shows `✓ library`. Click the chip → Library pane activates with
  that item selected.
- **Overlay.** Type notes into the detail pane → switch docs and back →
  notes persist; check the file at `<doc>/virgil/library-overlay.json`.
- **Detail read.** Click a row → `meta.json` and `text.json` load;
  pages render with print-page headers; missing `text.json` shows a
  status message instead of crashing.
- **Add PDF.** Click `+PDF` → pick a PDF → file appears in
  `<libraryFolder>/inbox/`. Manifest is unchanged until Cowork
  processes.
