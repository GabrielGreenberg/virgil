"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
import { finishCompile } from "@/lib/compile/compile-progress";
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
  // Per-run salt so a diagnostic's React key is unique across compiles: the
  // same logical error compiled twice gets a NEW id, and `pruneDismissed`
  // (P5) then re-surfaces a re-occurring error instead of leaving it hidden by
  // a stale dismissal. A monotonic ref counter — deterministic within a run
  // (NOT Date.now()/Math.random(), which would remount cards mid-session).
  const runSaltRef = useRef(0);

  const clearCompileErrors = useCallback(() => {
    setLastLog(null);
    setLastStatus(null);
    setCompileErrors([]);
  }, []);

  const compile = useCallback(async () => {
    if (!docId || isCompiling) return;
    setIsCompiling(true);
    // Bump the per-run salt once at the top of each compile.
    const salt = `r${++runSaltRef.current}:`;
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
              if (resolution.kind === "cancel") {
                finishCompile(docId, "error", "Compile cancelled.");
                return;
              }
              if (resolution.kind === "switch") {
                const rewritten = rewriteDocumentClass(mainTexText, resolution.newClass);
                if (!handle) {
                  finishCompile(docId, "error", "No document handle — compile stopped.");
                  return;
                }
                try {
                  await writeTex(handle, rewritten);
                } catch (err) {
                  if (isStalePipelineError(err)) {
                    finishCompile(docId, "error", "The document was closed — compile stopped.");
                    return;
                  }
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
        docId,
      });

      setLastLog(result.log ?? "");
      // Map the rich status onto the numeric lastStatus the UI expects:
      // ok/degraded → 0 (a PDF exists); everything else → non-zero.
      const numericStatus =
        result.status === "ok" || result.status === "degraded" ? 0 : 1;
      setLastStatus(numericStatus);

      const offlineErrors = [
        ...offlineMissErrors(result, salt),
        ...downloadFailureErrors(result, salt),
      ];

      if ((result.status === "ok" || result.status === "degraded") && result.pdf) {
        // A PDF exists. Surface any warning-level diagnostics (degraded keeps
        // them) plus any offline-package misses, but never block the PDF.
        setCompileErrors([...saltDiagnostics(result.diagnostics, salt), ...offlineErrors]);
        const pdfBytes = result.pdf;
        // Best-effort persistence (P6). `writePdf` now returns a structured
        // result: `written` (nothing to do), `skipped` (library/read-only — the
        // in-memory viewer still shows the PDF), or `failed` (the write was
        // attempted and rejected). A stale-pipeline abort still THROWS, so we
        // keep the silent-drop catch. Crucially, `onCompileSuccess` fires for
        // EVERY successful compile — including library papers and after a
        // `failed`/`skipped` persistence — so the viewer never shows "No
        // compiled PDF" for a compile that actually produced one.
        if (handle) {
          try {
            const persist = await writePdf(handle, pdfBytes);
            if (persist?.status === "failed") {
              console.warn("[compile] PDF persistence failed:", persist.error);
              // Non-blocking soft notice — reuse the low-tone systemDialog (the
              // same soft surface as the skill-sync / external-change badge),
              // NOT a danger modal: the compile SUCCEEDED and the in-memory PDF
              // is fully usable; only saving to disk failed.
              void systemDialog.alert({
                title: "PDF not saved",
                message:
                  "The PDF compiled and is shown, but it couldn't be saved to disk. Your last saved copy on disk is unchanged.",
                tone: "default",
              });
            }
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
      setCompileErrors([...saltDiagnostics(result.diagnostics, salt), ...offlineErrors]);
      console.error(
        `[compile] SwiftLaTeX ${result.status} (ranPasses=${result.ranPasses})\n\n${result.log}`,
      );
      const { title, message } = failureMessage(
        result.status,
        result.log,
        result.assetsFetched ?? 0,
      );
      void systemDialog.alert({ title, message, tone: "danger" });
    } catch (err) {
      console.error("[compile] error:", err);
      // Task 454: the progress channel must reach a terminal state on EVERY
      // path out of this function, or the PDF pane says "Compiling…" forever
      // for a compile that has already ended. The service publishes its own
      // outcome for every result it returns; this is the throw path it cannot
      // see (a storage read that failed, a stale-pipeline abort).
      finishCompile(docId, "error", err instanceof Error ? err.message : String(err));
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
 * Re-mint the compile-service's diagnostics ids with this run's salt so their
 * React keys are unique across compiles (the id changes each run, so a stale
 * dismissal from an earlier run can be pruned and a re-occurring error
 * re-surfaces). The parser already assigned per-parse ordinals; we fold the
 * salt into a fresh, still-collision-free id built from the same parts.
 */
function saltDiagnostics(
  diagnostics: LatexError[] | undefined,
  salt: string,
): LatexError[] {
  if (!diagnostics || diagnostics.length === 0) return [];
  return diagnostics.map((d, ordinal) => ({
    ...d,
    id: makeErrorId({
      source: d.source,
      line: d.line,
      column: d.column,
      message: d.message,
      ordinal,
      salt,
    }),
  }));
}

/**
 * Turn the compile result's `offlineMisses` into `LatexError` entries so each
 * unavailable package renders cleanly in the Errors panel (ruleId
 * 'offline-package' → "Package unavailable offline" title) instead of a cryptic
 * format error or a hang. Deduped; line 0 (no source location). Salted +
 * ordinal-tagged so the line-0 ids never collide.
 */
function offlineMissErrors(result: CompileResult, salt: string): LatexError[] {
  const misses = result.offlineMisses;
  if (!misses || misses.length === 0) return [];
  const seen = new Set<string>();
  const errors: LatexError[] = [];
  let ordinal = 0;
  for (const raw of misses) {
    const pkg = raw.replace(/\.(sty|def|cls|tex|tfm|cfg|ltx)$/i, "");
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const message = `Package ${pkg} unavailable offline`;
    errors.push({
      id: makeErrorId({ source: "compile", line: 0, message, ordinal: ordinal++, salt }),
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

/**
 * Turn the compile result's `downloadFailures` into `LatexError` entries so a
 * mirror that answered badly is NAMED rather than silently leaving the document
 * short of half its packages (task 454). Distinct from an offline miss: these
 * were attempted and the network answered.
 */
function downloadFailureErrors(result: CompileResult, salt: string): LatexError[] {
  const failures = result.downloadFailures;
  if (!failures || failures.length === 0) return [];
  const seen = new Set<string>();
  const errors: LatexError[] = [];
  let ordinal = 0;
  for (const f of failures) {
    const pkg = f.name.replace(/\.(sty|def|cls|tex|tfm|cfg|ltx)$/i, "");
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const message = `Could not download package ${pkg}`;
    errors.push({
      id: makeErrorId({ source: "compile", line: 0, message, ordinal: ordinal++, salt }),
      source: "compile",
      severity: "error",
      line: 0,
      message,
      detail:
        `The TeX package mirror did not return this file (${f.reason}). Check your network connection and compile again — packages already downloaded are cached, so a retry resumes where this one stopped.`,
      ruleId: "package-download-failed",
    });
  }
  return errors;
}

/** Map a non-PDF CompileResult status to a user-facing alert. */
function failureMessage(
  status: CompileStatus,
  _log: string,
  assetsFetched = 0,
): { title: string; message: string } {
  switch (status) {
    case "timeout":
      // Task 454: a timeout that DOWNLOADED packages is not a dead end — every
      // one of them is cached now, so the next attempt resumes from there. Say
      // that, rather than implying the work was thrown away (which is exactly
      // what used to happen).
      return assetsFetched > 0
        ? {
            title: "Still downloading LaTeX packages",
            message: `This paper needs packages that aren't cached yet — ${assetsFetched} downloaded so far, and they're saved. Press Compile again to carry on from here.`,
          }
        : {
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
