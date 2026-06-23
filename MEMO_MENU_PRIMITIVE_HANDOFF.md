# Manager handoff — `<Menu>` primitive + the management thread

**Paste the block in §0 as the opening message of a fresh session.** It carries the operating
model + current state. Detail lives in the auto-loaded memory files (`menu_primitive_status`,
`action_alignment_status`) + the docs cited below.

---

## 0. PASTE-ABLE RESUME PROMPT

> You are running a **management session** on Virgil (browser LaTeX editor, TipTap/PM, React/Next).
> We **plan deeply, dispatch worktree-isolated chips + Workflows, and merge verified results** — we do
> NOT hand-grind. Honor these **non-negotiable principles**:
>
> 1. **Deepest unified architectural fix, never a surgical patch.** Find the *class* and fix it (the
>    "math won't archive" report became a registry-wide SSOT + content-aware-emptiness sweep; one
>    "arrow nav in Cmd-/" request became a shared `<Menu>` primitive all menus adopt).
> 2. **Empirical/adversarial verification before shipping.** A predicted-✓ is not a ✓. Verify in the
>    live app OR with a real-stack test that drives the ACTUAL code (not mocks). For risky/foundational
>    changes, run an adversarial Workflow that tries to REFUTE the claims (this caught a focus-blur
>    regression + a delete-range data-loss bug the green suite missed).
> 3. **Dispatch the breadth, verify each, merge-as-you-go.** Worktree chips for parallel/isolated work;
>    Workflows for fan-out + judge-panels + refutation. ff-merge or cherry-pick each onto main, run the
>    gate (tsc + full suite, +adversarial for risky), then remove the worktree.
>
> **Operating gotchas (learned the hard way):**
> - **The user co-develops `main` and keeps it LOCAL-ONLY.** `origin/main` is intentionally BEHIND
>   local main (the user's drop-button + XSS-fix batches are unpushed by choice). **Do NOT `git push
>   origin main`** unless the user says so — you'd publish their unpushed batch. Merge to LOCAL main +
>   leave it. (Earlier menu work up to `874f5ff` IS already on origin.)
> - **Worktree base-drift + a moving main:** `Agent isolation:worktree` branches from `origin/main`;
>   local main moves under you as the user commits. So each chip's commit is **cherry-picked** onto the
>   current local main (footprints are disjoint from the user's `src/cards`/drop work → clean). Verify
>   `<sha>^ == main` before a `--ff-only`; else cherry-pick.
> - **Don't touch the user's worktrees** (under `.claude/worktrees/` — drop-chip-*, footnote-xss-fix,
>   etc.). They're the user's active efforts.
> - **Subagent dispatch can hit a SERVER-side rate limit** (agents die on tool-use 0). Your OWN
>   main-loop calls are NOT throttled — so for small, precisely-specified work, just do it yourself in a
>   dedicated worktree (edit → tsc → suite → commit → cherry-pick → remove worktree).
> - **Live-preview harness:** reach the editor via `__reactFiber$` DFS (largest-doc `.ProseMirror`),
>   the shared dispatcher (`{open,dispatch}` context value), `cardCreation`, `__virgilBusStats()`.
>   Set `localStorage['virgil:force-dev-storage']='1'` + reload. A `position:fixed` ConfirmDialog has
>   `offsetParent===null` → find buttons by `getClientRects().length>0`. **Synthetic events can't test
>   native-caret suppression or open a real menu reliably** — real-keypress checks need a human.
> - Git: separate commands (no `&&`), `git -C`/`git -C <worktree>`, end commit messages with
>   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. End replies with "Done."
>
> **Where things stand:** Three big efforts shipped this thread —
> (1) **CHIP 8** action-alignment verification matrix (DONE, on origin/main; found+fixed 2 data-loss
>     bugs); (2) **todo Mode-B** range anchors (DONE, on origin/main); (3) the **unified `<Menu>`
>     primitive** giving every action menu arrow-key nav — **8/9 menus migrated + the polish, on LOCAL
>     main `8b6fe7a` (unpushed), suite 1695 green.** Read `menu_primitive_status` + `action_alignment_status`
>     (auto-loaded memory) + `MEMO_MENU_PRIMITIVE_HANDOFF.md` for the full state.
>
> **The only menu item still OWED:** a real-keypress **Phase D** live a11y/keyboard smoke (open each
> menu, arrow around, Enter/Escape — confirm the highlight moves + the editor caret doesn't; check the
> MenuBar docked-positioning + the nested color-popover-from-lightning case). Synthetic tests can't do
> it — it's a human pass; if it surfaces a bug, fix the primitive. **Slash is a deliberate documented
> exception** (already has arrow nav; absorbing it is the risky R2 seam for no user gain).
>
> Start by reading `MEMO_MENU_PRIMITIVE_HANDOFF.md`, confirm `git status`/main-tip, then ask me what
> to pick up (the Phase D smoke, the bug backlog drain, or something new).

---

## 1. Current state (2026-06-16)

**Git:** local `main` = `8b6fe7a` (menu polish on top). `origin/main` = `874f5ff` (intentionally behind
— the user's local batch: bib-XSS merge `aa371b3`, drop-button FOLD 1-4 + Chip H, + the menu polish
`8b6fe7a`, all UNPUSHED by the user's choice). The menu primitive + 8-menu migration up to `8047278`
and the design doc `874f5ff` ARE on origin.

**Menu `<Menu>` primitive — DONE** (design → R1 live spike PASS → B1/B2 adversarially verified →
fan-out → polish). 8 menus on the primitive (grab, lightning/Cmd-/, heading, tab, color, MenuBar
block-type + the R5 expandable view-menu, label-ref, bib-picker). R6 nested-key ownership active;
combobox + widget + horizontal-orientation + `onArrowHorizontal` (combobox AND window-source list)
all built. **Slash** = deliberate exception (PM plugin; already has arrow nav). Memory:
`menu_primitive_status`. Design: `docs/agents/menu-system-design.md`. Code: `src/components/menu/`.

**CHIP 8 (action-alignment verification) — DONE** (on origin/main). Live + 200-case real-stack matrix;
found+fixed F2 (delete/archive swallowing a trailing block atom) + Bug #1 (list-toggle destroying a
title field). Memory: `action_alignment_status`. Docs: `docs/memos/action-alignment-matrix/`.

**Todo Mode-B range anchors — DONE** (on origin/main, `fa7b898` + the EditorLayout restore-loop fix).
Adversarially verified (a verifier caught the reload-restore gap → fixed). `FINDINGS.md` F4.

## 2. Open / owed items

- **Menu Phase D real-keypress smoke (OWED, user-driven):** open Cmd-/ + the others, arrow around,
  Enter/Escape; confirm highlight moves + caret/selection stays; check MenuBar docked positioning +
  the nested color-popover-from-lightning (R6) live. If a bug surfaces, fix the primitive.
- **Bug backlog** (`MEMO_BUG_BACKLOG.md`) — the standing "add to the list" drain target.
- **Spawned/sibling tasks** noted in memory: the `footnote-content.ts` XSS sink (a `footnote-xss-fix`
  worktree exists — the user's). Slash absorption remains *available* (registryFor seam) if ever wanted.
- The user's own active efforts (drop-button rework, XSS fixes) are THEIRS — coordinate, don't touch
  their worktrees, don't push their local main.

## 3. Pointers
- Memory (auto-loaded): `menu_primitive_status.md`, `action_alignment_status.md`, plus the index
  `MEMORY.md` and the feedback/gotcha memos.
- Docs: `docs/agents/menu-system-design.md` (menu), `docs/memos/action-alignment-matrix/` (CHIP 8),
  `FINDINGS.md` (the data-loss bugs found this thread).
- This thread's process lessons are baked into §0's gotchas.
