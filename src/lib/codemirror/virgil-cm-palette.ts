/**
 * The ONE colour palette for Virgil's CodeMirror surfaces (task 2026-10-23-1245).
 *
 * Every CodeMirror mount — the code view (`CodeEditor.tsx`), the source pod
 * (`source-pod-code-mirror.tsx`) and the style editor (`StyleEditorModal.tsx`)
 * — builds its own `EditorView.theme({...})`. Until this module, all three
 * hand-spelled the same palette as raw literals (`--accent` at five alphas,
 * `--code-block-bg` as a hex), so a retune of either token left every code
 * surface behind. Each theme now spreads these fragments and keeps only its
 * own GEOMETRY (font size, padding, border, insets); every colour here is a
 * `var(--token)` or a `color-mix` of one. `color-token-consumers.test.ts`
 * ("CodeMirror surfaces carry no raw colour literal") pins the family.
 */

/** `--accent` at an alpha — the selection / bracket / active-line washes. */
const accentAt = (pct: number) =>
  `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;

/** Caret, cursor, selection (blurred + focused) and the matching bracket —
 *  every CodeMirror surface carries these. */
export const CM_PALETTE_CORE = {
  ".cm-content": { caretColor: "var(--accent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground": {
    backgroundColor: `${accentAt(15)} !important`,
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: `${accentAt(20)} !important`,
  },
  ".cm-matchingBracket": {
    backgroundColor: accentAt(20),
    outline: `1px solid ${accentAt(40)}`,
  },
} as const;

/** The line-number gutter + active-line washes — surfaces that show a gutter.
 *  The active-line GUTTER cell has no token of its own: it is the gutter
 *  colour darkened 5% toward `--foreground` (≈ the old `#eae7e3`), so it
 *  follows a `--code-block-bg` retune instead of stranding a third hex. */
export const CM_PALETTE_GUTTERS = {
  ".cm-gutters": {
    backgroundColor: "var(--code-block-bg)",
    color: "var(--muted-light)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter": {
    backgroundColor:
      "color-mix(in srgb, var(--code-block-bg) 95%, var(--foreground))",
    color: "var(--muted)",
  },
  ".cm-activeLine": { backgroundColor: accentAt(4) },
} as const;

/** The code view's cursor band (`src/lib/code-band.ts`): a PASSIVE wash over
 *  the source lines of the text-object under the TipTap caret. It is not an
 *  alarm — it borrows the `--danger` hue only because the band was designed
 *  light-red, kept as-is; moving it onto `--accent` (the "where the caret is"
 *  role, 10-audit.md item 8) would be a visual decision, not a sweep. */
export const CM_CURSOR_BAND_BG =
  "color-mix(in srgb, var(--danger) 9%, transparent)";

/** The code view's "Edits paused — LaTeX parse error" banner: an amber
 *  warning chip read from the `--amber-*` scale. */
export const CM_PARSE_BANNER_STYLE = {
  background: "color-mix(in srgb, var(--amber-600) 8%, transparent)",
  borderColor: "color-mix(in srgb, var(--amber-600) 30%, transparent)",
  color: "var(--ink-body)",
} as const;

type ThemeSpec = Record<string, Record<string, string>>;

/** A surface's theme spec = its own geometry ∪ the palette fragments it
 *  carries, merged PER SELECTOR (a theme's `.cm-content` padding and the
 *  palette's `.cm-content` caret colour land in one rule). Pass the result to
 *  `EditorView.theme`. */
export function withCmPalette(
  geometry: ThemeSpec,
  ...fragments: ThemeSpec[]
): ThemeSpec {
  const out: ThemeSpec = {};
  for (const spec of [...fragments, geometry]) {
    for (const [sel, decls] of Object.entries(spec)) {
      out[sel] = { ...out[sel], ...decls };
    }
  }
  return out;
}
