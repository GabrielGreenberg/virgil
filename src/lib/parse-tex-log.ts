import type { LatexError } from "./latex-errors";
import { makeErrorId } from "./latex-errors";
import { LATEX_RULE } from "./latex-rules";

/**
 * Structured extraction of error/warning entries from a pdfTeX log (P5).
 *
 * Rewritten as a preprocessing + line-walk state machine. The old version
 * regex-matched raw lines, which mis-fired in five ways this one fixes:
 *
 *  1. **79-col unwrap.** pdfTeX hard-wraps stdout at 79 columns; a message's
 *     `on input line N` tail is routinely split onto the next physical line,
 *     and multi-line package warnings are folded with an indented `(pkgname)`
 *     continuation prefix. We reconstruct LOGICAL lines (join 79-char wraps,
 *     strip+append `(pkg)` folds) BEFORE any matching, so the line number and
 *     the message tail are never severed.
 *
 *  2. **File tracking via `( ... )` nesting.** pdfTeX prints `(./chap.tex ...)`
 *     when it enters an input file and `)` when it leaves. We keep a stack of
 *     open files and tag each diagnostic with the innermost one, so a
 *     cross-file error carries `file` instead of landing on the wrong line of
 *     the main editor.
 *
 *  3. **Tighter `!` detector.** Only the real pdfTeX error grammar counts
 *     (`! LaTeX Error:`, `! Undefined control sequence`, `! Package X Error:`,
 *     or a bare `! <msg>` that is followed by an `l.N`/`<...>` context). A bare
 *     `!` / `!!` in prose or a listing is no longer a false error.
 *
 *  4. **Terminal-summary folding.** `! Emergency stop.`,
 *     `==> Fatal error occurred, no output PDF file produced!` and
 *     `No pages of output.` are trailers to an error already captured — they
 *     are recognized as summary markers and suppressed instead of becoming
 *     duplicate cards.
 *
 *  5. **Synthetic fallback.** When `status !== 0` and the walk recovered ZERO
 *     records, we synthesize one `compile-abort` diagnostic (line 0, message
 *     keyed off the log tail) so the Errors panel ALWAYS matches the "Compile
 *     failed" alert (the xlist/abort/network case that used to leave an empty
 *     panel behind a red alert).
 */

/** Physical width at which pdfTeX hard-wraps its terminal/log output. */
const WRAP_WIDTH = 79;

/**
 * A line that STARTS a new recognized record, used both to stop 79-col
 * over-joining and to detect the `!` error grammar. A continuation line that
 * itself begins one of these must NOT be glued onto the previous logical line.
 */
function startsNewRecord(line: string): boolean {
  return (
    /^!/.test(line) ||
    /^l\.\d+/.test(line) ||
    /^</.test(line) ||
    /^\((?:\.|\/|[A-Za-z])/.test(line) || // an input-file open like "(./chap.tex"
    /(?:LaTeX|Package\s+\S+|pdfTeX|LaTeX Font)\s+Warning:/.test(line) ||
    /^Overfull|^Underfull/.test(line)
  );
}

/**
 * Whether a bare `! <msg>` line is a REAL error. The unambiguous pdfTeX error
 * prefixes always count; a generic `! …` counts only when a context line
 * (`l.N …` or `<...>`) follows within a short window — otherwise it's prose or
 * a listing that merely starts with `!`.
 */
function isRealErrorLine(msg: string, following: string[]): boolean {
  if (
    /^LaTeX Error:/.test(msg) ||
    /^Package\s+\S+\s+Error:/.test(msg) ||
    /^Undefined control sequence/.test(msg) ||
    /^Missing\b/.test(msg) ||
    /^Extra\b/.test(msg) ||
    /^Runaway argument/.test(msg) ||
    /^Emergency stop/.test(msg) ||
    /^pdfTeX error/.test(msg) ||
    /^Paragraph ended before/.test(msg) ||
    /^Too many\b/.test(msg) ||
    /^File .* not found/.test(msg) ||
    /^I can't find file/.test(msg)
  ) {
    return true;
  }
  // A generic `! foo` is only an error if a context line follows soon.
  for (const f of following) {
    if (/^l\.\d+/.test(f) || /^</.test(f)) return true;
  }
  return false;
}

/** Terminal-summary trailers that fold into the preceding error, not new cards. */
function isSummaryMarker(msg: string): boolean {
  return (
    /^Emergency stop\.?$/.test(msg) ||
    /^==> Fatal error occurred/.test(msg) ||
    /Fatal error occurred, no output PDF file produced!?$/.test(msg) ||
    /^No pages of output\.?$/.test(msg) ||
    /^Output written on /.test(msg)
  );
}

/** Strip trailing TeX structural punctuation (stray parens / dots) from a detail. */
function cleanDetail(detail: string): string | undefined {
  const d = detail.replace(/[\s).]+$/g, "").trim();
  return d || undefined;
}

/**
 * Reconstruct LOGICAL lines from PHYSICAL ones:
 *   - join a line that is exactly 79 chars with its successor (a hard wrap),
 *     UNLESS the successor itself starts a new recognized record;
 *   - fold an indented `(pkgname)` continuation onto the in-progress message.
 */
function toLogicalLines(physical: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < physical.length) {
    let line = physical[i];
    i++;
    // Absorb 79-col hard wraps: keep gluing while the current fragment is
    // exactly WRAP_WIDTH chars and the next physical line doesn't begin a new
    // record (guards over-joining a legit 79-char logical line).
    while (
      line.length === WRAP_WIDTH &&
      i < physical.length &&
      !startsNewRecord(physical[i])
    ) {
      line += physical[i];
      i++;
    }
    // Fold `(pkgname)` continuation lines that LaTeX emits for multi-line
    // package warnings — append their tail to the message in progress.
    while (i < physical.length) {
      const fold = physical[i].match(/^\((?:[A-Za-z][\w@-]*)\)\s?(.*)$/);
      if (!fold) break;
      const tail = fold[1];
      line = tail ? `${line} ${tail}` : line;
      i++;
    }
    out.push(line);
  }
  return out;
}

/**
 * Track the innermost open input file across the whole log by scanning each
 * logical line left-to-right for `(<path>` opens and `)` closes. Returns the
 * file open at the START of each logical line (parallel to `logical`). Only
 * paths that look like source files (`.tex`/`.ltx`, or a relative `./`/`../`)
 * push onto the stack, so `(hyperref)`-style folds and `(1)` counters don't.
 */
function trackFiles(logical: string[]): (string | undefined)[] {
  const stack: string[] = [];
  const perLine: (string | undefined)[] = [];
  for (const line of logical) {
    // The file in force when this line begins.
    perLine.push(stack.length ? stack[stack.length - 1] : undefined);
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (c === "(") {
        // Read the path token following the paren.
        let j = k + 1;
        let tok = "";
        while (j < line.length && !/[\s()]/.test(line[j])) {
          tok += line[j];
          j++;
        }
        if (/\.(tex|ltx|sty|cls|def)$/i.test(tok) || /^\.{0,2}\//.test(tok)) {
          stack.push(normalizeFile(tok));
        } else {
          // A non-file paren group (e.g. "(1)" or "(hyperref)"): push a
          // sentinel so the matching ")" balances without changing the file.
          stack.push(stack.length ? stack[stack.length - 1] : SENTINEL);
        }
      } else if (c === ")") {
        if (stack.length) stack.pop();
      }
    }
  }
  return perLine;
}

const SENTINEL = "\0non-file";

function normalizeFile(tok: string): string {
  return tok.replace(/^\.\//, "");
}

export function parseTexLog(log: string, status = 0): LatexError[] {
  const out: LatexError[] = [];
  let ordinal = 0;
  const push = (
    e: Omit<LatexError, "id"> & { file?: string },
  ): void => {
    out.push({
      ...e,
      id: makeErrorId({
        source: e.source,
        line: e.line,
        column: e.column,
        message: e.message,
        ordinal: ordinal++,
      }),
    });
  };

  const physical = (log ?? "").split(/\r?\n/);
  const lines = toLogicalLines(physical);
  const fileAt = trackFiles(lines);

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const currentFile =
      fileAt[i] && fileAt[i] !== SENTINEL ? fileAt[i] : undefined;

    if (ln.startsWith("!")) {
      const message = ln.replace(/^!+\s*/, "").trim();
      if (!message) continue;
      // Terminal-summary markers fold into the preceding error (no dup card).
      if (isSummaryMarker(message)) continue;
      const following = lines.slice(i + 1, Math.min(i + 8, lines.length));
      if (!isRealErrorLine(message, following)) continue;

      let line = 0;
      let detail: string | undefined;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const m = lines[j].match(/^l\.(\d+)\s?(.*)$/);
        if (m) {
          line = parseInt(m[1], 10);
          detail = cleanDetail(m[2] ?? "");
          break;
        }
      }
      push({
        source: "compile",
        severity: "error",
        line,
        message,
        detail,
        ruleId: LATEX_RULE.texError,
        file: currentFile,
      });
      continue;
    }

    // Fatal-error / "no pages" trailers on their own (not `!`-prefixed) —
    // fold, don't emit.
    if (isSummaryMarker(ln.trim())) continue;

    const w = ln.match(
      /^(?:LaTeX|Package\s+\S+|LaTeX Font|pdfTeX)\s+Warning:\s*(.*?)(?:\s+on input line\s+(\d+))?\.?\s*$/,
    );
    if (w) {
      const message = w[1].trim();
      if (!message) continue;
      const line = w[2] ? parseInt(w[2], 10) : 0;
      push({
        source: "compile",
        severity: "warning",
        line,
        message,
        ruleId: LATEX_RULE.latexWarning,
        file: currentFile,
      });
    }
  }

  // Synthetic fallback: a non-zero status with nothing parsed must still leave
  // ONE card so the panel matches the "Compile failed" alert. Key the message
  // off the last non-empty log line for a hint at what went wrong.
  if (status !== 0 && out.length === 0) {
    const tail = lastNonEmptyLine(physical);
    const message = tail
      ? `Compilation aborted (status ${status}) — ${tail}`
      : `Compilation aborted (status ${status}) — no diagnostics recovered from the log.`;
    out.push({
      id: makeErrorId({ source: "compile", line: 0, message, ordinal: 0 }),
      source: "compile",
      severity: "error",
      line: 0,
      message,
      ruleId: LATEX_RULE.compileAbort,
    });
  }

  return out;
}

function lastNonEmptyLine(physical: string[]): string | undefined {
  for (let i = physical.length - 1; i >= 0; i--) {
    const t = physical[i].trim();
    if (t) return t.length > 160 ? t.slice(0, 160) + "…" : t;
  }
  return undefined;
}
