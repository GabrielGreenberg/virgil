/**
 * Document class compatibility checks.
 *
 * SwiftLaTeX fails with "Undefined control sequence" when a source uses
 * sectioning commands that its `\documentclass` doesn't define
 * (e.g. `\chapter` inside `article`). We surface that as a prompt before
 * compile so the user can pick a compatible class from a dropdown.
 */

import {
  projectLiveLatex,
  VERBATIM_ENVS_FULL,
} from "@/lib/latex-lexer";

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

const DOCUMENTCLASS_RE_G =
  /\\documentclass(?:\s*\[([^\]]*)\])?\s*\{([^}]+)\}/g;

/**
 * Whether the `\documentclass` at raw offset `matchStart` is LIVE (not inside
 * a `%`-comment or a verbatim-family environment). Determined by projecting
 * the source's comment/verbatim inertness away and checking whether a
 * `\documentclass` still begins at the projected image of `matchStart`.
 *
 * `projectLiveLatex` only ever REMOVES bytes (comment tails, verbatim
 * contents) and preserves every live byte in order, so the live prefix length
 * is `projectLiveLatex(latex.slice(0, matchStart)).length`. If a
 * `\documentclass` starts there in the full projection, the raw match is live.
 */
function isLiveDocumentClass(latex: string, matchStart: number): boolean {
  const projected = projectLiveLatex(latex, {
    envs: VERBATIM_ENVS_FULL,
    inlineVerb: true,
  });
  const liveStart = projectLiveLatex(latex.slice(0, matchStart), {
    envs: VERBATIM_ENVS_FULL,
    inlineVerb: true,
  }).length;
  return projected.startsWith("\\documentclass", liveStart);
}

/**
 * Pull the first LIVE `\documentclass{...}` (with optional `[options]`) out
 * of a LaTeX source, skipping any that are commented out or inside a
 * verbatim-family environment. Returns null if none is present — e.g. a bare
 * snippet without a preamble, or one whose only `\documentclass` is
 * commented. `matchStart`/`matchEnd` are RAW byte offsets so
 * `rewriteDocumentClass` can splice the live class in place.
 */
export function extractDocumentClass(latex: string): DocumentClassInfo | null {
  DOCUMENTCLASS_RE_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOCUMENTCLASS_RE_G.exec(latex)) !== null) {
    const matchStart = m.index;
    if (!isLiveDocumentClass(latex, matchStart)) continue;
    return {
      className: m[2].trim(),
      options: m[1] ?? null,
      matchStart,
      matchEnd: matchStart + m[0].length,
    };
  }
  return null;
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
export const CLASS_COMMANDS: Record<string, Set<SectioningCommand>> = {
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
  // Project comments + the FULL verbatim family + inline `\verb` away via the
  // shared lexer. The boundary-correct inline-verb matcher fixes the former
  // `/\\verb\*?(.)[\s\S]*?\1/` bug that mis-lexed `\verbatim`/`\verbdef` as
  // `\verb` + delimiter and swallowed a following real `\section`.
  const stripped = projectLiveLatex(latex, {
    envs: VERBATIM_ENVS_FULL,
    inlineVerb: true,
  });
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\b\*?\s*[\{\[]/g;
  const found = new Set<SectioningCommand>();
  for (const m of stripped.matchAll(re)) {
    found.add(m[1] as SectioningCommand);
  }
  return found;
}

/**
 * The sectioning commands the body uses that `className` does NOT define —
 * i.e. the commands that would fail with "Undefined control sequence" if the
 * document were compiled under `className`. Empty when the class supports
 * everything the body reaches for (a mechanically-safe target, including any
 * "upgrade" that merely *adds* capability), or when `className` is unknown
 * (best-effort: a custom journal .cls could define anything, so stay silent).
 *
 * This is the shared primitive behind two callers:
 *   - `detectDocumentClassMismatch` — offenders for the doc's CURRENT class
 *     (the compile-time mismatch prompt), and
 *   - the Style-panel "change doc type" gate (task 098) — offenders for a
 *     PROSPECTIVE target class, deciding hard-swap (empty) vs. AI/restructure
 *     (non-empty, the structural-downgrade case).
 */
export function unsupportedSectioningFor(
  latex: string,
  className: string,
): SectioningCommand[] {
  if (!isKnownClass(className)) return [];
  const used = findSectioningCommands(latex);
  const supported = CLASS_COMMANDS[className];
  const offenders: SectioningCommand[] = [];
  for (const cmd of used) {
    if (!supported.has(cmd)) offenders.push(cmd);
  }
  return offenders;
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

  const offenders = unsupportedSectioningFor(latex, cls.className);
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
