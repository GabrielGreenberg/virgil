import { useCallback, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import { isPanelDocked } from "@/hooks/view-prefs-derived";
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
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    // Content-aware emptiness: an atom-only selection (a citation pill /
    // `$\lambda$` / `\ref` selected alone) has NO textContent but real content,
    // so the old `!selectedText` bail silently no-op'd it (panel never opened).
    // Bail only on a collapsed / genuinely-empty selection — atoms count.
    const { from, to } = ed.state.selection;
    if (to <= from || ed.state.doc.slice(from, to).content.size === 0) return;
    const selectedText = ed.state.doc.textBetween(from, to, " ");
    const record = createLinkedAnchor(ed, "revision");
    pendingRevisionAnchorIdRef.current = record?.anchorId ?? null;
    setPendingCommentText(selectedText);
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    // Idempotence guard: skip the opener when revisions is already docked on its
    // side (avoids a spurious openPanel + dock-MRU churn).
    if (isPanelDocked(prefs, "revisions")) return;
    const revPlacement = prefs.placements.find((p) => p.id === "revisions");
    if (revPlacement?.side === "left") setActiveLeft("revisions");
    else setActiveRight("revisions");
  }, [editorRef, pendingRevisionAnchorIdRef, setPendingCommentText, prefs, setActiveLeft, setActiveRight]);

  return { handleAddComment };
}
