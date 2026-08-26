"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import SearchPanel, { type SearchPanelState } from "@/panels/Search";
import { scopesForVisiblePanels } from "@/lib/search-sources";
import type { PanelId } from "@/hooks/useViewPrefs";
import type { useNotes } from "@/hooks/useNotes";
import type { useCutter } from "@/hooks/useCutter";
import type { useCitations } from "@/hooks/useCitations";
import type { useTodos } from "@/hooks/useTodos";
import type { useRevisions } from "@/hooks/useRevisions";
import type { ArchivedSnippet, OrphanedFootnote, ReportItem } from "@/lib/types";
import type { FootnoteInfo } from "../../Editor";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useEditorChrome } from "../chrome-context";

type NotesHook = ReturnType<typeof useNotes>;
type CutterHook = ReturnType<typeof useCutter>;
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
  reportCards: ReportItem[];
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
  // Task 485 — the HOST resolves "which scopes may this surface offer?" and
  // the panel renders what it is given. Every scope but `mainText` jumps into
  // a PANEL, so the answer is DERIVED from the same whitelist the strip
  // renders from: a host that hides `todo` must not offer a todo hit whose
  // click docks a band its rail elides. `undefined` (FULL_CHROME) → all
  // scopes, so the main editor is untouched.
  const chrome = useEditorChrome();
  const availableScopes = useMemo(
    () => scopesForVisiblePanels(chrome.visiblePanelKinds),
    [chrome.visiblePanelKinds],
  );
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
      reportCards={p.reportCards}
      comments={p.comments}
      bibEntries={p.bibEntries}
      onOpenItem={p.openItemInPanel}
      availableScopes={availableScopes}
      state={p.searchState}
      onStateChange={p.setSearchState}
    />
  );
}
