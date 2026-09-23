"use client";

import { useCallback, useEffect, useRef } from "react";
import type { CardMorphHandler } from "@/cards/types";
import CutterPanel from "@/panels/Cutter";
import type {
  CutterCard,
  CutterCommentCard,
  CutterGoal,
  CutterSuggestionCard,
} from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useDockedJumpGate } from "../contexts/card-anchor";
import { useSelectionsContext } from "../contexts/selections";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";

export interface CutterHostProps {
  side: Side;
  panelSide: Side | null;
  cards: CutterCard[];
  goal: CutterGoal | null;
  setGoal: (target: number, currentWords: number) => void;
  clearGoal: () => void;
  updateCommentContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
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
  /** Morph comment ⇄ suggestion via the kind-chevron — routes through the
   *  EditorPane morph chokepoint (float-key remap). */
  convertCard: CardMorphHandler;
  deleteCard: (id: string) => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

export function CutterHost(p: CutterHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const jumpGate = useDockedJumpGate();
  const { selectedCutterCardId, setSelectedCutterCardId } =
    useSelectionsContext();
  const { createCutterComment, createCutterSuggestion } =
    useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("cutter");
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);

  const onAddComment = useCallback(
    (): CutterCommentCard => createCutterComment({}),
    [createCutterComment],
  );
  const onAddSuggestion = useCallback(
    (): CutterSuggestionCard => createCutterSuggestion({}),
    [createCutterSuggestion],
  );

  // Apply / Accept / Reject / Keep / Revert are NOT wired here any more
  // (task 684). Every verb a suggestion card aims at the document or at its own
  // status now resolves from the `PendingChangeController` context EditorPane
  // provides, so this host and the two surfaces that never wired them — omni and
  // float — are the same card. Their implementations moved to EditorPane beside
  // keep/dismiss/preview/insertBelow; nothing was reimplemented.

  return (
    <CutterPanel
      cards={p.cards}
      goal={p.goal}
      onSetGoal={p.setGoal}
      onClearGoal={p.clearGoal}
      onAddComment={onAddComment}
      onAddSuggestion={onAddSuggestion}
      onUpdateCommentContent={p.updateCommentContent}
      onSetCommentAiRequest={p.setCommentAiRequest}
      onUpdateSuggestionField={p.updateSuggestionField}
      onConvertCard={p.convertCard}
      onDelete={p.deleteCard}
      onSelect={setSelectedCutterCardId}
      selectedId={selectedCutterCardId}
      jumpGate={jumpGate}
      onJumpToCard={(card, sourceEl) => editorRef.current?.jumpToCard(card, sourceEl)}
      editor={editorInstance}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
