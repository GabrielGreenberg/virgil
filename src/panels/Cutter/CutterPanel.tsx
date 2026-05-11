"use client";

import { useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import type {
  CutterCard,
  CutterCommentCard as CutterCommentCardData,
  CutterGoal,
  CutterSuggestionCard as CutterSuggestionCardData,
} from "@/lib/types";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { useWordCount } from "@/hooks/useWordCount";
import { getLinkedParagraphIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { CutterCommentCard } from "./CutterCommentCard";
import { CutterSuggestionCard } from "./CutterSuggestionCard";
import { CutterGoalStrip } from "./CutterGoalStrip";

type Item =
  | { kind: "comment"; id: string; createdAt: string; data: CutterCommentCardData }
  | { kind: "suggestion"; id: string; createdAt: string; data: CutterSuggestionCardData };

export default function CutterPanel({
  cards,
  goal,
  onSetGoal,
  onClearGoal,
  onAddComment,
  onAddSuggestion,
  onUpdateCommentText,
  onSetCommentAiRequest,
  onUpdateSuggestionField,
  onAcceptSuggestion,
  onRejectSuggestion,
  onDelete,
  onSelect,
  selectedId,
  onJumpToCard,
  onDropSelection,
  onDropParagraph,
  editor,
  recentlyAddedId,
}: {
  cards: CutterCard[];
  goal: CutterGoal | null;
  onSetGoal: (target: number, initialWords: number) => void;
  onClearGoal: () => void;
  onAddComment: () => CutterCommentCardData;
  onAddSuggestion: () => CutterSuggestionCardData;
  onUpdateCommentText: (id: string, text: string) => void;
  onSetCommentAiRequest: (id: string, value: boolean) => void;
  onUpdateSuggestionField: (
    id: string,
    field:
      | "original_text"
      | "suggested_text"
      | "explanation"
      | "user_text"
      | "instructions",
    value: string,
  ) => void;
  onAcceptSuggestion: (id: string) => void;
  onRejectSuggestion: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onJumpToCard?: (card: CutterCard, sourceEl?: HTMLElement | null) => void;
  onDropSelection?: (payload: {
    from: number;
    to: number;
    selectedText: string;
  }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  recentlyAddedId?: string | null;
}) {
  const { counts } = useWordCount(editor ?? null);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = cards.map((c) =>
      c.kind === "suggestion"
        ? { kind: "suggestion", id: c.id, createdAt: c.createdAt, data: c }
        : { kind: "comment", id: c.id, createdAt: c.createdAt, data: c },
    );
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return withRecentlyAddedFirst(out, recentlyAddedId, (i) => i.id);
  }, [cards, recentlyAddedId]);

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
          </div>
        </ItemMenu>
      }
      panelExtras={
        <CutterGoalStrip
          goal={goal}
          currentWords={counts.total}
          onSetGoal={onSetGoal}
          onClearGoal={onClearGoal}
        />
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
                  ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                  : undefined
              }
            />
          );
        }
        return (
          <CutterCommentCard
            card={it.data}
            selected={selected}
            editor={editor}
            onUpdateText={onUpdateCommentText}
            onSetAiRequest={onSetCommentAiRequest}
            onDelete={onDelete}
            onSelect={onSelect}
            onJump={
              onJumpToCard && getLinkedParagraphIds(it.data).length > 0
                ? (sourceEl) => onJumpToCard(it.data, sourceEl)
                : undefined
            }
          />
        );
      }}
    />
  );
}
