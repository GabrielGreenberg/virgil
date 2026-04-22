import type { LatexError } from "./latex-errors";
import { makeErrorId } from "./latex-errors";

/**
 * Best-effort extraction of error/warning entries from a pdfTeX log.
 * Three patterns cover ~all real-world cases:
 *   1. Lines starting with `!` → error. Scan forward up to 6 lines for
 *      `l.<N> <ctx>` to recover the offending line + nearby source.
 *   2. `LaTeX Warning: <msg> on input line <N>.`
 *   3. `Package <pkg> Warning: <msg> on input line <N>.`
 *
 * SwiftLaTeX produces the same log format as upstream pdfTeX.
 */
export function parseTexLog(log: string): LatexError[] {
  const out: LatexError[] = [];
  const lines = log.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];

    if (ln.startsWith("!")) {
      const message = ln.replace(/^!\s*/, "").trim();
      if (!message) continue;
      let line = 0;
      let detail: string | undefined;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const m = lines[j].match(/^l\.(\d+)\s?(.*)$/);
        if (m) {
          line = parseInt(m[1], 10);
          detail = m[2]?.trim() || undefined;
          break;
        }
      }
      out.push({
        id: makeErrorId({ source: "compile", line, message }),
        source: "compile",
        severity: "error",
        line,
        message,
        detail,
        ruleId: "tex-error",
      });
      continue;
    }

    const w = ln.match(
      /^(?:LaTeX|Package\s+\S+)\s+Warning:\s*(.*?)(?:\s+on input line\s+(\d+))?\.?\s*$/,
    );
    if (w) {
      const message = w[1].trim();
      if (!message) continue;
      const line = w[2] ? parseInt(w[2], 10) : 0;
      out.push({
        id: makeErrorId({ source: "compile", line, message }),
        source: "compile",
        severity: "warning",
        line,
        message,
        ruleId: "latex-warning",
      });
    }
  }
  return out;
}
