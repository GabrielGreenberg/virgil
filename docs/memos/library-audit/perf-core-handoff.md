# Library perf-core session — handoff prompt

> Paste the block below into a fresh session. It picks up **Ask #3** from the Library audit
> (the "over-watched" performance). Asks #1 (persistence) and #2 (search) are already shipped
> and merged to local main; this session lands the performance CORE.

---

You're handling **Ask #3 of the Library audit: the "over-watched" performance** — the Library tab feels slow when typing in search and when selecting / switching items. The audit confirmed the cause; this session lands the perf CORE. Run on workflows + chips, preserve context, and prefer the deepest unified fix (the user's central design principle).

## Read first (SSOT — don't re-derive)
- **`docs/memos/library-audit/AUDIT.md`** — §"Ask #3 / Over-watched performance" lists the **15 confirmed findings (0 refuted)** + the recommended chips C1–C9. This is your spec.
- **`MEMO_LIBRARY_AUDIT.md`** (repo root) — pointer/summary.
- Auto-memory **`library_audit_status.md`** — full session history: Asks #1+#2 DONE+merged to **local main (NOT pushed)**; a 3-iteration `library-paper` storage bug is fixed (reads resolve on demand, writes no-op). Perf-core is the only ask left.
- **`library/AGENTS.md`** — Library subsystem guide.
- The repo **keystroke-sanctity doctrine** (`AGENTS.md` "Keystroke sanctity" + `docs/perf/keystroke-sanctity-findings.md`): the MAIN editor enforces "no work proportional to doc size per keystroke." **The Library does NOT inherit this — adopting it is the spirit of this session.**

## Decide FIRST (user deferred this twice; recommended default in brackets)
**Click behavior (chip C6).** Today a single click on a catalog row both **highlights AND opens** the paper — synchronously reads `main.tex`, parses LaTeX, and mounts a full read-only `<EditorPane>` (the single heaviest cost). Pick one and confirm with the user before building C6:
- **[RECOMMENDED] single-click = highlight only; double-click / Enter = open.** Arrowing/clicking through the list no longer mounts an editor per row. Bonus: sharply reduces how often the just-fixed `library-paper` storage paths fire.
- Alt: keep single-click-to-open but **defer** the heavy mount behind `requestIdleCallback` / a short debounce so rapid navigation doesn't mount-and-teardown an EditorPane per row.

## Confirmed hot paths
> Symbols below are stable; **line numbers in AUDIT.md PREDATE the persistence+search merges** that modified `LeftList.tsx`/`LibraryView.tsx` — **re-grep by symbol**, don't trust the old line numbers.

**HIGH**
1. **Select conflated with open (C6).** A plain row click → synchronous `main.tex` read + `parseLatex` + `<EditorPane>` mount. See `handleRowClick` / `onOpenPaper` in `library/components/LeftList.tsx`.
2. **No row memo, no virtualization (C5 + C7).** `library/components/LeftListRow.tsx` is **not** `React.memo`'d and the list isn't virtualized → every keystroke / selection / 6s poll re-renders **all** rows in **both** panels.
3. **Selection fans out (C5-adjacent).** Selection lives high in `LibraryView`. NOTE: the persistence work moved it into the **view-session store** (`usePanelSelection`, `useSyncExternalStore`) in `library/lib/view-session-store.ts` — derive each row's `selected` from there **per-row** (selector subscription) so a selection change re-renders only the 2 affected rows, not the whole list.

**MED**
4. **Per-keystroke re-sort (C2 — partially done).** The `filtered` memo in `LeftList.tsx` now routes through `searchCatalogFuzzy` (`library/lib/catalog-search.ts`, **WeakMap-cached** — the per-keystroke *haystack rebuild* is already fixed). But it still re-runs `sortEntries` over the whole result every keystroke — add `useDeferredValue`/debounce on the query that drives filter+sort.
5. **THE TRAP — `dotToneFor`/`toneFor`** in `library/hooks/useRowDotState.ts` gets a **new identity on every 6s poll / markViewed**, which **defeats a naive `React.memo` on the row**. C5 MUST stabilize this (precompute a per-citekey tone `Map` keyed on the dot-state, or pass a primitive `pending`/`tone` per row). **This is why C5 + C6 must land together as one wave** — a half-fix re-renders anyway.

**AMBIENT (cheaper — chips C3/C8/C9)**
6. `useRowDotState` 6s poll re-scans the queue dir + every queue JSON + `inbox.json` **ungated** — version-gate it on `catalog-version.txt` (1-byte read, compare to a ref, bail if unchanged).
7. `useUnsortedPdfs` reads every unsorted file's mtime every 6s and always allocates a **fresh array** — change-guard it (return `prev` when names unchanged, like `useUnsortedBibEntries` already does).
8. Lift `useRowDotState` to `LibraryView` so **one** poll feeds both panels (currently one per panel).

## Sequencing
- **WAVE 1 (must land together):** C5 (memoize `LeftListRow` + stabilize **all** per-row props: a stable `onClick` keyed by citekey, the per-citekey tone `Map`, and read `selectedKeys` lazily/via selector so it doesn't bust memo) + C6 (decouple select-from-open). The `dotToneFor` trap makes a partial fix pointless.
- **WAVE 2:** C7 virtualize (`@tanstack/react-virtual` recommended) — caps keystroke/selection cost at O(viewport) regardless of catalog size. **CRITICAL INTERACTION:** the persistence work added catalog-list **scroll save/restore** in `LeftList` (one-shot, non-empty-gated, keyed by `libId`) and reader scroll in `PaperRender`. Virtualization changes the scroll container → make scroll restore cooperate with the virtualizer (restore via its `scrollToOffset`, not a raw `scrollTop` on a now-virtual container).
- **CHEAP (anytime, low risk):** C3 (poll version-gate + change-guard), C8/C9 (single shared row-dot poll + coalesce inbox/catalog polls).

## Hard constraints — don't regress Asks #1 + #2
- `view-session-store.ts` owns **selection / query / scroll / per-(panel,library) sort / cited-only / leftPinned** — all survive reload. Keep them working; run a **reload smoke** (type a query, select a row, scroll, reload → all restored).
- `catalog-search.ts` owns fuzzy search (`"lewis score"` → Scorekeeping). Don't break it.
- The `library-paper` storage paths are guarded now (`requireDocHandle` fallback for reads, `enqueueDocWrite` guard for writes). C6 reducing EditorPane mounts is **synergistic**, not required for correctness.

## Process
- **Work in a WORKTREE off main.** The user drives the main checkout LIVE and runs **parallel sessions** — `git -C <repo> rev-parse main` before branching, commit only in the worktree, and **leave foreign worktrees alone** (`git worktree list`). Symlink `node_modules` from main (`ln -s <repo>/node_modules <wt>/node_modules`).
- Verify: `npm run typecheck`, `npm run lint`, `npm run test` (baseline **~2353** pass). Lint has a large **pre-existing** error baseline (React-Compiler rules) — prove **zero NEW** errors by diffing against a baseline checkout, don't be alarmed by the absolute count.
- Merge pattern: `--no-ff` into **local main, NOT pushed**; report; remove the worktree + branch.

## Live perf verification (the dev preview CAN do this faithfully)
- The dev preview has a **populated TEST library** at `<repo>/library-data` (Central = 234 papers; openable indexed papers like `genette1997`, `bringhurst1992`) — **NOT** the user's real `~/Virgil-Library`, so it's safe to drive hard.
- Preview gotchas (from memory): **FULL server restart** (`preview_stop` + `preview_start`) to clear stale Turbopack chunks after edits; a non-fatal `bmi2` turbopack worker panic is an env quirk (recovers, be patient on first compile); resize the iframe.
- Measure render counts: `__virgilBusStats()` is the MAIN editor's doc bus, **not** the Library list — instead instrument `LeftListRow` with a temp render counter (or React DevTools Profiler) and assert: typing in Central's search re-renders **only visible rows** (not all 234), selecting a row re-renders **only the 2 affected rows**, and (post-C7) only ~viewport rows are ever mounted.

## Recommended execution (ultracode-eligible)
Use the Workflow tool. Shape: (1) short design pass — read the hot paths + the `view-session-store`/`catalog-search` integration points, produce a chip-by-chip plan; (2) build **Wave 1** (C5+C6) in one worktree with incremental green checkpoints; (3) adversarial review of the diff (does memoization **actually skip** — the `dotToneFor` trap; did select/open decoupling break opening; persistence/search still intact); (4) live perf smoke (render counts on the 234-paper catalog); (5) build **Wave 2** (C7 virtualize + scroll cooperation) + review + smoke; (6) cheap ambient chips. Merge per wave or once at the end. Verify the reload-persistence smoke survives.
