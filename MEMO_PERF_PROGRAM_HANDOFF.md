# Large-Doc Performance Program — Session Handoff Memo

**Written:** 2026-08-09 · **For:** the next session(s) executing Waves 2–4.
**Read these two first:**
- **The approved plan** (all wave designs, exit criteria, file lists):
  `~/.claude/plans/ok-can-you-come-cuddly-kahan.md`
- **The diagnosis** (measured causes, file:line evidence):
  `MEMO_PERF_DEEP_RESEARCH_2026_08_08.md` (repo root)

This memo holds everything NOT in those two: program state, operational
mechanics, measured baselines, gotchas earned during Waves 0–1, and the
reconciliation procedure for the concurrently-moving main.

---

## 1. Program state

Five waves, user-approved (deep-unified architecture; doc-products first;
lint worker + content-visibility experiment both IN; static card tiers OK).

| Wave | Status | Merge commit (local main, UNPUSHED) |
|---|---|---|
| Baseline gate | **partially owed** (see §6) | — |
| **Wave 0** quick wins | **MERGED** | `aa64202d` |
| **Wave 1** DocProducts pipeline | **MERGED** | `e496029f` |
| **Wave 2** EditorGeometry + content-drag | **MERGED (core; residuals below)** | `1aa8581e` |
| Wave 3 card presence tiers | NOT STARTED | — |
| Wave 4 containment + doctrine | NOT STARTED | — |

### Wave 2 delivered (2026-08-09; 8 stage commits, each green vs tsc + full suite)
- **Reconciliation:** task 317 (PaneDragBus → LayoutGestureBus + window
  publisher) merged to main mid-session; P4 CONSUMED it — NO separate
  ContentDragBus. Content drags = the bus's THIRD `kind` ("content"),
  publisher colocated in layout-gesture-bus.ts (`beginContentGesture`/
  `endContentGesture`, kind pinned, NOT in the barrel), called ONLY by the
  drop-mode controller: begin on session start, end at COMMIT ENTRY
  (confirm dialog must not hold parks hostage) + idempotently in
  endDropSession. Missed-release bails in the controller's shared mousemove
  AND LiftHost (all producers are hold-drags — verified before adding).
- **Overlap-sound kind filtering:** `onLayoutGestureSetChange` (fires per
  MEMBERSHIP change with that gesture's own info) + `hasActiveLayoutGesture(kinds)`.
  NEVER filter `info.kind` on the outermost-edge channel (begin/end can
  carry DIFFERENT gestures under overlap). Migrated: PaneFreeze
  (resize-family only — a content drag must never freeze the Library
  Reader pane hosting the drag), editor-scrollbar thumb (kind-filtered),
  zen-margin + panel-column (fixes their latent stranded-isResizing).
  `useLayoutGestureActive(kinds?)` is the hook form.
- **EditorGeometry service** `src/lib/editor-geometry/`: marginalia engine
  moved VERBATIM (service.ts; getOrCreateGeometry render-safe attach +
  retain() refcounted engine start/stop; useMarginaliaRegistry = thin
  adapter; its 8 suites passed UNTOUCHED = the parity gate). Then S3b:
  measure positions from the bus snapshot (zero walks per flush/IO batch;
  isAtom via schema from typeName; coverage identical by construction),
  O(1) orderIndex, cascade∩observed, onBlockOrderChanged resync,
  empty-bail before host gBCR.
- **S1 bus extension:** `BlockEntry.parTitled` + `blockParTitleChanged` +
  `onBlockParTitlesChanged` (+ congruence-manifest entry). A FLIP is
  structural; typing INSIDE a title is null. Both write shapes covered
  (AttrStep branch + the ReplaceAroundStep range-walk reconciler).
- **C2 breadcrumb ×3** (EditorLayout main+mirror, reader-view-prefs):
  `computeSectionPathAt` — ONE posAtCoords at the reference line + binary
  search over headings ∪ parTitled vocab (version-keyed uuid cache,
  positions read fresh from the snapshot). Legacy walks = automatic
  fallback on null; kill-switch `virgil:geom-breadcrumb="off"`.
- **C1+C3 hover** — `blocksAtY` (cached-band containment, innermost-first,
  3-way contract: null=can't answer→fallback, []=real gap). Grab-handle
  resolver + par-title hover band consume it; kill-switch
  `virgil:geom-hover="off"`. Grab handle's hover mousemove also routes
  through its layout-gesture park (one settle per gesture).
- **P4/D3 LiftHost:** transform-only overlay (React renders on EDGES;
  motion = RAF translate3d via motionTargetsRef; state cursor FROZEN at
  gesture start so base+transform can't double-count; release math reads
  live closure cursor). computeLabel via bus. Controller-level edge-zone
  AUTO-SCROLL (auto-scroll.ts) for all producers.
- **C5 (partial):** useInTextPositions wiring split off `measure` identity
  (settle loop no longer re-arms on items churn — the S4 storm).
- **CI/probes/doctrine:** content-drag-guardrail.test.ts (4 legs);
  __geometryStats (= __marginaliaStats alias + blocksAtY counters);
  AGENTS.md layout-gesture section rewritten (3 publishers, set-channel
  rule) + new "Editor geometry" section.
- **LIVE-VERIFIED** (dev preview, hidden pane): 15-keystroke burst →
  emit/materialize delta 0; parTitle flip +1 / in-place 0 / unflip +1;
  reference-line posAtCoords coherent on doc_perfhuge. CAVEAT: the hidden
  pane never delivers IO → near-zone stays empty → blocksAtY returned null
  (fallback path exercised, cached-band path NOT); needs the
  visible-window/real-PWA check.

### Wave 2 RESIDUALS (do these before/with Wave 3)
- **C7** caret consolidation: SelectionActionsMenu / PendingChangePill /
  SlashCommandPopup onto a service viewport frame + coordsAtPosCached →
  DELETE useEditorViewportCache (4 instances, 8 ROs → ~2/pane). Plan §Wave 2.
- **C5 remainder:** approxTopForPos for out-of-zone anchors in
  useInTextPositions.
- **C6** getActiveParagraphId → topmostBlockInView (also: its callers poll
  on a bare 2s setInterval with no visibility/gesture gate).
- **C8** drop-mode downstream reads.
- Exit-criteria audit vs plan §Wave 2 once C7 lands (RO census, per-move
  main-thread ms).

Nothing is pushed. Gabriel's real-PWA feel check of Waves 0+1 is owed (his
hands are the final instrument; the dev preview understates gains).

### Wave 0 delivered (all live-verified where measurable)
1. **Print gate** — `src/lib/print-intent.ts` + gated mount in EditorPane
   (~:6590). Appendices mount only during print. doc_perftest: 307→181
   editors, verified incl. beforeprint→afterprint cycle 181→307→181.
   Kill-switch: `localStorage["virgil:print-gate"]="off"`.
2. **`__editorCensus()` probe** — `src/lib/editor-census-probe.ts`,
   counters in the four editor mount sites.
3. **Drop-mode selector** — `body[data-drop-mode-active]` only (was
   `... *`; 36ms recalc per drag edge killed). Verified: inheritance
   reaches contenteditable, no competing `user-select` anywhere.
4. **Zero `:has()` in globals.css** — (a) chevrons via `.heading-wrapper-l{N}`
   (level change RECREATES the NodeView — update() returns false on level
   diff, so construction-time stamp is always right); (b) tex-block
   `has-par-title` stamped in TexBlockNodeView JSX keyed on the exact
   .par-title-text render condition; (c) popped-card ring via
   `data-contains-active-card` stamped upward by useAnchorHighlightReconciler;
   (d) command-run rhythm via `p-cmd-only` NODE DECORATION painted by the
   latex-command plugin (same DOM semantics as the old selector — exactly one
   element child and it's the .latex-cmd span). Tests:
   `latex-command-cmd-only.test.ts` + re-keyed `latex-cmd-paragraph-rhythm.test.ts`
   (has an anti-:has-resurrection tooth, comment-stripped).
5. **Mint-cliff dead** — `maketitleMarker` added to BOTH
   `UUID_BEARING_NODE_TYPES` AND assignUuids' assign ladder (two lists!);
   hit-test `resolveAnchorableBlock(editor, pos, {mint:false})` per-move with
   `unminted@<pos>` sentinel; `mintPlacementUuid` resolves it ONCE at commit
   in `commitDropSession`. Deviation (documented): ensureAnchorUuid's
   uuid-collection walk kept (once-per-gesture now; bus map doesn't cover all
   uuid-bearing kinds).
6. **Outline dragover** — equality-bailed functional setDropTarget +
   memo(EditablePod) with stable pod-taking callbacks. preventDefault stays
   synchronous (native DnD contract — do NOT RAF-defer it).
7. **Serializer per-block** — `serializeTopLevelBlock` + `assembleLatex` +
   exported `collectPreambleTitleFields`; `serializeToLatex` re-expressed
   through them (ONE path). The bib-family cross-block fold replicates the
   collector exactly: first concrete wins, CONFLICT ABSORBS TO NATBIB
   (absorbing state — per-block-then-across composes; pinned in
   `latex-serializer-incremental.test.ts`).

### Wave 1 delivered
- **`src/lib/doc-products/`**: `pipeline.ts` (createDocProducts /
  getDocProducts(editor) — WeakMap registry, getBus precedent; ONE
  `editor.on('update')` = dirty flag + timer; Tier A 300ms shared docJson,
  identity-preserved for unchanged blocks; Tier B via requestLowPriority =
  per-block-cached .tex assembly + computeWordCounts(docJson); preamble
  lifecycle + TEX_DELIMITERS re-read + `setExternalSourceFeed` code-view
  mutual exclusion absorbed from useLatexSource; `ensureFresh()`;
  `assembleSourceWith(opts)` for the code bridge), `block-caches.ts`
  (PM-node-identity WeakMaps — the miss IS the diff), `use-doc-products.ts`
  (`useDocProductsHost`, `useDocJson`, `useWordCountsProduct`,
  `docProductsEnabled`), `probe.ts` (`__docProductsStats`).
- **Flag `virgil:doc-products` defaults ON**; `"off"` = kill-switch. Both
  hook paths statically mounted in EditorPane; null-editor disables the
  inactive one. Legacy = useLatexSource / useWordCount / outline tick +
  outlineContent memo / editor-ops handleUpdate→latestDoc / CutterPanel
  duplicate. **S6 (delete legacy) is post-soak — session task #14.**
- **Save hygiene (storage-fsa.ts — REAL APP ONLY, dev preview uses
  storage-dev!)**: `needsUuidWork` (read-only twin, equivalence
  property-pinned in `latex-serializer-needs-uuid-work.test.ts`) gates
  assignUuids with copy-on-write (shared docJson never mutated);
  byte-equality gate (ledger `.tex` hash + cached sidecar hash → skip
  snapshot/writes/stamp); dead `existingSidecar` read deleted; delimiter
  cache keyed on ledger hash; snapshots ≥60s apart for plain autosaves,
  ALWAYS for `opts.delimiters` commits.
- **useDocument**: debounced timer + flushNow prefer
  `getDocProducts(editor)?.ensureFresh().docJson ?? editor.getJSON()`;
  flushAnchorCommit = O(1) identity compare when pipeline present (works
  BECAUSE saves store the shared identity in lastSavedRef). Terminal paths
  (unmount/pagehide) deliberately keep getJSON.
- **Code path**: bridge flush + CodeEditor one-shots via
  `assembleSourceWith` (caller's OWN delimiters — never the pipeline's
  disk-derived ones; unsaved preamble edits must not be resurrected over).
- **Lint worker**: `src/lib/workers/latex-lint-core.ts` (the pure pass,
  moved verbatim) + `latex-lint.worker.ts` + `lint-client.ts` (lazy
  singleton, `new Worker(new URL(...))` — Turbopack-compatible per
  node_modules/next/dist/docs .../08-turbopack.md §Magic Comments;
  main-thread fallback for SSR/vitest/broken worker). useLatexLint now
  passes `readonly string[]` bibKeys (structured-clone-friendly).
- **S4 SUPERSEDED** — fix-140 (landed independently) already gates
  readSource per-transaction via trackSourceRange + position hint. Do NOT
  re-plumb float-sync; the remaining stringify compare is float-subtree-
  bounded and touch-gated.

### Live-verified numbers (dev build, hidden pane — see caveats §5)
- doc_perfhuge (2,883 blocks), 15-keystroke burst, flag default:
  **1 Tier A (0.2ms) + 1 Tier B (18.1ms at idle) + exactly 1 blockLatex
  miss**; `__virgilBusStats` emit delta 0; the previous **3s lint
  main-thread task is GONE** (worker).
- Census after print gate: doc_perftest 181 (was 307); doc_perfhuge 521
  (was 881).
- Pre-program baselines for comparison live in the diagnosis memo §1–§3.

---

## 2. What remains (execute in this order)

1. **Wave-2 residuals** (see the list under the state table): C7 caret
   consolidation + useEditorViewportCache deletion, C5 approxTopForPos,
   C6, C8 — each small enough to fold into the Wave-3 worktree or land as
   its own short wave-2b branch.
2. **Wave 3 — P3 card presence tiers** (plan §Wave 3; near-zone store is
   written by the Wave-2 geometry service — `observed`/`cache` in
   src/lib/editor-geometry/service.ts is exactly that set).
3. **Wave 4 — P5 containment + P6 doctrine consolidation** (plan §Wave 4).
4. **S6 post-soak** (task #14): delete the legacy doc-products path +
   allowlist entries + AGENTS.md bullets + retire isTier1CDisabled; ONLY
   after Gabriel confirms the soak. Also consider per-block word counts
   inside the pipeline (Tier B 18ms → smaller).
5. **Baseline/visible-window trace** (owed): rebuild `out/`
   (`export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npm run build`,
   ~1 min), serve via launch entry `virgil-static` (port 3001), open in a
   VISIBLE real Chrome (claude-in-chrome MCP drives Gabriel's real browser)
   on doc_perfhuge; 10s typing + drag + Enter burst; LoAF + longtask
   observers; append to `docs/perf/style-invalidation-findings.md`.
   cv-auto (Wave 4 Stage B) is DECISION-GATED on this trace.

---

## 3. Operational mechanics (the workflow that works)

### Per-wave loop
1. `EnterWorktree` name `perf-wave-N` — **branches from origin/main, NOT
   local main** → immediately `git -C <wt> merge main --no-edit`.
2. Implement stage by stage; **one commit per stage**; run
   `npx tsc --noEmit` + targeted `npx vitest run <paths>` per stage, full
   `npx vitest run` per wave. Node: prefix every command with
   `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` (arm64 node22;
   memory: Rosetta node crashes Turbopack).
3. **Git hygiene: NEVER `git add -A` OR `git add -u`** — the wave-1 slip:
   `add -u` swept a Next-auto-written tsconfig.json include
   (`.next-preview-*` types paths appear whenever a worktree dev server
   runs). Stage explicit paths only. Check `git status` for tsconfig.json
   noise before committing.
4. Live verify (see below), then: check `git -C <main> log --oneline -1`
   — **main WILL have moved** (the task pipeline merges continuously;
   during waves 0–1 it moved three times: fix-233, fix-140, fix-313,
   fix-257…). Merge main INTO the wave branch, re-run full suite, THEN
   `git -C /Users/gabriel/Programming/virgil merge --no-ff <branch> -m "Merge perf-wave-N: …"`.
5. Cleanup: remove any launch.json entry + virgil-data symlink you added,
   `ExitWorktree action:"remove" discard_changes:true` (safe once
   `git branch --contains` shows main has the tip).
6. Update `~/.claude/projects/-Users-gabriel-Programming-virgil/memory/typing_latency_fix_status.md`
   + MEMORY.md index line at each wave merge.

### Live dev-preview verification (worktree)
- The worktree resolves node_modules by walking UP to the main repo — do
  NOT symlink node_modules (a stray `ln -s` nests wrongly). DO symlink the
  data: `ln -s ../../../virgil-data <wt>/virgil-data` (remove before
  ExitWorktree).
- Add a launch.json entry (`.claude/launch.json`, gitignored) cloning the
  `virgil-dev` shape with `cd <worktree> && … NEXT_DIST_DIR=.next-preview-wN`
  and a fresh port (3500+); `preview_start {name}`; REMOVE the entry at
  cleanup.
- Browser-pane quirks (all earned the hard way):
  - `resize_window` to 1440x900 THEN reload; viewport starts 0x0 and
    pre-resize clicks are dead.
  - ref-based `computer` clicks are unreliable in some tabs — **drive
    row clicks via JS `el.click()`** (React onClick fires fine).
  - Force dev storage once per origin:
    `localStorage.setItem('virgil:force-dev-storage','1')`.
  - Doc rows: `[...document.querySelectorAll('li button')].find(b =>
    b.textContent.includes('Perf Huge')).click()`; doc-open on perfhuge
    takes 20–50s dev (wait loops).
  - Main editor handle: the `.ProseMirror` element whose className includes
    `doc-prose` has `.editor` directly on it (`host.editor`).
  - The pane is HIDDEN: RAF doesn't fire (shim with setTimeout if needed),
    rIC falls back, timers align to ~1s ticks, LoAF yields nothing —
    **measure synchronous costs + probe counters, not wall-clock frames**.
    Typing via CDP `computer {action:"key", repeat:N}` gives real keydowns;
    `type` action does NOT. Or dispatch PM transactions directly (bus/
    pipeline probes don't care).
- Probe protocol per typing burst: snapshot `__docProductsStats()` +
  `__virgilBusStats()` before; 15 inserts; wait ≥4s; assert deltas
  (tierA=1, tierB=1, latexMisses=1, emitDelta=0). Census:
  `__editorCensus()`. Others: `__keystrokeStats()`, `__scrollRepositionStats()`,
  Wave-2 adds `__geometryStats()` + `__mousemoveStats()`.

### Test gotchas
- Any module chain that reaches `@/lib/storage` needs
  `vi.mock("@/lib/storage", () => ({ readTex: vi.fn(() => Promise.resolve("")) }))`
  in tests (the barrel's FSA require fails under vitest). doc-products →
  storage, so anything newly importing doc-products may need it (bit
  code-pane-bridge-delimiters.test.ts in Wave 1).
- Guardrail tests are exact-set + staleness: touching a subscriber file
  means updating `PERMITTED_KEYSTROKE_SUBSCRIBERS` AND the AGENTS.md prose
  twin in the same commit.
- `controller-commit-flush.test.ts` mocks `../hit-test` — new hit-test
  exports must be added to that mock.
- Full suite ≈ 25s (`npx vitest run`), 5,300+ tests. tsc ≈ 40s.

### Concurrent-main etiquette
Gabriel's task pipeline (`/loop /work`) merges to main continuously and he
drives the same checkout live. Never write in the MAIN checkout except the
final merge commit; preserve unknown worktrees/branches
(virgil-dream-2026-08-03, 317-layout-gesture-bus, …); main's dirty files
(tsconfig.json, library-data, MEMO_*.md) are none of ours.

---

## 4. Wave-2-specific implementation notes (beyond the plan text)

- The plan §Wave 2 has the full design. Extra context from the research
  (geometry agent's findings, condensed in the plan's digest): the
  breadcrumb "stop scanning" comment lies (Fragment.forEach can't break);
  grab-handle's viewport cull happens AFTER the rect read; the
  `disableTier1B` flag in perf-flags.ts gates only the update path and
  defaults OFF; useEditorViewportCache is instantiated 4× (LiftHost:289,
  TextObjectGrabHandle:519, PendingChangePill:352, SelectionActionsMenu:205)
  and its scrollTop/scrollBottom are the CONTAINER rect, not scroll offset.
- Bus extension needed: `BlockEntry.parTitled` (structure-index.ts
  buildInitial + step-inspector attr-diff mirroring the heading pattern) +
  a unit test for set/unset.
- `readPendingDiff` is NOT readable from `editor.on('transaction')`
  handlers (observer clears it first) — positional gates use
  `src/lib/float-source-range.ts` (`trackSourceRange`).
- Line numbers in the plan/diagnosis drift as main moves — re-grep, don't
  trust `:NNNN` blindly.
- P4 pointer invariants: import `isPrimaryDragStart`/`isMissedRelease`
  from `src/lib/pane-resize/pointer-invariants.ts` (pane-drag guardrail
  requires this for bespoke gestures).

## 5. Measurement caveats (carry into every report)

Dev build + hidden pane numbers are for SCALING and DISCIPLINE (counters,
deltas), not absolute latency. React dev mode ≈ up to 2× on React-side
work; hidden-tab timer alignment batches debounces into ~1s wakeups; the
rendering pipeline (style/layout/paint, LoAF, RO/IO callbacks) is mostly
idle while hidden — the RAF/RO-driven costs Wave 2 targets DON'T SHOW
while hidden (they're worse live). The PWA-vs-code question is settled:
it's code (diagnosis memo §7).

## 6. Standing assets

- **Perf corpus**: `virgil-data/doc_perftest` (1,029 blocks) +
  `doc_perfhuge` (2,883), registered in `virgil-data/index.json`; contain
  junk chars from typing bursts (harmless). Generator:
  session-scratchpad `gen_perfdoc.py` (regenerate-able from the memo §0
  description if lost).
- `doc_devtest` was restored from `samples/annotation-history` (clean).
- A prod `out/` build exists but is STALE (pre-wave main) — rebuild before
  the visible-window trace.
- Session task list (if the task store survives): #11 Wave 2, #12 Wave 3,
  #13 Wave 4, #14 S6 post-soak, #1 baseline trace. If it doesn't survive,
  this memo is the task list.
