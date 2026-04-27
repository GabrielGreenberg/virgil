"use client";

import { useCallback } from "react";
import { readTex, writeTex } from "@/lib/storage";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  DEFAULT_STYLE_ID,
  getStyle,
  type DocumentStyleId,
} from "@/lib/document-styles";
import {
  type DocumentSettings,
} from "@/lib/document-settings";
import { usePersistentState } from "./usePersistentState";

const EMPTY: DocumentSettings = { style: DEFAULT_STYLE_ID };

function migrate(raw: unknown): DocumentSettings {
  const s = (raw ?? {}) as Partial<DocumentSettings>;
  return { style: (s.style as DocumentStyleId) ?? DEFAULT_STYLE_ID };
}

/**
 * Per-doc hook backing the Virgil bar's Style dropdown.
 *
 *  - `style` is the persisted choice from `virgil/document-settings.json`.
 *  - `setStyle(next)` writes the sidecar and rewrites the bytes before
 *    `\begin{document}` in the doc's `.tex` file with the new preset's
 *    preamble. Body and postamble are preserved verbatim.
 *
 * Whatever was in the user's preamble (custom packages, etc.) is
 * intentionally discarded on switch — that's the point.
 */
export function useDocumentStyle(docId: string | null) {
  const { state, update } = usePersistentState<DocumentSettings>(
    docId,
    "document-settings.json",
    EMPTY,
    { migrate, errorLabel: "document settings" },
  );

  const setStyle = useCallback(
    async (next: DocumentStyleId) => {
      // Persist the choice immediately so the dropdown shows the new
      // selection even if the .tex rewrite below fails.
      update(() => ({ style: next }));
      if (!docId) return;

      const preset = getStyle(next);
      try {
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

        const newLatex = preset.preamble + body + delimiters.postamble;
        await writeTex(docId, newLatex);
      } catch (err) {
        console.error("Failed to rewrite preamble for style switch:", err);
      }
    },
    [docId, update],
  );

  return { style: state.style, setStyle };
}
