"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatexError } from "@/lib/latex-errors";
import { lintInWorker } from "@/lib/workers/lint-client";

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

export function useLatexLint({
  text,
  debounceMs = 1500,
  knownBibKeys,
}: UseLatexLintOptions): LatexError[] {
  const [errors, setErrors] = useState<LatexError[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runIdRef = useRef(0);

  // Stable identity for the key list so the effect re-fires only when the
  // actual keys change, not on every parent render.
  const bibKeysStable = useMemo(
    () => knownBibKeys,
    // Note: we rely on the parent passing a stable identity for the
    // array when contents are unchanged.
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
      // Perf Wave 1 (S5): the whole pass — including the ~1MB unified-latex
      // bundle and the multi-second large-doc parse — runs in the lint Web
      // Worker (main-thread fallback inside lintInWorker for SSR/vitest).
      void lintInWorker(text, bibKeysStable).then((next) => {
        if (myRun === runIdRef.current) setErrors(next);
      });
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, debounceMs, bibKeysStable]);

  return errors;
}
