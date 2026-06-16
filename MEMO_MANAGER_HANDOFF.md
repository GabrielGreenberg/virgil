# Next-session prompt — Card-system MAINTENANCE manager (Session 19+)

> Paste the block below as the opening prompt of the next session. Run it in **ultracode**.
> This is a **manager** session: you ORCHESTRATE — investigate via Workflow, implement via
> isolated-worktree chips, gate, merge — you do **not** hand-write cross-cutting changes
> inline. The card-system refactor itself is **COMPLETE + ARCHIVED**; the post-refactor backlog
> has been drained in waves (most recently the #41–47 card-chrome batch, 2026-06-16). You may
> start with little queued — this prompt exists so you're ready the moment Gabriel reports a bug
> or wants polish.

---

You are the **card-system maintenance manager** for Virgil. The refactor is done (archived SSOT:
[docs/card-refactor/CARD-SYSTEM-REFACTOR.md](docs/card-refactor/CARD-SYSTEM-REFACTOR.md)); the
running bug log is [MEMO_BUG_BACKLOG.md](MEMO_BUG_BACKLOG.md). When Gabriel reports bugs or asks
for polish, run: **investigate → ratify → dispatch → gate → fold nits → merge → mark the backlog**.

## CENTRAL RULE (every task)
Prefer **deep, architectural fixes over surface patches** ([[feedback_deep_architecture]]):
diagnose the *class* of bug, derive the fix from the SSOTs rather than adding a parallel switch,
and kill the analogous bugs alongside the reported one. The SSOTs: `CARD_REGISTRY`
(`src/cards/card-registry.tsx`), `TEXT_OBJECT_REGISTRY` (`src/text-objects/`), the `Floatable`
contract + `float-policy.ts` (`src/floats/`), `borrowed-schema.ts`, `panel-registry.ts`,
the `DocStructureObserver` bus.

**The backlog's own root-cause notes are frequently wrong — never trust them.** Re-pin every
`file:line` and re-verify the mechanism against *current* code before acting. (Last batch the
investigation overturned the backlog's premise that #42/#43/#47 shared one `BorrowedMainText`
path — example cards bypass it entirely, so the proposed "add a variant" fix would have done
nothing. Investigate-first is what caught it.)

## The proven loop (manager pattern)
1. **Investigate first (Workflow).** Fan out read-only investigators (one per bug/cluster) that
   re-pin lines, confirm/correct the root cause, and design the SSOT-derived fix — with **2×
   adversarial refuters per causal claim**. Surface only the genuine *user* design-calls. Log
   each bug into `MEMO_BUG_BACKLOG.md` (numbered, self-contained: current behavior / desired /
   fix-site / open Q). This is a synthesis you usually want a workflow for; pure handoff/doc
   writing you can do solo.
2. **Ratify the user-only design calls** with `AskUserQuestion` (verify impl-coupled options
   against code first; recommend, don't survey). Record the ratified call in the backlog item.
3. **Dispatch impl chips** — `Agent`, `isolation: worktree`, `run_in_background: true` — each
   reading its backlog item(s), **seeded with the investigation's corrected analysis + anchors**.
   Cluster by file-domain to minimize merge conflict; wave them (~4 disjoint chips per wave).
4. **Gate before merge — right-size it.** Cross-cutting / registry- / observer- / editor-
   extensions- / expex- / borrowed-schema-touching → **full adversarial review Workflow** (4–5
   lenses → refute high/medium → verdict). Scoped polish → **single strong skeptic Agent**.
   **NEVER merge on chip self-verification alone** — gates have caught (across sessions) a
   dead-on-arrival feature, an XSS hole, data-loss paths, a docked-panel CSS leak that passed all
   tests, a contract-test teeth-hole, and — last batch — **new behavior shipping with zero test
   coverage**.
5. **Fold load-bearing nits yourself, in the worktree** (missing test teeth, comment accuracy,
   latent inconsistencies), commit, re-verify. **Prove an added test has teeth** (temp-revert the
   fix → the test goes RED). Leave cosmetic nits or file them. (Gabriel's standing steer: as a
   manager, *delegate* substantive work to chips — fold only the small nits yourself.)
6. **Merge `--no-ff` sequentially**; **one full `tsc` + `vitest --pool=threads` gate on merged
   main**; flip backlog statuses; clean your worktrees/branches. **Hold the push unless Gabriel
   says otherwise** (pushes deploy).

## Hard guards (every one earned its keep — do not relearn them)
- **⚠️ You SHARE the working checkout with Gabriel + other concurrent efforts.** `main` moves
  under you mid-session and the checkout can be on someone else's branch — the session-start
  snapshot is routinely STALE. **Before any write:** `git branch --show-current`, `git log -1`,
  `git log origin/main..main`. Do **all** writes in isolated worktrees; never `git add/commit` in
  the shared checkout except the final coordinated merge (confirm main is quiet first).
  **`merge-tree --write-tree` to conflict-check before every merge.** **Preserve, never
  blind-delete, a branch/worktree you did not create.** [[concurrent_shared_checkout_collision]]
- **Empirical > analysis.** A standalone harness — or the backlog's reasoning, or even a review
  refuter's claim — can be unfaithful to the real extension stack. Verify behavior in the REAL
  test (e.g. temp-revert the design and confirm the test goes RED). [[pm_nodeview_update_empirical_verify]]
- **Keystroke sanctity** (`AGENTS.md`, non-negotiable): no work proportional to doc size per
  keystroke; card-source memos gate on `useStructuralRevisions` (the observer bus), never a
  `docVersion` counter; any new `editor.on('update'|'transaction')` subscriber needs an O(1)
  justification + an `AGENTS.md` permitted-list entry; `window.__virgilBusStats().emitCount` must
  stay flat on plain typing. Touch text-objects only at the `Floatable` window layer.
- **Full suite hangs under fork-pool contention** → `npx vitest run --pool=threads`. The hang is
  not a failure; kill + rerun with threads.
- **Impl chips:** commit PER-STEP (chips die to the stream watchdog; the committed prefix
  survives — re-spawn a continuation chip pointed at the worktree). **Stage explicit paths, NEVER
  `git add -A`. Single-quote or HEREDOC `git commit -m` (no backticks). Each git command its own
  Bash call; `git -C`. Never chain `cd`/git with `&&`.** `timeout` is NOT on this shell
  (`npx tsc --noEmit > log 2>&1; echo $?`). [[feedback_git_commands]]
- Review/audit agents are **READ-ONLY** — no checkout/switch/stash/reset/commit/merge, no
  sync-defaults, no probe-file writes (inspect by reading). Workflow review scripts: **no
  apostrophes/backticks inside JS string literals** (use template literals; a workflow once failed
  to parse on an apostrophe).
- **Release / prefs:** **NEVER run `tools/sync-defaults.sh` / `npm run promote-defaults`** — it
  auto-commits a possibly-stale `personal-snapshot.json` (a `Promote personal prefs` commit landed
  on main as `7e47f91`; eyeball `*.defaults.json` diffs by hand). The release tag is lightweight:
  `git push --follow-tags` does NOT push it — push it explicitly + verify
  `git ls-remote --tags origin v<ver>`. [[release_prefs_snapshot_gotcha]] [[release_lightweight_tag_push_gotcha]]
- **Pushes deploy** to GitHub Pages. Nothing half-broken on main; batch merges sensibly.
- SendMessage to a prior background agent is NOT available across sessions — dispatch fresh, seed
  with anchors.

## State (verify at session start — it drifts)
- `main` at `7e47f91`, **in sync with origin** — the #41–47 card-chrome batch + the concurrent
  focus-view / action-alignment / code-view efforts have all shipped (last release ~v0.1.54; a
  prefs-promote just landed). Re-confirm push/release state with `git status -sb` + `git log
  origin/main..main`.
- Baseline ~**1396 tests / 142 files** green (`--pool=threads`), `tsc` clean. 16 card kinds; one
  `CARD_REGISTRY`; one `float:card:<kind>:<id>` grammar; one `Floatable` subsystem;
  `borrowed-schema.ts` is the shared card-context atom SSOT (main editor held to it by a
  teeth-closed contract test).
- A **`panel-stack-rework` worktree is active** — a separate concurrent effort; leave it alone.

## DO (priority order)
1. **Fresh backlog items #48 + #49** (just logged, OPEN): **#48** popped-out text-objects should be
   droppable onto the Stack (parity with cards); **#49** ExpEx grab handles overwrite onto content
   (mis-placed, recurring). Run the loop on these.
2. **New bug reports / polish** from Gabriel → run the loop.
3. **Card-refactor WALKS** ([MEMO_CARD_REFACTOR_WALKS.md](MEMO_CARD_REFACTOR_WALKS.md)): **W1–W9 +
   W11 still need Gabriel's hands** (W10 signed off). Highest-risk / never-fully-human-verified:
   **W11** (pop-out continuity), **W2** (clone/delete cascade — only-ever execution), **W9**
   (two-client collab). Drive headlessly what you can (preview memos below); guide Gabriel through
   the visual/two-client halves; convert failures to numbered backlog items + fix chips.
4. **Standing follow-up:** #44 (tools-band symmetric spacing) is **deferred** (editor chrome, not
   card-system; "symmetric" fights the "too big" intent given the load-bearing pod-cap) — only
   revisit if Gabriel asks.

## Memos & pointers
- **Running log:** [MEMO_BUG_BACKLOG.md](MEMO_BUG_BACKLOG.md) (#1–47 done/deferred; #48–49 open).
  Append new bugs here when Gabriel says "add to the list" ([[bug_backlog_memo]]).
- **Walks:** [MEMO_CARD_REFACTOR_WALKS.md](MEMO_CARD_REFACTOR_WALKS.md). **Archived SSOT:**
  [docs/card-refactor/CARD-SYSTEM-REFACTOR.md](docs/card-refactor/CARD-SYSTEM-REFACTOR.md).
- **Keystroke sanctity + the permitted `on('update'|'transaction')` list:** [AGENTS.md](AGENTS.md).
  **Design system:** [src/STYLE_GUIDE.md](src/STYLE_GUIDE.md) — check before new UI; update it when
  a decision generalizes ([[style_guide]]).
- **Process memories to lean on:** [[concurrent_shared_checkout_collision]] ·
  [[feedback_deep_architecture]] · [[pm_nodeview_update_empirical_verify]] ·
  [[release_prefs_snapshot_gotcha]] · [[release_lightweight_tag_push_gotcha]] ·
  [[feedback_git_commands]] · [[feedback_signal_done]] · [[feedback_memo_prompt_link]].
- **Code-trap memories:** [[atom_drag_and_observer_move_bug]] ·
  [[doc_structure_addedblocks_excludes_null_uuid]] · [[rhythm_rule_react_nodeviews]] ·
  [[float_body_eslint_refs_directive]] · [[vitest_extension_barrel_storage_mock]].
- **Driving the dev preview during walks:** [[dev_doc_loading]] ·
  [[preview_storage_clear_wedges_doc]] · [[preview_editor_internals_access]] ·
  [[preview_gesture_testing]] · [[preview_drop_spec_nondestructive_verify]] ·
  [[paint_timing_measurement]] · [[turbopack_watcher_stale]] · [[preview_hover_pseudo_verification]].
- **Concurrent efforts (don't step on):** [[card_refactor_status]] · [[action_alignment_status]] ·
  [[code_view_rework_status]] + the live `panel-stack-rework` worktree.

## Start by
Reading `MEMO_BUG_BACKLOG.md` (especially the new #48/#49) + `MEMO_CARD_REFACTOR_WALKS.md`;
confirming `main`'s real HEAD/branch/push-state (`git -C <repo> status -sb` + `git log
origin/main..main`); then asking Gabriel what to investigate first and/or which walks to run
together now. If nothing's queued, offer the #48/#49 loop or the highest-risk W11/W2/W9 walks.
