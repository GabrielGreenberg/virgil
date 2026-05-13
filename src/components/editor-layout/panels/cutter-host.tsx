"use client";

import { useCallback, useEffect, useRef } from "react";
import CutterPanel from "@/panels/Cutter";
import type {
  CutterCard,
  CutterCommentCard,
  CutterGoal,
  CutterSuggestionCard,
} from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCardCreationContext } from "../contexts/card-creation";
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useRecentlyAddedId } from "../contexts/recently-added";

export interface CutterHostProps {
  side: Side;
  panelSide: Side | null;
  cards: CutterCard[];
  goal: CutterGoal | null;
  setGoal: (target: number, initialWords: number) => void;
  clearGoal: () => void;
  updateCommentText: (id: string, text: string) => void;
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
  setSuggestionStatus: (
    id: string,
    status: CutterSuggestionCard["status"],
  ) => void;
  deleteCard: (id: string) => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
  onDropSelection: (payload: {
    from: number;
    to: number;
    selectedText: string;
  }) => void;
  onDropParagraph: (paragraphId: string) => void;
}

function buildSuggestionPrompt(s: CutterSuggestionCard): string {
  const anchorBits: string[] = [];
  if (s.selectedText) anchorBits.push(`captured text: "${s.selectedText}"`);
  if (s.links.length > 0) {
    const pids = new Set<string>();
    for (const l of s.links) {
      if (l.anchor.type === "anchor") {
        for (const p of l.anchor.paragraphIds) pids.add(p);
      }
    }
    if (pids.size > 0) anchorBits.push(`paragraphs: ${[...pids].join(", ")}`);
  }
  const anchor = anchorBits.length > 0 ? anchorBits.join("; ") : "(none)";
  return [
    "Apply this suggestion in the document:",
    `ORIGINAL: ${s.original_text}`,
    `REPLACEMENT: ${s.suggested_text}`,
    `EXPLANATION: ${s.explanation || "(none)"}`,
    `ANCHOR: ${anchor}`,
  ].join("\n");
}

export function CutterHost(p: CutterHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { selectedCutterCardId, setSelectedCutterCardId } =
    useSelectionsContext();
  const { createCutterComment, createCutterSuggestion } =
    useCardCreationContext();
  const { addAiRequest } = useAiRequestsContext();
  const recentlyAddedId = useRecentlyAddedId("cutter");
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);

  const onAddComment = useCallback(
    (rect?: DOMRect): CutterCommentCard => createCutterComment({ anchorRect: rect }),
    [createCutterComment],
  );
  const onAddSuggestion = useCallback(
    (rect?: DOMRect): CutterSuggestionCard => createCutterSuggestion({ anchorRect: rect }),
    [createCutterSuggestion],
  );

  const onAcceptSuggestion = useCallback(
    (id: string) => {
      const s = p.cards.find(
        (c): c is CutterSuggestionCard => c.id === id && c.kind === "suggestion",
      );
      if (!s) return;
      p.setSuggestionStatus(id, "accepted");
      addAiRequest("suggestion", buildSuggestionPrompt(s));
    },
    [p, addAiRequest],
  );

  const onRejectSuggestion = useCallback(
    (id: string) => {
      p.setSuggestionStatus(id, "rejected");
    },
    [p],
  );

  return (
    <CutterPanel
      cards={p.cards}
      goal={p.goal}
      onSetGoal={p.setGoal}
      onClearGoal={p.clearGoal}
      onAddComment={onAddComment}
      onAddSuggestion={onAddSuggestion}
      onUpdateCommentText={p.updateCommentText}
      onSetCommentAiRequest={p.setCommentAiRequest}
      onUpdateSuggestionField={p.updateSuggestionField}
      onAcceptSuggestion={onAcceptSuggestion}
      onRejectSuggestion={onRejectSuggestion}
      onDelete={p.deleteCard}
      onSelect={setSelectedCutterCardId}
      selectedId={selectedCutterCardId}
      onJumpToCard={(card, sourceEl) => editorRef.current?.jumpToCard(card, sourceEl)}
      onDropSelection={p.onDropSelection}
      onDropParagraph={p.onDropParagraph}
      editor={editorInstance}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
