"use client";

import { useMemo } from "react";
import type {
  ReportItem,
  ReportCard as ReportCardData,
  ReportRequestCard as ReportRequestCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
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
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  recentlyAddedId,
}: {
  cards: ReportItem[];
  onAddReport: (anchorRect?: DOMRect) => ReportCardData;
  onAddReportRequest: (anchorRect?: DOMRect) => ReportRequestCardData;
  onUpdateReportContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
  onUpdateReportTitle: (id: string, title: string) => void;
  onUpdateRequestContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
  onSetRequestAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: ReportItem, sourceEl?: HTMLElement | null) => void;
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
        </ItemMenu>
      }
      items={items}
      getId={(it) => it.id}
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
              onDelete={onDelete}
              onSelect={onSelect}
              onJump={
                onJumpToCard && getLinkedTextObjectIds(it.data).length > 0
                  ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                  : undefined
              }
            />
          );
        }
        return (
          <ReportRequestCard
            request={it.data}
            selected={selected}
            onUpdate={onUpdateRequestContent}
            onSetAiRequest={onSetRequestAiRequest}
            onDelete={onDelete}
            onSelect={onSelect}
            onJump={
              onJumpToCard && getLinkedTextObjectIds(it.data).length > 0
                ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                : undefined
            }
          />
        );
      }}
    />
  );
}
