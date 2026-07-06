"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatexError } from "@/lib/latex-errors";
import { makeErrorId } from "@/lib/latex-errors";
import { createOrdinalMinter } from "@/lib/diagnostics-store";
import { runSyntaxChecks } from "@/lib/syntax-check";

export interface UseLatexLintOptions {
  /** Source text. Pass `null` when the editor is unmounted — hook is
   *  inert and returns []. */
  text: string | null;
  /** Debounce ms; default 1500 to mirror the editor's auto-save cadence. */
  debounceMs?: number;
  /** Bib keys known to the project. Enables `\cite{}`-to-undefined-key
   *  flagging. Pass undefined to skip citation checks. */
  knownBibKeys?: readonly string[];
}

interface VFileMessage {
  reason?: string;
  message?: string;
  line?: number | null;
  column?: number | null;
  ruleId?: string | null;
  fatal?: boolean | null;
}

export function useLatexLint({
  text,
  debounceMs = 1500,
  knownBibKeys,
}: UseLatexLintOptions): LatexError[] {
  const [errors, setErrors] = useState<LatexError[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runIdRef = useRef(0);

  // Stabilize the bib-key set across renders so it's only rebuilt when
  // the actual key list changes, not on every parent render.
  const bibKeySet = useMemo(
    () => (knownBibKeys ? new Set(knownBibKeys) : undefined),
    // Note: we rely on the parent passing a stable identity for the
    // array when contents are unchanged. If they don't, we re-build the
    // set — cheap relative to the lint pass itself.
    [knownBibKeys],
  );

  useEffect(() => {
    if (text == null) {
      setErrors([]);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    const myRun = ++runIdRef.current;
    timerRef.current = setTimeout(() => {
      void runLint(text, bibKeySet).then((next) => {
        if (myRun === runIdRef.current) setErrors(next);
      });
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, debounceMs, bibKeySet]);

  return errors;
}

async function runLint(text: string, bibKeys?: Set<string>): Promise<LatexError[]> {
  // One ordinal minter for the whole pass so every id is unique even when two
  // records share an identical (source, line, col, message) tuple — the line-0
  // collision class (parse-failure + a line-0 stylistic warning both hashing to
  // the same key before). We re-mint at the end so syntax-check's own ids join
  // the same ordinal sequence.
  const minter = createOrdinalMinter();

  // The pure-text syntactic checker runs first and synchronously — it
  // doesn't need the unified-latex bundle, so any structural errors
  // surface immediately even if the dynamic import below is slow.
  const syntaxErrors = runSyntaxChecks(text, { knownBibKeys: bibKeys });

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

    return remintOrdinals([...syntaxErrors, ...stylisticErrors], minter);
  } catch (err) {
    // unified-latex pipeline threw — still return the pure-text syntax
    // errors so the user isn't left without any feedback.
    const message =
      err instanceof Error ? err.message : "LaTeX parse failed";
    return remintOrdinals(
      [
        ...syntaxErrors,
        {
          id: makeErrorId({ source: "lint", line: 0, message }),
          source: "lint",
          severity: "error",
          line: 0,
          message: `Parse error: ${message}`,
          ruleId: "parse-failure",
        },
      ],
      minter,
    );
  }
}

/**
 * Re-mint every id in a lint pass with a shared ordinal minter so no two
 * records collide — the ordinal is the only thing that distinguishes two
 * line-0 records with the same message (e.g. a parse-failure alongside a line-0
 * stylistic warning). Preserves order.
 */
function remintOrdinals(
  errors: LatexError[],
  minter: ReturnType<typeof createOrdinalMinter>,
): LatexError[] {
  return errors.map((e) => ({
    ...e,
    id: makeErrorId({
      source: e.source,
      line: e.line,
      column: e.column,
      message: e.message,
      ordinal: minter.next(),
    }),
  }));
}
