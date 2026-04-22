"use client";

import { useCallback, useState } from "react";
import { flushDoc, getTexFilename, readPaperFolder } from "@/lib/storage";
import { getPdfTeXEngine, writeEngineFile } from "@/lib/swiftlatex";
import type { LatexError } from "@/lib/latex-errors";
import { parseTexLog } from "@/lib/parse-tex-log";

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

export function useLatexCompile(docId: string | null): UseLatexCompileResult {
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
      // Flush any queued writes so the engine sees the latest .tex on disk.
      await flushDoc(docId);

      const [files, texFilename] = await Promise.all([
        readPaperFolder(docId),
        getTexFilename(docId),
      ]);

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

      for (const f of files) {
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
        const blob = new Blob([new Uint8Array(result.pdf)], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        // Revoke later so the new window has time to load the blob.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const parsed = parseTexLog(result.log ?? "");
        setCompileErrors(parsed);
        console.error(
          `[compile] SwiftLaTeX failed (status=${result.status})\n\n${result.log}`,
        );
        window.alert(
          `Compile failed (status ${result.status}). See the Errors panel or compile-log drawer for details.`,
        );
      }
    } catch (err) {
      console.error("[compile] error:", err);
      window.alert(
        `Compile failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsCompiling(false);
    }
  }, [docId, isCompiling]);

  return { compile, isCompiling, lastLog, lastStatus, compileErrors, clearCompileErrors };
}
