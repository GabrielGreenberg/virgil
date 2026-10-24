/**
 * runCompileForDoc — one document's compile, from the click to the last write,
 * owned by the DOCUMENT rather than by the pane that pressed the button
 * (task 1277).
 *
 * This is the body `useLatexCompile` used to run inside a pane-scoped
 * `useCallback`, moved to module scope so that everything after the
 * CompileService returns — persisting the PDF, publishing the log / status /
 * diagnostics, delivering the bytes — reaches the per-doc `compile-record`
 * instead of the setState of a pane that the keep-alive LRU may have unmounted
 * while a minutes-long cold compile ran. Two rules follow:
 *
 *  - **The write handle is resolved at WRITE time** (`getActiveHandle(docId)`),
 *    never captured at mount: a pane's unmount ends its pipeline and a reopen
 *    begins a new one, and the mount-time handle then throws
 *    `StalePipelineError` — which used to drop the PDF on the floor. If no
 *    pipeline is open at all, the bytes still land in the record, so the next
 *    mount shows them.
 *  - **The re-entry guard is the record** (`markCompileStarted`), so a pane
 *    mounted mid-run cannot start a second compile — and reset the live
 *    progress record — under the first.
 *
 * Pane UI stays the caller's: the documentclass-mismatch prompt and the dialog
 * door are passed in. The dialog host is app-level, so an alert raised after
 * the starting pane is gone still reaches the user.
 */

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
import { LATEX_RULE } from "@/lib/latex-rules";
import { compileService } from "@/lib/compile/compile-service";
import { beginCompile, finishCompile } from "@/lib/compile/compile-progress";
import {
  markCompileEnded,
  markCompileStarted,
  nextCompileSalt,
  recordCompileResult,
} from "@/lib/compile/compile-record";
import type { CompileResult } from "@/lib/compile/compile-types";
import {
  compilePackageName,
  describeCompileOutcome,
} from "@/lib/compile/compile-outcome";
import { decodeTexBytes } from "@/lib/compile/decode-source";
import type { SystemDialogApi } from "@/components/system-dialog-host";

/**
 * Called when the compile finds that the document's `\documentclass` doesn't
 * define one of the sectioning commands used. Host UI surfaces a prompt
 * (dropdown of compatible classes) and resolves with the user's choice.
 */
export type DocumentClassMismatchHandler = (
  mismatch: DocumentClassMismatch,
) => Promise<
  | { kind: "switch"; newClass: string }
  | { kind: "compile-anyway" }
  | { kind: "cancel" }
>;

export interface RunCompileDeps {
  onDocumentClassMismatch?: DocumentClassMismatchHandler;
  alert: SystemDialogApi["alert"];
}

/**
 * Compile `docId`. A no-op when a run for this doc is already in flight.
 * Every path out leaves the progress record terminal and the run marked ended.
 */
export async function runCompileForDoc(docId: string, deps: RunCompileDeps): Promise<void> {
  if (!markCompileStarted(docId)) return;
  const { onDocumentClassMismatch, alert } = deps;
  const salt = nextCompileSalt(docId);
  // Task 1091: the record speaks from the CLICK, not from when the service
  // admits the run — the drain + folder read (+ a documentclass prompt) come
  // first, and the previous outcome must not keep telling the user to press a
  // button that is already working. Every path out below writes a terminal
  // state (the service's own finish, the prompt's cancel, the throw path).
  beginCompile(docId);
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
              // Task 855: the user's own Cancel is not a failure — the pane words
              // it in the neutral register, never as an alert.
              finishCompile(docId, "cancelled");
              return;
            }
            if (resolution.kind === "switch") {
              const rewritten = rewriteDocumentClass(mainTexText, resolution.newClass);
              // Resolved NOW, not at mount (task 1277).
              const handle = getActiveHandle(docId);
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

    // Map the rich status onto the numeric status the UI expects:
    // ok/degraded → 0 (a PDF exists); everything else → non-zero.
    const numericStatus =
      result.status === "ok" || result.status === "degraded" ? 0 : 1;
    const errors = [
      ...saltDiagnostics(result.diagnostics, salt),
      ...offlineMissErrors(result, salt),
      ...downloadFailureErrors(result, salt),
    ];

    if ((result.status === "ok" || result.status === "degraded") && result.pdf) {
      // A PDF exists. Surface any warning-level diagnostics (degraded keeps
      // them) plus any offline-package misses, but never block the PDF.
      const pdfBytes = result.pdf;
      // Best-effort persistence (P6), on the doc's CURRENT pipeline. `writePdf`
      // returns a structured result: `written`, `skipped` (library/read-only —
      // the in-memory viewer still shows the PDF), or `failed` (attempted and
      // rejected). A stale-pipeline abort still THROWS — the pipeline ended
      // between the resolve and the write — and drops only the disk copy.
      // Either way the bytes are published to the record below, so the viewer
      // never shows "No compiled PDF" for a compile that produced one.
      const handle = getActiveHandle(docId);
      if (handle) {
        try {
          const persist = await writePdf(handle, pdfBytes);
          if (persist?.status === "failed") {
            console.warn("[compile] PDF persistence failed:", persist.error);
            // Non-blocking soft notice — the low-tone systemDialog (the same
            // soft surface as the skill-sync / external-change badge), NOT a
            // danger modal: the compile SUCCEEDED and the in-memory PDF is
            // fully usable; only saving to disk failed.
            void alert({
              title: "PDF not saved",
              message:
                "The PDF compiled and is shown, but it couldn't be saved to disk. Your last saved copy on disk is unchanged.",
              tone: "default",
            });
          }
        } catch (err) {
          if (!isStalePipelineError(err)) throw err;
        }
      }
      recordCompileResult(docId, {
        log: result.log ?? "",
        status: numericStatus,
        errors,
        pdf: pdfBytes,
      });

      // A degraded compile still produced a PDF; warn (but don't alert as
      // an error) when a later pass failed, the bibtex stage broke, or a
      // package could not be downloaded / was unavailable offline.
      if (result.status === "degraded") {
        // The words come from the ONE outcome vocabulary the PDF pane also
        // reads (task 575) — never a sentence of this module's own.
        const outcome = describeCompileOutcome(result);
        if (outcome) {
          void alert({ title: outcome.title, message: outcome.message, tone: outcome.tone });
        }
      }
      return;
    }

    // No usable PDF. Distinguish the failure kinds for a clear message.
    recordCompileResult(docId, { log: result.log ?? "", status: numericStatus, errors });
    // A cancelled compile is the user's choice: nothing to log as an error,
    // and the outcome vocabulary raises no dialog for it (task 855).
    if (result.status === "cancelled") return;
    console.error(
      `[compile] SwiftLaTeX ${result.status} (ranPasses=${result.ranPasses})\n\n${result.log}`,
    );
    // An ok/degraded result that somehow carried no PDF is, for the user, a
    // failed compile — word it as one rather than as a success.
    const outcome = describeCompileOutcome(
      result.status === "ok" || result.status === "degraded"
        ? { ...result, status: "failed" }
        : result,
    );
    if (outcome) {
      void alert({ title: outcome.title, message: outcome.message, tone: outcome.tone });
    }
  } catch (err) {
    console.error("[compile] error:", err);
    // Task 454: the progress channel must reach a terminal state on EVERY
    // path out of this function, or the PDF pane says "Compiling…" forever
    // for a compile that has already ended. The service publishes its own
    // outcome for every result it returns; this is the throw path it cannot
    // see (a storage read that failed, a stale-pipeline abort).
    finishCompile(docId, "error", err instanceof Error ? err.message : String(err));
    void alert({
      title: "Compile failed",
      message: err instanceof Error ? err.message : String(err),
      tone: "danger",
    });
  } finally {
    markCompileEnded(docId);
  }
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
export function offlineMissErrors(result: CompileResult, salt: string): LatexError[] {
  const misses = result.offlineMisses;
  if (!misses || misses.length === 0) return [];
  const seen = new Set<string>();
  const errors: LatexError[] = [];
  let ordinal = 0;
  for (const raw of misses) {
    const pkg = compilePackageName(raw);
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const message = `Package ${pkg} unavailable offline`;
    errors.push({
      id: makeErrorId({ source: "compile", line: 0, message, ordinal: ordinal++, salt }),
      source: "compile",
      severity: "error",
      line: 0,
      message,
      remedy:
        "This package hasn't been cached yet. Connect to the internet and compile once to make it available offline.",
      ruleId: LATEX_RULE.offlinePackage,
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
export function downloadFailureErrors(result: CompileResult, salt: string): LatexError[] {
  const failures = result.downloadFailures;
  if (!failures || failures.length === 0) return [];
  const seen = new Set<string>();
  const errors: LatexError[] = [];
  let ordinal = 0;
  for (const f of failures) {
    const pkg = compilePackageName(f.name);
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const message = `Could not download package ${pkg}`;
    errors.push({
      id: makeErrorId({ source: "compile", line: 0, message, ordinal: ordinal++, salt }),
      source: "compile",
      severity: "error",
      line: 0,
      message,
      remedy:
        `The TeX package mirror did not return this file (${f.reason}). Check your network connection and compile again — packages already downloaded are cached, so a retry resumes where this one stopped.`,
      ruleId: LATEX_RULE.packageDownloadFailed,
    });
  }
  return errors;
}
