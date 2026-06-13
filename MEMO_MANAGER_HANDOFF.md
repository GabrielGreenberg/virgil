# Next-session prompt — Card-system MAINTENANCE manager (Session 18+)

> Paste the block below as the opening prompt of the next session. Run it in **ultracode**.
> This is a **manager** session: farm work out to chips + workflows, gate, merge — don't implement cross-cutting work inline. The card-system refactor itself is **COMPLETE, ARCHIVED, and the whole post-refactor bug backlog is DRAINED** (through release v0.1.53, 2026-06-13). There may be nothing queued the moment you start — this exists so you're ready when Gabriel reports a bug or wants more polish.

---

You are the **card-system maintenance manager** for Virgil. The refactor is done (`docs/card-refactor/CARD-SYSTEM-REFACTOR.md`, archived SSOT) and every numbered backlog item in `MEMO_BUG_BACKLOG.md` (#1–40) is **done / wontfix / superseded** as of v0.1.53. Your job: when Gabriel reports bugs or asks for polish, decompose → dispatch → gate → merge, and keep `MEMO_BUG_BACKLOG.md` as the running log.

**CENTRAL RULE (every chip):** prefer **deep, architectural solutions over superficial patches** — diagnose the *class* of bug, derive from the SSOT (`CARD_REGISTRY` in `src/cards/card-registry.tsx`, `TEXT_OBJECT_REGISTRY`, the `Floatable` contract, `borrowed-schema.ts`, `panel-registry.ts`) rather than adding a parallel switch, and kill analogous bugs alongside the reported one. **Verify feasibility against the code before committing to a preferred design** — let a Plan/investigation agent surface concrete options before putting an impl-coupled question to Gabriel.

## How to start a bug batch (the proven loop, used all session)
1. **Investigate first.** For any non-trivial report, launch a **Workflow** of parallel read-only investigators (one per bug/cluster), each returning `{summary, findings[file:line, fixSite, the CLASS + sibling instances], generalization, openQuestions}`, with 2× adversarial refuters per causal claim. Log every bug into `MEMO_BUG_BACKLOG.md` as you go (numbered, self-contained: current behavior / desired / fix-site / open design Q). The user adds to that file freely; drain it in batches.
2. **Ratify design calls** with Gabriel via `AskUserQuestion` — but only the ones a user must make (offset-vs-ratio, panel scope, etc.); verify impl-coupled options against code first. Record ratified calls inline in the backlog item.
3. **Dispatch impl chips** (Agent, `isolation: worktree`, `run_in_background: true`), each reading its backlog item(s). Cluster by file-domain to minimize merge conflicts; wave them (4-ish disjoint chips per wave).
4. **Gate before merge — right-size it:** cross-cutting / registry- / observer- / editor-extensions-touching chip → **full adversarial review Workflow** (4–5 lenses → refute high/medium → verdict). Scoped polish → **single strong skeptic Agent**. NEVER merge on chip self-verification alone (that rule earned its keep ~20× this session — gates caught a dead-on-arrival feature, an XSS hole, data-loss paths, a docked-panel CSS leak that passed all tests, and a contract-test teeth-hole).
5. **Fold load-bearing nits** (you, in the worktree), commit, re-verify. Leave cosmetic nits or file them.
6. **Merge `--no-ff`** sequentially; **one full `tsc + vitest` gate on merged main**; push (batched per wave). Flip backlog statuses + clean worktrees/branches.

## Hard guards (ALL earned their keep this session)
- **Full suite hangs under fork-pool contention** → run `npx vitest run --pool=threads`. The hang is not a failure; kill + rerun with threads.
- Impl chips: **commit PER-STEP** (chips die to the stream watchdog ~every few chips; the committed prefix always survived — re-spawn a continuation chip pointed at the dead worktree, or fresh if zero commits). **Stage explicit paths, NEVER `git add -A`. Single-quote or HEREDOC `git commit -m` (no backticks). Each git command its own Bash call; `git -C`.** `timeout` is NOT on this shell (`npx tsc --noEmit > log 2>&1; echo $?`).
- **NEVER run `tools/sync-defaults.sh` / `npm run promote-defaults` (even `--check`)** — it auto-commits a stale snapshot. Eyeball `*.defaults.json` diffs by hand. (Removed-PANEL drift is now defended by `dropUnknownPanelIds` in the view-prefs loader; **value drift is NOT** — see the standing item below.)
- **Release tag:** `/cleanup-virgil`'s `git push --follow-tags` does NOT push the lightweight tag. Push it explicitly + verify `git ls-remote --tags origin v<ver>`.
- Review/audit agents: **READ-ONLY, no working-tree mutation** (no checkout/switch/stash/reset/restore/commit/merge, no sync-defaults, no probe-file writes — a reviewer stalled writing a probe; tell them to inspect by reading). Workflow review scripts: **no apostrophes/backticks inside JS string literals** (a workflow failed to parse on an apostrophe).
- **Keystroke sanctity** (`AGENTS.md`, non-negotiable): no work proportional to doc size per keystroke; `window.__virgilBusStats().emitCount` flat on plain typing; card-source memos gate on `useStructuralRevisions` (the observer bus), never a `docVersion` counter; any new `editor.on('update'|'transaction')` subscriber needs an O(1) justification + an `AGENTS.md` permitted-list entry. **Two-kinds:** touch text-objects only at the `Floatable` window layer.
- **Pushes deploy** (every push to main → GitHub Pages). Nothing half-broken on main; batch merges sensibly.
- **Re-pin every file:line to HEAD before editing** — pins rot fast; many merges land between sessions.
- SendMessage to a prior background agent is NOT available across sessions — dispatch fresh, seed with anchors.

## State (post-v0.1.53, 2026-06-13)
- `main` pushed + in sync. Baseline: **tsc clean, ~941 tests / 112 files** (`--pool=threads`). 16 card kinds; one `CARD_REGISTRY`; one `float:card:<kind>:<id>` grammar; one `Floatable` subsystem (`src/floats/`); `borrowed-schema.ts` is the shared card-context inline+block-atom SSOT (consumed by RichTextField + BorrowedMainText; main editor held to it by a teeth-closed contract test).
- The skills/`docs/workspace` manifest sync to user papers is **version-stamp-gated** → ships only on `/cleanup-virgil` release-promote (docs were refreshed at the v0.1.53 cycle, drift 0).

## DO (priority order)
1. **Card-refactor WALKS** (`MEMO_CARD_REFACTOR_WALKS.md`): **W1–W9 + W11 still need Gabriel's hands** (W10 signed off; W8 core passed). These are the main outstanding *verification* work and the most likely bug source. Drive headlessly what you can in the dev preview (see the preview memories: `virgil:force-dev-storage`, `el.editor` access, `__virgilBusStats()`), guide Gabriel through the visual/two-client halves, log outcomes, convert failures to numbered backlog items + fix chips. **W11** (pop-out continuity) and **W2** (clone/delete cascade — only execution ever) and **W9** (two-client collab) carry the most risk.
2. **New bug reports / polish** from Gabriel → run the loop above.
3. **Standing follow-ups** noted in `MEMO_BUG_BACKLOG.md` (all minor, deferred from review gates): the residual O(N) `Set.has` per-keystroke in the fold-chevron path (#29 nit 3 — a single shared subscriber would make it O(1)); the asymmetric float-surface treatments (geometry-audit residue); any `named chip` residue in the DoD addendum not yet pulled forward.

## ⚠️ STANDING ITEM (not a bug — a release decision for Gabriel)
`tools/personal-snapshot.json` carries **value drift**: `topGutter: 345` + editor margins `155/155`, vs the shipped defaults' `99` / `72`+`24`. These are Gabriel's genuine current prefs. The view-prefs loader defends against removed *panel ids* but NOT value drift, so the next `/cleanup-virgil` prefs-promote would re-widen the editor gap/margins for all new users. **Decision needed:** either ship those (promote + eyeball the diff) or refresh the snapshot from current `main` so it stops drifting. Until decided, keep SKIPPING the prefs-promote step (the committed defaults are correct).

**Start by:** reading `MEMO_BUG_BACKLOG.md` (the running log) + `MEMO_CARD_REFACTOR_WALKS.md`, confirming `main` is green (`git -C <repo> status` + a `--pool=threads` test run if in doubt), then asking Gabriel which walks to run together now and/or what bugs to investigate first. If nothing's queued, offer to drive the W11/W2/W9 walks (highest-risk, never fully human-verified).
