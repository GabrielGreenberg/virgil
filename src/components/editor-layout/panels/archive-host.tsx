"use client";

import ArchivePanel from "@/panels/Archive";
import type { ArchivedSnippet } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
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
}

export function ArchiveHost(p: ArchiveHostProps) {
  const { editorRef, setOverrideEditor } = useEditorRefContext();
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
      onJumpToCard={(snippet, sourceEl) => editorRef.current?.jumpToCard(snippet, sourceEl)}
      anchoredIds={p.anchoredIds}
      panelSide={p.side}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      onEditorFocus={setOverrideEditor}
    />
  );
}
