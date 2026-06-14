/**
 * Shared `\footnote{…}` typed-LaTeX trigger pattern.
 *
 * The footnote analog of `cite-commands.ts`'s `CITE_RE_FULL`: a single leaf
 * module (no React / DOM / TipTap imports) so the typed-input rule
 * (`src/lib/tiptap/footnote.ts`) AND the action registry
 * (`src/lib/actions/action-registry.ts`) reference the SAME regex. Centralizing
 * it ensures the typed surface and the registry row can never recognize a
 * different footnote vocabulary, and keeps the registry importable in node-env
 * vitest without pulling the TipTap editor graph in.
 *
 * Matches a completed `\footnote{<body>}` ending at the caret — anchored with
 * `$` because the input rule runs in `handleTextInput` on the closing `}` and
 * tests the text immediately before the cursor. `<body>` is brace-free
 * (`[^}]*`), matching the original inline regex in `footnote.ts`.
 */
export const FOOTNOTE_RE_FULL = /\\footnote\{([^}]*)\}$/;
