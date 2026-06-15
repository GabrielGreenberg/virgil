/**
 * Unified shape for LaTeX errors surfaced in the Errors panel. Two
 * sources feed it: the live `useLatexLint` hook (parse / unified-latex
 * lint rules) and `useLatexCompile` (parsed pdfTeX log).
 */

export type LatexErrorSource = "lint" | "compile";
export type LatexErrorSeverity = "error" | "warning" | "info";

export interface LatexError {
  /** Stable id for React keys: `${source}:${line}:${col}:${hash(message)}`. */
  id: string;
  source: LatexErrorSource;
  severity: LatexErrorSeverity;
  /** 1-based line in the .tex source. 0 when the source provides no line. */
  line: number;
  /** 1-based column. */
  column?: number;
  message: string;
  /** Secondary context — TeX log "<context>" line, or rule id elaboration. */
  detail?: string;
  /** Lint rule id or compile-pattern label. */
  ruleId?: string;
}

/**
 * Merge lint + compile diagnostics into one sorted list, de-duplicating
 * overlap: when a COMPILE error sits on a line, any LINT diagnostic on the
 * SAME line is dropped (the compiler is authoritative there; the linter's
 * guess is noise). Compile diagnostics are always kept. Sorted by line then
 * column.
 */
export function mergeLatexErrors(
  lint: LatexError[],
  compile: LatexError[],
): LatexError[] {
  const compileLines = new Set(compile.filter((e) => e.line > 0).map((e) => e.line));
  const keptLint = lint.filter((e) => e.line <= 0 || !compileLines.has(e.line));
  return [...keptLint, ...compile].sort(
    (a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0),
  );
}

export function makeErrorId(parts: {
  source: LatexErrorSource;
  line: number;
  column?: number;
  message: string;
}): string {
  let h = 5381;
  for (let i = 0; i < parts.message.length; i++) {
    h = ((h << 5) + h + parts.message.charCodeAt(i)) | 0;
  }
  return `${parts.source}:${parts.line}:${parts.column ?? 0}:${(h >>> 0).toString(36)}`;
}
