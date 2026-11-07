"use client";

import { useCallback } from "react";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import { findDocumentBoundary } from "@/lib/latex-lexer";
import { rewriteDocumentClass } from "@/lib/document-class";
import { rewriteTexOutOfBand } from "@/lib/tex-rewrite";
import { mergeTitlesIntoStylePreamble } from "@/lib/latex-serializer";
import { DEFAULT_STYLE_ID } from "@/lib/document-styles";
import { resolveStyle } from "@/lib/style-library";
import {
  type DocumentSettings,
  migrateDocumentSettings,
} from "@/lib/document-settings";
import { isStalePipelineError } from "@/lib/multi-window/doc-pipeline";
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

  const setStyle = useCallback(
    async (next: string) => {
      // Persist the choice immediately so the dropdown shows the new
      // selection even if the .tex rewrite below fails.
      update(() => ({ styleId: next }));
      if (!docId) return;

      const preset = resolveStyle(next);
      try {
        // Through the ONE out-of-band door (task 1501): it drains first — the
        // autosave, so the title harvest below sees the live title rather than
        // bytes 1500 ms behind it; and an open code pane's bridge, so a
        // preamble edit in its debounce lands BEFORE this rewrite instead of
        // racing it — then applies the splice to a FRESH read inside the write
        // queue, then tells the code pane. The user's preamble is replaced
        // wholesale (hard update); titles are harvested below.
        await rewriteTexOutOfBand(docId, (existingLatex) =>
          spliceStylePreamble(existingLatex, preset.preamble),
        );
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to rewrite preamble for style switch:", err);
      }
    },
    [docId, update],
  );

  /**
   * Swap ONLY the document's `\documentclass` name in place — a purely
   * mechanical change (`rewriteDocumentClass` preserves the `[options]` list
   * and every other byte, preamble and body alike). This backs the Style
   * panel's "change doc type" control for the safe case (the target class
   * supports every sectioning command the body uses — any upgrade, plus
   * lateral swaps). The structural-downgrade case (target drops a command the
   * body relies on) is gated OUT of this path by the caller and routed to a
   * restructuring prompt instead.
   *
   * Rides the SAME out-of-band door as `setStyle` and the compile-path
   * mismatch swap (`rewriteTexOutOfBand`, task 1501): drain, transform a fresh
   * read inside the write queue, tell an open code view to re-read.
   * Unlike `setStyle` this does NOT touch `document-settings.json` — the style
   * selection is orthogonal to the class (the swap will simply read as drift
   * from the active style, which is correct: the user changed the class).
   */
  const setDocumentClass = useCallback(
    async (newClass: string) => {
      if (!docId) return;
      try {
        // A no-op (no live `\documentclass`, or already the target) returns
        // the same text, which the door treats as "leave the file alone" — no
        // spurious write, no resync.
        await rewriteTexOutOfBand(docId, (existingLatex) =>
          rewriteDocumentClass(existingLatex, newClass),
        );
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to rewrite documentclass:", err);
      }
    },
    [docId],
  );

  return { styleId: state.styleId, setStyle, setDocumentClass };
}

/**
 * Replace everything before the body with `stylePreamble`, keeping the body
 * and postamble verbatim and carrying the old `\title` / `\author` / `\date`
 * lines across. Pure — the door runs it on a fresh read.
 *
 * `null` for a brand-new / malformed doc with no `\begin{document}`: skip the
 * rewrite — the next writeDocBundle save picks up the new preamble via the
 * style-aware fallback path.
 */
function spliceStylePreamble(existingLatex: string, stylePreamble: string): string | null {
  const delimiters = extractPreambleAndPostamble(existingLatex);
  if (!delimiters) return null;
  // The LIVE boundary, through the one door (task 375) — this splice
  // REPLACES the user's preamble wholesale, so a boundary read off a
  // commented-out or verbatim-quoted token would carve the swap out of
  // the middle of the paper.
  const { bodyStart, endDoc } = findDocumentBoundary(existingLatex);
  const bodyEnd = endDoc !== -1 ? endDoc : existingLatex.length;
  // stylePreamble ends with `\begin{document}\n\n` and
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
  const newPreamble = mergeTitlesIntoStylePreamble(existingLatex, stylePreamble);
  return newPreamble + body + delimiters.postamble;
}
