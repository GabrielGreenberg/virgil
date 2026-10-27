"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { LatexError } from "@/lib/latex-errors";
import {
  getCompileRecord,
  isCompileRunning,
  subscribeCompileRecord,
} from "@/lib/compile/compile-record";
import {
  runCompileForDoc,
  type DocumentClassMismatchHandler,
} from "@/lib/compile/run-compile-for-doc";
import { useSystemDialog } from "@/components/system-dialog-host";

/**
 * A pane's door onto its document's compile. Pressing it runs
 * `runCompileForDoc` (module scope — the run outlives this pane); everything
 * it reports is READ from the per-doc `compile-record` (task 1277), so a pane
 * mounted mid-run reports the live run, and a pane mounted after it finished
 * shows its log, diagnostics and PDF — instead of each pane instance holding a
 * private copy that died with it under keep-alive eviction.
 */
export interface UseLatexCompileResult {
  /** Run a compile for this doc. Resolves `true` exactly when THIS call's run
   *  published a new PDF — the "fresh success" edge (task 1320), which is not
   *  the same as `onCompileSuccess`: that one also fires on mount for a PDF
   *  produced earlier, and a caller that opens the PDF on success must not
   *  fire on a remount. `false` for a failure, a cancel, or a press that
   *  joined a run already in flight (that run's own caller owns its edge). */
  compile: () => Promise<boolean>;
  /** A run for this doc is in flight — whichever pane started it. */
  isCompiling: boolean;
  /** Raw pdfTeX log from the doc's most recent compile, or null if none yet. */
  lastLog: string | null;
  /** Status code from the doc's most recent compile (0 = success). */
  lastStatus: number | null;
  /** Parsed errors/warnings from the doc's most recent compile log. */
  compileErrors: LatexError[];
}

export function useLatexCompile(
  docId: string | null,
  opts?: {
    onDocumentClassMismatch?: DocumentClassMismatchHandler;
    /** Fires once per new PDF in the doc's record — including, on mount, the
     *  PDF of a run that finished while no pane for the doc was mounted. */
    onCompileSuccess?: (pdfBytes: Uint8Array, compiledAt: number) => void;
  },
): UseLatexCompileResult {
  const onDocumentClassMismatch = opts?.onDocumentClassMismatch;
  const onCompileSuccess = opts?.onCompileSuccess;
  const systemDialog = useSystemDialog();
  const record = useSyncExternalStore(
    subscribeCompileRecord,
    () => getCompileRecord(docId),
    () => getCompileRecord(docId),
  );

  // Deliver each PDF generation to this pane exactly once. Keyed by docId so a
  // pane re-pointed at another doc delivers that doc's PDF afresh.
  const deliveredRef = useRef<{ docId: string | null; generation: number }>({
    docId: null,
    generation: 0,
  });
  useEffect(() => {
    if (!docId || !record.pdf || record.pdfGeneration === 0) return;
    const delivered = deliveredRef.current;
    if (delivered.docId === docId && delivered.generation >= record.pdfGeneration) return;
    deliveredRef.current = { docId, generation: record.pdfGeneration };
    onCompileSuccess?.(record.pdf, record.pdfAt);
  }, [docId, record.pdf, record.pdfGeneration, record.pdfAt, onCompileSuccess]);

  const compile = useCallback(async () => {
    if (!docId) return false;
    if (isCompileRunning(docId)) return false;
    const startGeneration = getCompileRecord(docId).pdfGeneration;
    await runCompileForDoc(docId, {
      onDocumentClassMismatch,
      alert: systemDialog.alert,
    });
    return getCompileRecord(docId).pdfGeneration > startGeneration;
  }, [docId, onDocumentClassMismatch, systemDialog]);

  return {
    compile,
    isCompiling: record.running,
    lastLog: record.log,
    lastStatus: record.status,
    compileErrors: record.errors,
  };
}
