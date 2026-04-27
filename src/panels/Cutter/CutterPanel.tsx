"use client";

import { useMemo, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { CutItem } from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  getParagraphAnchorPositions,
} from "@/hooks/useInTextPositions";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { countWords, useWordCount } from "@/hooks/useWordCount";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CutCard } from "./CutCard";
import { CutterHeader } from "./CutterHeader";

export default function CutterPanel({
  cuts,
  goal,
  onSetGoal,
  onAdd,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  onHoverCut,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: {
  cuts: CutItem[];
  goal: number | null;
  onSetGoal: (goal: number | null) => void;
  onAdd: () => CutItem;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: CutItem) => void;
  onHoverCut?: (id: string | null) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}) {
  const { counts: docCounts } = useWordCount(editor ?? null);
  const cutWords = useMemo(
    () =>
      cuts.reduce(
        (sum, c) => sum + countWords(richJsonToPlainText(c.content)),
        0,
      ),
    [cuts],
  );
  const sorted = useMemo(
    () =>
      [...cuts].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [cuts],
  );
  const cutTheme = useCardTheme("cut");

  const inTextItems = useMemo(
    () => getParagraphAnchorPositions(editor ?? null, sorted),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, sorted],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null,
    inTextItems,
    viewMode === "in-text",
  );

  const dropEnabled = onDropSelection || onDropParagraph;
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = dropEnabled
    ? (e: React.DragEvent) => {
        const types = e.dataTransfer.types;
        if (
          (onDropSelection && types.includes(MIME_SELECTION_ANCHOR)) ||
          (onDropParagraph && types.includes(MIME_PAR_CAPTURE))
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!isDragOver) setIsDragOver(true);
        }
      }
    : undefined;
  const handleDragLeave = dropEnabled
    ? (e: React.DragEvent) => {
        const current = e.currentTarget as HTMLElement;
        const next = e.relatedTarget as Node | null;
        if (!next || !current.contains(next)) setIsDragOver(false);
      }
    : undefined;
  const handleDrop = dropEnabled
    ? (e: React.DragEvent) => {
        setIsDragOver(false);
        if (onDropParagraph) {
          const parRaw = e.dataTransfer.getData(MIME_PAR_CAPTURE);
          if (parRaw) {
            e.preventDefault();
            e.stopPropagation();
            try {
              const { uuid } = JSON.parse(parRaw) as { uuid: string };
              if (uuid) onDropParagraph(uuid);
            } catch {
              // ignore
            }
            return;
          }
        }
        if (onDropSelection) {
          const raw = e.dataTransfer.getData(MIME_SELECTION_ANCHOR);
          if (!raw) return;
          e.preventDefault();
          try {
            const payload = JSON.parse(raw);
            if (
              typeof payload.from === "number" &&
              typeof payload.to === "number"
            ) {
              onDropSelection(payload);
            }
          } catch {
            // ignore
          }
        }
      }
    : undefined;

  return (
    <CardListPanel
      kind="cutter"
      count={cuts.length}
      onAdd={() => onAdd()}
      panelExtras={
        <CutterHeader
          documentWords={docCounts.total}
          cutWords={cutWords}
          goal={goal}
          onSetGoal={onSetGoal}
        />
      }
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="cut" label="Cutter color" />
            {onViewModeChange && (
              <ViewToggle mode={viewMode} onChange={onViewModeChange} />
            )}
          </div>
        </ItemMenu>
      }
      items={sorted}
      getId={(c) => c.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No cuts yet. Select text and click the Cutter button in the toolbar,
          or drag a selection into this panel.
        </div>
      }
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      showDropPlaceholder={isDragOver}
      renderCard={(cut, { selected }) => (
        <CutCard
          cut={cut}
          selected={selected}
          onUpdate={onUpdate}
          onUpdateTitle={onUpdateTitle}
          onDelete={onDelete}
          onSelect={onSelect}
          onJump={
            onJumpToCard && getLinkedParagraphIds(cut).length > 0
              ? () => onJumpToCard(cut)
              : undefined
          }
          onHoverChange={
            onHoverCut
              ? (hovering) => onHoverCut(hovering ? cut.id : null)
              : undefined
          }
        />
      )}
      inTextRenderItem={(cut, { selected }) => {
        const preview = richJsonToPlainText(cut.content) || "";
        const borderColor =
          cutTheme.borderSelected;
        const selectedBg = cutTheme.headerSelected;
        return (
          <div
            data-cut-entry={cut.id}
            className={`px-2 pr-4 py-2 border-b cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-edge-hover" : "border-b-edge-hover hover-on-light"}`}
            style={
              selected
                ? {
                    borderLeftColor: borderColor,
                    backgroundColor:
                      selectedBg ?? "rgba(180, 87, 87, 0.08)",
                  }
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              onSelect(selected ? null : cut.id);
            }}
            onMouseEnter={onHoverCut ? () => onHoverCut(cut.id) : undefined}
            onMouseLeave={onHoverCut ? () => onHoverCut(null) : undefined}
          >
            {cut.title && (
              <div
                className="text-[11px] font-medium truncate mb-0.5"
                style={{ color: cutTheme.titleColor }}
              >
                {cut.title}
              </div>
            )}
            <p
              className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {preview || (
                <span className="italic text-ink-muted">Empty cut</span>
              )}
            </p>
          </div>
        );
      }}
    />
  );
}
