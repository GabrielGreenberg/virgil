# New Manager Session — Action Alignment: remaining issues

**Paste the block below as the opening message of a fresh session.** It carries the
operating principles of the prior session + the remaining work. Full state of the effort
is in [MEMO_ACTION_ALIGNMENT.md](MEMO_ACTION_ALIGNMENT.md) and the auto-memory
`action_alignment_status.md`.

---

You are running a **management session** on Virgil (browser LaTeX editor, TipTap/PM, React).
We do NOT do detailed work here — we **plan deeply, then spawn worktree-isolated chips/agents**
and merge their verified results. Honor these **fundamental principles** (they are non-negotiable):

1. **Deepest unified architectural fix, never a surgical patch.** When you find a bug, find the
   *class* and fix the whole class (the prior session turned one "math won't archive" report into
   a registry-wide SSOT refactor AND a content-aware-emptiness sweep that caught 2 latent
   data-loss bugs). The user explicitly wants this.
2. **Empirical verification beats code-read/unit-test confidence.** A predicted-✓ is not a ✓.
   Verify behavior in the live app OR with a real-stack test that *drives the actual code* (not a
   mock). The user found real bugs by USING the app that all our tests missed.
3. **Adversarial verification before shipping behavior changes.** For risky chips, run a Workflow:
   implement → fan out independent verifiers that try to REFUTE the alignment/safety claims +
   hunt missed call-sites. (This is how we caught ourselves about to ship a broken highlight fix.)
4. **Merge-as-you-go.** ff-merge each chip's commit → push → remove its worktree. The user
   loosened the per-chip-review gate; keep momentum but still actually verify (tsc + full suite +
   live smoke for UI changes) before merging.

**Operational gotchas (learned the hard way — do not relearn):**
- **Worktree base-drift:** `Agent isolation:worktree` branches from `origin/main`, NOT local main.
  So **`git push origin main` after every merge** or the next chip lacks the prior work. Recover a
  stale-based chip by cherry-picking its own commit onto main (footprints are disjoint → clean).
  Always verify `git rev-parse <chip-sha>^ == main tip` before `git merge --ff-only`.
- **Turbopack stale-watcher:** after merges the live dev server may throw `Module not found` / serve
  stale chunks — it's NOT a real break (confirm files committed + tsc + suite + fresh build).
  Fix: `preview_stop` then `preview_start` (a real restart), then hard-reload.
- **The user interrupts long background agents** (you'll see `[Request interrupted by user]` as the
  transcript's last line). They leave SALVAGEABLE uncommitted work — gate on `tsc --noEmit` + the
  full vitest suite, review the key files, finish the small remainder + commit. Cheaper than redoing.
- **Async confirm-delete pitfall:** archive/delete confirm-dialogs delete on a LATER tick. In the
  preview, observe the doc in a SEPARATE `preview_eval` from the confirm-click, or you'll read the
  pre-delete state and wrongly conclude "still broken."
- **The user co-develops `main` in parallel** (+ a `#29` fold worktree under `.claude/worktrees/`).
  `main` can move under you; re-check before git ops. Don't touch the `agent-a42836…` worktree.
- Git: separate commands (no `&&`), `git -C`, end commit messages with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- The live-editor preview harness (reach `__vMain`/`__vDH` via React fiber, dispatch actions,
  fixture reset) is documented in MEMO_ACTION_ALIGNMENT.md → "Verification discipline".

**Where things stand:** the multi-surface action-alignment refactor is **essentially complete** and
on `origin/main` (`f4c830f`): one `VIRGIL_ACTION_REGISTRY` SSOT is the source for cards / atoms /
blocks / formats across all 4 surfaces (grab-bar, lightning, slash, typed-LaTeX); the
`editor-actions-bridge` (one PM→React entrypoint) replaced every `virgil-*-create/input` event;
the dual-SSOT is gone; coverage asserts zero pending ids; two distinct math-archive bugs +
a whole atom-only-empty-text class (incl. 2 data-loss bugs) are fixed. Suite ~1097 green.

**Remaining issues, in priority order:**

1. **CHIP 8 — the full browser cross-surface verification matrix (the headline remaining item).**
   The empirical sweep the user has wanted since the math-archive miss: drive EVERY tool from EVERY
   surface (grab / lightning / slash / typed / keyboard) on EVERY applicable text-object kind —
   INCLUDING atom-only and atom-bearing lines — in the LIVE app, asserting byte-identical
   sidecar+atom+lifecycle across surfaces and correct behavior per kind. This is what would have
   caught the atom-only class proactively. Run it deliberately (preview-driven, parallelize only
   with per-agent fixtures since they collide on the shared dev doc). Capture results in
   `docs/memos/action-alignment-matrix/`.

2. **Atom-only class — cosmetic remainder.** ✅ DONE (`63ccace`): the borderline `:762`
   destructive-confirm gap (atom-only block deletes silently) is fixed — `rangeHasAnchorsOrAtoms`
   now recognizes all atoms (registry-sourced). What remains is TRULY cosmetic (atom-only → a blank
   card label or 0-word confirm string): `drag-handle-actions.ts:566`/`:320`/`:1009`,
   `links.ts:331`/`:792`, `ref.ts:361`, `text-object-registry:140`. Confirm with the user whether
   the blank-label ones are worth a fallback (derive a label from the atom's latex/command) or just
   close them out.

3. **Panel "+" ADD buttons = the 5th surface.** The Footnotes + Citations panel header "+" buttons
   call `createEmptyFootnote` / `createCitation` directly, bypassing the registry `run()` (no
   pristine/pin lifecycle, not aligned with the other surfaces). Fold them through the registry for
   full consistency.

4. **Smaller open follow-ups** (from the original `docs/memos/ACTION-MENU-DIAGNOSIS.md` + this effort):
   `todo` selection-range loss (Mode-A-only, asymmetric with note/cutter); archive/delete
   silent-break on a stale ref (no user feedback vs duplicate's fail-loud); highlight-on-a-block
   always wraps the whole block with no opt-out.

Start by reading MEMO_ACTION_ALIGNMENT.md, checking for any in-flight chip to merge, then
scope CHIP 8 with me (it's the big one and the user cares most about it).
