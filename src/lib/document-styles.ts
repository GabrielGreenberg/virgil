/**
 * Document style registry — named LaTeX preamble presets selectable from
 * the Virgil bar. Switching style rewrites the bytes before
 * `\begin{document}` in the doc's `.tex` file. Body and postamble are
 * untouched. Whatever the user had in their preamble (custom packages,
 * etc.) is intentionally discarded — that's the point of switching.
 *
 * The Virgil entity-id markers (`\vfid`/`\vcid`/`\vexid`) are injected at
 * serialize time by `ensureVirgilCommands` in latex-serializer.ts, so
 * preset preambles don't need to declare them. They can if it makes the
 * preamble more self-contained on disk; duplicates are a no-op.
 */

export const CLASSIC_PREAMBLE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}

% Virgil entity-id markers — no-op commands that carry stable UUIDs for
% inline entities (footnotes, citations, examples) across .tex parse
% cycles. Without these, every re-parse regenerates the ids and any UI
% state keyed by them (e.g. popped-out cards) becomes stale.
\\providecommand{\\vfid}[1]{}
\\providecommand{\\vcid}[1]{}
\\providecommand{\\vexid}[1]{}

\\begin{document}

`;

// Placeholder until the user supplies the Greenberg preamble. Equal to
// CLASSIC_PREAMBLE for now so switching to it is a no-op visually but the
// dropdown selection still round-trips through the sidecar.
const GREENBERG_PREAMBLE_TODO = CLASSIC_PREAMBLE;

export type DocumentStyleId = "classic" | "greenberg";

export interface DocumentStyle {
  id: DocumentStyleId;
  /** Display name shown in the Virgil bar dropdown. */
  name: string;
  /** Injected verbatim. Must end with `\\begin{document}\\n\\n`. */
  preamble: string;
}

export const DOCUMENT_STYLES: DocumentStyle[] = [
  { id: "classic", name: "Classic", preamble: CLASSIC_PREAMBLE },
  { id: "greenberg", name: "Greenberg", preamble: GREENBERG_PREAMBLE_TODO },
];

export const DEFAULT_STYLE_ID: DocumentStyleId = "classic";

export function getStyle(id: string | undefined | null): DocumentStyle {
  return (
    DOCUMENT_STYLES.find((s) => s.id === id) ??
    DOCUMENT_STYLES.find((s) => s.id === DEFAULT_STYLE_ID)!
  );
}
