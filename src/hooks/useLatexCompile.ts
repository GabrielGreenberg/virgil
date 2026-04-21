"use client";

import { useCallback, useState } from "react";
import { flushDoc, getTexFilename, readPaperFolder } from "@/lib/storage";
import { getPdfTeXEngine, writeEngineFile } from "@/lib/swiftlatex";

/**
 * Compile the active document with SwiftLaTeX's pdfTeX engine and open
 * the resulting PDF in a new browser window. On failure the full log is
 * dumped to the console and a short alert is shown.
 */
export function useLatexCompile(docId: string | null) {
  const [isCompiling, setIsCompiling] = useState(false);

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
      for (const f of files) {
        const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
        const data = textExts.has(ext)
          ? new TextDecoder().decode(f.bytes)
          : f.bytes;
        writeEngineFile(engine, f.path, data, createdDirs);
      }

      engine.setEngineMainFile(texFilename);
      const result = await engine.compileLaTeX();

      if (result.status === 0 && result.pdf) {
        const blob = new Blob([new Uint8Array(result.pdf)], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        // Revoke later so the new window has time to load the blob.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        console.error(
          `[compile] SwiftLaTeX failed (status=${result.status})\n\n${result.log}`,
        );
        window.alert(
          `Compile failed (status ${result.status}). See the browser console for the full log.`,
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

  return { compile, isCompiling };
}
