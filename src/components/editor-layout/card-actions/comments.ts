import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { EditorHandle } from "../../Editor";
import { createLinkedAnchor } from "@/links/links";

/**
 * Revision-comment dialog handler (the in-text "add a comment" flow).
 *
 * `handleAddComment` captures the current editor selection, creates a
 * linked-anchor mark for the pending revision, opens the revisions
 * panel on whichever side owns it, and stashes the selection text in
 * `pendingCommentText`. The RevisionsHost picks that up and creates an
 * empty text revision anchored to the selection — the user edits it
 * in place with auto-save, so there's no explicit submit/cancel step.
 *
 * The anchor ref is shared with the RevisionsPanel drop handlers
 * (which also set pending anchors), so it's owned by the shell and
 * threaded in here.
 */
export function useCommentActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  pendingRevisionAnchorIdRef: MutableRefObject<string | null>;
  prefs: ViewPrefs;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setPendingCommentText: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    editorRef,
    pendingRevisionAnchorIdRef,
    prefs,
    setActiveLeft,
    setActiveRight,
    setPendingCommentText,
  } = deps;

  const handleAddComment = useCallback(() => {
    const selectedText = editorRef.current?.getSelectedText();
    if (!selectedText || selectedText.trim().length === 0) return;
    const ed = editorRef.current?.getEditor();
    if (ed) {
      const record = createLinkedAnchor(ed, "revision");
      pendingRevisionAnchorIdRef.current = record?.anchorId ?? null;
    } else {
      pendingRevisionAnchorIdRef.current = null;
    }
    setPendingCommentText(selectedText);
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    const revPlacement = prefs.placements.find((p) => p.id === "revisions");
    if (revPlacement?.side === "left") {
      if (prefs.activeLeft !== "revisions") setActiveLeft("revisions");
    } else {
      if (prefs.activeRight !== "revisions") setActiveRight("revisions");
    }
  }, [editorRef, pendingRevisionAnchorIdRef, setPendingCommentText, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  return { handleAddComment };
}
