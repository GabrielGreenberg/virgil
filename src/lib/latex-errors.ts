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
   * (source, line, col, message) tuple still get distinct ids. LINT records are
   * then re-keyed by CONTENT (`assignContentIds`, task 761) so an id survives
   * edits that do not touch the error.
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
  const base = `${parts.source}:${parts.line}:${parts.column ?? 0}:${hash36(parts.message)}`;
  return `${base}#${parts.salt ?? ""}${parts.ordinal ?? 0}`;
}

/** djb2 over a string, base-36. */
function hash36(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Give every record of one LINT pass an id minted from what the error IS, not
 * where it sits (task 761). Lint re-runs ~1.5 s after every edit and carries no
 * per-run salt, and every piece of error-card session state (dismissal,
 * selection, expansion — `useDiagnostics`) is keyed by id. So the id must be
 * invariant under edits that do not touch the error:
 *
 *   - NO line number — a newline added above would re-key it;
 *   - NO pass-wide ordinal — a new error appearing earlier in the list would
 *     shift it;
 *   - no line number quoted INSIDE the message either (`on line 12`).
 *
 * Instead: `source:ruleId:messageHash:lineTextHash#occurrence`, where the line
 * text is the (trimmed) source line the error sits on, and `occurrence` counts
 * only records sharing that same content key, in list order — it exists solely
 * to separate genuine twins (two identical findings on one line, or on two
 * identical lines; line-0 records share an empty line text). Editing the
 * error's own line — or fixing it — legitimately re-keys it.
 *
 * Compile ids are NOT minted here: their per-run salt is deliberate (see
 * `makeErrorId`). One line split per pass (the pass already parses the whole
 * text) + O(errors); preserves order.
 */
export function assignContentIds(
  errors: readonly LatexError[],
  text: string,
): LatexError[] {
  if (errors.length === 0) return [];
  const lines = text.split("\n");
  const seen = new Map<string, number>();
  return errors.map((e) => {
    const lineText =
      e.line > 0 && e.line <= lines.length ? lines[e.line - 1].trim() : "";
    // A message may cite ANOTHER line ("… does not match \\begin{x} on line
    // 12") — that number moves on an unrelated edit, so it is not identity.
    const message = e.message.replace(/\bline \d+/g, "line #");
    const key = `${e.source}:${e.ruleId ?? ""}:${hash36(message)}:${hash36(lineText)}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return { ...e, id: `${key}#${occurrence}` };
  });
}
