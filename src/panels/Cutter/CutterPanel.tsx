"use client";

import { useMemo, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type {
  CutterCard,
  CutterCommentCard as CutterCommentCardData,
  CutterSuggestionCard as CutterSuggestionCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds, getTextAnchor } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import { resolveAnchorRange } from "@/links/links";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CutterCommentCard } from "./CutterCommentCard";
import { CutterSuggestionCard } from "./CutterSuggestionCard";

type Item =
  | { kind: "comment"; id: string; createdAt: string; data: CutterCommentCardData }
  | { kind: "suggestion"; id: string; createdAt: string; data: CutterSuggestionCardData };

export default function CutterPanel({
  cards,
  onAddComment,
  onAddSuggestion,
  onUpdateCommentContent,
  onSetCommentAiRequest,
  onUpdateSuggestionField,
  onAcceptSuggestion,
  onRejectSuggestion,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  onHoverCard,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: {
  cards: CutterCard[];
  onAddComment: () => CutterCommentCardData;
  onAddSuggestion: () => CutterSuggestionCardData;
  onUpdateCommentContent: (id: string, content: JSONContent) => void;
  onSetCommentAiRequest: (id: string, value: boolean) => void;
  onUpdateSuggestionField: (
    id: string,
    field: "original_text" | "suggested_text" | "explanation",
    value: string,
  ) => void;
  onAcceptSuggestion: (id: string) => void;
  onRejectSuggestion: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: CutterCard) => void;
  onHoverCard?: (id: string | null) => void;
  onDropSelection?: (payload: {
    from: number;
    to: number;
    selectedText: string;
  }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}) {
  const cutterTheme = useCardTheme("cut");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = cards.map((c) =>
      c.kind === "suggestion"
        ? { kind: "suggestion", id: c.id, createdAt: c.createdAt, data: c }
        : { kind: "comment", id: c.id, createdAt: c.createdAt, data: c },
    );
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }, [cards]);

  const inTextItems = useMemo<PositionItem[]>(() => {
    if (!editor) return [];
    const out: PositionItem[] = [];
    for (const c of cards) {
      const ta = getTextAnchor(c);
      if (ta) {
        const range = resolveAnchorRange(editor, ta.anchorId);
        if (range) {
          out.push({ id: c.id, pos: range.from });
          continue;
        }
      }
      // Fall back to first paragraph anchor (Mode A) — getParagraphAnchorPositions
      // would do this but we need uniform fallback per item.
      const pids = getLinkedParagraphIds(c);
      if (pids.length === 0) continue;
      // Resolve via DOM after layout — cheaper to skip here and let the
      // grid skip un-positioned cards rather than synthesize positions.
      out.push({ id: c.id, pos: 0 });
    }
    return out;
  }, [editor, cards]);
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

  const onAddOptions = useMemo(
    () => [
      { label: "Comment", onClick: () => onAddComment() },
      { label: "Suggestion", onClick: () => onAddSuggestion() },
    ],
    [onAddComment, onAddSuggestion],
  );

  return (
    <CardListPanel<Item>
      kind="cutter"
      count={cards.length}
      onAddOptions={onAddOptions}
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
      items={items}
      getId={(it) => it.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No comments or suggestions yet. Click + to add one, or drop a
          paragraph or selection here.
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
      renderCard={(it, { selected }) => {
        if (it.kind === "suggestion") {
          return (
            <CutterSuggestionCard
              card={it.data}
              selected={selected}
              onUpdateField={onUpdateSuggestionField}
              onAccept={onAcceptSuggestion}
              onReject={onRejectSuggestion}
              onDelete={onDelete}
              onSelect={onSelect}
              onJump={
                onJumpToCard && getLinkedParagraphIds(it.data).length > 0
                  ? () => onJumpToCard(it.data)
                  : undefined
              }
            />
          );
        }
        return (
          <CutterCommentCard
            card={it.data}
            selected={selected}
            onUpdate={onUpdateCommentContent}
            onSetAiRequest={onSetCommentAiRequest}
            onDelete={onDelete}
            onSelect={onSelect}
            onJump={
              onJumpToCard && getLinkedParagraphIds(it.data).length > 0
                ? () => onJumpToCard(it.data)
                : undefined
            }
            onHoverChange={
              onHoverCard
                ? (hovering) => onHoverCard(hovering ? it.data.id : null)
                : undefined
            }
          />
        );
      }}
      inTextRenderItem={(it, { selected }) => {
        const borderColor = cutterTheme.borderSelected;
        const selectedBg = cutterTheme.headerSelected;
        if (it.kind === "suggestion") {
          const s = it.data;
          return (
            <div
              data-cutter-suggestion-entry={s.id}
              className={`px-2 pr-4 py-2 border-b cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-edge-hover" : "border-b-edge-hover hover-on-light"}`}
              style={
                selected
                  ? {
                      borderLeftColor: borderColor,
                      backgroundColor:
                        selectedBg ?? "rgba(124, 58, 237, 0.08)",
                    }
                  : undefined
              }
              onClick={(e) => {
                e.stopPropagation();
                onSelect(selected ? null : s.id);
              }}
            >
              {s.original_text && (
                <p className="text-[11px] line-through text-red-700 truncate">
                  {s.original_text}
                </p>
              )}
              <p
                className="text-xs text-emerald-800 line-clamp-2 pr-6"
                style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
              >
                {s.suggested_text || (
                  <span className="italic text-ink-muted">No replacement</span>
                )}
              </p>
            </div>
          );
        }
        const c = it.data;
        const preview = c.text || "";
        return (
          <div
            data-cutter-comment-entry={c.id}
            className={`px-2 pr-4 py-2 border-b cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-edge-hover" : "border-b-edge-hover hover-on-light"}`}
            style={
              selected
                ? {
                    borderLeftColor: borderColor,
                    backgroundColor: selectedBg ?? "rgba(180, 87, 87, 0.08)",
                  }
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              onSelect(selected ? null : c.id);
            }}
            onMouseEnter={onHoverCard ? () => onHoverCard(c.id) : undefined}
            onMouseLeave={onHoverCard ? () => onHoverCard(null) : undefined}
          >
            {c.selectedText && (
              <div className="text-[10px] italic text-ink-muted truncate mb-0.5">
                &ldquo;{c.selectedText}&rdquo;
              </div>
            )}
            <p
              className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {preview || (
                <span className="italic text-ink-muted">Empty comment</span>
              )}
            </p>
          </div>
        );
      }}
    />
  );
}
