/**
 * Multi-pass planning keyed on reference-resolution NEED (P2).
 *
 * The old heuristic was `passes = hasBibliography ? 3 : 1`. That gives a doc
 * with `\ref`/`\tableofcontents`/a manual `\begin{thebibliography}` exactly
 * ONE pass — so cross-references and the ToC emit `??` / unresolved numbers on
 * the first pass and pdfTeX still exits 0, silently reporting SUCCESS with a
 * broken PDF.
 *
 * `detectPassPlan` scans the (comment/verbatim-projected) source for any
 * construct that needs a second pass to stabilise:
 *  - cross-reference commands (`\ref`, `\pageref`, `\eqref`, `\autoref`,
 *    `\cref`/`\Cref`, `\nameref`) whose targets are written to the `.aux` on
 *    pass 1 and read back on pass 2;
 *  - list-of / table-of-contents commands (`\tableofcontents`,
 *    `\listoffigures`, `\listoftables`) which are populated from the `.aux`;
 *  - a manual `\begin{thebibliography}` (numbers/back-refs stabilise on a
 *    second pass);
 * and, separately, a bib BACKEND (natbib / `\bibliography` / `\addbibresource`
 * / biblatex) which additionally runs bibtex between passes and so needs a
 * THIRD pass to fold the generated `.bbl` in.
 *
 * The scan runs on `projectLiveLatex` so a commented-out or verbatim-quoted
 * `\ref`/`\bibliography` never inflates the pass count.
 */

import { projectLiveLatex, VERBATIM_ENVS_FULL } from "@/lib/latex-lexer";

export interface PassPlan {
  /** Number of compile passes to run (1, 2, or 3). */
  passes: number;
  /** Human-readable reason, for logging / diagnostics. */
  reason: string;
}

// Cross-reference + ToC/list constructs that stabilise on a SECOND pass. The
// `(?![a-zA-Z])` boundary stops `\ref` matching `\reflectbox`, `\cref` matching
// `\crefname`, etc. `\Cref`/`\Autoref` capitalised variants are covered by the
// `[cC]`/`[aA]` classes.
const REFERENCE_RE =
  /\\(?:ref|pageref|eqref|autoref|Autoref|cref|Cref|cpageref|Cpageref|nameref|Nameref)(?![a-zA-Z])/;
const TOC_RE = /\\(?:tableofcontents|listoffigures|listoftables)(?![a-zA-Z])/;
const MANUAL_BIB_RE = /\\begin\{thebibliography\}/;

// A bib BACKEND (bibtex/biber runs between passes) — needs a THIRD pass.
const BIB_BACKEND_RE =
  /\\usepackage(?:\[[^\]]*\])?\{natbib\}|\\usepackage(?:\[[^\]]*\])?\{biblatex\}|\\RequirePackage(?:\[[^\]]*\])?\{(?:natbib|biblatex)\}|\\bibliography\{|\\addbibresource\{/;

/**
 * Decide how many compile passes the given (already-projected-or-not) source
 * needs. Pass the FULL projected+injected main source concatenated with any
 * `.tex` includes; the scan is comment/verbatim-aware internally so callers may
 * pass raw source.
 */
export function detectPassPlan(projectedSource: string): PassPlan {
  // Project comments/verbatim away so an inert `\ref` / `\bibliography` never
  // drives extra passes. Use the FULL verbatim family (this is a compile-side
  // scan with no byte-output coupling, unlike the requirements side).
  const live = projectLiveLatex(projectedSource, {
    envs: VERBATIM_ENVS_FULL,
    inlineVerb: true,
  });

  // A bib backend runs bibtex between passes → 3 passes (pass 1 writes
  // \citation to .aux, bibtex builds the .bbl, pass 2 folds it in, pass 3
  // stabilises the now-present back-references / numbering).
  if (BIB_BACKEND_RE.test(live)) {
    return { passes: 3, reason: "bib backend (bibtex/biber runs between passes)" };
  }

  if (REFERENCE_RE.test(live)) {
    return { passes: 2, reason: "cross-reference command (\\ref/\\cref/…)" };
  }
  if (TOC_RE.test(live)) {
    return { passes: 2, reason: "table-of-contents / list-of command" };
  }
  if (MANUAL_BIB_RE.test(live)) {
    return { passes: 2, reason: "manual \\begin{thebibliography}" };
  }

  return { passes: 1, reason: "no reference-resolution construct" };
}
