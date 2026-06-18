"use client";

import type {
  ReportItem,
  ReportCard as ReportCardData,
  ReportRequestCard as ReportRequestCardData,
} from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { getLinkedTextObjectIds } from "@/links/links";
import { ReportCard } from "./ReportCard";
import { ReportRequestCard } from "./ReportRequestCard";
import type { JSONContent, Editor } from "@tiptap/react";

interface BuildArgs {
  cards: ReportItem[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  jumpToCard: (card: ReportItem, sourceEl?: HTMLElement | null) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  updateReportContent: (id: string, content: JSONContent) => void;
  updateReportTitle: (id: string, title: string) => void;
  updateRequestContent: (id: string, content: JSONContent) => void;
  setRequestAiRequest: (id: string, value: boolean) => void;
  convertCard: (id: string, toKind: "report" | "report-request") => void;
  deleteCard: (id: string) => void;
  // Required: the omni report cards are the SAME mini-editors as the docked
  // panel — they need citation-display + editor-focus wiring or inline `\cite{}`
  // drops dead-end and focus is lost (OMNI-F4-01 / OMNI-F5-01). Required (not
  // optional) so a caller that drops them fails the build.
  setOverrideEditor: (editor: Editor) => void;
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string } | null;
}

/** Build OmniItems for reports and report-requests. Both kinds collapse to a
 *  single "Reports" filter via `getPanelByCardKind`'s polymorphic-card map. */
export function buildReportsOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const card of a.cards) {
    const isSelected = a.selectedId === card.id;
    const pids = getLinkedTextObjectIds(card);
    const baseId =
      card.kind === "report"
        ? cardPopKey("report", card.id)
        : cardPopKey("report-request", card.id);

    const renderCard = (omniId: string) =>
      card.kind === "report" ? (
        <ReportCard
          key={omniId}
          report={card as ReportCardData}
          selected={isSelected}
          onUpdate={a.updateReportContent}
          onUpdateTitle={a.updateReportTitle}
          onConvert={a.convertCard}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            pids.length > 0 ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          onEditorFocus={a.setOverrideEditor}
          getCitationDisplayText={a.getCitationDisplayText}
          onCitationCreated={a.onCitationCreated}
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ) : (
        <ReportRequestCard
          key={omniId}
          request={card as ReportRequestCardData}
          selected={isSelected}
          onUpdate={a.updateRequestContent}
          onConvert={a.convertCard}
          onSetAiRequest={a.setRequestAiRequest}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            pids.length > 0 ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          onEditorFocus={a.setOverrideEditor}
          getCitationDisplayText={a.getCitationDisplayText}
          onCitationCreated={a.onCitationCreated}
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      );

    if (pids.length === 0) {
      items.push({
        id: baseId,
        pos: null,
        anchorState: "free",
        content: renderCard(baseId),
      });
    } else {
      for (let pi = 0; pi < pids.length; pi++) {
        const pid = pids[pi];
        const pos = a.findParagraphPos(pid);
        const suffix = pids.length > 1 ? `@${pi}` : "";
        const omniId = `${baseId}${suffix}`;
        items.push({
          id: omniId,
          pos,
          anchorState: pos == null ? "orphaned" : "anchored",
          content: renderCard(omniId),
        });
      }
    }
  }

  return items;
}
