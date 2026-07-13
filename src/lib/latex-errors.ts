/**
 * Unified shape for LaTeX errors surfaced in the Errors panel. Two
 * sources feed it: the live `useLatexLint` hook (parse / unified-latex
 * lint rules) and `useLatexCompile` (parsed pdfTeX log).
 */

export type LatexErrorSource = "lint" | "compile";
export type LatexErrorSeverity = "error" | "warning" | "info";

export interface LatexError {
  /**
   * Stable id for React keys. Formerly `${source}:${line}:${col}:${hash}` —
   * which collided catastrophically at line 0 (every no-line record hashed to
   * the same tuple). It now also folds in a per-parse ordinal (and, for compile
   * records, a per-run salt) via `makeErrorId`, so two records with an identical
   * (source, line, col, message) tuple still get distinct ids.
   */
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
  /**
   * The input file the diagnostic came from, when the log's `( ... )`
   * file-nesting resolved one (e.g. `chapters/intro.tex` for a cross-file
   * error). Undefined for the main file / when no file was open. Carried from
   * `parseTexLog`; used so a cross-file error doesn't land on the wrong line of
   * the main editor.
   */
  file?: string;
}

/**
 * Merge lint + compile diagnostics into one sorted list, de-duplicating
 * overlap: when a COMPILE error sits on a line, any LINT diagnostic on the
 * SAME line is dropped (the compiler is authoritative there; the linter's
 * guess is noise). Compile diagnostics are always kept. Sorted by line then
 * column.
 *
 * The dedup is **main-file scoped**. Lint runs only over the main `.tex`
 * `sourceText`, so its records never carry a `file`; compile diagnostics DO
 * carry a non-main `file` in multi-file papers (the tex-log parser stamps the
 * innermost open `( ... )` input file). Only a main-file compile diagnostic
 * (`file == null`) is authoritative on the main file's line N — a cross-file
 * compile error at `chapters/intro.tex:12` must NOT suppress a legitimate
 * main-file lint on line 12. So the suppression set is built from main-file
 * compile lines only.
 */
export function mergeLatexErrors(
  lint: LatexError[],
  compile: LatexError[],
): LatexError[] {
  const compileLines = new Set(
    compile.filter((e) => e.line > 0 && e.file == null).map((e) => e.line),
  );
  const keptLint = lint.filter((e) => e.line <= 0 || !compileLines.has(e.line));
  return [...keptLint, ...compile].sort(
    (a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0),
  );
}

/**
 * Mint a collision-free id for a diagnostic. The human-readable prefix
 * (`source:line:col:msgHash`) is kept for debuggability, but two components
 * are appended so ids can never clash — the old djb2-only form collided
 * whenever (source, line, col, message) matched, which happened constantly at
 * line 0 (the whole no-line class hashed to one key), breaking React keys and
 * making dismiss/select target every matching card at once:
 *
 *   - `ordinal` — a per-PARSE counter (the caller bumps it for each record it
 *     emits in a single parse/lint pass), so two identical tuples within one
 *     pass still differ.
 *   - `salt` — an optional per-RUN token (a monotonic compile-run counter),
 *     so the same logical error across two compiles gets a NEW id. That is
 *     deliberate: `pruneDismissed` drops any dismissed id absent from the live
 *     set, so a re-occurring error re-surfaces on the next run rather than
 *     staying permanently hidden. Use a deterministic per-run counter, NOT
 *     Date.now()/Math.random(), or cards remount mid-session.
 */
export function makeErrorId(parts: {
  source: LatexErrorSource;
  line: number;
  column?: number;
  message: string;
  ordinal?: number;
  salt?: string;
}): string {
  let h = 5381;
  for (let i = 0; i < parts.message.length; i++) {
    h = ((h << 5) + h + parts.message.charCodeAt(i)) | 0;
  }
  const base = `${parts.source}:${parts.line}:${parts.column ?? 0}:${(h >>> 0).toString(36)}`;
  return `${base}#${parts.salt ?? ""}${parts.ordinal ?? 0}`;
}
