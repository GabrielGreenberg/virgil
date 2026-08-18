# Phase 1 implementation plan — "typing owns the main thread"

**Date:** 2026-08-17 · **Status:** ready to execute, pending Gabriel's answers to §6.
**What this implements:** Phase 1 of `MEMO_TYPING_LAG_STUDY_2026_08_17.md` — the
felt-lag fix: a typing-quiescence scheduler, ladder dedupe (one assembly per
quiet window), per-block word counts, the doc-products host split, the four
complex-content carve-outs (ranked by measurement, below), hygiene, and a new
decoration-prop CI census.
**How this plan was built:** a 6-agent design workflow (four design lenses +
one micro-benchmark agent + an adversarial red team) over HEAD `0e7f4e60`,
assembled and arbitrated by the orchestrating session. The four full design
sections are Appendices A–D; the red team's findings are Appendix E.
**Precedence rule: where an appendix conflicts with §1–§7 below, §1–§7 wins**
— every red-team blocker/major is resolved here, and the appendices are kept
verbatim as the implementation detail they were written to be.

Execution mechanics are the standing wave loop: **MEMO_PERF_PROGRAM_HANDOFF.md
§3** (worktree protocol, preview quirks, test gotchas, concurrent-main
etiquette — main is a LIVE SHARED checkout; the `raw-declare-345` worktree
belongs to the task pipeline, never touch it) and **MEMO_PERF_LOOP_2026_08_09.md**
(the iteration format). Worktree name: `perf-phase1`. One commit per stage;
`npx tsc --noEmit` + targeted vitest per stage; full suite before the final
`--no-ff` merge; never `git add -A`/`-u`; allowlists + AGENTS.md prose move in
the SAME commit as their code.

---

## 1. Goal and acceptance criteria

The study's mechanism: every ≥300ms typing pause fires 100–410ms of O(doc)
derived work whose clocks sit in the human think-pause band, and resumed
presses collide with it (paced dispatch 3–10× burst dispatch, measured, prod,
3k blocks). After this wave, at 3k blocks (prod server build, the study's
paced/burst protocol, fresh page per condition):

1. **Paced dispatch p50 within ~2× burst dispatch p50** (baseline: 3–10×).
2. **No single ladder task >50ms in the paced window**, with ONE stated
   exception: if the post-dedupe shared assembly alone still exceeds 50ms at
   doc_perfhuge scale, that is recorded as the **worker-escalation trigger**
   (move serialize+hash off-thread — a follow-on decision, not this wave),
   never silently passed. The scheduler's macrotask-chained flush (§3.1)
   guarantees no ladder task is ever LARGER than its largest single item.
3. **Tier B runs ≤1 per quiet window; `assemblies` delta ≤1 per pause**
   (today: up to 3 assemblies + 2 full word counts per pause).
4. **Burst leaves `__virgilBusStats` emit/materialize deltas 0** (existing
   law, must not regress), and `__quietSchedStats` shows products `ran` flat
   during bursts.
5. **Flag-off A/B reproduces the pre-wave ladder** (proves the kill-switches
   are real).
6. Every carve-out's defect leg fails on the pre-fix tree (measured by
   neutering — the repo's standard).

Hidden-tab caveats for the acceptance run (timers throttle after ~5min
backgrounded; RAF dead; Event Timing arrives late; note machine load) are
recorded in Appendix D §0.3 and carry into the report. The real-PWA feel
check remains **owed to Gabriel, never self-certified**.

## 2. The measured ranking (replaces every estimate)

The micro-bench agent drove the REAL plugins over a ~3k-block jsdom corpus
(scratch harness, deleted after; jsdom numbers rank RELATIVE costs):

| Cost | Measured | Consequence for this plan |
|---|---|---|
| latex-command `touched`-path full rebuild | **6.00ms median** @3,001 blocks / 594 decos (0.82ms @1,011) — and typing `\citep{x}` triggers it on essentially every character | **Top carve-out (P9).** |
| latex-command mapped (NO-rebuild) path | **1.4ms/keystroke** @3k (DecorationSet.map over 594 decos + changed-region scan) — a cost no section owned | New obligation folded into P9 (§4, B2-amendment). |
| expex two-walk (caret in example) | **0.394ms/keystroke** median; exactly 2 full-doc `descendants` confirmed | Real but far below the 1–3ms estimate — P10, after latex-command. |
| Placeholder decorations prop | **0.130ms/transaction** @3k (linear in top-level blocks) | Small; ships with the census that matters (P11). |
| math `update()` frequency | **ZERO** renderMath on: 10 keystrokes in a math-adjacent paragraph, 10 keystrokes INSIDE a math-bearing paragraph, a renumber-triggering insert. Mount = 1 render/atom. | The bail-less update fires on **decoration-band passes over math-bearing paragraphs** (transient-highlight/anchor bands), NOT on typing — B3's defect legs are retargeted accordingly (§4) and B3 ranks last (P12). |

One optional Chrome spot-check (the number jsdom most understates) may be run
during P9 on the worktree preview; no other pre-work bench remains — Appendix
D's S0 stage is **deleted** (the bench is delivered).

## 3. Arbitration layer — resolved design decisions

These resolve every red-team blocker/major (Appendix E). Implementers follow
these over any conflicting appendix sentence.

### 3.1 Scheduler (Appendix A is authoritative, with two amendments)

- **Latch:** the scheduler owns its own capture-phase, passive `document`
  keydown listener and imports a NEW `isPureModifierKeydown` export from
  input-modality (one modifier table, two readers). Appendix D's "ride
  input-modality's refcounted listener" variant is **struck** (red-team
  blocker: the refcounted listener detaches whenever no modality subscriber
  is mounted, silently disarming the latch).
- **Amendment 1 — the flush is a MACROTASK CHAIN, not a loop:** each due
  queue item runs in its own task (`setTimeout(0)` chain; use
  `scheduler.postTask({priority:"user-visible"})` where available), with the
  latch + `isInputPending` re-check between items. This is what makes
  acceptance criterion 2's guarantee structural: the ladder's largest task is
  its largest ITEM, and a resume between items defers the rest of the window.
  (Test 8.1-L7/L8 assert order and preemption ACROSS the chained tasks.)
- **Amendment 2 — the value table below is THE table** (Appendix D §0.5's
  competing values are struck):

| Site | quietMs | maxStalenessMs | rank |
|---|---|---|---|
| doc-products Tier A | 150 (DEFAULT_QUIET_MS) | **Infinity** (HEAD's debounce also never fires under continuous typing; freshness-obligated consumers call `ensureFresh`) | 0 |
| doc-products Tier B | 150 | **Infinity** | 1 |
| code-bridge reverse (TipTap→CM) | **500** | **1500** | 2 |
| code-bridge forward (CM→TipTap) | 150 | 2000 | 2 |
| lint feed | 150 | **Infinity** (advisory; input only refreshes at quiet edges anyway) | 3 |
| autosave | **latch-read only, never queued** (SAVE_QUIET_MS = 400) | **10_000** via `dirtySinceRef` (strict durability improvement over HEAD — see Appendix A §3.4) | n/a |

  The save's 400ms quiet vs products' 150ms is the cross-timer ordering
  mechanism (products settle before the save's gate opens); the tier table is
  normative and goes into the AGENTS.md prose.
- Panels need no rank (they ride the products publishes synchronously);
  `requestLowPriority` and its keep-alive callers are untouched.

### 3.2 Pipeline end-state (ONE merged spec for pipeline.ts — three sections edit this file)

Flag-on (`virgil:quiet-sched`; dedupe pieces additionally behind
`virgil:save-shared-assembly` as marked):

- **`onUpdate`:** `dirty = true; docRevision++;` then `cancelTierA?.();
  cancelTierB?.();` (O(1) each — the diagnosed uncancelled-Tier-B bug closed),
  then the existing timer reset. Still O(1)/keystroke; ONE guardrail
  justification rewrite covers the final shape (not three competing ones):
  `[cost: O(1)/tx — dirty flag + revision bump + two O(1) cancels + one timer
  reset; tiered bodies O(changed)→O(doc-bytes) at typing-quiet edges (flag-on)
  or legacy clocks (flag-off)]`, with the AGENTS.md prose twin in the same
  commit.
- **Timer body (+300ms):** unchanged gates (dirty/destroyed/isVisible), then
  enqueue Tier A + Tier B via `scheduleWhenQuiet` per the value table.
- **`runTierB`:** current body, plus (a) `wordCountsFor` tracking — **the
  red-team blocker fix**: a new closure `let wordCountsFor: JSONContent |
  null = null`; recompute counts only when `docJson !== wordCountsFor`, set
  `wordCountsFor = docJson` on every recompute (the naive
  `docJson === snapshot.docJson` skip is WRONG — Tier A publishes the new
  docJson before Tier B compares, so it would ship stale counts after every
  ordinary edit); (b) on recompute, field-compare against `snapshot.wordCounts`
  (iterating word-count-core's own category list) and keep the previous
  reference on equality (the A1 identity hole); (c) record the `tierB`
  staleness stamp `{revision, preambleEpoch, bibFamily, suppressed}` and, when
  it actually assembled, `lastAssembly` (Appendix B §1–2).
- **`ensureFresh`:** the generation-aware skip exactly as Appendix B §1
  (gated on `virgil:save-shared-assembly`), plus cancels of any pending
  scheduler items. **`destroy()`** cancels them too.
- **`saveProduct()`** and `assembleSourceWith` per Appendix B §2a; the
  `subscribeSourceText(editor, fn)` export per Appendix C A4 (added in P7).

### 3.3 One flag table (supersedes all per-section lists)

| Flag | Default | Covers | "off" reverts to |
|---|---|---|---|
| `virgil:quiet-sched` | **ON** | P2/P3/P6/P7 scheduling (tiers, autosave gate, bridge, lint) | byte-identical legacy clocks (300ms timer + rIC-200 Tier B + raw 1500ms save + 150ms bridge) |
| `virgil:save-shared-assembly` | **ON** | P5: ensureFresh skip + saveProduct handoff + writeDocBundle rungs 2–3 | cold `serializeToLatex` save path (rung 4), unconditional ensureFresh |
| `virgil:expex-index-numbering` | **ON** | P10 | the two full-doc walks (plus automatic fail-open on any index/node mismatch, flag-independent) |
| `virgil:latexcmd-splice` | **ON** | P9 | full-doc rebuild on the touched path |
| `virgil:caret-placeholder` | **ON** | P11 | stock TipTap Placeholder |
| `virgil:wasm-idle-release` | **OFF** | P13/C2 | no idle release (today) |
| `virgil:watcher-active-only` | **ON** | P13/C3 | document.hidden-only gating (today) |
| *(no flag, single-commit revert is the rollback unit)* | — | P4 word-count memo; P8 host split (rides `virgil:doc-products`); P12 math/citation bails; P13/C1 rasterCache | — |

Decision rule (stated once): a flag where failure would be silent or
content-adjacent (scheduling starvation, save bytes, renumbering, decoration
extents, placeholder semantics); a plain revert where failure is loud and
local. Defaults-ON is the `virgil:doc-products` precedent AND the study's own
finding #3 (a dark flag never soaks); Gabriel can override per §6-Q1.

### 3.4 Lint: ONE design (merges Appendix A §4.2 + Appendix C A3a)

`useLatexLint` gains product mode in a single stage (P7): subscribe
imperatively via `subscribeSourceText(editor, …)` (pipeline existence = the
mode switch, no defaulted argument); keep the 1500ms debounce keyed on text
identity; the debounce body wraps the worker call + `setErrors` in
`scheduleWhenQuiet("lint:feed:<docId-or-instance>", …, {rank: RANK_LINT,
maxStalenessMs: Infinity})`; return `{errors, lintedText}` and switch the
useDiagnostics maps to `lintedText` (the honest one-generation-stale delta for
compile-error snippets is pinned as intended). Flag-off and pipeline-less
paths keep the `text` prop byte-identically.

### 3.5 B3 (math/citation bails) retargeted per the bench

The fix is unchanged (compare BEFORE the `Object.assign` for math; last-applied
locals for citation — Appendix C B3 verbatim). The DEFECT legs change: drive
the production `setTransientHighlights`/`clearTransientHighlights` over a
paragraph containing N math atoms and assert **2N renderMath calls pre-fix →
0 post-fix** (the decoration-band path is where the bail-less update actually
fires; plain-typing legs would pass vacuously on HEAD — red-team major).
Keep the `setNodeMarkup` latex-change → exactly-1 leg both ways.

### 3.6 Small arbitrations (red-team minors, folded in)

- **Dedupe rung-2 limitation stated at the site:** after a save that injects a
  new preamble requirement, the written-delimiters cache diverges from the
  pipeline's disk-derived preamble and rung 2 stops matching for the session
  (rung 3 still serves; self-heals on reload). Record it in the
  `writeDocBundle` comment + the parity suite notes; optionally close later by
  refreshing the pipeline's preamble from the written delimiters.
- **CaretPlaceholder parity legs add the nested-empty-textblock cases**
  (caret in an empty paragraph inside a blockquote and inside a listItem,
  stock vs replacement, decision recorded at the site).
- **P9 carries the mapped-path obligation:** profile DecorationSet.map + the
  changed-region scan + overlap probe on the B2 harness; bound whichever
  component dominates (e.g. skip the overlap probe when the ±1 window
  contains no backslash and no decoration boundary) or record the measured
  cost as accepted with the number.
- **Parity-suite fixtures:** a NEW shared fixtures module
  (`src/lib/__tests__/_roundtrip-fixtures.ts`) holding copies of the
  round-trip corpus strings; the ~9 existing suites are NOT edited this wave
  (churn fence) — folding them onto the shared module is a later cleanup task.

## 4. Stage sequence (one worktree `perf-phase1`, one commit each)

| # | Stage | Contents (authoritative refs) | Depends | Flags born | Size |
|---|---|---|---|---|---|
| P1 | scheduler module | `quiescence-scheduler.ts` + `isPureModifierKeydown` export + probe + macrotask-chain flush (§3.1) + suite 8.1 (Appendix A §1, §7) | — | — | S |
| P2 | pipeline integration | §3.2 merged spec: quiet routing + cancels + stamps + wordCountsFor/A1 identity + ONE guardrail rewrite + suite 8.2 + AGENTS "quiescence half" prose | P1 | `virgil:quiet-sched` | M |
| P3 | autosave quiet gate | Appendix A §3 (SAVE_QUIET_MS 400, dirtySinceRef 10s, arm/clear helpers, ungated flush paths pinned) + suite 8.3 | P1 | — | S |
| P4 | word-count memo | Appendix B §4–5 (blockCategoryCounts WeakMap under the include-set door; zero consumer edits) + parity suite | — | — | S–M |
| P5 | save shared assembly | Appendix B §1–2 (ensureFresh skip, saveProduct, assemblyBibFamily, writeDocBundle 4-rung ladder in BOTH backends, useDocument handoff, caller table) + BOTH parity suites in the same commit | P2 | `virgil:save-shared-assembly` | M |
| P6 | bridge quiet-gating | Appendix A §4.1 (reverse 500/1500, forward 150/2000, flush()/dispose() drain, docId siteIds) + suite 8.4 | P1 | — | S–M |
| P7 | lint restructure | §3.4 (product mode + lintedText + quiet-wrapped fire + diagnostics dep switch + `subscribeSourceText` export) + suite 8.5 + A3a reactivity legs | P1, P2 | — | M |
| P8 | host split | Appendix C A2/A3/A3b/A4/A5 minus lint (P7): host stops subscribing, OutlineHost→useDocJson, WordCountPanel→useWordCountsProduct + selection counts move, EditorLayout unsubscribes (bus-derived divider levels + parity leg), Profiler suite + source-census legs | P7 | — | M |
| P9 | latex-command splice | Appendix C B2 + §3.6 mapped-path obligation + parity/cost legs | — | `virgil:latexcmd-splice` | M |
| P10 | expex index numbering | Appendix C B1 (bus index + per-example WeakMap + fail-open) + parity/cost/fallback legs | — | `virgil:expex-index-numbering` | M |
| P11 | caret placeholder + decoration census | Appendix C B4 + D (the census, complete 6→7-site allowlist, third-party leg) + §3.6 nested parity legs + AGENTS prose — ONE commit | — | `virgil:caret-placeholder` | M |
| P12 | math/citation bails | Appendix C B3 with §3.5 retargeted legs | — | — | S |
| P13 | hygiene | Appendix C C1 (raster cache module + pruneDocMaps wiring + source leg), C2 (idle release, flag OFF), C3 (watcher active-only + pollNow) — three small commits acceptable | — | C2/C3 flags | S |
| P14 | exit | doctrine sweep (§5 checklist), full suite + tsc on re-merged main, live acceptance run (§1 criteria, protocol Appendix D §0.3 as amended), memory files update, `--no-ff` merge | all | — | ~half day |

Merge policy: P1+P2 merge together; every other stage is independently
shippable in table order (dependency column is the truth). If the wave stalls,
merged prefixes are self-consistent. Estimated total: **5–7 focused days.**

## 5. Doctrine lockstep checklist (each item in the SAME commit as its code)

- P2: keystroke-subscriber-guardrail `pipeline.ts` justification (the ONE
  rewrite, §3.2) + AGENTS.md prose twin; AGENTS.md "The pause half" Tier-B
  paragraph rewritten (the forced-200ms sentence becomes false at P2);
  `schedule-low-priority.ts` header note; NEW AGENTS.md "quiescence half"
  subsection (law, latch/input-modality relationship, required-staleness rule,
  value table as normative, save-durability invariants, per-window latch,
  probe, flag).
- P3: useDocument autosaver allowlist justification gains the quiet-gate
  sentence; AGENTS prose twin.
- P5: AGENTS "pause half" gains the one-assembly-per-window + ladder
  description; storage save-hygiene notes updated.
- P6: code-pane-bridge allowlist justification (clocks changed).
- P7: lint feed description where named.
- P8: pipeline allowlist prose gains "product subscriptions live at consumer
  leaves; EditorPane hosts lifecycle only".
- P10: keystroke-sanctity prose notes the numberer consumes the examples
  INDEX (legacy walk = flag-off/mismatch fallback).
- P11: the decoration-prop census + AGENTS prose twin (a decorations prop IS
  a keystroke handler — the selectionUpdate precedent) — census + replacement
  + allowlist + prose in one commit.
- P13: DiskWatcher "wall-clock services" paragraph gains the pane-visibility
  clause + flag.
- P14: final sweep — grep every touched allowlist against its AGENTS prose.

## 6. Decisions Gabriel is asked to ratify (defaults stated; silence = defaults)

1. **Flag defaults ON at merge** for quiet-sched / save-shared-assembly /
   expex / latexcmd-splice / caret-placeholder (argued §3.3) — or the
   card-tiers OFF-until-soak posture. *Recommended: ON.*
2. **SAVE_MAX_STALENESS_MS = 10s** (one save-class hitch per 10s of genuinely
   pause-free typing, strictly better durability than HEAD) — or Infinity to
   preserve today's semantics exactly. *Recommended: 10s.*
3. **Code-pane feel:** the code pane trails ~500ms after you stop typing and
   refreshes at most every 1.5s mid-burst (today: at every inter-word gap,
   which is the cost being removed). *Recommended: accept; retune on soak.*
4. **C2 wasm idle release default OFF + 10min** (next compile after release
   pays a cold boot; memory win unmeasured). *Recommended: as designed.*
5. **C3 warm-doc watcher renegotiation:** external-change detection for WARM
   (hidden) docs defers to reactivation + an immediate poll. *Recommended:
   yes — nothing renders warm-doc state today.*
6. **Selection counts** compute only while the WordCount panel is mounted
   (they move into it). *Recommended: yes.*
7. **Do not wait** for the laggy document to start the wave (it slots into
   Phase-2 acceptance when shared). *Recommended: proceed.*
8. **B3 ships without a kill-switch** (five-line change, both directions
   test-pinned). *Recommended: confirm.*

## 7. Scope fence + standing Gabriel-gated items (not absorbed by this wave)

No windowing / content-visibility / occlusion (Phase 3, gated on Phase-2
traces); no editor swap; no doc-shape or saved-byte changes (P5 is
byte-parity-pinned); no per-keystroke-path changes beyond P9–P12; no new
corpora (Phase 2); no touching `virgil:card-tiers`/`virgil:perf-contain`
defaults. Still waiting on Gabriel from Phase 0: the v0.1.91 hard-reload
check, the laggy document (or its stats), the 5-question symptom interview,
the environment A/Bs, the card-tiers+perf-contain flip and soak, the standing
real-PWA feel check, S6 legacy deletion (which this wave EXTENDS with the
quiet-sched legacy clocks), push/release via `/cleanup-virgil`.

---

*Appendices follow: A = scheduler section, B = dedupe section, C = consumers
section (host split / carve-outs / hygiene / census), D = process section
(superseded where §1–§7 says so), E = red-team findings + bench detail. Each
appendix retains its own RISKS and OPEN QUESTIONS lists; §6 above is the
deduplicated set that needs an answer.*


---

# Appendix A — Scheduler section (authoritative, with §3.1 amendments)

# Phase 1 §1 — Typing-quiescence scheduler + pipeline integration

## 0. Verified anchors (re-grepped at HEAD, lines from live read 2026-08-17)

| Site | Anchor |
|---|---|
| Pipeline keystroke handler (resets ONLY the Tier A timer; never cancels the pending idle callback) | `src/lib/doc-products/pipeline.ts:226-239` (`onUpdate`), `:218-224` (`scheduleTierB` → `requestLowPriority`) |
| Forced 200 ms idle deadline | `src/lib/keep-alive/schedule-low-priority.ts:16-18` (`requestIdleCallback(..., { timeout: 200 })`) |
| Tier A / Tier B bodies | `pipeline.ts:167-174` (`runTierA`), `:193-216` (`runTierB`), `:288-301` (`ensureFresh` — unconditionally re-runs both tiers) |
| Pipeline flag pattern (read-once, default ON, "off" kill-switch) | `src/lib/doc-products/use-doc-products.ts:32-39` |
| Autosave debounce body | `src/hooks/useDocument.ts:347-383` (`debouncedSave`; pause-guard re-arm idiom `:360-363`) |
| Dirty-flag SSOT (`saveTimerRef.current !== null`) readers | `useDocument.ts:183` (`flushPending`), `:238-245` (DiskWatcher getter), `:257`, `:291`, `:315` (unmount / pagehide / beforeunload) |
| Discrete flush paths that must NOT be gated | `useDocument.ts:177-196` (`flushPending`), `:254-278` (unmount), `:284-334` (pagehide/beforeunload), `:399-423` (`flushNow`), `:446-474` (`saveWithDelimiters`), `:505-530` (`flushAnchorCommit`) |
| Bridge debounces | `src/lib/code-pane-bridge.ts:150-151` (600 / 150 defaults), `:272-321` (`flushTipTapToCode` + scheduler), `:206-270` (`flushCodeToTipTap`), `:490-499` (tx subscriber), `:523-526` (`flush()`), `:546-552` (`setDelimiters` — sync, stays sync) |
| Lint debounce | `src/hooks/useLatexLint.ts:36-54` (1500 ms; worker call + `setErrors`) |
| Keystroke latch precedent + pure-modifier rule | `src/lib/input-modality.ts:66-92` (`PURE_MODIFIER_KEYS`, `onKeyDown`), `:144-153` (flip-edge-only subscribe contract) |
| Layout-gesture bus API | `src/lib/pane-resize/layout-gesture-bus.ts:85` (`isLayoutGestureActive`), `:109` (`onLayoutGestureChange`), `:307` (`__resetLayoutGestureBusForTest`) |
| Guardrail entry that must move in lockstep | `src/lib/__tests__/keystroke-subscriber-guardrail.test.ts:104-105` (`"lib/doc-products/pipeline.ts"` justification), `:102-103` (`"lib/code-pane-bridge.ts"`) |

## 1. New module: `src/lib/quiescence-scheduler.ts`

### 1.1 The latch — own listener, shared modifier rule

**Decision: the scheduler owns its own capture-phase, passive `document` keydown listener; it imports the pure-modifier rule from input-modality via a NEW export.** It does not subscribe to `subscribeInputModality`, for a stated reason: that channel fires on modality **flips only** (`input-modality.ts:139-143` — "a 40-character burst fires this once"), and the scheduler needs a **timestamp per keydown** to compute the quiet edge. Widening input-modality's contract to per-event delivery would retire the flip-edge guarantee its consumers (grab handle) are built on. The rule that must not fork is the **modifier table**, so:

- `input-modality.ts` gains `export function isPureModifierKeydown(e: KeyboardEvent): boolean` (a `PURE_MODIFIER_KEYS.has(e.key)` read; the Set stays module-private). `onKeyDown` there rewrites to call it — one table, two readers. No other input-modality change; its suite (`src/lib/__tests__/input-modality.test.ts`) is untouched and must stay green.
- The scheduler's handler is: `if (isPureModifierKeydown(e)) return; lastKeydownTs = performance.now(); stats.keydowns++;` — **two branches and a store per keystroke, no timer churn**. There is deliberately NO per-keystroke `clearTimeout`/`setTimeout`: the quiet-edge timer is re-armed lazily at ITS OWN fire (the "re-check at fire time" rule below), so a mid-burst timer fires at most once per `quietMs` and each fire is O(1).
- Listener lifecycle: installed on the first `scheduleWhenQuiet` call ever (guarded `typeof document !== "undefined"`), never uninstalled. Justification recorded at the site: a Set-lookup + number store per keydown is strictly cheaper than install/uninstall churn per quiet window, and it removes the cold-start edge where the keydown that CAUSED the first schedule predates the listener. A `__resetQuiescenceSchedulerForTest()` export (the `__resetLayoutGestureBusForTest` pattern) removes it for suites.
- "Double-counting" is structurally impossible: the two listeners never feed each other, both are passive/capture, and the shared predicate is the only shared state.

The latch is deliberately **document-wide, not editor-scoped**: keydowns in a card float, the code pane, or the Library search box all contend for the same main thread, so they defer everyone's derived work (see §1.6 for the multi-pane argument).

### 1.2 API

```ts
export const quietSchedEnabled: boolean; // localStorage "virgil:quiet-sched" !== "off", read ONCE at module load (use-doc-products.ts:32-39 pattern; flip = reload, the A/B discipline)

export const DEFAULT_QUIET_MS = 150;     // THE app-wide definition of "quiet"
export const RANK_PRODUCTS_A = 0;
export const RANK_PRODUCTS_B = 1;
export const RANK_CODE_MIRROR = 2;
export const RANK_LINT = 3;
// (no RANK_PANELS: panels ride the products publishes synchronously — see §2)

export interface QuietOpts {
  quietMs?: number;        // default DEFAULT_QUIET_MS; per-site override (bridge: 500)
  maxStalenessMs: number;  // REQUIRED. Infinity is a legal, EXPLICIT statement.
  rank: number;            // REQUIRED. Settle order within one flush pass.
}
export function scheduleWhenQuiet(siteId: string, fn: () => void, opts: QuietOpts): () => void; // returns cancel
export function isQuietNow(quietMs?: number): boolean;       // latch read (for latch-only consumers: autosave)
export function msUntilQuiet(quietMs?: number): number;       // 0 when quiet (autosave retry re-arm)
export function __quietSchedStats(): QuietSchedStats;          // also installed on window
export function __quietSchedStatsReset(): void;
export function __resetQuiescenceSchedulerForTest(): void;
```

`maxStalenessMs` and `rank` are **required** ("a defaulted argument is a decision nobody made" — every site must state its freshness obligation and its place in the settle order). `quietMs` alone defaults, because a single app-wide quiet definition is the point; an override is the per-site exception (the bridge) and is stated where taken.

### 1.3 Semantics, precisely

- **Coalescing:** a second `scheduleWhenQuiet` with the same `siteId` REPLACES the pending `fn` and opts, and **keeps the earliest `firstScheduledAt`** — the staleness anchor persists across replacements until the site runs or is cancelled, otherwise a per-keystroke re-schedule pushes the deadline forever and starves the obligation. `deadline = firstScheduledAt + maxStalenessMs`.
- **siteIds are per-OWNER, never per-kind.** Two warm pipelines (multi-doc keep-alive, Reader) each schedule their own products; a bare `"doc-products:tierB"` id would let doc A's replacement DROP doc B's refresh — the single-slot bug of "Per-doc services under multi-pane keep-alive". Every integration below suffixes the docId: `` `doc-products:tierB:${docId}` ``.
- **Arming:** scheduling while quiet arms a `setTimeout(0)`-class flush (never runs `fn` synchronously inside the caller's stack — a schedule from inside a publish must not reenter React). Scheduling while typing arms the flush at `msUntilQuiet(minPendingQuietMs)`, clamped to the earliest pending deadline.
- **Re-check at fire (the load-bearing rule):** the flush timer's callback FIRST re-reads the latch. If a keydown landed since arming and no deadline has passed, it runs nothing, re-arms at `min(lastKeydownTs + minQuietMs, earliestDeadline) − now`, increments `deferredPasses` per held site, and returns. A timer that fires mid-burst re-arms; it never runs.
- **Flush pass:** sort pending items by `rank` (stable, ties by `firstScheduledAt`). For each item in order: run it if `now − lastKeydownTs ≥ item.quietMs` OR `now ≥ item.deadline`; otherwise keep it pending (per-site quietMs tiers mean a 500 ms-quiet bridge item legitimately survives a 150 ms-quiet flush).
- **Between-item preemption:** after each item, re-check `performance.now() − lastKeydownTs < DEFAULT_QUIET_MS`, `(navigator as { scheduling?: { isInputPending?: (o?: object) => boolean } }).scheduling?.isInputPending?.({ includeContinuous: false })`, and `isLayoutGestureActive()`. Any true → stop the pass, keep the remaining items, bump their `preempted`, re-arm. **Deadline overrides preemption:** an item past `deadline` runs even mid-burst/mid-gesture (that is what a hard deadline means; today's only Infinity-free obligations are the bridge and autosave). `isInputPending` is Chrome-only — optional-chained; the latch is the portable floor.
- **Layout-gesture parking:** the flush condition includes `!isLayoutGestureActive()`. While ≥1 item is pending the scheduler holds ONE `onLayoutGestureChange` subscription (edge-only, per the bus contract) that triggers a flush attempt on the 1→0 edge; unsubscribed when the queue drains. This is SUPPRESS-shaped, not park-shaped: nothing here measures geometry, it just declines to burn the gesture's frames.
- **Error containment:** each `fn` runs in try/finally; a throw is `console.error`ed, counted (`threw`), and never wedges the rest of the pass.
- **Cancel:** the returned fn removes the item iff it is still the same registration (identity-guarded, the scoped-dispose rule). Cancelling never fires `fn`.
- **Hidden tab:** browsers throttle timers to ≥1 s under `document.hidden`; the quiet edge (and even a deadline) fires late. Accepted and stated: the user is not typing in a hidden tab, and the durability backstops (pagehide/beforeunload flushes, §3) are event-driven, not timer-driven. No special code.
- **Flag OFF is a call-site fact, not a scheduler fact:** the module itself is flag-agnostic (so its suite needs no storage mocks); `quietSchedEnabled` is exported from this module and each integration takes its byte-identical legacy branch when false.

### 1.4 Kill-switch: `virgil:quiet-sched`, default ON — the argument

Default ON with `"off"` reverting to today's timers, the `virgil:doc-products` end-state pattern (`use-doc-products.ts:12-18`). Why ON from day one rather than the card-tiers dark-soak: (a) this is a **pure scheduling change** — every deferred `fn` is the same function reading live state at run time, so byte-parity of every product, save, and `.tex` is held by construction, and the worst reachable failure is bounded, visible staleness; (b) the memo's finding #3 is precisely that dark flags left the deployed configuration unmitigated — a default-OFF scheduler would guarantee the felt-lag fix ships un-felt; (c) the staleness story is provably ≥ today's (§3), and the legacy path (`requestLowPriority` + plain timers) survives intact as the automatic fallback, exactly as the doc-products legacy hooks did through soak. Card-tiers/perf-contain stayed OFF because they change RENDERED SEMANTICS (blank bodies, containing-block changes); this flag changes only WHEN unchanged work runs.

### 1.5 Probe: `window.__quietSchedStats()`

Always-on O(1) counters (the `pipelineStats`/`__layoutGestureStats` pattern), getter installed under `typeof window !== "undefined"`:

```ts
{ keydowns, flushPasses, pendingNow: string[],
  sites: { [siteId]: { scheduled, coalesced, ran, ranByDeadline,
                       deferredPasses, preempted, threw,
                       lastDelayMs, maxDelayMs } } }   // delay = run − firstScheduledAt
```

Acceptance read (matches the study's targets): during a typing burst every products site shows `ran` flat and `deferredPasses` climbing; after a pause, exactly one `ran` per dirty site; `ranByDeadline` nonzero only for bridge/save under genuinely continuous typing; `maxDelayMs` bounds the felt staleness.

### 1.6 Per-WINDOW latch — the decision and its justification

The latch is a module singleton per window (like input-modality). A keystroke in ANY pane defers ALL panes' derived work, because (a) the contended resource is the window's one main thread — a warm pane's 70 ms Tier B landing mid-burst while you type in the visible pane is exactly the collision class, whichever editor owns the keystroke; (b) hidden panes are already inert at the SOURCE (`pipeline.ts:233` — `isVisible()` gate marks dirty and schedules nothing), so cross-pane deferral only ever touches the visible pane's and the Reader's work; (c) a per-editor latch would need per-editor keydown attribution (focus tracking) for zero benefit — there is no scenario where running doc B's O(doc) work during doc A's burst is desirable. Multi-WINDOW needs nothing: each window has its own main thread, latch, and scheduler.

## 2. Pipeline integration (`src/lib/doc-products/pipeline.ts`)

All changes branch on `quietSchedEnabled`; flag off = today's code byte-for-byte.

1. **Tier scheduling routes through the scheduler.** The 300 ms Tier A debounce is KEPT as the coalescer (so a genuine ≥300 ms pause behaves exactly as today — at +300 the latch is already quiet and the flush is immediate; publishing at +150 instead would create MORE publishes/Outline recounts than HEAD, a regression). The timer body becomes, flag-on:
   ```ts
   timer = setTimeout(() => {
     timer = null;
     if (!dirty || destroyed) return;
     if (!config.isVisible()) return;      // hidden pane: unchanged
     dirty = false;
     cancelTierA = scheduleWhenQuiet(`doc-products:tierA:${config.docId}`, runTierA,
       { rank: RANK_PRODUCTS_A, maxStalenessMs: Infinity });
     cancelTierB = scheduleWhenQuiet(`doc-products:tierB:${config.docId}`, runTierB,
       { rank: RANK_PRODUCTS_B, maxStalenessMs: Infinity });
   }, interactiveMs);
   ```
   `maxStalenessMs: Infinity` is the deliberate statement: under continuous typing HEAD's Tier A timer never fires either (reset per keystroke), so products/lint staleness under a burst is unchanged from today; freshness-obligated consumers already call `ensureFresh()`.
2. **`onUpdate` CANCELS pending scheduler items** — the diagnosed bug, closed explicitly: flag-on, after `dirty = true`, run `cancelTierA?.(); cancelTierB?.();` (O(1) each) before resetting the timer. Without this, a keystroke between enqueue and quiet edge leaves the old Tier B item to run at +150 ms and the re-armed timer to enqueue it AGAIN at +300 — the assembly paid twice per window. With it, exactly one Tier A + one Tier B per quiet window. (The keystroke-path cost of `onUpdate` stays O(1): flag + two cancels + timer reset — guardrail justification updated in lockstep, §6.)
3. **The forced 200 ms deadline is gone on the flag-on path:** `scheduleTierB`/`requestLowPriority` is simply not called; Tier B runs as a plain task inside the quiet-edge flush. Justified: the quiet edge IS the idle signal (the user demonstrably stopped typing), a no-timeout rIC can starve unboundedly under animation, and the between-item `isInputPending` check covers the resume race a rIC deadline was papering over.
4. **`ensureFresh()` additionally cancels pending scheduler items** (both cancels beside the existing `clearTimeout`/`cancelIdle` clears at `pipeline.ts:291-297`) so an autosave-driven inline refresh is not followed by a redundant queued Tier B at the next edge. `destroy()` likewise (beside `:333-335`).
5. **The other `scheduleTierB` callers** (preamble attach `:253/:263`, delimiters-changed `:276`) call the same flag-forked scheduler path; at doc-open the latch is typically quiet so behavior is today's, minus the forced deadline.
6. **`requestLowPriority` itself is UNTOUCHED** — `schedule-low-priority.ts` stays byte-identical; its keep-alive re-show correction callers keep the 200 ms-deadline semantics they were designed around, and the flag-off pipeline path still imports it.
7. **Panels need no rank:** OutlinePanel's recount memo and EditorPane's re-render are downstream of `publish()` → `useSyncExternalStore` and run in React's next render after the products item, i.e. inside the same quiet window, after products, before the save's 400 ms-quiet fire — the stated order products → panels → save falls out of the quietMs tiers without a queue item. (Making those consumers cheaper is Phase-1 items 2–3, other sections.)

## 3. Autosave integration (`src/hooks/useDocument.ts`)

**Design constraint that rules out the queue:** `saveTimerRef.current !== null` is the dirty-flag SSOT read by `flushPending` (`:183`), the DiskWatcher getter (`:242`), pagehide (`:291`), beforeunload (`:315`) and unmount (`:257`). Handing the pending save to the scheduler would null the timer while work is pending → `flushPending` early-returns and a pagehide in that window LOSES the edit. So the save **never enters the queue**; it keeps its own timer and reads only the latch:

1. `debouncedSave`'s timer body (`:351-382`) gains ONE branch, after the pause guard and before the capture, flag-on:
   ```ts
   if (quietSchedEnabled
       && !isQuietNow(SAVE_QUIET_MS)                       // 400 ms
       && Date.now() - (dirtySinceRef.current ?? 0) < SAVE_MAX_STALENESS_MS) {  // 10_000 ms
     saveTimerRef.current = setTimeout(body, Math.max(60, msUntilQuiet(SAVE_QUIET_MS)));
     return;   // dirty flag STAYS true — same re-arm idiom as the pause guard at :360-363
   }
   ```
   The re-arm keeps a REAL timer in `saveTimerRef`, so every dirty-flag reader and every flush path is untouched. Each retry fire is O(1); retries occur only while dirty AND typing.
2. `dirtySinceRef` (the staleness anchor): set in `debouncedSave` on the null→armed transition; cleared at every site that captures a snapshot (`body` proceed path, `flushPending`, `flushNow`, `saveWithDelimiters`, pagehide, beforeunload, unmount) via two 3-line helpers `armDirtyClock()` / `clearDirtyClock()` so no site hand-rolls it.
3. **`SAVE_QUIET_MS = 400` is the ordering mechanism:** products flush at 150 ms quiet, so by construction every quiet window settles products (and their synchronous panel renders) before the save's gate opens — and `ensureFresh()` then finds warm tiers (the dedupe section makes that a generation no-op). No queue coupling, deterministic order, and save correctness never DEPENDS on order (ensureFresh is self-sufficient).
4. **Durability, compared honestly:** today's 1500 ms debounce ALSO never fires under continuous typing (reset per keystroke at `:348-350`); durability lives in the flush paths. Flag-on: identical flush paths, identical dirty flag, PLUS a 10 s hard deadline that forces a write under continuous typing where today writes nothing. Strict improvement; the cost is at most one save-class task per 10 s of genuinely pause-free typing.
5. **NOT gated, explicitly:** `flushNow` (anchor-mint durability — the mint tx must reach disk on the card's fast clock), `saveWithDelimiters`, `flushAnchorCommit`, `flushPending`, pagehide/beforeunload/unmount. Discrete commits and terminal flushes outrank typing comfort by design; each site gets a one-line comment saying so.
6. Flag off: `isQuietNow` branch compiled around a `quietSchedEnabled` check — byte-identical legacy behavior.

## 4. Code-pane bridge + lint

### 4.1 Bridge (`src/lib/code-pane-bridge.ts`) — CONVERT, with a per-site policy

Today's reverse debounce (150 ms, `:151/:318-321`) fires at ordinary inter-word gaps (150–500 ms), paying full assembly + whole-doc CM replace mid-typing. A default-quiet gate (150 ms) would change nothing — the numbers coincide — so the bridge takes the per-site override:

- **Reverse (TipTap→code), `scheduleTipTapToCode` flag-on:** keep the 150 ms debounce as the coalescer; at fire, `scheduleWhenQuiet(\`code-bridge:reverse:${docId}\`, flushTipTapToCode, { quietMs: 500, maxStalenessMs: 1500, rank: RANK_CODE_MIRROR })`. (`CreateCodePaneBridgeOptions` gains a required `docId` for the siteId — its one construction site in EditorLayout has it in hand.) **Felt tradeoff, stated for Gabriel:** the code pane updates ~500 ms after you stop typing instead of ~150 ms, and during pause-free typing it refreshes at most every 1.5 s (one bounded mid-burst hitch) instead of at every inter-word gap. The pane is a passive mirror while the caret is in TipTap (the cursor band is a separate RAF channel, `:402-406`, untouched), so a 500 ms trail is invisible in practice; the win is that inter-word gaps stop paying a CM whole-doc replace. Rank after products: the flush order warms the per-block latex caches before `assembleSourceWith` reads them.
- **Forward (code→TipTap), `scheduleCodeToTipTap` flag-on:** keep the 600 ms debounce; at fire, `scheduleWhenQuiet(\`code-bridge:parse:${docId}\`, flushCodeToTipTap, { quietMs: DEFAULT_QUIET_MS, maxStalenessMs: 2000, rank: RANK_CODE_MIRROR })`. Near-no-op for pure CM typing (a 600 ms gap implies quiet), but the fire-time re-check catches the pane-switch race (a TipTap keystroke landing inside the 600 ms window would otherwise collide with a full parse + `setContent`).
- **`flush()` (`:523-526`) must drain the scheduler too:** flag-on it cancels any pending quiet items and runs the pending flush bodies inline (track `pendingReverse`/`pendingForward` booleans set at schedule, cleared at run/cancel). `dispose()` cancels both. `setDelimiters` keeps its synchronous `flushTipTapToCode()` — disk-authoritative resync must not wait on quiet.
- The `editor.on("transaction")` subscriber body is unchanged (timer reset only) — its guardrail entry needs no cost-tag change.

### 4.2 Lint (`src/hooks/useLatexLint.ts`) — CONVERT the fire, keep the clock

The worker is healthy; only scheduling is in scope. Keep the 1500 ms debounce keyed on `sourceText` identity; flag-on, the timer body wraps its work in `scheduleWhenQuiet("lint:feed", run, { maxStalenessMs: Infinity, rank: RANK_LINT })` where `run` does the `lintInWorker` call (the ~1 MB structured clone) and the guarded `setErrors`. The effect cleanup must call the stored cancel alongside `clearTimeout`. This moves the clone + error-render out of a resumed burst; `Infinity` is correct because lint is purely advisory and its input (`sourceText`) only refreshes at quiet edges anyway — under continuous typing it is exactly as stale as HEAD. Rank last, per the settle order. (No docId needed in the siteId: the hook is keyed by its `text` prop per mounted pane; suffix with `docId` if the hook has it in reach at implementation time — if not, use a per-instance `useRef(nanoid)` suffix so two panes never coalesce. The implementer must pick one and pin it with the two-pane test leg, §8.1 L14.)

### 4.3 NOT converted, deliberately

- `requestLowPriority`'s keep-alive re-show callers (§2.6) — different obligation (post-paint correction on a discrete flip), correct semantics today.
- The legacy flag-off hooks (`useLatexSource`, `useWordCount`, EditorPane outline tick): they exist only as the `virgil:doc-products` OFF fallback and are slated for S6 deletion; teaching the soak-fallback path new behavior would make the fallback stop being one.
- All discrete-commit flush paths (§3.5).
- `updateCodeBand` (RAF-coalesced, equality-bailed — already keystroke-sane).

## 5. Lockstep obligations (guardrails + prose)

1. **`keystroke-subscriber-guardrail.test.ts:104-105`** — the `lib/doc-products/pipeline.ts` justification must be rewritten to name the new callback shape: `"[cost: O(1)/tx; tiered bodies O(changed)→O(doc) at typing-quiet edges] ... the update handler is a dirty flag + two O(1) pending-item cancels + one timer reset; flag-on (virgil:quiet-sched) the tiers run via scheduleWhenQuiet at the quiet edge (no forced rIC deadline), flag-off via the 300 ms timer + requestLowPriority as before."` The AGENTS.md prose twin (the `lib/doc-products/pipeline.ts` bullet in "Permitted subscribers") moves in the same commit.
2. **AGENTS.md new prose** — a subsection under keystroke sanctity ("The quiescence half: derived work runs at typing-quiet edges, never on forced deadlines") stating: the law (a typing-deferrable O(doc) derivation is scheduled through `scheduleWhenQuiet`, re-checks the latch at fire, and a forced idle deadline is outlawed for typing-deferrable work), the latch's relationship to input-modality (shared modifier table, separate per-event listener, and WHY), the required-`maxStalenessMs` rule, the save-durability invariants (dirty-flag SSOT untouched; flush paths ungated; deadline strictly-better argument), the per-window latch decision, the probe, and the flag. Also note the scheduler as a wall-clock service exempt from the `editor.on` census (the DiskWatcher-note pattern) — its keydown listener is a device read, not an editor subscription.
3. **No new guardrail censuses required** (no `editor.on`, no observers, no resize/scroll listeners, no storage listeners are added), but the implementer should note in the new prose that plugin decoration props remain the census blind spot (Phase-1 item 4's job, not this section's).
4. `input-modality.ts`'s header gains one line naming the second reader of the modifier table.

## 6. Stagewise task list

- **S1** — `quiescence-scheduler.ts` + `isPureModifierKeydown` export + probe + `__reset` hook; suite §8.1. Pure addition; no call sites; no flag consumers yet.
- **S2** — pipeline integration (§2) + suite §8.2. Flag `virgil:quiet-sched` born here, default ON.
- **S3** — autosave integration (§3) + suite §8.3.
- **S4** — bridge (§4.1) + lint (§4.2) + suites §8.4/§8.5.
- **S5** — lockstep: AGENTS.md prose + guardrail justification + input-modality header (§5), in the same PR as S2 at latest (prose may not trail code).
- Each stage: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` and run only the named files; any suite whose import chain reaches `@/lib/storage` carries `vi.mock("@/lib/storage", ...)` (the `pipeline.test.ts:14-20` shape).

## 7. Tests — files and legs

### 8.1 `src/lib/__tests__/quiescence-scheduler.test.ts` (jsdom, fake timers; synthetic `document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))`)
L1 quiet system: schedule → runs on the next flush tick, once. L2 defer-while-typing: keydowns every 100 ms → never runs; stop → runs ~`quietMs` after the last keydown. L3 re-check-at-fire: keydown between arm and fire → fn NOT called at fire, `deferredPasses` bumps, runs at the re-armed edge. L4 pure modifiers: a `Shift`/`Meta` keydown stream does not arm the latch (item runs) — driven off the SHARED predicate, so a table edit is covered by declaration. L5 coalescing: same siteId twice → first fn never called, one run, `coalesced` bumps. L6 staleness: keydowns every 100 ms past `maxStalenessMs` → runs AT the deadline despite typing; anchor pinned to FIRST schedule (re-schedules at +keystroke do not push it). L7 rank order: three sites scheduled out of order run products→save-rank→lint order. L8 preemption-by-latch: rank-0 item's fn dispatches a keydown → remaining items held, `preempted` bumps, run at next edge. L9 preemption-by-isInputPending: stubbed `navigator.scheduling.isInputPending` → same. L10 deadline overrides preemption. L11 per-site quietMs: a 500 ms site survives a flush that runs a 150 ms site. L12 layout-gesture parking: `__resetLayoutGestureBusForTest` + begin → flush defers; end edge → runs once. L13 throw containment: first item throws, second still runs. L14 no cross-owner coalescing: `a:doc1` and `a:doc2`-style distinct ids both run. L15 cancel: identity-guarded; cancelling one site leaves others. L16 probe counters move + reset.

### 8.2 `src/lib/doc-products/__tests__/pipeline-quiescence.test.ts` (jsdom, fake timers, real `Editor`, the `pipeline.test.ts` storage mock + harness)
L1 typing burst (insert + keydown every 100 ms, 2 s): `pipelineStats.tierARuns`/`tierBRuns` deltas 0, zero publishes. L2 pause: Tier A then Tier B exactly once, in order, at the quiet edge. L3 resume-between-tiers: a keydown dispatched from a subscriber during Tier A's publish → Tier B held (`tierBRuns` 0), runs at the next edge — the diagnosed mid-burst landing, pinned dead. L4 onUpdate cancels: keystroke while items pending → exactly ONE Tier B per quiet window (assert `assemblies` delta 1). L5 no forced deadline: spy `requestIdleCallback` → zero calls from the flag-on pipeline. L6 `ensureFresh` cancels pending items (no trailing duplicate Tier B). L7 hidden pane unchanged (dirty, inert). L8 `destroy()` cancels pending items. L9 flag off (`localStorage["virgil:quiet-sched"]="off"` + `vi.resetModules` + dynamic import): Tier B goes through `requestLowPriority`, onUpdate resets only the timer — the legacy path byte-alive.

### 8.3 `src/hooks/__tests__/useDocument-quiet-save.test.tsx` (extends the `useDocument.test.ts` harness/mocks)
L1 continuous typing: no `writeDocBundle` until quiet; write lands after the last keystroke + ~`SAVE_QUIET_MS`; the DiskWatcher unsaved-getter reads TRUE throughout the deferral (the SSOT leg — the one that catches a queue-shaped regression). L2 staleness: keydown+onUpdate every 100 ms for >10 s → exactly one write at ≤ `SAVE_MAX_STALENESS_MS`, dirty flag true until it. L3 `flushPending` mid-deferral: synchronous capture + write (ungated). L4 pagehide mid-deferral: same. L5 `flushNow` (anchor mint) ignores the latch entirely. L6 pause-guard + quiet-gate stacking: `shouldPauseAutosave` true → the pause re-arm wins, no double-fire. L7 flag off: 1500 ms fire byte-identical (non-regression against the existing suite's expectations).

### 8.4 `src/lib/__tests__/code-pane-bridge-quiescence.test.ts` (harness from `code-bridge-roundtrip.test.ts`)
L1 reverse flush held while typing; runs at the 500 ms quiet edge (one CM replace). L2 staleness: continuous typing >1.5 s → exactly one mid-burst CM replace. L3 forward parse: fire-time latch re-check defers the parse when a keydown landed inside the 600 ms window. L4 `flush()` drains pending scheduled items synchronously (unmount durability). L5 `dispose()` cancels (no post-dispose dispatch). L6 flag off: 150 ms legacy.

### 8.5 `src/hooks/__tests__/useLatexLint-quiescence.test.ts`
L1 fire-time defer: text set, 1500 ms elapse mid-typing → `lintInWorker` not called; called once at quiet. L2 cleanup cancels the scheduled item (no stale `setErrors`). L3 flag off: legacy timing.

## 8. Acceptance verification (maps to the study's targets)

At 3k blocks with the flag ON: `__quietSchedStats()` shows products `ran` = one per quiet window and 0 during bursts; `__docProductsStats()` `assemblies` ≤1 per window from the pipeline; `__keystrokeStats()` paced ≈ burst; `__virgilBusStats()` emit/materialize deltas 0 while typing (existing law, untouched). The >50 ms-task target is shared with the dedupe section (this section removes the collisions; dedupe shrinks the tasks).

## RISKS
- Autosave dirty-flag SSOT: any implementation that moves the pending save into the scheduler queue (instead of the latch-read retry re-arm specified) breaks flushPending/pagehide/DiskWatcher and can silently lose an edit — §3's design and test leg 8.3-L1 exist to make that shape fail; reviewers should treat a null saveTimerRef with pending work as an automatic reject.
- Staleness-deadline fires land O(doc) work mid-burst by design (bridge 1.5s, save 10s, and deadline overrides gesture parking); bounded and rare, but if Gabriel's real typing shows frequent deadline fires (probe: ranByDeadline), the constants need retuning, not the mechanism.
- The 300ms Tier A debounce + 150ms quiet gate interact: for pauses in the 300-450ms band the publish can land up to ~150ms later than HEAD if a stray keydown re-arms the edge — felt as slightly lazier outline refresh, not lag; watch deferredPasses in soak.
- Per-site quietMs tiering (150 products / 400 save / 500 bridge) is the ordering mechanism across independent timers; a future site that picks values violating the tier ordering silently reorders the settle — the AGENTS.md prose must state the tier table as normative.
- Timer throttling in hidden tabs delays deadlines up to ~1s+ (accepted; pagehide/beforeunload are the durability backstops), and vitest fake-timer suites must dispatch keydown BEFORE advancing timers or several legs pass vacuously.
- The latch counts keydowns anywhere in the window, including non-editor inputs (Library search, dialogs); this defers derived work during non-document typing — judged correct (shared main thread) but it is a behavior change someone may perceive as panel staleness.
- Flag-off path must remain byte-identical through soak: every integration is an if/else fork, so the S6-style legacy deletion becomes a THIRD flag cleanup obligation (quiet-sched joins doc-products and card-tiers on the post-soak list).
- isInputPending is Chrome-only; Safari/Firefox rely on the latch alone, so a resume landing inside a flush pass (<150ms window) can still queue behind one Tier B item there — bounded to one item by the between-item check.

## OPEN QUESTIONS
- SAVE_MAX_STALENESS_MS = 10s (forces one save-class hitch per 10s of genuinely pause-free typing, in exchange for strictly better durability than HEAD's never-fires-under-continuous-typing debounce) — confirm the value or choose Infinity to exactly preserve today's semantics.
- Code-pane bridge policy: quiet-gate at 500ms quiet / 1.5s max staleness (code pane trails ~500ms after you stop typing, refreshes at most every 1.5s mid-burst) vs. the softer alternative of just retuning 150→500ms with no staleness cap — the first is recommended; it is a felt-UX call only Gabriel can ratify in the real app.
- Default ON for virgil:quiet-sched (argued in §1.4 from the doc-products precedent and the memo's dark-flag finding) — orchestrator/Gabriel should ratify, since card-tiers/perf-contain set a competing default-OFF precedent.
- Should the latch ignore keydowns in non-editor inputs (scope the listener to editor/card/CM surfaces) or stay document-wide as designed? Designed: document-wide; a narrower scope needs a focus-attribution rule someone must own.
- Lint siteId disambiguation across panes: docId suffix if reachable at the hook site, else per-instance ref — implementer picks one; flagged here because the brief's 'no coalescing across owners' rule makes it a decision, not a detail.

---

# Appendix B — Dedupe section (authoritative; §3.2/§3.6 amendments)

## Section: Ladder dedupe — one assembly per quiet window + per-block word counts

**Goal restated as the empirical target:** today one ≥300 ms pause pays the ~1 MB assembly up to three times (Tier B at idle → `ensureFresh()` re-running both tiers at autosave → `writeDocBundle`'s cold `serializeToLatex`) and word-counts the doc twice. After this section: **one assembly per quiet window** (Tier B's, on the idle tier), an autosave whose synchronous O(doc) work is the hash + two cheap walks (≤ ~15 ms total at 3 k blocks), and both whole-doc word counts O(changed blocks). No ladder task from this subsystem > 50 ms.

**Scope boundary with the quiet-sched section:** cancelling the pending Tier-B idle callback in `onUpdate` and dropping the forced 200 ms deadline (`schedule-low-priority.ts:15-18`) belong to the scheduler section (its brief names them). This section's generation stamps make an uncancelled mid-burst Tier B harmless to the *save* (revision mismatch ⇒ its bytes are never reused) but do not remove its cost — do not double-land the cancel.

All line anchors verified at HEAD `552eeda7` on 2026-08-17; re-grep before editing.

---

### 1. `ensureFresh` generation-awareness (pipeline.ts)

**Integration points:** `src/lib/doc-products/pipeline.ts:226-238` (`onUpdate`), `:288-301` (`ensureFresh`), `:167-174` (`runTierA`), `:193-216` (`runTierB`), `:241-264` (attach preamble resolve), `:266-281` (delimiters-changed re-read).

**New pipeline state** (module-closure, beside `dirty`/`timer`):

```ts
let docRevision = 0;            // ++ at the TOP of onUpdate (pipeline.ts:227).
                                // TipTap 'update' fires only on docChanged
                                // transactions, so this IS the docChanged
                                // transaction counter — never wall clock.
let preambleEpoch = 0;          // ++ wherever preamble/postamble are assigned:
                                //   attach resolve (:248-249, :260-261) and the
                                //   TEX_DELIMITERS_CHANGED re-read (:273-275).
let tierARevision = -1;         // set = docRevision at the end of runTierA.
let tierB: {                    // recorded at the end of every runTierB:
  revision: number;             //   docRevision read at ENTRY (runTierB is
  preambleEpoch: number;        //   synchronous — no await, no tear).
  bibFamily: BibFamily | null;  //   the getBibFamily() value it serialized with.
  suppressed: boolean;          //   config.isSuppressed() at run time.
} | null = null;
```

**The staleness rule** — products are *current* iff **all** of:

1. `tierARevision === docRevision` (Tier A / docJson half), and
2. `tierB !== null && tierB.revision === docRevision` (content half of Tier B), and
3. `tierB.preambleEpoch === preambleEpoch` (a delimiters re-read invalidates sourceText without a doc edit), and
4. `tierB.bibFamily === (config.getBibFamily() ?? null)` (the Citations panel can toggle the package with no doc edit and no event reaching the pipeline — sample the getter, don't wait for an event; `asBibFamily` returns primitives so `===` is a byte compare), and
5. `tierB.suppressed === config.isSuppressed()` (a Tier B run while the code view owned the feed skipped `buildSourceText` — pipeline.ts:201 — so its record does not vouch for sourceText).

**New `ensureFresh`:**

```ts
ensureFresh() {
  pipelineStats.ensureFreshCalls++;
  if (destroyed) return snapshot;
  const wantA = tierARevision !== docRevision;
  const wantB = tierB === null
    || tierB.revision !== docRevision
    || tierB.preambleEpoch !== preambleEpoch
    || tierB.bibFamily !== (config.getBibFamily() ?? null)
    || tierB.suppressed !== config.isSuppressed();
  if (!wantA && !wantB) {
    pipelineStats.ensureFreshSkips++;          // new probe counter
    return snapshot;                            // ZERO work, same object
  }
  if (timer) { clearTimeout(timer); timer = null; }
  cancelIdle?.(); cancelIdle = null;
  dirty = false;
  if (wantA) runTierA();
  runTierB();                                   // wantB is true whenever we get here
                                                // with wantA true (see invariant below)
  return snapshot;
}
```

Invariant making the skip sound: an armed `timer` or pending `cancelIdle` implies staleness — the timer is armed only by `onUpdate` (which bumped `docRevision` past `tierARevision`), and a pending idle implies Tier B has not yet recorded the current revision or the delimiters handler bumped `preambleEpoch`. So the skip branch can never leave live scheduled work pointing at stale state. The hidden-pane case (timer fired, returned on `!isVisible()`, `dirty` stays true) still satisfies rule 1 (`docRevision` advanced), so `ensureFresh` recovers exactly as today (pinned by the existing pipeline.test.ts leg "hidden pane stays dirty-but-inert").

**Rule for future editors (goes in the pipeline header + AGENTS.md doc-products prose):** any NEW input that Tier B reads at serialize time must join the `tierB` record and the `wantB` disjunction, or `ensureFresh` will vouch for bytes that input can silently change. The five inputs above are the complete audited set at HEAD (doc, preamble/postamble, bibFamily, suppression; the external code-view feed is covered because a code-pane edit round-trips into TipTap via the bridge and bumps `docRevision`).

**Flag:** the skip is gated by `virgil:save-shared-assembly` (see §6) — flag off ⇒ `ensureFresh` behaves exactly as today (unconditional both-tiers re-run). Rationale: a staleness-rule bug's failure mode is *an autosave writing stale content*, which is the one failure class this repo treats as worse than any perf regression; one flag must restore the entire legacy save behavior.

**Test pinning "autosave 1 s after Tier B does zero re-serialization"** (extend `src/lib/doc-products/__tests__/pipeline.test.ts`, whose harness already fakes timers + settles the idle tier):
- edit → `advanceTimersByTimeAsync(350)` (Tier A) → `settle()` (Tier B) → record `pipelineStats.{tierARuns,tierBRuns,assemblies}` and `blockCacheStats.latexMisses` → `p.ensureFresh()` → **all four deltas are 0** and the returned snapshot is the *same object* (`toBe`) with `generation` unchanged.
- Defect leg (measured by neutering): revert the skip to unconditional re-run ⇒ the assemblies delta goes 0→1 and the leg fails.
- Staleness legs, one per rule: (2) edit without settling ⇒ `ensureFresh` runs and its snapshot contains the edit (the existing hidden-pane leg already covers this shape); (3) dispatch `TEX_DELIMITERS_CHANGED_EVENT` with new disk bytes ⇒ next `ensureFresh` re-assembles; (4) flip the `getBibFamily` return between settles ⇒ re-assembles; (5) flip `isSuppressed` ⇒ re-runs.

---

### 2. Save-path assembly sharing

**Integration points:** `src/hooks/useDocument.ts:372-373` and `:419-420` (the two pipeline-aware flush sites), `:132` (the single production `writeDocBundle` caller — verified by grep: `useDocument.save` is the only one); `src/lib/storage-fsa.ts:644-775` (`writeDocBundle`: `:661-664` uuid gate, `:674-686` delimiters resolution, `:696` `readDocBibFamily`, `:711` cold `serializeToLatex`, `:723-729` byte-equality gate); `src/lib/storage-dev.ts:456-` (mirror: `:492-494`, `:502-503`, `:526`); `src/lib/latex-serializer.ts:1275-1321` (`assembleLatex`), `:1323-1351` (`serializeToLatex` — note it is ALREADY `parts.map(serializeTopLevelBlock)` + `assembleLatex`, one code path, which is what makes this section's parity surface small), `:1252-1260` (`foldBibFamilies`, currently private); `src/lib/doc-products/block-caches.ts:150-160` (`getBlockLatex`, byte-parity with the cold path already CI-pinned — see below).

#### 2a. The parameter shape: a consistent `saveProduct()` triple, not a closure and not bare bytes

New pipeline method (beside `assembleSourceWith`, pipeline.ts:306-318):

```ts
export interface SaveProduct {
  /** The identity-stable shared doc snapshot — the SAME object ensureFresh
   *  returns; the save writes THIS as `content`. */
  docJson: JSONContent;
  /** Per-block latex parts read from the warm caches. */
  parts: readonly TopLevelBlockLatex[];
  /** collectPreambleTitleFields(docJson) — captured here so the assembly and
   *  the sidecar derive from ONE doc revision. */
  titleFields: JSONContent[];
  /** Tier B's already-assembled .tex, offered ONLY when it is a pure function
   *  of the CURRENT docRevision and pipeline-owned inputs (never the external
   *  code-view feed). Null ⇒ the caller assembles from `parts`. */
  assembled: {
    tex: string;
    preamble: string | undefined;
    postamble: string | undefined;
    bibFamily: BibFamily | null;
  } | null;
}

saveProduct(): SaveProduct;
```

Implementation: `saveProduct()` internally calls `ensureFresh()`, then reads `docJson = snapshot.docJson`, `parts` via `getBlockLatex` over `editor.state.doc` children (all warm — O(childCount) WeakMap lookups, ~100 µs at 3 k), and `titleFields` — **synchronously, with no await between reads**, so the triple is torn-proof by construction. This is why the shape is a *data triple resolved at flush time*, not a closure: `enqueueDocWrite` (storage-fsa.ts:649) executes the write task later, and a closure re-reading `editor.state.doc` at execution time could serialize a doc newer than the `content` written to the sidecar — a `.tex`/`virgil.json` tear. It is also why `docJson` is part of the product: `useDocument` must write the SAME object the parts were derived from.

`runTierB` additionally records `lastAssembly = { revision, preamble, postamble, bibFamily, tex }` whenever it actually assembled (`!suppressed && preambleReady && text !== null`). `saveProduct().assembled` is `lastAssembly` iff `lastAssembly.revision === docRevision && !config.isSuppressed() && !externalFed` (the revision check alone excludes stale bytes; the two latches are belt-and-suspenders against the code-view feed, whose text must never become save bytes through this door — the code pane's own save path is `saveWithDelimiters`, untouched).

New export from `latex-serializer.ts`: `assemblyBibFamily(parts, opt: BibFamily | null | undefined): BibFamily | null` = `opt ?? foldBibFamilies(parts)` (makes the private fold reachable for the equality check without exporting the fold rule itself — publish the whole operation).

#### 2b. `writeDocBundle` — the four-rung ladder (BOTH backends, byte-for-byte mirrored)

`opts` gains `assembled?: SaveProduct`. Per the "defaulted argument" doctrine, absence is a stated decision: **omitted = "serialize cold from `content`" — the pre-existing behavior, and every caller states which it uses** (see the caller table below). Inside the queued task, after the delimiters/bibFamily/style resolution (storage-fsa.ts:674-710) and replacing line `:711` (dev `:526`):

```ts
let latex: string;
if (needsUuidWork(content)) {
  // Rung 1 — UNCHANGED mutator-gate semantics (:661-664): deep copy, mint,
  // COLD serialize the mutated copy. `opts.assembled` is IGNORED here: the
  // copy's minted uuids are not in the pipeline parts, and a save that used
  // them would write a .tex whose %!v: anchors disagree with the sidecar.
  content = JSON.parse(JSON.stringify(content));
  assignUuids(content);
  latex = serializeToLatex(content, serializeOpts);
} else if (
  opts?.assembled?.assembled &&
  opts.assembled.assembled.preamble === serializeOpts.preamble &&
  opts.assembled.assembled.postamble === serializeOpts.postamble &&
  assemblyBibFamily(opts.assembled.parts, opts.assembled.assembled.bibFamily) ===
    assemblyBibFamily(opts.assembled.parts, serializeOpts.bibFamily ?? null)
) {
  // Rung 2 — reuse Tier B's bytes: ZERO assembly on the save. Equality is on
  // the RAW option values (string === is a byte compare; the pipeline's
  // preamble and the delimiter cache read the same disk file, so steady
  // state matches) — except bibFamily, compared on the EFFECTIVE family,
  // because post-344 the stored citations.json bibPackage may be unset while
  // the hook resolves a detected family: null-vs-"natbib" with parts folding
  // to natbib produces identical bytes and must reuse.
  latex = opts.assembled.assembled.tex;
} else if (opts?.assembled) {
  // Rung 3 — assemble from warm parts with the SAVE's own resolved opts
  // (~62-77 ms tail, but no per-block re-serialize). This is the rung a
  // pause-swallowed delimiters override or a bibFamily mismatch takes.
  latex = assembleLatex(opts.assembled.parts, opts.assembled.titleFields, serializeOpts);
} else {
  // Rung 4 — the cold path, byte-identity oracle, retained verbatim for
  // non-pipeline callers: terminal flushes, saveWithDelimiters, flag off.
  latex = serializeToLatex(content, serializeOpts);
}
```

Everything downstream (`hashContent`, byte-equality gate `:723-729`, forensic snapshot, ledger stamp, written-delimiters cache `:762-773`) is untouched — parity means the gate and ledger see identical bytes regardless of rung.

**Authority stays where it is:** `writeDocBundle` remains the sole resolver of delimiters (disk/cache/override, `:674-686`) and bibFamily (`readDocBibFamily`, `:696` — the on-disk citations.json, not the hook state). The pipeline supplies *mechanism* (parts, bytes), never *policy* — which is what keeps the MEMO-history delimiters rule intact: an `opts.delimiters` override (unsaved preamble edit) mismatches rung 2's preamble compare by construction and lands on rung 3 with the override bytes.

#### 2c. Caller table (each states its decision)

| Caller | Passes `assembled`? | Why |
|---|---|---|
| `debouncedSave` (useDocument.ts:372-381) | YES (flag on): `const sp = products.saveProduct(); latestContentRef.current = sp.docJson; save(sp.docJson, { ...takeDelimitersOpts(), assembled: sp })` | The hot autosave — the whole point. `sp.docJson` replaces the separate `ensureFresh().docJson` read so content/parts/titleFields are one revision. |
| `flushNow` (:419-422) | YES (flag on), same shape | Anchor-mint flush during a drag — benefits identically; `lastSavedRef` keeps the shared identity so `flushAnchorCommit`'s O(1) compare (:513-516) is unchanged. |
| `saveWithDelimiters` (:446-474) | NO | Discrete, rare, uses `editor.getJSON()` today; its fresh-preamble override would land on rung 3 anyway. Leave byte-identical. |
| unmount cleanup (:254-278), pagehide/beforeunload (:284-334) | NO — **untouched** | Per MEMO_PERF_PROGRAM_HANDOFF ("Terminal paths (unmount/pagehide) deliberately keep getJSON"): they fire around editor destruction and must not depend on pipeline liveness; a last-chance write wants the cold oracle, not shared state. |
| `flushPending` (:177-196) | NO | Doc-switch barrier / external flush — same terminal-path reasoning; it already prefers `editor.getJSON()`. |

`docProductsEnabled` off or pipeline null ⇒ `saveProduct` unreachable ⇒ rung 4, byte-identical legacy.

#### 2d. Byte-parity — the CI contract

Parity decomposes into three claims, two already pinned:

1. **Warm parts ≡ cold parts** — `getBlockLatex(node)` bytes ≡ `serializeTopLevelBlock(node.toJSON())`: pinned by `src/lib/doc-products/__tests__/container-granularity.test.ts:100` ("re-serializes ONE item, byte-identically") and `:205` (nested lists/blockquotes through the memo), plus the composed-JSON deep-equality leg (block-caches.ts:84-89 header).
2. **`serializeToLatex` IS parts + `assembleLatex`** — true at HEAD by construction (latex-serializer.ts:1344-1350, "ONE code path… the cold path and the byte-identity oracle").
3. **NEW: the ladder's rungs agree** — new suite `src/lib/__tests__/save-assembly-parity.test.ts`:
   - **Corpus:** every fixture the existing round-trip family exercises (`quote-roundtrip`, `list-item-roundtrip`, `tex-block-roundtrip`, `verbatim-roundtrip`, `figure-roundtrip`, `example-item-roundtrip`, `displaymath-in-item-roundtrip`, `unmodeled-env-roundtrip`, `comment-carrier-roundtrip` — lift their fixture strings into a shared exported list rather than duplicating), **plus `samples/annotation-history/main.tex` parsed whole via `parseLatex`** — the one corpus with real density (footnotes, cites, expex, figures, comments).
   - **Legs per doc:** build a real-schema PM doc, warm the caches, then assert rung-3 bytes (`assembleLatex(parts, titleFields, opts)`) `===` rung-4 bytes (`serializeToLatex(doc.toJSON(), opts)`) across the opts matrix: delimiters ∈ {undefined, custom pair, empty-string preamble (the `||` fallback)}, bibFamily ∈ {undefined, null, "natbib", "biblatex"}; and rung-2 (a recorded Tier-B assembly with matching inputs) `===` rung-3.
   - **Staleness defect leg (measured by neutering):** warm Tier B, then edit WITHOUT settling — `saveProduct().assembled` must be `null`; delete the `revision` check and the leg fails with the stale bytes.
   - Vitest gotcha: any import chain reaching `@/lib/storage` needs `vi.mock("@/lib/storage", …)` (MEMO_PERF_PROGRAM_HANDOFF "Test gotchas"); the pipeline imports `readTex` from it, so the suite drives `block-caches` + `latex-serializer` directly where possible and mocks for the pipeline-level legs.
4. **`writeDocBundle` contract legs** — `src/lib/__tests__/write-doc-bundle-assembled.test.ts` against the **storage-dev** backend (in-memory, the preview backend — a divergent dev mirror would make every preview A/B lie, so dev is tested first-class, not as an afterthought):
   - (a) same content saved with and without `assembled` ⇒ identical on-"disk" `.tex` and sidecar bytes;
   - (b) a doc failing `needsUuidWork` (one uuid-less paragraph) saved WITH `assembled` ⇒ rung 1 taken, minted anchors present, `assembled` provably unused (spy on `assembleLatex`);
   - (c) `opts.delimiters` override + a matching-looking `assembled.assembled` ⇒ rung 3, output carries the OVERRIDE preamble (the resurrection guard, restated as a test);
   - (d) byte-equality gate still short-circuits a no-change save on every rung.

---

### 3. What remains synchronous in the save — decided per item, estimated from the code

| Work | Cost @3 k blocks / ~1 MB | Decision |
|---|---|---|
| `needsUuidWork(content)` (storage-fsa.ts:661; latex-serializer.ts:1635) | read-only JSON attr walk, no string work: ~0.5–2 ms | **Keep synchronous.** It IS the mutator gate; per the brief, gate semantics untouched. |
| `extractSidecarData(content)` (:688; latex-serializer.ts:1767) | shallow O(blocks) walk collecting parTitle/collapsed: ~1 ms | **Keep.** |
| `hashContent(latex)` (:712; disk-ledger.ts:127 cyrb53, one `charCodeAt` loop) | ~5–10 ms per MB | **Keep.** It funds the byte-equality gate (skips snapshot + 2 writes + ledger re-stat). Considered and declined: caching Tier B's hash alongside `lastAssembly` to skip re-hashing on rung 2 — <10 ms saved for a second hash-bookkeeping surface. |
| `JSON.stringify(sidecar)` + its hash (:713-714) | small (titled-paragraph map): <1 ms | **Keep.** |
| `extractPreambleAndPostamble(latex)` for the written-delimiters cache (:765) | regex scan: ~1–3 ms | **Keep.** |
| the ~62–77 ms `assembleLatex` tail | — | **The one thing worth deduping** — eliminated on rung 2, halved-to-once-per-window on rung 3. |

Net steady-state synchronous save cost: ≈ hash + walks ≈ 10–15 ms — under the 50 ms ladder-task target with margin. Nothing else is folded into the quiet window by this section.

---

### 4. Per-block word counts (word-count-core.ts) — a memo below the filter, zero consumer edits

**Integration points:** `src/lib/word-count-core.ts:262-269` (`countCategories`), `:275-278` (`buildPerBlockCounts`), `:341-354` (`computeCategoryCounts`); consumers `src/lib/doc-products/pipeline.ts:211` (Tier B) and `src/panels/Outline/OutlinePanel.tsx:1591` (`useMemo(() => buildPerBlockCounts(content), [content])`, summed at `:1606-1610` via `sumIncludedWords`); Outline's `content` is the pipeline docJson flag-on (`EditorPane.tsx:2209-2211` `outlineContentEffective`), so **Tier B and the Outline key the same memo entries** — that sharing is the point.

**Design (all inside the module — "publish whole operations", and the `word-count-filter-ssot.test.ts` census already forbids per-category reduces outside it):**

```ts
// Module-private. Keyed on per-block JSON OBJECT IDENTITY — the pipeline
// preserves it for unchanged blocks (the exact contract this memo needs).
const blockCountsMemo = new WeakMap<JSONContent, CategoryCounts>();
export const wcMemoStats = { hits: 0, misses: 0 };   // probe, surfaced via __docProductsStats

/** Per-block door: words AND characters together (one entry serves Tier B and
 *  the Outline; supersedes countCategories' chars-skipping rationale :257-261 —
 *  with memoization, both once per CHANGED block is cheaper than words-only
 *  per block per publish). */
export function blockCategoryCounts(block: JSONContent): CategoryCounts { … }
```

- `computeCategoryCounts(doc)` — when `doc.type === "doc" && doc.content`: sum `blockCategoryCounts` over children (private `addCategoryCounts` helper). Any other root: the legacy whole-walk, unchanged (totality kept for arbitrary subtrees).
- `buildPerBlockCounts(doc)` — becomes `doc.content.map((n) => blockCategoryCounts(n).words)`; return type unchanged (`Record<Category, number>[]`), so OutlinePanel.tsx needs **zero edits** — its per-publish cost drops to O(blocks) WeakMap hits (~sub-ms) with O(changed) real work.
- Tier B (`pipeline.ts:211`) needs **zero edits** — `computeCategoryCounts(docJson)` now decomposes internally, and `docJson`'s children are the identity-stable per-block JSONs.
- `countCategories` stays exported (it is `blockCategoryCounts(...).words` semantically; either delegate it or leave it as the unmemoized subtree door — delegate, so there is one walker invocation path).

**Decomposition soundness (must be pinned, not assumed):** whole-doc counting joins each category's parts with `" "` and splits on `/\s+/`; since the separator is whitespace, no token spans a part boundary, so per-block word counts sum exactly to the whole-doc count; characters strip all whitespace, so concatenation is exact. The parity leg makes this a contract rather than a derivation — a future walker change that emits boundary-merging parts fails CI.

**Invalidation correctness:** keyed on per-block JSON identity, which the pipeline preserves for unchanged blocks — CI-pinned at `src/lib/doc-products/__tests__/pipeline.test.ts:82-99` ("one edit re-serializes ONE block and preserves unchanged block identity"; `after.content![0] toBe before.content![0]`) and `container-granularity.test.ts:153` (identity at depth). The memo's other premise — cached JSON is never mutated — is the existing read-only contract (`block-caches.ts:106-113`; `needsUuidWork` copy-on-write, storage-fsa.ts:654-664; the storage-dev `assignUuids` guard from task 337). A violation would already poison saved bytes, so this memo adds no new obligation.

**Flag-off / non-pipeline callers — correct but slow, by design and stated:** `useWordCount.ts:29,41` (legacy hook: fresh `doc.toJSON()` per recount) and `useSelectionCounts.ts:44` (fresh `{type:"doc", content}` slice per selection) present fresh objects ⇒ all misses ⇒ byte-identical results at legacy cost; WeakMap entries GC with the fragments. **No flag for the memo:** it is a transparent identity-keyed cache with a parity pin, no scheduling change and no byte-path change — a kill-switch would be a permanently-dead branch (the dead-SSOT class AGENTS.md legislates against).

**Tests** (`src/lib/__tests__/word-count-block-memo.test.ts` + extend `word-count-filter-ssot.test.ts` only if its census needs the new export names listed):
- Parity: memoized `computeCategoryCounts` ≡ a preserved unmemoized reference implementation over the round-trip corpus + adversarial shapes (hardBreak-only paragraph, empty blocks, expex glosses, footnote `attrs.content`, latexComment blocks, comment-tail marks). Defect leg by neutering: change the per-block join separator to `""` ⇒ parity fails.
- Memo behavior: count a doc, replace ONE child object, recount ⇒ `wcMemoStats.misses` delta exactly 1; second `buildPerBlockCounts` over the same doc ⇒ misses delta 0.
- Pipeline integration leg (in pipeline.test.ts): after a 1-block edit and settle, `wcMemoStats.misses` moved by 1, not by `childCount`.

### 5. Include-set interaction — confirmed below the filter

`CategoryCounts` stays the unfiltered per-category tally; the include-set is applied only at read time through `includedTotals` (`WordCountPanel.tsx:45-49`, `CutterPanel.tsx:111`) and `sumIncludedWords` (`OutlinePanel.tsx:1606`). The memo caches *tallies*, never filtered totals, so a config toggle changes no memo key and needs **no invalidation** — the filter re-runs over unchanged cached tallies. Pinned: a leg toggling every category flag between two reads asserts `wcMemoStats.misses` delta 0 while `includedTotals` moves. The selection counter is untouched (fresh fragments, §4).

---

### 6. Kill-switch, stages, lockstep obligations

**Flag decision: its own flag, `virgil:save-shared-assembly`, default ON at land** — read once at module load (the `docProductsEnabled` pattern, `use-doc-products.ts:32-39`), `"off"` = kill-switch. It gates BOTH the `ensureFresh` skip (§1) and the `saveProduct` handoff (§2c): they are one trust decision ("the save believes the pipeline's currency"), and one flip must restore the entire legacy save ladder for A/B diagnosis. **Not riding `virgil:quiet-sched`:** different failure domains (bytes vs scheduling) and diagnosis needs the 2×2. **Default ON argued:** (i) the parity surface is small by construction — `serializeToLatex` is already parts+assembleLatex (:1344-1350) and warm≡cold is already byte-pinned; the only genuinely new claims (rung agreement, staleness rule) each carry a defect leg that fails on the neutered implementation; (ii) default OFF ships the fix to nobody — Gabriel is the population, and the doc-products precedent's OFF-then-flip cost a wave of soak time for a flag that never fired; (iii) residual escape is caught downstream by the byte-equality gate, the forensic snapshot (≥1/min, ALWAYS on delimiters commits), and the DiskWatcher ledger. Flag-off byte-identity is itself a test leg (T3a run with the flag forced off ⇒ rung 4 ⇒ same bytes).

**Stages (each lands green independently):**
1. word-count memo + parity suite (§4-5; no flag, zero consumer edits).
2. pipeline: revision/epoch stamps, `ensureFresh` skip, `saveProduct()`, `lastAssembly` recording, probe counters (`ensureFreshSkips`, `saveAssemblyReuses`, `wcMemoStats` in `__docProductsStats`); `assemblyBibFamily` export.
3. `writeDocBundle` ladder in storage-dev AND storage-fsa + contract suite.
4. `useDocument` handoff behind the flag + T5.
5. save-assembly parity suite over the corpus (gates the default-ON claim — merge order: parity suite in the same PR as stage 4 or earlier).
6. AGENTS.md + guardrail lockstep (below), MEMO/handoff updates.

**Lockstep obligations (CI-enforced prose):**
- `PERMITTED_KEYSTROKE_SUBSCRIBERS` justification for `lib/doc-products/pipeline.ts` (in `keystroke-subscriber-guardrail.test.ts` AND the AGENTS.md prose twin) currently reads "the update handler is a dirty flag + one timer reset (O(1))" — becomes "…dirty flag + one counter bump + one timer reset (O(1))", `[cost: …]` tag format preserved. The bump is O(1); the handler stays compliant.
- AGENTS.md doc-products prose: add the `ensureFresh` generation rule (with the "new Tier-B input joins the record" obligation) and the save-shared-assembly ladder + flag; word-count prose ("The other half") gains the memo half with the below-the-filter statement.
- No new `editor.on`/observer/resize/scroll registrations anywhere in this section ⇒ no other census moves.

**Acceptance against the study's targets:** pause-window main-thread cost from this subsystem drops from ~240–300 ms (Tier B 62–77 + ensureFresh re-run ~65 + cold serialize ~78 + 2× word count 30–47 each) to: one Tier-B assembly (~65 ms, idle tier — its mid-burst landing is the quiet-sched section's kill) + O(changed) word count (~1 ms) + save-path ~10–15 ms. Verified in the Phase-2 trace re-run; unit-level, `pipelineStats.assemblies` per quiet window is asserted ≤1 in T1.

## RISKS
- Staleness-rule completeness: if a future Tier-B input (anything runTierB reads at serialize time) is added without joining the tierB record and wantB disjunction, ensureFresh will vouch for stale bytes and an autosave can write stale content. Mitigated by the header rule + AGENTS prose + per-rule test legs, but it is a maintenance invariant, not a structural impossibility.
- Rung-2 reuse depends on input-equality checks (preamble/postamble string compare, effective-bibFamily compare). A missed input dimension there writes Tier B's bytes under different save opts. The parity suite's opts matrix covers the four known dimensions; a fifth AssembleLatexOptions field added later must join the compare (same class as risk 1). onRequirementConflict is callback-only (no byte effect) — verified at HEAD.
- Tear risk between content and parts if a future editor inserts an await inside saveProduct() or between saveProduct() and save() — would write a .tex/sidecar pair from two doc revisions. Guarded by comment + the T3a byte-identity leg only indirectly; flag as a review checkpoint for the implementing PR.
- storage-dev/storage-fsa mirror drift: the ladder must land in both backends or preview A/Bs diverge from prod. The contract suite runs against dev; fsa's rungs are exercised only via the parity suite's shared functions — an fsa-only regression in the ladder plumbing (not the bytes) could hide. Consider one fsa-mocked leg if the existing fsa test harness supports it cheaply.
- Undo-history retention: lastAssembly holds one ~1MB string per doc (bounded, replaced per Tier B) and the WC WeakMap is bounded by history depth like block-caches — no unbounded growth, but +1MB steady-state per warm pane is real; acceptable against the 3-pane keep-alive cap, stated here so it is a decision.
- Default-ON flag: if the parity corpus misses a construct (the corpus is the round-trip family + one real paper), a byte divergence ships to saves immediately. Backstops: byte-equality gate, forensic snapshots, ledger. If the orchestrator prefers the doc-products precedent (land OFF, flip after a soak), only §6's argument changes — the design is identical.
- Concurrent-checkout hazard (process risk): main is a live shared checkout with an existing worktree (raw-declare-345); implementation must run in its own worktree and re-verify HEAD before merge.

## OPEN QUESTIONS
- Flag default: land virgil:save-shared-assembly ON (argued in §6) or follow the virgil:doc-products precedent (land OFF, flip post-soak)? Gabriel's call — the design supports both with one line.
- Boundary ownership: the quiet-sched section owns cancelling the pending Tier-B idle in onUpdate and dropping the forced 200ms deadline; confirm the orchestrator assigns it there so neither section double-lands or orphans it.
- Rung 2 (Tier-B byte reuse) in the first landing, or stage rung 3 first and add rung 2 after a soak? Recommended together (same flag, same parity suite), but rung 3 alone already collapses the ladder from 3 assemblies to 2 if the orchestrator wants a smaller first diff.
- May the parity suite lift fixture strings out of the existing round-trip suites into a shared exported list (a test-only refactor touching ~9 suites), or should it duplicate the fixtures to keep those files untouched in this wave?

---

# Appendix C — Consumers section: host split, carve-outs, hygiene, census (authoritative; §3.5/§3.6 amendments)

## Section: Host split, complex-content carve-outs, hygiene, decoration-prop guardrail

All file:line anchors re-verified against the live tree at `0e7f4e60` (post-`552eeda7` merges). Lines drift — re-grep at implementation time. Nothing in this section touches saved `.tex` bytes (no serializer/assembleLatex change), so byte-parity is trivially held; the one byte-adjacent risk (B2) is decoration-only.

---

### A. useDocProductsHost split — product subscriptions move to consumer leaves

**Diagnosis confirmed.** `useDocProductsHost` holds ONE `useSyncExternalStore` over the whole `ProductsSnapshot` (src/lib/doc-products/use-doc-products.ts:100-104). `publish()` (src/lib/doc-products/pipeline.ts:146-149) mints a fresh snapshot object and bumps a single `generation` on every Tier A AND Tier B publish, so every publish re-renders the whole ~8,100-line EditorPane (mounted at src/components/EditorPane.tsx:2179-2186). Two publishes per pause = the 10-30ms class.

**Does the pipeline version per product?** No. There is one `generation` (pipeline.ts:56-57, :147) and **no consumer reads it anywhere** (verified by grep; only the probe does). The per-product "version" is VALUE IDENTITY, and it is already preserved for two of the three products: `docJson` returns the previous object when no child ref changed (pipeline.ts:151-165, CI-pinned identity contract), and `sourceText` is only written when the string differs (:203). `wordCounts` is the hole: Tier B always writes a fresh `computeCategoryCounts` object (:210-213), so a word-count subscriber re-renders on every Tier B even when nothing changed. Design decision: **identity IS the per-product stamp** — no new generation fields; instead close the wordCounts identity hole (A1). This is what makes the existing leaf hooks (`useDocJson` :121-127, `useWordCountsProduct` :130-136) already re-render-correct: `useSyncExternalStore` wakes on every publish but bails the re-render on `Object.is`-equal snapshots.

#### Stage A1 — pipeline: wordCounts identity preservation + skip

In `runTierB` (pipeline.ts:208-213):
1. If `docJson === snapshot.docJson && snapshot.wordCounts !== null`, **skip `computeCategoryCounts` entirely** (counts are a pure function of docJson; unchanged input ⇒ unchanged output). This also removes one of the duplicate full-doc word counts `ensureFresh()` pays (:288-301) — complements, but does not replace, the ensureFresh dedupe owned by the scheduler section.
2. When it does recompute, compare the fresh `CategoryCounts` against `snapshot.wordCounts` field-by-field (fixed small shape: per-category `{words, characters}` — iterate the module's own category list from `@/lib/word-count-core`, never a hand list) and keep the PREVIOUS reference on equality.

Test: extend the doc-products suite (beside src/lib/doc-products/__tests__/container-granularity.test.ts, same harness/mocks — `vi.mock("@/lib/storage")` required, chain reaches `readTex`): (a) two Tier B runs with no intervening edit → `snapshot().wordCounts` identity stable; (b) an edit that changes text but not counts (replace "cat"→"dog") → identity stable; (c) an edit that changes counts → new object. Leg (b) fails pre-fix.

#### Stage A2 — the host stops subscribing; stable imperative handles

`useDocProductsHost` (use-doc-products.ts:67-115) changes:
- **Delete the `useSyncExternalStore`** (:100-104) and the `snapshot` return member.
- Return **stable closures** created once with `useCallback([])` that read `productsRef.current` at CALL time: `setExternalSourceFeed(text)` and (see below) nothing else. This kills the current null-latch (`docProductsHost.setExternalSourceFeed === null` dep at EditorPane.tsx:2207) — the closure is always defined and always reaches the live pipeline.
- **Delete the `ensureFresh` return member**: grep shows zero consumers of `docProductsHost.ensureFresh` (autosave calls `getDocProducts(editor)?.ensureFresh()` directly — src/hooks/useDocument.ts:373, :420, :513). A published member with no caller is the dead-facet class (AGENTS "The field half"); delete rather than carry.
- Lifecycle (create/destroy effect :85-98, the `isSuppressed`/`isVisible`/`getBibFamily` ref plumbing :77-83) stays in EditorPane untouched — EditorPane remains the pipeline's single owner; only the SUBSCRIPTION leaves.

EditorPane edits:
- `setSourceText` memo (:2200-2207): flag-on branch becomes the stable host closure; delete the null-latch dep. The `paneState` bubble (:5182, :5229) and EditorLayout's `paneStateRef.current?.setSourceText?.(text)` (EditorLayout.tsx:1517) are unchanged.
- Delete `outlineContentEffective` (:2208-2211) and the `wordCountHook` product branch (:2288-2294) per A3/A4 below.

#### Stage A3 — consumer-by-consumer migration (the complete enumeration)

A consumer missed here silently loses reactivity (the dead-panel-prop class), so this table is the contract; the implementation re-greps `useDocProductsHost|useDocJson|useWordCountsProduct|getDocProducts|snapshot\.` before starting and reconciles against it.

| # | Consumer (today) | New subscription point |
|---|---|---|
| 1 | **sourceText → useDiagnostics** (EditorPane.tsx:2197-2199 → :2225; src/hooks/useDiagnostics.ts:99 → useLatexLint) | Lint subscribes **imperatively** inside `useLatexLint` (A3a below). No render-value sourceText in EditorPane flag-on. |
| 2 | **setSourceText** (EditorPane.tsx:2200-2207 → paneState :5182) | Stable host closure (A2). Behavior-identical. |
| 3 | **docJson → OutlineHost** (EditorPane.tsx:2209-2211 → `content={outlineContentEffective}` at :5862, :5924 → PaneRailBody → outline-host.tsx:41) | `OutlineHost` gains an `editor: Editor | null` prop (PaneRailBody already receives `editor`, :5861) and calls `const productJson = useDocJson(p.editor); const content = productJson ?? p.content;`. EditorPane passes `content={outlineContent}` (the legacy memo, EditorPane.tsx:1018-1024 — already null flag-on, so the fallback is exact). Tier A now re-renders OutlineHost+OutlinePanel only. NOTE: the print-path PaneRailBody at :6917 passes `content={initialContent ?? docHook.content}` (:6921) — deliberately untouched. |
| 4 | **wordCounts → wordCountHook** (EditorPane.tsx:2286-2294; threaded at :5913, :5975, :6106, :6972, :7184; consumed solely by WordCountPanel at :8125-8127) | `WordCountPanel` (src/panels/WordCount) gains `editor: Editor | null` and internally does the CutterPanel fork (src/panels/Cutter/CutterPanel.tsx:95-102 is the exact precedent): `useWordCountsProduct(docProductsEnabled ? editor : null) ?? EMPTY_CATEGORY_COUNTS`, legacy `counts` prop as flag-off fallback. **`useSelectionCounts` moves from EditorPane (:2287) into WordCountPanel** — its only consumer; this also removes EditorPane's per-selection-span re-renders, and counts are computed only while the panel is mounted (strictly cheaper). The `wordCountHook` prop thread survives as the legacy/flag-off carrier only; EditorPane's memo collapses to `legacyWordCountHook`. No selection-census change: the `selectionUpdate` subscription lives in useSelectionCounts.ts, and the guardrail censuses files, not call sites. |
| 5 | **CutterPanel** (:97 `useWordCountsProduct`) | Already a leaf. A1's identity fix stops its per-Tier-B re-render. |
| 6 | **EditorLayout `useDocJson`** (EditorLayout.tsx:1143-1146) | **Deleted** (A3b below). |
| 7 | **CodeEditor** (src/components/CodeEditor.tsx:179, :194 `assembleSourceWith`) | Imperative pull — unchanged. |
| 8 | **code-pane-bridge** (src/lib/code-pane-bridge.ts:292) | Imperative pull — unchanged. |
| 9 | **useDocument autosave** (useDocument.ts:373, :420, :513) | Imperative `ensureFresh` — unchanged here (dedupe is the scheduler section's brief). |
| 10 | **generation** | No consumer anywhere; retained for the probe only. |

**A3a — the lint/diagnostics feed (the one restructure with real design content).** Any hook EditorPane calls that holds a `useSyncExternalStore` re-renders EditorPane, so sourceText must stop being a render value anywhere in EditorPane's hook tree. But `useDiagnostics` already keeps every OUTPUT identity-stable when errors are empty (useDiagnostics.ts:33-40, :101-107, :173-199) — the only per-pause re-render driver is the `sourceText` prop itself. Design:

- `useLatexLint` (src/hooks/useLatexLint.ts) gains a product mode: it takes `editor` alongside the existing `text` prop. In an effect keyed `[editor, bibKeysStable]`: `const p = getDocProducts(editor)`; if `p` is null (flag off / no pipeline) the existing `text`-prop path runs unchanged (the pipeline's existence in the registry IS the flag — no defaulted mode argument). If non-null: read `p.snapshot().sourceText`, then `p.subscribe(...)`; on each wake, compare against a `lastTextRef` and, on change, run the EXISTING 1500ms-debounce + `lintInWorker` body. Ordering is safe by hook order: the host's create-effect (EditorPane :2179) precedes useDiagnostics (:2222) in the same component, so the pipeline exists when lint's effect runs — pinned by a test, not assumed.
- `useLatexLint` returns `{ errors, lintedText }` — the worker response stores the PAIR in one state (the text those errors were computed against). The derived maps in useDiagnostics (`paragraphByErrorId` :173-186, `errorSnippets` :188-199) switch deps from `[sourceText, allLatexErrors]` to `[lintedText, allLatexErrors]`. **Honest behavior delta:** today the maps read the LIVE sourceText render value; after, they read the last-linted bytes. For lint errors that is strictly more correct (line numbers match the bytes linted); for compile errors merged in, snippet/paragraph resolution can be one lint-generation stale for the sub-1500ms window after an edit — display-only (snippet text, jump paragraph), stated in the hook comment and pinned as intended in the test.
- `useDiagnostics` keeps its `sourceText` prop for the flag-off legacy path (EditorPane passes `docProductsEnabled ? null : legacySourceText`), threading it into useLatexLint's `text` and using `lintedText ?? sourceText` for the maps. Flag-off behavior is byte-identical.

**A3b — EditorLayout stops subscribing.** `latestDocEffective` (EditorLayout.tsx:1144-1146) has exactly three consumers:
1. `switchToCodeView` (:2727, :2742, dep :2763) — an EVENT handler. Read at call time: `(getDocProducts(editorInstance)?.snapshot().docJson ?? latestDoc)`; drop the render dep (read via a ref or inline). Staleness parity: identical to today's snapshot semantics.
2. `outlineHeadings = extractHeadings(docForOutline)` (:2075-2076) — an O(doc) walk per Tier A whose only LIVE consumers are `availableDividerLevels` (:2119-2124 → `dividerClassName` :2131-2133, a rendered className) and the `focusStructure` PRE-MOUNT fallback (:2098-2106). Replace: derive `availableDividerLevels` from the DocStructureBus (`getBus(editorInstance)?.structure.headings`, each entry carries `level`), gated on `[editorInstance, rev.headings]` — bumps only on heading changes, zero per-pause work, and serves BOTH flag states (the bus exists regardless of `virgil:doc-products`). The focusStructure fallback's docJson arm is deleted: flag-on it is ALREADY vacuous today (the pipeline mounts with the editor, so `pipelineDocJson` is null exactly when `editorInstance` is null); flag-off keeps `latestDoc`. Pin heading-level parity (extractHeadings level vs bus `HeadingEntry.level`, including the title/level-0 edge) in the A5 suite — if they diverge on any fixture, keep extractHeadings but feed it from a bus-gated `getDocProducts(...).snapshot().docJson` event-read instead (decision recorded at the site either way).
3. `latestDoc` state + `setLatestDoc` (editor-ops feed, :1139, editor-ops.ts:55) — flag-off legacy, untouched; update the editor-ops comment that names `useDocJson`.

After this, `useDocJson`'s only production caller is OutlineHost — correct: the shell no longer re-renders per pause at all.

#### Stage A4 — API surface after the split (use-doc-products.ts)

- `useDocProductsHost(opts)` → `{ setExternalSourceFeed(text): void }` (lifecycle + feed only; stable identity).
- `useDocJson(editor)`, `useWordCountsProduct(editor)` — unchanged signatures, now the ONLY render-value doors.
- **No `useSourceTextProduct` render hook is added** — no consumer needs sourceText as a render value after A3a, and an unused hook is the dead-export class. Instead export `subscribeSourceText(editor, fn): () => void` from pipeline.ts (thin: subscribe + identity-compare + call with the new string) for useLatexLint and any future imperative feed.

#### Stage A5 — acceptance tests

New file `src/lib/doc-products/__tests__/host-split-rerender.test.tsx` (jsdom, `vi.mock("@/lib/storage")`):
- **Profiler leg** (precedent: src/components/__tests__/floating-panel-edge-resize.test.tsx:28, :102-122 — count COMMITS via `<Profiler onRender>`): mount a harness tree `Root` (calls the split `useDocProductsHost` with a REAL TipTap editor, `enabled: true`) wrapping `<Profiler id="root">`, with children `<Profiler id="outline"><OutlineLeaf/></Profiler>` (calls `useDocJson`) and `<Profiler id="wc"><WordLeaf/></Profiler>` (calls `useWordCountsProduct`). Type into the editor; flush Tier A (fake timers, 300ms) and Tier B (the jsdom `requestLowPriority` fallback — follow the existing doc-products suites' flush idiom). Assert: outline commits +1 on a content-changing Tier A, wc commits only when counts changed, **root commits +0 across both tiers**. The root leg fails on the pre-split host.
- **Source-census leg (the leg with teeth):** read `src/components/EditorPane.tsx` source and assert it never spells `docProductsHost.snapshot` (or any `.snapshot()` off the host), and read `src/components/EditorLayout.tsx` and assert no `useDocJson(` call — the reintroduction shape no behavioral test can see. Use `commentsStripped` from src/lib/__tests__/_source-scan.ts (never a fourth stripper).
- **Per-consumer reactivity legs** (the missed-consumer net): outline leg — Tier A docJson change reaches OutlineHost's rendered content; wordcount leg — Tier B count change reaches WordCountPanel through the product hook with the legacy prop frozen; lint leg — drive `useLatexLint` in product mode against a real pipeline, assert the worker receives the post-change text exactly once per change and that a pipeline-created-after-first-render editor still attaches (the ordering pin). Diagnostics maps leg: with one lint error, maps resolve against `lintedText`; sourceText churn with a stable error list leaves every useDiagnostics output identity-stable (the existing :33-40 contract, re-pinned through the new feed).

Kill-switch: none new — `virgil:doc-products` (off ⇒ legacy hooks, byte-identical, all fallback props retained) already brackets every changed path, and the flag-off branches are exercised by the fallback legs above.

AGENTS.md lockstep: update the `lib/doc-products/pipeline.ts` PERMITTED_KEYSTROKE_SUBSCRIBERS prose entry (AGENTS.md keystroke list) with one sentence: product subscriptions live at consumer leaves (`useDocJson`/`useWordCountsProduct`/`subscribeSourceText`); EditorPane hosts lifecycle only and never subscribes. No allowlist change (no new `editor.on`).

---

### B. Complex-content per-keystroke carve-outs

#### B1 — expex: index-driven numbering, per-example caching

**Verified shape** (src/lib/tiptap/expex.ts): the appendTransaction gate (:1814-1863) correctly bails outside examples, but any keystroke INSIDE an exampleBlock (contentChangedUuids → `resolveTouchedBlock` → `exampleBlock`, :1853-1859) then runs TWO full `newState.doc.descendants` walks — re-letter (:1917-1945) and gloss colCount (:1949-1967) — visiting every node including all prose text nodes.

**Design** (flag `virgil:expex-index-numbering`, default ON, `"off"` reverts to the legacy walks — the `virgil:geom-*` pattern; read at the gate site, not perf-feature-flags.ts, which owns CSS flags only):
1. After the existing gate passes, call `readDocStructure(newState)` (exported from src/lib/tiptap/doc-structure/index.ts:41; legal here — the observer plugin is the FIRST extension so its `apply` has run for this tr, and the materialize is O(entities), capped at 32 maps, paid only on gated example edits that previously paid two O(doc) walks). Take `structure.examples` (`ExampleEntry.pos` = opening exampleBlock position, types.ts:122-135; nested examples ARE indexed — structure-index.ts:141-155 tracks an open-block stack, step-inspector.ts:132 covers incremental adds) and **sort by pos** (applyDiff appends, so index order is not document order; pos order is exact).
2. For each entry in pos order: `const node = newState.doc.nodeAt(entry.pos)`; **any entry whose node is not an `exampleBlock` aborts the index path and falls back to the legacy full walk for this run** (automatic fail-open, independent of the flag).
3. Per example, run the EXISTING interior logic verbatim — number assignment (global counter/exnoOverride), `walkList` re-letter, gloss colCount, width accumulation — scoped to that block's subtree. Walk 2 folds in: `exampleGloss` exists only inside the expex family, pinned by the parity leg.
4. **Content-only scoping via the block-cache idiom** (the doc-products "the miss IS the diff" pattern, src/lib/doc-products/block-caches.ts): a module-level `WeakMap<PMNode, { maxMarkerLen: number; maxNumDigitsSelf: number; interiorClean: true }>` keyed on the exampleBlock PM node. Unchanged example ⇒ same node identity ⇒ contribute cached width maxima + O(1) number-attr check, skip the interior walk. A touched example (new node identity) walks, then caches. This serves add/remove/reorder AND content-only changes with no diff-kind fork, and an example the walk had to FIX gets a fresh node from the appended tr, re-walks once next run, and converges.

Net cost per gated keystroke: E entry resolutions + interior walk of touched examples only — independent of prose size.

Tests (`src/lib/tiptap/__tests__/expex-index-numbering.test.ts`, real editor with the full extension list — the nested-tier suites' precedent that hand-rolled schemas cannot build the breaking shapes):
- **Parity leg:** for each fixture — multiple examples, split item lists (counter continuity :1868-1874), nested item lists (depth markers), `exnoOverride`, an exampleBlock nested in a blockquote and in a listItem, glosses with ragged rows — run the same edit under flag-on and flag-off and assert byte-identical doc JSON and identical `WIDTH_META`. Existing pins stay green: expex-num-width.test.ts (widths), appendtx-guards-keystroke-sanctity.test.ts (the gate), example-item-roundtrip / example-body-label-ref.
- **Cost leg** (mirror container-granularity.test.ts:127-145's `Node.prototype.toJSON` patch pattern): patch `Node.prototype.descendants` counting invocations where `this.type.name === "doc"`; a keystroke inside one example of a 100-prose-block doc must record **0** doc-level descendants calls from this plugin (pre-fix: 2). Restore in `finally`.
- **Fallback leg:** corrupt one resolved entry (monkeypatch `nodeAt` for one call) → the run must produce the legacy walk's exact output.

AGENTS lockstep: none of the three greps sees appendTransaction internals; add one sentence to the AGENTS keystroke-sanctity prose where expex's gate is implicitly covered ("Consume the diff") noting the numberer now also consumes the examples INDEX, with the legacy walk as the flag-off/mismatch fallback.

#### B2 — latex-command: splice, don't rebuild

**Verified shape** (src/lib/tiptap/latex-command.ts): `apply` (:243-288) maps forward, then on `touched` (backslash in changed region ±1, or an existing deco overlapping the region) calls `buildDecorations(tr.doc)` (:194-231) — a full-doc walk building every inline deco + every `p-cmd-only` node deco.

**Design** (flag `virgil:latexcmd-splice`, default ON, `"off"` ⇒ full rebuild; read once at module scope):
1. Refactor `buildDecorations`'s per-node logic into a shared `decorateBlock(decos, node, pos)`: the paragraph branch (:197-225, including the `p-cmd-only` count) and the non-paragraph fallthrough (`decorateTextNode` over text children). The full build calls it from `descendants`; the splice calls it directly. **Parity by construction — one code path.**
2. On `touched`: collect the affected TEXTBLOCK units — for each step map range expanded ±1 (the existing expansion, :254-255), `tr.doc.nodesBetween(expandedFrom, expandedTo, ...)` gathering `[pos, pos+nodeSize]` for every `node.isTextblock` (the paragraph branch keys on `type.name === "paragraph"` at any depth; other textblocks re-scan their text children — the exact units the full build treats atomically). Merge overlapping ranges.
3. `let set = mapped; for each unit: set = set.remove(set.find(from, to)); build additions via decorateBlock; set = set.add(tr.doc, additions);` — bounded `find` only (the task-337 law; the argless-find census in decoration-probe-cost.test.ts stays green by construction).
4. **Multi-paragraph edits (paste) are honest:** `nodesBetween` enumerates every textblock the pasted span touches — O(changed), which is the correct bill for a paste. A whole-doc `setContent`/load lands in `init` (:240-242), unchanged.
5. Any resolution throw ⇒ full rebuild for that transaction (fail open).

Tests: extend `src/lib/tiptap/__tests__/decoration-probe-cost.test.ts`'s harness into a sibling `latex-command-splice.test.ts`:
- **Parity leg:** after each scripted edit (type `\` mid-paragraph; type inside an existing `\emph{...}` changing its length; delete the backslash; paste three paragraphs two of which contain commands; split a paragraph mid-command; join two paragraphs; toggle a paragraph into/out of command-only) — serialize the plugin's live set (`find()` argless is fine in TEST code) and compare from/to/spec against a fresh `buildDecorations(tr.doc)`. Each leg must fail when the splice is neutered to "remove nothing".
- **Cost leg** (the toJSON-count pattern): patch `Node.prototype.descendants` counting doc-node invocations attributable to this plugin's apply — typing `\x` in one paragraph of a 300-block command-rich doc records **0** (pre-fix: 1 full rebuild per touched keystroke); scope the spy window to the single `dispatch`.

AGENTS lockstep: the "pause half" section's latex-command paragraph gains one sentence (splice-scoped rebuild, flag name); decoration-prop allowlist entry (D) states the post-B2 cost.

#### B3 — math + citation NodeView equality bails (no flag — see rationale)

**Math** (src/lib/tiptap/math.ts:141-152): `update()` computes `uuidChanged` BEFORE `Object.assign(node, updated)` (:143-146) — proof the hazard was known — then calls `renderMath` unconditionally (:147). A naive bail placed after the assign compares the destroyed value and never re-renders. Fix, verbatim shape:
```ts
const latexChanged = (updated.attrs.latex || "") !== (node.attrs.latex || "");
const uuidChanged = updated.attrs.uuid !== node.attrs.uuid;   // existing
Object.assign(node, updated);                                  // existing
if (latexChanged) renderMath(dom, updated.attrs.latex || "", displayMode);
```
"Equal" = normalized `latex` only: `displayMode` is a per-NodeView closure constant (:82), not an attr, and a changed `kind`/type already returns false at :142. The uuid stamp branch (:148-150) is untouched.

**Citation** (src/lib/tiptap/citation.ts:322-327): `update()` rewrites `dom.dataset.citationId` and re-runs `applyCitationContent` (innerHTML/textContent write, :245-266) on every call. There is NO `Object.assign` here — the mount `node` closure is never updated, so comparing against `node.attrs` would compare against MOUNT-time values forever (wrong after the first real change). Track last-applied values instead: `let lastDisplay = node.attrs.displayText; let lastCommand = node.attrs.command; let lastCitationId = node.attrs.citationId;` — in `update()`, write `dataset.citationId` only when changed, call `applyCitationContent` only when `(displayText, command)` changed, then refresh the three locals. "Equal" = `displayText` + `command` (the only inputs of `applyCitationContent`); `citationId` gates only its own dataset write.

Why no `virgil:*` flag: the bail compares the exact, complete input set of the skipped render at the moment it is skipped; the failure mode (stale glyph) is immediately visible and pinned in both directions below; a flag would double the branch surface of a five-line change. Recorded as a decision, not a default.

Tests (`src/lib/tiptap/__tests__/atom-update-bail.test.ts`, jsdom, real editor):
- Math: `vi.mock("katex")` with a spied `render`. Mount a paragraph containing inline math + text; type three characters in the same paragraph → **0** katex.render calls (pre-fix: 3 — this leg fails on HEAD); `setNodeMarkup` changing `latex` → exactly 1; changing `uuid` only → 0 renders but the stamp runs.
- Citation: MutationObserver on the atom's dom (childList+characterData+attributes, subtree): typing in the same paragraph → **0** records (pre-fix: >0); updating `command`/`displayText` via setNodeMarkup → records observed and content correct, including the `[cite]` empty-pill flip (:259-263) both directions.

#### B4 — Placeholder: caret-scoped replacement (main surface)

**Verified config** (src/lib/editor-extensions.ts:1893-1899): main-surface-only, `placeholder: "Start writing..."`, all other options default — `showOnlyWhenEditable: true`, `showOnlyCurrent: true`, `includeChildren: false`, classes `is-empty`/`is-editor-empty`, attr `data-placeholder`. The stock plugin (node_modules/@tiptap/extensions dist) runs `doc.descendants` in its `decorations` PROPS on every state read plus `editor.isEmpty` — O(top-level blocks)+ per transaction, invisible to all three guardrail greps.

**Design:** new `src/lib/tiptap/caret-placeholder.ts` exporting `CaretPlaceholder` (options: `placeholder: string`), swapped in at editor-extensions.ts:1895 (flag `virgil:caret-placeholder`, default ON, `"off"` ⇒ stock extension retained in the extension list builder as the fallback branch). Plugin `props.decorations(state)`:
1. `if (!editor.isEditable) return null` (showOnlyWhenEditable parity).
2. `const $a = state.selection.$anchor; const parent = $a.parent;` — if `!parent.isTextblock` return null (NodeSelection etc.; stock also decorates nothing there under showOnlyCurrent since only the anchor block is eligible — pin this).
3. If parent non-empty → null. Emptiness via `@tiptap/core`'s `isNodeEmpty` if exported, else an equivalent local predicate pinned against the stock one in the test.
4. Only when the anchor block is empty, compute `isEmptyDoc` (tiptap's `editor.isEmpty` equivalent) — gated so the O(doc-ish) check never runs on ordinary typing.
5. Emit ONE `Decoration.node($a.before($a.depth === 0 ? 1 : 1)...` — precisely: pos of the TOP-of-textblock via `$a.before($a.depth)` … resolve the textblock's own depth (the anchor's parent), classes `is-empty` (+ `is-editor-empty` when empty doc), attr `data-placeholder` = the option. `DecorationSet.create(doc, [deco])`.

Cost: O(depth) resolve + O(anchor-block children) emptiness, and the block is empty in the decorating case — effectively O(depth)/transaction.

**Parity pins** (`src/lib/tiptap/__tests__/caret-placeholder.test.ts`, driving stock and replacement against the same docs):
(1) empty doc → sole paragraph carries `is-empty is-editor-empty` + `data-placeholder="Start writing..."` (with the default at-start selection, i.e. regardless of focus); (2) non-empty doc, caret in an empty paragraph → that paragraph `is-empty` only; (3) caret in a non-empty paragraph → zero decorations; (4) OTHER empty paragraphs not at the caret → undecorated (showOnlyCurrent parity — the stock behavior, pinned so nobody "fixes" it); (5) `editable: false` → none; (6) empty heading at caret → decorated (any textblock, as stock). Cost leg: spy on `Node.prototype.descendants` — typing in a 200-block doc, the placeholder plugin contributes 0 doc-walks (the stock contributes 1/transaction — the pre-fix leg). CSS contract: grep globals.css for the `.is-empty`/`data-placeholder` selectors and pin the class/attr names the plugin emits against them.

RichTextField's stock Placeholder (src/components/RichTextField.tsx:307) is deliberately retained — card bodies are small docs; recorded in D's third-party allowlist.

---

### C. Hygiene

#### C1 — figure rasterCache: prune on doc close + LRU cap

**Verified:** `rasterCache` (src/hooks/useResolvedFigureUrl.ts:59) holds decoded Blobs keyed `docId\0source`, populated at :232, deleted only in `refresh()` (:264) — never on doc close; entries accumulate for the session. `urlCache` (:93) is already refcounted and revokes at 0 (:114-120) — no leak there (on true unmount every consumer releases). The doc-close hook exists: `pruneDocMaps` (src/components/EditorLayout.tsx:853-871), fired by DocKeepAliveSlot on TRUE unmount only (:850-852), already calls `disposeCardStore` — the exact seam.

**Design:** extract the raster cache into `src/lib/figure-raster-cache.ts` (pure module: `getRaster/setRaster/deleteRaster/pruneDocRasters(docId)/`, LRU cap 48 entries via Map insertion-order with touch-on-get re-insertion; eviction drops the Blob only — it never touches `urlCache`, so an evicted raster costs only the sync-adopt fast path, never a live URL). `useResolvedFigureUrl.ts` imports it (behavior-identical call sites at :170-171, :232, :264). `pruneDocMaps` adds one line: `pruneDocRasters(slotDocId)`.

Tests: `src/lib/__tests__/figure-raster-cache.test.ts` — prune removes doc A's entries and leaves doc B's; cap evicts the least-recently-touched; a get refreshes recency. Wiring leg (the part no unit mount can reach — the stack-capture precedent of reading EditorPane SOURCE): read EditorLayout.tsx and assert the `pruneDocMaps` callback body spells `pruneDocRasters(` — the callback is in a component no unit test mounts.

No flag: pure eviction of a re-derivable cache; failure mode is a re-decode.

#### C2 — SwiftLaTeX engine idle release (flag, DEFAULT OFF)

**Verified:** the engine is a module singleton (`enginePromise`, src/lib/swiftlatex.ts:26) whose wasm linear memory never shrinks after peak; `resetPdfTeXEngine()` (:87-104) closes the worker and nulls the singleton synchronously; `CompileService` already calls it on boot failure (compile-service.ts:153) and in `recover()` (:365-367), and serializes all compiles through `inFlight` (:129-140).

**Design:** in `CompileService`, after every compile settles (the `inFlight` settle), arm/re-arm a single idle timer (default 10 min, module constant beside the timeout budgets at :61). On fire: if no compile is in flight, call `resetPdfTeXEngine(); this.booted = false;`. Gate the whole mechanism on `localStorage["virgil:wasm-idle-release"] === "on"` — **default OFF**. Trade-off, stated: releasing frees the engine's full linear memory (unmeasured — worth a probe before flipping the default; likely 100s of MB after a large compile) at the cost that the next compile pays a cold boot (~6.8s cached Tier B per the P1 offline verification, which also means an OFFLINE re-warm works — the vendored core + write-through cache make release safe without connectivity). Default OFF because the regression (a surprise multi-second compile after lunch) is user-visible and the memory win is unquantified; flipping ON is a one-line soak decision later.

Tests: `src/lib/compile/__tests__/engine-idle-release.test.ts` — `vi.mock("@/lib/swiftlatex")`; fake timers. Flag on: compile → +10min → reset called once; compile → +9min → compile → +9min → no reset (re-arm); a queued compile at fire time suppresses release; after release, the next compile boots (ensureEngine path) and succeeds. Flag off: no timer armed (assert via zero reset calls at +1h).

#### C3 — DiskWatcher / SidecarWatcher: pane-visibility gating (flag, default ON)

**Verified:** both watchers poll ~3s per WARM doc; the only gate is `document.visibilityState` (provider-injected `isHidden`, src/components/editor-layout/contexts/disk-watcher.tsx:170-173, :200-203; consumed at disk-watcher.ts:245-246 "Hidden gate — do nothing (do not clear existing state)"). Warm keep-alive docs (up to 3+Reader) poll even while `display:none` — the F2 design kept them polling so a badge detected while warm survives; but the badge and the autosave-pause guard are ACTIVE-doc-only by construction (the provider's `activeDocId` contract, :53-60), so warm-doc detection has no live consumer until reactivation.

**Design** (flag `virgil:watcher-active-only`, default ON, `"off"` reverts; read in the provider):
1. The provider keeps an `activeDocIdRef` updated per render. Each watcher's injected `isHidden` closure becomes `document.hidden || (flag && wDocId !== activeDocIdRef.current)` — zero watcher-API change for the gate itself; the F2 lifecycle (never stop/re-prime on switch, dispose only on leaving the keep-alive set, :236-263) is untouched, so the conflict store and PRIME baseline survive exactly as today.
2. **Immediate poll on re-show:** both watcher interfaces gain a public `pollNow(): void` (the internal function already exists — disk-watcher.ts:244; sidecar twin) and the provider's existing start-effects (:217-224, :229-234) gain an else-branch: on an active-doc switch to an already-started watcher, call `watcher.pollNow()` + `sidecarWatcher.pollNow()`. Detection latency for a warm doc's out-of-band change moves from "while hidden" to "one poll after reactivation" — behaviorally invisible except in the sub-second window, since nothing renders warm-doc state.
3. `primed` semantics are safe by construction: a gated poll returns before the prime branch, and the prime runs on the first ACTIVE poll — same as a hidden-tab open today.

Tests: `src/lib/__tests__/watcher-pane-visibility.test.ts` — drive `createDiskWatcher`/`createSidecarWatcher` directly with an injectable `isHidden` fake standing in for the composed closure: gated ⇒ zero `statFiles` calls across N ticks; flip + `pollNow()` ⇒ immediate stat + a change detected that landed while gated (nothing lost, only deferred); conflict state persists across a gate/ungate cycle. Provider wiring leg: jsdom render of `DiskWatcherProvider` with mocked `@/lib/storage`, two liveDocIds, assert only the active doc's `statFiles` fire and that a docId prop flip triggers exactly one immediate poll for the newly-active doc.

AGENTS lockstep: the "Wall-clock services are exempt" DiskWatcher paragraph gains the pane-visibility sentence + flag name (prose and code move together).

---

### D. Guardrail extension: the decoration-prop census

**Blind spot confirmed:** all three existing greps census `editor.on(...)` call forms, ResizeObserver/MutationObserver constructors, and resize listeners. A ProseMirror `PluginSpec.props.decorations` that walks the doc per transaction (the stock Placeholder) matches none of them.

**New file** `src/lib/__tests__/decoration-prop-guardrail.test.ts` (its own file — keystroke-subscriber-guardrail censuses a different call form and is already large; same discipline, same `[cost:]` tag convention with the tag-format leg pane-drag-guardrail enforces via its ALLOWLISTS registry):
- **Needle:** `/\bdecorations\s*[:(]/` over comments-stripped source (`commentsStripped` from _source-scan.ts — focus-view.ts:26-29 and section-folding.ts prose would otherwise false-hit; string literals kept, no known hazard either way). **Roots: all of `src/` AND `library/`** (focus-view and section-folding live in src/lib, not src/lib/tiptap — a tiptap-only scan would miss two of the six). CodeMirror's facet form (`EditorView.decorations.from(f)`, src/lib/code-band.ts:45) does not match the needle (next char is `.`) — stated in the suite header, not silently lucky.
- **Allowlist `PERMITTED_DECORATION_PROPS`** (file → justification), shipping COMPLETE from the verified census (exactly six sites today, seven post-B4):
  1. `src/lib/tiptap/anchor-highlight-deco.ts` (:186) — `[cost: O(1)/call — returns the plugin-state cached set; rebuilt only on its own meta tx, mapped otherwise]`
  2. `src/lib/tiptap/transient-highlight.ts` (:185) — same shape, same tag.
  3. `src/lib/tiptap/pgmark.ts` (:198) — `[cost: O(1)/call cached set; apply rebuild gated on changedRegionTouchesPgmark — O(changed region) scan]`
  4. `src/lib/tiptap/latex-command.ts` (:291) — `[cost: O(1)/call cached set; apply is splice-scoped O(touched textblocks) (B2), full rebuild only behind the virgil:latexcmd-splice kill-switch or on resolution failure]`
  5. `src/lib/focus-view.ts` (:279) — `[cost: O(1)/call cached set (the explicit anti-pattern departure its own comment records)]`
  6. `src/lib/section-folding.ts` (:263) — `[cost: O(1)/call cached set; rebuild on fold-meta/structural triggers only]`
  7. `src/lib/tiptap/caret-placeholder.ts` (new, B4) — `[cost: O(depth)/call + O(anchor block) emptiness only when the anchor block is empty; never a doc walk]`
- **Third-party leg** (the census cannot read node_modules): grep both silos for imports of `@tiptap/extension-placeholder` and the named `Placeholder` import from `@tiptap/extensions`; every hit must be on `PERMITTED_THIRD_PARTY_DECORATION_EXTENSIONS` — sole entry `src/components/RichTextField.tsx` `[cost: O(card-doc)/tx — stock Placeholder on small card-body docs; the MAIN surface uses caret-placeholder]`. `src/lib/editor-extensions.ts` appears ONLY while the B4 fallback branch exists and its entry must name the flag; when the stock path is deleted post-soak the entry is removed (set shrinks).
- Standard legs mirrored from the siblings: unlisted hit fails with the migrate-or-justify message; stale allowlist entry (file no longer matches) fails; `[cost:` prefix mandatory on every justification; a synthetic-fixture swallow self-check for the stripper (never a canary standing on a live line).

**AGENTS.md lockstep (one commit with the test):** add a short paragraph under the keystroke-sanctity law — "Plugin `decorations` props run on every transaction and are invisible to the editor.on census; every one in either silo is on `PERMITTED_DECORATION_PROPS` in decoration-prop-guardrail.test.ts with a `[cost:]` tag, and third-party decoration-bearing extensions are censused by import" — plus the allowlist mirrored in prose per the list-and-prose-in-lockstep rule.

---

### Stage ordering & dependencies

A1 → A2/A3 (identity fix first so leaf hooks are re-render-correct the moment they gain consumers); A3a (lint) is independent of A3b (EditorLayout) — land separately; B1–B4 independent of A and of each other; D lands WITH B4 (the census must ship knowing the placeholder answer, and B4's new file is on its initial allowlist); C1–C3 independent. Nothing here blocks on the scheduler/autosave section; the two meet only at pipeline.ts (A1 touches `runTierB` internals — coordinate the merge) and at `requestLowPriority` (owned there, read-only here).

### Verification floor (whole section)

Existing invariants that must stay green untouched: `__virgilBusStats()` emit/materialize deltas 0 while typing; keystroke-subscriber, editor-observer, scroll-reposition, decoration-probe-cost censuses; expex/roundtrip suites; targeted runs only (`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`, `vi.mock("@/lib/storage")` for anything reaching the storage barrel — pipeline, useDocument, provider tests). Acceptance mapping to the study targets: A removes the two per-pause whole-pane renders and the shell render (Profiler legs are the pin); B removes the per-keystroke O(doc) carve-outs (cost legs are the pin); the paced≈burst end-to-end measurement itself is the study harness's job, not a CI assertion (a wall-clock CI assertion is a flaky test wearing a guard's clothes — the task-337 rule).

## RISKS
- A3a changes what bytes the diagnostics maps read (last-LINTED text instead of live sourceText): compile-error snippets/paragraph jumps can be one lint generation stale for <1.5s after an edit — display-only, pinned as intended behavior, but it is a real behavior delta to sign off.
- A3b replaces extractHeadings-derived divider levels with DocStructureBus heading levels; if extractHeadings' level semantics differ on any edge (doc title / par-title rows), dividerClassName could change — the parity leg is designed to catch it, and the fallback design (bus-gated event-read into extractHeadings) is pre-stated, but it is the one A-stage without a dedicated kill-switch.
- B1 makes expex numbering depend on the structure index's completeness for nested exampleBlocks; the Examples panel already carries that dependency and the nodeAt mismatch check fails open to the legacy walk, but an example the index silently MISSES (no entry at all) would be skipped by numbering with no detector — mitigated only by the parity suite's nested fixtures and the kill-switch.
- B2's splice must stay byte-equivalent to the full rebuild across every edit shape; the shared decorateBlock makes divergence structurally hard, but ReplaceAroundStep gap regions (per the block-uuid-backfill lesson) are the class most likely to surface an unmapped unit — the parity legs include split/join/wrap shapes for exactly this reason.
- B3 ships without a kill-switch (recorded decision): a wrong equality definition means a stale-rendered atom; both directions are test-pinned, but any future attr added to math/citation rendering must be added to the equality set — the tests pin today's input sets, not tomorrow's.
- C3 changes the F2 warm-watcher contract (detection deferred to reactivation): if any current or future surface renders WARM-doc conflict state (per-tab badges), it would go stale while warm — verified none exists today (active-doc-only by the provider's own contract), flag "off" reverts.
- C2's memory win is unmeasured; the design ships default OFF specifically because the cost (surprise cold compile) is user-visible while the benefit is unquantified.
- Cross-section merge risk: A1 edits pipeline.runTierB and the scheduler section edits the same function's scheduling envelope — the two branches must be merged deliberately, not mechanically.
- EditorPane/EditorLayout are the two files Gabriel most often has live edits in (shared checkout): every A-stage touching them should land as small, separately-revertable commits.

## OPEN QUESTIONS
- C2 wasm idle release: confirm default OFF + the 10-minute constant, or ask for a memory probe first (the win is unmeasured; the regression is a visible cold compile).
- A3 WordCount selection counts move into WordCountPanel: selection tallies will only be computed while the panel is mounted (today they compute always). Confirm no product expectation of selection counts surfacing elsewhere (e.g. a future status-bar counter) before the hook call moves.
- A3b: accept the no-flag conversion of dividerClassName to bus-derived heading levels on the strength of the parity leg, or require a virgil:* switch for it too?
- B3 no-kill-switch decision for the math/citation bails: confirm, or direct a shared virgil:atom-update-bail flag.
- C3: confirm the F2-contract renegotiation (warm-doc external-change detection deferred to reactivation + immediate poll) — this is a deliberate product-behavior call, not just perf.
- D scope: the third-party leg censuses only the Placeholder imports today; should it pre-emptively census ALL @tiptap extension imports against a known-decoration-bearing list (broader, noisier), or stay Placeholder-only until a second third-party decoration extension ships?

---

# Appendix D — Process section (SUPERSEDED by §1–§7 where marked: S0 deleted, S1 latch variant struck, §0.4 flag table and §0.5 value table replaced)

## §0 — Wave frame: staging, verification, doctrine lockstep, rollout (Phase 1)

This section frames the whole Phase-1 wave. The other sections own the designs (scheduler module, pipeline integration + dedupe, word-count memo, host split, carve-outs, hygiene); this one owns the order they land in, the proof obligations each stage carries, the AGENTS.md/guardrail lockstep inventory, the live acceptance run, and the rollback story. It is written to be executed with the same loop that ran Waves 0–4: **MEMO_PERF_PROGRAM_HANDOFF.md §3 is the authoritative mechanics SSOT** (worktree protocol, preview quirks, test gotchas, concurrent-main etiquette) and **MEMO_PERF_LOOP_2026_08_09.md** is the iteration/unit format. Anchors below were re-verified at HEAD `0e7f4e60` (2026-08-17); line numbers WILL drift — re-grep at implementation time.

### 0.1 Stage sequence

**Worktree:** `EnterWorktree` name **`perf-phase1`** (branches from origin/main → immediately `git merge main --no-edit`; local main is far ahead and unpushed). One worktree for the whole wave; **one commit per stage**; `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx tsc --noEmit` + targeted `npx vitest run <paths>` per stage; full `npx vitest run` (~25s, 6,900+ tests) before the final `--no-ff` merge to local main, after re-merging the moved main into the branch. Never `git add -A`/`-u` (explicit paths; check `git status` for the Next-auto-written `tsconfig.json` include every time a dev server ran — it is ALREADY dirty in the main checkout, leave it). The live checkout is shared: Gabriel drives it and a `raw-declare-345` task worktree exists — preserve both; no dev servers or builds in the MAIN checkout, only in the worktree (fresh port 3500+, `NEXT_DIST_DIR=.next-preview-p1`, gitignored launch.json entry, `virgil-data` symlink; remove both at cleanup).

If the wave is interrupted mid-sequence, everything merged so far must be self-consistent — that is what the shippability column below is for.

| # | Stage (commit) | Contents | Depends on | Ships alone? | Size |
|---|---|---|---|---|---|
| **S0** | *(no commit)* micro-bench | jsdom harness over the REAL plugins at 3k blocks with realistic density: expex two-walk (`src/lib/tiptap/expex.ts` appendTransaction ~:1814, walks ~:1917/:1949), latex-command touched-path rebuild (`src/lib/tiptap/latex-command.ts` `buildDecorations` :194, `apply` :243–:287), Placeholder full-doc walk, math/citation `update()` fire frequency (`src/lib/tiptap/math.ts` :141–:147, `src/lib/tiptap/citation.ts` :322). Output = a ranking table appended to MEMO_TYPING_LAG_STUDY_2026_08_17.md. **Harness lives in the session scratchpad and is DELETED, not committed** — task 337's rule: a wall-clock assertion in CI is a flaky test wearing a guard's clothes; record the harness recipe in the memo so it is regenerable. | — | n/a (no code) | ~2h |
| **S1** | scheduler module | `scheduleWhenQuiet(siteId, fn, {maxStalenessMs})` per the scheduler section — quiet = no keydown in ~150ms, re-check at fire time, fixed settle order (products → panels → save), hard staleness cap so typing can never starve a task forever. Rides input-modality's EXISTING refcounted document keydown listener (`src/lib/input-modality.ts` :102) extended with a last-keydown timestamp — do NOT add a second document keydown listener. Probe `__quietSchedStats()` (per-site {deferred, fired, staleFires}). Flag read `virgil:quiet-sched` (see §0.4). Unit suite in fake timers: defer/fire/staleness-cap/re-check-at-fire/settle-order legs. | S0 (ranking only) | **YES** — pure addition, zero consumers | S: ~250 LoC + tests |
| **S2** | pipeline integration | Convert doc-products Tier A/Tier B (`src/lib/doc-products/pipeline.ts` `onUpdate` :226–:239, `scheduleTierB` :218) to the scheduler; **cancel the pending idle callback on typing resume** (today `onUpdate` resets only the Tier A timer); drop the forced 200ms deadline (`src/lib/keep-alive/schedule-low-priority.ts` :16–:18) for typing-deferrable products — either a new `requestWhenQuiet` path or scheduler-owned, per the scheduler section. Convert autosave arming (`src/hooks/useDocument.ts` :373/:420 region) and the lint feed; code-bridge reverse flush (`src/lib/code-pane-bridge.ts` `reverseDebounceMs` :151) quiet-gated with a tight staleness cap (code pane visibly mirrors typing — see §0.5). Flag OFF ⇒ byte-identical legacy clocks. Tests: pipeline suite legs for cancel-on-resume + one-Tier-B-per-quiet-window; useDocument suite leg that the staleness cap forces a save under continuous typing; terminal paths (unmount/pagehide) stay immediate `getJSON` (pin — existing Wave-1 contract). | **S1 — must land together as a pair** (S2 without S1 can't exist; S1 without S2 is inert but fine) | with S1 merged, yes | M: ~200 LoC |
| **S3** | dedupe + parity | One assembly per quiet window shared by Tier B and the save: thread the assembled text/parts into `writeDocBundle` (cold `serializeToLatex` at `src/lib/storage-fsa.ts` :711 becomes the fallback for callers without a pipeline — **required argument or explicit option, never a silent default**; "a defaulted argument is a decision nobody made"); `ensureFresh()` (pipeline.ts :288) skips redundant tier re-runs when a generation counter says nothing changed since last run. **The byte-parity suite lands in this same commit**: shared-assembly bytes === cold `serializeToLatex` bytes over the real sample corpus (samples/annotation-history round-trip fixtures + a doc exercising every serializer branch), and the storage-dev twin (dev preview uses storage-dev, not storage-fsa — Wave-1 gotcha). Flag `virgil:save-shared-assembly` (see §0.4). | S2 | **NO — assembly sharing + parity suite are ONE commit**, and it should not merge before S2 (without the scheduler the "shared" assembly is shared across nothing) | M: ~150 LoC + parity suite |
| **S4** | word-count memo | Per-block WeakMap word counts keyed on the pipeline's identity-stable per-block JSON (the identity contract is already CI-pinned): Tier B's `computeCategoryCounts` and OutlinePanel's `buildPerBlockCounts` (`src/panels/Outline/OutlinePanel.tsx` :1591) both O(changed). Parity leg: memoized totals === cold `computeCategoryCounts`/`buildPerBlockCounts` on a real editor, **through the include-set door** (`includedTotals` — the task-122 SSOT; the census there forbids reducing over the include-set outside the module, so the memo layer must sit UNDER `includedTotals`, not beside it). | S2 (needs the identity-stable JSON publish cadence, which already exists — technically only Wave 1) | YES | S–M: ~120 LoC |
| **S5** | host split | `useDocProductsHost` (`src/lib/doc-products/use-doc-products.ts` :100–:115) split into per-product `useSyncExternalStore` subscriptions at consumer leaves so a Tier A/B publish re-renders only consumers whose product identity changed. Test: profiler-counted renders — a sourceText-only publish must not re-render a docJson consumer (the `<Profiler>` counting idiom from floating-panel-edge-resize). | none (orthogonal) | YES | M: ~150 LoC, touches EditorPane wiring |
| **S6–S9** | carve-outs, one commit each, **ordered by S0's measured ranking** | Default order if S0 is inconclusive (per the study's priors): **(a)** latex-command splice-not-rebuild on the touched path; **(b)** expex appendTransaction driven from the DocStructureBus examples index + scoped re-letter (kills the two full-doc `descendants` walks per in-example keystroke); **(c)** math + citation NodeView `update()` equality bails — compare BEFORE the `Object.assign(node, updated)` (math.ts :146 destroys the old value first; the naive bail reads the destroyed value — the ordering is the whole bug); **(d)** replace stock TipTap Placeholder (configured `src/lib/editor-extensions.ts` :1895) with a caret-scoped plugin, **in the same commit as the new decoration-prop census** (§0.2) — the census is what keeps the next stock plugin from re-entering the same blind spot. Each carve-out ships a defect leg that fails on the pre-fix tree (measured by neutering, the repo's standard) plus behavior-parity pins (renumbering, decoration extents, placeholder visibility rules). | S0 ranking; otherwise independent of S1–S5 | **YES, each** — any subset can merge | S each: 60–150 LoC |
| **S10** | hygiene | Bound/evict `rasterCache` on doc close (`src/hooks/useResolvedFigureUrl.ts` :59 — today deleted only in refresh :264); idle-reset the SwiftLaTeX engine after N quiet minutes (module singleton, linear memory never shrinks); gate DiskWatcher + SidecarWatcher polls on pane visibility as well as `document.hidden` (disk-watcher.ts :419, sidecar-watcher.ts :297 — reuse the keep-alive visibility context; note DiskWatcher's AGENTS.md "wall-clock services are exempt" paragraph gets a one-line update). | none | YES (three independent commits acceptable if any one stalls) | S: ~100 LoC total |
| **S11** | exit audit | Re-run the full guardrail suite; sweep that every allowlist/prose pair moved (checklist in §0.2); run the §0.3 live acceptance; update `typing_latency_fix_status.md` memory + MEMORY.md index line; final merge to local main. | all | — | ~half day incl. live run |

**Merge policy:** S1+S2 merge together (one `--no-ff` merge after both commits are green against the re-merged main); everything after can merge with the wave or, if the wave stalls, be cherry-picked in stage order — the table's dependency column is the truth. Full suite runs at every merge to local main, not just per stage.

### 0.2 Doctrine lockstep inventory

**The rule (non-negotiable, CI-enforced):** every allowlist edit and its AGENTS.md prose twin move **in the same commit** as the code that makes them true. The guardrail tests are exact-set — the commit that changes a subscriber file without its allowlist entry fails CI, but the PROSE half is only enforced by discipline, so this inventory is the checklist.

Per stage:

- **S1 (scheduler):**
  - AGENTS.md **"Keystroke sanctity"** gains a new subsection — proposed title **"The scheduler half: derived work waits for the hands to stop"** — stating the law (every typing-deferrable O(doc) derivation goes through `scheduleWhenQuiet`; quiet = keydown-recency, read off input-modality's ONE device listener; re-check at fire time; hard staleness cap; settle order products → panels → save; the probe is `__quietSchedStats()`). Model it on the modality half's structure: rules earned, probe, CI legs.
  - `src/lib/input-modality.ts` is on no editor-subscriber allowlist (document-level, not `editor.on`) — no allowlist change, but its file-header KEYSTROKE SANCTITY comment (:49) extends to cover the timestamp write (O(1), one store per keydown).
- **S2 (pipeline integration):**
  - **`PERMITTED_KEYSTROKE_SUBSCRIBERS`** (`src/lib/__tests__/keystroke-subscriber-guardrail.test.ts` :79): the `lib/doc-products/pipeline.ts` entry's `[cost:]` justification changes (the deferred body's class is now "quiet-scheduled interactive tier / quiet idle tier", not "300 ms interactive tier or the requestLowPriority idle tier"). The `useDocument.ts` autosaver entry and the `code-pane-bridge.ts` entry likewise (their justifications name the clocks). **The AGENTS.md prose-twin bullets for all three** (the permitted-subscriber list under "Keystroke sanctity") change in the same commit — the guardrail's staleness legs compare justification text, and the doctrine explicitly requires list-and-prose sync.
  - AGENTS.md **"The pause half"** — the Tier-B paragraph currently describes the forced ~200ms `requestIdleCallback` deadline landing mid-burst as the accepted design ("lands, by construction, exactly as the user resumes typing"). That sentence becomes false at S2 and must be rewritten to describe the quiet-scheduled behavior, citing this wave — leaving stale doctrine standing is the failure mode the file itself legislates against.
  - `schedule-low-priority.ts` header comment updated for the split (typing-deferrable vs. genuinely-idle callers).
- **S3 (dedupe):** AGENTS.md "The pause half" note that the ~1MB assembly runs **once** per quiet window shared with the save; storage-fsa save-hygiene bullets (Wave-1 text in the handoff memo, plus any AGENTS.md mention) updated. No allowlist changes (no new subscriber/observer).
- **S4 (word-count memo):** AGENTS.md "Card-source derivation" is **unaffected** (state this in the commit message — the memo keys on per-block JSON identity, exactly the contract that section already pins); the task-122 word-count section gains one sentence: the per-block memo sits under `includedTotals`, and the census still forbids include-set reduces outside the module.
- **S5 (host split):** no guardrail change (useSyncExternalStore isn't censused); update the Wave-1 description of `useDocProductsHost` in AGENTS.md/handoff memo if it names the single-store shape.
- **S9 (Placeholder + census) — the NEW guardrail:** a **decoration-prop census**. Neither `keystroke-subscriber-guardrail` (greps `editor.on`), `editor-observer-guardrail` (greps `new MutationObserver`/`new ResizeObserver`), nor the css guardrail can see a plugin `decorations(state)` prop or an extension's `addProseMirrorPlugins` decoration source — that blindness is how the stock Placeholder walked every top-level block per transaction unguarded. New test `src/lib/__tests__/decoration-prop-guardrail.test.ts`: grep `src/` AND `library/` for the decoration-producing forms (`decorations(` props in `new Plugin({...props`, and `Placeholder`/stock-extension imports from `@tiptap/extension-*` known to carry doc-walking decoration props), allowlist `PERMITTED_DECORATION_PROPS` with `[cost:]`-tagged justifications per the Wave-4 P6 tag convention (tag-format leg included from day one — the tag half's lesson is that an unenforced convention diverges). Expected initial entries: latex-command (post-S6: "rebuilds only the touched region, maps otherwise"), section-folding, transient-highlight, anchor-highlight-deco, the new caret-scoped placeholder, expex's decoration source if any — census the tree at implementation time rather than trusting this list. AGENTS.md "Keystroke sanctity" gains the prose twin (a decoration prop runs per transaction, so it IS a keystroke handler — the selectionUpdate-census precedent verbatim). **Census + Placeholder replacement + allowlist + prose = one commit.**
- **S6/S7/S8 (other carve-outs):** no allowlist membership changes (they alter plugin bodies, not subscriber sets), but any AGENTS.md sentence describing the old behavior (none found for these three at HEAD; re-check) and the new decoration census's latex-command entry (if S9 lands before S6, its entry describes the pre-splice cost honestly and is updated at S6).
- **S10 (hygiene):** AGENTS.md "wall-clock services are exempt" paragraph (DiskWatcher) gains the pane-visibility gate clause; no allowlists.

### 0.3 Verification protocol

**Per stage:** the unit/contract tests named in each stage row (owned by the respective sections), plus `npx tsc --noEmit`. Standing gotchas: any new test whose import chain reaches `@/lib/storage` needs `vi.mock("@/lib/storage", () => ({ readTex: vi.fn(() => Promise.resolve("")) }))` — doc-products reaches it, so S2/S3/S4 suites will; `controller-commit-flush.test.ts` mocks `../hit-test`, so new hit-test exports (none expected this wave) must be added to that mock; fake-timer suites for the scheduler must drive the input-modality timestamp explicitly rather than dispatching real keydowns where jsdom timing is involved.

**Live acceptance run (S11, the study's protocol made a script):**

1. **Build/serve (worktree only):** `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && NEXT_PUBLIC_DEV_STORAGE=true NEXT_DIST_DIR=.next-prod-trace npx next build && npx next start -p 3401`. Prod server build, NOT static export (static can't reach virgil-data — Unit-2 lesson).
2. **Corpus:** `doc_perfhuge` (3,055 blocks) always; **plus the atom-heavy corpus if Phase 2's generator has run by then** (do not build it inside this wave — scope fence §0.6); plus Gabriel's laggy doc if he has shared it (Phase 0, gated).
3. **Instrumentation, injected via console before typing:** wrap `view.dispatch` for per-dispatch ms (the editor handle: the `.ProseMirror` element whose className includes `doc-prose` has `.editor` on it); a `PerformanceObserver` on `longtask` buffered from page load; snapshot `__docProductsStats()`, `__quietSchedStats()`, `__virgilBusStats()`, `__keystrokeStats()` before each condition.
4. **Conditions, each on a FRESH page load** (the study's fresh-page-per-condition discipline — a prior condition's heap/caches contaminate the next): (i) paced — 20 inserts at one per ~650ms–3s so every press's quiet window opens between presses; (ii) burst — 30 back-to-back inserts; (iii) paced with code view open (the bridge surface); (iv) paced with Footnotes panel open + `virgil:card-tiers` ON. Run flags-ON and `virgil:quiet-sched=off` A/B on at least condition (i).
5. **Pass criteria (all at 3k blocks):**
   - paced dispatch p50 within **~2×** burst dispatch p50 (study baseline: 3–10×);
   - **zero** tasks >50ms attributable to the ladder inside the paced window (longtask inventory, cross-named against `__quietSchedStats` site fires);
   - **Tier B runs ≤ 1 per quiet window** (`tierBRuns` delta ≤ presses' quiet-window count) and **`assemblies` delta ≤ 1 per pause** with the save sharing it (S3);
   - burst leaves `__virgilBusStats` emit/materialize deltas **0** (existing law, must not regress);
   - `ensureFreshCalls` during a pause no longer implies tier re-runs (generation-skip observable in stats);
   - flag-off A/B reproduces the pre-wave ladder (proves the kill-switch is real).
6. **Hidden-tab caveats (carry into the report):** timers throttle to ~1/min after ~5min backgrounded — keep runs short and the tab recently-fronted, or drive Gabriel's real Chrome visibly via claude-in-chrome; RAF is dead in a hidden pane (paint costs invisible — real end-to-end is worse than dispatch-only; say so); Event Timing entries deliver seconds late — collect at session end, never at burst end (Unit-2 pitfall, recorded); note machine load (concurrent agents inflate absolutes; ratios and task inventories are the signal). The dev preview masks FSA-path behavior (`storage-dev` vs `storage-fsa`) — S3's save-sharing claims rest on the parity suite + the prod-server run, and the real-PWA feel check stays **owed to Gabriel, stated as owed, never self-certified**.

### 0.4 Rollout + risk

**Flag matrix** (all read through the existing `perf-feature-flags.ts` / localStorage pattern; exact names owned by the respective sections, defaults proposed here):

| Flag | Default | Covers | `"off"` reverts to |
|---|---|---|---|
| `virgil:quiet-sched` | **ON** at merge | S2: Tier A/B scheduling, idle-cancel, autosave arming, bridge reverse flush, lint feed | the byte-identical legacy clocks: Tier A 300ms debounce + `requestIdleCallback({timeout:200})` Tier B never cancelled + raw 1500ms autosave + 150ms bridge. Legacy code paths stay present until a post-soak S6-style deletion task (Gabriel-gated). |
| `virgil:save-shared-assembly` | **ON** at merge | S3: threaded assembly into `writeDocBundle`, ensureFresh generation-skip | cold `serializeToLatex` in the save path (pre-wave bytes-for-bytes behavior; the parity suite is what licenses default-ON) |
| `virgil:expex-scoped` | **ON** at merge | S7: bus-driven expex walks + scoped re-letter | the two full-doc `descendants` walks (pre-wave renumbering behavior verbatim) |

Default-ON-with-kill-switch is the Wave-1 `virgil:doc-products` precedent and is chosen deliberately: these paths are scheduling/dedupe changes whose outputs are parity-pinned, and a default-OFF flag never gets soaked (the study's finding #3 — the deployed configuration being the unmitigated one IS one of the three causes). The flags that stay **dark until Gabriel flips them** are the pre-existing `virgil:card-tiers` / `virgil:perf-contain` — this wave does not touch their defaults (§0.6). **No flags** for: S4 word-count memo, S5 host split, S6 latex-command splice, S8 equality bails, S9 placeholder, S10 hygiene — each is small-blast-radius, visibly-failing-or-parity-pinned, and each is one clean `git revert` (one commit per stage is the rollback unit). The decision rule, stated so the implementing sections apply it consistently: a flag where failure would be *silent or content-adjacent* (scheduling starvation, save bytes, renumbering); a revert where failure is *loud and local* (a wrong decoration, a missing placeholder, an extra render).

**Rollback story per stage:** flags give live rollback without a rebuild for S2/S3/S7; every other stage reverts by its single commit (stages were sequenced so no later stage edits an earlier stage's lines except S6 touching S9's census entry — noted there). If a post-merge regression is found on main, revert the stage commit on a fix branch and merge; do not force-push or rewrite the shared main.

**Soak plan:** merge to local main, unpushed, per standing etiquette. Soak = Gabriel's real-PWA sessions with all three new flags ON (their defaults). The wave ADDS to the standing Gabriel-gated list, it does not discharge it: real-PWA feel check (now covering Waves 0–4 + Phase 1), the `virgil:card-tiers`/`virgil:perf-contain` flips, S6 legacy-deletion (which now also covers the quiet-sched legacy clocks), push/release via `/cleanup-virgil`.

**Regression surfaces to watch (each with its pinned test + a soak symptom):**
- **Autosave durability / staleness semantics** — the quiet gate must not let continuous typing outrun the save. Pinned: staleness-cap leg (S2) forces a save under sustained typing within `maxStalenessMs`; terminal unmount/pagehide paths stay immediate. Soak symptom: DiskWatcher external-change badge or disk-ledger anomalies after long typing runs; a crash losing more than ~the cap's window of work.
- **Code-view sync feel** — the reverse flush deferral makes the code pane staler during typing. Pinned: bridge suite legs + tight cap. Soak symptom: visible lag between typing in the visual pane and the code pane updating; Gabriel's call on the cap value.
- **Footnote/example renumber correctness** — S7's scoped re-letter. Pinned: expex suite parity legs (renumber across add/remove/reorder/nested tiers, driven through the real schema — the nested-tier harness lesson: hand-rolled schemas can't build the shapes that break) + `virgil:expex-scoped` off-path. Soak symptom: stale `(1)`/letter labels after edits.
- **Word-count parity** — S4 through the include-set door. Pinned: memo-vs-cold parity on real editors incl. include-set permutations. Soak symptom: panel headline vs. Outline per-section counts disagreeing.
- **Outline responsiveness** — S4+S5 must not make the Outline update *later* than Tier A (cadence unchanged; only the recount cost shrinks). Pinned: profiler leg that a Tier A publish still re-renders the Outline consumer. Soak symptom: outline lagging edits by seconds.
- **Lint arrival** — the feed rides the scheduler; diagnostics should settle once per pause, never vanish. Existing useLatexLint suites + soak eyeball.

### 0.5 Open value decisions (stated so nobody defaults them)

The scheduler section owns final numbers, but these are decisions, not defaults: quiet threshold (~150ms — below the inter-keystroke gap of fast typing, so a burst holds the gate closed); `maxStalenessMs` per site (proposed: products 2,000ms; bridge reverse flush 1,000ms — it is user-visible mirroring; autosave 10,000ms hard cap — durability floor; lint 5,000ms); the settle order (products → panels → save, so the save consumes the shared assembly the same window builds it). Each cap is a REQUIRED argument at the call site — no defaulted staleness.

### 0.6 What this wave does NOT do (scope fence)

- **No windowing, no occlusion decorations, no `content-visibility`** — C1/C2 are Phase 3, decision-gated on Phase-2 traces; cv-auto specifically remains rejected-and-CI-pinned from Unit 2 unless the Phase-2 atom-heavy trace reopens it.
- **No editor-core swap, no doc-model splitting, no canvas** — evaluated and rejected in the study; not revisited here.
- **No doc-shape or saved-byte changes** — S3 is byte-parity-pinned; nothing in this wave may alter `.tex` output, sidecar schemas, or the marker vocabulary.
- **No per-keystroke-path changes beyond the four carve-outs** (S6–S9). In particular: no re-plumb of float-sync (S4-superseded, fix-140), no geometry-service changes, no touching the card-tier machinery.
- **No new corpora** — the atom-heavy + 10k corpora are Phase 2; this wave's acceptance runs on what exists.
- **Phase-0 items that remain Gabriel-gated and are explicitly NOT absorbed here:** the PWA hard-reload / confirm-v0.1.91 check; sharing the laggy document (or its console stats); the 5-question symptom interview; the environment A/B (fresh profile, zoom, spellcheck, IME); flipping `virgil:card-tiers` + `virgil:perf-contain` and the associated soak; the standing real-PWA feel check for the already-merged waves; S6 post-soak legacy deletion; push/release. The plan's checklist should carry these as a visible "waiting on Gabriel" block so an executing loop surfaces them at every iteration end rather than silently attempting them.

### 0.7 Exit criteria (wave-level)

All of: §0.3 pass criteria met on doc_perfhuge; full suite + tsc green on the final merged main; every §0.2 lockstep pair verified moved (grep the allowlists against AGENTS.md prose as a final sweep); `__quietSchedStats`/`__docProductsStats` probes documented in the handoff memo's probe protocol list; memory files updated (`typing_latency_fix_status.md` + MEMORY.md index line); the running list of Gabriel-gated items restated at the end of the final report.

## RISKS
- Autosave staleness: the quiet gate changes save timing semantics — if maxStalenessMs is mis-set or the cap leg is weak, sustained typing could widen the crash-loss window beyond the current ~1.5s; mitigated by a required (non-defaulted) hard cap, terminal-path getJSON pins, and the virgil:quiet-sched kill-switch.
- Byte parity on saved .tex: S3 threads a pipeline-assembled text into writeDocBundle; any divergence from cold serializeToLatex silently corrupts saves — the parity suite must cover BOTH storage backends (dev preview uses storage-dev, masking storage-fsa), and the fallback path must remain reachable for pipeline-less callers.
- Scheduler starvation of the code pane: deferring the 150ms reverse flush makes the code view visibly staler while typing; the 1,000ms cap proposal is a feel judgment only Gabriel can confirm.
- Prose/allowlist drift: three keystroke-subscriber justifications and two AGENTS.md sections change across S2; the guardrail enforces the allowlist half but only discipline enforces the prose — the §0.2 checklist is the mitigation.
- Default-ON flags at merge means regressions reach Gabriel's live sessions immediately; accepted deliberately (a dark flag never soaks — study finding #3), balanced by parity pins and per-stage single-commit reverts.
- Concurrent main: the task pipeline and Gabriel move main continuously; every stage's line anchors will drift and the final merge must absorb main into the branch and re-run the full suite before merging back.
- Hidden-tab acceptance numbers understate real end-to-end latency (no RAF/paint); pass/fail rests on ratios and task inventories, and the real-PWA feel check remains an owed, un-self-certifiable step.
- S0 bench is jsdom, not Chrome, and its ranking could misorder the carve-outs; the stages are independent, so a wrong order costs sequencing time, not correctness.

## OPEN QUESTIONS
- Flag defaults at merge: confirm default-ON for virgil:quiet-sched / virgil:save-shared-assembly / virgil:expex-scoped (the Wave-1 precedent), or default-OFF pending Gabriel's soak — this is Gabriel's risk-posture call.
- Staleness caps: approve or adjust the proposed maxStalenessMs values (products 2,000ms; code-bridge reverse flush 1,000ms; autosave 10,000ms; lint 5,000ms) — the bridge cap especially is a feel judgment.
- Whether the wave should wait for Gabriel's laggy document (Phase 0 item 2) before S0's bench ranking, or proceed on doc_perfhuge priors — the study says accepting that offer is the cheapest decisive measurement, but it is Gabriel-gated.
- Whether S2 also raises the code-bridge reverseDebounceMs (the study's alternative to quiet-gating it) if quiet-gating proves too stale-feeling — orchestrator/scheduler-section call on which mechanism ships first.
- Whether the quiet-sched legacy clocks join the existing S6 post-soak deletion task or get their own — affects how long the pipeline carries two scheduling paths.

---

# Appendix E — Red team + micro-bench detail

## Red-team summary

Red-team review of the four-section Phase-1 draft against HEAD (0e7f4e60). The core architecture is sound and most anchors check out (pipeline.ts, useDocument.ts, use-doc-products.ts, writeDocBundle, bridge/lint hooks, the 6-site decoration census, and the single writeDocBundle production caller all verified). Two blockers: consumers-A1's wordCounts skip condition (`docJson === snapshot.docJson`) is true after every ordinary edit because Tier A refreshes snapshot.docJson before Tier B runs in the same window, so it publishes stale word counts by construction; and the process and scheduler sections mandate mutually exclusive latch mechanisms, where the process variant (ride input-modality's listener) silently dies because that listener is refcount-uninstalled when no modality subscriber is mounted (input-modality.ts:108-152). Seven majors, dominated by cross-section integration conflicts the orchestrator must reconcile: conflicting flag names/inventories (virgil:expex-scoped vs virgil:expex-index-numbering; process declares "no flags" for stages consumers flags), conflicting maxStalenessMs tables (Infinity vs 2000/5000ms), two incompatible redesigns of useLatexLint, three sections editing pipeline.ts with three competing rewrites of the same guardrail justification and an ensureFresh that never cancels scheduler items, the already-delivered bench not propagated into the process section's stage order (S0 is redundant; expex is measured LOW and B1's diagnosis is contradicted by the bench's gate-bail correction), B3's defect legs passing vacuously on HEAD per the draft's own bench, and an acceptance criterion ("no ladder task >50ms") that the plan's own steady state (~65ms Tier B, made worse by the scheduler running Tier A+B in one flush task) cannot meet. Three minors on rung-2 preamble staleness after in-session requirements injection, B4 nested-placeholder parity, and the bench-surfaced latex-command mapped-path scaling that no section owns.

## Findings (each resolved in §3 above)

### [blocker] Consumers §A1 rule 1 ships stale word counts flag-on. The skip condition `docJson === snapshot.docJson && snapshot.wordCounts !== null` is TRUE after every ordinary edit: the pipeline's timer body runs runTierA() (which publishes the NEW docJson into snapshot — pipeline.ts:230-237, :167-174) before scheduleTierB(), so when runTierB's refreshDocJson() returns the identity-preserved object (pipeline.ts:153-165) it equals snapshot.docJson exactly when the doc DID change since the last wordCounts computation. Tier B skips computeCategoryCounts and keeps the pre-edit counts; WordCountPanel/CutterPanel/Outline read stale numbers indefinitely. The identity compare answers 'unchanged since Tier A', not 'unchanged since the counts were computed'.

**Fix adopted:** Re-key the skip on the input the counts were computed FROM: add pipeline state `let wordCountsFor: JSONContent | null = null`, skip only when `docJson === wordCountsFor`, set it whenever counts are recomputed. Or simpler: drop rule 1 entirely — the dedupe section's §4 WeakMap memo already makes computeCategoryCounts O(changed) — and keep only A1 rule 2 (field-compare + keep-previous-reference), which is correct and is what the leaf hooks actually need. Test leg (b) as drafted (edit that changes text but not counts) would catch this at implementation time only if run before the fix is trusted; add an explicit leg: edit that CHANGES counts → wordCounts value updates (not merely 'new object').

### [blocker] The process and scheduler sections mandate mutually exclusive latch mechanisms, and the process variant is defective. Process §0.1 S1: 'Rides input-modality's EXISTING refcounted document keydown listener (input-modality.ts:102) extended with a last-keydown timestamp — do NOT add a second document keydown listener.' Scheduler §1.1 decides the opposite (own always-installed capture listener + a new shared `isPureModifierKeydown` export) with stated reasons. They cannot both be executed. Worse, the process variant silently breaks: input-modality's listener is installed on the FIRST subscribeInputModality subscription and UNINSTALLED with the last (input-modality.ts:94-112, :144-153), so with no pointer-derived chrome mounted the timestamp stops updating, `isQuietNow` reads permanently quiet, and every deferred task lands mid-burst — the original bug returning with no error and the probe still green.

**Fix adopted:** Orchestrator adopts the scheduler section's design verbatim (own listener + shared modifier predicate; the reasons in §1.1 are correct and the refcount hole confirms them). Strike process S1's 'rides input-modality's listener / do NOT add a second listener' directive and replace it with a pointer to scheduler §1.1. Keep the scheduler's one-line input-modality header note naming the second reader of the modifier table (§5.4).

### [major] Consumers §B3's defect legs pass vacuously on HEAD — contradicted by the draft's own bench. The legs claim 'type three characters in the same paragraph → 0 katex.render calls (pre-fix: 3 — this leg fails on HEAD)' and citation 'typing in the same paragraph → 0 records (pre-fix: >0)'. Bench 4 measured the pre-fix tree: ZERO renderMath calls for 10 keystrokes inside a math-bearing paragraph, zero for renumbers and latex-command decoration churn — prosemirror-view reuses the NodeView when the node object and its outer decorations are unchanged. The unconditional renderMath (math.ts:141-152, verified) fires per covered atom per transient-highlight band SET and CLEAR (11+11 for a band over 11 atoms), not per keystroke. As written the plan ships guards that cannot fail on the pre-fix tree — the exact 'unfalsifiable defect leg' shape AGENTS.md legislates against — and B3's stated rationale (per-keystroke cost) is wrong.

**Fix adopted:** Retarget B3's cost legs at the decoration-band path: drive the production setTransientHighlights/clearTransientHighlights over a doc with N math atoms and assert 2N renders pre-fix (measured by neutering the bail) vs 0 post-fix, with a positive-control latex edit → 1 render. Same reshaping for the citation MutationObserver leg. Restate B3's win as 'hover/search/anchor-highlight sweeps over atom-bearing prose', rank it after latex-command and Placeholder, and keep the fix itself (it is still correct and cheap).

### [major] The flag inventories contradict each other across sections. Process §0.4 names the expex flag `virgil:expex-scoped` and declares 'No flags for: S4 word-count memo, S5 host split, S6 latex-command splice, S8 equality bails, S9 placeholder, S10 hygiene'. Consumers defines `virgil:expex-index-numbering` (B1), `virgil:latexcmd-splice` default ON (B2), `virgil:caret-placeholder` default ON (B4), `virgil:watcher-active-only` default ON (C3), and `virgil:wasm-idle-release` default OFF (C2) — five flags the process matrix omits or forbids, plus one flag with two names. Executed as written, the stages would ship whichever section the implementer read first.

**Fix adopted:** Orchestrator produces ONE flag table. Recommend adopting the consumers section's per-item decisions (each carries its argued rationale and its flag-off fallback design) and its names, then rewriting process §0.4's matrix and its 'decision rule' paragraph to match — the rule itself ('flag where failure is silent or content-adjacent; revert where loud and local') actually supports consumers' choices (latexcmd-splice and caret-placeholder failures are decoration/placeholder-visibility deltas that ARE silent-ish at scale, which is why consumers flagged them). One name per flag; AGENTS.md prose lists the final set once.

### [major] The scheduler's staleness/quiet value table and the process section's contradict on the same REQUIRED arguments. Scheduler: products `maxStalenessMs: Infinity` (argued — HEAD's Tier A timer also never fires under continuous typing), lint Infinity, bridge reverse 500ms quiet/1500ms staleness. Process §0.5: products 2,000ms, lint 5,000ms, bridge 1,000ms, presented as 'decisions, not defaults'. Both claim authority; a per-site required argument with two normative tables is exactly the 'decision nobody made' the doctrine forbids, made worse. Additionally process S2's anchor sweeps 'useDocument.ts :373/:420 region' into 'convert autosave arming' — :420 is flushNow, which scheduler §3.5 explicitly exempts from gating (anchor-mint durability).

**Fix adopted:** One table, owned by the scheduler section (its values carry the arguments; Infinity-for-products preserves HEAD's staleness semantics exactly and is the safer first landing — the process values would add deadline fires mid-burst that the probe would then report as regressions). Process §0.5 becomes a pointer plus the open question for Gabriel on the bridge cap only (the one genuinely felt value). Fix the S2 anchor to name debouncedSave (:347-383) only and restate that flushNow/flushPending/saveWithDelimiters/pagehide/beforeunload/unmount stay ungated.

### [major] useLatexLint is redesigned twice, incompatibly, with no cross-reference. Scheduler §4.2 keeps the `text` prop + 1500ms debounce (useLatexLint.ts:36-54, verified) and wraps the timer body in scheduleWhenQuiet, leaving the siteId docId question open. Consumers §A3a rebuilds the hook into product mode (takes `editor`, subscribes imperatively via a new `subscribeSourceText`, returns `{errors, lintedText}`, moves useDiagnostics' maps to lintedText) and abolishes the render-value sourceText the scheduler version assumes still flows. Landed independently in either order, one stage rewrites the other's hook and the quiet-gate wrap can silently fail to survive into the product-mode body.

**Fix adopted:** Orchestrator merges into one design in one stage: A3a's structure (product-mode subscription + lintedText pair) with the scheduler's scheduleWhenQuiet wrap inside the product-mode debounce body (wake → lastTextRef compare → 1500ms debounce → scheduleWhenQuiet(run, {rank: RANK_LINT, maxStalenessMs: per finding 5})). A3a also settles the scheduler's open siteId question: the hook has `editor` in hand, so derive the site suffix from the pipeline's docId (expose it on DocProducts or pass it down) — strike the per-instance-nanoid alternative. Sequence: A3a's stage lands the merged form; scheduler's §4.2 becomes a spec input to it, not a separate landing.

### [major] pipeline.ts is edited by three sections with no merged specification and three competing rewrites of ONE guardrail entry. onUpdate gets scheduler cancels (§2.2) + dedupe's docRevision++ (§1); the timer body is rewritten by the scheduler (§2.1); runTierB gets dedupe's tierB record + lastAssembly AND consumers-A1's wordCounts identity work; ensureFresh gets dedupe's revision skip (§1) AND scheduler cancels (§2.4) — and dedupe's ensureFresh snippet as written clears only `timer`/`cancelIdle` (matching HEAD :291-297), never the pending cancelTierA/cancelTierB scheduler items, so quiet-sched-ON its run path leaves a queued Tier B to fire redundantly after the inline refresh (the exact double-assembly §2.4 exists to prevent). Its skip-branch soundness invariant ('armed timer or pending cancelIdle implies staleness') is also stated over the legacy carriers only and must be re-proved over pending scheduler items. Finally, scheduler §5.1, dedupe §6, and consumers-A's lockstep note each specify a DIFFERENT final text for the same PERMITTED_KEYSTROKE_SUBSCRIBERS `lib/doc-products/pipeline.ts` justification (keystroke-subscriber-guardrail.test.ts:104-105, current text verified) and its AGENTS.md prose twin — whichever stage lands last clobbers the others.

**Fix adopted:** The process section owns a single merged pipeline.ts end-state spec: final onUpdate body (dirty flag + docRevision++ + two O(1) cancels + timer reset, flag-forked), final timer body, final runTierB (tierB record, lastAssembly, wordCountsFor per finding 1), final ensureFresh (cancel timer + cancelIdle + cancelTierA/cancelTierB, then the wantA/wantB skip, invariant restated to cover scheduler items — provable because items are only enqueued after docRevision advanced or preambleEpoch bumped), and ONE final guardrail justification composing all three sections' claims (cost tag naming the flag, the cancels, the counter bump, and the leaf-subscription note). Stage order S2→S3→A1 each lands its slice against that spec; the justification text lands once, at S2, and is amended (not replaced) by S3/A1 in the same commits as their code.

### [major] The bench is already delivered but the process section wasn't updated against it, and consumers §B1's headline diagnosis is contradicted by it. Process S0 schedules a ~2h micro-bench that the draft's own `bench` object has already run (with cleanup confirmed); its 'default order if S0 is inconclusive' puts expex second, while the bench ranks latex-command HIGH (7.3-11.2ms per keystroke while typing any command, 9/9 keystrokes rebuild), Placeholder MEDIUM (0.13ms every transaction at 3k), math/citation MEDIUM-LOW (band-sweep path only), expex LOW — with a diagnosis CORRECTION: the appendTransaction gate bails (~0.003ms, zero walks) for keystrokes inside uuid-bearing exampleItems (the post-343 common case), firing the two walks (0.39ms) only when the caret's nearest anchorable IS the exampleBlock (single-kind body/gloss). Consumers B1 still opens with 'any keystroke INSIDE an exampleBlock then runs TWO full doc.descendants walks' and builds a flag + WeakMap cache + fallback machinery to save 0.39ms in a narrow case.

**Fix adopted:** Delete S0 (or reduce it to a one-condition Chrome spot-check of the latex-command rebuild, the one number jsdom most understates), and hard-code the stage order from the delivered ranking: S6 latex-command → S7 caret-placeholder+census (D) → S8 math/citation band-path bails → S9 expex. Rewrite B1's justification to the corrected diagnosis and downgrade it to an optional tail stage (or cut it from Phase 1 with the bench numbers recorded as the reason) — its complexity (new flag, index-abort fallback, per-example cache) is no longer priced against a per-keystroke cost. Propagate the same correction into MEMO_TYPING_LAG_STUDY's carve-out list when the plan lands.

### [major] The wave's own acceptance criterion is unmeetable as stated, and the scheduler makes the offending task BIGGER. Process §0.3 pass criteria and the brief's targets say 'zero tasks >50ms attributable to the ladder inside the paced window' / 'no ladder task >50ms' — but dedupe's own acceptance paragraph keeps 'one Tier-B assembly (~65 ms)' per quiet window, and the scheduler's flush pass runs Tier A then Tier B back-to-back in ONE task (rank 0 → rank 1 with only a preemption CHECK between, no yield), so the paced condition's longtask inventory will show a ~66-78ms ladder task between every press by design. HEAD at least split them across the 300ms timer task and a separate rIC task.

**Fix adopted:** Two changes, both cheap: (a) the scheduler's flush pass yields between rank items (each item runs in its own macrotask — setTimeout(0) chain — so no single ladder task exceeds the largest item and the preemption check gets a real event-loop turn, which also strengthens the Safari/no-isInputPending story); (b) restate the acceptance criterion to match the study's actual felt-lag mechanism: 'no >50ms ladder task COLLIDING with a press' (paced dispatch p50 ≈ burst p50 remains the primary criterion) plus 'no single ladder task > the largest single tier body (~80ms ceiling)'. If the literal <50ms-any-task target is to survive, someone must own splitting Tier B's assembly tail — which is Phase-2/3 scope and should be fenced as such, not silently failed at S11.

### [minor] Dedupe rung 2 goes permanently dead for the session after any save that injects a new preamble requirement, and T1's 'assemblies delta 0' claim silently degrades. writeDocBundle caches the delimiters of the file it WROTE (post-injection, storage-fsa.ts:762-773) while the pipeline holds the attach-time (pre-injection) preamble and re-reads only on TEX_DELIMITERS_CHANGED (pipeline.ts:266-281) — which plain saves never dispatch. After the first in-session save that injects (e.g. first \includegraphics adding graphicx), rung 2's `assembled.preamble === serializeOpts.preamble` compare mismatches on every subsequent save and rung 3 assembles each time. Byte-correct (rung 3 is the designed fallback) but the 'zero assembly on save' steady-state claim is overstated for exactly the session where the user added a new construct.

**Fix adopted:** State the limitation in the section (it self-heals on reload since the on-disk preamble then carries the packages), and optionally close it: after a write whose extracted written-delimiters differ from what the caller's assembled.preamble claimed, dispatch the existing TEX_DELIMITERS_CHANGED event (or return the written delimiters for the pipeline to adopt) — costing one extra Tier B per injection, restoring rung 2 thereafter. Either way, T1's zero-delta leg should note the precondition (no injection divergence) so a future failure there is diagnosable.

### [minor] Consumers §B4's CaretPlaceholder diverges from stock for a caret in a NESTED empty textblock, and no parity leg covers it. Stock Placeholder with `includeChildren: false` walks only depth-1 nodes (bench-confirmed: cost linear in TOP-LEVEL block count), so for an empty paragraph inside a blockquote/listItem it either decorates the TOP-LEVEL container (if tiptap's isNodeEmpty judges it empty) or nothing — never the nested paragraph. CaretPlaceholder decorates the anchor TEXTBLOCK at any depth, putting `is-empty`/`data-placeholder` on a different DOM node with different CSS consequences. The parity pin list (legs 1-6) has no nested case. Also the deco-position expression in step 5 is garbled (`$a.before($a.depth === 0 ? 1 : 1)` — both arms are 1).

**Fix adopted:** Add a parity leg: caret in an empty paragraph nested in a blockquote and in a listItem, run stock vs replacement, and RECORD the decision at the site (matching stock exactly, or deliberately improving to the nested textblock with the divergence stated and the globals.css selectors checked against it). Fix step 5's expression to the intended `Decoration.node($a.before($a.depth), $a.after($a.depth), …)` for the anchor's parent textblock.

### [minor] The bench surfaced a latex-command cost no section owns: the NO-rebuild mapped path measured 1.4ms per plain keystroke at 3k blocks vs 0.15ms at 1k (DecorationSet.map over 594 decos + per-step changed-region scan + the bounded find, which per AGENTS' own 'stated precisely' note is still linear in decorated top-level blocks). B2's splice fixes only the rebuild path (7-11ms), leaving a doc-scaling ~1.4ms on EVERY keystroke of a command-rich 3k doc from this one plugin — a real slice of the 'clean' keystroke path the study certified.

**Fix adopted:** Add to B2 an explicit implementation-time obligation: profile the mapped path's three components on the B2 harness, and either bound it (e.g. skip the overlap probe when the changed region's ±1 window has no backslash AND no decoration endpoint mapped into it — the probe order may be invertible) or record the measured cost class in the decoration-prop census entry's [cost:] tag so the allowlist justification describes the callback honestly (the float-sync lesson: the tag must cover the callback, not the gate).

## Micro-bench (scratch harness over the real plugins; deleted after; cleanup_confirmed=True)

### expex two-walk cost (per keystroke, caret in an example)

**Measured:** GATE-PASS case (caret in a SINGLE-kind example's direct paragraph): appendTransaction median 0.394ms/keystroke (min 0.245, max 0.686) at 3000 top-level blocks; exactly 2 full-doc doc.descendants calls per keystroke (confirmed empirically via prototype patch), ~12,842 node visits/keystroke. Scaling: 0.036ms/1,287 visits at 303 blocks; 0.138ms/4,322 at 1,010. GATE-BAIL cases: caret inside a MULTI-example's uuid-bearing exampleItem 0.003ms, 0 walks; plain paragraph 0.002ms, 0 walks. CORRECTION to the memo: the gate passes only when the nearest anchorable ancestor is the exampleBlock itself (single-kind body/gloss); typing inside an exampleItem attributes contentChangedUuids to the item (step-inspector.ts nearestAnchorableUuid ~:308) and the gate (expex.ts ~:1831-1862) bails — post-343 docs mint item uuids, so the multi-item case is already cheap at HEAD. End-to-end dispatch: 4.02ms inside single example vs 3.77ms plain at 3k (jsdom).

**Method:** Real Editor mounted with buildEditorExtensions(mainCtx()) (storage vi.mocked per repo gotcha) on a 3,000-top-level-block doc (2,970 uuid'd paragraphs + 30 examples alternating single/multi kind, each with a 3-column aligned gloss + prose gloss row). Wrapped the expexNumbering plugin's spec.appendTransaction (dynamic lookup — works) to time it and, via a scoped Node.prototype.descendants patch counting doc-typed receivers and callback visits, count walks. 15 keystrokes per scenario via view.dispatch(tr.insertText), first 2 discarded, median reported. jsdom, node@22.

### latex-command touched-path rebuild

**Measured:** Full buildDecorations(doc) at 3,001 top-level blocks with 594 decorations (~1 command/10 blocks + example glosses): median 6.00ms (min 5.52, max 7.06); 0.82ms at 1,011 blocks/200 decos — linear in doc. Typing "\citep{x}" char-by-char: 9/9 keystrokes trigger the FULL rebuild (backslash 7.35, c 7.59, i 7.82, t 8.04, e 7.45, p 7.76, { 8.00, x 8.73, } 11.19ms) — every char after the backslash lands inside/adjacent to the existing decoration, so mapped.find(newFrom,newTo) trips the overlap rung and rebuilds. Plain typing in a command-free paragraph: 0/15 rebuilds, but the 'cheap' mapped path itself measured 1.40ms median at 3k blocks vs 0.148ms at 1k (superlinear-looking; includes DecorationSet.map over 594 decos + per-step textBetween) — worth its own look during implementation.

**Method:** Same 3k editor. Full-rebuild timing: called the plugin's spec.state.init(undefined, editor.state) directly (the init closure IS buildDecorations(state.doc)), 12 rounds, median. Rebuild detection: prosemirror-state BINDS spec.state.apply into Configuration FieldDesc at construction, so the wrapper was installed on editor.state.config.fields[latexCmdDecorations$].apply; a rebuild = >=1 doc-level descendants call inside the apply window (tracked via the same prototype patch). Real dispatches, one char per transaction.

### Placeholder plugin per-transaction cost

**Measured:** 0.130ms median per decorations-prop call (min 0.128, max 0.301) at 3,001 top-level blocks; 0.047ms at 1,011; 0.013ms at 304 — linear in TOP-LEVEL block count (includeChildren:false stops the walk at depth 1, so it visits ~3k nodes + isNodeEmpty each, not the full tree). Confirmed exactly 1 invocation per transaction (10 calls across 10 keystrokes). Real but ~50x cheaper than a latex-command rebuild; at 3k blocks it contributes ~0.13ms to EVERY keystroke and every meta-only transaction.

**Method:** Same 3k editor; the real @tiptap/extensions Placeholder as configured by editor-extensions.ts (~:1893-1899, main surface only). Direct timing: plugin.props.decorations.call(plugin, editor.state), 15 rounds, median (props lookup is dynamic so this is the exact production closure, including this.editor.isEmpty). Frequency: swapped plugin.props.decorations for a counting wrapper and dispatched 10 real keystrokes.

### math update() frequency (bail-less renderMath)

**Measured:** Mount: exactly 50 renderMath calls for 50 atoms (1 each). Then ZERO renderMath calls for: 10 keystrokes in a math-adjacent paragraph, 10 keystrokes INSIDE a math-bearing paragraph, a renumber-triggering footnote insert (10 footnotes renumbered via setNodeMarkup), and 4 keystrokes typing "\cmd" in a math-bearing paragraph (latex-command decoration rebuild included). The bail-less update() fires in practice only when an inline decoration SPANNING the atom changes: a transient-highlight band covering 11 atoms cost 11 renders on set + 11 more on clear (22 wasted KaTeX renders per hover/search sweep over math-bearing prose — latex unchanged in every one, so an equality bail zeroes exactly this). Positive control: setNodeMarkup latex edit -> 1 render. CORRECTION to the memo's framing: the unconditional renderMath is NOT a per-keystroke cost — prosemirror-view reuses the NodeView when the node object and its outer decorations are unchanged; its real cost is per-covered-atom per decoration-band change.

**Method:** Separate scratch file: 200-paragraph doc, 50 inlineMath atoms (every 4th paragraph), 10 correctly-numbered footnotes; full real extension stack; katex vi.mock'd to a counter (renderMath calls katex.render 1:1 for non-empty latex; jsdom cannot price a real KaTeX render honestly and the question is frequency, which is prosemirror-view logic and DOM-independent). Edit scripts dispatched as real transactions; band script used the production setTransientHighlights/clearTransientHighlights carrier.

---

# How to start execution

Answer §6 (or accept the defaults by saying "run Phase 1"), then paste into a
NEW session:

```
/loop Read MEMO_PHASE1_QUIET_TYPING_PLAN.md in the Virgil repo root and execute
exactly ONE stage (P1..P14) per iteration, in table order, per the §4 stage
sequence and the standing worktree protocol in MEMO_PERF_PROGRAM_HANDOFF.md §3
(worktree perf-phase1; one commit per stage; tsc + targeted vitest per stage;
full suite before any merge to local main; allowlists + AGENTS.md prose in the
same commit; never git add -A/-u; preserve foreign worktrees). The §3
arbitration layer overrides the appendices on any conflict. Tick a stage
checklist at the end of each iteration; stop when P14 is merged or a stage is
blocked on Gabriel.
```

Stage checklist (the loop's persistent memory — tick at each merge):

- [ ] P1 scheduler module
- [ ] P2 pipeline integration (merge with P1)
- [ ] P3 autosave quiet gate
- [ ] P4 word-count memo
- [ ] P5 save shared assembly + parity suites
- [ ] P6 bridge quiet-gating
- [ ] P7 lint restructure
- [ ] P8 host split
- [ ] P9 latex-command splice
- [ ] P10 expex index numbering
- [ ] P11 caret placeholder + decoration census
- [ ] P12 math/citation bails
- [ ] P13 hygiene (C1/C2/C3)
- [ ] P14 exit audit + live acceptance + merge
