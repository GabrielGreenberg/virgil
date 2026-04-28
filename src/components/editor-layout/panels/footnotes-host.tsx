"use client";

import type { JSONContent } from "@tiptap/react";
import FootnotePanel from "@/panels/Footnotes";
import type { Side } from "@/hooks/useViewPrefs";
import type { OrphanedFootnote } from "@/lib/types";
import type { FootnoteInfo } from "../../Editor";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useCitationDisplayContext } from "../contexts/citation-display";

export interface FootnotesHostProps {
  side: Side;
  footnotes: FootnoteInfo[];
  orphanedFootnotes: OrphanedFootnote[];
  onEdit: (id: string, newContent: JSONContent) => void;
  onEditTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => string;
  onDeleteOrphan: (id: string) => void;
  onEditOrphan: (id: string, newContent: unknown) => void;
  onEditOrphanTitle: (id: string, title: string) => void;
}

export function FootnotesHost(p: FootnotesHostProps) {
  const { editorInstance, editorRef, setOverrideEditor } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedFootnoteId, setSelectedFootnoteId } = useSelectionsContext();
  const { aiRequests, addAiRequest, updateAiRequestText, deleteAiRequest } = useAiRequestsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  return (
    <FootnotePanel
      footnotes={p.footnotes}
      selectedId={selectedFootnoteId}
      onSelect={setSelectedFootnoteId}
      onEdit={p.onEdit}
      onDelete={p.onDelete}
      onScrollToMarker={(id, sourceEl) => editorRef.current?.scrollToFootnote(id, sourceEl)}
      editor={editorInstance}
      panelSide={p.side}
      viewMode={getPanelViewMode("footnotes")}
      onViewModeChange={(m) => setPanelViewMode("footnotes", m)}
      orphanedFootnotes={p.orphanedFootnotes}
      onDeleteOrphan={p.onDeleteOrphan}
      onEditOrphan={p.onEditOrphan}
      onEditOrphanTitle={p.onEditOrphanTitle}
      onAdd={p.onAdd}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      aiRequests={aiRequests}
      onAddAiRequest={() => addAiRequest("footnote")}
      onUpdateAiRequestText={updateAiRequestText}
      onDeleteAiRequest={deleteAiRequest}
      onEditTitle={p.onEditTitle}
      onEditorFocus={setOverrideEditor}
    />
  );
}
