"use client";

import { useCallback, useMemo, useState } from "react";
import { drainDoc, flushDoc, getTexFilename, readPaperFolder, writeTex, writePdf } from "@/lib/storage";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import {
  detectDocumentClassMismatch,
  rewriteDocumentClass,
  type DocumentClassMismatch,
} from "@/lib/document-class";
import { dispatchTexDelimitersChanged } from "@/lib/tex-delimiters-event";
import { makeErrorId, type LatexError } from "@/lib/latex-errors";
import { compileService } from "@/lib/compile/compile-service";
import type { CompileResult } from "@/lib/compile/compile-types";
import type { CompileStatus } from "@/lib/compile/compile-types";
import { decodeTexBytes } from "@/lib/compile/decode-source";
import { useSystemDialog } from "@/components/system-dialog-host";

/**
 * Called when the compile hook finds that the document's
 * `\documentclass` doesn't define one of the sectioning commands used.
 * Host UI surfaces a prompt (dropdown of compatible classes) and
 * resolves with the user's choice.
 */
export type DocumentClassMismatchHandler = (
  mismatch: DocumentClassMismatch,
) => Promise<
  | { kind: "switch"; newClass: string }
  | { kind: "compile-anyway" }
  | { kind: "cancel" }
>;

/**
 * Compile the active document with SwiftLaTeX's pdfTeX engine and open
 * the resulting PDF in a new browser window. On failure the full log is
 * dumped to the console and a short alert is shown.
 *
 * This hook is now a THIN SHELL over the CompileService (src/lib/compile) — it
 * owns no engine, memfs, pass loop, or TextDecoder. It drains the doc, resolves
 * the documentclass-mismatch fork (the one path that still writes to disk),
 * hands the files to `compileService.compile()`, and maps the rich typed
 * `CompileResult` back onto the hook's existing outputs.
 */
export interface UseLatexCompileResult {
  compile: () => Promise<void>;
  isCompiling: boolean;
  /** Raw pdfTeX log from the most recent compile, or null if none yet. */
  lastLog: string | null;
  /** Status code from the most recent compile (0 = success). */
  lastStatus: number | null;
  /** Parsed errors/warnings from the most recent compile log. Cleared on success. */
  compileErrors: LatexError[];
  /** Wipe lastLog/lastStatus/compileErrors (e.g. when switching docs). */
  clearCompileErrors: () => void;
}

export function useLatexCompile(
  docId: string | null,
  opts?: {
    onDocumentClassMismatch?: DocumentClassMismatchHandler;
    onCompileSuccess?: (pdfBytes: Uint8Array) => void;
  },
): UseLatexCompileResult {
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );
  const onDocumentClassMismatch = opts?.onDocumentClassMismatch;
  const onCompileSuccess = opts?.onCompileSuccess;
  const systemDialog = useSystemDialog();
  const [isCompiling, setIsCompiling] = useState(false);
  const [lastLog, setLastLog] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<number | null>(null);
  const [compileErrors, setCompileErrors] = useState<LatexError[]>([]);

  const clearCompileErrors = useCallback(() => {
    setLastLog(null);
    setLastStatus(null);
    setCompileErrors([]);
  }, []);

  const compile = useCallback(async () => {
    if (!docId || isCompiling) return;
    setIsCompiling(true);
    try {
      // Flush any pending React debounce + queued writes so the engine
      // sees the user's latest edits, even if they hit Compile mid-edit.
      await drainDoc(docId);

      const [initialFiles, texFilename] = await Promise.all([
        readPaperFolder(docId),
        getTexFilename(docId),
      ]);
      let files = initialFiles;

      // Check the main .tex for a documentclass/heading mismatch before
      // handing off to pdfTeX. If the user picks a new class we rewrite
      // the file on disk and re-read the folder so the engine sees it.
      if (onDocumentClassMismatch) {
        const mainTexFile = files.find((f) => f.path === texFilename);
        if (mainTexFile) {
          // Fatal decode: a non-UTF-8 main .tex must not be persisted
          // U+FFFD-corrupted on the documentclass-rewrite path. If the file
          // isn't valid UTF-8 we skip the mismatch check (can't rewrite it
          // safely) and let the compile proceed on raw bytes.
          const decoded = decodeTexBytes(mainTexFile.bytes);
          if ("text" in decoded) {
            const mainTexText = decoded.text;
            const mismatch = detectDocumentClassMismatch(mainTexText);
            if (mismatch) {
              const resolution = await onDocumentClassMismatch(mismatch);
              if (resolution.kind === "cancel") return;
              if (resolution.kind === "switch") {
                const rewritten = rewriteDocumentClass(mainTexText, resolution.newClass);
                if (!handle) return;
                try {
                  await writeTex(handle, rewritten);
                } catch (err) {
                  if (isStalePipelineError(err)) return;
                  throw err;
                }
                await flushDoc(docId);
                // The rewrite replaced the \documentclass line — i.e. the
                // on-disk PREAMBLE — out of band from the code pane's bridge
                // closure. Tell an open CodeEditor to re-read + resync (same
                // contract as useDocumentStyle.setStyle and the external
                // Reload), or a later code-pane preamble edit would persist
                // the OLD documentclass back over the switch the user just
                // confirmed. No code pane open → free no-op.
                dispatchTexDelimitersChanged(docId);
                files = await readPaperFolder(docId);
              }
              // "compile-anyway" falls through with the original files.
            }
          }
        }
      }

      // Hand off to the CompileService — it owns the engine, requirement
      // injection (in-memory only), the multi-pass loop, timeout + recovery,
      // and byte-first file feeding.
      const result = await compileService.compile({
        files,
        mainTexFilename: texFilename,
      });

      setLastLog(result.log ?? "");
      // Map the rich status onto the numeric lastStatus the UI expects:
      // ok/degraded → 0 (a PDF exists); everything else → non-zero.
      const numericStatus =
        result.status === "ok" || result.status === "degraded" ? 0 : 1;
      setLastStatus(numericStatus);

      const offlineErrors = offlineMissErrors(result);

      if ((result.status === "ok" || result.status === "degraded") && result.pdf) {
        // A PDF exists. Surface any warning-level diagnostics (degraded keeps
        // them) plus any offline-package misses, but never block the PDF.
        setCompileErrors([...(result.diagnostics ?? []), ...offlineErrors]);
        const pdfBytes = result.pdf;
        if (handle) {
          try {
            await writePdf(handle, pdfBytes);
          } catch (err) {
            if (isStalePipelineError(err)) {
              // Pipeline ended mid-compile — drop the .pdf write
              // silently. The compile log + UI state already updated.
            } else {
              throw err;
            }
          }
        }
        onCompileSuccess?.(pdfBytes);

        // A degraded compile still produced a PDF; warn (but don't alert as
        // an error) when a later pass failed, the bibtex stage broke, or a
        // package was unavailable offline.
        if (result.status === "degraded") {
          const reason =
            offlineErrors.length > 0
              ? `${offlineErrors.length === 1 ? "A package was" : `${offlineErrors.length} packages were`} unavailable offline — some content may be missing.`
              : result.bibtexStatus === "failed"
                ? "The bibliography step failed — citations may show as [?]."
                : "A later compile pass failed — cross-references or the ToC may be stale.";
          void systemDialog.alert({
            title: "Compiled with warnings",
            message: `${reason} See the Errors panel for details.`,
            tone: "default",
          });
        }
        return;
      }

      // No usable PDF. Distinguish the failure kinds for a clear message.
      setCompileErrors([...(result.diagnostics ?? []), ...offlineErrors]);
      console.error(
        `[compile] SwiftLaTeX ${result.status} (ranPasses=${result.ranPasses})\n\n${result.log}`,
      );
      const { title, message } = failureMessage(result.status, result.log);
      void systemDialog.alert({ title, message, tone: "danger" });
    } catch (err) {
      console.error("[compile] error:", err);
      void systemDialog.alert({
        title: "Compile failed",
        message: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    } finally {
      setIsCompiling(false);
    }
  }, [docId, handle, isCompiling, onDocumentClassMismatch, onCompileSuccess, systemDialog]);

  return { compile, isCompiling, lastLog, lastStatus, compileErrors, clearCompileErrors };
}

/**
 * Turn the compile result's `offlineMisses` into `LatexError` entries so each
 * unavailable package renders cleanly in the Errors panel (ruleId
 * 'offline-package' → "Package unavailable offline" title) instead of a cryptic
 * format error or a hang. Deduped; line 0 (no source location).
 */
function offlineMissErrors(result: CompileResult): LatexError[] {
  const misses = result.offlineMisses;
  if (!misses || misses.length === 0) return [];
  const seen = new Set<string>();
  const errors: LatexError[] = [];
  for (const raw of misses) {
    const pkg = raw.replace(/\.(sty|def|cls|tex|tfm|cfg|ltx)$/i, "");
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const message = `Package ${pkg} unavailable offline`;
    errors.push({
      id: makeErrorId({ source: "compile", line: 0, message }),
      source: "compile",
      severity: "error",
      line: 0,
      message,
      detail:
        "This package hasn't been cached yet. Connect to the internet and compile once to make it available offline.",
      ruleId: "offline-package",
    });
  }
  return errors;
}

/** Map a non-PDF CompileResult status to a user-facing alert. */
function failureMessage(
  status: CompileStatus,
  _log: string,
): { title: string; message: string } {
  switch (status) {
    case "timeout":
      return {
        title: "Compile timed out",
        message:
          "The compile took too long and was stopped. The engine has been reset — try compiling again.",
      };
    case "boot-failed":
      return {
        title: "Compile engine failed to start",
        message:
          "The LaTeX engine could not be started. Check your network connection and try again.",
      };
    default:
      // "failed" (and, defensively, an ok/degraded result that somehow carried
      // no pdf) fall through to the generic message.
      return {
        title: "Compile failed",
        message: "See the Errors panel or compile-log drawer for details.",
      };
  }
}
