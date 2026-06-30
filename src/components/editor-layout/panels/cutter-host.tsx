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
import { isPendingChangesOn } from "@/lib/pending-changes-flag";
import { applyPendingChange } from "@/links/apply-suggestion";
import {
  keepSuggestion,
  revertSuggestion,
} from "@/links/pending-change-actions";
import { getLinkedTextObjectIds } from "@/links/links";
import { generateEntityId } from "@/lib/uuid";
import { useDocWriteHandleOrNull } from "../DocPipeline";

export interface CutterHostProps {
  side: Side;
  panelSide: Side | null;
  cards: CutterCard[];
  goal: CutterGoal | null;
  setGoal: (target: number, initialWords: number) => void;
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
  setSuggestionStatus: (
    id: string,
    status: CutterSuggestionCard["status"],
  ) => void;
  /** Flag-ON only: set/clear the in-doc splice descriptor on a suggestion card
   *  (Apply sets it, Keep clears it). Threaded from `useCutter`. */
  setAppliedChange: (
    id: string,
    appliedChange: CutterSuggestionCard["appliedChange"] | undefined,
  ) => void;
  /** Flag-ON only: archive the surviving original-record card on Keep. */
  setArchived: (id: string, archived: boolean) => void;
  /** Morph comment ⇄ suggestion via the kind-chevron — routes through the
   *  EditorPane morph chokepoint (float-key remap). */
  convertCard: (id: string, toKind: "comment" | "suggestion") => void;
  deleteCard: (id: string) => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

function buildSuggestionPrompt(s: CutterSuggestionCard): string {
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
  const docHandle = useDocWriteHandleOrNull();
  const docId = docHandle?.docId ?? null;
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

  // ── Pending-changes (flag-ON) — client-side Apply / Keep / Revert ──
  // Mirror of revisions-host. Each no-ops gracefully when the flag is OFF, the
  // editor isn't mounted, or the card has no resolvable Mode-A anchor. The OFF
  // path stays on onAcceptSuggestion/onRejectSuggestion above (round-trip).

  const onApplySuggestion = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editorInstance) return;
      const s = p.cards.find(
        (c): c is CutterSuggestionCard => c.id === id && c.kind === "suggestion",
      );
      if (!s) return;
      const anchorUuid = getLinkedTextObjectIds(s)[0];
      if (!anchorUuid) return;
      const mode: "replace" | "delete" =
        s.suggested_text === "" ? "delete" : "replace";
      const anchorId = generateEntityId();
      const result = applyPendingChange(editorInstance, {
        anchorUuid,
        originalText: s.original_text,
        replacement: s.suggested_text,
        mode,
        cardId: id,
        anchorId,
      });
      if (result.ok) {
        p.setSuggestionStatus(id, "applied");
        p.setAppliedChange(id, {
          anchorId: result.anchorId,
          anchorUuid,
          originalText: s.original_text,
          replacement: s.suggested_text,
          mode,
          appliedAt: new Date().toISOString(),
        });
      } else {
        p.setSuggestionStatus(id, "stale");
      }
    },
    [p, editorInstance],
  );

  // Keep / Revert route through the shared `pending-change-actions` sequence
  // (the same one the EditorPane margin-gutter marker calls — Phase 1c), so the
  // card surface and the gutter stay byte-identical.
  const onKeepSuggestion = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editorInstance) return;
      keepSuggestion<CutterSuggestionCard["status"]>(editorInstance, id, docId, {
        getAppliedChange: (cid) =>
          p.cards.find(
            (c): c is CutterSuggestionCard => c.id === cid && c.kind === "suggestion",
          )?.appliedChange,
        setSuggestionStatus: p.setSuggestionStatus,
        setArchived: p.setArchived,
        setAppliedChange: p.setAppliedChange,
        deleteCard: p.deleteCard,
        acceptedStatus: "accepted",
      });
    },
    [p, editorInstance, docId],
  );

  const onRevertSuggestion = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editorInstance) return;
      revertSuggestion<CutterSuggestionCard["status"]>(editorInstance, id, docId, {
        getAppliedChange: (cid) =>
          p.cards.find(
            (c): c is CutterSuggestionCard => c.id === cid && c.kind === "suggestion",
          )?.appliedChange,
        setSuggestionStatus: p.setSuggestionStatus,
        setArchived: p.setArchived,
        setAppliedChange: p.setAppliedChange,
        deleteCard: p.deleteCard,
        acceptedStatus: "accepted",
      });
    },
    [p, editorInstance, docId],
  );

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
      onAcceptSuggestion={onAcceptSuggestion}
      onRejectSuggestion={onRejectSuggestion}
      onApplySuggestion={onApplySuggestion}
      onKeepSuggestion={onKeepSuggestion}
      onRevertSuggestion={onRevertSuggestion}
      onConvertCard={p.convertCard}
      onDelete={p.deleteCard}
      onSelect={setSelectedCutterCardId}
      selectedId={selectedCutterCardId}
      onJumpToCard={(card, sourceEl) => editorRef.current?.jumpToCard(card, sourceEl)}
      editor={editorInstance}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
