# Focus View — Handoff & Resume Prompt (2026-06-15)

Quick entry point for continuing the focus-view work. Full architecture + per-chip
detail lives in **[MEMO_FOCUS_VIEW_REWORK.md](MEMO_FOCUS_VIEW_REWORK.md)** (repo
root, the SSOT). This file = current state + resume prompt + how to test the one
remaining bug (CHIP 5).

## TL;DR state
- The deep focus-view rework is **DONE and MERGED into `main`** (merge commit
  `869f311`, `--no-ff`), with CHIP 6 + CHIP 4b landed on top.
- **LOCAL ONLY — NOT PUSHED.** The `focus-view-rework` branch + worktree were
  cleaned up (removed). The two `agent-*` worktrees are unrelated (user's other work).
- **1127 tests pass on main, clean tsc.**
- **Only open item: CHIP 5** — the card-*typing*-in-focus visual glitch. Needs a
  user screen recording to confirm whether it still reproduces (it may already be
  resolved by the CSS removal + CHIP 6). NO blind code has been landed for it
  (per the round-5 lesson: don't guess without seeing the symptom).

## Git state (main, not pushed)
`0ae1941` memo status · `b620292` CHIP 4b · `869f311` merge · `d04f6d4` CHIP 6 ·
`c6c1918` investigation note · `f6d0df5` memo · `4e7020a` isMapSafeEdit crash fix ·
`64c50a0` CHIP 4 · `ff99186` CHIP 3 · `4e3efcf` CHIP 2 · `e405a05` CHIP 1 ·
`dd28d2c` CHIP 0.
To ship: `git push` main, then the normal release/deploy (e.g. `/cleanup-virgil`).

## What was fixed (the 3 reported bugs + extras)
- **Index drift → UUID band.** `resolveFocusBand` (`src/lib/focus-view.ts`) +
  `focusViewPlugin` node decoration (`.focus-hidden`, registered in
  `editor-extensions.ts`, main/float only). `useFocusMode(docId, editor)` is
  UUID-native + two-phase migration + exposes a live-derived index `state` so old
  consumers stay drift-free.
- **Silent card suppression → "N outside focus" bin.** `omni-host` stamps
  `OmniItem.outsideFocus`; `OmniViewPanel` renders `OmniOutsideFocusBin`.
- **Footnote/card bodies blanking (CHIP 6).** Card body editors crashed on the
  doc-only `linkedAnchor` mark (absent from the borrowed card schema). Fix strips
  it in `normalizeRichContent` (`src/lib/footnote-content.ts`).
- **Breadcrumb wrong under focus (CHIP 4b).** `skipHidden` in EditorLayout's
  section-path was gated on `active && locked`; changed to `active` (the hide is
  lock-independent). Mirror pane had no skip → added it. Both recompute on toggle.
- **+ CHIP 0** (`blockOrderChanged`/`changedBlocks` in the DocStructure diff) and
  the `isMapSafeEdit` crash fix (multi-step tail edits) from adversarial review.

## CHIP 5 — the remaining bug + how to test it
**Symptom (user, across earlier rounds):** typing into an EDITABLE card body
(note/footnote) while **focus mode is ON** makes each keystroke appear to put the
character on its own line / the card jumps down ~1 line per keystroke, "settling"
after ~9 keystrokes. The stored data + DOM are correct — it's a **visual** glitch,
and it's **focus-mode-specific** (fine with focus off).

**How to reproduce / test (do this and capture a recording):**
1. Open the app (dev: `virgil-dev` preview, port 3000, force-dev-storage; or your
   real paper — the real paper may trigger it more reliably than the dev doc).
2. Turn focus mode ON (Outline panel → "Focus mode") on a section that contains a
   note or footnote card (e.g. "The Birth of the Footnote").
3. Either create a NEW note from inside the editor (select text → add note) so its
   body opens for editing, OR click an existing note/footnote card to expand its
   editable body.
4. Type several letters **slowly** (≈1/sec), e.g. `a a a a a`.
5. **Watch the card while typing:** does the card slide DOWN a line per keystroke,
   or does each letter look like it lands on a new line, then snap back / settle
   after ~9 keystrokes? That's the glitch. (If letters just accumulate on one line
   smoothly, it's fixed.)
6. **Capture it:** macOS `Shift+Cmd+5` → Record Selected Portion → ~5s of the
   typing → drop the clip into the next session. (A clip is worth far more than a
   description — the prior 4 fix attempts failed by guessing without one.)

**If it still reproduces, the diagnosis plan (from the round-5 memo + the design
sweep) — in order of likelihood:**
- **Hyp B — omni cascade reflow:** `src/hooks/useInTextPositions.ts` repositions
  anchored cards (`transform: translateY`) per keystroke; the round-4 "skip during
  typing" gate (~`useInTextPositions.ts:368-409`) may have a hole (it reads
  `document.activeElement` — the typed card's editor focus may not register in
  time). Instrument the typed card wrapper's `translateY` per keystroke.
- **Hyp A — scrollIntoView:** `src/components/RichTextField.tsx` (~the capture-phase
  beforeinput intercept, the `.scrollIntoView()` call) runs per keystroke; removing
  it is a 1-line reversible test.
- Land ONLY the change that demonstrably removes the visible jump (confirm against
  the recording). Don't credit the CHIP 2/6 work with the fix until proven.
- Superseded background: `scratch/focus-mode-typing-*.md` + `-newlines.md`.

## Gotchas for a fresh session
- **Stale Turbopack chunks** are common in this preview — after edits, `rm -rf
  .next-preview` + restart the preview (don't trust HMR for plugin/editor changes).
- **Dev preview verify path:** force dev storage with
  `localStorage.setItem('virgil:force-dev-storage','1')` then reload; set focus via
  `PUT /api/dev/doc/devtest01/virgil/focus.json {active,locked,startBlockIndex,
  endBlockIndex}` (index shape is auto-migrated to UUID on load) + reload.
- **Card editors ≠ main editor schema.** `RichTextField` / `BorrowedMainText` use
  `borrowed-schema.ts` (no `linkedAnchor`, no main chrome). Any content fed to them
  MUST go through `normalizeRichContent` (which now strips `linkedAnchor`).
- **`focusViewPlugin` runs BEFORE `docStructureObserver`** (heading-extension
  order), so `readPendingDiff` is null in its `apply` — it discriminates
  map-vs-rebuild from `tr.steps` directly (`isMapSafeEdit`), not the diff.
- **Reach the live editor in preview_eval:** main editor DOM is `.tiptap.prose-stone`
  (ProseMirror-managed, no React fiber on it); walk its `parentElement`'s
  `__reactFiber$` up/down for the TipTap `editor`. The outline's "Focus mode"
  toggle button only mounts when the Outline panel is open (and React-render is
  async — query it in a separate eval after clicking "Outline").

## Resume prompt (paste into a fresh session)
> Continue the Virgil focus-view work. It's MERGED into `main` (local, not pushed)
> — read `MEMO_FOCUS_VIEW_HANDOFF.md` then `MEMO_FOCUS_VIEW_REWORK.md` at the repo
> root for full state. Everything is done except **CHIP 5** (card-typing-in-focus
> visual glitch). [If I attach a screen recording:] diagnose CHIP 5 from the
> recording per the handoff's diagnosis plan (hyp B cascade reflow / hyp A
> scrollIntoView), fix it on a worktree branch, verify in the dev preview, and
> tell me before merging. [If not:] tell me how to capture the recording. Also: if
> I say "push/ship," push `main` and run the release flow.
