"use client";

import { useEffect, useCallback, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import type {
  UserNote,
  HighlightCard as HighlightCardData,
  NoteCardItem,
  AiRequest,
} from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  useCycle,
} from "@/components/panel-primitives";
import { getLinkedParagraphIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { NoteCard } from "./NoteCard";
import { HighlightCard } from "./HighlightCard";

interface NotesPanelProps {
  cards: NoteCardItem[];
  onAddNote: (anchorRect?: DOMRect) => UserNote;
  /** Returns null if no live selection (highlight requires a text range). */
  onAddHighlight?: (anchorRect?: DOMRect) => HighlightCardData | null;
  onAddNoteForHighlight: (id: string) => UserNote | null;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onSetNoteAiRequest: (id: string, value: boolean) => void;
  onSetHighlightAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  selectedNoteId: string | null;
  onJumpToCard?: (card: NoteCardItem, sourceEl?: HTMLElement | null) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  onEditorFocus?: (editor: any) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  recentlyAddedId?: string | null;
}

export default function NotesPanel({
  cards,
  onAddNote,
  onAddHighlight,
  onAddNoteForHighlight,
  onUpdate,
  onUpdateTitle,
  onSetNoteAiRequest,
  onSetHighlightAiRequest,
  onDelete,
  onSelectNote,
  selectedNoteId,
  onJumpToCard,
  getCitationDisplayText,
  onCitationCreated,
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onEditorFocus,
  onDropSelection,
  onDropParagraph,
  recentlyAddedId,
}: NotesPanelProps) {
  const sortedCards = useMemo(
    () => {
      const out = [...cards].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      return withRecentlyAddedFirst(out, recentlyAddedId, (c) => c.id);
    },
    [cards, recentlyAddedId],
  );

  // Notes and highlights both contribute AI requests; the bridge marks them
  // with kind: "note" or "highlight" so the panel can show both above the
  // card list (mirrors the Cutter panel's mixed-AI-request aggregation).
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "note" || r.kind === "highlight"),
    [aiRequests],
  );

  const onActivateCard = useCallback(
    (card: NoteCardItem) => {
      onSelectNote(card.id);
      onJumpToCard?.(card);
    },
    [onSelectNote, onJumpToCard],
  );
  const { idx, setIdx } = useCycle(sortedCards, onActivateCard);

  useEffect(() => {
    if (!selectedNoteId) return;
    const i = sortedCards.findIndex((c) => c.id === selectedNoteId);
    if (i >= 0 && i !== idx) setIdx(i);
  }, [selectedNoteId, sortedCards, idx, setIdx]);

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

  // "+" dropdown: lets the user explicitly pick which kind to create.
  // (Drop-with-selection still defaults to Highlight per the host's
  // wiring — this dropdown is for empty-selection "+" clicks.)
  const onAddOptions = useMemo(
    () => [
      { label: "Note", onClick: (rect?: DOMRect) => onAddNote(rect) },
      ...(onAddHighlight
        ? [{ label: "Highlight", onClick: (rect?: DOMRect) => onAddHighlight(rect) }]
        : []),
    ],
    [onAddNote, onAddHighlight],
  );

  return (
    <CardListPanel<NoteCardItem>
      kind="notes"
      count={cards.length}
      onAddOptions={onAddOptions}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2 flex-col">
            <PanelThemePicker panelKey="note" label="Note color" />
            <PanelThemePicker panelKey="highlight" label="Highlight color" />
          </div>
        </ItemMenu>
      }
      items={sortedCards}
      getId={(c) => c.id}
      selectedId={selectedNoteId}
      onSelect={onSelectNote}
      emptyState={
        <div className={PANEL.empty}>
          No notes or highlights yet. Select text and click the highlighter
          button, or click + to create a note.
        </div>
      }
      aiRequests={myAiRequests}
      onUpdateAiRequestText={onUpdateAiRequestText}
      onDeleteAiRequest={onDeleteAiRequest}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      showDropPlaceholder={isDragOver}
      renderCard={(card, { selected }) => {
        if (card.kind === "highlight") {
          return (
            <HighlightCard
              card={card}
              selected={selected}
              onAddNote={onAddNoteForHighlight}
              onSetAiRequest={onSetHighlightAiRequest}
              onDelete={onDelete}
              onSelect={onSelectNote}
              onJump={
                onJumpToCard && getLinkedParagraphIds(card).length > 0
                  ? (sourceEl) => onJumpToCard(card, sourceEl)
                  : undefined
              }
            />
          );
        }
        return (
          <NoteCard
            note={card}
            selected={selected}
            onUpdate={onUpdate}
            onUpdateTitle={onUpdateTitle}
            onSetAiRequest={onSetNoteAiRequest}
            onDelete={onDelete}
            onSelect={onSelectNote}
            onJump={
              onJumpToCard && getLinkedParagraphIds(card).length > 0
                ? (sourceEl) => onJumpToCard(card, sourceEl)
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
