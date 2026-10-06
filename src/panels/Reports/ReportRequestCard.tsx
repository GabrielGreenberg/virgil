"use client";

import { useCallback } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import type { ReportRequestCard as ReportRequestCardData } from "@/lib/types";
import { EditableCard } from "@/components/panel-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { normalizeRichContent } from "@/lib/footnote-content";
import { cardBodyPlaceholder } from "@/panels/panel-registry";
import { bodyVariantForCardKind } from "@/cards/predicates";
import { morphOptionsFor } from "@/cards/card-registry";
import type { CardMorphHandler } from "@/cards/types";
import { useAnchoredCardShell } from "@/panels/_shared/useAnchoredCardShell";

export function ReportRequestCard({
  request,
  selected,
  onUpdate,
  onConvert,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  extraDataAttrs,
  isPoppedOut,
}: {
  request: ReportRequestCardData;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  /** Morph report-request ⇄ report via the kind-chevron. */
  onConvert?: CardMorphHandler;
  onSetAiRequest?: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onEditorFocus?: (editor: Editor) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  extraDataAttrs?: Record<string, string>;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdate(request.id, normalizeRichContent(json));
    },
    [request.id, onUpdate],
  );

  const { ac, compressed, compressedSummary, shell } = useAnchoredCardShell({
    kind: "report-request",
    id: request.id,
    isPoppedOut,
    onSelect: () => onSelect(request.id),
    onJump,
    summaryContent: request.content,
  });
  const isSelected = ac.selected || selected;
  const theme = useCardKindTheme("report-request");

  const card = (
    <EditableCard
      {...shell}
      id={request.id}
      cardKind="report-request"
      kind="report-request"
      kindOptions={onConvert ? morphOptionsFor("report-request") : undefined}
      onKindChange={
        onConvert ? (k) => onConvert("report-request", request.id, k) : undefined
      }
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      onDelete={() => onDelete(request.id)}
      aiRequest={
        onSetAiRequest
          ? { checked: !!request.aiRequest, onToggle: (next) => onSetAiRequest(request.id, next) }
          : undefined
      }
      value={request.content}
      variant={bodyVariantForCardKind("report-request")}
      panelKey="report"
      placeholder={cardBodyPlaceholder("report-request")}
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "report-request-entry", value: request.id }}
      extraDataAttrs={{ "data-pristine-card-id": request.id, ...(extraDataAttrs || {}) }}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );
  return card;
}
