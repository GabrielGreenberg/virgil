"use client";

import type { Dispatch, SetStateAction } from "react";
import SearchPanel, { type SearchPanelState } from "@/panels/Search";
import type { PanelId } from "@/hooks/useViewPrefs";
import type { useNotes } from "@/hooks/useNotes";
import type { useCutter } from "@/hooks/useCutter";
import type { useQuotations } from "@/hooks/useQuotations";
import type { useCitations } from "@/hooks/useCitations";
import type { useTodos } from "@/hooks/useTodos";
import type { useRevisions } from "@/hooks/useRevisions";
import type { ArchivedSnippet, OrphanedFootnote } from "@/lib/types";
import type { FootnoteInfo } from "../../Editor";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useCitationDisplayContext } from "../contexts/citation-display";

type NotesHook = ReturnType<typeof useNotes>;
type CutterHook = ReturnType<typeof useCutter>;
type QuotationsHook = ReturnType<typeof useQuotations>;
type CitationsHook = ReturnType<typeof useCitations>;
type TodosHook = ReturnType<typeof useTodos>;
type RevisionsHook = ReturnType<typeof useRevisions>;

export interface SearchHostProps {
  footnotes: FootnoteInfo[];
  orphanedFootnotes: OrphanedFootnote[];
  notes: NotesHook["notes"];
  citations: CitationsHook["citations"];
  allEditorCitations: Array<{ citationId: string; command: string; keys: string[]; pos: number }>;
  todoItems: TodosHook["items"];
  archiveSnippets: ArchivedSnippet[];
  cutterCards: CutterHook["cards"];
  quotationGroups: QuotationsHook["groups"];
  comments: RevisionsHook["cards"];
  bibEntries: CitationsHook["bibEntries"];
  openItemInPanel: (panel: PanelId, itemId: string) => void;
  searchState: SearchPanelState;
  setSearchState: Dispatch<SetStateAction<SearchPanelState>>;
  setSearchHighlightRange: Dispatch<SetStateAction<{ from: number; to: number } | null>>;
}

export function SearchHost(p: SearchHostProps) {
  const { editorInstance } = useEditorRefContext();
  const { getCitationDisplayText } = useCitationDisplayContext();
  return (
    <SearchPanel
      editor={editorInstance}
      onHighlightRange={p.setSearchHighlightRange}
      footnotes={p.footnotes}
      orphanedFootnotes={p.orphanedFootnotes}
      notes={p.notes}
      citations={p.citations}
      editorCitations={p.allEditorCitations}
      getCitationDisplayText={getCitationDisplayText}
      todos={p.todoItems}
      archiveSnippets={p.archiveSnippets}
      cutterCards={p.cutterCards}
      quotationGroups={p.quotationGroups}
      comments={p.comments}
      bibEntries={p.bibEntries}
      onOpenItem={p.openItemInPanel}
      state={p.searchState}
      onStateChange={p.setSearchState}
    />
  );
}
