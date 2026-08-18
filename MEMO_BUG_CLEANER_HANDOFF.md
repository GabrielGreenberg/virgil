> **SUPERSEDED (2026-07-03) by the Task pipeline at `~/virgil-tasks/`.** The cleaner role now runs
> as the background worker in `~/virgil-tasks/WORKER.md` (start with `/loop /work`): one task per
> run, isolated worktree, verify, then **auto-merge to `main` + clean up**, escalating anything it
> can't resolve back to the catcher via `blocked/`. See `~/virgil-tasks/README.md`. The diagnosed
> 2026-06-30 backlog this memo pointed at is now seeded in `~/virgil-tasks/incoming/`. Kept for
> historical reference only.

# Handoff prompt — Virgil bug-cleaning session

> Paste everything below the line into a fresh Claude Code session opened at
> `/Users/gabriel/Programming/virgil`. It moves autonomously through the
> diagnosed bug backlog, implementing fixes.

---

You are a **bug-cleaning session** for **Virgil** (a browser-based visual LaTeX
editor, `/Users/gabriel/Programming/virgil`). A separate bug-*catcher* session
has already diagnosed a batch of bugs and written a detailed memo per bug. Your
job: **work through that list autonomously and fix each one**, verifying as you
go. You implement; you do not re-diagnose from scratch (the root causes are
already found — trust them, but confirm before large edits).

## Core design principle (this governs every fix)

**Prefer DEEP, UNIFIED, architectural solutions over surgical patches.** Every
memo gives both a `deepFix` and a `surgicalFix`. **Default to the deep fix** —
solve the whole bug *class*, unify the scattered switches, surface the shared
fork, and kill analogous latent bugs alongside the reported one. Only fall back
to the surgical patch if the deep fix proves too risky for one pass (and say so).
Several of these bugs are literally the *same disease* surfacing in different
places — fix the disease once (see "Cross-cutting" below).

## The work list — read each memo, then implement

All memos are at the repo root. Read the whole memo before touching code; each
has root cause, exact `file:line` pointers, deep vs surgical fix, resolved
decisions, and a live-verify checklist.

**Trivial / ready now:**
- [MEMO_REPORT_MARGIN_ICON_2026_06_30.md](MEMO_REPORT_MARGIN_ICON_2026_06_30.md) — report margin marker shows two lines; drop `hideFrame:true` at `src/lib/marginalia.ts:280` (+ optional dead-code cleanup of the `hideFrame` prop).
- [MEMO_GUTTER_GRIP_UNIFY_2026_06_30.md](MEMO_GUTTER_GRIP_UNIFY_2026_06_30.md) — generalize `.drag-gap-h.band-grip` (globals.css) to both orientations + apply to the 3 `.drag-gap-v` sites AND the 3 library resizers (`LibraryView.tsx` :946/:980/:1011). **Open fork:** hover+drag reveal (recommended, matches the panel band) vs drag-only. Default to the recommendation unless the user says otherwise.

**Single-file / focused:**
- [MEMO_EXPEX_DROP_BAR_2026_06_30.md](MEMO_EXPEX_DROP_BAR_2026_06_30.md) — sibling-insert drop bar reads short below an `ex`; deep fix = bar width encodes insert SCOPE (full prose-column for sibling; short vertical for sub-example). `src/components/drop-mode/hit-test.ts` + `src/text-objects/block-frame.ts` (needs a prose-column-width source).
- [MEMO_CARD_TITLE_PREF_2026_06_30.md](MEMO_CARD_TITLE_PREF_2026_06_30.md) — the card `+T` prompt must follow a page-level pref; mirror the paragraph `showParTitles` pattern → add `showCardTitles` + `.hide-card-titles .card-title-add-only{display:none}`. Keep the registry default byte-identical with `useViewPrefs.defaults.json`.

**Multi-part clusters:**
- [MEMO_UI_GEOMETRY_BUGSWEEP_2026_06_30.md](MEMO_UI_GEOMETRY_BUGSWEEP_2026_06_30.md) — 4 bugs: (1) library tab corner outline overrun [needs live DPR confirm]; (2) drop the dashboard "Sources" card (`LibraryCentralDashboard.tsx`); (3) **app-wide rounded-corner uniformity → a 6-token radius scale** + Tailwind `@theme` map + lint guard; (4) library PDF-view inset + manila border (shared framed-viewer surface with the docs viewer at `EditorLayout.tsx:3977`).
- [MEMO_AI_REQUEST_PIPELINE_2026_06_30.md](MEMO_AI_REQUEST_PIPELINE_2026_06_30.md) — footnote AI-request affordance (orphan/unanchored cards never get `onSetAiRequest`) + inbox culling (`useAiRequests` reads once, no re-sync = the "search" churn; `list_requests.py` fallback gaps). Deep fix = single canonical inbox (`ai-requests.json`) both UI + skills read, `PANEL_FILES` derived from `CARD_REGISTRY` routing, event-driven re-read.
- [MEMO_BUG_BATCH_2026_06_30.md](MEMO_BUG_BATCH_2026_06_30.md) — 8 items with **resolved decisions**: (2) note→divider [superseded, see below], (3) offline compile **DEFERRED — do not touch**, (4) `--`/`---` InputRule → **LaTeX convention** (`--`=en `–`, `---`=em `—`), (5) unify skill "find-or-surface, never fabricate" doctrine (skill markdown), (6a/6c) relabel suggest/comment → **request** (labels only; never touch kind ids), (6b) default `aiRequest:true` on creation **+ bridge at creation**, (7) drop the focus-view star SVG, (12) bib drag → add Editor `dragover` `dropEffect` (**restyle, don't remove**), (13) citation **Enter commits directly** (stage active key then commit; multi-cite adds via mouse/arrow pick), (15) `+range` **trailing the citation inline** (per-key).
- [MEMO_NOTE_MARGINALIA_JUMP_2026_06_30.md](MEMO_NOTE_MARGINALIA_JUMP_2026_06_30.md) — ALL note marginalia place above target (jump up on settle). **Supersedes bug-batch item (2).** Deep fix = unify marginalia measurement onto the grab-handle SSOT (`resolveBlockFrame`/`resolveInlineContextElement`).
- [MEMO_OMNI_CARD_OVERLAP_2026_06_30.md](MEMO_OMNI_CARD_OVERLAP_2026_06_30.md) — omni cards overlap; deep fix = per-card `ResizeObserver` on `[data-omni-entry-wrapper]` in `useInTextPositions.ts` so the cascade re-runs on late height changes.

## Cross-cutting unifications (fix the disease once — do these as SINGLE deep changes)

- **Geometry SSOT** — bug-batch (2) note→divider, `note_marginalia_jump`, and `omni_card_overlap` are ALL the same class: a surface measuring its own geometry on a divergent/incomplete path instead of the shared grab-handle SSOT ([src/text-objects/block-frame.ts](src/text-objects/block-frame.ts), [src/lib/text-metrics.ts](src/lib/text-metrics.ts)). Unify marginalia + omni measurement onto it + add the missing re-measure trigger (per-card RO). One architectural pass retires all three (and the UI-geometry sweep's #1/#3/#4 "duplicated-geometry" bugs share the flavor).
- **AI-request pipeline** — the AI-request memo's canonical-inbox fix also subsumes bug-batch (6b)'s "default AI-request on creation" (must bridge at creation) — land 6b on top of it, not before.
- **Radius tokens** — UI-geometry bug #3 introduces the token scale; bug #1 (tab corner) and #4 (PDF frame) reference it. Land the token scale first.

## Discipline — the checkout is LIVE and SHARED

Gabriel drives this SAME working copy live, and other Claude sessions may edit it concurrently.
- **Verify `git -C /Users/gabriel/Programming/virgil log --oneline -1` before and between writes.** HEAD moves under you.
- **Never edit `main` directly for a fix.** Create a branch/worktree per bug or cluster (e.g. `git -C … worktree add .claude/worktrees/<slug> -b fix-<slug>`), implement there, and leave merging to the user (or `/cleanup-worktrees` / `/cleanup-virgil`). If unsure which worktree a task belongs to, ASK.
- Git hygiene (hard rules): **never chain `cd`/git with `&&`** (one Bash call each); prefer `git -C <path>`; **explicit `git add <paths>`, never `git add -A`** (shared checkout); commit only when the work for that bug is done + verified. End commit messages with the `Co-Authored-By: Claude …` line per `CLAUDE.md`.
- Don't sweep untracked files; preserve foreign branches/worktrees.

## Keystroke sanctity (load-bearing — several fixes touch it)

Read the "Keystroke sanctity" + "Card-source derivation" sections of [AGENTS.md](AGENTS.md) before touching marginalia / omni / measurement / decoration code. **No plugin, hook, or effect may do work proportional to document size per keystroke.** The marginalia (`useMarginaliaRegistry`), omni (`useInTextPositions`), and geometry (`block-frame.ts`) fixes MUST stay O(edit-size)/O(1) per transaction — the per-card ResizeObserver (omni fix) fires only on real size changes and `measure()` is RAF-coalesced + change-gated; keep it that way. Verify with `window.__virgilBusStats()` / `window.__marginaliaStats()` in the preview: typing N chars must leave the counters flat.

## Verification — per bug, before you call it done

1. **Types + tests**: `npm run typecheck` (or `tsc`), and `npx vitest run <relevant>` — add/adjust tests where the memo names a contract (e.g. the AI-request routing contract, `isAtomBlock`, radius exceptions).
2. **Preview (visual)**: use the `preview_*` tools, not Bash. `preview_start` → `virgil-dev` (serves on :3000). If it fails with "Another next dev server is already running", it's the Next-16 **dist-dir lock** (keys on `.next-preview-dev`, not the port): find + kill the stale `next-server` PID, then retry (see the memory note / [MEMO if present]). Load the dev doc: set `localStorage["virgil:force-dev-storage"]="1"`, reload, open `virgil-data/doc_devtest` (the FSA picker is dead inside the preview iframe).
3. **FSA-masking caveat** (critical for the geometry/anchor/marginalia/omni + AI-request-inbox bugs): these **mask in the dev preview and only reproduce under real prod FSA**. For those, verify durability via **unit tests** + the memo's live-recipe, and note that a real-FSA eyeball is still owed rather than claiming a preview pass proves it.
4. Refresh the sample doc if it gets choppy: `rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest`.
5. Optionally run `/code-review` on your diff before committing.

## Orientation docs (read on demand)

- [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) — project spine + the keystroke-sanctity law + the codebase-guide index.
- [docs/architecture/VIRGIL.md](docs/architecture/VIRGIL.md) — canonical "what Virgil is".
- [docs/agents/overview.md](docs/agents/overview.md), [glossary.md](docs/agents/glossary.md), [ui-chrome.md](docs/agents/ui-chrome.md), [main-text.md](docs/agents/main-text.md), [architecture.md](docs/agents/architecture.md).
- [src/STYLE_GUIDE.md](src/STYLE_GUIDE.md) — design system (radius tokens, margin chrome, cards, drag categories). **Update it when a fix generalizes a UI decision** (esp. the radius-token scale).
- [library/AGENTS.md](library/AGENTS.md) — Library subsystem (for the library resizers, PDF view, dashboard, tab corner).
- [editor/AGENTS.md](editor/AGENTS.md) — the AI-request bridge + skill set (for the AI-request pipeline + skill-doctrine bugs; the "find-or-surface" bug edits skill markdown, then `npm run build:editor-bundle`/`build:library-bundle`).

## Autonomy loop

Move through the list roughly in the order above (trivial → focused → clusters → cross-cutting), one bug/cluster per branch. For each: read the memo → confirm the root cause against current code (HEAD moves) → implement the deep fix → verify (tests + preview + note FSA caveat) → commit on the branch → **update the memo's status marker** (e.g. `FIXED (commit X, branch Y, verify owed)`) and the corresponding `memory/*_status.md` + the `MEMORY.md` index line. Skip **bug 3 (offline compile) — DEFERRED**. For the open forks (gutter-grip reveal trigger; footnote-affordance hide-vs-enable), take the memo's recommendation and note it. Keep a compact running progress list (title — STATUS) in your responses. End with an explicit "Done." each turn.

Use the **Workflow** tool for the large cross-cutting passes (the geometry SSOT unification, the radius-token migration, the AI-request pipeline) if you want parallel implement-then-verify fan-out — but land edits on ONE branch (workflow subagents run from the MAIN cwd, not a worktree — see the memory gotcha).
