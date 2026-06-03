"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { ReportRequestCard as ReportRequestCardData } from "@/lib/types";
import {
  EditableCard,
  AiRequestCheckbox,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedTextObjectIds } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { MIME_REPORT } from "@/lib/marginalia";

/** Top grab bar: anchor-only drag (no inline text insertion). */
export function startReportRequestDrag(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(
    MIME_REPORT,
    JSON.stringify({ cardId, kind: "report-request" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

export function ReportRequestCard({
  request,
  selected,
  onUpdate,
  onSetAiRequest,
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
  request: ReportRequestCardData;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onSetAiRequest?: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(request.id, normalizeRichContent(json));
    },
    [request.id, onUpdate],
  );

  const ac = useAnchoredCard({ kind: "report-request", id: request.id });
  const isExpanded = ac.expanded || selected;
  const isSelected = ac.selected || selected;
  const theme = useCardTheme("report");
  const compressedLines = useCompressedLines();
  const compressed = !isExpanded && !isPoppedOut;
  const compressedSummary = compressed
    ? (makeCompressedSummary(request.content, compressedLines) || "")
    : undefined;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("report-request", request.id);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);

  const card = (
    <EditableCard
      id={request.id}
      cardKind="report-request"
      kind="report-request"
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      canJump={!!onJump}
      onJump={onJump ? (e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null) : undefined}
      onClick={(e) => {
        cardStore.toggleSelection(ac.ref);
        if (!cardStore.isExpanded(ac.ref)) return;
        onSelect(request.id);
        if (onJump) {
          onJump((e?.currentTarget as HTMLElement | undefined)?.closest('[data-card]') as HTMLElement | null);
        }
      }}
      onDelete={() => onDelete(request.id)}
      footer={
        onSetAiRequest && !compressed ? (
          <div className="px-3 pb-2 -mt-1">
            <AiRequestCheckbox
              checked={!!request.aiRequest}
              onToggle={(next) => onSetAiRequest(request.id, next)}
            />
          </div>
        ) : undefined
      }
      value={request.content}
      variant="footnote"
      panelKey="report"
      placeholder="What should Claude report on?"
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "report-request-entry", value: request.id }}
      extraDataAttrs={{ "data-pristine-card-id": request.id, "data-card-key": cardKey, ...(extraDataAttrs || {}) }}
      onHoverChange={(h) => { cardStore.setHover(h ? ac.ref : null); onHoverChange?.(h); }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
