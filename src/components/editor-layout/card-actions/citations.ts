import { useCallback, type RefObject } from "react";
import type { CitationRef } from "@/lib/types";
import type { EditorHandle } from "../../Editor";

/**
 * Citation handlers shared across the main editor and panel rich-text
 * mini-editors.
 *
 * - `handleCitationCreated` is what the mini-editors call when the user
 *   drops a brand-new `\cite{key}` into a footnote or note. It registers
 *   the command in the citations store (so the card appears in the side
 *   panel), returns the new ref id and display text for the mini-editor
 *   to attach to its Citation node.
 * - `handleCitationDrop` is the main editor's counterpart. If the drop
 *   carries a citationId from an unanchored panel card, we reuse that id
 *   so the panel card transitions to "anchored" instead of leaving a
 *   duplicate behind. Otherwise we mint a fresh ref.
 */
export function useCitationActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  getCitationDisplayText: (command: string) => string;
  addCitation: (command: string, existingId?: string, markUnanchored?: boolean) => CitationRef;
}) {
  const { editorRef, getCitationDisplayText, addCitation } = deps;

  const handleCitationCreated = useCallback(
    (command: string) => {
      const display = getCitationDisplayText(command);
      const ref = addCitation(command);
      return { id: ref.id, displayText: display };
    },
    [getCitationDisplayText, addCitation],
  );

  const handleCitationDrop = useCallback(
    (command: string, citationId?: string) => {
      const display = getCitationDisplayText(command);
      let targetId: string | undefined;
      if (citationId) {
        const editorCits = editorRef.current?.getCitations() ?? [];
        const alreadyAnchored = editorCits.some((c) => c.citationId === citationId);
        if (!alreadyAnchored) targetId = citationId;
      }
      const ref = addCitation(command, targetId);
      return { id: ref.id, displayText: display };
    },
    [editorRef, getCitationDisplayText, addCitation],
  );

  return { handleCitationCreated, handleCitationDrop };
}
