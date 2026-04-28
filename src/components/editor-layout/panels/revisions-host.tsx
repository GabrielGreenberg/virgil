"use client";

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import RevisionsPanel from "@/panels/Revisions";
import type { useRevisions } from "@/hooks/useRevisions";
import type { Side } from "@/hooks/useViewPrefs";
import type { Suggestion } from "@/lib/types";
import { createLinkedAnchor, getTextAnchor, updateLinkedAnchorCard } from "@/links/links";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";

type RevisionsHook = ReturnType<typeof useRevisions>;
type AnchorKind = "note" | "revision" | "cutter-comment" | "cutter-suggestion" | null;

export interface RevisionsHostProps {
  side: Side;
  panelSide: Side | null;
  comments: RevisionsHook["comments"];
  addComment: RevisionsHook["addComment"];
  updateCommentContent: RevisionsHook["updateCommentContent"];
  setCommentAuthor: RevisionsHook["setCommentAuthor"];
  deleteComment: RevisionsHook["deleteComment"];
  // Suggestions live alongside comments in the merged panel — passed
  // through from EditorLayout's useSuggestions.
  suggestions: Suggestion[];
  currentSuggestionIndex: number;
  actOnSuggestion: (id: string, action: "accepted" | "rejected" | "skipped") => void;
  updateSuggestionField: (id: string, field: "revision" | "note", value: string) => void;
  jumpToSuggestion: (index: number) => void;
  pendingCommentText: string | null;
  setPendingCommentText: Dispatch<SetStateAction<string | null>>;
  pendingRevisionAnchorIdRef: MutableRefObject<string | null>;
  setCommentHighlight: Dispatch<SetStateAction<string | null>>;
  setHoveredAnchorId: Dispatch<SetStateAction<string | null>>;
  setActiveAnchorKind: Dispatch<SetStateAction<AnchorKind>>;
}

export function RevisionsHost(p: RevisionsHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedCommentId, setSelectedCommentId } = useSelectionsContext();
  const {
    pendingRevisionAnchorIdRef,
    setPendingCommentText,
    setHoveredAnchorId,
    setActiveAnchorKind,
    pendingCommentText,
    addComment,
  } = p;

  // When the editor flow signals a pending text selection (via
  // handleAddComment or a drop), create an empty anchored comment
  // immediately and select it — the user edits in place with auto-save,
  // so there's no form step. The ref guards against StrictMode double-fire.
  const consumedPendingTextRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingCommentText) return;
    if (consumedPendingTextRef.current === pendingCommentText) return;
    consumedPendingTextRef.current = pendingCommentText;
    const anchorId = pendingRevisionAnchorIdRef.current;
    const created = addComment({
      selectedText: pendingCommentText,
      anchorId,
      text: "",
    });
    if (anchorId) {
      const ed = editorRef.current?.getEditor();
      if (ed) updateLinkedAnchorCard(ed, anchorId, "comment", created.id);
    }
    setSelectedCommentId(created.id);
    pendingRevisionAnchorIdRef.current = null;
    setPendingCommentText(null);
  }, [
    pendingCommentText,
    addComment,
    editorRef,
    pendingRevisionAnchorIdRef,
    setPendingCommentText,
    setSelectedCommentId,
  ]);

  // Auto-advance: when the active suggestion index changes (after an
  // accept/reject/skip), select the matching suggestion card so its
  // expanded review UI is visible and keyboard shortcuts apply.
  useEffect(() => {
    if (p.suggestions.length === 0) return;
    const i = p.currentSuggestionIndex;
    if (i < 0 || i >= p.suggestions.length) return;
    const suggestionListId = `suggestion:${p.suggestions[i].id}`;
    if (selectedCommentId !== suggestionListId) {
      setSelectedCommentId(suggestionListId);
    }
    // Only react to index changes — selection clears (e.g. user clicks a
    // comment) shouldn't pull focus back to the suggestion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currentSuggestionIndex, p.suggestions.length]);

  return (
    <RevisionsPanel
      comments={p.comments}
      suggestions={p.suggestions}
      currentSuggestionIndex={p.currentSuggestionIndex}
      onAddEmptyComment={() => p.addComment({})}
      onUpdateContent={p.updateCommentContent}
      onSetAuthor={p.setCommentAuthor}
      onDelete={p.deleteComment}
      onActOnSuggestion={p.actOnSuggestion}
      onUpdateSuggestionField={p.updateSuggestionField}
      onJumpSuggestion={p.jumpToSuggestion}
      visible={true}
      selectedCommentId={selectedCommentId}
      onSelectComment={setSelectedCommentId}
      onHighlight={p.setCommentHighlight}
      onHoverComment={(id) => {
        if (!id) { setHoveredAnchorId(null); return; }
        const c = p.comments.find((x) => x.id === id);
        const anchorId = c ? getTextAnchor(c)?.anchorId : undefined;
        if (anchorId) {
          setHoveredAnchorId(anchorId);
          setActiveAnchorKind("revision");
        }
      }}
      onDropSelection={(payload) => {
        const ed = editorRef.current?.getEditor();
        if (!ed || !editorRef.current) return;
        const record = createLinkedAnchor(ed, "revision", { from: payload.from, to: payload.to });
        if (!record) return;
        pendingRevisionAnchorIdRef.current = record.anchorId;
        setPendingCommentText(payload.selectedText || record.text);
      }}
      onDropParagraph={(paragraphId) => {
        // Dragging a paragraph into Revisions: anchor a new comment over
        // the whole paragraph's text range, then let the auto-create
        // effect spin up an empty editable card anchored to that range.
        const ed = editorRef.current?.getEditor();
        if (!ed) return;
        let from: number | null = null;
        let to: number | null = null;
        ed.state.doc.descendants((node, pos) => {
          if (from !== null) return false;
          if (node.attrs?.uuid === paragraphId) {
            from = pos + 1;
            to = pos + node.nodeSize - 1;
            return false;
          }
          return true;
        });
        if (from === null || to === null || from >= to) return;
        const record = createLinkedAnchor(ed, "revision", { from, to });
        if (!record) return;
        pendingRevisionAnchorIdRef.current = record.anchorId;
        setPendingCommentText(record.text);
      }}
      editor={editorInstance}
      panelSide={p.panelSide ?? p.side}
      viewMode={getPanelViewMode("revisions")}
      onViewModeChange={(m) => setPanelViewMode("revisions", m)}
    />
  );
}
