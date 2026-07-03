/**
 * Shared natbib + biblatex citation command name registry.
 *
 * Used by the LaTeX parser, the bib citation parser, and the tiptap input
 * rule. Centralizing the list ensures every layer recognizes the same set of
 * commands.
 *
 * Conventions:
 * - Names must be listed longest-first so the alternation in CITE_NAMES_RE
 *   matches the longest valid command (e.g. \footfullcite before \footcite,
 *   \citeyearpar before \citeyear, \textcites before \textcite before \cite).
 * - Both lowercase and capitalized first-letter forms are listed (natbib +
 *   biblatex both support \Citet / \Textcite for sentence starts).
 * - The optional starred suffix is matched outside this list as `(\*?)`.
 */

// Canonical (lowercase) base command names that accept the multi-cite
// `\cmds[pre1][post1]{key1}[pre2][post2]{key2}…` syntax.
export const MULTI_CITE_NAMES = new Set<string>([
  "cites",
  "textcites",
  "parencites",
  "autocites",
  "footcites",
  "smartcites",
]);

// Canonical lowercase command names this app understands. Used for the
// citation card's type dropdown and to drive command-name → display-format
// dispatch in formatInlineCitation.
export const KNOWN_CITE_COMMANDS = [
  // natbib
  "cite",
  "citet",
  "citep",
  "citealt",
  "citealp",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "citetext",
  "citenum",
  // biblatex
  "textcite",
  "parencite",
  "autocite",
  "footcite",
  "smartcite",
  "fullcite",
  "footfullcite",
  "citetitle",
  "citedate",
  "citeurl",
  "nocite",
  // biblatex multi-cite forms
  "cites",
  "textcites",
  "parencites",
  "autocites",
  "footcites",
  "smartcites",
] as const;

// ---------------------------------------------------------------------------
// Package-family buckets over KNOWN_CITE_COMMANDS.
//
// Used by the preamble-requirements detector (latex-requirements.ts) to
// decide which bib package a body's cite commands pin. Three buckets:
//
//  - NATBIB_ONLY:   defined by natbib and NOT by biblatex — their presence
//                   pins natbib.
//  - SHARED:        defined by BOTH packages (\citeauthor/\citeyear exist in
//                   natbib and biblatex; \cite/\nocite additionally exist in
//                   the LaTeX kernel itself — see KERNEL_NEUTRAL below).
//  - biblatex-only: everything else in KNOWN_CITE_COMMANDS (derived, so a
//                   new registry addition defaults to the biblatex bucket —
//                   natbib's command set is closed).
//
// Every KNOWN_CITE_COMMANDS entry lands in exactly one bucket.
// ---------------------------------------------------------------------------

/** Commands only natbib defines. */
export const NATBIB_ONLY_CITE_COMMANDS: ReadonlySet<string> = new Set([
  "citet",
  "citep",
  "citealt",
  "citealp",
  "citeyearpar",
  "citetext",
  "citenum",
]);

/** Commands BOTH natbib and biblatex define — they pin neither package on
 *  their own. */
export const SHARED_CITE_COMMANDS: ReadonlySet<string> = new Set([
  "cite",
  "nocite",
  "citeauthor",
  "citeyear",
]);

/** The subset of SHARED that the LaTeX kernel itself defines — truly
 *  package-neutral (a body using only these needs no bib package at all). */
export const KERNEL_NEUTRAL_CITE_COMMANDS: ReadonlySet<string> = new Set([
  "cite",
  "nocite",
]);

/** Commands only biblatex defines — derived as the registry remainder. */
export const BIBLATEX_ONLY_CITE_COMMANDS: ReadonlySet<string> = new Set(
  KNOWN_CITE_COMMANDS.filter(
    (c) => !NATBIB_ONLY_CITE_COMMANDS.has(c) && !SHARED_CITE_COMMANDS.has(c),
  ),
);

// Construct the alternation. Longest names FIRST so e.g. "footfullcite" is
// preferred over "footcite", and "citeyearpar" over "citeyear".
//
// Capitalized variants (\Citet, \Parencite, …) are inlined alongside the
// lowercase forms; sentence-starting capitalization is supported by all
// natbib/biblatex commands except the multi-cite plural forms in some
// edge cases — we accept them uniformly here, since the renderer is the
// authority on whether to apply title-case.
const ALL_NAMES: string[] = [];
for (const base of KNOWN_CITE_COMMANDS) {
  ALL_NAMES.push(base);
  // Capitalized form
  ALL_NAMES.push(base[0].toUpperCase() + base.slice(1));
}
// Sort longest-first to avoid partial-match shadowing
ALL_NAMES.sort((a, b) => b.length - a.length);

const NAMES_ALT = ALL_NAMES.join("|");

/**
 * Regex used by the LaTeX parser. Matches `\<name>` followed by an optional
 * `*`. Anchored at the start of the input slice.
 */
export const CITE_NAMES_RE_INLINE = new RegExp(
  `^\\\\(${NAMES_ALT})(\\*?)`
);

/**
 * Regex used by the tiptap input rule. Matches a complete citation command
 * including any number of optional pre/post bracket groups and one-or-more
 * `{key}` groups, with optional inter-key brackets to support multi-cite
 * per-key prenote/postnote (`\cites[pre1][post1]{k1}[pre2][post2]{k2}`).
 *
 * Anchored at the END of the input string so it can be tested against the
 * trailing characters of the editor's text-before context.
 */
export const CITE_RE_FULL = new RegExp(
  `\\\\(${NAMES_ALT})` +
    `(\\*?)` +
    // First key: optional [pre][post] then mandatory {key}
    `(?:\\[[^\\]]*\\]){0,2}` +
    `\\{[^}]+\\}` +
    // Optional additional keys, each preceded by their own optional [pre][post]
    `(?:(?:\\[[^\\]]*\\]){0,2}\\{[^}]+\\})*` +
    `$`
);

/**
 * Regex used by the tiptap input rule to detect a "bare" command (typed
 * without any braces yet) so the citation builder panel can pop open.
 */
export const CITE_RE_BARE = new RegExp(
  `\\\\(${NAMES_ALT})(\\*?)$`
);
