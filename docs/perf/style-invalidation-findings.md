# Visible-window baseline trace — prod build, doc_perfhuge (2026-08-09)

The perf program's owed visible-window measurement (perf-loop Unit 2), and
**the decision gate for Wave-4 Stage B (`content-visibility: auto`)**.
Run AFTER Waves 0+1+2+2b (local main `bd4769ad`).

## Setup (and honest deviations)

- **Build:** production `next build` (React prod, minified) with
  `NEXT_PUBLIC_DEV_STORAGE=true` + `NEXT_DIST_DIR=.next-prod-trace`, served by
  `next start -p 3001`. Deviation from the letter of the plan ("static `out/`
  + `serve`"): dev storage flips the config OFF `output: "export"`, so a
  static export structurally cannot reach `virgil-data` (its `/api/dev/*`
  routes don't exist in an export, and the plain export compiles the dev
  backend out — `storage-mode.ts` gates on a build-time env). A prod *server*
  build is render-identical client-side and gives the API natively.
- **Window:** Gabriel's real Chrome (claude-in-chrome), visible foreground
  tab, ~1297×924. RAF/IO/RO all live — none of the hidden-pane caveats.
- **Doc:** doc_perfhuge — 3,045 `[data-uuid]` blocks in DOM,
  `__editorCensus().total` = **521** (the post-print-gate number).
- **Input:** real per-char keydowns via the extension (109 keydowns total:
  ~99 typing in 10 bursts ≈1.1s apart, 10 Enter). Bursts type *faster* than
  8cps within each burst — a harder test than the spec's steady 8cps.
- **Observers:** `long-animation-frame`, `longtask`, Event Timing
  (`type:"event"`, threshold 16ms) — injected; the app's `__keystrokeStats`
  is compiled out in prod.
- **Measurement pitfall recorded for the next tracer:** Event Timing entries
  are delivered to the observer SECONDS after the events. A window summary
  read immediately at burst-end reports a false zero. Collect at the END of
  the whole session and slice by `startTime`; dedupe keydown/keypress pairs
  by `startTime` (unique presses).

## Results

### Doc-open (click → settled)
13 longtasks, **8.06s total, worst 5.44s**.
Pre-program baseline (diagnosis memo): 26.2s total, 15.2s worst → **3.2×
better**, with 881→521 editors from the Wave-0 print gate alone. Wave-3's
exit target (total <8s, no single >2s): total is AT the bar; the worst
single task is still **2.7× over** — the remaining mass is the card-editor
mount storm, i.e. exactly what Wave 3 (presence tiers) exists to remove.

### Typing — the headline
- **First ~21s of continuous typing (≈88 presses): ZERO presses ≥16ms, zero
  LoAF, zero longtasks.** End-to-end keydown→paint sits under Event Timing's
  16ms floor. The diagnosis-era per-keystroke cliff (8–10ms p50, max 94ms,
  dev/hidden at 2,883 blocks — dominated by the `Selection.collapse` forced
  recalc) is **gone** in the prod visible window.
- **The residual is the settle-tail collision:** at +21.4s a cluster of
  60–290ms tasks began (the debounced products: Tier A/B doc-products,
  autosave serialize + needsUuidWork, panel/omni derivations — ~11s of
  intermittent tasks after sustained typing at 2,883 blocks), and the 11
  presses that landed inside it measured **p50 80ms / max 304ms**. This is
  the diagnosis's "pause cluster", alive in prod: no longer ON the keystroke
  path, but big enough that typing *through* it stalls visibly.
- **Enter burst (10 block splits mid-doc): every split 16–24ms end-to-end**
  — structural keystrokes are healthy; their settle tail (~720ms across
  three tasks) again lands off-path ~11s later.

### Drag (one grab-handle lift → move → commit)
Lift edge: two ~168ms tasks. **Per-move: no longtask during the ~2s
continuous drag** (the per-move hit-test/overlay path stays under 50ms
throughout). Commit: one 227ms LoAF, **script-dominated** (179ms in the app
chunk — the move transaction + re-render), not style.

### LoAF profile overall
8 LoAF entries in the whole session (open/settle/drag-commit), all
script-dominated; none during typing. `styleAndLayoutDuration` did not
surface as a meaningful component in any of them.

## Decision: Wave-4 Stage B (`content-visibility: auto`)

**NOT justified by this trace — skip Stage B** (the gate demanded a ≥2ms
p50/keystroke style-recalc win and zero artifacts). Clean-typing p50 is
already below the 16ms measurement floor with zero LoAFs — there is no
per-keystroke style/recalc mass for cv-auto to win against, and cv-auto
does nothing for the two costs that remain (script-side settle tail;
card-editor mount storm at open, which Wave 3 addresses as DOM/editor
count, not style). Stage A (`contain: layout style`) remains cheap
insurance and unaffected by this decision. Revisit only if Wave 3's
re-trace shifts cost back toward style/layout.

## What the next wave should chase (ranked by this trace)

1. **Doc-open worst task 5.44s** → Wave 3 card presence tiers (census 521 →
   ≤10 + near-zone).
2. **The settle-tail cluster (60–290ms tasks; typing-through p50 80ms)** →
   post-soak S6 (delete legacy duplicate derivations), per-block word counts
   inside the pipeline, and chunking/deferring the autosave serialize at
   this scale — the tail should never host a >100ms task.
3. Drag commit 227ms script → worth a look after Wave 3 (same re-render
   mass shrinks with fewer live editors).
