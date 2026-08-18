# Handoff — P5 item 4: move diagnostics ownership to per-doc scope (the last compile-hardening residual)

**Status:** deferred from the compile-hardening merge (main `880a9217`, now under `a783ff98`).
Everything else in P1–P6 landed + verified. This is the one remaining piece.

**⚠️ COORDINATE FIRST — likely overlaps an existing project.** Memory
`code_view_rework_status` describes branch **`worktree-code-view-rework`** as *"one diagnostics
owner, mode-aware jump, cursor band, sync arrows."* That is the SAME refactor this handoff needs.
Before starting: check that branch/worktree. This work should probably land THERE (or be reconciled
with it) rather than as a fresh parallel effort. Do not duplicate it.

---

## What this fixes (the bug still live on main)

Diagnostics (lint errors, error-card source snippets, jump-to-paragraph anchors, highlight ranges)
are **empty until the code view has been opened once in the session.** A user working only in the
visual editor who hits Compile on a failing paper gets error cards with **no snippet and a dead jump
target**, and **zero lint diagnostics** — the whole lint/snippet/anchor surface is silently degraded
because a sibling view was never mounted.

**Root cause:** every piece of diagnostics state lives in `EditorLayout` — the **un-keyed shell** that
survives doc switches — and the source feed `codeEditorText` is written ONLY by `CodeEditor.onTextChange`,
so it is `null` until `CodeEditor` mounts (code view). The real per-doc owner, `EditorPane`, is remounted
via `key={currentDocId}` and holds the live editor to serialize from — but it doesn't own diagnostics.

## What already landed (so this handoff is ONLY the ownership move)

P5 delivered the parser + id + log-surface half (merged): robust `parse-tex-log.ts` (79-col unwrap,
file-nesting, tightened `!`, `status!=0 && 0-records` fallback), collision-free ids + `pruneDismissed`
(`src/lib/diagnostics-store.ts`), and the raw compile log reachable in the docked panel
(`CompileLogDisclosure.tsx`). Those are DONE. **Do not redo them.** This handoff is item 4 only.

## The change

Move diagnostics ownership from the `EditorLayout` shell into the per-doc `EditorPane` scope, and feed
lint/snippets/anchors from a **doc-agnostic `sourceText`** derived by serializing the LIVE editor —
independent of whether the code view is mounted.

- **Source feed:** compute `sourceText = serializeToLatex(editor.getJSON(), { preamble, postamble })`
  — the SAME feed `CodeEditor` already uses (see `src/components/CodeEditor.tsx`, the `serializeToLatex`
  call ~L158, incl. full preamble+postamble via `extractPreambleAndPostamble` so line numbers align with
  the compile log / snippets / paragraph map). Reuse the EXISTING 1500 ms debounce — do NOT serialize
  per keystroke (keystroke-sanctity). Feed this into `useLatexLint` instead of `codeEditorText`.
- **Move into `EditorPane`** (already owns `compileHook` + PDF state after P6): `lintErrors`,
  `dismissedErrorIds` (+ `pruneDismissed` against the live id set), `selectedErrorId`, `expandedErrorIds`,
  `errorSnippets`, `paragraphByErrorId`, `computeErrorHighlightRange`. Reset becomes automatic — it's a
  structural consequence of the `key={currentDocId}` remount (kills the cross-doc dismissal-leak too).
- **Remove** the shell-owned diagnostics block from `EditorLayout` (`codeEditorText` /
  `handleCodeEditorTextChange` and the derived memos). `CodeEditor.onTextChange` can still refresh the
  same `sourceText` while open, but must no longer be the SOLE source.

## Why it was deferred (the entanglements to plan for)

The agent that landed P5/P6 stopped here deliberately rather than leave the tree half-refactored:

1. **`jumpToError` is mode-aware** and reads layout-level state: `codeView`/`pdfView`/`setPdfView`,
   `pendingParagraphId`/`pendingScrollText`, `codeEditorHandleRef`, `editorRef`,
   `computeErrorHighlightRange`. Moving the data without moving/adapting `jumpToError` breaks jump.
2. **Fan-out:** the diagnostics props thread to ~7 `EditorPane` sub-component call sites **plus the omni
   mirror**, all under ONE shared expand/select owner — the invariant the design flagged as top risk.
   (The omni mirror must stay excluded from the compile-log disclosure feed, as it is today.)
3. The doc-agnostic `sourceText` feed is the same relocation `worktree-code-view-rework` is doing — hence
   the coordination note above (P5 design fork Q1 explicitly staged this AFTER the parser/id/log pieces).

## Files (reference by symbol — line numbers shifted post-merge)

- `src/components/EditorLayout.tsx` — current owner of `codeEditorText`, `lintErrors`,
  `dismissedErrorIds`, `selectedErrorId`, `errorSnippets`, `paragraphByErrorId`,
  `computeErrorHighlightRange`, `jumpToError`, `handleCodeEditorTextChange`.
- `src/components/EditorPane.tsx` — destination owner (has the live editor + `compileHook`).
- `src/hooks/useLatexLint.ts` — change its input from `codeEditorText` to the serialized `sourceText`.
- `src/components/CodeEditor.tsx` — the `serializeToLatex(editor.getJSON(), {preamble, postamble})`
  pattern to mirror; keep it refreshing `sourceText` while open (no longer the sole source).
- `src/lib/latex-serializer.ts` (`serializeToLatex`, `extractPreambleAndPostamble`),
  `src/lib/latex-paragraph-map.ts` (`findParagraphUuids`/`paragraphForLine`),
  `src/lib/diagnostics-store.ts` (`pruneDismissed` — already exists, wire it in),
  `src/panels/Errors/*` + `src/components/editor-layout/panels/errors-host.tsx`.
- **Keystroke-sanctity:** if the serialize-on-update path adds/moves an `editor.on('update'|'transaction')`
  subscriber, update BOTH `AGENTS.md`'s permitted-subscriber list AND
  `src/lib/__tests__/keystroke-subscriber-guardrail.test.ts` with the O(1) justification. Prefer reusing
  the existing debounced path so no new subscriber is needed.

## Verification

- **Repro the bug first** (to confirm it's still live): fresh session, open a paper, do NOT open the code
  view, Compile a paper with a lint/compile error → today the error cards have no snippet and the jump is
  dead / lint is empty. After the fix: snippets + working jump-to-paragraph + lint all present with the
  code view never opened.
- Cross-doc: dismiss an error in doc A, switch to doc B → the dismissal must NOT leak (auto-reset via the
  per-doc remount).
- Unit: extend the Errors-panel + a new EditorPane-diagnostics test; keep `keystroke-subscriber-guardrail`
  + `scroll-reposition-guardrail` green; `npx tsc --noEmit` clean; full `vitest run` green.
- Live (worktree preview + a dev doc): confirm typing N plain chars leaves `window.__virgilBusStats()`
  `emitCount` flat (no per-keystroke serialize regression).

## Suggested kickoff prompt

> Read `code_view_rework_status` memory + the `worktree-code-view-rework` branch first — this P5 item 4
> (per-doc diagnostics ownership + source-agnostic lint feed) likely belongs there. If landing fresh:
> move diagnostics state from `EditorLayout` into per-doc `EditorPane`, feed `useLatexLint` from
> `serializeToLatex(editor.getJSON(),{preamble,postamble})` (reuse CodeEditor's pattern + the 1500ms
> debounce), and adapt the mode-aware `jumpToError` + the ~7-call-site/omni-mirror fan-out. Repro the
> "empty diagnostics until code view opened" bug first; verify it's fixed with the code view never opened.

Context: full audit `MEMO_COMPILE_SYSTEM_AUDIT_2026_07_05.md` (on main); status `compile_hardening_status`
memory.
