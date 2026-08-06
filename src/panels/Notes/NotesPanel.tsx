"use client";

import { useEffect, useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type {
  UserNote,
  HighlightCard as HighlightCardData,
  NoteCardItem,
} from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  useCycle,
} from "@/components/panel-primitives";
import { getLinkedTextObjectIds } from "@/links/links";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { cardTypeLabel } from "@/panels/panel-registry";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { NoteCard } from "./NoteCard";
import { HighlightCard } from "./HighlightCard";

interface NotesPanelProps {
  cards: NoteCardItem[];
  onAddNote: (anchorRect?: DOMRect) => UserNote;
  /** Returns null if no live selection (highlight requires a text range). */
  onAddHighlight?: (anchorRect?: DOMRect) => HighlightCardData | null;
  /** Morph note ⇄ highlight via the kind-chevron (R14, bidirectional). */
  onConvertCard: (id: string, toKind: "note" | "highlight") => void;
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
  onEditorFocus?: (editor: any) => void;
  recentlyAddedId?: string | null;
}

export default function NotesPanel({
  cards,
  onAddNote,
  onAddHighlight,
  onConvertCard,
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
  onEditorFocus,
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

  // "+" dropdown: lets the user explicitly pick which kind to create.
  const onAddOptions = useMemo(
    () => [
      { label: cardTypeLabel("note"), onClick: (rect?: DOMRect) => onAddNote(rect) },
      ...(onAddHighlight
        ? [{ label: cardTypeLabel("highlight"), onClick: (rect?: DOMRect) => onAddHighlight(rect) }]
        : []),
    ],
    [onAddNote, onAddHighlight],
  );

  return (
    <CardListPanel<NoteCardItem>
      kind="notes"
      onAddOptions={onAddOptions}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2 flex-col">
            <PanelThemePicker panelKey="note" label="Note color" />
            <PanelThemePicker panelKey="highlight" label="Highlight color" />
          </div>
          <CardViewModeMenuItems kind="notes" />
        </ItemMenu>
      }
      items={sortedCards}
      getId={(c) => c.id}
      getArchived={(c) => !!c.archived}
      selectedId={selectedNoteId}
      onSelect={onSelectNote}
      emptyState={
        <div className={PANEL.empty}>
          No notes or highlights yet. Select text and click the highlighter
          button, or click + to create a note.
        </div>
      }
      renderCard={(card, { selected }) => {
        if (card.kind === "highlight") {
          return (
            <HighlightCard
              card={card}
              selected={selected}
              onConvert={onConvertCard}
              onSetAiRequest={onSetHighlightAiRequest}
              onDelete={onDelete}
              onSelect={onSelectNote}
              onJump={
                onJumpToCard && getLinkedTextObjectIds(card).length > 0
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
            onConvert={onConvertCard}
            onSetAiRequest={onSetNoteAiRequest}
            onDelete={onDelete}
            onSelect={onSelectNote}
            onJump={
              onJumpToCard && getLinkedTextObjectIds(card).length > 0
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
