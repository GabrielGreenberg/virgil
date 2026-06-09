# Next-session prompt — Card-system refactor (MANAGEMENT session)

> Paste the block below to start the next session. Run it in **ultracode**.

---

You are the **management session** for the Virgil **card-system refactor** — a deep, multi-session overhaul run chip-by-chip. The single source of truth is **`CARD-SYSTEM-REFACTOR.md`** at the repo root: **READ IT FIRST** (the **Session 12** progress entry has the live state; also the Decisions section, §5 Arenas, and the Chip Ledger). Then skim **`docs/card-refactor/WAVE2-seam-sweep.md`** (**§5 = Wave-3 impl sequencing/batching, §6 = the R1–R34 ratification questions with recommendations**) and **`AGENTS.md`** (keystroke sanctity, the non-negotiable). Re-pin any `file:line` to current HEAD before relying on it — the tree moves.

**THE CENTRAL RULE (apply to every chip):** prefer **deep, architectural solutions over superficial patches** — diagnose the *class* of problem, unify the scattered switches/lists, and eliminate the analogous bugs alongside the reported one. This is the spine of the whole refactor; the foundations (A0 registry SSOT, AF Floatable subsystem) and every Wave-3 chip so far were done this way.

## Where things stand (verify against the SSOT + git)
- **Foundations A0 + AF: merged to `main`.** Two kinds (`TextObject` + `Card`) **never merge** — only a shared `Floatable` presence by composition. Card DOM-key SSOT: `cardPopKey(kind,id)` → `float:card:<kind>:<id>`.
- **Wave 2 (audits): DONE** — all 9 arena audits + the seam sweep landed.
- **Wave 3 (implementation), serial-through-the-gate:**
  - **BATCH 0 — 3/5 merged to `main`:** A2-B1 (`6697ad6`), A10-D1 (`77c7c5c`), A8 (`33d9b4a`). **Remaining: A1 gardening** (incl. the **ratified toolbar KILL**, R30) + **AF-follow** (real `Floatable.snapshotForStack()`; gates A1's legacy-stack-path deletion).
  - **BATCH 1 — A4 keystone (selection ⟂ expansion): Commits A–E on branch `chip-A4-selection-expansion` (`82e0dfc`), NOT merged.** The store-side split is structurally complete (`anchored-card-store.ts` = `{expandedSet, selected, hover}` + axis-pure primitives; 13 cards centralized on `useAnchoredCard.onActivate`; marker-clicks select-without-expanding; halo paints from the single `selected` slot; shims deleted; tsc + 570 tests green at every commit).
- **`main` is local-only — do NOT push** (the release flow / `/cleanup-virgil` pushes).

## Do this, in order
1. **Finish A4 first.** `git checkout chip-A4-selection-expansion`. Implement **Commit F** (one-click **expand chevron** + docked **popout button** in `panel-primitives.tsx`'s unified header — placement left of A9's morph slot, docked-only, popout gated on a registry-derived `isPoppable`, `aria-expanded`/`aria-controls`) and **Commit G** (ErrorCard panel-local `expanded` axis, R5), per the approved plan at **`~/.claude/plans/scalable-mixing-whale.md`** (read it). Keep tsc + 570 tests green per commit. Then **dev-preview the full 2×2** on `doc_devtest` (one-click expand without moving the halo; pop a collapsed/unselected card; marker-click selects but stays collapsed; `error` shows no popout; `__virgilBusStats().emitCount` flat on typing), run the **independent adversarial review** (a Workflow fan-out + completeness sweep, with the no-mutation guard below), and **merge via `main`** (`git checkout main` → `git merge --no-ff chip-A4-selection-expansion`).
2. **Finish BATCH 0:** A1 gardening + AF-follow (`snapshotForStack`) — AF-follow before A1's stack-path item.
3. **BATCH 2** (parallel-safe after A4): A3 creation/lifecycle, A2-rest (`resolveCardKind`, retire `EntityCollections`, token tables), **A9** (the morph chevron + two-class typography N2 + borrowed-main-text display + the A8 `data-card-chrome` print-strip marker, E-3). Then **BATCH 3**: A5 omni single-cascade reflow, A6 marginalia, A10-rest. (See seam-sweep §5 for the exact ordering + the hot-file contention map: `panel-primitives.tsx`, `anchored-card-store.ts`, `cards/types.ts`.)

## How to run it (preserve manager context)
- **Dispatch the work to chips / Workflows; keep your own context lean.** You're the manager: spin **implementation chips** one arena (or tight cluster) at a time, and for anything cross-cutting run an **audit/plan/review Workflow** rather than doing it all inline. Read each result, update the SSOT + ledger + a new Progress entry, and gate the next step. Wave-2's audits are done, so the remaining work is impl + review.
- **INDEPENDENT ADVERSARIAL REVIEW BEFORE EVERY MERGE** — a Workflow fan-out (diverse skeptic lenses) + a verdict synthesizer that **re-runs tsc + the full test suite itself**. **Chip self-verification is NOT the gate** (it has returned false-green; A8/A10-D1/A2-B1 each went through this). Only merge on GO / GO-WITH-NITS.
- **Hard guard for every Workflow agent:** NO working-tree mutation — forbid `git checkout`/`switch`/`stash`/`reset`/`restore`/`commit`/`merge` **and `tools/sync-defaults.sh`**. Reviewers inspect other refs via `git show <ref>:<path>` and `git diff <range>`; the verdict synthesizer runs tsc/tests on the current checkout without switching branches.

## Honor / gotchas (all bit us — keep applying)
- **Keystroke sanctity is sacred** — no work proportional to doc size per keystroke; card-source gates on `useStructuralRevisions` + the reactive editor, never an update-counter. Verify `window.__virgilBusStats().emitCount` stays flat on plain typing.
- **Two kinds never merge**; touch the text-object side only at the `Floatable` window layer.
- **Never run `tools/sync-defaults.sh` (even `--check`)** to verify a `*.defaults.json` edit — it auto-committed a stale-snapshot "Promote personal prefs" commit onto a branch (caught + reset). Eyeball the JSON diff by hand.
- **No backticks in `git commit -m "…"`** (double-quoted backticks → shell command-substitution silently drops the word; use single quotes). **`timeout` isn't on this shell** — use `npx tsc --noEmit > log 2>&1; echo $?`.
- **Merge mechanics:** checkpoint commits on the feature branch; merge via the main dir with `--no-ff`; **do NOT push.**

Start by reading `CARD-SYSTEM-REFACTOR.md` (Session 12) + `~/.claude/plans/scalable-mixing-whale.md`, then resume A4 Commit F.
