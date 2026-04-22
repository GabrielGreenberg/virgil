"use client";

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import RevisionsPanel from "@/panels/Revisions";
import type { useRevisions } from "@/hooks/useRevisions";
import type { Side } from "@/hooks/useViewPrefs";
import { createLinkedAnchor, getTextAnchor, updateLinkedAnchorCard } from "@/links/links";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";

type RevisionsHook = ReturnType<typeof useRevisions>;
type AnchorKind = "note" | "revision" | "cut" | null;

export interface RevisionsHostProps {
  side: Side;
  panelSide: Side | null;
  generalRevisions: RevisionsHook["generalRevisions"];
  textRevisions: RevisionsHook["textRevisions"];
  addGeneralRevision: RevisionsHook["addGeneralRevision"];
  addTextRevision: RevisionsHook["addTextRevision"];
  updateRevisionContent: RevisionsHook["updateRevisionContent"];
  setRevisionAuthor: RevisionsHook["setRevisionAuthor"];
  deleteRevision: RevisionsHook["deleteRevision"];
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
    addTextRevision,
  } = p;

  // When the editor flow signals a pending text selection (via
  // handleAddComment or a drop), create an empty text revision immediately
  // and select it — the user edits in place with auto-save, so there's no
  // form step anymore. The ref guards against StrictMode double-fire.
  const consumedPendingTextRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingCommentText) return;
    if (consumedPendingTextRef.current === pendingCommentText) return;
    consumedPendingTextRef.current = pendingCommentText;
    const anchorId = pendingRevisionAnchorIdRef.current;
    const rev = addTextRevision(pendingCommentText, anchorId, "");
    if (rev && anchorId) {
      const ed = editorRef.current?.getEditor();
      if (ed) updateLinkedAnchorCard(ed, anchorId, "comment", rev.id);
    }
    if (rev) setSelectedCommentId(rev.id);
    pendingRevisionAnchorIdRef.current = null;
    setPendingCommentText(null);
  }, [
    pendingCommentText,
    addTextRevision,
    editorRef,
    pendingRevisionAnchorIdRef,
    setPendingCommentText,
    setSelectedCommentId,
  ]);

  return (
    <RevisionsPanel
      generalRevisions={p.generalRevisions}
      textRevisions={p.textRevisions}
      onAddEmptyGeneral={() => p.addGeneralRevision("")}
      onUpdateContent={p.updateRevisionContent}
      onSetAuthor={p.setRevisionAuthor}
      onDelete={p.deleteRevision}
      visible={true}
      selectedRevisionId={selectedCommentId}
      onSelectRevision={setSelectedCommentId}
      onHighlight={p.setCommentHighlight}
      onHoverRevision={(id) => {
        if (!id) { setHoveredAnchorId(null); return; }
        const r = p.textRevisions.find((x) => x.id === id);
        const anchorId = r ? getTextAnchor(r)?.anchorId : undefined;
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
        // Dragging a paragraph into Revisions: anchor a new revision over
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
