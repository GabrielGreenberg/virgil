"use client";

import { dockedKeyboardJump, type DockedJumpGate } from "@/links/card-anchor-rows";
import type { CardMorphHandler } from "@/cards/types";
import { useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type {
  UserNote,
  HighlightCard as HighlightCardData,
  NoteCardItem,
} from "@/lib/types";
import {
  ItemMenu,
  PANEL,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CreationHint } from "@/panels/_shared/CreationHint";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { cardTypeLabel } from "@/panels/panel-registry";
import { byCreatedAt, withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { NoteCard } from "./NoteCard";
import { HighlightCard } from "./HighlightCard";

interface NotesPanelProps {
  cards: NoteCardItem[];
  onAddNote: (anchorRect?: DOMRect) => UserNote;
  /** Returns null if no live selection (highlight requires a text range). */
  onAddHighlight?: (anchorRect?: DOMRect) => HighlightCardData | null;
  /** Morph note ⇄ highlight via the kind-chevron (R14, bidirectional). */
  onConvertCard: CardMorphHandler;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onSetNoteAiRequest: (id: string, value: boolean) => void;
  onSetHighlightAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelectNote: (id: string | null) => void;
  selectedNoteId: string | null;
  onJumpToCard?: (card: NoteCardItem, sourceEl?: HTMLElement | null) => void;
  /** Task 699: the ONE Jump gate (`cardJumpGate` over the pane's shared
   *  anchor pass). Required so no docked panel can fall back to gating Jump on
   *  "the card stores a link". */
  jumpGate: DockedJumpGate;
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
  jumpGate,
  getCitationDisplayText,
  onCitationCreated,
  onEditorFocus,
  recentlyAddedId,
}: NotesPanelProps) {
  const sortedCards = useMemo(
    () => {
      const out = [...cards].sort(byCreatedAt);
      return withRecentlyAddedFirst(out, recentlyAddedId, (c) => c.id);
    },
    [cards, recentlyAddedId],
  );

  // Keyboard activation (task 964): the shell selects; this jumps through the
  // card's own gate, the twin of its Jump button — a dead anchor selects
  // without a no-op navigation (task 699).
  const keyboardJump = useMemo(
    () => dockedKeyboardJump(jumpGate, onJumpToCard),
    [jumpGate, onJumpToCard],
  );
  const getNoteArchived = useCallback((c: NoteCardItem) => !!c.archived, []);

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
      getArchived={getNoteArchived}
      selectedId={selectedNoteId}
      onSelect={onSelectNote}
      onActivateItem={keyboardJump}
      emptyState={
        <div className={PANEL.empty}>
          No notes or highlights yet.
          <CreationHint action="note" />
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
                onJumpToCard
                  ? jumpGate(card).withJump((sourceEl?: HTMLElement | null) => onJumpToCard(card, sourceEl))
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
              onJumpToCard
                ? jumpGate(card).withJump((sourceEl?: HTMLElement | null) => onJumpToCard(card, sourceEl))
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
