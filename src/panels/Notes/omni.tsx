"use client";

import type { JSONContent } from "@tiptap/react";
import type { NoteCardItem, UserNote } from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { NoteCard } from "./NoteCard";
import { HighlightCard } from "./HighlightCard";
import { getLinkedTextObjectIds } from "@/links/links";

interface BuildArgs {
  cards: NoteCardItem[];
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;
  jumpToCard: (card: NoteCardItem, sourceEl?: HTMLElement | null) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  updateNote: (id: string, content: JSONContent) => void;
  updateNoteTitle: (id: string, title: string) => void;
  setNoteAiRequest: (id: string, value: boolean) => void;
  setHighlightAiRequest: (id: string, value: boolean) => void;
  addNoteForHighlight: (id: string) => UserNote | null;
  deleteNote: (id: string) => void;
  setOverrideEditor: (editor: any) => void;
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string } | null;
}

export function buildNoteOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const card of a.cards) {
    const pids = getLinkedTextObjectIds(card);
    const isSelected = a.selectedNoteId === card.id;
    const baseId = cardPopKey(card.kind, card.id);

    const renderCard = (omniId: string, withJump: boolean) => {
      if (card.kind === "highlight") {
        return (
          <HighlightCard
            key={omniId}
            card={card}
            selected={isSelected}
            onAddNote={a.addNoteForHighlight}
            onSetAiRequest={a.setHighlightAiRequest}
            onDelete={a.deleteNote}
            onSelect={a.setSelectedNoteId}
            onJump={withJump ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined}
            extraDataAttrs={{ "data-omni-entry": omniId }}
          />
        );
      }
      return (
        <NoteCard
          key={omniId}
          note={card}
          selected={isSelected}
          onUpdate={a.updateNote}
          onUpdateTitle={a.updateNoteTitle}
          onSetAiRequest={a.setNoteAiRequest}
          onDelete={a.deleteNote}
          onSelect={a.setSelectedNoteId}
          onJump={withJump ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined}
          onEditorFocus={a.setOverrideEditor}
          getCitationDisplayText={a.getCitationDisplayText}
          onCitationCreated={a.onCitationCreated}
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      );
    };

    if (pids.length === 0) {
      items.push({ id: baseId, pos: null, content: renderCard(baseId, false) });
    } else {
      for (let pi = 0; pi < pids.length; pi++) {
        const pid = pids[pi];
        const pos = a.findParagraphPos(pid);
        const suffix = pids.length > 1 ? `@${pi}` : "";
        const omniId = `${baseId}${suffix}`;
        items.push({ id: omniId, pos, content: renderCard(omniId, true) });
      }
    }
  }

  return items;
}
