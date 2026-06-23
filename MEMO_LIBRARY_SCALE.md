# Library at scale — overnight build digest (2026-06-22)

Companion to the research study [MEMO_LIBRARY_SCALE_RESEARCH.md](MEMO_LIBRARY_SCALE_RESEARCH.md).
This is what actually shipped, the numbers, the calls I made, and what's owed.

## TL;DR

The Library felt sluggish because **the browser re-parsed your entire 10.4 MB
`master.bib` with citation-js on the main thread** — a **measured 2.6-second
freeze** (heading to ~6 s at 100k) — just to draw a list, recovering fields the
indexing pipeline already had structured. The fix: the pipeline now emits a
**slim `bib-index.json`** and the browser reads that (~18 ms) instead of running
citation-js. **~140× faster on the path you feel.** Your real library is already
backfilled, so the win is live the next time you open the Library on this machine.

## Your question, answered

> Should the catalog hold all 34k, or stay ~4.3k indexed and generate the 34k on the fly?

**Neither.** The catalog stays lean (~4.3k indexed papers, rich status). The
~30k bib-only rows are *not* generated in the browser at runtime anymore — the
**Python pipeline precomputes a slim flat record per citekey** (one file,
`bib-index.json`), and the browser reads it. This scales cleanly to 100k+ (the
slim index is ~7 MB at 34k → ~20 MB at 100k; `JSON.parse` ~18 ms → ~50 ms, vs
citation-js's ~6 s). No 34k fat objects, no main-thread parse, ever, on browse.

## Measured (headless benchmark on your real `master.bib`)

| Path | Before | After |
|---|---|---|
| Browse list / first citation (cold) | **2,596 ms** citation-js parse | **~18 ms** `JSON.parse(bib-index.json)` |
| Same at synthetic 100k (31 MB bib) | ~2,859 ms (real ~6 s) | ~50 ms |
| Warm reload (unchanged) | re-read 10 MB + byte-compare | **~0 ms** (tiny stamp-file check) |

Run `BENCH=1 npx vitest run library/dev/bench/__tests__/library-scale.bench.test.ts` to reproduce.

## What shipped (worktree `library-scale`, merged to local `main`, NOT pushed)

1. **Slim browse-index (the deep fix).** Python `build_bib_index.py` /
   `_tools.build_bib_index` emits `.virgil/bib-index.json` (+ a tiny
   `bib-index.stamp`). Refreshed automatically whenever `master.bib` or the
   catalog changes — **atexit-coalesced** (one rebuild per writer process, not
   per entry) and **stamp-gated** (no-op when `master.bib` is unchanged, e.g.
   catalog-only status writes). Frontend `useMasterBib` reads it (mapped to the
   `BibEntry` shape), with a **graceful fallback** to the old citation-js parse
   for libraries without an index. Edit/format paths fetch the **full** entry
   on demand for the selected citekey (`getFullLibraryBibEntry` — parses one
   block, not the whole file). The browse-index carries exactly the fields the
   list, search, and citation picker render.

2. **Severe latent bug fixed: `read_master_bib` was dropping 82% of your
   bibliography.** A single brace-unbalanced entry (`fodor1984item`) made the
   old global brace-matcher swallow **8.5 MB — the rest of the file — as one
   "entry"**, so `read_master_bib` returned **5,566 of 34,363** entries. Any
   skill doing `citekey in read_master_bib(...)` (triage, index, merge) silently
   treated real entries as missing. Now line-anchored + per-segment brace-cap →
   **34,363/34,363**. (A twin of this bug lives in `_bib_parse.py` — flagged as
   a follow-up task, not fixed tonight to avoid an unvalidated change to the
   indexing pipeline.)

3. **Phase 1: retired the duplicate catalog poll.** `LibraryView` +
   `PaperOuterView` now read the shared refcounted `catalog-store` instead of
   each spawning its own 6 s loop (`useCatalog.ts` deleted). Closes the
   in-code-comment that claimed a single shared loop while a second ran.

4. **Adversarial-review hardening** (32-agent review, 4 confirmed findings):
   blocked a real **data-loss path** (the edit modal could open on a slim entry
   and drop fields on save — now gated on the full entry), made the slim
   projection browse-complete (editor + pub details), and made a corrupt index
   fall back to `master.bib` instead of an empty list.

5. **Instrumentation:** flag-gated `lib-perf` timing + a headless scale benchmark.

## Calls I made for you

- **Kept the `raw` bib field** (the research memo floated dropping it). Once
  browse stops parsing `master.bib`, `raw` only loads when you actually edit an
  entry — where exact round-trip fidelity matters. Cleaner to keep it.
- **Made the slim index "browse-complete," not minimal** — it carries every
  field the list/search/picker render (12 fields). +1.4 MB on disk, +~3 ms
  parse; in exchange, zero field-omission regressions. The right abstraction is
  "what browse reads," not "the fewest bytes."
- **Deferred the IndexedDB parse cache and the Web Worker** (research Phases
  3–4). Post-fix, cold open is already ~18 ms and warm is ~0 ms — both
  imperceptible, and 100k stays under ~50 ms. They'd be gold-plating now; the
  slim index is the architectural win that makes them unnecessary at your scale.
- **Kept the 6 s poll** but made it cheap (tiny stamp check).

## Verification

- `tsc` 0 · **2545 vitest** + **7 Python** tests (incl. atexit coherence
  end-to-end + the desync regression) · 0 new lint.
- The dev preview can't load your real 34k FSA library, so the live numbers
  come from the headless bench on your actual `master.bib`, not the preview.

## OWED: your live FSA feel-check

Open the Library on this machine and confirm it feels snappy (first open, first
citation in a doc, scrolling, the citation picker). To *see* the win quantified
in the browser console:

```js
localStorage.setItem("virgil:lib-perf", "1")  // then reload; timings print as [lib-perf]
```

You should see `bib-index read+map ~18 ms` instead of a multi-second
`master.bib citation-js parse`. If anything feels off (a stale list after a
skill run, an editor-only entry showing "—"), tell me and I'll dig in.

## Follow-ups (flagged, not done)

- **`_bib_parse.py` desync twin** — same 82%-drop bug; spawned as a task.
- **IndexedDB cache / Web Worker** — only if a real 100k library ever shows
  pressure (it shouldn't).
