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
  /**
   * Source CONTEXT, rendered monospace — the TeX log's `l.N <source>` tail or
   * the offending key (a citekey, a label). Short, verbatim, never prose: a
   * consumer may search the document for it (`useDiagnostics` pins on it).
   */
  detail?: string;
  /**
   * What the USER should do about it — plain prose, rendered as wrapping body
   * text in the expanded card (task 982). Distinct from `detail` by role: a
   * fix-it sentence is read, not matched against source, so it must never sit
   * in the mono context slot where it truncates and is searched as text.
   */
  remedy?: string;
  /** Lint rule id or compile-pattern label. */
  ruleId?: string;
  /**
   * The input file the diagnostic came from, when it is NOT the main file
   * (e.g. `chapters/intro.tex` for a cross-file error).
   *
   * INVARIANT: `undefined` ⇔ the main file (or no file was open). The
   * producer establishes it — `parseTexLog` drops the main file's own name,
   * however the log spelled it (`./main.tex`, `/work/main.tex`) — so no
   * consumer compares filenames. Lint records never carry it (they lint the
   * main source). Read it through `isMainFileDiagnostic` / `mainFileLine`,
   * never by hand: a consumer that maps `line` into the main source without
   * asking lands a cross-file error on the wrong main-file line (task 1208).
   */
  file?: string;
  /**
   * COMPILE records only: the trimmed text of the main-file line `line`
   * indexed in the source pdfTeX actually ran (stamped by `stampSourceLines`
   * inside the compile service). A compile's line numbers are a SNAPSHOT
   * coordinate — they index the compiled text, not the live document the user
   * keeps editing — so this is the identity the record is relocated by
   * (`relocateCompileDiagnostics`, task 1549). Absent ⇒ the line is trusted as
   * live (lint, cross-file, line-less, or an undecodable main file).
   */
  lineText?: string;
  /**
   * Set ONLY by `relocateCompileDiagnostics` on a compile record whose stamped
   * line no longer exists in the live text: the line it had at the last
   * compile. Such a record carries `line: 0` — it is still listed (it is the
   * last compile's word) but quotes no snippet, anchors nowhere, cannot jump
   * and suppresses no lint.
   */
  compiledLine?: number;
}

/** Is this diagnostic about the file the editor shows? THE one predicate. */
export function isMainFileDiagnostic(err: Pick<LatexError, "file">): boolean {
  return err.file == null;
}

/**
 * The diagnostic's line IN THE MAIN SOURCE, or 0 when it has none there — no
 * line, or a line in another file. Every consumer that maps a diagnostic onto
 * the main `.tex` (paragraph, snippet, code-view jump, dedup) reads this.
 */
export function mainFileLine(err: Pick<LatexError, "file" | "line">): number {
  return isMainFileDiagnostic(err) && err.line > 0 ? err.line : 0;
}

/**
 * Human location label: `line 42:3`, `chapters/intro.tex · line 42`, or
 * `chapters/intro.tex` (cross-file, no line). Null when there is nothing to
 * say (main file, no line).
 */
export function diagnosticLocationLabel(
  err: Pick<LatexError, "file" | "line" | "column" | "compiledLine">,
): string | null {
  const col = err.column ? `:${err.column}` : "";
  const at =
    err.line > 0
      ? `line ${err.line}${col}`
      : err.compiledLine
        ? `line ${err.compiledLine}${col} (at last compile)`
        : null;
  if (isMainFileDiagnostic(err)) return at;
  return at ? `${err.file} · ${at}` : (err.file ?? null);
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
 * compile lines only (`mainFileLine`; `file == null` ⇔ main by the producer's
 * invariant — task 1208, which made it true of real logs).
 */
export function mergeLatexErrors(
  lint: LatexError[],
  compile: LatexError[],
): LatexError[] {
  const compileLines = new Set(
    compile.map(mainFileLine).filter((line) => line > 0),
  );
  const keptLint = lint.filter((e) => e.line <= 0 || !compileLines.has(e.line));
  // An unlocated compile record (line 0) keeps its last-compile place in the
  // order rather than jumping to the top on the edit that orphaned it.
  const at = (e: LatexError) => (e.line > 0 ? e.line : (e.compiledLine ?? 0));
  return [...keptLint, ...compile].sort(
    (a, b) => at(a) - at(b) || (a.column ?? 0) - (b.column ?? 0),
  );
}

// ── Compile diagnostics across the edit gap (task 1549) ─────────────────────
//
// A compile's `line` indexes the text pdfTeX ran. The document moves on — a
// paragraph inserted above, an earlier error fixed — while the record persists
// until the next compile. Every consumer maps `line` into the LIVE source
// (snippet, paragraph anchor, code-view jump, the lint dedup above), so the
// snapshot coordinate must be resolved against the live text first, by the
// line's IDENTITY (its text), never trusted by position ("addressing the live
// document across an async gap"). `stampSourceLines` records the identity;
// `relocateCompileDiagnostics` — THE one resolver, applied once where compile
// records join the live list (`useDiagnostics`) — re-addresses it.

/**
 * Stamp each main-file diagnostic with the trimmed text of the line it indexes
 * in `compiledMainText` — the main `.tex` exactly as the engine ran it
 * (post-injection). Records without a main-file line pass through untouched.
 */
export function stampSourceLines(
  diagnostics: LatexError[],
  compiledMainText: string | undefined,
): LatexError[] {
  if (compiledMainText === undefined || diagnostics.length === 0) return diagnostics;
  const lines = compiledMainText.split("\n");
  return diagnostics.map((d) => {
    const line = mainFileLine(d);
    if (line <= 0 || line > lines.length) return d;
    return { ...d, lineText: lines[line - 1].trim() };
  });
}

/** Live-text index for `liveMainFileLine`: trimmed lines + text → line numbers. */
export interface LiveLineIndex {
  lines: readonly string[];
  byText: ReadonlyMap<string, readonly number[]>;
}

export function buildLiveLineIndex(text: string): LiveLineIndex {
  const lines = text.split("\n").map((l) => l.trim());
  const byText = new Map<string, number[]>();
  lines.forEach((t, i) => {
    if (!t) return; // a blank line is no identity — never relocate onto one
    const at = byText.get(t);
    if (at) at.push(i + 1);
    else byText.set(t, [i + 1]);
  });
  return { lines, byText };
}

/**
 * The diagnostic's line in the LIVE main source, or 0 when it has none there.
 * An unstamped record (lint — its line IS live; cross-file; line-less) answers
 * `mainFileLine`. A stamped record answers its recorded line when the live
 * line there still carries the stamped text, else the NEAREST live line that
 * does (ties → the earlier), else 0 — unlocated.
 */
export function liveMainFileLine(
  err: Pick<LatexError, "file" | "line" | "lineText">,
  index: LiveLineIndex,
): number {
  const line = mainFileLine(err);
  if (line <= 0 || err.lineText === undefined) return line;
  if (index.lines[line - 1] === err.lineText) return line;
  const candidates = err.lineText ? index.byText.get(err.lineText) : undefined;
  if (!candidates) return 0;
  let best = 0;
  for (const c of candidates) {
    if (best === 0 || Math.abs(c - line) < Math.abs(best - line)) best = c;
  }
  return best;
}

/**
 * Re-address compile records against the live text: a record whose line moved
 * gets its live line; one whose line is gone gets `line: 0` + `compiledLine`.
 * Always derives from the ORIGINAL records (never compounds a prior
 * relocation). Returns `errors` itself when nothing moved, so the steady state
 * keeps its identity; the line split happens only when a stamped record exists.
 */
export function relocateCompileDiagnostics(
  errors: readonly LatexError[],
  liveText: string | null,
): readonly LatexError[] {
  if (liveText === null || !errors.some((e) => e.lineText !== undefined)) {
    return errors;
  }
  const index = buildLiveLineIndex(liveText);
  let changed = false;
  const out = errors.map((e) => {
    const live = liveMainFileLine(e, index);
    if (live === mainFileLine(e)) return e;
    changed = true;
    return live > 0
      ? { ...e, line: live }
      : { ...e, line: 0, compiledLine: e.line };
  });
  return changed ? out : errors;
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
