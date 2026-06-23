# Virgil Library — "Over-watched" Audit & Remediation Plan

> SSOT for a future implementation session. Every claim is anchored to `file:line`. The audit data was independently spot-verified against the live code (`LeftList.tsx`, `useRowDotState.ts`, `bib-searcher.ts`, `LibrariesNavigator.tsx`, `NavPod.tsx`) on 2026-06-19.
>
> Scope: the three user asks — (1) make Library view-state survive reload, (2) make catalog search flexible/multi-token, (3) fix the "overburdened / processes watching typing and selecting" feel.

---

## 1. Executive summary

The Library tab does **not** inherit the main editor's keystroke-sanctity discipline. There is no event-driven diff, no row memoization, no virtualization, and selecting a row is conflated with mounting a full TipTap editor. The "over-watched" complaint is real and has concrete, fixable causes.

| Ask | Verdict | One-line |
| --- | --- | --- |
| **#1 Local-state persistence** | **Partially solved, real gaps** | Tabs/widths/sort/cited-only persist; **selection highlight, search query, and scroll position do not survive reload.** State is scattered across ~10 `useState + useEffect(localStorage)` pairs in 5 files — recommend one versioned "library view-session" store. |
| **#2 Flexible search** | **Confirmed broken; fix is to UNIFY, not invent** | Today's matcher is naive `hay.includes(q)` (`LeftList.tsx:100`) — no tokenization, no diacritics, no ranking. `lewis score` fails. The main app already ships the exact matcher needed: `searchBibFuzzy` (`src/lib/bib-searcher.ts:96`). Route the Library through it via a thin adapter. |
| **#3 "Over-watched" performance** | **Confirmed; multiple hot paths** | Zero `React.memo` in the whole subsystem, no virtualization, search re-filters+re-sorts the full catalog per keystroke with no debounce, selection state is hoisted to the top and fans out to both panels, and a **plain row click synchronously reads disk + parses LaTeX + mounts an `<EditorPane>`** (`LeftList.tsx:150-153`). Several ambient 6s polls compound the feel. **No claims were refuted** — but several severities were corrected (see §5). |

**Honest call on sequencing:** the search fix (#2, option 2) and the localStorage-debounce + change-guard fixes (parts of #1/#3) are safe to land incrementally now. The row-memoization / virtualization / select-vs-open split (#3 core) and the unified view-session store (#1 core) each warrant a **dedicated refactor session** because they touch the selection-state location, the row prop contract, and the `dotToneFor` identity trap together — doing one without the others leaves the win on the table (see §6).

---

## 2. State architecture map

The render spine (verified against `library/CLAUDE.md` + code; the `TopBar.tsx` the doc still lists no longer drives this — its affordances moved into `LibraryView` container drag handlers + the `PanelTabStrip` Central `⋮` menu):

```
LibraryTabView (src/components/library/LibraryTabView.tsx)
  ProjectLibraryProvider + mergedTabsOptions(openDocs, currentDocId)
└─ LibraryApp                — FSA handle state machine; NO view state (LibraryApp.tsx:29-63)
   └─ LibraryView ★          — OWNS selectedKeys/anchorKey + 3 width keys; runs 6 disk-poll
      │                         hooks + useLibraryTabs; builds mergedEntries
      ├─ LibrariesNavigator   — owns rename-draft ONLY (editingId/draftLabel,
      │                         LibrariesNavigator.tsx:70-71); no collapse state
      │   └─ NavPod → NavRow*  — NavPod is a pure presentational wrapper (NavPod.tsx:20)
      ├─ TabbedLibraryPanel[LEFT] ★  — owns useRowDotState(handle) #1 + panelDragOver
      │   ├─ PanelTabStrip
      │   └─ body: paper tab → PaperFileBody → RightDetail → PaperRender(<EditorPane>)
      │            else        → LeftList ★ — OWNS query/sort/widths
      │                            └─ LeftListRow*  — NOT memoized; owns transient `copied`
      └─ TabbedLibraryPanel[RIGHT] ★ — owns useRowDotState(handle) #2 (same body shape)
```

**Who owns what (the ★ owners):**

- **Selection** (`selectedKeys: ReadonlySet<string>`, `anchorKey: string|null`) — `LibraryView.tsx:256,259`. Threaded into BOTH panels via `renderPanel('left'|'right')` (`LibraryView.tsx:609-642`, invoked at `:851` and `:880`). A single click `setSelectedKeys` at the root re-renders the entire 2-panel subtree.
- **Search query** — local to each list: `LeftList.tsx:66` (`useState("")`). Never lifted, never persisted.
- **Sort + column widths** — `LeftList.tsx:67-68`, persisted via `list-columns.ts` (single global keys).
- **Inner-tab selection (left/right) + pins/hidden** — `useLibraryTabs.ts` (`leftTabs`/`rightTabs` `:227,230`; `leftPinnedActiveId :239`; pin/hidden sets `:224,246,252`).
- **`mergedEntries`** (catalog + master.bib + unsorted PDFs + unsorted .bib) — computed in `LibraryView.tsx:350-416`, passed by prop to both panels.

**Stores / singletons:**

- `catalog-store.ts` — module singleton, refcounted shared 6s poll of `catalog-version.txt` (`catalog-store.ts:35-41,75-119,141-184`). **The Library tab does NOT subscribe to it** — `LibraryView` runs its own `useCatalog(handle)`. So an open Library tab has **two independent catalog polls** (one for the tab, one for the editor-side Bibliography/Citation pickers).
- `library-store.ts` — localStorage read/write + `REGISTRY_CHANGED_EVENT` window broadcast (`:222`).
- `useDiskLibraries.ts` — disk-manifest custom-library store + own 6s poll (`:321-345`). A **second independent instance** runs in `useLibraryRegistry` for the outer tab strip.
- `row-viewed-store.ts` + `useRowDotState.ts` — per-citekey last-viewed timestamps + a 6s queue/inbox poll, instantiated **once per panel** (`TabbedLibraryPanel.tsx:117`).
- `ProjectLibraryContext` (`project-library-context.tsx`) — editor→library bridge; memoizes Sets via `stableJoin` (`:111-115`) so it is stable across editor keystrokes.

**Re-render triggers (the core diagnosis):**

- **Typing in search:** `query` local to `LeftList` → only that list re-renders, but inside it `filtered` is a full O(catalog) scan + re-sort (`LeftList.tsx:85-104`) and every visible row re-renders (no `React.memo`). No debounce.
- **Selecting a row:** `selectedKeys` at `LibraryView` root → re-renders LibraryView → BOTH panels → BOTH lists → all rows in both.
- **Catalog poll (6s):** any effective change yields a new `mergedEntries` array identity → both lists recompute. `useRowDotState` flips `toneFor` identity per state change → list re-renders when request state changes.

---

## 3. Ask #1 — Local-state persistence

### 3.1 Full inventory

| State item | Owner (file:line) | Persisted? | Survives reload? |
| --- | --- | --- | --- |
| `activePane` (is Library tab on screen) | `src/hooks/useFiles.ts:82,184,164-167` | IndexedDB (per-window) | **Yes** |
| Active outer library/paper tab + order | `src/hooks/useFiles.ts:88-96,140-160,184-191` | IndexedDB | **Yes** |
| Left inner tabs (openIds+activeId) | `useLibraryTabs.ts:227`; `library-store.ts:294-344` | localStorage `virgil-library-tabs-left[-scope]` | **Yes** |
| Right inner tabs (= single-vs-split signal) | `useLibraryTabs.ts:230` | localStorage `virgil-library-tabs-right[-scope]` | **Yes** |
| Custom-library membership/existence | `useDiskLibraries.ts`; `library-storage.ts:331` | disk manifest `.virgil/libraries/<slug>.json` | **Yes** |
| Paper-tab pin flags | `useLibraryTabs.ts:155,224,319,293` | localStorage `virgil-library-paper-pinned` | **Yes** |
| Project-tab hidden flags | `useLibraryTabs.ts:150,246,311,291` | localStorage `virgil-library-project-hidden` | **Yes** |
| Project-tab pin flags | `useLibraryTabs.ts:151,252,315,292` | localStorage `virgil-library-project-pinned` | **Yes** |
| `leftPinnedActiveId` (left active-tab override) | `useLibraryTabs.ts:239,384-392` | **none** | **No** |
| `selectedKeys` (row highlight / drives open paper) | `LibraryView.tsx:256` | **none** | **No** |
| `anchorKey` (shift-click pivot) | `LibraryView.tsx:259` | **none** | **No** |
| **Search query** | `LeftList.tsx:66` | **none** | **No** |
| Sort column + direction | `LeftList.tsx:68,75-78,164`; `list-columns.ts:199-225` | localStorage `virgil-library-col-sort` (single global) | Yes |
| Column widths | `LeftList.tsx:67,75-78,208`; `list-columns.ts:174-197` | localStorage `virgil-library-col-widths` (single global) | Yes |
| Active column SET | `list-columns.ts:48-61` | n/a — columns hardcoded | n/a |
| Catalog-list scroll position | `LeftList.tsx:299-306` (uncontrolled DOM) | **none** | **No** |
| Reader (paper) scroll position | `PageScrollStrip.tsx:58,118-123`; `PaperFileBody`/`PaperRender` | **none** | **No** |
| Nav/middle width + My-Papers height | `LibraryView.tsx:60-72,98-127,158,204` | localStorage `virgil-library-{left,nav,papers}-*` | Yes |
| `citedOnly` project toggle | `project-library-context.tsx:62,87-106` | localStorage `virgil-library-project-cited-only` (single global) | Yes |
| Row-viewed timestamps (dot ack) | `row-viewed-store.ts` (whole file) | localStorage `virgil-library-row-viewed-at` | Yes |
| Navigator rename-draft | `LibrariesNavigator.tsx:70-71` | **none** | No (correctly ephemeral) |
| dragActive / panelDragOver / counters | `LibraryView.tsx:559`; `TabbedLibraryPanel.tsx:283` | **none** | No (correctly ephemeral) |

### 3.2 The gaps that matter (in priority order)

1. **Selected row highlight (`selectedKeys`) is lost on reload** (`LibraryView.tsx:256`). The open *paper* survives (it's a persisted `paper:<citekey>` tab in `rightTabs`), but no row is highlighted, so the reader and the list feel disconnected and the user loses their place. Multi-select sets are wiped.
2. **Search query is lost** (`LeftList.tsx:66`) — and worse, the component remounts per active tab, so the query is cleared even on a tab switch, not just reload. Compounds the "overburdened" feel (it pairs with the per-keystroke full-scan in §5).
3. **Catalog-list + reader scroll positions are lost** (`LeftList.tsx:299-306`; `PageScrollStrip.tsx:58`). Every reload jumps both to the top.
4. **`leftPinnedActiveId` is lost** (`useLibraryTabs.ts:239`) — after reload the left panel snaps back to following `currentDocId` instead of the tab the user was actually on.
5. **Coherence (not a reload loss):** sort / widths / cited-only persist as **single global keys** — sorting one library re-sorts all of them, and left/right panels can't hold different sorts.
6. **Restore race (cosmetic):** `loadPanelTabs` restores custom-lib/paper ids synchronously, but `useDiskLibraries` hydrates manifests async (mount + 6s poll) and the FSA handle arrives after the permission gate. `tabDefs` (`TabbedLibraryPanel.tsx:120`) drops any `openId` whose Library isn't yet in `libraryById`, so a restored custom-lib tab can briefly vanish then reappear. The id is **not** removed from localStorage (only `close()` prunes), so it is not lost — just flickers.

**CORRECTION to the audit's persistence list:** the flagged item *"Navigator expand/collapse not persisted"* is a **non-issue**. `LibrariesNavigator` holds only `editingId`/`draftLabel` (`LibrariesNavigator.tsx:70-71`) and `NavPod` is a pure presentational wrapper with no collapse state (`NavPod.tsx:20-59`). There is no expand/collapse affordance to persist. Drop it from scope.

### 3.3 Recommended UNIFIED persistence design

Do **not** extend the current scatter of ~10 `useState + useEffect(localStorage)` pairs across 5 files. Introduce **one** versioned store covering only the **inner Library view-state**.

**New file `library/lib/view-session-store.ts`** — a tiny custom store (or zustand + persist) over a single localStorage key `virgil-library-view-session` holding one versioned object:

```ts
{
  schemaVersion: 1,
  panels: Record<scope, {                 // scope '' = singleton, '<scope>' = tear-out
    left: PanelTabsState,                  // { openIds, activeId }
    right: PanelTabsState,
    leftPinnedActiveId: string | null,
  }>,
  paperPinned: string[],
  projectHidden: string[],
  projectPinned: string[],
  layout: { navWidth, middleWidth, papersHeight, colWidths },  // per-machine; widths stay global
  citedOnly: boolean,
  perList: Record<libId, {                 // libId from the existing id space:
    sort: { col, dir },                    //   'central' | custom-lib id | paper:<citekey> | project:doc:<docId>
    query?: string,                        //   debounced; optional
    scrollTop?: number,                    //   one-shot restore (see risks)
  }>,
  selection: { selectedKeys: string[], anchorKey: string | null },
}
```

Move **sort into `perList`** so different libraries sort independently (fixes gap #5). Keep **column widths global** under `layout` (a true per-machine preference). The store exposes selectors + setters; `useLibraryTabs`, `LibraryView`, `LeftList`, and the navigator read/write through it instead of owning their own state+effects.

**Single debounced writer (~250 ms)** — also kills any per-keystroke localStorage churn risk. **Flush on `pagehide`/`visibilitychange`** so a reload right after a change doesn't lose it (risk #4 below).

**What the blob does NOT own** (leave exactly as is):
- Outer-pane tabs — already correct in `useFiles.ts` / doc-index IndexedDB (per-window tier).
- Custom-library membership — durable shared data on disk manifests `.virgil/libraries/*.json`. **Never move into the blob.**
- `row-viewed-at` — semantically a notification-ack ledger, not view layout. Leave as its own key.

### 3.4 Migration

Read-through migration on first load: if `virgil-library-view-session` is absent, hydrate the blob from the existing keys (`virgil-library-tabs-left/-right`, `-col-sort`, `-col-widths`, `-project-hidden`, `-project-pinned`, `-paper-pinned`, `-project-cited-only`, `-left-width`, `-nav-width`, `-papers-height`), write the blob, and **leave legacy keys in place for one release** as a fallback before deleting. Keep `loadPanelTabs`'s existing `project:doc:*` id-stripping behavior.

### 3.5 Restore-race notes

- Restore is a **single synchronous localStorage read on mount** — no async restore race at the store level. The only late-resolving dependency is the disk-library manifest set; the strip already tolerates it by filtering unknown ids — **keep that filter, but never PRUNE unknown ids from persisted `openIds`** (only `close()` prunes), so a custom-lib tab that resolves after the 6s poll reappears.
- **Persisting `selectedKeys`:** validate against live `mergedEntries` on restore and drop stale keys (a delete/reindex may have removed a citekey) — same defensive filter the tab strip uses.
- **Persisting `scrollTop`:** restore **after** the async list/paper content mounts. Use a one-shot ref that fires on the first non-empty render, not eagerly, or it scrolls a 0-height list to nowhere.
- **Search query:** persisting it is defensible but clearing on reload is also fine; the **minimum** win is to stop remounting `LeftList` per tab so the query at least survives tab switches.

---

## 4. Ask #2 — Flexible search

### 4.1 How it works today

- **Input:** `LeftList.tsx:228-241` — `<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, author, citekey…">`. This is the **only** catalog search input in the Library (the `LibrariesNavigator.tsx:468` input is a new-library NAME draft, not a filter).
- **Query state:** `LeftList.tsx:66`, `useState("")`.
- **Matcher:** naive single-substring `String.includes`, in the `filtered` memo (`LeftList.tsx:85-104`). Per entry it builds a 6-field array `[citekey, title|bib.title, authors.join(" "), bib.author, year, originalFilename]`, `.join(" ")`, `.toLowerCase()` → one `hay` string, then `hay.includes(q)` (`LeftList.tsx:100`). Survivors go to `sortEntries(...)` — sort is independent of match; there is **no relevance ranking**.
- **Tokenization: NONE.** `q = query.trim().toLowerCase()` (`:86`) used whole. A multi-word query is one literal substring — internal spaces must appear verbatim in the joined haystack.
- **Diacritics: NOT normalized.** `munoz` will not match `Muñoz` (no NFD/strip), in contrast to the main app's `foldDiacritics`.
- **Debounce: NONE.** `onChange` calls `setQuery` synchronously every keystroke (`:230`).

### 4.2 The "lewis score" trace (proves the failure)

For the row *David Lewis, "Scorekeeping in a Language Game"* the haystack is roughly:

```
lewis1979scorekeeping  scorekeeping in a language game  David Lewis  lewis, david  1979  lewis-scorekeeping.pdf
```

- Query `lewis` → matches (single token, `lewis` is in author/citekey). ✅
- Query `lewis score` → **fails.** `hay.includes("lewis score")` requires the literal contiguous substring `lewis score`. But `lewis` is followed by `1979scorekeeping` (citekey) or the field separator — never immediately by `score`. The author token `lewis` and the title token `score` live in **different haystack segments** joined by spaces, and the untokenized substring test cannot bridge them. This is exactly the user's complaint. ❌
- Query `lewis languag` → **fails** for the same reason (author token + partial title word never contiguous). A token-AND matcher would split `["lewis","languag"]`, match `lewis` in author and `languag` as a substring of `language` in title, and surface the row — demonstrating partial-word matching works under the recommended design. ❌

### 4.3 Recommendation — UNIFY, don't invent

The main app **already ships the exact flexible matcher the user is asking for**, and the Library bypasses it. Verified at `src/lib/bib-searcher.ts`:
- `searchBibFuzzy(entries, query, limit)` (`:96`) — fuse.js-backed.
- Whitespace tokenization (`:106`) + **multi-token AND intersection** at the entry level (`:114-140`): each token fuzzy-matched against the whole entry, only entries matching every token survive, ranked by summed scores.
- **Diacritic folding** via `foldDiacritics` (`:33-35`) applied to BOTH the index `getFn` (`:54-61`) and the query (`:105`).
- **Per-field weights:** title 2.0 / author 1.8 / editor 1.5 / key 1.5 / journal 1.2 / booktitle 1.2 / year 1.0 / publisher 1.0 (`:38-47`).
- **WeakMap index cache** (`:67`) so re-search is cheap across keystrokes when the entries array identity is stable.

This is **divergence, not duplication-by-design**: the Bibliography panel (`src/panels/Bibliography/BibliographyPanel.tsx:294-302`), the cross-library picker (`src/components/library/BibEntryPickerMenu.tsx:280`), and `CitekeyPicker` all route through `searchBibFuzzy`. Only `LeftList.tsx` hand-rolls `hay.includes(q)`. The façade `src/hooks/useLibrary.ts` only maps `CatalogEntry → LibraryIndexItem`; it does no filtering. So today the Bibliography panel finds `lewis score` and the Library catalog list cannot.

Importing `@/lib/bib-searcher` is **sanctioned**: `library/CLAUDE.md` permits `@/` Reader-inheritance bridges, and the Library already imports `@/lib/cite-commands` in `bib-parser.ts` and `@/components/EditorPane` in `PaperRender.tsx`. No new architectural boundary is crossed.

**Two implementation options:**

**(1) PREFERRED — adapter onto `searchBibFuzzy`.** New `library/lib/catalog-search.ts` exporting:

```ts
searchCatalogFuzzy(entries: CatalogEntry[], bibByKey: Map<string,BibEntry>, query: string, limit?): CatalogEntry[]
```

Per entry it synthesizes a `BibEntry`-shaped record:
```ts
{ key: e.citekey ?? '',
  fields: { title: e.title ?? bib?.fields.title ?? '',
            author: (e.authors ?? []).join(' and ') || bib?.fields.author || '',
            year: String(e.year ?? bib?.fields.year ?? ''),
            journal: bib?.fields.journal ?? '',
            booktitle: bib?.fields.booktitle ?? '',
            filename: e.originalFilename ?? '' },
  raw: '' }
```
keeps a parallel synthetic→`CatalogEntry` map, calls `searchBibFuzzy`, and maps ranked results back. **Cache the synthetic array on the source `entries` array identity via a WeakMap** so fuse's own WeakMap cache (`bib-searcher.ts:67`) is hit across keystrokes — entries identity is stable between keystrokes (only `query` changes), so the index builds once. Then in `LeftList.tsx` replace the inline `filtered` body (`:86-101`) with:
```ts
const matched = q ? searchCatalogFuzzy(entries, bibByKey, query) : entries;
return sortEntries(matched, bibByKey, sort.col, sort.dir);
```
**Call site:** `LeftList.tsx` `filtered` memo (`:85-104`) is the only one. This gives all four surfaces — Bibliography panel, bib pickers, citekey picker, Library catalog list — one matcher, and `lewis score` works everywhere.

**(2) LIGHTER — no fuse.** Add a pure `matchCatalogTokens(entry, bibByKey, tokens): boolean` that builds the same haystack as today but `foldDiacritics(hay)`, splits the query into whitespace tokens (`query.trim().toLowerCase().split(/\s+/).filter(Boolean)`), folds each token, and returns `tokens.every(t => hay.includes(t))` (AND across tokens, each a substring; no ranking). This alone fixes all three failing traces and the diacritics gap. It is the minimal change if pulling fuse into the Library is unwanted.

**Recommend (1)** for parity. Either way, **memoize the per-row haystack** (build once per entries-array identity, not per keystroke) to also kill the over-watched per-keystroke O(N) string rebuild (§5).

**Risks:** (a) `CatalogEntry` is not a `BibEntry` — get the synthetic↔source mapping right or rows drop; (b) fuse threshold 0.35 surfaces near-misses the exact filter excluded — generally desirable, the multi-token AND (`:137`) mitigates over-broadening; (c) `searchBibFuzzy` returns rank order but the Library re-sorts by column (rank discarded) — fine for a sortable table; (d) the synthetic-array WeakMap must key on the stable `entries` ref or the index rebuilds per keystroke; (e) `filename` is not a default fuse key — extend `FUSE_OPTIONS` or fold it into an existing key or filename search regresses vs today.

---

## 5. Ask #3 — "Over-watched" performance

**No claims were refuted** — every finding verified against code. Several severities were corrected during verification (noted inline). The work splits into three triggers: **typing**, **selecting**, **ambient**.

### 5.1 Confirmed hot paths

#### TYPING (per-keystroke)

| # | Finding | file:line | Severity | Proportional to | Fix sketch |
| --- | --- | --- | --- | --- | --- |
| T1 | **Every visible row re-renders, no memo, no virtualization** | `LeftListRow.tsx:55`; rendered `LeftList.tsx:314-330` | **HIGH** | catalog size (rendered set = whole catalog, since no windowing) | Wrap `LeftListRow` in `React.memo`; stabilize per-row props (see T6); ideally **virtualize** (`@tanstack/react-virtual`) → cost becomes O(viewport). |
| T2 | **Full re-sort on every keystroke** (the query never changes sort order) | `LeftList.tsx:85-104`; `sortEntries` `list-columns.ts:110-120` | MED | catalog size | Split the memo: `sorted = useMemo(sortEntries(entries...), [entries,bibByKey,sort])`, then `filtered = q ? sorted.filter(...) : sorted`. Precompute sort keys once + reuse one `Intl.Collator` instead of `String.localeCompare` (`list-columns.ts:97,100,102,106`). |
| T3 | **Haystack string rebuilt for every entry every keystroke** | `LeftList.tsx:87-101` | MED | catalog size | Precompute a normalized lowercased haystack per entry once, memoized on `[entries, bibByKey]`; per keystroke run only `hay.includes(q)` over cached strings. (Subsumed if §4 option 1 lands — the fuse index caches.) |

> T1+T2+T3 together are the literal embodiment of "processes watching typing… slow." On a 200–2000 entry Central library, each character does: full haystack rebuild + full O(n log n) collated re-sort + reconcile of every un-memoized row. The audit's standalone `leftlist-refilter-resort-per-keystroke` claim was bumped **low → med** for exactly this composite reason.

#### SELECTING (per-click)

| # | Finding | file:line | Severity | Proportional to | Fix sketch |
| --- | --- | --- | --- | --- | --- |
| S1 | **Plain row click synchronously reads `main.tex`, parses LaTeX, assigns UUIDs, mounts a full `<EditorPane>`** | `LeftList.tsx:150-153` → `openPaper` `useLibraryTabs.ts:625-669` → `PaperRender.tsx:68-95,167-181,234-247` | **HIGH** | constant (but heavy: disk read + full-doc parse + TipTap mount) | **Decouple highlight from open.** Single-click sets selection only; double-click/Enter/explicit Open mounts the editor. OR defer `onOpenPaper` behind `requestIdleCallback`/short debounce so arrow/click browsing doesn't mount-and-tear-down an EditorPane per row. Gate `PaperRender` against re-read on same-citekey re-select. **This is the single heaviest thing on the click path.** |
| S2 | **Selection state hoisted to `LibraryView`, fans out to both panels** | `LibraryView.tsx:256-259`; `renderPanel` `:609-642` invoked `:851,:880` | **HIGH** | catalog size | A click re-renders LibraryView → both panels → both lists → all rows. Fix is mostly **T1 (memoize rows)**: with memoized rows + a per-row primitive `selected` boolean, the LibraryView re-render becomes cheap and only the 2 changed rows re-render. Deeper option: context/store with per-row selector subscription. |
| S3 | **`LeftListRow` not memoized → selecting one row re-renders every row in both panels** | `LeftList.tsx:314-331` | **HIGH** | catalog size | Same root as T1/S2. Memoize `LeftListRow`; pass `key`+`citekey` + a **stable** `onClick(key,citekey,e)` instead of the inline arrow at `LeftList.tsx:325`; read `selectedKeys` lazily from a ref at drag-start instead of passing the Set as a prop. |
| S4 | **Every plain click does a localStorage read-modify-write + a `useRowDotState` setState** | `LeftList.tsx:151` → `markViewed` `useRowDotState.ts:84-88` → `markViewedNow` `row-viewed-store.ts:37-43` | MED | constant | Only call `markViewed` when the row actually has a green/unviewed dot; debounce/`requestIdleCallback` the localStorage write; keep the viewed stamp in a ref + flush lazily so it doesn't re-render the list. |
| S5 | **`dotToneFor` identity churns on every poll/markViewed — defeats a naive row memo** | `useRowDotState.ts:71-82` (dep `[state]`) | MED | catalog size | Precompute a per-citekey tone `Map` once per state change (or pass primitive `pending`/`viewedAt`) so a memoized row only re-renders when ITS dot flips. **Must fix alongside T1 or memoization won't land.** |
| S6 | **Inner-tab switch re-filters membership + re-renders all rows** | `TabbedLibraryPanel.tsx:227-271` | MED | catalog size | Membership recompute is inherent; the full un-memoized re-render is the amplifier → fixed by T1. Low frequency (deliberate action), least pressing of the family. |

#### AMBIENT (background, no user input)

| # | Finding | file:line | Severity (corrected) | Proportional to | Fix sketch |
| --- | --- | --- | --- | --- | --- |
| A1 | **`useRowDotState` re-scans the whole queue dir + every queue JSON + inbox.json every 6s, ungated** | `useRowDotState.ts:45-69,97-140` | **MED** (audit said high; downgraded — work is proportional to QUEUE size, typically a handful of pending requests, not catalog size) | queue size | Gate the tick on `catalog-version.txt` like `useCatalog`/`useDiskLibraries`: read the 1-byte version, compare to a ref, bail before `listDir`/`readJsonFile` when unchanged. The `setsEqual`/`mapsEqual` guards (`:53-56`) only suppress the setState AFTER the disk work. |
| A2 | **`useUnsortedPdfs` reads every unsorted file (mtime) every 6s and always allocates a fresh array** | `useUnsortedPdfs.ts:12-41,43-62` | **MED** | unsorted-inbox size | No change-guard (unlike `useUnsortedBibEntries.ts:75-88`). Fresh array → new `mergedEntries` identity (`LibraryView.tsx:350-416`) → both lists recompute even when nothing changed. Add an equality short-circuit (return prev when name list unchanged) and/or version-gate. |
| A3 | **Two `useRowDotState` instances (one per panel)** each run an independent 6s queue+inbox scan | `TabbedLibraryPanel.tsx:117` (×2) | MED | queue size | Lift `useRowDotState` to `LibraryView` and pass `toneFor`/`markViewed` down to both panels — one poll, not two. |
| A4 | **`inbox.json` read by 2–3 separate 6s loops; catalog polled by two independent loops** | `useNotificationStream.ts:26-43`; `useRowDotState.scanLatestNotifAt`; `useCatalog.ts:44` + `catalog-store.ts:149` | **LOW** (corrected from med; each read is tiny + version-gated where it matters; not on the typing/selection path) | constant | Coalesce: one polled inbox source shared by notif-stream + row-dot; route the ~6 `focus` listeners (`useCatalog:31`, `useUnsortedPdfs:49`, `useUnsortedBibEntries:96`, `useMasterBib`, `useDiskLibraries`) through one shared refresh-on-focus so a refocus doesn't fan out into a synchronized disk-read burst. Hygiene, not a felt-lag fix. |
| A5 | **`LeftListRow` re-renders on every poll-driven state change** | `LeftListRow.tsx:55` | **MED** (corrected from high — the `setsEqual`/`mapsEqual` guard at `useRowDotState.ts:53-58` means rows only re-render when request data actually CHANGES, not every tick) | catalog size | Same fix as T1 (memoize) + S5 (stabilize dot tone). The steady-state "hundreds of re-renders every 6s" framing was overstated. |

### 5.2 Refuted claims

**None.** The verification pass confirmed every performance finding. The corrections were severity adjustments only:
- A1 `rowdot-poll-full-queue-scan`: high → **med** (queue-size, not catalog-size).
- A4 `redundant-inbox-and-catalog-polls`: med → **low** (cheap, version-gated, off the hot path).
- A5 `leftlistrow-not-memoized` (ambient framing): high → **med** (equality guard prevents per-tick re-render).
- `leftlist-refilter-resort-per-keystroke`: low → **med** (composite per-keystroke cost matches the user's explicit typing-lag report).

Do not chase: a "6s poll re-renders the whole list unconditionally" ghost — the `setsEqual`/`mapsEqual` guard at `useRowDotState.ts:53-58` already blocks the steady-state case. The felt cost is on the **typing** and **selecting** paths, not idle ambient ticks.

---

## 6. Recommended chips (ordered)

Effort: S < 1 day · M 1–2 days · L 3–5 days · XL > 1 week / dedicated session.

| # | Chip | Concern | Effort | Depends on | Safe now? |
| --- | --- | --- | --- | --- | --- |
| C1 | **Flexible search via `searchCatalogFuzzy` adapter** onto `src/lib/bib-searcher.ts` (new `library/lib/catalog-search.ts`; rewrite `LeftList.tsx:86-101`; WeakMap-cache the synthetic array) | search | M | — | **Yes** — self-contained, high user value, fixes `lewis score` + diacritics. Start here. |
| C2 | **Search: precompute haystack + split sort/filter memos + `Intl.Collator`** (`LeftList.tsx:85-104`; `list-columns.ts`) | performance | S | C1 (or independent if option-2 search) | **Yes** — pure per-keystroke-cost reduction, no API change. Largely subsumed by C1's fuse cache; do whichever search path you pick. |
| C3 | **Debounced single-key localStorage writer + change-guards** — add equality short-circuit to `useUnsortedPdfs` (A2), version-gate `useRowDotState` poll (A1) | performance | S | — | **Yes** — localized hardening, no architectural change. |
| C4 | **Lift `useRowDotState` to `LibraryView`** (one poll, passed to both panels) (A3) | performance | S | — | **Yes** — straightforward prop-threading. |
| C5 | **Memoize `LeftListRow` + stabilize props** (`React.memo`, stable `onClick`, primitive `selected`, per-citekey tone `Map`) — the T1/S2/S3/S5 cluster | performance | M | C4 (tone Map) | **Needs care** — must land row-memo + `onClick` stability + `dotToneFor` stabilization TOGETHER or memoization is defeated by S5. Best as one focused chip, ideally its own session. |
| C6 | **Decouple select from open** — single-click highlights, double-click/Enter/Open mounts the editor (or idle-defer `onOpenPaper`); gate `PaperRender` re-read on same citekey (S1) | performance | M | — | **Needs a product decision** (the single-vs-double-click UX). Heaviest felt win. Pair with C5 in the perf session. |
| C7 | **Virtualize the catalog list** (`@tanstack/react-virtual`) → keystroke/selection cost becomes O(viewport) regardless of catalog size | performance | L | C5 | Dedicated session — caps the whole T1/S-family at the source for large libraries. |
| C8 | **Unified `view-session-store.ts`** — single versioned blob; migrate `useLibraryTabs`/`LibraryView`/`LeftList`/cited-only off scattered keys; persist selection + scroll + (optional) query; move sort into `perList`; read-through migration + pagehide flush | persistence | XL | — | **Dedicated refactor session** — touches 5 files + the restore-race + migration. Do NOT graft onto the perf work. |
| C9 | **Coalesce inbox/catalog polls + focus listeners** (A4) | shared | S | C4 | Yes — hygiene; lowest priority. |

**Cross-cutting note:** C5 and C6 share the selection-state location and the row prop contract; C8 changes where selection *persists*. Sequence: **C1–C4 first (safe, incremental), then a dedicated perf session for C5+C6 (+C7), then a separate persistence session for C8.**

### Refactor vs patch — honest call

- **Patch now (this/next small session):** C1, C2, C3, C4, C9. Each is localized, reversible, and individually testable. C1 alone resolves Ask #2 and removes the single most visible search defect.
- **Dedicated session:** C5+C6+C7 (the "over-watched" core) and C8 (the persistence core). Both are deep — C5/C6 because the row-memo trap (S5) means a half-fix yields zero benefit and can mislead a reviewer into thinking memoization "didn't help"; C8 because it rewires state ownership across 5 files with a migration and a restore-race to honor. Trying to land them as patches risks a partial state that's worse than today (e.g. memoized rows that still re-render because `dotToneFor` churns).

---

## 7. Open questions / live-preview verification

1. **Catalog size in practice.** All "catalog-size" severities assume a Central library of hundreds–thousands of entries. Confirm the user's actual catalog size — if it's <100, T1/T2/T3 are real but sub-perceptible and C7 (virtualization) can be deprioritized. The felt-lag is most likely **S1 (eager EditorPane mount)** even on a small catalog. **Verify S1 is the dominant click cost via a live profile before investing in C7.**
2. **Select-vs-open UX decision (C6).** Does the user want single-click to still open the reader, with the *highlight* simply made cheaper (memoization), or a genuine single=highlight / double=open split? This is a product call that gates C6's shape. Recommend a quick live walk: does arrow-keying through the list to browse feel like the main lag source?
3. **Live keystroke profile.** Reproduce in the dev preview (load `virgil-data/doc_devtest`, open the Library tab) and confirm the per-keystroke cost ordering (row re-render vs sort vs haystack) with a React profiler — the audit's ranking (T1 > T2 ≈ T3) is from static analysis. Note the preview's background-throttling caveats (see memory `preview_gesture_testing`).
4. **`searchCatalogFuzzy` over-broadening (C1 risk b).** Live-check that fuse threshold 0.35 + filename-as-a-key doesn't surface noise on real queries; tune threshold or filename weight if so.
5. **Restore-race flicker (C8 §3.5).** Verify on a production FSA library (not the dev preview — see memory `anchor_persistence_dev_masks_fsa`) that a restored custom-lib tab's brief vanish-then-reappear is acceptable, or whether the unified store should render a placeholder tab until the manifest resolves.
6. **`leftPinnedActiveId` persistence intent.** Confirm the user *wants* the left active-tab override to survive reload (gap #4) — it was deliberately ephemeral in the current design, so this is a behavior change, not just a bug fix.
