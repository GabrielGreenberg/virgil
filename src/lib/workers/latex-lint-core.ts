/**
 * The pure lint pass — moved verbatim out of useLatexLint (perf Wave 1 /
 * S5) so it can run inside the lint Web Worker AND as the main-thread
 * fallback (SSR / vitest / Worker-construction failure). Pure text in →
 * plain LatexError[] out; the ~1MB unified-latex bundle is dynamically
 * imported HERE, so with the worker live it never loads on the main
 * thread at all.
 */

import type { LatexError } from "@/lib/latex-errors";
import { assignContentIds, makeErrorId } from "@/lib/latex-errors";
import { runSyntaxChecks } from "@/lib/syntax-check";

interface VFileMessage {
  reason?: string;
  message?: string;
  line?: number | null;
  column?: number | null;
  ruleId?: string | null;
  fatal?: boolean | null;
}

export async function runLint(
  text: string,
  knownBibKeys?: readonly string[],
): Promise<LatexError[]> {
  const bibKeys = knownBibKeys ? new Set(knownBibKeys) : undefined;
  // The pure-text syntactic checker runs first and synchronously — it
  // doesn't need the unified-latex bundle, so any structural errors
  // surface immediately even if the dynamic import below is slow.
  //
  // CONTRACT (task 760): `runLint` never rejects. A throwing check becomes a
  // `parse-failure` record rather than a rejection — a rejected pass has no
  // answer to deliver, so in the worker it strands the client's pending run
  // forever and on the main thread it surfaces as an unhandled rejection.
  let syntaxErrors: LatexError[];
  try {
    syntaxErrors = runSyntaxChecks(text, { knownBibKeys: bibKeys });
  } catch (err) {
    syntaxErrors = [failureRecord("Syntax check failed", err)];
  }

  try {
    const [{ unified }, parseMod, { lints }, { VFile }] = await Promise.all([
      import("unified"),
      import("@unified-latex/unified-latex-util-parse"),
      import("@unified-latex/unified-latex-lint"),
      import("vfile"),
    ]);
    const { unifiedLatexFromString, unifiedLatexAstComplier } = parseMod;

    let processor = unified()
      .use(unifiedLatexFromString)
      // Passthrough compiler so `.process()` doesn't reject for lack of
      // one. We're only here for the diagnostics on the VFile.
      .use(unifiedLatexAstComplier);
    for (const plugin of Object.values(lints)) {
      try {
        processor = processor.use(plugin as never);
      } catch {
        /* skip */
      }
    }

    const file = new VFile({ value: text });
    await processor.process(file as never);
    const messages = (file.messages ?? []) as VFileMessage[];

    const stylisticErrors = messages
      .map((m): LatexError | null => {
        const message = (m.reason ?? m.message ?? "").trim();
        if (!message) return null;
        const line = m.line ?? 0;
        const column = m.column ?? undefined;
        return {
          id: makeErrorId({ source: "lint", line, column, message }),
          source: "lint",
          severity: m.fatal ? "error" : "warning",
          line,
          column,
          message,
          ruleId: m.ruleId ?? undefined,
        };
      })
      .filter((x): x is LatexError => x !== null);

    return assignContentIds([...syntaxErrors, ...stylisticErrors], text);
  } catch (err) {
    // unified-latex pipeline threw — still return the pure-text syntax
    // errors so the user isn't left without any feedback.
    return assignContentIds(
      [...syntaxErrors, failureRecord("Parse error", err)],
      text,
    );
  }
}

/** The one shape a failed lint stage reports as: a line-0 `parse-failure`
 *  error record, so the Errors panel says the pass failed instead of going
 *  quiet. */
function failureRecord(prefix: string, err: unknown): LatexError {
  const detail = err instanceof Error ? err.message : "LaTeX parse failed";
  return {
    id: makeErrorId({ source: "lint", line: 0, message: detail }),
    source: "lint",
    severity: "error",
    line: 0,
    message: `${prefix}: ${detail}`,
    ruleId: "parse-failure",
  };
}
