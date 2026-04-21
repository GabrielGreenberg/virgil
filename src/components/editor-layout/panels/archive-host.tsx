"use client";

import ArchivePanel from "@/panels/Archive";
import type { ArchivedSnippet } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { getLinkedParagraphIds } from "@/links/links";
import { useEditorRefContext } from "../contexts/editor-ref";
import { usePanelViewModeContext } from "../contexts/panel-view-mode";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";

export interface ArchiveHostProps {
  side: Side;
  sortedArchiveSnippets: ArchivedSnippet[];
  archiveSnippets: ArchivedSnippet[];
  updateArchiveSnippet: (id: string, content: unknown) => void;
  updateArchiveSnippetTitle: (id: string, title: string) => void;
  onInsert: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  anchoredIds: Set<string>;
  onCapture: (payload: { content: unknown; paragraphId: string | null }) => void;
}

export function ArchiveHost(p: ArchiveHostProps) {
  const { editorInstance, editorRef, setOverrideEditor } = useEditorRefContext();
  const { getPanelViewMode, setPanelViewMode } = usePanelViewModeContext();
  const { selectedArchiveId, setSelectedArchiveId } = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  return (
    <ArchivePanel
      snippets={p.sortedArchiveSnippets}
      selectedId={selectedArchiveId}
      onSelect={setSelectedArchiveId}
      onEdit={(id, content) => p.updateArchiveSnippet(id, content)}
      onUpdateTitle={p.updateArchiveSnippetTitle}
      onInsert={p.onInsert}
      onRestore={p.onRestore}
      onDelete={p.onDelete}
      onScrollToMarker={(id) => {
        const snippet = p.archiveSnippets.find((s) => s.id === id);
        const pid = snippet ? getLinkedParagraphIds(snippet)[0] : undefined;
        if (pid) editorRef.current?.scrollToParagraphId(pid);
      }}
      anchoredIds={p.anchoredIds}
      editor={editorInstance}
      panelSide={p.side}
      viewMode={getPanelViewMode("archive")}
      onViewModeChange={(m) => setPanelViewMode("archive", m)}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      onEditorFocus={setOverrideEditor}
      onCapture={p.onCapture}
    />
  );
}
