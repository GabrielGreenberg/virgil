"use client";

import { useCallback, useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import RevisionsPanel from "@/panels/Revisions";
import type {
  RevisionCard,
  RevisionRequestCard,
  RevisionsTracker,
  RevisionSuggestionCard,
} from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";

export interface RevisionsHostProps {
  side: Side;
  panelSide: Side | null;
  cards: RevisionCard[];
  tracker: RevisionsTracker | null;
  setTrackerTarget: (target: number | null) => void;
  updateCommentContent: (id: string, content: JSONContent) => void;
  setCommentAiRequest: (id: string, value: boolean) => void;
  updateSuggestionField: (
    id: string,
    field:
      | "original_text"
      | "suggested_text"
      | "explanation"
      | "user_text"
      | "instructions",
    value: string,
  ) => void;
  convertCard: (id: string, toKind: "comment" | "suggestion") => void;
  deleteCard: (id: string) => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

export function RevisionsHost(p: RevisionsHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { selectedCommentId, setSelectedCommentId } = useSelectionsContext();
  const { createRevisionRequest, createRevisionSuggestion } =
    useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("revision");
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);

  const onAddRequest = useCallback(
    (): RevisionRequestCard => createRevisionRequest({}),
    [createRevisionRequest],
  );
  const onAddSuggestion = useCallback(
    (): RevisionSuggestionCard => createRevisionSuggestion({}),
    [createRevisionSuggestion],
  );

  // Apply / Accept / Reject / Keep / Revert are NOT wired here any more
  // (task 684). Every verb a suggestion card aims at the document or at its own
  // status now resolves from the `PendingChangeController` context EditorPane
  // provides, so this host and the two surfaces that never wired them — omni and
  // float — are the same card. Their implementations moved to EditorPane beside
  // keep/dismiss/preview/insertBelow; nothing was reimplemented.

  return (
    <RevisionsPanel
      cards={p.cards}
      tracker={p.tracker}
      onSetTrackerTarget={p.setTrackerTarget}
      onAddRequest={onAddRequest}
      onAddSuggestion={onAddSuggestion}
      onUpdateCommentContent={p.updateCommentContent}
      onSetCommentAiRequest={p.setCommentAiRequest}
      onUpdateSuggestionField={p.updateSuggestionField}
      onConvertCard={p.convertCard}
      onDelete={p.deleteCard}
      onSelect={setSelectedCommentId}
      selectedId={selectedCommentId}
      onJumpToCard={(card, sourceEl) => editorRef.current?.jumpToCard(card, sourceEl)}
      editor={editorInstance}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
