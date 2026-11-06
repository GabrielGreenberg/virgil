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
 * byte-identical:
 *  - `""` — followed directly by a non-letter, non-space byte (punctuation,
 *    `\ `, `~`, a brace, end of input);
 *  - `"{}"` — an explicit token break;
 *  - a WHITESPACE run (`" "`, `"  "`, `" \n"`, …) — the spaces TeX SKIPS after
 *    a control word (task 1492). The run belongs to the command, not to the
 *    text after it: TeX never typesets it, so the editor must not show it
 *    either. `\today x` therefore reads as chip + "x" and prints "…2026x" in
 *    both places, and re-emits byte-identically from the term.
 * A freshly inserted chip takes `"{}"`, the spelling that is safe before
 * anything — TeX gobbles the space after a bare control word, so `\today x`
 * would typeset "October 27, 2026x".
 */
export type DynamicTerm = string;

/** The whitespace TeX skips after a control word: spaces/tabs and at most ONE
 *  line end (a second would be a blank line — `\par` — and never reaches an
 *  inline run anyway). */
const SKIPPED_SPACE = /^[ \t]*(?:\r?\n[ \t]*)?/;

/** True when a term is a gobbled whitespace run (not `""` / `"{}"`). */
function isSpaceTerm(term: string): boolean {
  return term !== "" && term !== "{}" && SKIPPED_SPACE.exec(term)?.[0] === term;
}

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
 * Otherwise the whitespace TeX skips after the word is absorbed into the term
 * (task 1492) — see {@link DynamicTerm}.
 */
export function matchDynamicCommandAt(
  src: string,
  start: number,
): { command: string; term: DynamicTerm; end: number } | null {
  if (src[start] !== "\\") return null;
  const m = /^[a-zA-Z]+/.exec(src.slice(start + 1));
  if (!m || !isDynamicCommand(m[0])) return null;
  const afterName = start + 1 + m[0].length;
  const term: DynamicTerm = src.startsWith("{}", afterName)
    ? "{}"
    : (SKIPPED_SPACE.exec(src.slice(afterName))?.[0] ?? "");
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
 * same inline run. TeX ends a control word at the first non-letter and then
 * SKIPS every space after it, so a term other than `{}` is only safe while
 * the text that directly follows is neither a letter (`\todayx` would be one
 * word) nor whitespace (the editor shows a space the PDF would gobble — task
 * 1492). When one now follows (the user typed it after the chip), the token
 * break is re-emitted:
 *  - a bare term (`""`) appends `{}` — `\today{}x`, `\today{} x`;
 *  - a gobbled-space term before more whitespace becomes `{}` — the gobbled
 *    run was never shown, so `\today{}` + the typed space is exactly what the
 *    editor displays. (A space term before a LETTER is already a token break.)
 * "Directly" = the two share a wrapper signature, so the run walker puts no
 * brace between their bytes (`composeInlineRun`); a differing wrapper means a
 * `}` or `\emph{` sits between, which already ends the word. (An anchor
 * marker prefix also starts with `\`; the `{}` there is merely redundant —
 * never wrong — so it is not special-cased.)
 */
export function emitDynamicCommand(node: InlineLike, next?: InlineLike | null): string {
  const command = (node.attrs?.command as string) || "today";
  const raw = node.attrs?.term;
  const term = raw === "" || (typeof raw === "string" && isSpaceTerm(raw)) ? raw : "{}";
  if (term === "{}") return `\\${command}{}`;
  const abuts =
    next?.type === "text" &&
    markWrapSignature(node.marks) === markWrapSignature(next.marks);
  const head = abuts ? (next!.text ?? "") : "";
  if (term === "") {
    return /^[a-zA-Z\s]/.test(head) ? `\\${command}{}` : `\\${command}`;
  }
  return /^\s/.test(head) ? `\\${command}{}` : `\\${command}${term}`;
}
