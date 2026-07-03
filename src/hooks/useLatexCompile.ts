"use client";

import { useCallback, useMemo, useState } from "react";
import { drainDoc, flushDoc, getTexFilename, readPaperFolder, writeTex, writePdf, pdfFilenameFromTex } from "@/lib/storage";
import { getPdfTeXEngine, writeEngineFile } from "@/lib/swiftlatex";
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
import type { LatexError } from "@/lib/latex-errors";
import { parseTexLog } from "@/lib/parse-tex-log";
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

// SwiftLaTeX bundles bibtex but not biber, so biblatex users get rewritten to
// backend=bibtex. This loses some biblatex features (Unicode sorting, a few
// style options) but covers the vast majority of papers.
function rewriteBiblatexBackend(text: string): string {
  return text.replace(
    /\\usepackage(?:\[([^\]]*)\])?\{biblatex\}/g,
    (match, opts?: string) => {
      if (!opts) return "\\usepackage[backend=bibtex]{biblatex}";
      if (/\bbackend\s*=\s*bibtex\b/.test(opts)) return match;
      if (/\bbackend\s*=\s*biber\b/.test(opts)) {
        return `\\usepackage[${opts.replace(/\bbackend\s*=\s*biber\b/, "backend=bibtex")}]{biblatex}`;
      }
      if (/\bbackend\s*=/.test(opts)) return match;
      return `\\usepackage[${opts.trim()},backend=bibtex]{biblatex}`;
    },
  );
}

/**
 * Compile the active document with SwiftLaTeX's pdfTeX engine and open
 * the resulting PDF in a new browser window. On failure the full log is
 * dumped to the console and a short alert is shown.
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
          const mainTexText = new TextDecoder().decode(mainTexFile.bytes);
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

      const engine = await getPdfTeXEngine();
      engine.flushCache();

      const createdDirs = new Set<string>();
      const textExts = new Set([
        "tex",
        "bib",
        "sty",
        "cls",
        "bst",
        "tikz",
        "md",
        "txt",
        "cfg",
        "def",
        "ltx",
      ]);

      const decoder = new TextDecoder();
      const decoded = new Map<string, string>();
      for (const f of files) {
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        if (textExts.has(ext)) decoded.set(f.path, decoder.decode(f.bytes));
      }

      const BIB_RE =
        /\\usepackage\{natbib\}|\\bibliography\{|\\addbibresource\{|\\usepackage(?:\[[^\]]*\])?\{biblatex\}/;
      const BIBLATEX_RE = /\\usepackage(?:\[[^\]]*\])?\{biblatex\}/;
      let hasBibliography = false;
      let hasBiblatex = false;
      for (const text of decoded.values()) {
        if (!hasBibliography && BIB_RE.test(text)) hasBibliography = true;
        if (!hasBiblatex && BIBLATEX_RE.test(text)) hasBiblatex = true;
        if (hasBibliography && hasBiblatex) break;
      }

      if (hasBiblatex) {
        for (const [path, text] of decoded) {
          const rewritten = rewriteBiblatexBackend(text);
          if (rewritten !== text) {
            decoded.set(path, rewritten);
            console.warn(
              `[compile] biber is not available in the browser; rewrote \\usepackage{biblatex} in ${path} to use backend=bibtex`,
            );
          }
        }
      }

      const pdfFilename = pdfFilenameFromTex(texFilename);
      for (const f of files) {
        if (f.path === pdfFilename) continue;
        const text = decoded.get(f.path);
        const data = text !== undefined ? text : f.bytes;
        writeEngineFile(engine, f.path, data, createdDirs);
      }

      engine.setEngineMainFile(texFilename);

      const passes = hasBibliography ? 3 : 1;
      let result = await engine.compileLaTeX();
      for (let i = 1; i < passes && result.status === 0; i++) {
        result = await engine.compileLaTeX();
      }

      setLastLog(result.log ?? "");
      setLastStatus(result.status);

      if (result.status === 0 && result.pdf) {
        setCompileErrors([]);
        const pdfBytes = new Uint8Array(result.pdf);
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
      } else {
        const parsed = parseTexLog(result.log ?? "");
        setCompileErrors(parsed);
        console.error(
          `[compile] SwiftLaTeX failed (status=${result.status})\n\n${result.log}`,
        );
        void systemDialog.alert({
          title: "Compile failed",
          message: `Status ${result.status}. See the Errors panel or compile-log drawer for details.`,
          tone: "danger",
        });
      }
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
