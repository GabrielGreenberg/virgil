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
import type { JSONContent } from "@tiptap/react";

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
  deleteCard: (id: string) => void;
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
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            pids.length > 0 ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ) : (
        <ReportRequestCard
          key={omniId}
          request={card as ReportRequestCardData}
          selected={isSelected}
          onUpdate={a.updateRequestContent}
          onSetAiRequest={a.setRequestAiRequest}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            pids.length > 0 ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      );

    if (pids.length === 0) {
      items.push({ id: baseId, pos: null, content: renderCard(baseId) });
    } else {
      for (let pi = 0; pi < pids.length; pi++) {
        const pid = pids[pi];
        const pos = a.findParagraphPos(pid);
        const suffix = pids.length > 1 ? `@${pi}` : "";
        const omniId = `${baseId}${suffix}`;
        items.push({ id: omniId, pos, content: renderCard(omniId) });
      }
    }
  }

  return items;
}
