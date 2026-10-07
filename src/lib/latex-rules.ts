/**
 * The Errors panel's RULE VOCABULARY (task 983): every rule id a Virgil
 * producer emits, and the card title each one reads as.
 *
 * Before this module the ids were string literals scattered over four
 * producers (`syntax-check.ts`, `parse-tex-log.ts`, `useLatexCompile.ts`,
 * `workers/latex-lint-core.ts`) and the titles were a switch in
 * `ErrorCard.tsx` written against the panel's first draft — it named 3 of the
 * ~20 ids actually emitted, so most cards fell through to a de-hyphenated id
 * ("Brace unmatched open", "Citep undefined", "No def").
 *
 * Now the producers spell their ids through `LATEX_RULE` and the title table
 * is a `Record` over that same union, so a new fixed id cannot exist without a
 * title (tsc), and `latex-rule-titles.test.ts` censuses the producers for any
 * id that bypasses the table — including the unified-latex lint rules, whose
 * ids come from the installed package rather than from Virgil source.
 */

import { KNOWN_CITE_COMMANDS, MULTI_CITE_NAMES } from "./cite-commands";

/** Fixed rule ids, spelled once. Producers import these — never a literal. */
export const LATEX_RULE = {
  // syntax-check.ts — pure-text balance checks
  envUnmatchedBegin: "env-unmatched-begin",
  envUnmatchedEnd: "env-unmatched-end",
  envMismatch: "env-mismatch",
  braceUnmatchedOpen: "brace-unmatched-open",
  braceUnmatchedClose: "brace-unmatched-close",
  mathUnmatchedInline: "math-unmatched-inline",
  mathUnmatchedDisplay: "math-unmatched-display",
  // workers/latex-lint-core.ts — a lint stage that threw
  parseFailure: "parse-failure",
  // parse-tex-log.ts — the compile log
  texError: "tex-error",
  latexWarning: "latex-warning",
  compileAbort: "compile-abort",
  // useLatexCompile.ts — package fetch
  offlinePackage: "offline-package",
  packageDownloadFailed: "package-download-failed",
} as const;

export type FixedLatexRuleId = (typeof LATEX_RULE)[keyof typeof LATEX_RULE];

/** The undefined-ref / undefined-cite family is PARAMETERIZED by the command
 *  (`eqref-undefined`, `citep-undefined`, …) — the id keeps the command so a
 *  dismissal's content id stays what it was before task 983. */
export type UndefinedRuleId = `${string}-undefined`;
export type LatexRuleId = FixedLatexRuleId | UndefinedRuleId;

const UNDEFINED_SUFFIX = "-undefined";

export function undefinedRuleId(cmd: string): UndefinedRuleId {
  return `${cmd}${UNDEFINED_SUFFIX}`;
}

const FIXED_TITLES: Record<FixedLatexRuleId, string> = {
  "env-unmatched-begin": "Unclosed environment",
  "env-unmatched-end": "Unopened environment",
  "env-mismatch": "Environment mismatch",
  "brace-unmatched-open": "Unbalanced braces",
  "brace-unmatched-close": "Unbalanced braces",
  "math-unmatched-inline": "Unbalanced math",
  "math-unmatched-display": "Unbalanced math",
  "parse-failure": "Parse error",
  "tex-error": "TeX error",
  "latex-warning": "LaTeX warning",
  "compile-abort": "Compile stopped",
  "offline-package": "Package unavailable offline",
  "package-download-failed": "Package download failed",
};

/** unified-latex-lint's rules, keyed by the id its `lintRule` origin yields
 *  (`unified-latex-lint:<id>`). The census test reads the installed package's
 *  rule list, so an upgrade that adds a rule fails CI until it is titled here. */
export const UNIFIED_LINT_RULE_TITLES: Readonly<Record<string, string>> = {
  "argument-color-commands": "Color command style",
  "argument-font-shaping-commands": "Font command style",
  "consistent-inline-math": "Inconsistent inline math",
  "no-def": "Macro defined with \\def",
  "no-plaintext-operators": "Plain-text operator name",
  "no-tex-display-math": "TeX-style display math",
  "no-tex-font-shaping-commands": "Old-style font command",
  "obsolete-packages": "Obsolete package",
  "prefer-setlength": "TeX-style length assignment",
};

/**
 * The curated title for a rule id, or `null` when the id is not part of the
 * vocabulary (a caller then titles from the message, never from the id).
 */
export function ruleTitle(ruleId: string): string | null {
  if (Object.prototype.hasOwnProperty.call(FIXED_TITLES, ruleId)) {
    return FIXED_TITLES[ruleId as FixedLatexRuleId];
  }
  if (Object.prototype.hasOwnProperty.call(UNIFIED_LINT_RULE_TITLES, ruleId)) {
    return UNIFIED_LINT_RULE_TITLES[ruleId];
  }
  if (ruleId.endsWith(UNDEFINED_SUFFIX)) {
    const cmd = ruleId.slice(0, -UNDEFINED_SUFFIX.length);
    if (REF_CMDS.has(cmd)) return "Missing reference";
    if (CITE_CMDS.has(cmd)) return "Missing citation";
  }
  return null;
}

/** Ref-family commands whose `{key}` the undefined-label check validates. */
export const REF_CMDS: ReadonlySet<string> = new Set([
  "ref",
  "Ref",
  "eqref",
  "pageref",
  "Pageref",
  "autoref",
  "Autoref",
  "cref",
  "Cref",
  "vref",
  "Vref",
  "nameref",
  "Nameref",
]);

/**
 * Single-key cite commands whose `{key}` the undefined-citation diagnostic
 * validates against the .bib. DERIVED from the shared citation-command
 * registry (`cite-commands.ts`) so the linter's vocabulary can never silently
 * drift from the round-trip parser's — a registry addition is picked up here
 * automatically (the "derive, don't duplicate" SSOT rule). Two exclusions:
 *
 *  - `nocite` — matched by name in the extraction loop below; it's
 *    informational (`\nocite{*}` cites everything), so its keys are never
 *    recorded for validation.
 *  - the MULTI-cite forms (`\cites`, `\textcites`, `\parencites`,
 *    `\autocites`, `\footcites`, `\smartcites`) — they take a repeated
 *    `{key}` / `(pre)(post)` argument shape that the single-`{key}` extractor
 *    at the `CITE_CMDS.has(macroName)` branch does NOT parse. Including them
 *    would mis-read or skip their keys. Recognizing them correctly needs the
 *    extractor to walk repeated `{key}` groups — a scoped follow-up.
 *
 * Both the lowercase and capitalized-first-letter forms are recognized (natbib
 * + biblatex support `\Citet` / `\Autocite` etc. for sentence starts), mirroring
 * the registry's own caps convention (see `ALL_NAMES` in cite-commands.ts).
 */
const citeCmds = new Set<string>();
for (const base of KNOWN_CITE_COMMANDS) {
  if (base === "nocite" || MULTI_CITE_NAMES.has(base)) continue;
  citeCmds.add(base);
  citeCmds.add(base[0].toUpperCase() + base.slice(1));
}
export const CITE_CMDS: ReadonlySet<string> = citeCmds;
