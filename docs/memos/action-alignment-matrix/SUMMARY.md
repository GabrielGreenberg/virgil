# CHIP 8 — Cross-surface action-alignment verification: SUMMARY

The empirical verification pass the effort has wanted since the "math won't archive" miss.
Verifies every editing tool across every surface × applicable text-object kind, the way a user
actually exercises them. **Outcome: the action-alignment refactor is sound; 2 latent DATA-LOSS bugs
were found and fixed; the matrix is now covered by both live-canary observation and a permanent
real-stack regression suite.**

## How it was verified (two complementary layers)

1. **Live canary** (manager, preview-driven on `doc_devtest`) — the surfaces that are React-coupled
   and only meaningful in the real app: the **grab-bar + lightning** dispatch path, the real
   `ConfirmDialog`, KaTeX/atom rendering, autosave→disk round-trip. Drove archive/delete/duplicate ×
   every kind × anchored × atom-bearing × atom-only, citation+footnote creation across surfaces,
   slash commands. Harness + gotchas in [`_harness.js`](_harness.js) and the RESULTS docs.
2. **Real-stack suite** (dispatched Workflow, 200 cases, 5 files) — drives the *actual* code
   (`buildEditorExtensions`, real `COMMAND_MAP.action` / input-rule `handleTextInput` / registry
   `run()` / delete-range + duplicateSlice), **no product mocks**, asserting byte-identical
   cross-surface results + correct per-kind effect. Permanent regression oracle. See
   [`RESULTS-realstack.md`](RESULTS-realstack.md).

The single shared preview makes the live layer inherently sequential (one dev doc); the dispatchable
breadth is the real-stack layer. The two together cover the matrix.

## Bugs found + fixed (both DATA-LOSS, both merged + verified)

- **F2** (`741c1fa`) — paragraph delete/archive **swallowed a trailing size-1 block atom**
  (graphicsBlock/displayMath/texBlock) when the deleted range contained an inline atom:
  `cleanupLinksInRange` synchronously stripped the atom, shrinking the paragraph and making the
  pre-computed delete `to` **stale** → over-reach. Fix: `cleanupAndComputeDeleteRange` corrects `to`
  by the cleanup's doc-size delta (atom- + kind-agnostic). The dispatched agent's adversarial
  root-cause *corrected the manager's "graphics-specific plugin" premise*. Live-verified.
- **Bug #1** (`7ecf358`) — **bullet/ordered-list (and blockquote) toggle destroyed a `\title` field /
  heading** (`formatApplies` returned `ok` unconditionally for wrapper rows). Fix: wrapper rows route
  through `wrapperApplies` → `disabled` on non-listable kinds (`LISTABLE_BLOCK_TYPES = {paragraph,
  listItem}`, schema-derived from the list/quote content models), + a `run()` no-op guard + UI greying.
  Real-stack-verified (the flipped characterization test drives the actual registry applies/run).

## Confirmed-clean (not bugs)

- The whole **lifecycle** layer (`LIFECYCLE_DELETE_META` class) + the **atom-only** fixes
  (80170b3/f4c830f/63ccace) HOLD. **Duplicate** renumbers atom ids (no duplicate-key).
- **Citation** byte-identical across grab/lightning/slash/typed (the 3-way / typed-cite-no-card
  divergence is unified). **Footnote** identical across its surfaces.
- **Headings** SET+numbered (convert-in-place, no toggle). **Format marks** registry⇄keymap parity.
  **title/author/date** idempotent. **`\ref`** popover parity.
- Non-bugs filed: **F1** (latexComment no-confirm is `() => null` by design); **F3 + findings
  #2/#4/#5/#6** are oracle/jsdoc staleness or by-design (live code is truth) — docs corrected.

## Artifacts
- [`RESULTS-lifecycle.md`](RESULTS-lifecycle.md) · [`RESULTS-alignment.md`](RESULTS-alignment.md) ·
  [`RESULTS-realstack.md`](RESULTS-realstack.md) — the verification records.
- [`FINDINGS.md`](FINDINGS.md) — per-defect root-cause log (F1/F2/F3).
- [`EXPECTED-MATRIX.md`](EXPECTED-MATRIX.md) + `cells.json` (untracked, regenerable via `_gen_oracle.py`)
  + [`_recipes.md`](_recipes.md) — the 717-cell oracle + surface-driver recipes.
- Test suite: `src/lib/{actions,tiptap}/__tests__/chip8-*.test.ts` (200 cases) + the F2/Bug#1
  regression tests. Full suite **1331 green**.

## Status: CHIP 8 COMPLETE. The multi-surface action-alignment effort (CHIP 0–8) is done.
