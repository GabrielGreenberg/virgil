/**
 * Document class compatibility checks.
 *
 * SwiftLaTeX fails with "Undefined control sequence" when a source uses
 * sectioning commands that its `\documentclass` doesn't define
 * (e.g. `\chapter` inside `article`). We surface that as a prompt before
 * compile so the user can pick a compatible class from a dropdown.
 */

export type SectioningCommand =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph"
  | "subparagraph";

export interface DocumentClassInfo {
  className: string;
  options: string | null;
  /** Start index of the `\documentclass...` match in the source. */
  matchStart: number;
  /** End index (exclusive) of the match in the source. */
  matchEnd: number;
}

export interface DocumentClassMismatch {
  currentClass: string;
  /** Which sectioning commands the current class doesn't support. */
  offenders: SectioningCommand[];
  /** Classes that would accept every offender. Ordered by closeness. */
  suggestions: string[];
}

const DOCUMENTCLASS_RE =
  /\\documentclass(?:\s*\[([^\]]*)\])?\s*\{([^}]+)\}/;

/**
 * Pull the first `\documentclass{...}` (with optional `[options]`) out
 * of a LaTeX source. Returns null if none is present — e.g. a bare
 * snippet without a preamble.
 */
export function extractDocumentClass(latex: string): DocumentClassInfo | null {
  const m = latex.match(DOCUMENTCLASS_RE);
  if (!m) return null;
  const matchStart = m.index ?? 0;
  return {
    className: m[2].trim(),
    options: m[1] ?? null,
    matchStart,
    matchEnd: matchStart + m[0].length,
  };
}

/**
 * Replace the `\documentclass{…}` in a LaTeX source with a new class,
 * preserving the original `[options]` list (11pt, a4paper, etc.).
 * No-op if no documentclass is present.
 */
export function rewriteDocumentClass(latex: string, newClass: string): string {
  const info = extractDocumentClass(latex);
  if (!info) return latex;
  const optsPart = info.options != null ? `[${info.options}]` : "";
  const replacement = `\\documentclass${optsPart}{${newClass}}`;
  return latex.slice(0, info.matchStart) + replacement + latex.slice(info.matchEnd);
}

// Sectioning commands a class accepts. `letter` has none. `beamer` allows
// \part/\section/\subsection for navigation but no \chapter. `slides` is
// article-shaped.
const CLASS_COMMANDS: Record<string, Set<SectioningCommand>> = {
  article: new Set(["part", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]),
  slides: new Set(["part", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]),
  report: new Set(["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]),
  book: new Set(["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]),
  memoir: new Set(["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]),
  letter: new Set(),
  beamer: new Set(["part", "section", "subsection", "subsubsection"]),
};

/**
 * Classes that, between them, cover every sectioning command users
 * commonly reach for. Unknown classes (custom .cls files, journal
 * templates that wrap article/report) are left alone — we can't know
 * what they support.
 */
function isKnownClass(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CLASS_COMMANDS, name);
}

/**
 * Scan the body (post-preamble) for sectioning commands. We look at the
 * whole source and not just `\begin{document}`…`\end{document}` because
 * some templates `\input{...}` files that reference these commands; the
 * failure mode we care about (undefined control sequence) triggers the
 * same way regardless of where the command lives.
 *
 * Ignores commands inside `%` line comments and inside `\verb|...|` /
 * verbatim environments — those wouldn't actually be executed, so
 * flagging them would be a false positive.
 */
export function findSectioningCommands(latex: string): Set<SectioningCommand> {
  const stripped = stripCommentsAndVerbatim(latex);
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\b\*?\s*[\{\[]/g;
  const found = new Set<SectioningCommand>();
  for (const m of stripped.matchAll(re)) {
    found.add(m[1] as SectioningCommand);
  }
  return found;
}

function stripCommentsAndVerbatim(latex: string): string {
  // Drop %-comments (respecting escaped \%).
  let out = "";
  for (const line of latex.split("\n")) {
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "\\" && i + 1 < line.length) {
        out += ch + line[i + 1];
        i += 2;
        continue;
      }
      if (ch === "%") break;
      out += ch;
      i++;
    }
    out += "\n";
  }
  // Drop verbatim environments — a conservative pass; nested verbatims
  // aren't a thing so this is safe.
  out = out.replace(/\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g, "");
  // Drop \verb|…| and \verb*|…| inline runs. Delimiter is the char after
  // \verb (commonly | or !).
  out = out.replace(/\\verb\*?(.)[\s\S]*?\1/g, "");
  return out;
}

/**
 * Check whether the document's `\documentclass` supports every
 * sectioning command it uses. Returns null when there's no mismatch,
 * or when we don't recognise the class (best-effort: stay silent
 * rather than nag about a custom journal .cls).
 */
export function detectDocumentClassMismatch(
  latex: string,
): DocumentClassMismatch | null {
  const cls = extractDocumentClass(latex);
  if (!cls) return null;
  if (!isKnownClass(cls.className)) return null;

  const used = findSectioningCommands(latex);
  const supported = CLASS_COMMANDS[cls.className];
  const offenders: SectioningCommand[] = [];
  for (const cmd of used) {
    if (!supported.has(cmd)) offenders.push(cmd);
  }
  if (offenders.length === 0) return null;

  return {
    currentClass: cls.className,
    offenders,
    suggestions: suggestClasses(cls.className, offenders),
  };
}

/**
 * Suggest classes that accept every offending command. We bias toward
 * classes that are close to the current one so switching doesn't
 * reshape the document more than it has to — e.g. `article → report`
 * (same shape, adds chapters) sits ahead of `article → book` (adds
 * chapters *and* two-sided margins/frontmatter conventions).
 */
function suggestClasses(
  current: string,
  offenders: SectioningCommand[],
): string[] {
  const candidates = Object.keys(CLASS_COMMANDS).filter((name) => {
    if (name === current) return false;
    const supported = CLASS_COMMANDS[name];
    return offenders.every((cmd) => supported.has(cmd));
  });

  const preferenceOrder: Record<string, string[]> = {
    article: ["report", "book", "memoir"],
    slides: ["report", "book", "memoir"],
    letter: ["article", "report", "book"],
    beamer: ["report", "book", "memoir"],
    report: ["book", "memoir"],
    book: ["report", "memoir"],
  };
  const preferred = preferenceOrder[current] ?? [];
  return [
    ...preferred.filter((n) => candidates.includes(n)),
    ...candidates.filter((n) => !preferred.includes(n)),
  ];
}
