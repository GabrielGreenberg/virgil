<!-- persistence-plan.md — implementation plan for the unified Library view-session store -->
<!-- Author: plan synthesizer. Anchored to code at HEAD 932251c (2026-06-19). -->
<!-- Companion audit: docs/memos/library-audit/AUDIT.md -->

# Unified Library view-session persistence — implementation plan

Goal (user Ask #1): the Library tab's local view state survives a full page reload.
Principle: **ONE coherent, versioned store**, not N scattered `useState` + `localStorage`
effect pairs. This document is a build spec — a future session implements it without
re-deriving anything. Every claim below is anchored to code read at HEAD `932251c`.

The four genuine reload-losses to fix:

| # | loss | owner today |
|---|------|-------------|
| 1 | `selectedKeys` / `anchorKey` row highlight | `library/components/LibraryView.tsx:256,259` (plain `useState`) |
| 2 | search query | `library/components/LeftList.tsx:66` (`useState('')`, also dies on tab switch) |
| 3 | catalog-list scroll + reader scroll | `library/components/LeftList.tsx:299` / `library/components/PaperRender.tsx:214` |
| 4 | `leftPinnedActiveId` (left active-tab override) | `library/hooks/useLibraryTabs.ts:239` (`useState(null)`) |

---

## 1. Decision: Library-local store, NOT a main-app helper

**Build a small Library-local store in `library/lib/` that MIRRORS the `useViewPrefs`
reducer shape. Do not import a main-app helper.** Three reasons (research B, confirmed
against code):

1. **Silo boundary.** `library/CLAUDE.md` sanctions exactly three cross-silo bridges
   (`@/lib/tiptap-extensions`, `@/components/Editor`, `@/components/editor-layout/chrome-*`,
   all for Reader inheritance) and says "Avoid reaching into other Virgil internals …
   without a similar architectural justification." `src/hooks/usePersistentState.ts`
   and `src/hooks/useViewPrefs.ts` are not on the allow-list, and there is no Reader-
   inheritance justification — this is the Library tab's own list/selection state.

2. **Wrong substrate.** `usePersistentState` (`src/hooks/usePersistentState.ts:84`) and
   `useEditorUIState` are FSA-sidecar hooks hard-bound to a `DocWriteHandle` + Virgil
   `docId` (`getActiveHandle`, `writeSidecar`). Library view-state is per-machine
   `localStorage` by deliberate design (`library/CLAUDE.md`: "Panel-tab layout, column
   widths, and row-viewed state stay in localStorage — those are genuinely per-machine
   UI preferences"). The Library tab has no `docId`/handle for its list view. Importing
   the sidecar hooks is a category error.

3. **The right template proves out in-silo.** `useViewPrefs.ts:648-725` is the canonical
   "ONE object + ONE `update(fn)` reducer + ONE `loadPrefs()` versioned hydrator"
   implementation. The Library already owns every primitive to clone it locally: the
   `virgil-library-` key prefix + `scope` idiom (`library/lib/library-store.ts:289`),
   the same-window re-read fan-out via `CustomEvent` (`library-store.ts:211,222`), and
   the validate-on-load / try-save / SSR-guard idiom (`list-columns.ts:174-225`,
   `row-viewed-store.ts`).

**What we MIRROR from each template:**

- From `useViewPrefs`: single object behind one reducer; per-scope vs global split by
  an allow-list classification at persist time; deep-merge-with-defaults + a numeric
  version field in the loader (`loadPrefs`, `useViewPrefs.ts:334-646`).
- From `usePersistentState`: the debounce + flush contract (`usePersistentState.ts:192-237`).
- From `useDocument`: the `pagehide` (do-work) + `visibilitychange` flush pair
  (`useDocument.ts:201-255`), gated on a "there's pending work" sentinel.

**Critical divergence from `useViewPrefs`:** `useViewPrefs` is a React hook with
`useState` + a mount effect. The Library store must be a **module-level singleton over
`useSyncExternalStore`, NOT React context/useState/provider.** See §2 (mount point) for
why — the remount topology is the primary risk.

---

## 2. The store

New file: **`library/lib/view-session-store.ts`** — a module-level singleton (lazy-init
on first import/`getSession()`), exposing imperative mutators + `useSyncExternalStore`-
based React hooks.

### storageKey

```
virgil-library-view-session
```

### Versioned blob shape (TypeScript)

```ts
// ── id vocabulary (reuse existing — no new key space) ────────────────────
//  libId values come straight from the existing id space:
//    'central'                      → CENTRAL_LIBRARY_ID (library-store.ts:14)
//    'lib-<ts>-<rand>'              → custom libraries (newLibraryId, library-store.ts:354)
//    'paper:<citekey>'             → paperLibraryId (library-store.ts:121)
//    'project:doc:<docId>'         → projectLibraryIdForDoc (library-store.ts:27)  [see race note 5]
//  scope keys:
//    ''                            → singleton inline Library tab (unscoped — matches
//                                    useLibraryTabs scope===undefined, library-store.ts:290)
//    'outer:<libId>'               → a tear-out outer-tab instance (its useLibraryTabs scope)

import type { SortColId, SortDir, ResizableColId } from "@library/lib/list-columns";

const SCHEMA_VERSION = 1 as const;

interface PanelTabsState {           // mirrors library-store.ts PanelTabsState
  openIds: string[];
  activeId: string;
}

interface ListView {
  // sort is per-(panel,libId) — the coherence fix (see §6). Optional so an
  // un-touched list inherits the default {col:'year',dir:'desc'} (loadSort fallback).
  sort?: { col: SortColId; dir: SortDir };
  // query is per-(panel,libId) so each library remembers its own filter and it
  // survives the LeftList per-tab remount (§5).
  query?: string;
  // scrollTop is per-(panel,libId). For a paper list this is the catalog rows
  // container; for a paper:<citekey> "list" this is the reader scroll (§5).
  scrollTop?: number;
}

interface PanelState {
  tabs: PanelTabsState;              // Tier B only; absent/ignored in Tier A (§6)
  leftPinnedActiveId?: string | null; // left panel only; undefined on right
  selectedKeys: string[];           // per-PANEL row highlight (research A; open Q3)
  anchorKey: string | null;         // shift-click pivot; travels with selectedKeys
  lists: Record<string, ListView>;  // keyed by libId (the vocabulary above)
}

interface ScopeState {
  left: PanelState;
  right: PanelState;
}

export interface LibraryViewSession {
  schemaVersion: 1;
  scopes: Record<string, ScopeState>;  // '' = singleton, 'outer:<libId>' = tear-out
  // ── global slices (singleton-only writers today; kept global) ──────────
  paperPinned: string[];            // paper:<citekey> ids — virgil-library-paper-pinned
  projectHidden: string[];          // project:doc:<docId> ids — virgil-library-project-hidden
  projectPinned: string[];          // project:doc:<docId> ids — virgil-library-project-pinned
  citedOnly: boolean;               // virgil-library-project-cited-only
  layout: {
    navWidth?: number;              // virgil-library-nav-width
    middleWidth?: number;           // virgil-library-left-width (back-compat name)
    papersHeight?: number;          // virgil-library-papers-height
    colWidths?: Partial<Record<ResizableColId, number>>; // virgil-library-col-widths
  };
}
```

Rationale for the shape (research A, verified): panels keyed `left`/`right` under a
`scope` mirror `useLibraryTabs`' `leftTabs`/`rightTabs` + the `scope` param exactly
(`useLibraryTabs.ts:227-230,303-308`). Per-library `ListView` is keyed by the SAME id
space already used everywhere, so no new vocabulary. Pins/hidden/citedOnly are global
because they ARE global in today's code (singleton-only writers, gated on
`projectsEnabled`, `useLibraryTabs.ts:290-320`).

### API surface

```ts
// ── snapshot + subscription (module singleton) ───────────────────────────
export function getSession(): LibraryViewSession;       // sync; lazy-init + migration once
export function subscribe(fn: () => void): () => void;

// ── granular mutators (each: read-modify-write in-memory → notify → arm write)
export function setPanelTabs(scope: string, panel: PanelKey, tabs: PanelTabsState): void; // Tier B
export function setSelection(scope: string, panel: PanelKey,
  sel: { selectedKeys: string[]; anchorKey: string | null }): void;
export function setLeftPinnedActiveId(scope: string, id: string | null): void;
export function setListSort(scope: string, panel: PanelKey, libId: string,
  sort: { col: SortColId; dir: SortDir }): void;
export function setListQuery(scope: string, panel: PanelKey, libId: string, q: string): void;
export function setListScroll(scope: string, panel: PanelKey, libId: string, top: number): void;
export function togglePaperPin(id: string): void;
export function setProjectHidden(ids: string[]): void;   // or add/remove helpers
export function setProjectPinned(ids: string[]): void;
export function setCitedOnly(v: boolean): void;
export function setLayout(patch: Partial<LibraryViewSession["layout"]>): void;
export function flushNow(): void;                        // clear timer + write immediately

// ── React hooks (layered on useSyncExternalStore) ────────────────────────
export function useLibraryViewSession(): LibraryViewSession;          // whole snapshot
export function usePanelSelection(scope: string, panel: PanelKey):    // selectedKeys+anchor+setter
  { selectedKeys: ReadonlySet<string>; anchorKey: string | null;
    setSelection: (keys: ReadonlySet<string>, anchor: string | null) => void };
export function useListView(scope: string, panel: PanelKey, libId: string):
  { sort: { col: SortColId; dir: SortDir }; query: string; scrollTop: number;
    setSort: (s: { col: SortColId; dir: SortDir }) => void;
    setQuery: (q: string) => void; setScroll: (top: number) => void };
export function useLayoutPrefs():
  { layout: LibraryViewSession["layout"]; setLayout: (p: Partial<...>) => void };
export function useLibraryViewSessionFlush(): void;       // registers pagehide/visibilitychange
```

Each selector hook calls `useSyncExternalStore(subscribe, getSnapshot)` with a
**cached-equality `getSnapshot`** (return the same object reference when the relevant
slice is unchanged) so a panel-A change does not re-render panel-B consumers. The
mutators rebuild only the touched slice immutably (new refs along the changed path,
shared refs elsewhere) to make the cached-equality cheap.

### Mount point

**NONE in the React tree.** The store is a module singleton, lazily initialized on first
import / first `getSession()` (reads `localStorage` once, runs the Tier-A read-through
seed once behind an `initialized` flag). This is load-bearing: `LibraryTabView`
(`src/components/EditorLayout.tsx` ~4215, `key={currentDocId}`) and `LibraryOuterView`
re-key on `currentDocId`, and the entire `activePane` block is conditionally mounted —
so **every** Library React mount point FULLY REMOUNTS on doc-switch / pane-toggle. A
context/provider/`useState` store living above the consumers but below that boundary
would lose its in-memory state on those remounts — reproducing the exact in-session
loss this work fixes (and the `cited-only` reset already observable through the
`ProjectLibraryProvider` remount, `project-library-context.tsx:84`). The singleton
survives every remount; consumers just subscribe.

`useLibraryViewSessionFlush()` is mounted ONCE (in `LibraryView`, or `LibraryApp`)
purely to register `pagehide` + `visibilitychange` listeners. It is idempotent — safe
even if two Library instances mount it (inline `''` scope + a tear-out `outer:<libId>`),
because the writer is debounced and serializes the single blob.

### Debounced write + flush-on-pagehide

Mirror `usePersistentState.ts:192-225` (debounce) + `useDocument.ts:201-255` (flush):

- One shared trailing timer (~**250 ms**) for ALL mutators. Each mutator updates the
  in-memory `LibraryViewSession` synchronously, calls listeners (UI is instant), and
  arms the one timer. On fire, the whole blob is serialized to `localStorage` once.
  This collapses per-keystroke (`setListQuery`) and per-scroll-frame (`setListScroll`)
  churn into ≤1 write / 250 ms.
- `flushNow()` clears the timer and writes immediately. Registered on **`pagehide`**
  (the do-work event) AND **`visibilitychange`** (when `document.hidden`), each gated on
  a "pending write exists" sentinel (`timer !== null`) exactly like
  `useDocument.ts:212`. So a reload/close right after a change is never lost.
- All `localStorage` access in `try/catch` (private-mode / quota safe). Never write on
  read.

Note: research B floated "write-through synchronous for low-frequency gestures, debounce
only the two scroll writes." This plan uses ONE 250 ms debounce for everything — simpler,
one code path, and the `pagehide`/`visibilitychange` flush makes it durable. (The
`localStorage.setItem` is synchronous so a flush always lands before unload.)

### Restore + restore-race tolerance

Restore is **synchronous at the store level**: `getSession()` is a single memoized
`localStorage` read on first access — there is no async restore race in the store. The
store holds plain ids/strings and never blocks on async resources, so late-resolving
deps are tolerated *by construction*. Consumers read their slice on mount; the four
late-resolution cases are handled at the consumer (all already have the right guard
today — KEEP them):

1. **Disk-library manifests hydrate async** (`useDiskLibraries` mount + 6 s poll; FSA
   handle arrives after the permission gate). A restored custom-lib `openId` may not be
   in `libraryById` yet. KEEP the existing `tabDefs` filter
   (`TabbedLibraryPanel.tsx:120-124`, `.filter((l): l is Library => Boolean(l))`) that
   drops unknown ids from RENDER, and CRITICALLY **never prune unknown ids from the
   persisted `openIds`** — only `close()` prunes. The tab reappears once the manifest
   loads, exactly as `tabDefs` self-heals today (the id is never removed from storage).
2. **`selectedKeys`/`anchorKey` restored before `mergedEntries` populated.** Rows don't
   exist yet → `selectedKeys.has(key)` (`LeftList.tsx:322`) no-ops → highlight lights up
   when the catalog row appears. On restore, the consumer filters the restored keys
   against live `mergedEntries` first so keys that NEVER appear (post-delete/reindex)
   are dropped.
3. **`scrollTop` restored before content height exists.** A one-shot layout-effect waits
   for the first non-empty render and a real scrollHeight (§5).
4. **`leftPinnedActiveId` restored before its tab is in `displayedLeftTabs`.** The
   existing `pinned && openIds.includes(pinned)` guard
   (`useLibraryTabs.ts:386`) makes it a no-op until the tab resolves. KEEP it.
5. **`project:doc:*` ids must still be stripped from any restored `openIds`** — they're
   derived, not stored (`library-store.ts:317`, `useLibraryTabs.ts:367-383`). In Tier A
   this is untouched (tabs stay on the legacy path). In Tier B the store's tab seed must
   re-apply this strip + the empty-`openIds`→`activeId=''` normalization.

---

## 3. Full state inventory

| item | current owner (file:line) | persistence today | decision | scope |
|------|---------------------------|-------------------|----------|-------|
| `selectedKeys` (row highlight) | `LibraryView.tsx:256` | none | **add-to-store** | per-panel |
| `anchorKey` (shift-click pivot) | `LibraryView.tsx:259` | none | **add-to-store** | per-panel |
| search query | `LeftList.tsx:66` | none | **add-to-store** | per-panel-per-library |
| catalog-list scroll | `LeftList.tsx:299` | none | **add-to-store** | per-panel-per-library |
| reader (paper) scroll | `PaperRender.tsx:214` (`data-virgil-row-scroll`) | none | **add-to-store** | per-panel-per-library (`paper:<citekey>`) |
| `leftPinnedActiveId` | `useLibraryTabs.ts:239` | none | **add-to-store** | per-panel (singleton left only) |
| left inner tabs (openIds+activeId) | `useLibraryTabs.ts:227`; `library-store.ts` `load/savePanelTabs` (`virgil-library-tabs-left[-scope]`) | localStorage | **subsume (Tier B)** | per-panel |
| right inner tabs (openIds+activeId; split signal) | `useLibraryTabs.ts:230`; `library-store.ts` (`virgil-library-tabs-right[-scope]`) | localStorage | **subsume (Tier B)** | per-panel |
| paper-tab pin flags | `useLibraryTabs.ts:155,224,319` (`virgil-library-paper-pinned`) | localStorage | **subsume (Tier A seed; Tier B own)** | global |
| project-tab hidden flags | `useLibraryTabs.ts:150,246,311` (`virgil-library-project-hidden`) | localStorage | **subsume (Tier A seed; Tier B own)** | global |
| project-tab pin flags | `useLibraryTabs.ts:151,252,315` (`virgil-library-project-pinned`) | localStorage | **subsume (Tier A seed; Tier B own)** | global |
| sort column + direction | `LeftList.tsx:68,158-167`; `list-columns.ts` `load/saveSort` (`virgil-library-col-sort`, SINGLE GLOBAL) | localStorage | **subsume (Tier A)** | per-panel-per-library (coherence fix) |
| column widths | `LeftList.tsx:67,208`; `list-columns.ts` `load/saveWidths` (`virgil-library-col-widths`, SINGLE GLOBAL) | localStorage | **subsume (Tier A)** | global |
| cited-only project toggle | `project-library-context.tsx:62,84-106` (`virgil-library-project-cited-only`) | localStorage | **subsume (Tier A)** | global |
| nav / middle / papers-pod widths+height | `LibraryView.tsx:60-72,98-127` (`virgil-library-{left,nav,papers}-*`) | localStorage | **subsume (Tier A, low-pri/deferrable)** | global |
| row-viewed timestamps | `library/lib/row-viewed-store.ts` (`virgil-library-row-viewed-at`) | localStorage | **leave-as-is** | n/a (notification ledger) |
| outer-pane tabs / activePane | `src/hooks/useFiles.ts` (IndexedDB) | indexeddb | **leave-as-is** | n/a (correct tier) |
| custom-library membership/existence | `useDiskLibraries.ts`; `library-storage.ts` (`.virgil/libraries/<slug>.json`) | disk-manifest | **leave-as-is** | n/a (shared durable data) |
| navigator rename-draft (editingId/draftLabel) | `LibrariesNavigator.tsx:70-71` | none | **leave-as-is** | n/a (transient) |
| dragActive / panelDragOver | `LibraryView.tsx:559`; `TabbedLibraryPanel.tsx:283` | none | **leave-as-is** | n/a (transient) |
| viewMode text/pdf + editOpen | `RightDetail.tsx:31-32` (reset on citekey, `:38`) | none | **leave-as-is** | n/a (intentionally ephemeral) |

---

## 4. Per-file change list

### NEW `library/lib/view-session-store.ts`
The module-singleton store: `LibraryViewSession` type + `SCHEMA_VERSION`; lazy init that
reads `localStorage` once + runs the Tier-A read-through seed behind an `initialized`
flag; the version reader (parse in `try/catch`, discard-to-`EMPTY_SESSION` on parse
throw / non-object root / `schemaVersion` missing-or-`!==1`, never throw); a future
`migrateSession(raw)` ladder hook (no-op until v2); `subscribe`/`getSnapshot`; the
granular mutators; the shared 250 ms debounced writer + `flushNow`; the selector hooks
(`useLibraryViewSession`, `usePanelSelection`, `useListView`, `useLayoutPrefs`,
`useLibraryViewSessionFlush`). All `localStorage` access in `try/catch`. Reuse the pure
helpers from `list-columns.ts` (`clampWidth`, default sort) for restore-time validation.

### NEW `library/lib/view-session-store.test.ts`
Unit tests — see §7 test plan.

### `library/components/LibraryView.tsx`
- Replace `useState selectedKeys`/`anchorKey` (`:256,259`) with
  `usePanelSelection(scope, 'left')` and `usePanelSelection(scope, 'right')`. `scope`
  comes from `tabsOptions?.scope ?? ''`.
- `renderPanel(panel)` (`:609`) threads the per-panel selection in; the inline
  `onSelectKeys` (`:619`) routes to `setSelection`. On the first render after restore,
  filter restored `selectedKeys` against `mergedEntries` (drop stale keys).
- The `virgil-open-library` handler (`:269-280`) and the tearout handler keep working;
  `setSelectedKeys`/`setAnchorKey` there become the store mutator.
- Mount `useLibraryViewSessionFlush()` once here.
- (Tier A, optional) Back the three width `useState` (`:98-100`) with `useLayoutPrefs`
  read + `setLayout` write, replacing the `LEFT/NAV/PAPERS` `localStorage` effect pairs
  (`:102-127`) and the `makeResizeHandler` `localStorage.setItem` calls. **Deferrable** —
  these already survive reload; leave untouched to minimize diff if scope must shrink.

### `library/components/LeftList.tsx`
- Replace local `query`/`sort`/`widths` `useState` + the `loadWidths`/`loadSort` hydrate
  effect (`:66-78`) with `useListView(scope, panel, libId)`: `query`, `sort`, `scrollTop`
  come from the store; `setQuery`/`setSort` write through (debounced).
- Widths: read from `useLayoutPrefs` (global); `handleResize` (`:169-217`) writes via
  `setLayout({ colWidths })` on pointer-up instead of `saveWidths`. (`handleSort`
  `:158-167` writes `setSort` instead of `saveSort`.)
- Attach a throttled `onScroll` (~150 ms trailing / RAF-coalesced) to the rows container
  (`:299`) → `setScroll`. Add a one-shot layout-effect to restore `scrollTop` on first
  non-empty render (§5).
- New props required: `scope`, `panel`, `activeLibraryId` (the key for `useListView`) —
  threaded from `TabbedLibraryPanel` (below).

### `library/components/TabbedLibraryPanel.tsx`
- Thread `scope` (new prop from `LibraryView` — `tabsOptions?.scope ?? ''`) + the
  already-known `panel` + `activeLibrary.id` (`:171`) down into `LeftList` (the two
  `LeftList` mounts at `:466`). No behavior change.
- KEEP the `tabDefs` unknown-id filter (`:120-124`) intact for the restore race.
- (cited-only) The `project.citedOnly`/`project.setCitedOnly` it already consumes via
  `useProjectLibrary()` (`:118,443`) now resolve through the store-backed provider — no
  change here beyond that.

### `library/hooks/useLibraryTabs.ts`
- **Tier A:** persist `leftPinnedActiveId`. Seed `setLeftPinnedActiveId` from
  `getSession().scopes[scope].left.leftPinnedActiveId` in the hydrate effect (`:283-299`,
  singleton `projectsEnabled` gate kept); on the existing `setLeftPinnedActiveId`
  call-sites (`:239,411,414,436,685`) also write the store mutator (or add a save effect
  gated on `hydrated && projectsEnabled`, mirroring `:309-320`). KEEP the `:386`
  includes-guard.
- **Tier B (deferred):** swap `loadPanelTabs`/`savePanelTabs` (`:285-308`) and the
  paper/project pin/hidden `saveIdSet` effect pairs (`:309-320`) to store reads/writes,
  preserving the `project:doc:*` strip + empty-`openIds` normalization (§2 race 5) and
  the `projectsEnabled` gates.

### `library/lib/list-columns.ts`
- **Tier A:** no change required — `LeftList` reads sort/widths from the store and only
  USES the pure helpers (`clampWidth`/`gridTemplate`/`sortEntries`/`compareEntries`).
  Leave `load/saveSort`, `load/saveWidths`, `COL_SORT_KEY`, `COL_WIDTHS_KEY` in place
  (read by the Tier-A seed; kept one release for rollback).
- **Tier B:** deprecate/remove the four `load/save*` functions once the store owns sort
  + widths; keep `DEFAULT_WIDTHS`/`clampWidth`/`gridTemplate`/sort logic.

### `library/lib/project-library-context.tsx`
- Replace the `CITED_ONLY_KEY` `useState` + hydrate effect + `setCitedOnly` writer
  (`:84-106`) with `useLibraryViewSession().citedOnly` + `setCitedOnly` mutator. This
  fixes the in-session reset through the provider's remount-on-doc-switch
  (`LibraryTabView key={currentDocId}`) as well as reload. Provider still lives on the
  Virgil side; importing `@library/lib/view-session-store` is fine (it's `library/lib/*`).

### `library/components/PaperRender.tsx`
- Register the reader scroll element (the `data-virgil-row-scroll` div at `:214`,
  `ref={setScrollEl}`) with the store: throttled `onScroll` → `setListScroll(scope, panel,
  'paper:<citekey>', scrollTop)`; one-shot restore after content + EditorPane mount (§5).
  The component already builds `docId = library-paper:${citekey}` (`:210`) and has
  `scrollEl` — it needs `scope` + `panel` + `citekey` threaded in (or a precomputed
  `scrollSessionKey` prop). **Lighter option:** accept an optional
  `scrollSessionKey?: string` prop that the panel computes (`{scope}|{panel}|paper:{citekey}`)
  and the store keys on it directly.

### `library/components/PaperFileBody.tsx` + `library/components/RightDetail.tsx`
- Pass `scope` + `panel` (both already have `citekey`) through
  `PaperFileBody` (`:48`) → `RightDetail` (`:49`) → `PaperRender` (`:235`) so the
  reader-scroll key can be computed. Pure prop-threading — OR thread the single
  `scrollSessionKey` string (lighter; only `PaperRender` consumes it). `RightDetail`'s
  `viewMode`/`editOpen` reset (`:38`) is untouched.

---

## 5. Scroll save/restore mechanics

Two scroll surfaces; BOTH must survive the per-tab `LeftList` remount (`LeftList` only
mounts for the ACTIVE library in a panel — `TabbedLibraryPanel.tsx:466` renders one
`LeftList` for `activeLibrary`, so switching inner tabs unmounts+remounts it) AND reload.
ONE code path serves both (same one-shot non-empty-gated layout-effect + same
`setListScroll` mutator).

### Catalog list (`LeftList.tsx:299`, the `overflowY:auto` rows div)
- **Listener:** `ref` on that exact div; `onScroll` throttled to ~150 ms trailing (or
  RAF-coalesced) → `setListScroll(scope, panel, activeLibId, el.scrollTop)`. The store's
  own 250 ms debounce sits behind that, so list scroll never causes a write storm.
- **Key:** `(scope, panel, libId)` — same id space as the active tab. Because the key
  includes `libId`, switching tabs and returning restores THAT library's position;
  switching to a different library shows its own (or 0).
- **Restore:** `useLayoutEffect` with a one-shot ref `restoredFor` keyed by `libId`. On
  (re)mount, after `filtered` is non-empty AND the element is actually scrollable
  (`filtered.length > 0 && el.scrollHeight > el.clientHeight`), set `el.scrollTop = saved`
  once, then mark restored. **Do NOT restore on an empty / zero-height list** — it would
  clamp to 0 and lose the saved value. If content streams in (catalog 6 s poll), the
  effect re-runs on `filtered` change until the first successful non-empty application.

### Reader (`PaperRender.tsx:214`, the `data-virgil-row-scroll` div)
`PageScrollStrip` (`PageScrollStrip.tsx:53-58`) only READS this `scrollTop` for its
lozenge — it must NOT be the save owner.
- **Listener:** attach to the `data-virgil-row-scroll` div (already has `ref=setScrollEl`).
  Throttled `onScroll` → `setListScroll(scope, panel, 'paper:<citekey>', scrollTop)`.
- **Key:** `(scope, panel, paper:<citekey>)` so each open paper restores independently and
  a left-vs-right open of the same paper can differ.
- **Restore timing:** the paper body is async (tex read → `JSONContent` → `DocPipeline`/
  `EditorPane` mount; `PaperRender.tsx:202-204` returns "Rendering…" until `content`
  resolves). Restore in a layout-effect gated on BOTH content resolved AND `scrollEl`
  present AND `scrollHeight > clientHeight`, one-shot per `(citekey)`. Because
  `EditorPane` mounts children after streaming, wrap the apply in a `requestAnimationFrame`
  (or a short retry that bails after ~1 s) so it lands after first paint.
  `PageScrollStrip`'s lozenge keeps working unchanged (it derives from live `scrollTop`).

---

## 6. Migration — PHASED, idempotent, non-destructive

### TIER A (land NOW — the four reload-losses + the coherence win)

On the store's first `getSession()` with no `virgil-library-view-session` present, run a
one-shot **read-through seed** so a mid-stream user keeps everything:

- `paperPinned` ← `virgil-library-paper-pinned`
- `projectHidden` ← `virgil-library-project-hidden`
- `projectPinned` ← `virgil-library-project-pinned`
- `citedOnly` ← `localStorage['virgil-library-project-cited-only'] === '1'`
- `layout.colWidths` ← `loadWidths()` (`virgil-library-col-widths`)
- `layout.{navWidth,middleWidth,papersHeight}` ← the three width keys
- **col-sort:** seed `loadSort()` (`virgil-library-col-sort`) as the DEFAULT
  `ListView.sort` for the central list of the **singleton scope only**
  (`scopes[''].left.lists['central'].sort`). Every other `(panel,libId)` `ListView`
  starts `sort: undefined` and inherits `{col:'year',dir:'desc'}` until the user sorts
  it — at which point it diverges per-library (the coherence fix).

**Tabs are NOT folded in Tier A.** They keep going through `loadPanelTabs`/`savePanelTabs`
(`library-store.ts:294-344`, `useLibraryTabs.ts:283-308`); the store only ADDS new state
(selection, query, scroll, per-list sort, `leftPinnedActiveId`). This makes Tier A
additive and low-risk — `useLibraryTabs` is barely touched.

**Do NOT delete any legacy key in Tier A.** Write the blob and leave legacy keys in place
for one release as the real fallback.

### TIER B (defer to a follow-up)

SUBSUME the tab state (`loadPanelTabs`/`savePanelTabs` → `scopes[scope].{left,right}.tabs`)
and retire the standalone `col-sort`/`col-widths`/`cited-only`/pins effect pairs. Deferring
is the honest call: folding tabs touches the load-bearing `project:doc:*` stripping
(`library-store.ts:317`), the empty-`openIds` normalization (`:320-324`), the scoped-key
fan-out across the singleton AND every `outer:<libId>` instance, and the cross-instance
`REGISTRY_CHANGED_EVENT` story (`library-store.ts:222`) — the XL surface the audit (§6 C8)
calls a dedicated session. Tier A delivers 100 % of the reported reload-losses (#1)
without that risk; Tier B is pure consolidation. When Tier B lands, the tab seed reads
`loadPanelTabs()` per scope/panel once, writes into the blob, then flips `useLibraryTabs`
to read/write the store; legacy tab keys are deleted only after one release with the
store proven.

### Why the seed is non-destructive + idempotent (explicit argument)

- It runs **only when the blob is ABSENT** (`getSession()` first call with no
  `virgil-library-view-session`), gated by the `initialized` flag. It never overwrites an
  existing blob and never deletes a legacy key. Re-running it (or a second Library mount
  in the same window) is a pure no-op.
- The global→per-scope **col-sort fold is safe** because the ONLY reader of
  `virgil-library-col-sort` is `LeftList` (via `loadSort`, `list-columns.ts:199`). Once
  `LeftList` reads per-`(panel,libId)`, the old single value simply becomes the
  central-list default; nothing else references the global key. It's kept one release for
  rollback.
- Because legacy keys are retained for one release, there are transiently two sources of
  truth — acceptable: the store is authoritative once seeded, and legacy keys are read
  ONLY when the blob is absent (the seed path).
- **No currently-persisted Library state can be lost or corrupted** (the migration-safety
  requirement): the seed is read-only over legacy keys; tabs/registry/disk-manifests/
  IndexedDB are untouched in Tier A; the worst failure mode (the blob fails to write under
  quota) leaves every legacy key intact and the user exactly where they were.

---

## 7. Phased build sequence + test plan

### Build sequence (each phase lands green: `tsc` + `eslint` + vitest)

1. **Store core + tests (no UI wiring).** Add `view-session-store.ts` + the unit test
   file. Implement the type, lazy init, version reader, Tier-A read-through seed,
   mutators, debounced writer, `flushNow`, `useSyncExternalStore` hooks. Ship behind no
   flag (nothing consumes it yet). Land the full §7 test matrix. — **green in isolation.**
2. **Selection (loss #1).** Wire `usePanelSelection` into `LibraryView` (`:256-259,619`);
   add the `mergedEntries` stale-key filter on restore. Mount
   `useLibraryViewSessionFlush()`.
3. **Search query (loss #2).** Wire `useListView().query` into `LeftList`; thread
   `scope`/`panel`/`activeLibraryId` through `TabbedLibraryPanel`.
4. **Sort (coherence fix) + widths.** Move sort to per-`(panel,libId)` via the same
   `useListView`; move widths to `useLayoutPrefs`. Verify the global→per-list fold.
5. **Scroll (loss #3) — catalog then reader.** Add throttled listeners + the one-shot
   non-empty-gated restore in `LeftList`, then `PaperRender` (thread `scrollSessionKey`).
6. **`leftPinnedActiveId` (loss #4).** Persist it in `useLibraryTabs` (Tier A path).
7. **cited-only + layout widths subsume.** Repoint `project-library-context.tsx` and the
   `LibraryView` width state at the store.
8. **(Tier B, separate session)** Subsume tabs + retire legacy keys after one release.

### Test plan (`library/lib/view-session-store.test.ts`, jsdom)

1. **Store round-trip:** `setPanelTabs`/`setSelection`/`setListSort`/`setListScroll`/
   `setListQuery` then `getSession()` returns the written values; a fresh module import
   reading the same `localStorage` key reconstructs the identical session (simulate
   reload).
2. **Versioning / migration:** (a) absent blob → Tier-A seed pulls
   paper-pinned/project-hidden/project-pinned/cited-only/col-widths/col-sort/width keys in
   and leaves legacy keys intact; (b) `schemaVersion` missing or `!==1` → reader returns
   `EMPTY_SESSION` without throwing; (c) corrupt JSON → `EMPTY_SESSION`, no throw; (d)
   future `schemaVersion=2` read by v1 code → `EMPTY_SESSION` fallback.
3. **Idempotent seed:** running `getSession()` twice (or two Library mounts) does not
   overwrite an existing blob and does not delete any legacy key.
4. **Per-scope / per-library isolation:** sorting `scopes[''].left.lists['central']` does
   NOT change `scopes[''].left.lists['paper:x']` or `scopes['outer:lib-1'].*` — proves the
   coherence fix (global col-sort bug gone).
5. **Selection scope:** `setSelection` on left doesn't mutate right; restore filters out
   ids absent from a supplied `mergedEntries` snapshot (stale-key drop).
6. **Race tolerance:** restore `openIds` containing a custom-lib id NOT in `libraryById`
   → assert it stays in persisted `openIds` (not pruned); after the id is added, the tab
   renders. `leftPinnedActiveId` restored before its tab exists → ignored, applies once
   present.
7. **Scroll key isolation + one-shot restore:** `(left,'central')` and `(left,'paper:x')`
   stored separately; restore applies only on first non-empty render, not on a zero-height
   list (mock `scrollHeight <= clientHeight` → no apply, value retained).
8. **Write coalescing / flush:** N rapid `setListQuery` within the debounce window → ≤1
   `localStorage.setItem` (spy); a simulated `pagehide`/`visibilitychange` flushes
   immediately and persists the latest value.
9. **cited-only survives provider remount:** set `citedOnly=true`, remount
   `ProjectLibraryProvider` (new `key`) → reads `true` from the singleton store (regression
   guard for the `LibraryTabView key={currentDocId}` remount).

Plus existing suite (`tsc`, `eslint`, full vitest) green after each phase.

---

## 8. Open questions (need a product/user decision)

1. **`leftPinnedActiveId` persistence is a deliberate BEHAVIOR CHANGE.** Today it's
   intentionally ephemeral (`useState(null)`, `useLibraryTabs.ts:239`) so after reload the
   left panel re-follows `currentDocId`. Confirm the user wants the last-clicked left tab
   to win across reload. (audit §3.2 #4 / §7 Q6)
2. **Search-query persistence vs clear-on-reload.** The minimum ask is to stop the query
   dying on TAB SWITCH (the `LeftList` per-tab remount). Confirm full reload-persistence is
   wanted, or only tab-switch survival.
3. **Selection scope: per-PANEL (proposed) vs per-(panel,library).** Per-panel matches
   today's single shared set (`LibraryView.tsx:256` threaded into both panels). If the user
   expects each library to remember its own selected rows, make it per-`(panel,library)`
   like sort/query. One-line call.
4. **Tier A vs Tier B sequencing.** Acceptable to leave tab/pins persistence on its
   current keys for one release (Tier A) and consolidate later (Tier B), or must the "ONE
   coherent store" principle subsume tabs immediately (higher risk, XL session)?
5. **Restore-race flicker acceptance.** A restored custom-lib tab briefly vanishes then
   reappears after the 6 s manifest poll. Acceptable, or render a placeholder tab until the
   manifest resolves? Verify on production FSA, not the dev preview (memory anchor
   `anchor_persistence_dev_masks_fsa`). (audit §7 Q5)
6. **Layout width/height subsume scope.** `nav`/`middle`/`papers`/`colWidths` already
   survive reload. Confirm folding them into the blob is in-scope now (coherence) or should
   stay on their own keys to keep the diff small.
