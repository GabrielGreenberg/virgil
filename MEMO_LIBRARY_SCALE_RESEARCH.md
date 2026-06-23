# Library data-layer scale study (34k → 100k)

Lead-architect synthesis of 8 parallel code audits + direct re-verification against `HEAD` (2026-06-22).

**Ground truth (user's real library, verified):**
- `master.bib` = 10.4 MB, **34,365** `@`-entries
- `.virgil/catalog.json` = 8.7 MB, **4,324** entries (`{version, generatedAt, entries:[…]}`)
- ~1,489 folders under `papers/`
- Target: scale to **100k** bib entries without browser jank.
- User reports the Library tab feels "sluggish."

The headline asymmetry to hold in mind throughout: **the catalog is 4.3k; master.bib is 34k.** They are different beasts. The catalog is the indexed-paper spine; master.bib is the full bibliography. The Library list merges them, so the *list* is ~34k rows even though the *catalog* is 4.3k. Most of the "34k" cost in this memo is master.bib cost wearing a catalog costume.

---

## 1. Executive summary — what actually makes it sluggish at 34k

In priority order, grounded in the audits and re-verified:

1. **master.bib parse on the main thread via citation-js (the real heavyweight).** `parseBibFile` (`library/lib/bib-parser.ts:89`) runs citation-js synchronously over the entire 10.4 MB file. citation-js is BibTeX-regex + CSL-JSON-conversion per entry — ~200-500 ms at 34k, and **1-3 s at 100k**. This is the single largest blocking cost and it fires on first Library mount, on a real master.bib edit, and (cheaply when content is unchanged — see §2) on window focus. JSON.parse of the 8.7 MB catalog is a distant second at ~20-50 ms.

2. **Two independent catalog polling loops, not one.** This is **confirmed by re-verification, correcting the codebase's own comment.** `LibraryView.tsx:103` calls `useCatalog(handle)` directly (its own `setInterval`, `useCatalog.ts:44`) *and* the Bibliography façade drives `catalog-store.ts`'s shared loop (`catalog-store.ts:149`). `catalog-store.ts:8-12` even claims "Lets the Library tab read the same store rather than spawning a second polling loop" — but the Library tab does **not** read the store; it still spawns its own loop. When `catalog-version.txt` bumps, both fire. The 1-byte version read is cheap; the cost is the duplicated full re-read/re-derive on change.

3. **`mergedEntries` re-synthesizes all 34k rows on every catalog/bib identity change** (`LibraryView.tsx:407-473`). On a poll that yields a new `catalog` object identity, the memo re-walks `bibEntries` (34k), allocates a fresh `CatalogEntry` object for each of the ~30k bib-only keys (`bibOnlySynthetic`, line 428-444), and returns a new 34k array. Everything downstream (sort, filter, search synth) keys on this array's identity, so a new identity invalidates the whole chain.

4. **`withUids` allocates a fresh 34k-spread-copy array** every time `entries` identity changes (`src/hooks/useLibrary.ts:167-170`). `entries.map((e) => ({ ...e, uid: mintBibUid() }))` is a full O(n) allocation + GC pressure on the editor side, separate from the Library tab's copies.

5. **Heap: 4-6 simultaneous 34k-object copies.** master.bib raw string (FSA) + parsed `BibEntry[]` (each retaining `raw`, a *second* fragmented 10 MB copy — `types.ts:9`, `bib-parser.ts:61`) + `withUids` spread copies + `mergedEntries` + sorted + filtered. ~40-50 MB resident at 34k; ~120-150 MB at 100k.

**What is NOT the problem (corrections):** DOM rendering is *already solved* — the list is virtualized to ~57 rows via `list-window.ts` (chip C7). Per-keystroke search is *already* cheap (~0.3-0.5 ms) because synth-records and the Fuse index are WeakMap-cached on array identity. Per-keystroke does **not** re-sort (sort memo excludes the query). These were the right fixes and should be preserved. The remaining sluggishness is **parse + synthesis + heap on identity-churn events** (poll, focus, edit), not per-keystroke work.

**The subjective "sluggish" is almost certainly one of two things:** (a) a perceptible stall on first Library-tab open / first citation in a doc (cold citation-js parse), and/or (b) a periodic micro-stall every 6 s when a skill bumps `catalog-version.txt` and the dual loops + 34k re-synthesis + (if master.bib changed) re-parse all fire. At 100k both become unambiguous multi-hundred-ms-to-multi-second freezes.

---

## 2. Verified facts vs corrected premises

The prior informal analysis's claims, adjudicated against the code:

| # | Prior claim | Verdict | Evidence |
|---|---|---|---|
| 1 | catalog.json re-parsed on every open, no cache | **Confirmed** | `catalog.ts:118-133` `readCatalog` → `JSON.parse`, no parse cache (unlike `bib-parser.ts:71`). |
| 2 | A 6 s poll re-parses 8.7 MB on the main thread on version bump | **Confirmed** | `catalog-store.ts:107` + `useCatalog.ts:38` both `readCatalog` synchronously on the JS thread; `library-storage.ts:128` `JSON.parse`. |
| 3 | Two independent catalog polling loops | **Confirmed (and the in-code comment is wrong)** | `LibraryView.tsx:103` `useCatalog(handle)` (loop A, `useCatalog.ts:44`) **plus** `catalog-store.ts:149` (loop B). `catalog-store.ts:9-12` claims the tab reads the store — it does not. |
| 4 | catalog parse result not cached (unlike master.bib) | **Confirmed** | `bib-parser.ts:71-91` `PARSE_CACHE` (4-entry LRU); no catalog equivalent. |
| 5 | 3-6 in-heap catalog/bib copies | **Confirmed** | `useCatalog` state + `catalog-store` state + `mergedEntries` + sorted + filtered + (editor) `withUids`. |
| 6 | `useSyncExternalStore` doesn't dedupe the two loops | **Confirmed** | `catalog-store.ts:175` dedupes store *subscribers*; `useCatalog` is a separate `useState` loop entirely. |
| 7 | master.bib re-parsed on every window focus | **Partial → mostly refuted** | `useMasterBib.ts:42` focus → `reload`, but `reload` byte-compares `lastTextRef` (`:30`) and **skips `parseBibFile` if unchanged**. Focus re-*reads* the file text (FSA I/O) but does **not** re-parse unchanged content. The expensive citation-js parse only fires on a real edit. The audit overstated this. |
| 8 | master.bib parsed unconditionally in every editor session | **Refuted** | `EditorPane.tsx:955` gates `useLibraryMasterBib(hasAnyCitationKey)`; `useLibrary.ts:142` short-circuits to `[]` when disabled. Blank docs pay nothing. |
| 9 | Bibliography panel parses master.bib even for citation-free papers | **Refuted** | `useLibraryMasterBib()` defaults `enabled=true`, but the panel only mounts when docked/active; an unmounted panel parses nothing. |
| 10 | `raw` field is a second ~10 MB heap copy, used in only 2 fallback paths | **Confirmed** | `types.ts:9`; populated `bib-parser.ts:61`; read only at `bib-parser.ts:131` (serialize) + `:719` (formatBibliography), both with `reconstructBibtex` fallbacks. Search never reads it (`bib-searcher.ts:37-62` indexes `key`+`fields.*`). |
| 11 | Fuse index built over all 34k | **Refuted** | Fuse is built over the **4,324 catalog entries** synth'd to records (`catalog-search.ts:57-98`); master.bib is only a `bibByKey` lookup table for fallback fields. |
| 12 | Per-keystroke rebuilds the Fuse index / re-synthesizes | **Refuted** | `catalog-search.ts:38` `synthCache` WeakMap + `bib-searcher.ts:67` `fuseCache` WeakMap, both keyed on `entries[]` identity. Keystroke only changes the query → ~0.3-0.5 ms token scan. |
| 13 | Per-keystroke re-sorts the list | **Refuted** | `LeftList.tsx:124` sort memo deps are `[entries, bibByKey, sort]` — not `deferredQuery`. Filter (`:138`) is order-preserving over the pre-sorted array. |
| 14 | DOM renders all 34k rows | **Refuted** | `list-window.ts` + `LeftList.tsx:431` window to ~57 rows; `LeftListRow` is `memo`'d (`:369`). Verified by render-count tests. |
| 15 | Dashboard count query is uncapped per keystroke | **Confirmed** | `LibraryCentralDashboard.tsx:58-64` runs `searchCatalogFuzzy(…)` with no limit to compute `matchCount`. Over 4.3k today it's fine; over a 100k catalog it's a real cost. |
| 16 | `mergedEntries` re-synthesizes ~30k bib-only rows on each identity change | **Confirmed** | `LibraryView.tsx:428-444` loops all `bibEntries`, allocates a `CatalogEntry` per unmapped key, deps `[catalog, bibEntries, unsortedFiles, unsortedBibByFile]`. |

**Net correction to the informal premise:** the search/render/keystroke layer is *already well-architected* (prior perf-core work, chips C1-C7) — do not re-litigate it. The unsolved class is **parse + synthesis + heap on coarse identity-churn events**, plus **two structural redundancies** (dual catalog loops; the unused `catalog-store` for the Library tab).

---

## 3. The data-flow today (precise trace)

Each hop annotated: **[O(?)]**, **[main-thread block? Y/N]**, cost at 34k.

```
DISK
 ├─ master.bib (10.4 MB)                                  FSA file.text()  [O(file), N-ish, ~15-40 ms buffer]
 └─ .virgil/catalog.json (8.7 MB)                         FSA file.text()  [O(file), N-ish]
 └─ .virgil/catalog-version.txt (1 byte)                  FSA file.text()  [O(1), N, ~0 ms]   ← the 6s poll reads THIS

PARSE
 ├─ master.bib → parseBibFile (citation-js)               [O(n), Y BLOCK, ~200-500 ms @34k → 1-3 s @100k]
 │     bib-parser.ts:89. Whole-file try, per-entry fallback on any malformed entry.
 │     PARSE_CACHE (4-LRU, keyed on full text) hits only within a session on identical bytes.
 │     EACH BibEntry retains `raw` → second ~10 MB fragmented copy. types.ts:9 / bib-parser.ts:61.
 └─ catalog.json → readCatalog → JSON.parse                [O(n), Y BLOCK, ~20-50 ms @34k → ~150-400 ms @100k]
       catalog.ts:121 + library-storage.ts:128. No cache. Re-parses on every version bump.

HEAP COPIES (simultaneous)
 ├─ useCatalog state (LibraryView)        catalog.entries (4.3k)     [loop A]
 ├─ catalog-store state (Bibliography)    catalog.entries (4.3k)     [loop B — DUPLICATE]
 ├─ useMasterBib entries (34k, w/ raw)
 ├─ useLibrary withUids (34k spread copies)  useLibrary.ts:167       [O(n) alloc per identity change, editor side]
 ├─ mergedEntries (34k)                   LibraryView.tsx:407
 ├─ sorted (34k)                          LeftList.tsx:124
 └─ filtered (subset)                     LeftList.tsx:138

MERGED SYNTHESIS                                           [O(total), Y BLOCK, deps churn on poll]
 └─ mergedEntries  LibraryView.tsx:407-473
       rows = catalog.entries (4.3k)
       + unsortedSynthetic        (small)
       + bibOnlySynthetic (~30k)  ← allocates a CatalogEntry per unmapped master.bib key, line 428-444
       + unsortedBibSynthetic     (small)
       Re-runs whenever catalog / bibEntries / unsorted identities change (i.e., every poll that detects a bump).

SORT / FILTER / SEARCH
 ├─ sort     LeftList.tsx:124   [O(n log n), Y, deps exclude query → NOT per-keystroke]
 ├─ filter   LeftList.tsx:138   [O(n) membership, per-keystroke, order-preserving]
 └─ search   catalog-search.ts  [synth O(n) once per entries identity (WeakMap), then O(n) token scan/keystroke]
       Fuse index built over 4.3k synth records, cached on entries identity (bib-searcher.ts:67).

WINDOWED DOM                                              [O(visible)=~57 rows, N]
 └─ list-window.ts + LeftList.tsx:431-564, LeftListRow memo'd (:369). SOLVED.
```

**Reading of the trace:** every box marked `[Y BLOCK]` that sits on a *coarse identity-churn event* (poll detecting a version bump, focus, edit) is the sluggishness surface. The per-keystroke row is clean. The blocking work is concentrated in **parse** and **mergedEntries synthesis**, both O(total), both on the main thread, both fired by the dual 6 s loops.

---

## 4. The core architectural question

**Should the catalog hold all 34k, or stay ~4.3k indexed + synthesize bib-only rows on the fly?**

Today it's the latter: catalog = 4.3k indexed papers; the other ~30k rows are synthesized from master.bib in `mergedEntries`. The question is whether to make the skill-side emit a unified 34k catalog instead.

**Recommendation: keep the catalog lean (~4.3k indexed), but STOP re-synthesizing the 30k bib-only rows in React on every poll. Move the merge to a precomputed, skill-emitted slim browse-index, and back the frontend with an IndexedDB parse cache.**

Reasoning:

- **Don't fatten catalog.json with 30k bib-only rows.** That just moves the 10 MB master.bib cost into an even bigger catalog.json and doubles the on-disk footprint, while the skill side already has both files in hand. It also couples two write cadences (catalog rebuild vs. master.bib edits) that today are independent.

- **The expensive thing is citation-js, not the merge.** The frontend parses master.bib with citation-js purely to extract `key / title / author / year / doi` for ~30k bib-only rows — fields that the Python side already has structured. Asking the browser to run citation-js over 10.4 MB to recover data the pipeline already knows is the core waste. **The deepest lever is to never parse master.bib in the browser for browse purposes at all.**

- **Precomputed slim browse-index (the deep alternative).** Have the skill side emit `.virgil/browse-index.json` (or `.jsonl`): one slim record per *every* citekey in master.bib — `{citekey, title, authors, year, doi, indexed.state, bib.state, pdf.present}` — derived at skill time when the bib is already parsed. This is the union the frontend currently builds at runtime, minus all the heavy fields and `raw`. A 100k slim index is ~15-25 MB JSON of *flat* records (vs. citation-js over 25-30 MB of BibTeX). The frontend then: reads the slim index, never runs citation-js for browse, and `mergedEntries` collapses to a near-passthrough.

- **IndexedDB parse cache (the other deep lever).** Structured-clone the parsed/derived browse-index into IndexedDB keyed on `catalog-version.txt` (or a content hash). On cold open, if the cached version matches disk, deserialize from IDB (structured clone of typed objects, no JSON.parse, no citation-js) instead of re-reading + re-parsing. This is the same pattern already used for the folder handle (`library-folder.ts`). Eliminates the cold-open stall entirely on revisit.

- **citation-js stays, but only for the write/edit/serialize path** (bib editing, `formatBibliography`), invoked on demand for the handful of entries actually being edited — never over the whole file for browse.

**Bottom line:** the catalog/bib split is the right model; the bug is doing the *merge* and the *field extraction* in the browser at runtime instead of once, at skill time, into a slim flat index — and never caching the result.

---

## 5. Design options

Four coherent directions, not patches. Each: what it changes / what it fixes / effort / risk / 100k scaling.

### Option A — Consolidation + memo hardening (the floor)
**What:** Delete the second polling loop: make `LibraryView` consume `catalog-store` via `useCatalogItems()` instead of `useCatalog(handle)` (retire `useCatalog.ts`). Add a 4-LRU `PARSE_CACHE`-style cache to `readCatalog` keyed on the version string so unchanged polls don't re-`JSON.parse`. Stabilize `mergedEntries`: skip re-synthesis when the bib-only key set is unchanged (hash the inputs); return the prior array identity on a no-op. Drop the `raw` field from `BibEntry` (reconstruct on serialize).
**Fixes:** dual loops (#3), catalog re-parse on no-op churn (#1/#2), 34k re-synthesis on every poll (#16), the second 10 MB `raw` heap copy (#10), `withUids` churn (cache on identity).
**Effort:** S-M (~1-2 days). No schema change, no worker, no Python.
**Risk:** Low. Mostly deletion + memoization; `raw` removal is covered by existing fallbacks (audit-confirmed).
**100k:** Helps but does not cure. citation-js parse of master.bib still blocks the main thread (~1-3 s) on first mount and on any edit. **Necessary but insufficient at 100k.**

### Option B — Web Worker for parse + index (off-thread the blocking work)
**What:** Move both `JSON.parse(catalog)` and `parseBibFile(master.bib)` + Fuse-index build into a Web Worker. Worker owns the parsed structures; main thread receives slim records via `postMessage` (or `SharedArrayBuffer` for the hot list). Show a placeholder until first ready.
**Fixes:** main-thread blocking (the #1 cost) regardless of file size — the freeze becomes a background spinner.
**Effort:** M-L (~3-5 days). New worker boundary, serialization contract, careful WeakMap-cache relocation. Library tab is client-only so no SSR conflict.
**Risk:** Medium. citation-js in a worker; structured-clone cost of passing 34k-100k records back; keeping the synth/Fuse WeakMap invariants intact across the boundary.
**100k:** Strong — parse time stops being *jank* even if it stays *slow*. But it still parses 25-30 MB of BibTeX via citation-js every cold open unless paired with a cache. Best combined with A's IDB cache.

### Option C — Skill-emitted slim browse-index + IndexedDB cache (the deep, unified solution) ★
**What:** Python pipeline emits `.virgil/browse-index.json(l)` — one flat slim record per citekey across the *whole* bibliography (indexed papers + bib-only), built when the bib is already parsed skill-side, bumped under `lock_catalog` alongside `catalog-version.txt`. Frontend:
1. reads the slim index (flat records — fast `JSON.parse`, no citation-js);
2. structured-clones it into IndexedDB keyed on version → cold-open revisits skip parse entirely;
3. `mergedEntries` collapses to a passthrough (catalog status overlaid onto slim records by citekey);
4. citation-js retained only for the on-demand edit/serialize path;
5. (optionally) the slim read + IDB hydrate runs in a tiny worker (folds in B's benefit cheaply, since flat records clone cheaply).
**Fixes:** *the entire class* — parse cost (no browser citation-js for browse), heap bloat (no `raw`, no 34k spread copies, one slim array), search cost (Fuse over slim flat records), main-thread blocking (flat parse + IDB clone are cheap; optional worker), **and** main-editor leakage (the citation picker / auto-add read the same slim index instead of parsing master.bib).
**Effort:** L (~1 week). Touches Python (`_tools.py` emit step), the frontend read path, `mergedEntries`, `useLibraryMasterBib`, and the IDB cache layer. JSONL enables future streaming/sharded loads.
**Risk:** Medium. Cross-cadence write coordination (browse-index must bump with master.bib edits, not just catalog rebuilds — the existing `imported`-key additions-only sweep is a precedent for "bib changed → re-emit"). One new sidecar to keep coherent.
**100k:** Excellent. Flat 100k JSON parse ≈ 150-400 ms once, then ~0 on revisit (IDB). No citation-js in the browse path at any scale. With JSONL, can shard/stream if even that grows. **This is the direction that captures every audit's "design implication" simultaneously.**

### Option D — On-demand virtual store (lazy, no full load)
**What:** Don't load 34k/100k into memory at all. Keep an in-memory index of *citekeys only* (+ a tiny prefix/token index for search), and read individual entry detail from disk (or a sharded index) on row activation / scroll.
**Fixes:** heap ceiling (the only option that fundamentally caps memory), cold-open time.
**Effort:** XL (>1 week). Rebuilds the data model, search (needs a real on-disk/prefix index, not Fuse-over-all), sort (can't sort what isn't loaded without a precomputed order), and selection.
**Risk:** High. Search ranking and sort over a not-fully-loaded set is a hard problem; large rework of a recently-stabilized subsystem.
**100k:** Best on memory, but overkill if C's slim index already fits comfortably in heap (a 100k slim index is ~15-25 MB parsed — well within budget). **Reserve for 500k+; not warranted now.**

**The deepest unified solution is C.** It is the only option that addresses parse cost, heap bloat, search cost, main-thread blocking, *and* main-editor leakage with one architectural move (emit-once-slim + cache), rather than mitigating each symptom separately. A and B each fix a slice; C subsumes both (and B becomes a cheap add-on once records are flat).

---

## 6. Recommended direction (layered, phased)

**Adopt C as the target architecture, but land A first as the immediate-relief floor** — A is low-risk deletion/memoization that the user feels this week, and every line of it survives into C.

**Phase 0 — Measure (½ day).** Instrument `parseBibFile`, `readCatalog`, and `mergedEntries` with `performance.now()` deltas behind a dev flag. Confirm on the real library whether "sluggish" = cold-open parse vs. 6 s-poll re-synthesis. This decides Phase 1 ordering and gives a before/after number. (Several audits flagged this as the key open measurement.)

**Phase 1 — Consolidation floor (Option A, 1-2 days).**
- Retire `useCatalog.ts`; `LibraryView` consumes `useCatalogItems()` from `catalog-store`. One loop, one parsed catalog. (Closes the in-code-comment lie at `catalog-store.ts:9-12`.)
- Version-keyed parse cache in `readCatalog` (mirror `bib-parser.ts:71-91`).
- `mergedEntries`: input-hash guard → return prior identity on no-op; stop re-allocating 30k objects every poll.
- Memoize `withUids` so it doesn't re-spread 34k on stable input.
- Delete `raw` from `BibEntry`; rely on `reconstructBibtex` (audit-confirmed safe).

**Phase 2 — Slim browse-index emit (Option C core, ~3 days).**
- Python: emit `.virgil/browse-index.jsonl` under `lock_catalog`, bumped on both catalog rebuild *and* master.bib edits (extend the existing additions-only sweep precedent).
- Frontend: read slim index; `mergedEntries` becomes status-overlay-by-citekey; `useLibraryMasterBib` (citation picker / auto-add, `EditorPane.tsx:955`) reads slim index instead of running citation-js. **This is where main-editor leakage dies.**
- citation-js confined to the edit/serialize path.

**Phase 3 — IndexedDB cache + optional worker (Option C cache, ~2 days).**
- Structured-clone the hydrated slim index into IDB keyed on version; cold-open revisits skip parse.
- If Phase 0 shows parse still visible, wrap the slim read + hydrate in a small worker (cheap now that records are flat).
- Cap the dashboard count query (`LibraryCentralDashboard.tsx:62`) — stop at N matches, show "N+", relevant only once the catalog itself is large.

**Phase 4 (only if 100k profiling demands) — shard/stream the JSONL** and/or move to Option D's on-demand model. Defer until a real 100k dataset proves heap pressure; the slim index likely makes this unnecessary.

Preserve untouched: `list-window.ts` virtualization, `LeftListRow` memo, the synth/Fuse WeakMap caches, the per-keystroke sort/filter split. Those are correct and load-bearing.

---

## 7. Open questions for the user (product decisions)

1. **What does "sluggish" mean concretely?** Cold Library-tab open, the first citation in a doc, a periodic hitch while skills run, or scroll/keystroke lag? Phase 0 will measure it, but your subjective read decides whether Phase 1 alone suffices or we push straight to Phase 2/3. (Every audit converged on this as the gating unknown.)

2. **Is 100k a real near-term target or a stress ceiling?** If it's a "must not fall over" ceiling rather than an expected size, Phase 1 + 2 likely suffice and we can defer Phase 3's worker and Phase 4 entirely.

3. **Acceptable to add one more skill-emitted sidecar (`browse-index.jsonl`)?** It's the linchpin of the deep fix. The cost is one more file the pipeline keeps coherent (coordinated with master.bib edits, not just catalog rebuilds). Precedent exists (the `imported`-keys additions-only sweep), but it's a real ongoing contract.

4. **Catalog refresh cadence — is 6 s sacred?** If near-real-time isn't required for the browse list, a 30-60 s poll (or event-driven refresh) would cut the churn-event frequency materially with zero architecture change. Bibliography-panel responsiveness is the constraint to weigh.

5. **Dashboard exact match count** — is the precise "N matches" number worth an uncapped scan, or is "N+" acceptable above a threshold? Only matters once the catalog itself (not master.bib) grows large.

6. **Is `raw`-field removal acceptable now?** It's confirmed safe (only 2 fallback readers, both with reconstruction), saves ~10 MB at 34k / ~30 MB at 100k, and is the cheapest single heap win. Confirm no out-of-band consumer relies on byte-exact round-trip of the original BibTeX block.
