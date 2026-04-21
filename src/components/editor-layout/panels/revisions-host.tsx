"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import RevisionsPanel from "@/panels/Revisions";
import type { useRevisions } from "@/hooks/useRevisions";
import type { Side } from "@/hooks/useViewPrefs";
import { createLinkedAnchor, getTextAnchor } from "@/links/links";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";

type RevisionsHook = ReturnType<typeof useRevisions>;
type AnchorKind = "note" | "revision" | "cut" | null;

export interface RevisionsHostProps {
  side: Side;
  panelSide: Side | null;
  revisionUsers: RevisionsHook["users"];
  activeRevisionUserId: RevisionsHook["activeUserId"];
  generalRevisions: RevisionsHook["generalRevisions"];
  textRevisions: RevisionsHook["textRevisions"];
  setActiveRevisionUser: RevisionsHook["setActiveUser"];
  addRevisionUser: RevisionsHook["addUser"];
  addGeneralRevision: RevisionsHook["addGeneralRevision"];
  addRevisionTurn: RevisionsHook["addTurn"];
  resolveRevision: RevisionsHook["resolveRevision"];
  reopenRevision: RevisionsHook["reopenRevision"];
  deleteRevision: RevisionsHook["deleteRevision"];
  pendingCommentText: string | null;
  setPendingCommentText: Dispatch<SetStateAction<string | null>>;
  pendingRevisionAnchorIdRef: MutableRefObject<string | null>;
  handleSubmitComment: (comment: string) => void;
  handleCancelComment: () => void;
  setCommentHighlight: Dispatch<SetStateAction<string | null>>;
  setHoveredAnchorId: Dispatch<SetStateAction<string | null>>;
  setActiveAnchorKind: Dispatch<SetStateAction<AnchorKind>>;
}

export function RevisionsHost(p: RevisionsHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedCommentId, setSelectedCommentId } = useSelectionsContext();
  const { pendingRevisionAnchorIdRef, setPendingCommentText, setHoveredAnchorId, setActiveAnchorKind } = p;
  return (
    <RevisionsPanel
      users={p.revisionUsers}
      activeUserId={p.activeRevisionUserId}
      generalRevisions={p.generalRevisions}
      textRevisions={p.textRevisions}
      onSetActiveUser={p.setActiveRevisionUser}
      onAddUser={p.addRevisionUser}
      onAddGeneral={(text, authorId) => { p.addGeneralRevision(text, authorId); }}
      onAddTurn={p.addRevisionTurn}
      onResolve={p.resolveRevision}
      onReopen={p.reopenRevision}
      onDelete={p.deleteRevision}
      visible={true}
      pendingSelectedText={p.pendingCommentText}
      onSubmitNew={p.handleSubmitComment}
      onCancelNew={p.handleCancelComment}
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
        // the whole paragraph's text range, then open the form with that
        // range as `pendingCommentText` so the user can write their note.
        // Revisions are always thread-rooted in a text span, so this
        // matches the chip-drop flow rather than the Notes shortcut.
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
