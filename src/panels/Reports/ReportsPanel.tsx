"use client";

import { useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type {
  ReportItem,
  ReportCard as ReportCardData,
  ReportRequestCard as ReportRequestCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { getLinkedTextObjectIds } from "@/links/links";
import { ReportCard } from "./ReportCard";
import { ReportRequestCard } from "./ReportRequestCard";

type Item =
  | { kind: "report"; id: string; createdAt: string; data: ReportCardData }
  | { kind: "report-request"; id: string; createdAt: string; data: ReportRequestCardData };

export default function ReportsPanel({
  cards,
  onAddReport,
  onAddReportRequest,
  onUpdateReportContent,
  onUpdateReportTitle,
  onUpdateRequestContent,
  onSetRequestAiRequest,
  onConvertCard,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  getCitationDisplayText,
  onCitationCreated,
  onEditorFocus,
  recentlyAddedId,
}: {
  cards: ReportItem[];
  onAddReport: (anchorRect?: DOMRect) => ReportCardData;
  onAddReportRequest: (anchorRect?: DOMRect) => ReportRequestCardData;
  onUpdateReportContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
  onUpdateReportTitle: (id: string, title: string) => void;
  onUpdateRequestContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
  onSetRequestAiRequest: (id: string, value: boolean) => void;
  onConvertCard: (id: string, toKind: "report" | "report-request") => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: ReportItem, sourceEl?: HTMLElement | null) => void;
  // Required at the host boundary (Pillar E-1): report/report-request card
  // bodies are rich-text mini-editors that can host inline `\cite{}` drops and
  // claim editor focus. These were declared on ReportCard/ReportRequestCard but
  // ReportsPanel never threaded them (REP-F4-01 / OMNI-F5-01) — making them
  // required means a host that forgets to wire them fails the build, not silently
  // ships a card whose citation drops dead-end.
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string } | null;
  onEditorFocus: (editor: Editor) => void;
  recentlyAddedId?: string | null;
}) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = cards.map((c) =>
      c.kind === "report-request"
        ? { kind: "report-request", id: c.id, createdAt: c.createdAt, data: c }
        : { kind: "report", id: c.id, createdAt: c.createdAt, data: c },
    );
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return withRecentlyAddedFirst(out, recentlyAddedId, (i) => i.id);
  }, [cards, recentlyAddedId]);

  const onAddOptions = useMemo(
    () => [
      { label: "Report Request", onClick: (rect?: DOMRect) => onAddReportRequest(rect) },
      { label: "Report", onClick: (rect?: DOMRect) => onAddReport(rect) },
    ],
    [onAddReport, onAddReportRequest],
  );

  return (
    <CardListPanel<Item>
      kind="reports"
      count={cards.length}
      onAddOptions={onAddOptions}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="report" label="Report color" />
          </div>
          <CardViewModeMenuItems kind="reports" />
        </ItemMenu>
      }
      items={items}
      getId={(it) => it.id}
      getArchived={(it) => !!it.data.archived}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No reports yet. Click + to add a Report or a Report Request.
        </div>
      }
      renderCard={(it, { selected }) => {
        if (it.kind === "report") {
          return (
            <ReportCard
              report={it.data}
              selected={selected}
              onUpdate={onUpdateReportContent}
              onUpdateTitle={onUpdateReportTitle}
              onConvert={onConvertCard}
              onDelete={onDelete}
              onSelect={onSelect}
              onJump={
                onJumpToCard && getLinkedTextObjectIds(it.data).length > 0
                  ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                  : undefined
              }
              onEditorFocus={onEditorFocus}
              getCitationDisplayText={getCitationDisplayText}
              onCitationCreated={onCitationCreated}
            />
          );
        }
        return (
          <ReportRequestCard
            request={it.data}
            selected={selected}
            onUpdate={onUpdateRequestContent}
            onConvert={onConvertCard}
            onSetAiRequest={onSetRequestAiRequest}
            onDelete={onDelete}
            onSelect={onSelect}
            onJump={
              onJumpToCard && getLinkedTextObjectIds(it.data).length > 0
                ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                : undefined
            }
            onEditorFocus={onEditorFocus}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        );
      }}
    />
  );
}
