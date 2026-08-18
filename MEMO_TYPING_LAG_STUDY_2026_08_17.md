# Typing-lag deep study — investigation + recommendation

**Date:** 2026-08-17 · **Method:** six-lens multi-agent investigation (each lens
adversarially verified against HEAD), plus fresh empirical measurement in a
production build (prod server build of HEAD, real Chrome, doc_perfhuge 3,055
blocks). **Status:** investigation + recommendation only — no code changed.

## Verdict up front

**The architecture is the right one; the felt lag is not "the last few drags"
of the old problem, it is a different problem the perf program has not yet
attacked.** Three stacked causes, each independently sufficient to be felt,
all three verified.

**One caveat governs all the weights (the completeness critic's top gap):
Gabriel's actual lagging document was never characterized, and every real
paper present in virgil-data is ≤9,400 words (~700 blocks) — ten times
smaller than the perf corpus every scaling number is priced against, and none
contains a single expex gloss.** If the lagging paper is ~700 blocks, the
doc-size-scaled costs shrink 4–14× and the diagnosis tilts further toward
per-block complexity (math/atoms/cards), the pause ladder, session/heap, and
environment factors; if it is 3k+ blocks, everything below holds as priced.
Gabriel offered the document — accepting that offer is the cheapest decisive
measurement available and should happen first.

1. **The pause-ladder collision (the felt "typing lag", dominant).** The
   keystroke path itself is clean — burst presses cost 1.4–7ms in prod at 3k
   blocks. But every ≥300ms pause during typing arms a ladder of
   independently-clocked O(doc) derived work (doc-products Tier A+B, autosave
   triple-serialize, Outline recount, EditorPane double re-render), measured
   today at **100–410ms of main-thread tasks fired after essentially every
   press-pause**. The clocks (150/300/300–500/1500/~2000ms) all sit inside the
   human think-pause band, so a normal typist collides with the ladder many
   times per minute; presses landing in it queue 60–300ms and the next
   dispatch costs 10–30ms instead of 1.4–7ms. This scales with document
   LENGTH. Nothing in the tree is typing-aware: Tier B's
   `requestIdleCallback({timeout: 200})` forces it to land mid-burst by
   construction, and resuming typing cancels nothing.
2. **Complex-content per-keystroke costs the perf corpus is blind to.** The
   perf corpus is plain prose — zero math, zero glosses, uniform 12-word
   examples, no cards (measured). Gabriel's papers are the opposite shape, and
   three real O(doc)-per-keystroke paths exist only there: typing inside an
   expex example runs TWO full-doc `descendants` walks per keystroke
   (expex.ts appendTransaction); typing a `\command` character-by-character
   rebuilds the FULL document's latex-command decorations per character
   (latex-command.ts `touched` path — task 337 fixed only the untouched-path
   probe); KaTeX re-renders with no equality bail on every structural pass
   over math-dense paragraphs (math.ts update()). Plus the stock TipTap
   Placeholder plugin walks every top-level block on EVERY transaction
   (unguarded — decoration props are invisible to all three guardrail greps).
   This scales with document COMPLEXITY.
3. **The deployed configuration is the unmitigated one.** `virgil:card-tiers`
   and `virgil:perf-contain` still default OFF. Measured today: opening ONE
   panel (Footnotes) on the perf doc with tiers OFF mounts **360 live TipTap
   editors in a single 4.4s main-thread freeze**; with tiers ON the same view
   is census=1. Multiplied by multi-doc keep-alive (3 warm panes + up to 4
   Reader panes), the resident heap reaches the hundreds-of-MB class, which is
   the plausible mechanism behind "interacts with something else on my system":
   V8 major-GC pauses + macOS memory compression of hidden-pane pages produce
   intermittent stalls no app probe can see. **Also: v0.1.91 was cut today
   (2026-08-17 00:09) and v0.1.90 contains NONE of fixes 335/336/337 — a
   long-lived PWA session (or the known stale-HTTP-cache failure mode) may be
   typing on a build missing the two biggest post-trace typing fixes.**

## What was measured today (prod build of HEAD, real Chrome, hidden tab)

Protocol: `NEXT_PUBLIC_DEV_STORAGE=true NEXT_DIST_DIR=.next-prod-trace next
build` + `next start -p 3401`; doc_perfhuge; `view.dispatch` wrapped for
per-dispatch timing; longtask observer; paced presses = one insert per
~650ms–3s (each press's debounces fire between presses), burst = 30
back-to-back inserts. Hidden-tab caveats: no RAF/paint component (real
end-to-end is worse), machine under concurrent agent load (absolute numbers
noisy; the ratios and task inventories are the signal).

| Condition | census | burst p50/p90/max (ms) | paced p50/p90/max (ms) | between-press tasks |
|---|---|---|---|---|
| tiers OFF, Footnotes panel open | 361 | 7.3 / 13 / 16.8 | 13.7 / 24.4 / 32.4 | 31 tasks, 150–380ms |
| tiers ON + contain ON, same view | **1** | **2.0 / 2.6 / 9.6** | 31.2 / 59.7 / 99 † | ~30 tasks, 200–410ms |
| tiers OFF, all panels closed | 1 | (noisy: 12.5/53/93 under load) | 11.6 / 15.3 / 17.3 | 22 tasks, **~100–118ms** |

† The ON-paced elevation vs OFF is confounded (the OFF paced run was partially
timer-throttled; machine under agent load) — treat the ON/OFF paced comparison
as unresolved, not as "tiers ON makes typing worse". The robust facts:

- **Every press-pause fires ~100–115ms of tasks even with ZERO cards and no
  panels** (the doc-scale ladder floor at 3k blocks); a panel with 360 cards
  adds another ~50–250ms.
- Tier B ran after essentially every press (23 runs / 20 presses) at
  **62–77ms each** — alone a third of the ladder.
- Paced presses cost 3–10× burst presses inside `view.dispatch` in every
  condition.
- Doc-open ~6.2s hidden with no panels; opening the Footnotes panel with
  tiers OFF = one **4,409ms** task (mount storm), with tiers ON no comparable
  task.
- First press after a long fully-quiet gap: 3.2ms — the press is only
  expensive when it lands in/near the previous press's ladder.

This reconciles the Unit-2 paradox: that trace typed CONTINUOUSLY for 21s
(no ≥300ms pauses → no ladder → zero ≥16ms presses) and concluded the typing
path clean; its own settle-tail observation (p50 80ms / max 304ms for presses
inside the cluster) IS the phenomenon, and real typing is made of pauses.

## The pause-ladder, itemized (verified at HEAD)

Per dirty pause at 3k blocks (each row's cost fires once per quiescence
window unless noted):

| # | work | clock | cost class | notes |
|---|---|---|---|---|
| 1 | code-pane bridge reverse flush | +150ms | full assembly + whole-doc CM replace | only with code view open; fires at ordinary inter-word gaps |
| 2 | doc-products Tier A | +300ms | O(changed) post-337, ~0.4–1.1ms | publishes new docJson identity → re-renders |
| 3 | doc-products Tier B | +300–500ms **forced** | **62–77ms**: O(doc-bytes) assembly tail (join ~1MB + collapseBlankRuns + projectDetectableBody + 14-regex battery + ensurePreambleRequirements) + full-doc word count | `requestIdleCallback({timeout:200})` (schedule-low-priority.ts:17); pipeline onUpdate resets only the Tier A timer, **never cancels the pending idle callback** (pipeline.ts:218–238) → lands mid-burst by construction |
| 4 | Outline per-block recount | per Tier A publish | O(doc) `buildPerBlockCounts`, ~the legacy 47.7ms row | OutlinePanel.tsx:1591 — no per-block memo even though the pipeline's identity-stable per-block JSON is the exact WeakMap key it needs |
| 5 | EditorPane whole-component re-render | per Tier A AND Tier B publish | 10–30ms class ×2 | useDocProductsHost is one useSyncExternalStore at pane top level (use-doc-products.ts:100–115) |
| 6 | autosave | +1500ms | **the biggest single task**: `ensureFresh()` re-runs BOTH tiers redundantly, then `writeDocBundle` runs a COLD un-memoized `serializeToLatex` + `needsUuidWork` full walk + `extractSidecarData` + content hash | useDocument.ts:347–384; storage-fsa.ts:662–716. Net: the ~1MB .tex is assembled up to **three times per pause** and the doc word-counted twice |
| 7 | lint | Tier B + 1500ms | worker; main-thread share is the ~1MB structured clone + setErrors render | healthy |

Wrap/Enter keystrokes additionally fire the editor RO → geometry cascade +
band-limited omni measure (bounded post-336/327/328, but O(in-band cards)
coordsAtPos + O(all cards) map rebuild per wrap — scales with card count).

**Post-fix floor estimate (verified as reasoned):** after dedupe + a
quiescence gate, the ladder's largest single chunk is one shared assembly
(~15–25ms prod at 3k) + save walks/hashes (~10–20ms) — under a 50ms bar,
mostly under 16ms; a serialize worker pushes it near zero if a real-paper
re-trace still shows >50ms tasks.

## Architecture verdict (the ground-up question)

If Virgil were designed today for sub-16ms typing in 100k-word atom-heavy
papers, the consensus architecture is: **one persistent document model; a
viewport-WINDOWED view** (CodeMirror 6's model: render visible + margin,
height-estimate the rest, measure async — Google Docs went to canvas for the
same reason); **all O(doc) derivations incremental and quiescence-scheduled,
heavy ones off-thread**. Virgil already IS most of this architecture on the
model side (DocStructureBus O(edit) diffs, per-block serializer caches,
geometry service with near-zone culling + `approxTopForPos`, card tiers) —
what it lacks is (a) any typing-aware SCHEDULER for the derivation layer, and
(b) windowing of the main editor's DOM.

Floors of the current architecture (verified):
- PM `updateChildren` scans all top-level ViewDescs per transaction: ~1ms @3k,
  ~3.5ms @10k (dev-scale) — real, small, irreducible in-app (prosemirror-view
  1.41.7, flat top-level doc).
- PM `state.apply` across all plugins: 0.1–0.6ms — a non-problem.
- Whole-document DOM: 52k nodes @2,883 plain blocks (denser with KaTeX/expex);
  NOT primarily a per-keystroke cost today (clean-typing trace proves it) but
  the constant behind doc-open (worst task 5.44s), per-pane memory, and every
  whole-tree invalidation; only windowing removes it.
- Multi-doc keep-alive multiplies that DOM/heap ×(3+4 panes) for the session.

Paths evaluated (ranked):
- **A. Stay-the-course + scheduler/dedupe + complex-content carve-outs +
  flags ON** — reaches "typing feels clean" at current scale; structurally
  cannot fix doc-open/memory at 10k. **Do now.**
- **C. PM-level windowing, incrementally** — C1: occlusion decorations
  (`content-visibility:hidden` / display:none + fixed heights from the
  geometry service's metrics cache) on off-viewport top-level blocks; prior
  art in PM community ("snappy fast"); C2: stub NodeViews (cheap fixed-height
  placeholder, promote on approach — the card near-zone promote/demote pattern
  generalized to blocks). C2 is the only thing that fixes doc-open, per-pane
  memory, and the 10k ceiling. Virgil is unusually well-positioned (geometry
  service, approxTopForPos, near-zone machinery already exist). **Gate on
  Phase-2 traces.**
- **B. `content-visibility:auto`** — the Unit-2 rejection was measured on
  plain prose with tiers OFF and does not transfer to atom-heavy/10k docs;
  but its honest ceiling is layout/paint only (NodeView construction, KaTeX,
  DOM build, memory are CSS-independent). Re-gate on the atom-heavy trace;
  C1 achieves the same win deterministically.
- **D. Doc-model windowing (mount only a slice)** — dominated: breaks every
  position-based system at once (appliedChange ranges, float-source-range,
  block addresses, drop placements, DocStructureBus absolute positions) for
  strictly less benefit than C2; the only cost it uniquely removes
  (state.apply scaling) is already 0.1–0.6ms.
- **E. Editor-core swap (Lexical / CM6-style custom / canvas)** — rejected:
  Lexical demonstrably does not solve large docs (facebook/lexical#7422);
  canvas/custom means rebuilding selection/IME/a11y/round-trip + ~150 suites
  of editor-coupled behavior for wins C1+C2 deliver incrementally.

## Session degradation (the "my system" interaction)

Eviction hygiene is genuinely good (editors/engines/pipelines/watchers/object
URLs all torn down correctly on LRU evict — traced). The degradation story is
RESIDENT POPULATION, not leaks: 3+4 warm panes × full DOM × (tiers OFF →
per-pane card editor population) → heap in the hundreds of MB; V8 GC pauses
grow with heap; macOS compresses hidden-pane pages under system pressure and
warm-switches/major-GCs decompress them in storms. Two true unbounded growths
found: the module-level decoded-figure Blob `rasterCache`
(useResolvedFigureUrl.ts:59 — never evicted on doc close) and the SwiftLaTeX
wasm engine's linear memory (never shrinks after peak compile; module
singleton). Also: DiskWatcher + SidecarWatcher poll per WARM doc (~19–45 FSA
stat calls/s at capacity), gated on `document.hidden` but not pane visibility.

## Recommendation

**Phase 0 — today, zero engineering (Gabriel; one message answers it all):**
1. Hard-reload the PWA (DevTools → Clear site data if needed) and confirm
   v0.1.91 is actually running — v0.1.90 lacks 335/336/337, the release is
   hours old, and the stale-HTTP-cache failure mode is a documented recurrer.
   If the lag was reported from a pre-reload session, re-test after this step
   before anything else.
2. **Share the laggy document** (or just its stats: `__editorCensus()`,
   block/word/math/example/card counts from the console) — it becomes the
   trace corpus for everything below.
3. **The 5-question symptom interview** — each answer implicates a different
   verified mechanism: (a) is the lag worse with the caret inside a numbered
   example? [expex two-walk] (b) worse while typing `\commands`
   character-by-character? [latex-command rebuild] (c) is it a stall on the
   first keystrokes after a ~1s pause, smooth mid-burst? [pause ladder]
   (d) does it worsen over hours and improve in a fresh window? [heap/GC]
   (e) how many Virgil WINDOWS are open? [keep-alive population ×windows]
4. **Environment A/B, two minutes each** (no lens examined these; any
   positive reframes the diagnosis away from app code): retry in a fresh
   Chrome profile/guest window with zero extensions (the `data-gramm` opt-out
   silences Grammarly by name, not the category); note zoom level (Cmd+0
   A/B); toggle `spellcheck=false` on the editor root in DevTools and retype
   — native spellcheck on IPA/gloss/non-English tokens maximizes squiggle
   work and the in-code "no cost" claim was measured on English prose; note
   whether lag correlates with accents/dead-key/IME input.
5. Flip the two dark flags and soak:
   `localStorage.setItem("virgil:card-tiers","on")`,
   `localStorage.setItem("virgil:perf-contain","on")`, reload. **Honest
   framing: this fixes doc-open, panel-open mount storms (4.4s → ~0
   measured), warm-switch, and per-pane memory — NOT steady-state keystroke
   latency** (the clean Unit-2 typing ran with 521 editors mounted; and
   perf-contain deliberately excludes the editor pod). If typing feels the
   same after the flip, that is expected; the ladder work in Phase 1 is the
   typing fix.
6. When it feels bad, a 10-second sample in the PWA console:
   `performance.memory.usedJSHeapSize/1048576` + `__editorCensus()`; ideally
   one DevTools Performance recording (with the Memory track) during a felt
   episode — that single artifact discriminates nearly every hypothesis
   above.

**Phase 1 — the felt-lag fix (the next engineering wave, ~days, all inside
the current architecture). IMPLEMENTATION PLAN: `MEMO_PHASE1_QUIET_TYPING_PLAN.md`
(repo root — 14 stages, arbitrated from a 6-agent design workflow + red team +
micro-bench; supersedes the sketch below in detail):**
0. **First hour: micro-measure the four estimate-grade costs** so the queue
   below is ranked on numbers, not estimates (critic gap 6): the expex
   two-walk ("est. 1–3ms"), the latex-command touched-path rebuild ("est.
   several ms"), the Placeholder walk ("est. 0.1–0.5ms"), and how often
   math's bail-less update() fires in realistic editing — a jsdom harness
   over the real plugins at 3k blocks with realistic density. (Today's
   measurements already arbitrate the critic's other fork: the pause ladder
   IS still 100–410ms per press-pause at HEAD, measured — the 336/337 fixes
   did not remove it.)
1. **One typing-quiescence scheduler** (`scheduleWhenQuiet(siteId, fn,
   {maxStalenessMs})` — the keystroke-latch precedent already exists in
   input-modality): defer ALL typing-deferrable derived work while a keydown
   occurred in the last ~150ms, re-check at fire time, settle once per
   quiescence window in fixed order (products → panels → save). Convert: Tier
   A/B (and CANCEL the pending idle callback on resume — today it is never
   cancelled; drop the forced 200ms deadline for typing-deferrable products),
   autosave, code-bridge reverse flush (or raise 150→500ms), lint feed.
2. **Dedupe the ladder:** one assembly per quiet window shared by Tier B and
   the save (`assembleSourceWith` already parameterizes it — pass the
   assembled text/parts into `writeDocBundle`); skip `ensureFresh`'s
   redundant tier re-runs when generation is current; per-block WeakMap word
   counts (the pipeline's identity-stable per-block JSON is the key) making
   Tier B's count AND OutlinePanel's `buildPerBlockCounts` O(changed).
3. **Split `useDocProductsHost`** into per-product subscriptions at consumer
   leaves so a publish re-renders only consumers whose product changed —
   kills the ×2 whole-EditorPane re-render per pause.
4. **Complex-content carve-outs** (each small, each O(doc)→O(edit)):
   expex appendTransaction walks driven from the DocStructureBus examples
   index + scoped re-letter; latex-command splice-not-rebuild on the touched
   path; KaTeX + citation update() equality bails (compare BEFORE the
   `Object.assign`); replace stock Placeholder with a caret-scoped plugin;
   extend the keystroke guardrail census to plugin decoration props (the
   blind spot that let Placeholder through).
5. **Hygiene:** bound/evict `rasterCache`; idle-reset the wasm engine after
   N minutes; gate the per-doc watchers on pane visibility as well as
   document.hidden.

**Phase 2 — measure what the corpus cannot see (gates Phase 3):**
Generate an atom-heavy corpus (~3k blocks, real math/gloss/citation density,
~300 cards — the complex-content lens has the density numbers from
doc_1caf092a) + a 10k-block corpus; re-run the Unit-2 visible-window protocol
with tiers ON and Phase 1 landed, on a quiet machine; add per-pane
`measureUserAgentSpecificMemory`. Accept Gabriel's offer of the specific
laggy document — one visible-window trace on HIS paper at HIS defaults is the
final word on whether anything felt remains. Targets: p95 press <16ms
including press-after-pause; no ladder task >50ms; doc-open <8s at 10k;
per-pane heap measured.
**Phase 3 — only if Phase-2 traces demand it:** C1 occlusion decorations,
then C2 stub NodeViews (windowed main editor) for doc-open/memory/10k
headroom. Explicitly rejected: editor-core swap, doc-model splitting, canvas.

## Caveats, honestly

Today's numbers are hidden-tab (no paint/RAF component — real end-to-end is
worse than dispatch-only) and the machine was under heavy concurrent agent
load (inflates absolutes; the ratios, task inventories, and code-level
mechanisms are load-independent and all verified at HEAD). The tiers-ON paced
regression in one run is unresolved (confounded) — worth one clean re-run
during Phase 2. The Unit-2 trace + today's runs are all on plain-prose
corpora; every complex-content cost above is code-verified but not yet
trace-measured, which is exactly what the Phase-2 corpus exists to close.
