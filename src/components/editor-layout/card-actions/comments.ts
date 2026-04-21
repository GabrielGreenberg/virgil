import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { EditorHandle } from "../../Editor";
import { createLinkedAnchor, removeLinkedAnchor, updateLinkedAnchorCard } from "@/links/links";

/**
 * Revision-comment dialog handlers (the in-text "add a comment" flow).
 *
 * - `handleAddComment` captures the current editor selection, creates a
 *   linked-anchor mark for the pending revision, and opens the revisions
 *   panel on whichever side owns it. Stashes the anchorId in
 *   `pendingRevisionAnchorIdRef` so the submit/cancel handlers can
 *   commit or tear it down.
 * - `handleSubmitComment` commits the pending text + anchor into a
 *   text revision; points the anchor mark at the new revision card.
 * - `handleCancelComment` removes the stashed anchor so we don't leave
 *   an orphan mark when the user dismisses the dialog.
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
  pendingCommentText: string | null;
  setPendingCommentText: Dispatch<SetStateAction<string | null>>;
  addTextRevision: (selectedText: string, anchorId: string | null, comment: string, authorIdOverride?: string) => { id: string } | null | undefined;
}) {
  const {
    editorRef,
    pendingRevisionAnchorIdRef,
    prefs,
    setActiveLeft,
    setActiveRight,
    pendingCommentText,
    setPendingCommentText,
    addTextRevision,
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

  const handleSubmitComment = useCallback(
    (comment: string, authorIdOverride?: string) => {
      if (pendingCommentText && comment.trim()) {
        const anchorId = pendingRevisionAnchorIdRef.current;
        const rev = addTextRevision(pendingCommentText, anchorId, comment.trim(), authorIdOverride);
        if (rev && anchorId) {
          const ed = editorRef.current?.getEditor();
          if (ed) updateLinkedAnchorCard(ed, anchorId, "comment", rev.id);
        }
      }
      pendingRevisionAnchorIdRef.current = null;
      setPendingCommentText(null);
    },
    [addTextRevision, editorRef, pendingCommentText, pendingRevisionAnchorIdRef, setPendingCommentText],
  );

  const handleCancelComment = useCallback(() => {
    const ed = editorRef.current?.getEditor();
    const id = pendingRevisionAnchorIdRef.current;
    if (ed && id) removeLinkedAnchor(ed, id);
    pendingRevisionAnchorIdRef.current = null;
    setPendingCommentText(null);
  }, [editorRef, pendingRevisionAnchorIdRef, setPendingCommentText]);

  return { handleAddComment, handleSubmitComment, handleCancelComment };
}
