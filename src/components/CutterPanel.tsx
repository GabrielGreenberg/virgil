"use client";

import { useCallback, useMemo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { CutItem } from "@/lib/types";
import {
  CARD_THEMES,
  EditableCard,
  ItemMenu,
  PANEL,
  PanelHeader,
  BadgeLabel,
  BadgeOrphaned,
  CardTitleInput,
  CardTargetIcon,
  startTextDrag,
} from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "./FloatingCards";
import PanelThemePicker from "./PanelThemePicker";
import ViewToggle from "./ViewToggle";
import { useInTextPositions, getParagraphAnchorPositions } from "@/hooks/useInTextPositions";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { MIME_CUT, MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";

function startCutDrag(e: React.DragEvent, cutId: string) {
  e.dataTransfer.setData(MIME_CUT, JSON.stringify({ cutId }));
  e.dataTransfer.effectAllowed = "copy";
}

export function CutCard({
  cut,
  selected,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
}: {
  cut: CutItem;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => onUpdate(cut.id, normalizeRichContent(json)),
    [cut.id, onUpdate],
  );

  const isOrphaned = cut.paragraphIds.length === 0 && !cut.anchorId;
  const popped = usePoppedCards();
  const popKey = `cut:${cut.id}`;
  const isPoppedInCtx = popped?.isPopped(popKey) ?? false;
  if (!isPoppedOut && isPoppedInCtx) return null;
  const onToggleFromCtx = onTogglePopout ?? (popped ? () => popped.toggle(popKey) : undefined);

  const card = (
    <EditableCard
      id={cut.id}
      selected={selected}
      theme={CARD_THEMES.cut}
      grabHandle
      hideToolbar
      inlineDelete
      badge={isOrphaned
        ? <BadgeOrphaned theme={CARD_THEMES.cut} />
        : <BadgeLabel label="C" theme={CARD_THEMES.cut} />
      }
      headerContent={<CardTitleInput defaultValue={cut.title} onChange={(t) => onUpdateTitle(cut.id, t)} theme={CARD_THEMES.cut} />}
      headerTrailing={onJump
        ? <CardTargetIcon selected={selected} onClick={onJump} title="Jump to cut anchor" />
        : <CardTargetIcon selected={false} disabled onClick={() => {}} />
      }
      onClick={() => onSelect(selected ? null : cut.id)}
      onDragStart={(e) => startCutDrag(e, cut.id)}
      onTextDragStart={(e) => startTextDrag(e, cut.content, cut.title)}
      onDelete={() => onDelete(cut.id)}
      value={cut.content}
      variant="footnote"
      placeholder="Cut text…"
      onChange={handleChange}
      dataAttr={{ name: "cut-entry", value: cut.id }}
      onHoverChange={onHoverChange}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={popKey}>{card}</FloatCard>;
  return card;
}

export default function CutterPanel({
  cuts,
  onAdd,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  selectedId,
  onScrollToParagraphId,
  onHoverCut,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: {
  cuts: CutItem[];
  onAdd: () => CutItem;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onScrollToParagraphId?: (uuid: string) => void;
  onHoverCut?: (id: string | null) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  /** Called when the user drags a paragraph by its grab bar onto the panel — creates a new cut bound to that paragraph. */
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}) {
  const sorted = useMemo(
    () => [...cuts].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
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
    editor ?? null, inTextItems, viewMode === "in-text",
  );

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader
        title="Cutter"
        count={cuts.length}
        onAdd={() => onAdd()}
        leading={
          <ItemMenu align="left">
            <div className="px-3 py-1.5 flex items-center justify-end gap-2">
              <PanelThemePicker panelKey="cut" label="Cutter color" />
              {onViewModeChange && (
                <ViewToggle mode={viewMode} onChange={onViewModeChange} />
              )}
            </div>
          </ItemMenu>
        }
      />

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
        onClick={() => onSelect(null)}
        onDragOver={(onDropSelection || onDropParagraph) ? (e) => {
          const types = e.dataTransfer.types;
          if (
            (onDropSelection && types.includes(MIME_SELECTION_ANCHOR)) ||
            (onDropParagraph && types.includes(MIME_PAR_CAPTURE))
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        } : undefined}
        onDrop={(onDropSelection || onDropParagraph) ? (e) => {
          if (onDropParagraph) {
            const parRaw = e.dataTransfer.getData(MIME_PAR_CAPTURE);
            if (parRaw) {
              e.preventDefault();
              e.stopPropagation();
              try {
                const { uuid } = JSON.parse(parRaw) as { uuid: string };
                if (uuid) onDropParagraph(uuid);
              } catch { /* ignore */ }
              return;
            }
          }
          if (onDropSelection) {
            const raw = e.dataTransfer.getData(MIME_SELECTION_ANCHOR);
            if (!raw) return;
            e.preventDefault();
            try {
              const payload = JSON.parse(raw);
              if (typeof payload.from === "number" && typeof payload.to === "number") {
                onDropSelection(payload);
              }
            } catch { /* ignore */ }
          }
        } : undefined}
      >
        {sorted.length === 0 && (
          <div className={PANEL.empty}>
            No cuts yet. Select text and click the Cutter button in the toolbar, or drag a selection into this panel.
          </div>
        )}

        {viewMode === "in-text" && sorted.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {sorted.map((cut) => {
              const top = positions.get(cut.id);
              if (top === undefined) return null;
              const isSelected = selectedId === cut.id;
              const preview = richJsonToPlainText(cut.content) || "";
              const borderColor = cutTheme.override?.selectedBorder ?? cutTheme.badgeBorder;
              const selectedBg = cutTheme.override?.headerBgSelected;
              return (
                <div
                  key={cut.id}
                  data-cut-entry={cut.id}
                  className={`absolute left-0 right-0 px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${isSelected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover:bg-surface-muted"}`}
                  style={{
                    top,
                    ...(isSelected
                      ? { borderLeftColor: borderColor, backgroundColor: selectedBg ?? "rgba(180, 87, 87, 0.08)" }
                      : {}),
                  }}
                  onClick={(e) => { e.stopPropagation(); onSelect(isSelected ? null : cut.id); }}
                  onMouseEnter={onHoverCut ? () => onHoverCut(cut.id) : undefined}
                  onMouseLeave={onHoverCut ? () => onHoverCut(null) : undefined}
                >
                  {cut.title && (
                    <div className="text-[11px] font-medium truncate mb-0.5" style={{ color: cutTheme.titleColor }}>
                      {cut.title}
                    </div>
                  )}
                  <p
                    className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
                    style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                  >
                    {preview || <span className="italic text-ink-muted">Empty cut</span>}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          sorted.map((cut) => (
            <CutCard
              key={cut.id}
              cut={cut}
              selected={selectedId === cut.id}
              onUpdate={onUpdate}
              onUpdateTitle={onUpdateTitle}
              onDelete={onDelete}
              onSelect={onSelect}
              onJump={onScrollToParagraphId && cut.paragraphIds[0]
                ? () => onScrollToParagraphId(cut.paragraphIds[0])
                : undefined
              }
              onHoverChange={onHoverCut ? (hovering) => onHoverCut(hovering ? cut.id : null) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
