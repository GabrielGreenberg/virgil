"use client";

import { useMemo } from "react";
import ArchivePanel from "@/panels/Archive";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import type { ArchivedSnippet } from "@/lib/types";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useDockedJumpGate } from "../contexts/card-anchor";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useRecentlyAddedId } from "../contexts/recently-added";

export interface ArchiveHostProps {
  sortedArchiveSnippets: ArchivedSnippet[];
  updateArchiveSnippet: (id: string, content: unknown) => void;
  updateArchiveSnippetTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ArchiveHost(p: ArchiveHostProps) {
  const { editorRef, setOverrideEditor } = useEditorRefContext();
  const jumpGate = useDockedJumpGate();
  const { selectedArchiveId, setSelectedArchiveId } = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  // A freshly archived snippet floats to the top, like every sibling panel's
  // new card, until selection moves off it (task 975 — the pin was written
  // but had no reader).
  const recentlyAddedId = useRecentlyAddedId("archive");
  const snippets = useMemo(
    () => withRecentlyAddedFirst(p.sortedArchiveSnippets, recentlyAddedId, (s) => s.id),
    [p.sortedArchiveSnippets, recentlyAddedId],
  );
  return (
    <ArchivePanel
      snippets={snippets}
      selectedId={selectedArchiveId}
      onSelect={setSelectedArchiveId}
      onEdit={(id, content) => p.updateArchiveSnippet(id, content)}
      onUpdateTitle={p.updateArchiveSnippetTitle}
      onDelete={p.onDelete}
      jumpGate={jumpGate}
      onJumpToCard={(snippet, sourceEl) => editorRef.current?.jumpToCard(snippet, sourceEl)}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      onEditorFocus={setOverrideEditor}
    />
  );
}
