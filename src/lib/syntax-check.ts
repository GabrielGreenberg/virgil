/**
 * Pure-text LaTeX syntax checker. Catches the typo-class errors that
 * unified-latex's stylistic linter doesn't:
 *   - Unbalanced `{ }` braces (with comment + escape awareness)
 *   - Unbalanced inline `$...$` and display `$$...$$` math
 *   - Unmatched `\begin{env}` / `\end{env}` (mismatch or missing)
 *   - `\ref{key}` / `\eqref{key}` / etc. to undefined `\label{key}`
 *   - `\cite{key}` / `\citep{key}` / etc. to keys not in the .bib
 *
 * Verbatim-style envs are skipped so their bodies don't generate spurious
 * diagnostics — membership comes from the lexer's family SSOT
 * (`isVerbatimFamilyEnv`), never a private list here.
 *
 * Exposed as a single function so the visual editor can later call it
 * on the rendered .tex output to flag missing refs/citations there too.
 */

import type { LatexError } from "./latex-errors";
import { makeErrorId } from "./latex-errors";
import {
  CITE_CMDS,
  LATEX_RULE,
  REF_CMDS,
  undefinedRuleId,
  type LatexRuleId,
} from "./latex-rules";
import { isVerbatimFamilyEnv } from "./latex-lexer";

export interface SyntaxCheckOptions {
  /** Bib keys known from the project's .bib files. When provided,
   *  `\cite{key}` to a key not in the set is flagged. Omit to skip
   *  citation checks entirely. */
  knownBibKeys?: Set<string>;
}

// Which envs the balance/ref checks must skip is the SAME question the lexer's
// verbatim family answers — "does this body execute as LaTeX?" — so it is asked
// there, not re-declared here (task 342). Pre-342 this file carried its own
// six-name Set while the module that calls itself the lexical SSOT carried
// four, and the SSOT was the SHORTER list: the linter knew about fancyvrb's
// `Verbatim` and the `comment` package and the round trip did not. Both are now
// members, so the fork is retired in the direction of the more complete list.

// REF_CMDS / CITE_CMDS — the commands whose `{key}` the undefined-ref /
// undefined-cite checks validate — live in `./latex-rules` with the rest of
// the rule vocabulary, because the `${cmd}-undefined` id they mint is read
// back there to title the card (task 983).

/** Bib keys that are intentionally allowed but won't appear in .bib —
 *  e.g. `\nocite{*}` cites all entries; `*` is not a real key. */
const SPECIAL_BIB_KEYS = new Set(["*"]);

/** Characters that, when following a backslash, form a one-char escape
 *  rather than a macro name. Includes whitespace (which is escaped to
 *  produce a non-breaking space). */
const ESCAPE_CHARS = new Set([
  "\\",
  "{",
  "}",
  "%",
  "$",
  "&",
  "#",
  "_",
  "^",
  "~",
  " ",
  "\n",
  "\t",
  ",", // \, → thin space
  ";",
  ":",
  "!",
]);

interface BracedArg {
  value: string;
  end: number;
}

function readBracedArg(text: string, start: number): BracedArg | null {
  let j = start;
  while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
  if (text[j] !== "{") return null;
  let depth = 1;
  const valueStart = j + 1;
  j++;
  while (j < text.length && depth > 0) {
    const ch = text[j];
    if (ch === "\\" && j + 1 < text.length) {
      j += 2;
      continue;
    }
    if (ch === "%") {
      const nl = text.indexOf("\n", j);
      j = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { value: text.slice(valueStart, j), end: j + 1 };
    }
    j++;
  }
  return null;
}

function precomputeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineColFromIdx(starts: number[], idx: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: idx - starts[lo] + 1 };
}

function pushErr(
  errors: LatexError[],
  starts: number[],
  idx: number,
  message: string,
  ruleId: LatexRuleId,
  detail?: string,
): void {
  const { line, col } = lineColFromIdx(starts, idx);
  errors.push({
    id: makeErrorId({ source: "lint", line, column: col, message }),
    source: "lint",
    severity: "error",
    line,
    column: col,
    message,
    detail,
    ruleId,
  });
}

export function runSyntaxChecks(
  text: string,
  opts: SyntaxCheckOptions = {},
): LatexError[] {
  const errors: LatexError[] = [];
  const lineStarts = precomputeLineStarts(text);

  const braceStack: number[] = [];
  const envStack: Array<{ name: string; idx: number }> = [];
  let inlineMathIdx: number | null = null;
  let displayMathIdx: number | null = null;
  let verbatimEnv: string | null = null;

  const labels = new Set<string>();
  const refs: Array<{ key: string; idx: number; cmd: string }> = [];
  const cites: Array<{ key: string; idx: number; cmd: string }> = [];

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    // Inside a verbatim env: skip everything until the matching \end{<env>},
    // then resume normal scanning at that \end so it's parsed normally.
    if (verbatimEnv !== null) {
      const endStr = `\\end{${verbatimEnv}}`;
      const found = text.indexOf(endStr, i);
      if (found === -1) {
        // No closer — leave envStack populated so the unclosed-env error fires.
        i = text.length;
        break;
      }
      i = found;
      verbatimEnv = null;
      continue;
    }

    // Comments: % to end of line. (Escaped \% would have been consumed by
    // the backslash-escape branch below, so any % we see here is real.)
    if (c === "%") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }

    // Backslash: escape, macro, or stray.
    if (c === "\\") {
      const next = text[i + 1];
      if (next === undefined) {
        i++;
        continue;
      }
      if (ESCAPE_CHARS.has(next)) {
        i += 2;
        continue;
      }
      // Macro name: letters; trailing * is part of the macro identity.
      let j = i + 1;
      while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
      if (j === i + 1) {
        // \<non-letter, non-escape> — treat as a one-char escape.
        i += 2;
        continue;
      }
      const macroName = text.slice(i + 1, j);
      if (text[j] === "*") j++;
      const macroIdx = i;
      i = j;

      if (macroName === "begin" || macroName === "end") {
        const arg = readBracedArg(text, i);
        if (!arg) continue;
        const envName = arg.value.trim();
        i = arg.end;
        if (macroName === "begin") {
          envStack.push({ name: envName, idx: macroIdx });
          if (isVerbatimFamilyEnv(envName)) verbatimEnv = envName;
        } else {
          const top = envStack[envStack.length - 1];
          if (!top) {
            pushErr(
              errors,
              lineStarts,
              macroIdx,
              `\\end{${envName}} with no matching \\begin`,
              LATEX_RULE.envUnmatchedEnd,
            );
          } else if (top.name !== envName) {
            const topPos = lineColFromIdx(lineStarts, top.idx);
            pushErr(
              errors,
              lineStarts,
              macroIdx,
              `\\end{${envName}} does not match \\begin{${top.name}} on line ${topPos.line}`,
              LATEX_RULE.envMismatch,
            );
            envStack.pop();
          } else {
            envStack.pop();
          }
        }
        continue;
      }

      if (macroName === "label") {
        const arg = readBracedArg(text, i);
        if (arg) {
          labels.add(arg.value.trim());
          i = arg.end;
        }
        continue;
      }

      if (REF_CMDS.has(macroName)) {
        const arg = readBracedArg(text, i);
        if (arg) {
          for (const key of arg.value.split(",").map((k) => k.trim()).filter(Boolean)) {
            refs.push({ key, idx: macroIdx, cmd: macroName });
          }
          i = arg.end;
        }
        continue;
      }

      if (macroName === "nocite" || CITE_CMDS.has(macroName)) {
        // Skip optional [pre][post] args before the key arg.
        let k = i;
        while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
        while (text[k] === "[") {
          let depth = 1;
          k++;
          while (k < text.length && depth > 0) {
            if (text[k] === "\\" && k + 1 < text.length) {
              k += 2;
              continue;
            }
            if (text[k] === "[") depth++;
            else if (text[k] === "]") {
              depth--;
              if (depth === 0) {
                k++;
                break;
              }
            }
            k++;
          }
          while (k < text.length && (text[k] === " " || text[k] === "\t")) k++;
        }
        i = k;
        const arg = readBracedArg(text, i);
        if (arg) {
          for (const key of arg.value.split(",").map((k2) => k2.trim()).filter(Boolean)) {
            // \nocite is informational only; don't record for validation.
            if (macroName !== "nocite") {
              cites.push({ key, idx: macroIdx, cmd: macroName });
            }
          }
          i = arg.end;
        }
        continue;
      }

      // Other macros — already past the name; let the loop continue.
      continue;
    }

    if (c === "{") {
      braceStack.push(i);
      i++;
      continue;
    }
    if (c === "}") {
      if (braceStack.length === 0) {
        pushErr(errors, lineStarts, i, "Unmatched closing brace `}`", LATEX_RULE.braceUnmatchedClose);
      } else {
        braceStack.pop();
      }
      i++;
      continue;
    }

    if (c === "$") {
      // If currently in inline math, this `$` closes it — even if the
      // next char is also `$` (e.g. `$x$$y$$` is `$x$ + $y$ + $`).
      if (inlineMathIdx != null) {
        inlineMathIdx = null;
        i++;
        continue;
      }
      // Not in inline math. Check for `$$` (display math).
      if (text[i + 1] === "$") {
        if (displayMathIdx != null) displayMathIdx = null;
        else displayMathIdx = i;
        i += 2;
        continue;
      }
      // Single `$` — open inline.
      inlineMathIdx = i;
      i++;
      continue;
    }

    i++;
  }

  for (const idx of braceStack) {
    pushErr(errors, lineStarts, idx, "Unmatched opening brace `{`", LATEX_RULE.braceUnmatchedOpen);
  }
  for (const env of envStack) {
    pushErr(
      errors,
      lineStarts,
      env.idx,
      `Unclosed environment \\begin{${env.name}}`,
      LATEX_RULE.envUnmatchedBegin,
    );
  }
  if (inlineMathIdx != null) {
    pushErr(errors, lineStarts, inlineMathIdx, "Unclosed inline math `$`", LATEX_RULE.mathUnmatchedInline);
  }
  if (displayMathIdx != null) {
    pushErr(errors, lineStarts, displayMathIdx, "Unclosed display math `$$`", LATEX_RULE.mathUnmatchedDisplay);
  }

  for (const r of refs) {
    if (!labels.has(r.key)) {
      pushErr(
        errors,
        lineStarts,
        r.idx,
        `\\${r.cmd}{${r.key}} → undefined label`,
        undefinedRuleId(r.cmd),
        r.key,
      );
    }
  }
  if (opts.knownBibKeys) {
    for (const c of cites) {
      if (SPECIAL_BIB_KEYS.has(c.key)) continue;
      if (!opts.knownBibKeys.has(c.key)) {
        pushErr(
          errors,
          lineStarts,
          c.idx,
          `\\${c.cmd}{${c.key}} → key not in bibliography`,
          undefinedRuleId(c.cmd),
          c.key,
        );
      }
    }
  }

  return errors;
}
