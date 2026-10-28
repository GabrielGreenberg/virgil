/**
 * DYNAMIC COMMANDS — zero-argument LaTeX control words whose typeset output is
 * COMPUTED (today: `\today`), modelled as one inline atom, `latexDynamic`
 * (task 1335).
 *
 * The direction rule in `latex-typography.ts` (task 380) forbids converting
 * such a command into TEXT: the model would hold "October 27, 2026" and the
 * serializer could never know it was `\today`. An ATOM writes no characters
 * into the document — it holds the command NAME and paints the computed value
 * as a view — so it round-trips by construction. Before this, `\today` was
 * special only as the WHOLE argument of `\date{…}` (a write-only `isToday`
 * flag on the title field, which also threw away any edit to the shown date)
 * and grey `latexCommand` passthrough everywhere else.
 *
 * This module is the import-free leaf both inline parsers, both inline
 * serializers and the node read: the vocabulary ({@link DYNAMIC_COMMANDS}),
 * the parse matcher, the emit rule, and the one "LaTeX today" formatter.
 * A future member (the `\LaTeX` / `\TeX` logo chips are the obvious
 * candidates) joins by adding a row.
 */

import { markWrapSignature, type MarkLike } from "@/lib/mark-composition";

/** LaTeX's default `\today` format: "October 27, 2026". The ONE formatter —
 *  the node's chip, the `\date` insert action and the title paths all read it. */
export function formatLatexToday(date: Date = new Date()): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** The vocabulary: command name (no backslash) → its rendered value. */
export const DYNAMIC_COMMANDS: Readonly<Record<string, () => string>> = {
  today: () => formatLatexToday(new Date()),
};

/** The schema node name. */
export const LATEX_DYNAMIC_NODE = "latexDynamic";

/**
 * How the source TERMINATED the control word, so the round trip is
 * byte-identical: `""` (followed by a non-letter — space, punctuation, `\ `)
 * or `"{}"` (an explicit token break). A freshly inserted chip takes `"{}"`,
 * the spelling that is safe before anything — TeX gobbles the space after a
 * bare control word, so `\today x` would typeset "October 27, 2026x".
 */
export type DynamicTerm = "" | "{}";

/** True when `name` is a dynamic command. */
export function isDynamicCommand(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(DYNAMIC_COMMANDS, name);
}

/** The value a chip shows; the raw command when the name is unknown. */
export function renderDynamicCommand(name: string): string {
  return isDynamicCommand(name) ? DYNAMIC_COMMANDS[name]() : `\\${name}`;
}

/**
 * Match a dynamic command at `src[start]` (which must be `\`). The name is
 * read as TeX reads a control word — a greedy letter run — and compared for
 * EQUALITY, so `\todays` is not ours. One trailing `{}` is the token break
 * (see `matchMacroIn` in latex-typography.ts); a second group is content.
 */
export function matchDynamicCommandAt(
  src: string,
  start: number,
): { command: string; term: DynamicTerm; end: number } | null {
  if (src[start] !== "\\") return null;
  const m = /^[a-zA-Z]+/.exec(src.slice(start + 1));
  if (!m || !isDynamicCommand(m[0])) return null;
  const afterName = start + 1 + m[0].length;
  const term: DynamicTerm = src.startsWith("{}", afterName) ? "{}" : "";
  return { command: m[0], term, end: afterName + term.length };
}

/** The structural shape the emit rule needs of an inline node (JSON). */
interface InlineLike {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  marks?: MarkLike[] | null;
}

/**
 * A `latexDynamic` node's bytes. `next` is the node that follows it in the
 * same inline run. A bare terminator (`""`) is only safe before a non-letter:
 * if a letter now follows directly (the user typed one after the chip), the
 * token break is re-emitted, or the command would read as `\todayx`.
 * "Directly" = the two share a wrapper signature, so the run walker puts no
 * brace between their bytes (`composeInlineRun`); a differing wrapper means a
 * `}` or `\emph{` sits between, which already ends the word. (An anchor
 * marker prefix also starts with `\`; the `{}` there is merely redundant —
 * never wrong — so it is not special-cased.)
 */
export function emitDynamicCommand(node: InlineLike, next?: InlineLike | null): string {
  const command = (node.attrs?.command as string) || "today";
  const term = (node.attrs?.term as string) === "" ? "" : "{}";
  let out = `\\${command}${term}`;
  if (
    term === "" &&
    next?.type === "text" &&
    /^[a-zA-Z]/.test(next.text ?? "") &&
    markWrapSignature(node.marks) === markWrapSignature(next.marks)
  ) {
    out += "{}";
  }
  return out;
}
