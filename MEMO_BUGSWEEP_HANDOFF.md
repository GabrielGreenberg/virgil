# Handoff: work through the 2026-06-26 bug-catcher sweep (7 items)

This is a kickoff prompt for a fresh **ultramode (ultracode) manager** session. A bug-catcher session diagnosed 7 items and recorded a `ROOT-CAUSE-FOUND`/`FIX-READY`/`DESIGN-READY` spec for each (file:line, deep fix, traps, tests). Your job is to implement them.

---

## Operating instructions

- **You are an ultramode manager session.** Use **Workflows liberally** to preserve the longevity of your context — fan the heavy reading/design/verification out to subagents; keep the manager loop thin.
- **Work in a worktree.** Create ONE fresh worktree off `main` for this sweep (do not disturb existing worktrees: `in-card-chrome-strip`, `omni-dim-resting`, etc.). Land each fix as its own commit on the worktree branch. **Do not push or merge** unless explicitly asked.
- **Make a detailed plan FIRST** (use EnterPlanMode / a Plan agent). Read every memo below before planning. Surface the sequencing + the open decisions (see "Decisions to surface") in the plan and get sign-off before large work.

### (CENTRAL DESIGN PRINCIPLE)
> I want **unified, deep, architectural solutions that capture a range of related phenomena** — avoid superficial, surgical patches. Whenever reasonable, consider the deepest possible solution to the problem that will also improve the app.

**Refinement (learned this sweep, item #5):** "deep" ≠ "broadest blast radius." Match the fix to the *true scope* of the phenomenon — a bug can arise from one component's distinctiveness, in which case the correctly-scoped deep fix is component/archetype-specific, not global. Verify a phenomenon is actually general before generalizing the fix.

---

## Critical operational guardrails (read before any edit)

- **Concurrent shared checkout:** Gabriel may be driving the SAME checkout live while you run. Verify `git -C <worktree> rev-parse HEAD` / main tip before writes; preserve foreign branches; never sweep untracked files; never `git add -A` (use explicit `git add <paths>`). One `git` call per Bash invocation (don't chain with `&&`); prefer `git -C <path>`.
- **⚠️ Workflow subagents edit the MAIN cwd, NOT the worktree.** If you delegate *edits* to a Workflow subagent, they will land in the main repo, not your worktree. So: do file edits from the **manager loop** (or pass subagents absolute worktree paths and verify), and reserve Workflow subagents for **read/design/verify** fan-out. Confirm `pwd`/paths after any subagent edit.
- **`main` is far ahead of `origin` and unpushed** (large local stack). Branch off local `main`; don't rebase/push it.
- **Verification:** `tsc` (0 errors) + `vitest` must stay green; run them per fix. Items flagged "live feel-check" need the dev preview — load the dev doc (`virgil-data/doc_devtest`; the preview FSA picker is dead in the iframe), set `localStorage['virgil:force-dev-storage']='1'` if "No document open", resize the iframe (0×0 default breaks hover math), and restart the preview if chunks look stale. Margin/anchor-durability bugs mask in dev preview — verify those via unit tests, not the preview.

---

## The work — 7 items (each has a self-contained memo)

Running backlog index: [MEMO_BUG_BACKLOG.md](MEMO_BUG_BACKLOG.md) (these 7 are the tail entries; the file also carries older drained items above them).

1. **`\ex` / bridge-routed commands silently no-op (or hit the wrong doc) under multi-doc keep-alive** — `ROOT-CAUSE-FOUND`/`FIX-READY` — [MEMO_VIRGIL_CMD_BRIDGE_MULTIPANE.md](MEMO_VIRGIL_CMD_BRIDGE_MULTIPANE.md)
   The editor-actions bridge is a single-slot module cell ("exactly one editor mounted") that keep-alive (default ON, capacity 3) falsified. Deep fix: registry keyed by editor view + resolve the active handle via the EXISTING `pickProbeEditor` (focused→visible→single) in `active-editor-probe.ts`. **Foundational** — #6 depends on it, and it's the same class as #4's `findRowScroll`.

2. **Panel bottom chrome: hide the drag lozenge at rest + shorten the under-panel fade to a rim/shadow** — `FIX-READY` (live-tune) — backlog entry in [MEMO_BUG_BACKLOG.md](MEMO_BUG_BACKLOG.md)
   `.drag-gap-h.band-grip::before` resting `opacity 0.9→0`; shorten the lone-band fade (`height:22`) / ColumnEdgeFade ramp. Lightest item; needs a live feel-check. Minor open question: literal shadow vs short manilla fade (decide live).

3. **Include footnote cards in per-card archiving (+ Footnotes-panel Archives view)** — `ROOT-CAUSE-FOUND`/`DESIGN-READY` (hardened) — [MEMO_FOOTNOTE_ARCHIVE.md](MEMO_FOOTNOTE_ARCHIVE.md)
   Largest item. It's a missing render path, not a missing model — make the Footnotes panel ref-backed like Citations. **MUST HEED the adversarial corrections:** the flag-ON `inline-atom-lifecycle-policy` orphan double-creation (the load-bearing miss), the false "ids regenerate" premise, mount-only `syncFromEditor`, external-edit data-loss, keep-alive docId-scoping. Implement the corrected spec, not the original design.

4. **Clicking a panel card yanks the doc to its anchor (whole card cluster)** — `ROOT-CAUSE-FOUND` + **PRODUCT FORK** — [MEMO_CARD_CLICK_JUMP_DECOUPLE.md](MEMO_CARD_CLICK_JUMP_DECOUPLE.md)
   `useAnchoredCard.onBodyActivate` fuses select+jump. Recommended deep fix (a): decouple select from scroll + promote the jump chevron to docked/omni (mandatory companion). **This reverses a tested contract (C15) — flag for sign-off.** Also fix the independent latent multi-pane `findRowScroll` bug here (shared SSOT with #1).

5. **Clicking an Outline section arms the panel-move drag (blue halo) instead of jumping** — `ROOT-CAUSE-FOUND`/`FIX-READY` (re-scoped) — [MEMO_OUTLINE_PANEL_DRAG.md](MEMO_OUTLINE_PANEL_DRAG.md)
   Outline is the only content-bodied docked panel; the whole-body window-drag model is card-panel-specific. Fix at the `Panel` boundary: content (`variant="raw"`) body `[data-no-window-drag]`, header stays the drag handle. Covers `{Outline, Search}`; leaves card panels untouched. (The general FloatingPanel threshold is demoted to optional polish — don't bundle.)

6. **Add `\list`/`\itemize`/`\enumerate`/`\quote`/`\quotation` slash commands** — `FIX-READY` (exact code) — [MEMO_VIRGIL_SLASH_COMMANDS.md](MEMO_VIRGIL_SLASH_COMMANDS.md)
   5 entries in `commands.ts` routing to existing registry rows. **Trap:** must route through the **bridge** (`runAction`), not `runViewOnlyAction` (the list/quote rows need `editor.chain()`). **Depends on #1** — do it after the bridge fix.

7. **Focus band drag stops at a section's header instead of its end** — `ROOT-CAUSE-FOUND`/`FIX-READY` — [MEMO_FOCUS_BAND_SECTION_END.md](MEMO_FOCUS_BAND_SECTION_END.md)
   `snapBoundary` is row-raw; make it section-aware via the same `regionForNode` (edge-asymmetric: bottom-on-heading → `sectionRange.end`). Low risk — the visual `measure()` already absorbs it (no jump).

---

## The deep cross-cutting theme (lean into this — it's the unified solution the principle wants)

**Items #1 and #4 are the same architectural class:** a module-level *"exactly one editor / one row-scroll mounted"* assumption that multi-doc keep-alive (N `display:none` panes) silently falsified. #1 = the editor-actions bridge's single-slot cell; #4 = `findRowScroll()`'s `document.querySelector('[data-virgil-row-scroll]')` grabbing the first DOM match. The codebase **already has the right resolver** — `pickProbeEditor` (focused→visible→single) in `src/lib/active-editor-probe.ts`, used only by the dev probes.

**Recommended deep move:** establish ONE *pane/active-surface resolver SSOT* and route both the bridge handle lookup (#1) and the row-scroll lookup (#4) through it. That single unification fixes #1, the latent half of #4, and unblocks #6 — exactly the "capture the cluster, improve the app" shape. Surface this as the spine of your plan.

## Suggested sequencing

1. **Plan + worktree + read all memos.** Verify main tip.
2. **#1 + the #4 `findRowScroll` half** — the pane-resolver SSOT (foundational; unblocks #6, half of #4).
3. **#6** slash commands (trivial once the bridge is sane).
4. **#4** card-jump decouple (the select/scroll half) — *flag the C15 reversal for sign-off before merging*.
5. **#7** focus band section-end; **#5** outline panel drag — independent, can be parallel implement→verify workflows.
6. **#3** footnote archiving — the big one; heed the adversarial corrections; heaviest testing.
7. **#2** panel chrome polish — live feel-check; do whenever (lightest).

## Decisions to surface to the user (don't unilaterally pick the irreversible ones)

- **#4** — full decouple reverses the tested C15 select→jump contract. Recommend (a) full decouple + chevron promotion; confirm before merge. (#4's memo also records option (c) off-screen-only.)
- **#3** — large, deep lifecycle change; confirm appetite/scope before committing the full ref-backed panel + policy suppress-seam.
- **#2** — literal shadow vs short manilla fade — decide at the live feel-check.

When done with each item, update its status marker in the memo + the backlog pointer, and report a concise per-item result (what landed, tsc/vitest status, what was live-verified, what's owed). Do not push or release unless asked. End your summary with **Done.**
