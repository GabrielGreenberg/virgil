# Library subsystem audit — handoff pointer

**Full report (SSOT):** [docs/memos/library-audit/AUDIT.md](docs/memos/library-audit/AUDIT.md)

Manager session 2026-06-19 (ultracode, workflow-driven). Audited the Virgil **Library** tab against three user asks. 6-agent parallel audit (arch-map, persistence, search, perf:typing/selection/ambient) + batched adversarial verification + synthesis. **15/15 performance findings confirmed, 0 refuted.**

## The three asks → verdicts

1. **Local state survive reload** — real gaps: `selectedKeys` row highlight (`LibraryView.tsx:256`), search query (`LeftList.tsx:66`), catalog-list + reader scroll (`LeftList.tsx:299`, `PageScrollStrip.tsx:58`), `leftPinnedActiveId` (`useLibraryTabs.ts:239`). Tabs/pins/widths/sort/cited-only + outer-pane + custom-lib membership already persist. Recommended fix = **one versioned `view-session-store.ts`** (single debounced writer + pagehide flush + migration), NOT scattered useState+localStorage pairs. Effort **XL → dedicated session.**

2. **Flexible search** — today `LeftList.tsx:100` is a naive `hay.includes(q)`: no tokens, no diacritics, no ranking, no debounce. `"lewis score"` fails because author+title tokens sit in different haystack segments. **The fix already exists in the codebase:** `searchBibFuzzy` (`src/lib/bib-searcher.ts:96`) — token-AND, diacritic-fold, field weights, WeakMap cache — used by the Bibliography panel + bib/citekey pickers. **Only `LeftList` bypasses it.** Fix = thin `library/lib/catalog-search.ts` adapter (`searchCatalogFuzzy`) onto the shared searcher. Effort **M → safe to build now. Deep-not-surgical: unifies a duplicated matcher.**

3. **"Over-watched" performance** — confirmed: **zero `React.memo`, zero virtualization** in the whole subsystem. Hot paths:
   - **Plain row click = synchronous disk read + LaTeX parse + full `<EditorPane>` mount** (`LeftList.tsx:150`) — select conflated with open. **HIGH.**
   - `LeftListRow` not memoized → every keystroke/selection/poll re-renders all rows in both panels (`LeftListRow.tsx:55`). **HIGH.**
   - Selection hoisted to `LibraryView` fans out to both panels (`LibraryView.tsx:256`). **HIGH.**
   - Per-keystroke full re-sort + haystack rebuild, no debounce (`LeftList.tsx:85-104`). MED.
   - `dotToneFor` identity churns every poll → defeats a naive row memo (`useRowDotState.ts:71`). MED.
   - Ambient: ungated 6s queue scan (`useRowDotState.ts:45`), `useUnsortedPdfs` fresh-array every tick (`useUnsortedPdfs.ts:43`), duplicate inbox/catalog polls. MED/LOW.

## Recommended sequencing (from synthesis)

- **Now (safe, localized, reversible):** C1 flexible-search adapter, C2 search-cost reduction, C3 poll change-guards + debounced writer, C4 single row-dot poll, C9 poll coalescing.
- **Dedicated PERF session:** C5 memoize `LeftListRow` + stable props + per-citekey tone Map, C6 decouple select-from-open *(needs a product UX decision: single-click highlight vs open)*, C7 virtualize. Must land C5+C6 **together** — the `dotToneFor` identity trap defeats a half-fix.
- **Dedicated PERSISTENCE session:** C8 unified versioned `view-session-store.ts` (rewires state ownership across 5 files + migration + restore-race).

## Status

Audit only — **no code changed yet.** Awaiting user green-light on sequencing.
