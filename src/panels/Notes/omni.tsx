"use client";

import type { JSONContent } from "@tiptap/react";
import type { NoteCardItem } from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { NoteCard } from "./NoteCard";
import { HighlightCard } from "./HighlightCard";
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";

interface BuildArgs {
  cards: NoteCardItem[];
  selectedNoteId: string | null;
  setSelectedNoteId: (id: string | null) => void;
  jumpToCard: (card: NoteCardItem, sourceEl?: HTMLElement | null) => void;
  resolveCardRows: CardAnchorResolver;
  updateNote: (id: string, content: JSONContent) => void;
  updateNoteTitle: (id: string, title: string) => void;
  setNoteAiRequest: (id: string, value: boolean) => void;
  setHighlightAiRequest: (id: string, value: boolean) => void;
  convertCard: (id: string, toKind: "note" | "highlight") => void;
  deleteNote: (id: string) => void;
  setOverrideEditor: (editor: any) => void;
  getCitationDisplayText: (command: string) => string;
  onCitationCreated: (command: string) => { id: string; displayText: string } | null;
}

export function buildNoteOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const card of a.cards) {
    const isSelected = a.selectedNoteId === card.id;
    const baseId = cardPopKey(card.kind, card.id);

    const renderCard = (omniId: string, withJump: boolean) => {
      if (card.kind === "highlight") {
        return (
          <HighlightCard
            key={omniId}
            card={card}
            selected={isSelected}
            onConvert={a.convertCard}
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
          onConvert={a.convertCard}
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

    // ONE authority for "where is this card anchored?" — the same rows the
    // margin marker builder draws from (task 369), so a card recovered by the
    // mark or snapshot rung is anchored in BOTH surfaces or neither. An
    // unlinked note is deliberately FREE by this panel's own rule.
    for (const row of buildOmniAnchorRows(card, baseId, a.resolveCardRows, {
      unanchored: true,
    })) {
      items.push({
        id: row.omniId,
        pos: row.pos,
        anchorUuid: row.anchorUuid,
        anchorState: row.anchorState,
        content: renderCard(row.omniId, row.anchorUuid != null),
      });
    }
  }

  return items;
}
