"use client";

import { useCallback } from "react";
import type { JSONContent, Editor } from "@tiptap/react";
import type { ReportCard as ReportCardData } from "@/lib/types";
import { EditableCard } from "@/components/panel-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { normalizeRichContent } from "@/lib/footnote-content";
import { cardBodyPlaceholder } from "@/panels/panel-registry";
import { useAnchoredCardShell } from "@/panels/_shared/useAnchoredCardShell";
import { bodyVariantForCardKind } from "@/cards/predicates";
import { morphOptionsFor } from "@/cards/card-registry";
import type { CardMorphHandler } from "@/cards/types";
import { AuthorByline } from "./AuthorByline";

export function ReportCard({
  report,
  selected,
  onUpdate,
  onUpdateTitle,
  onConvert,
  onDelete,
  onSelect,
  onJump,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  extraDataAttrs,
  isPoppedOut,
}: {
  report: ReportCardData;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  /** Morph report ⇄ report-request via the kind-chevron (lossy: drops the
   *  title/author byline; the host confirms first). */
  onConvert?: CardMorphHandler;
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
      onUpdate(report.id, normalizeRichContent(json));
    },
    [report.id, onUpdate],
  );

  const { ac, compressed, compressedSummary, shell } = useAnchoredCardShell({
    kind: "report",
    id: report.id,
    isPoppedOut,
    onSelect: () => onSelect(report.id),
    onJump,
    summaryContent: report.content,
  });
  const isSelected = ac.selected || selected;
  const theme = useCardKindTheme("report");

  const card = (
    <EditableCard
      {...shell}
      id={report.id}
      cardKind="report"
      kind="report"
      kindOptions={onConvert ? morphOptionsFor("report") : undefined}
      onKindChange={onConvert ? (k) => onConvert("report", report.id, k) : undefined}
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      bodyTitle={report.title}
      onBodyTitleChange={(t) => onUpdateTitle(report.id, t)}
      onDelete={() => onDelete(report.id)}
      footer={!compressed ? <AuthorByline author={report.author} createdAt={report.createdAt} /> : undefined}
      value={report.content}
      variant={bodyVariantForCardKind("report")}
      panelKey="report"
      placeholder={cardBodyPlaceholder("report")}
      onChange={handleChange}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "report-entry", value: report.id }}
      extraDataAttrs={{ "data-pristine-card-id": report.id, ...(extraDataAttrs || {}) }}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );
  return card;
}
