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
import { useAiRequestsContext } from "../contexts/ai-requests";
import { useRecentlyAddedId } from "../contexts/recently-added";
import { isPendingChangesOn } from "@/lib/pending-changes-flag";
import {
  applySuggestion,
  keepSuggestion,
  dismissSuggestion,
  type PendingChangeCardDeps,
} from "@/links/pending-change-actions";
import { generateEntityId } from "@/lib/uuid";
import { useDocWriteHandleOrNull } from "../DocPipeline";

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
  /** Flag-ON only: set/clear the in-doc splice descriptor on a suggestion card
   *  (Apply sets it, Keep clears it). Threaded from `useRevisions`. */
  setAppliedChange: (
    id: string,
    appliedChange: RevisionSuggestionCard["appliedChange"] | undefined,
  ) => void;
  /** Flag-ON only: archive the surviving original-record card on Keep. */
  setArchived: (id: string, archived: boolean) => void;
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
  const { createRevisionRequest, createRevisionSuggestion } =
    useCardCreationContext();
  const { addAiRequest } = useAiRequestsContext();
  const recentlyAddedId = useRecentlyAddedId("revision");
  const docHandle = useDocWriteHandleOrNull();
  const docId = docHandle?.docId ?? null;
  const discardRef = useRef(p.discardPristine);
  discardRef.current = p.discardPristine;
  useEffect(() => () => discardRef.current(), []);

  const onAddRequest = useCallback(
    (rect?: DOMRect): RevisionRequestCard => createRevisionRequest({ anchorRect: rect }),
    [createRevisionRequest],
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

  // ── Pending-changes (flag-ON) — client-side Apply / Keep / Revert ──
  // These three mirror the headless propose→apply loop entirely in-browser.
  // Each no-ops gracefully when the flag is OFF, the editor isn't mounted, or
  // the card has no resolvable Mode-A anchor (treat as not-applicable, never
  // crash). The OFF path stays on onAcceptSuggestion/onRejectSuggestion above.

  const onApplySuggestion = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editorInstance) return;
      const s = p.cards.find(
        (c): c is RevisionSuggestionCard => c.id === id && c.kind === "suggestion",
      );
      if (!s) return;
      // Route through the shared `applySuggestion` (the same path the auto-apply
      // driver uses — Phase 2), so the manual button and the driver are
      // byte-identical. Returns applied / stale / skipped; the card-state
      // transitions happen inside via the deps.
      applySuggestion<RevisionSuggestionCard["status"]>({
        editor: editorInstance,
        card: s,
        family: "revision-suggestion",
        setSuggestionStatus: p.setSuggestionStatus,
        setAppliedChange: p.setAppliedChange,
        generateAnchorId: generateEntityId,
        appliedStatus: "applied",
        staleStatus: "stale",
      });
    },
    [p, editorInstance],
  );

  // Keep / Revert route through the shared `pending-change-actions` sequence
  // (the same one the EditorPane margin-gutter marker calls — Phase 1c), so the
  // two drivers stay byte-identical. The flag + editor-mounted guard stays here;
  // the helper owns the `appliedChange`-presence no-op + the splice/flush/state
  // sequence.
  const revisionPendingDeps = useCallback(
    (): PendingChangeCardDeps<RevisionSuggestionCard["status"]> => ({
      getAppliedChange: (cid) =>
        p.cards.find(
          (c): c is RevisionSuggestionCard => c.id === cid && c.kind === "suggestion",
        )?.appliedChange,
      setSuggestionStatus: p.setSuggestionStatus,
      setArchived: p.setArchived,
      setAppliedChange: p.setAppliedChange,
      family: "revision-suggestion",
      acceptedStatus: "accepted",
      rejectedStatus: "rejected",
    }),
    [p],
  );
  const onKeepSuggestion = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editorInstance) return;
      keepSuggestion(editorInstance, id, docId, revisionPendingDeps());
    },
    [editorInstance, docId, revisionPendingDeps],
  );

  const onRevertSuggestion = useCallback(
    (id: string) => {
      if (!isPendingChangesOn() || !editorInstance) return;
      dismissSuggestion(editorInstance, id, docId, revisionPendingDeps());
    },
    [editorInstance, docId, revisionPendingDeps],
  );

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
      onAcceptSuggestion={onAcceptSuggestion}
      onRejectSuggestion={onRejectSuggestion}
      onApplySuggestion={onApplySuggestion}
      onKeepSuggestion={onKeepSuggestion}
      onRevertSuggestion={onRevertSuggestion}
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
