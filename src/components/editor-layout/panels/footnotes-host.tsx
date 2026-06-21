"use client";

import type { JSONContent } from "@tiptap/react";
import FootnotePanel from "@/panels/Footnotes";
import type { Side } from "@/hooks/useViewPrefs";
import type { OrphanedFootnote } from "@/lib/types";
import type { FootnoteInfo } from "../../Editor";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useRecentlyAddedId } from "../contexts/recently-added";

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
  /** BUG #55: per-footnote AI-request flags + toggle (from the footnotes.json
   *  sidecar via EditorPane). */
  footnoteAiRequests?: Record<string, boolean>;
  onSetFootnoteAiRequest?: (id: string, value: boolean) => void;
}

export function FootnotesHost(p: FootnotesHostProps) {
  const { editorRef, setOverrideEditor } = useEditorRefContext();
  const { selectedFootnoteId, setSelectedFootnoteId } = useSelectionsContext();
  const { aiRequests, updateAiRequestText, deleteAiRequest } = useAiRequestsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  const recentlyAddedId = useRecentlyAddedId("footnote");
  return (
    <FootnotePanel
      footnotes={p.footnotes}
      selectedId={selectedFootnoteId}
      onSelect={setSelectedFootnoteId}
      onEdit={p.onEdit}
      onDelete={p.onDelete}
      onScrollToMarker={(id, sourceEl) => editorRef.current?.scrollToFootnote(id, sourceEl)}
      orphanedFootnotes={p.orphanedFootnotes}
      onDeleteOrphan={p.onDeleteOrphan}
      onEditOrphan={p.onEditOrphan}
      onEditOrphanTitle={p.onEditOrphanTitle}
      onAdd={p.onAdd}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      aiRequests={aiRequests}
      onUpdateAiRequestText={updateAiRequestText}
      onDeleteAiRequest={deleteAiRequest}
      onEditTitle={p.onEditTitle}
      onEditorFocus={setOverrideEditor}
      recentlyAddedId={recentlyAddedId}
      footnoteAiRequests={p.footnoteAiRequests}
      onSetFootnoteAiRequest={p.onSetFootnoteAiRequest}
    />
  );
}
