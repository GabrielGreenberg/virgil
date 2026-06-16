# MEMO — Code View Full Rework

**Started:** 2026-06-15 · **Worktree:** `.claude/worktrees/code-view-rework` (branch
`worktree-code-view-rework`, based on `055688e` Release v0.1.54) · **Manager session.**

This is the durable record of the code-view full-dress review / unification. On resume,
read this top-to-bottom, then check the **Status** table for the next chip.

---

## Goal (user's 12 asks, condensed)

Full review + deep architectural rework of **code view** (the CodeMirror LaTeX-source
pane beside TipTap). UI + functionality. Specifically:
1. Editor well-positioned with proper left padding in code view; **hide L/R panel strips**.
2. Error handling tested + driven: clicking an error card goes to the error, not somewhere confusing.
3. Error cards inside code view **STAY in code view**.
4. Cursor in text-object X (TipTap) → **light-red horizontal band** over X's source in CodeMirror.
5. **Arrow buttons on the divider** = **manual position sync** (NOT collapse). One arrow:
   code cursor → move text to match. Other: text cursor → move code to match.
   **Corollary: panes must NOT auto-align in general.**
6. Other code-view uses smooth: edits register both ways, etc.
7. Compile with errors, chase them, helpful display, **no duplication**, good links to text.
8. Manager session; run work via workflows/chips; verify everything directly.
9. Keep this memo.
10. **CENTRAL DESIGN PRINCIPLE: unified, deep, architectural solutions** — no surgical patches.
11. Work in a worktree (concurrent main checkout; user won't touch code view / error panel).
12. Autonomous; quarantine judgment calls to the end.

## Settled decisions
- Arrows = manual sync; **remove auto cursor/scroll align** (keep content sync + open-time scroll).
- Hide L/R panel strips entirely in code view; restore on close.
- **Full unification** of the two error subsystems.

---

## Architecture findings (the WHY)

**Code editor:** CodeMirror 6 (`@uiw/react-codemirror`) in `src/components/CodeEditor.tsx`.
**Split:** `src/components/editor-layout/split-with-code.tsx` (`SplitWithCode`), divider is
a `drag-gap drag-gap-v` div; compression state via `CodePaneSplitContext`.
**Sync bridge:** `src/lib/code-pane-bridge.ts` — bidirectional. Content sync (parse/serialize,
debounced, echo-guarded) AND cursor/selection sync (RAF-coalesced, **auto** — to be removed).
**UUID↔source:** serializer emits `%!v:<4hex>` markers; `src/lib/latex-paragraph-map.ts`
(`findParagraphUuids`, `paragraphForLine`) reconstructs ranges. No cache layer yet.

**THE root defect — two parallel error subsystems for the same doc:**
- `EditorLayout.tsx:528` `useLatexCompile` → code-view sidebar; lint+compile merged at
  `:1463`; `paragraphByErrorId`/`errorSnippets` **populated** at `:1566`/`:1581`;
  `jumpToError` at `:1650` **forces `setCodeView(false)`** ("always switches to rich-text").
- `EditorPane.tsx:1058` a **second** `useLatexCompile`; `allLatexErrors = compileHook.compileErrors`
  (**compile-only**) at `:1488`; `paragraphByErrorId`/`errorSnippets` are **empty maps** at
  `:1498-1499`; `handleJumpToError` is a **no-op stub** at `:1500`.
- Compile button = `vbar.compilePdf` = `paneState.compilePdf` = EditorPane's hook
  (`EditorLayout.tsx:3411`, `:4212`). So the code-view sidebar's compile list is likely
  never populated; visual-editor errors can't navigate (empty maps + no-op jump).

Data model is already unified (`src/lib/latex-errors.ts` `LatexError` + `makeErrorId`); only
the *plumbing* is doubled. → unify the plumbing.

**Compile pipeline:** `useLatexCompile.ts` — SwiftLaTeX pdfTeX, `parseTexLog` (`src/lib/parse-tex-log.ts`),
patterns: `!`=error, `LaTeX Warning:`, `Package Warning:`. Bib → 3 passes.

---

## The deep spine (3 unifying layers)

- **S1 `src/lib/code-position-map.ts` (NEW):** cached UUID↔line/char map wrapping
  `findParagraphUuids`/`paragraphForLine`. Used by bridge, band, error-mapping, scroll-to-para.
- **S2 `DiagnosticsProvider`/`useDiagnostics()` (NEW context):** single compile + lint + merged
  **deduped** error list + maps + selection/dismiss/expand + ONE mode-aware `jumpToError`.
  Delete EditorPane's duplicate hook/empty-maps/no-op stub; rewire Compile button + paneState.
- **S3 mode-aware `jumpToError`:** code view → `scrollToLine` + STAY; visual → `scrollToParagraphId`
  + `errorHighlightRange`; pdf → restore editor then jump.

---

## Chip plan + STATUS

| Chip | What | Status |
|------|------|--------|
| 0 | Worktree + memo + dev-doc/preview setup | DONE |
| A | `code-position-map.ts` (S1) + refactor 3 call sites + tests | DONE (e3cdd54) |
| B1 | Unify compile SOURCE: kill EditorLayout dead hook, bubble via paneState, mergeLatexErrors dedup | DONE (2a0f3c0) |
| B2+C | Single error owner (EditorLayout) via props; mode-aware jumpToError (stay-in-code-view) | DONE (932d1fd) |
| D | Code-side cursor band (issue 4): `src/lib/code-band.ts` + `.cm-virgil-band`, decorate-only | DONE (930271b) |
| E | Manual sync arrows + remove auto-align (issue 5 + corollary) | DONE (930271b, with D) |
| F | Code-view layout: comfortable 48px gutter (strips already gated on !codeSplit.active) | DONE (a37a7bb) |
| G | nXn verification matrix (issues 6,7) in live preview | IN PROGRESS |
| H | Full tests + typecheck/lint + docs/agents drift + finalize memo | pending |

All code chips (A–F) committed on branch `worktree-code-view-rework`. Full vitest green after each;
typecheck clean. Commits: A e3cdd54 · B1 2a0f3c0 · B2+C 932d1fd · D+E 930271b · F a37a7bb.

### Preview (Chip G)
Added a `code-view-rework` config to MAIN's `.claude/launch.json` (gitignored — safe; cd's into the
worktree, port 3010, `.next-preview` dist). `preview_start name="code-view-rework"` → serverId varies.
Gabriel works concurrently in MAIN (committed `d9754dd` mid-session) — NEVER touch main's commits.

### ⚠️ GOTCHA #2: Bash cwd drifts back to MAIN on turn boundaries
Even after `EnterWorktree(path)`, the shell cwd reverts to `/Users/gabriel/Programming/virgil` (main)
across user turns. A bare `git commit` then runs in MAIN. **ALWAYS use `git -C <worktree>` and absolute
worktree paths for every git/file op.** (Edit-tool absolute paths land correctly; only bare-cwd git is
the hazard.) Chip F edits were fine (absolute paths); only the bare commit mis-fired and was redone with
`git -C`.

Foundation A→B→C DONE; full vitest suite green; typecheck clean. D+E delegated together (both
rewire the bridge's selection handling). F separable.

### Findings confirmed during B (for the record)
- EditorLayout's `useLatexCompile` (was line 528) was **dead** — `compilePdf` never called;
  toolbar uses `paneState.compilePdf` = EditorPane's live hook. So code-view sidebar showed only
  lint, log drawer always blank. EditorPane's live hook now bubbles `compileErrors/compileLog/
  compileStatus` via `paneState`; EditorLayout is the single error owner.
- PDF render uses EditorLayout's own `pdfBlobUrl` (iframe ~4347) populated by `switchToPdfView`
  reading the `.pdf` from disk (the live hook writes it). PDF flow LEFT UNTOUCHED.
- The `virgil-error-marker-click` window event is handled by `event-bridges/marker-clicks.ts`
  (has tests) and already routes selection to EditorLayout's `setSelectedErrorId`.

### ⚠️ GOTCHA: subagent cwd
After a path-based `EnterWorktree` re-entry, a delegated subagent edited the **MAIN** checkout, not
the worktree (B2). Recovery that worked: `git -C <main> diff <files> > /tmp/x.patch`; revert main
(`git -C <main> checkout -- <files>`); `git apply` the patch in the worktree (resolve dup `noop`).
**Mitigation:** tell subagents to use ABSOLUTE worktree paths + self-check `git -C <worktree> status`;
verify placement (worktree dirty, main clean) after every subagent before committing.

---

## Verification notes (preview gotchas, from memory)
- Refresh dev doc: `rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest`.
- Preview "No document open" ⇒ `localStorage.setItem('virgil:force-dev-storage','1')` then reload. Don't clear storage.
- Resize iframe off 0×0 (hover-zone math). Turbopack serves stale chunks → restart preview.
- Live editor: `parentElement.__reactFiber$ → PureEditorContent.editor`. Keystroke sanctity:
  `window.__virgilBusStats()` — `emitCount` flat on plain typing.

## Verification matrix results
_(filled during Chip G)_

---

## Open judgment calls (quarantined for end)
- Band scope = enclosing text-object only (default). Reverse band (code→text highlight) not requested — deferred.
- Arrow glyph orientation must match live layout (text=left, code=right) — verify on real pane.
