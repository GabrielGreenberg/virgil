"use client";

import type {
  ReportItem,
  ReportCard as ReportCardData,
  ReportRequestCard as ReportRequestCardData,
} from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
import {
  buildOmniAnchorRows,
  type OmniAnchorRow,
} from "@/panels/_shared/omni-anchor-rows";
import { ReportCard } from "./ReportCard";
import { ReportRequestCard } from "./ReportRequestCard";
import type { JSONContent, Editor } from "@tiptap/react";

interface BuildArgs {
  cards: ReportItem[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  jumpToCard: (card: ReportItem, sourceEl?: HTMLElement | null) => void;
  resolveCardRows: CardAnchorResolver;
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
    const baseId =
      card.kind === "report"
        ? cardPopKey("report", card.id)
        : cardPopKey("report-request", card.id);
    // ONE authority for "where is this card anchored?" — the same rows the
    // margin marker builder draws from (task 369). An unlinked report card is
    // deliberately FREE by this panel's own rule.
    const rows = buildOmniAnchorRows(card, baseId, a.resolveCardRows, {
      unanchored: true,
    });

    // The row's own gate (task 655) — never `rows.some((r) => r.anchorUuid !=
    // null)`, which is true of a card whose stored anchor is DEAD and
    // painted a Jump that `jumpToCard` resolves to nothing. It is per-ROW
    // now: one card-level verdict could not say "this anchor is live and
    // that one is not" even in principle.
    const renderCard = (row: OmniAnchorRow) => {
      const omniId = row.omniId;
      const onJump = row.withJump((sourceEl?: HTMLElement | null) =>
        a.jumpToCard(card, sourceEl),
      );
      return card.kind === "report" ? (
        <ReportCard
          key={omniId}
          report={card as ReportCardData}
          selected={isSelected}
          onUpdate={a.updateReportContent}
          onUpdateTitle={a.updateReportTitle}
          onConvert={a.convertCard}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={onJump}
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
          onJump={onJump}
          onEditorFocus={a.setOverrideEditor}
          getCitationDisplayText={a.getCitationDisplayText}
          onCitationCreated={a.onCitationCreated}
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      );
    };

    for (const row of rows) {
      items.push({
        id: row.omniId,
        pos: row.pos,
        anchorUuid: row.anchorUuid,
        anchorState: row.anchorState,
        content: renderCard(row),
      });
    }
  }

  return items;
}
