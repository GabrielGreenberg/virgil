/**
 * Cross-reference command vocabulary — the ONE table (task 1372).
 *
 * A `labelRef` atom carries `refCommand`, the name of the LaTeX command it
 * round-trips through. Every layer that reads or writes that name reads it
 * here: the main parser and the footnote-body parser (`matchRefCommandAt`),
 * the main serializer and the footnote-body serializer (`refCommandLatex`),
 * the requirement collector's expex row (`refCommandsRequiring`), the ref
 * popover's toggle (`REF_COMMAND_NAMES`) and the display resolver
 * (`formatRefDisplay` in `ref-display.ts`, via `REF_COMMANDS[cmd].display`).
 *
 * Before this table the parser regex and the serializer `if`-chain were two
 * hand lists with nothing pinning them equal, and the serializer's fallback
 * rewrote any name it did not list to `\ref` — so a name added to the parser
 * alone would have parsed into a `labelRef` and SAVED as `\ref`, a silent
 * byte change. An unlisted name is now kept verbatim (it is still a valid
 * LaTeX command name), and a value that is not a command name at all is
 * unrepresentable (`refCommandLatex` returns null; callers refuse).
 *
 * Adding a command: add a row. The parser alternation, the serializer, the
 * popover and the requirement detector all follow.
 */

export interface RefCommandSpec {
  /** The package the command needs in the preamble; null = LaTeX kernel. */
  requires: "expex" | null;
  /** How the atom shows its resolved number: bare `3`, or parenthesized `(3)`. */
  display: "bare" | "paren";
}

export const REF_COMMANDS = {
  // "ref" → \ref{…} (bare number, e.g. "3" / "2.1")
  ref: { requires: null, display: "bare" },
  // "getref" → \getref{…} (parenthesized, e.g. "(3)") — expex
  getref: { requires: "expex", display: "paren" },
  // "getfullref" → \getfullref{…} (dotted sub-item; rendered as "(3b)") — expex
  getfullref: { requires: "expex", display: "paren" },
} as const satisfies Record<string, RefCommandSpec>;

export type RefCommand = keyof typeof REF_COMMANDS;

/** Every ref command, in the table's (UI) order. */
export const REF_COMMAND_NAMES = Object.keys(REF_COMMANDS) as RefCommand[];

/** The atom's default command (an empty / missing attr means this). */
export const DEFAULT_REF_COMMAND: RefCommand = "ref";

export function isRefCommand(name: unknown): name is RefCommand {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(REF_COMMANDS, name);
}

/** Narrow an untyped attr/event value to a known command, else the default. */
export function toRefCommand(name: unknown): RefCommand {
  return isRefCommand(name) ? name : DEFAULT_REF_COMMAND;
}

/** The commands whose preamble requirement is `pkg` (for detector regexes). */
export function refCommandsRequiring(pkg: RefCommandSpec["requires"]): RefCommand[] {
  return REF_COMMAND_NAMES.filter((n) => REF_COMMANDS[n].requires === pkg);
}

// Longest-first alternation so a name never matches as a prefix of a longer
// one (same convention as `cite-commands.ts`). The required `{` right after
// the name is the boundary guard: `\refx{` and `\reference{` never match.
const REF_COMMAND_RE = new RegExp(
  `^\\\\(${[...REF_COMMAND_NAMES].sort((a, b) => b.length - a.length).join("|")})\\{`,
);

/** Match `\<refcmd>{` at the start of `rest`. `openLength` is the length of
 *  the matched `\cmd{` (so the `{` sits at offset `openLength - 1`). */
export function matchRefCommandAt(
  rest: string,
): { command: RefCommand; openLength: number } | null {
  const m = REF_COMMAND_RE.exec(rest);
  if (!m) return null;
  return { command: m[1] as RefCommand, openLength: m[0].length };
}

const COMMAND_NAME_RE = /^[a-zA-Z]+$/;

/**
 * The LaTeX for a `labelRef` atom with `refCommand` = `cmd`, plus the package
 * it requires. An empty / missing command is the default `\ref`; a name not in
 * the table is emitted VERBATIM (never degraded to `\ref`) with no declared
 * requirement; a value that is not a command name returns null — the caller
 * refuses rather than emit something the parser will not read back.
 */
export function refCommandLatex(
  cmd: unknown,
  label: string,
): { latex: string; requires: RefCommandSpec["requires"] } | null {
  const name = cmd == null || cmd === "" ? DEFAULT_REF_COMMAND : cmd;
  if (typeof name !== "string" || !COMMAND_NAME_RE.test(name)) return null;
  const requires = isRefCommand(name) ? REF_COMMANDS[name].requires : null;
  return { latex: `\\${name}{${label}}`, requires };
}
