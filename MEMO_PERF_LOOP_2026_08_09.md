# Perf-program LOOP handoff — residuals + Waves 3–4

**Written:** 2026-08-09, after the Wave-2 merge (`1aa8581e`). **For:** a fresh
session running this as a `/loop` frame. One iteration = ONE unit from the
backlog below, taken through the full worktree→verify→merge→record cycle, then
end the iteration. Self-pace with long wakeups; STOP the loop when every unit
is done or gated.

## Read these before the first unit (state + mechanics SSOT)

1. `MEMO_PERF_PROGRAM_HANDOFF.md` (repo root) — program state, the per-wave
   worktree workflow, preview/CDP quirks, test gotchas, concurrent-main
   etiquette. **Authoritative for mechanics; §"Wave 2 delivered/RESIDUALS"
   is the substrate this backlog builds on.**
2. `~/.claude/plans/ok-can-you-come-cuddly-kahan.md` — the approved wave
   designs (§Wave 2 for C7/C5/C6/C8 details, §Wave 3, §Wave 4) + exit criteria.
3. `MEMO_PERF_DEEP_RESEARCH_2026_08_08.md` — measured causes (line numbers
   drift; re-grep).

**State discovery each iteration:** the checklist below (edit it at every
merge — it is the loop's persistent memory) + `git log --oneline -8` on main
(each unit's merge commit names it). Main moves continuously (the task-pipeline
worker is active; new worktrees appear/disappear under `.claude/worktrees/` —
never touch them).

## Iteration protocol

1. Re-read this memo. Pick the FIRST unchecked, un-gated unit.
2. `EnterWorktree` (name below) — branches from origin/main, so IMMEDIATELY
   `git merge main --no-edit` (local main is ~70 commits ahead, unpushed).
3. Implement per the unit spec + its plan section. One commit per stage;
   `npx tsc --noEmit` + targeted vitest per stage; full `npx vitest run`
   before merge. Node: prefix commands with
   `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
4. Live-verify where the unit is previewable (launch-entry recipe +
   hidden-pane caveats in the handoff memo §3: RAF shimmed via setTimeout,
   timers ~1s ticks, **IO never delivers → geometry near-zone stays empty →
   cached-band paths answer null; verify fallbacks live, cached paths via
   unit tests**).
5. Re-check `git -C /Users/gabriel/Programming/virgil log --oneline -1` —
   main WILL have moved. Merge main INTO the branch, full suite again, then
   `git -C /Users/gabriel/Programming/virgil merge --no-ff <branch> -m "Merge <unit>: …"`.
6. Cleanup: revert the worktree's Next-auto-written `tsconfig.json` include
   (`git checkout -- tsconfig.json` — check EVERY time a dev server ran),
   remove any virgil-data symlink + launch.json entry you added,
   `ExitWorktree remove` (only after `git branch --contains` shows main has
   the tip).
7. Record: tick the checklist HERE; update
   `~/.claude/projects/-Users-gabriel-Programming-virgil/memory/typing_latency_fix_status.md`
   + its MEMORY.md index line at wave-sized merges.
8. End the iteration with a compact running list (unit — merge sha — next
   up). If everything left is gated: stop the loop and say so.

**Rails (non-negotiable):** never `git add -A`/`-u` (explicit paths only);
never push; never write in the main checkout except the final merge + these
memos; preserve foreign worktrees/branches and main's dirty files
(tsconfig.json, library-data, MEMO_*.md are not yours); guardrail allowlists
move in LOCKSTEP with code + AGENTS.md prose in the same commit; new risky
paths get a `virgil:*` kill-switch with the legacy path as automatic fallback
(the wave-2 pattern).

## Backlog (in order)

### ☑ Unit 1 — `perf-wave-2b`: the four wave-2 residual conversions
**DONE 2026-08-09, merged to local main `bd4769ad`** (4 stage commits; full
suite 5,510 green after absorbing fix-163; live-verified in the worktree
preview — frame primes to true edges, bolt/handle placement correct,
blocksAtY-null fallback exercised, 15-keystroke emit/materialize delta 0).
C7 viewport frame on the service + useEditorViewportCache DELETED (RO census:
engine's one observer + editor/scroll els; allowlists in lockstep) +
coordsAtPosCached; C5b approxTopForPos + scroll-idle refinement; C6
active-block.ts (one posAtCoords + snapshot, `virgil:geom-active-block`
kill-switch, pollers gated on hidden+gesture); C8 hit-test rect threaded.
ONE worktree, four stage commits. Plan §Wave 2 has the designs; the geometry
service (`src/lib/editor-geometry/service.ts`) is the substrate.
- **C7 — caret consolidation, then DELETE useEditorViewportCache.** Add a
  service viewport frame (host/scroll rect + `coordsAtPosCached` per-frame
  memo) and move the 4 instantiation sites off the hook: LiftHost
  (`containsContentZone`), TextObjectGrabHandle (`containsHoverZone`,
  scrollTop/Bottom cull, `computePlacement` reads), PendingChangePill,
  SelectionActionsMenu. Delete `src/hooks/useEditorViewportCache.ts` +
  its RO-census/resize-census allowlist entries (+ prose). Exit: RO census
  ~2 per pane (was 8+); suites for all four consumers green.
- **C5b — out-of-zone anchors.** `useInTextPositions`: out-of-zone items get
  `approxTopForPos` (derive from the service's snapshot/near-zone edges)
  instead of per-item `coordsAtPos` — today the coordsAtPos runs for EVERY
  item every pass (only the card-rect read is culled).
- **C6 — getActiveParagraphId.** `Editor.tsx:~1422` (up to 3 full
  doc-walks × coordsAtPos) → resolve via ONE `posAtCoords` at the viewport
  reference + the structure snapshot (the `computeSectionPathAt` pattern).
  Also gate its callers' bare 2s `setInterval`s (EditorLayout ~:1611,
  reader-view-prefs ~:202) on visibility + `isLayoutGestureActive`.
- **C8 — drop-mode downstream reads.** The per-move hit-test reads the same
  block rect 2-3× (`hit-test.ts:103` then placement builders) — pass the
  rect through instead of re-reading; leave the throttle/equality bails
  alone. Do NOT read the parked geometry service mid-drag.

### ☑ Unit 2 — visible-window baseline trace (gates Wave-4 Stage B)
**DONE 2026-08-09, findings committed `docs/perf/style-invalidation-findings.md`**
(real Chrome foreground, prod SERVER build w/ dev storage — a static export
can't reach virgil-data; deviation documented). Headline: clean typing at
2,883 blocks = zero ≥16ms presses/LoAF/longtasks; residuals = settle-tail
cluster (typing-through p50 80ms/max 304ms) + doc-open worst task 5.44s
(total 8.06s, was 26.2/15.2s). **DECISION: Wave-4 Stage B cv-auto NOT
justified — skip it; Stage A containment only.** Unit 4's Stage B line is
superseded by this. Pitfall recorded: Event Timing delivers seconds late —
collect at session end, never at burst end.
Rebuild `out/` (`npm run build`, ~1 min), serve via launch entry
`virgil-static` (:3001), open doc_perfhuge in a VISIBLE browser —
claude-in-chrome (Gabriel's real Chrome) if available, else the Browser pane
fronted. 10s scripted typing (~8cps) mid-doc + one drop-mode toggle + one
Enter burst; LoAF + longtask observers; per-keystroke recalc/layout ms + top
selectors. Append results to `docs/perf/style-invalidation-findings.md`.
If no visible window is drivable this iteration, record that and move on —
re-attempt before Wave 4.

### ☑ Unit 3 — Wave 3: card presence tiers (`perf-wave-3`)
**DONE 2026-08-10, merged to local main `c436cfad`** (recon via 6-agent
workflow; full suite 5,560 green after absorbing fix-324; LIVE-VERIFIED on
doc_perfhuge: flag ON → census **521 → 1**, peak 1, 360 static borrowed +
160 static example bodies, zero schema refusals, expand → exactly one
rich-text-field, keystroke deltas 0; flag OFF → census exactly 521,
byte-identical legacy). borrowed-render.ts SSOT (refusal-not-blank),
StaticBorrowedText (.tiptap contract, one-shot renderMath), presence.tsx
ramp T0→T1→full, card-near-zone.ts shared-IO per-CARD store (±600px + 2s
dwell — documented deviation from the service-written block-uuid sketch:
the nearness-gated kind is entity-anchored), two switch sites, renegotiated
projection test + 2 new suites, AGENTS.md "Card presence tiers" section.
**Flag default OFF — soak owed before flip-on; near-promotion needs the
visible-window/real-PWA check (hidden pane delivers no IO).**
Plan §Wave 3 in full. T0 summary / T1 static HTML (`renderBorrowedHtml` +
`StaticBorrowedText`, byte-identical schema SSOT via `buildBorrowedAtomSchema`)
/ T2 read-only live / T3 editable. ONE switch site (EditableCard's compressed
borrowed branch); `CardPresenceProvider` + near-zone store WRITTEN BY the
geometry service (its `observed` set is the near-zone; add hysteresis
promote 600px / demote 1200px + 2s dwell); load ramp via `requestLowPriority`;
flag `virgil:card-tiers` default OFF until soak. Renegotiate
`ExampleCardCollapsedProjection.test.tsx`; new `card-presence-tiers.test.tsx`
(far collapsed footnote mounts ZERO .ProseMirror); AGENTS.md "Card presence
tiers" section. Exit: `__editorCensus().total` ≤ 10 + near-zone collapsed
examples on doc_perfhuge (was 881→521 after the print gate).

### ☑ Unit 4 — Wave 4: containment + doctrine (`perf-wave-4`)
**DONE 2026-08-10, merged to local main `17a0e618`** (census via 3-agent
workflow; 5,631 tests + tsc green; LIVE-VERIFIED: body.perf-contain stamps,
324 cards + 324 omni wrappers compute `contain: layout style`, class-off
computes none, keystroke deltas 0). Stage A behind `virgil:perf-contain`
(perf-feature-flags.ts, DEFAULT OFF — soak with card-tiers); **Stage B
cv-auto SKIPPED per Unit 2's decision and CI-pinned absent**
(css-invalidation-guardrail). P6: selectionUpdate census (8 tag-justified
sites + empty library twin), [cost: …] tags CI-enforced on every allowlist,
<VirgilEditor mount census, two stale entries + the reactor-sweep findings
line corrected, AGENTS.md lockstep ("The stylesheet half" section).
Plan §Wave 4. Stage A `contain: layout style` behind `body.perf-contain`
(new perf-feature-flags.ts); **Stage B cv-auto ONLY if Unit 2's trace shows
≥2ms p50/keystroke win — and the zero-artifacts checklist (caret into skipped
content, cross-viewport selection, IME, Cmd+F, fold, print) needs GABRIEL's
eyes: implement flag-off + hand him the checklist, don't self-certify.**
P6: selectionUpdate added to the keystroke guardrail grep (census +
allowlist incl. `useSelectionCounts`); cost-class tags on allowlist
justifications; `css-invalidation-guardrail` (`:has(` count 0 in
globals.css); fix the two stale allowlist claims + the stale line in
docs/perf/reactor-sweep-followup-findings.md:24; AGENTS.md consolidation.

## Gated — surface, never do autonomously
- **S6 post-soak deletion** (legacy doc-products path + `isTier1CDisabled`;
  also the wave-2 legacy fallback walks + `virgil:geom-*` flag retirement):
  needs Gabriel's soak confirmation.
- **Real-PWA feel check** (Waves 0+1+2, now three merged waves unpushed):
  Gabriel's hands. Remind at every iteration end until done. Surfaces to
  poke: typing feel, block drag (auto-scroll + ghost motion), breadcrumb on
  scroll, marginalia markers, PaneFreeze in the Library Reader.
- **Push/release**: `/cleanup-virgil`, Gabriel-triggered only.

## Loop frame (paste into a NEW session)

/loop Read MEMO_PERF_LOOP_2026_08_09.md in the Virgil repo root and execute
exactly ONE backlog unit per its iteration protocol (worktree → implement →
verify → merge to local main → cleanup → tick the checklist). End each
iteration with the compact running list. If every remaining unit is gated on
Gabriel, stop the loop.
