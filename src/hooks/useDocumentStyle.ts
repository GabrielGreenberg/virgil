"use client";

import { useCallback, useMemo } from "react";
import { drainDoc, readTex, writeTex } from "@/lib/storage";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import { dispatchTexDelimitersChanged } from "@/lib/tex-delimiters-event";
import { mergeTitlesIntoStylePreamble } from "@/lib/latex-serializer";
import { DEFAULT_STYLE_ID } from "@/lib/document-styles";
import { resolveStyle } from "@/lib/style-library";
import {
  type DocumentSettings,
  migrateDocumentSettings,
} from "@/lib/document-settings";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { usePersistentState } from "./usePersistentState";

const EMPTY: DocumentSettings = { styleId: DEFAULT_STYLE_ID };

/**
 * Per-doc hook backing the Virgil bar's Style dropdown.
 *
 *  - `style` is the persisted choice from `virgil/document-settings.json`.
 *  - `setStyle(next)` writes the sidecar and rewrites the bytes before
 *    `\begin{document}` in the doc's `.tex` file with the resolved
 *    preamble from the user's style library. Body and postamble are
 *    preserved verbatim.
 *
 * Whatever was in the user's preamble (custom packages, etc.) is
 * intentionally discarded on switch — that's the "Hard update" path.
 * For AI-managed merges, see addStyleMergeRequest in useAiRequests.
 */
export function useDocumentStyle(docId: string | null) {
  const { state, update } = usePersistentState<DocumentSettings>(
    docId,
    "document-settings.json",
    EMPTY,
    { migrate: migrateDocumentSettings, errorLabel: "document settings" },
  );

  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  const setStyle = useCallback(
    async (next: string) => {
      // Persist the choice immediately so the dropdown shows the new
      // selection even if the .tex rewrite below fails.
      update(() => ({ styleId: next }));
      if (!docId || !handle) return;

      const preset = resolveStyle(next);
      try {
        // Flush any in-flight autosave before we read from disk —
        // otherwise the 1500ms debounce window can leave the disk
        // bytes behind the live in-memory title content, and the
        // harvest-and-reinject below would carry the OLD title.
        await drainDoc(docId);

        const existingLatex = await readTex(docId);
        const delimiters = extractPreambleAndPostamble(existingLatex);
        if (!delimiters) {
          // Brand-new / malformed doc with no \begin{document}. Skip the
          // rewrite — the next writeDocBundle save will pick up the new
          // preamble via the style-aware fallback path.
          return;
        }
        const beginDoc = existingLatex.indexOf("\\begin{document}");
        const endDoc = existingLatex.indexOf("\\end{document}");
        const bodyStart = beginDoc + "\\begin{document}".length;
        const bodyEnd = endDoc !== -1 ? endDoc : existingLatex.length;
        // preset.preamble ends with `\begin{document}\n\n` and
        // delimiters.postamble starts with `\n\end{document}…`, so trim
        // the body's surrounding newlines to avoid stacking blank lines.
        const body = existingLatex
          .slice(bodyStart, bodyEnd)
          .replace(/^\n+/, "")
          .replace(/\n+$/, "");

        // Carry the existing `\title{…}` / `\author{…}` / `\date{…}`
        // lines from the OLD preamble into the NEW style preamble.
        // Without this, switching styles would silently drop the title
        // block from disk — the editor's in-memory state still shows
        // it until the next reload, at which point the lozenges
        // disappear because the disk has no `\title{}` left to parse.
        const newPreamble = mergeTitlesIntoStylePreamble(
          existingLatex,
          preset.preamble,
        );
        const newLatex = newPreamble + body + delimiters.postamble;
        await writeTex(handle, newLatex);
        // The .tex preamble just changed OUT OF BAND from the code pane's
        // bridge closure — tell an open CodeEditor to re-read + resync.
        dispatchTexDelimitersChanged(docId);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to rewrite preamble for style switch:", err);
      }
    },
    [docId, handle, update],
  );

  return { styleId: state.styleId, setStyle };
}
