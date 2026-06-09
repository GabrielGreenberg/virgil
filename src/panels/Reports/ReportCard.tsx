"use client";

import { useCallback } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import type { ReportCard as ReportCardData } from "@/lib/types";
import { EditableCard, makeCompressedSummary } from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedTextObjectIds } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { MIME_REPORT } from "@/lib/marginalia";
import { AuthorByline } from "./AuthorByline";

/** Top grab bar: anchor-only drag (no inline text insertion). */
export function startReportDrag(e: React.DragEvent, reportId: string) {
  e.dataTransfer.setData(
    MIME_REPORT,
    JSON.stringify({ cardId: reportId, kind: "report" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

export function ReportCard({
  report,
  selected,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  onJump,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  extraDataAttrs,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
}: {
  report: ReportCardData;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onEditorFocus?: (editor: Editor) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(report.id, normalizeRichContent(json));
    },
    [report.id, onUpdate],
  );

  const ac = useAnchoredCard({ kind: "report", id: report.id });
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const _isOrphaned = getLinkedTextObjectIds(report).length === 0;
  void _isOrphaned;
  const theme = useCardTheme("report");
  const compressedLines = useCompressedLines();
  const compressed = !isExpanded && !isPoppedOut;
  const compressedSummary = compressed
    ? (makeCompressedSummary(report.content, compressedLines) || "")
    : undefined;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("report", report.id);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);

  const card = (
    <EditableCard
      id={report.id}
      cardKind="report"
      kind="report"
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      bodyTitle={report.title}
      onBodyTitleChange={(t) => onUpdateTitle(report.id, t)}
      canJump={!!onJump}
      onJump={onJump ? (e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null) : undefined}
      onClick={(e) => {
        ac.onActivate();
        onSelect(report.id);
        if (onJump) {
          onJump((e?.currentTarget as HTMLElement | undefined)?.closest('[data-card]') as HTMLElement | null);
        }
      }}
      onDelete={() => onDelete(report.id)}
      footer={!compressed ? <AuthorByline author={report.author} createdAt={report.createdAt} /> : undefined}
      value={report.content}
      variant="footnote"
      panelKey="report"
      placeholder="Report text."
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "report-entry", value: report.id }}
      extraDataAttrs={{ "data-pristine-card-id": report.id, "data-card-key": cardKey, ...(extraDataAttrs || {}) }}
      onHoverChange={(h) => { cardStore.setHover(h ? ac.ref : null); onHoverChange?.(h); }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );
  return card;
}
