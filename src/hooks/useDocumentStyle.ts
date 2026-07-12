"use client";

import { useCallback, useMemo } from "react";
import { drainDoc, readTex, writeTex } from "@/lib/storage";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import { rewriteDocumentClass } from "@/lib/document-class";
import {
  dispatchTexDelimitersChanged,
  dispatchTexDelimitersWillChange,
} from "@/lib/tex-delimiters-event";
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
        // Ask an open code pane to flush its bridge FIRST: a preamble edit
        // sitting in the bridge's 600 ms debounce commits synchronously
        // (persistDelimiters → an enqueued bundle write) so drainDoc below
        // lands it BEFORE we read the .tex — instead of it firing
        // mid-switch, racing our writeTex, and possibly resurrecting the
        // pre-style preamble. The style rewrite then proceeds on top (hard
        // update — the user's preamble is intentionally replaced; titles
        // are harvested below). No code pane open → free no-op.
        dispatchTexDelimitersWillChange(docId);
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
   * Rides the SAME out-of-band-preamble resync contract as `setStyle` and the
   * compile-path mismatch swap: flush the code-pane bridge + autosave first
   * (`dispatchTexDelimitersWillChange` + `drainDoc`) so no in-flight write
   * resurrects the old class, then rewrite, then `dispatchTexDelimitersChanged`
   * so an open code view re-reads instead of persisting the stale class back.
   * Unlike `setStyle` this does NOT touch `document-settings.json` — the style
   * selection is orthogonal to the class (the swap will simply read as drift
   * from the active style, which is correct: the user changed the class).
   */
  const setDocumentClass = useCallback(
    async (newClass: string) => {
      if (!docId || !handle) return;
      try {
        dispatchTexDelimitersWillChange(docId);
        await drainDoc(docId);
        const existingLatex = await readTex(docId);
        const rewritten = rewriteDocumentClass(existingLatex, newClass);
        // No-op if there's no live `\documentclass` to rewrite, or the class
        // is already the target — avoid a spurious write + resync.
        if (rewritten === existingLatex) return;
        await writeTex(handle, rewritten);
        dispatchTexDelimitersChanged(docId);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to rewrite documentclass:", err);
      }
    },
    [docId, handle],
  );

  return { styleId: state.styleId, setStyle, setDocumentClass };
}
