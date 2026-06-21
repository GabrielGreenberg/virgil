"use client";

import { useCallback, useEffect, useRef } from "react";
import ReportsPanel from "@/panels/Reports";
import type { ReportItem, ReportCard, ReportRequestCard } from "@/lib/types";
import type { Side } from "@/hooks/useViewPrefs";
import type { JSONContent } from "@tiptap/react";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCitationDisplayContext } from "../contexts/citation-display";
import { useCardCreationContext } from "../contexts/card-creation";
import { useRecentlyAddedId } from "../contexts/recently-added";

export interface ReportsHostProps {
  side: Side;
  panelSide: Side | null;
  cards: ReportItem[];
  updateReportContent: (id: string, content: JSONContent) => void;
  updateReportTitle: (id: string, title: string) => void;
  updateRequestContent: (id: string, content: JSONContent) => void;
  setRequestAiRequest: (id: string, value: boolean) => void;
  /** Morph report ⇄ report-request via the kind-chevron — routes through the
   *  EditorPane morph chokepoint (lossy confirm + float-key remap). */
  convertCard: (id: string, toKind: "report" | "report-request") => void;
  deleteCard: (id: string) => void;
  /** Called on host unmount to drop cards created via "+" but never edited. */
  discardPristine: () => void;
}

export function ReportsHost(p: ReportsHostProps) {
  const { editorRef, setOverrideEditor } = useEditorRefContext();
  const { selectedReportCardId, setSelectedReportCardId } = useSelectionsContext();
  const { getCitationDisplayText, onCitationCreated } = useCitationDisplayContext();
  const { createReport, createReportRequest } = useCardCreationContext();
  const recentlyAddedId = useRecentlyAddedId("reports");
  const discardRef = useRef(p.discardPristine);
  useEffect(() => {
    discardRef.current = p.discardPristine;
  });
  useEffect(() => () => discardRef.current(), []);

  const onAddReport = useCallback(
    (rect?: DOMRect): ReportCard => createReport({ anchorRect: rect }),
    [createReport],
  );
  const onAddReportRequest = useCallback(
    (rect?: DOMRect): ReportRequestCard => createReportRequest({ anchorRect: rect }),
    [createReportRequest],
  );

  return (
    <ReportsPanel
      cards={p.cards}
      onAddReport={onAddReport}
      onAddReportRequest={onAddReportRequest}
      onUpdateReportContent={p.updateReportContent}
      onUpdateReportTitle={p.updateReportTitle}
      onUpdateRequestContent={p.updateRequestContent}
      onSetRequestAiRequest={p.setRequestAiRequest}
      onConvertCard={p.convertCard}
      onDelete={p.deleteCard}
      onSelect={setSelectedReportCardId}
      selectedId={selectedReportCardId}
      onJumpToCard={(card, sourceEl) => editorRef.current?.jumpToCard(card, sourceEl)}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      onEditorFocus={setOverrideEditor}
      recentlyAddedId={recentlyAddedId}
    />
  );
}
