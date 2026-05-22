"use client";

import { useCallback, useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import RevisionsPanel from "@/panels/Revisions";
import type {
  RevisionCard,
  RevisionCommentCard,
  RevisionsTracker,
  RevisionSuggestionCard,
} from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCardCreationContext } from "../contexts/card-creation";
import { useAiRequestsContext } from "../contexts/ai-requests";
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
  setSuggestionStatus: (
    id: string,
    status: RevisionSuggestionCard["status"],
  ) => void;
  convertCard: (id: string, toKind: "comment" | "suggestion") => void;
  deleteCard: (id: string) => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

function buildSuggestionPrompt(s: RevisionSuggestionCard): string {
  const anchorBits: string[] = [];
  if (s.selectedText) anchorBits.push(`captured text: "${s.selectedText}"`);
  if (s.links.length > 0) {
    const pids = new Set<string>();
    for (const l of s.links) {
      if (l.anchor.type === "textObject") {
        for (const p of l.anchor.textObjectIds) pids.add(p);
      }
    }
    if (pids.size > 0) anchorBits.push(`paragraphs: ${[...pids].join(", ")}`);
  }
  const anchor = anchorBits.length > 0 ? anchorBits.join("; ") : "(none)";
  return [
    "Apply this revision suggestion in the document:",
    `ORIGINAL: ${s.original_text}`,
    `REPLACEMENT: ${s.user_text || s.suggested_text}`,
    `EXPLANATION: ${s.explanation || "(none)"}`,
    s.instructions ? `INSTRUCTIONS: ${s.instructions}` : null,
    `ANCHOR: ${anchor}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function RevisionsHost(p: RevisionsHostProps) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const { selectedCommentId, setSelectedCommentId } = useSelectionsContext();
  const { createRevisionComment, createRevisionSuggestion } =
    useCardCreationContext();
  const { addAiRequest } = useAiRequestsContext();
  const recentlyAddedId = useRecentlyAddedId("revision");
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);

  const onAddComment = useCallback(
    (rect?: DOMRect): RevisionCommentCard => createRevisionComment({ anchorRect: rect }),
    [createRevisionComment],
  );
  const onAddSuggestion = useCallback(
    (rect?: DOMRect): RevisionSuggestionCard => createRevisionSuggestion({ anchorRect: rect }),
    [createRevisionSuggestion],
  );

  const onAcceptSuggestion = useCallback(
    (id: string) => {
      const s = p.cards.find(
        (c): c is RevisionSuggestionCard => c.id === id && c.kind === "suggestion",
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
    <RevisionsPanel
      cards={p.cards}
      tracker={p.tracker}
      onSetTrackerTarget={p.setTrackerTarget}
      onAddComment={onAddComment}
      onAddSuggestion={onAddSuggestion}
      onUpdateCommentContent={p.updateCommentContent}
      onSetCommentAiRequest={p.setCommentAiRequest}
      onUpdateSuggestionField={p.updateSuggestionField}
      onAcceptSuggestion={onAcceptSuggestion}
      onRejectSuggestion={onRejectSuggestion}
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
