# Next-session prompt — Card-System Refactor MANAGEMENT session (Session 15)

> Paste the block below as the opening prompt of the next session. Run it in **ultracode**.
> It is a **management session**: you orchestrate the refactor via **Workflows + dispatched chips**, keeping your own context lean. You do **not** do the cross-cutting implementation inline.

---

You are the **management session** for the Virgil **card-system refactor** — a deep, multi-session, chip-by-chip overhaul. This is a **manager** role: you decompose, dispatch, gate, and merge — you do **not** write the arena implementations inline. Run as much as is appropriate off **Workflows** (review fan-outs) and **dispatched chips** (Agent tool, one arena/cluster at a time) to **preserve the longevity of the manager context**. We are in **ultracode** — author a Workflow for every substantive review/audit and lean toward exhaustive, adversarial verification; token cost is not a constraint.

**CENTRAL RULE (every chip, restated):** prefer **deep, architectural solutions over superficial patches** — diagnose the *class* of problem, unify scattered switches/lists/enums into one registry-derived SSOT, and kill analogous bugs alongside the reported one. When a "gate" framing collides with a real type/seam wrinkle, let the **consumer own the coupling** rather than forcing a half-clean fix (that's how the A2 `EntityCollections` fold got re-scoped to A3).

## Read first (re-pin every file:line to current HEAD — the tree moves under the refactor)
1. **`CARD-SYSTEM-REFACTOR.md`** (repo root) — the SSOT. Read the **Session-14 Progress entry** (live state), the **Decisions** section (all ratifications: N1/N2, R1/R5/R10/R11/R12/R13/R14, R-B/R-C, etc.), §5 Arenas, and the **Chip Ledger**.
2. **`docs/card-refactor/WAVE2-seam-sweep.md`** — §5 (Wave-3 sequencing + the `panel-primitives.tsx`/`anchored-card-store.ts`/`cards/types.ts`/`card-float-ctx.ts` contention map) and §6 (R1–R34 ratification questions, each with the sweep's recommendation).
3. **`AGENTS.md`** — keystroke sanctity (non-negotiable: `window.__virgilBusStats().emitCount` flat on plain typing; card-source derivation gates on `useStructuralRevisions`, never an `editor.on('update')` counter) + the two-kinds rule.

## State (all landed — merged to local `main`, NOT pushed; `main` ~53 ahead of origin; tsc clean, 612 tests / 59 files)
- **BATCH 1 — A4 keystone** (selection ⟂ expansion) ✅ `90c050e`
- **BATCH 0 (5/5)** ✅ — A2-B1 (`6697ad6`) · A10-D1 (`77c7c5c`) · A8 (`33d9b4a`) · **AF-follow** (`355c1ad`, real `snapshotForStack` + legacy stack-path deleted, GAP-8 closed) · **A1** (`4fff0be`, R30 detached-toolbar GC — proven dead-code, no live capability lost)
- **BATCH 2 (2/3)** ✅ — **A9** (`f68fd79`, morph chevron all 4 pairs docked+popped+omni · N2 two-class typography · `BorrowedMainText`) · **A2-rest** (`e39ffff`, `cardKindFromRecord` classifier · `isInlineAtomCardKind` · legacy-token crosswalk · derived anchor-routes)

## DO, in order

### 1. Finish BATCH 2 → land **A3** (the last BATCH-2 arena)
A3 = creation pipeline (3 entry points → one `useCardCreation`; delete `useSelectionToCardActions`) · pristine-system consolidation (one `usePristineCardManager`; **R21: verify the EditorLayout duplicate manager is render-dead before deleting**) · lifecycle ratification (document the **4 PERMANENT gaps** todo/archive/example/report/report-request as a *criterion*, NOT fills — Mode-A/derived, the clone/delete cascade can't reach them; a card-level clone on `example` would double-act its `exampleBlock` TextObject = two-kinds violation) · re-type **`popCardAtAnchor`** to `(kind: CardKind, …)` + `cardPopKey` routing (~33 refs) · **AND the deferred A2 handoff: the `EntityCollections`→`CardCollections`/`CardFloatCtx` fold-then-consume** (resolve the `examples` `ExampleInfo.exampleId`-vs-`{id}` + `todos`/`todoItems` + `reports`/`reportCards` slot mismatch in-context — the consumer owns it).
- A Session-14 A3 `Plan` agent (`ac774c7923f5dedda`) is likely orphaned — **do NOT depend on it; dispatch a fresh read-only A3 `Plan` agent** re-pinned to HEAD. A3 scope + the fold detail are in the Session-14 SSOT entry + the A2-rest handoff bullet.
- **Ratify the A3 R-questions just-in-time.** Self-ratify the technical ones (R19 example-lifecycle-permanent = yes; R20 selection-create-parity = acceptable; R21 pristine-render-dead = verify first). **R18 is the one genuinely user-facing call → put it to Gabriel via AskUserQuestion:** *should an archived snippet survive when its anchor paragraph is deleted?* (rec: **NO delete-cascade** — archive's purpose is to outlive deletion).

### 2. Then **BATCH 3** (the final batch) — **A5 ∥ A6 ∥ A10-rest**
- **A5** — omni-view: single-cascade reflow + the unanchored-card collision/reflow band (consumes A4 expansion + A9).
- **A6** — marginalia gutter: pipeline collapse + registry-derived markers (consumes A10-D1 + A2-B1; the note→highlight marker-strand is its territory).
- **A10-rest** — collab focus-claims + AI-request routing (D-1 accent SSOT already landed).
- Sequence per seam-sweep §5; re-pin + re-plan each against HEAD; audits/plans as read-only fan-outs; impl one arena per chip.

### 3. Final whole-refactor verification + archive the SSOT (DoD in `CARD-SYSTEM-REFACTOR.md`).

## The proven cadence (every arena)
**read-only `Plan` agent → ratify R-questions (user-facing ones to Gabriel) → impl chip (Agent, commits PER-STEP) → INDEPENDENT ADVERSARIAL REVIEW Workflow → fold only the load-bearing nits → `git merge --no-ff` into `main` → update SSOT Progress + Chip Ledger.**

**The review Workflow IS the merge gate (not chip self-verification):** a fan-out of diverse skeptic lenses (each `git diff`/`git show` read-only) → an adversarial-verify stage that tries to REFUTE each CRITICAL/HIGH → a **synthesizer that itself re-runs `tsc` + the full vitest suite + grep-gates** on the current checkout (no branch switch) → **GO / GO-WITH-NITS / NO-GO**. **Merge only on GO / GO-WITH-NITS.** It has repeatedly caught "passes tests but misses the ratified intent" (A9 typography) and dead-module stragglers (A1 snap-grid).

## Hard guards (every Workflow agent + every chip)
- **Review/audit Workflow agents: NO working-tree mutation** — forbid `git checkout/switch/branch/stash/reset/restore/commit/merge/rebase/apply` + `tools/sync-defaults.sh`; inspect via `git show <ref>:<path>` / `git diff <range>`; the synthesizer runs `tsc`/`vitest` on the current checkout **without switching branches**.
- **Impl chips: commit PER-STEP** (kill-resilient — chips have been killed mid-run; the committed prefix always survived and I finished/reviewed/merged from there). **Stage explicit paths, NEVER `git add -A`** (an `add -A` once leaked a temp review script into a merge). **Single-quote `git commit -m`** (backticks → shell substitution drops words). **`timeout` is NOT on this shell** — `npx tsc --noEmit > log 2>&1; echo $?`.
- **Never run `tools/sync-defaults.sh`** (even `--check`) — it auto-commits a stale `personal-snapshot.json`. Eyeball `*.defaults.json` diffs by hand.
- **Keystroke sanctity** (`emitCount` flat) + **two-kinds** (touch text-objects only at the `Floatable` window layer) on every arena.
- **Commit checkpoints on the chip branch; merge via `main --no-ff`; do NOT push** (`main` is local-only, ahead of origin by design).
- **Review-script temp files:** write the Workflow script to a repo-root `.tmp-<arena>-review.mjs`, invoke via `scriptPath`, **`rm` it before the merge**. Build `CTX` via array-`join('\n')` — **no backticks inside the template-literal prompts** (they close the literal → parse error).
- **Dev-preview** each arena's user-visible behavior on `virgil-data/doc_devtest` (reach the live editor/store via the fiber per the memory notes). The **backgrounded preview won't reliably surface docked panel columns** (e.g. Examples) — flag visual checks you can't drive headlessly as recommended manual walks, don't block on them.

## Deferred follow-ups accumulated (route into the right downstream arena; don't lose them)
- **A9:** the Examples-panel **visual** 15px/live-edit typography walk (manual check — couldn't drive headlessly); note→highlight offered for paragraph-only Mode-A notes → empty tintless highlight (chevron-gating UX → A2/A6); hardcoded revision `kindOptions` vs derived (SSOT nit); `bib`/`ai` → full `FloatChrome` (later AF thread); `borrowed-schema.ts` extraction (MEMO_BUG_BACKLOG #11).
- **A1/A8:** `chrome-config.ts` `isActionVisible`/`CALLBACK_TO_ACTION_KIND` now zero-consumer (→ A8).
- **A2:** the `linkedAnchor.kind` mark-attr removal (R-E, deferred); the parallel `legacyAnchorKindToCardKind` parser → could be the inverse of `LEGACY_TOKEN_CROSSWALK` (future).

**Start by:** reading `CARD-SYSTEM-REFACTOR.md` (Session 14) + seam-sweep §5/§6, re-pinning to HEAD, then dispatching a fresh A3 `Plan` agent.
