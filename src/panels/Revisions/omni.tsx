"use client";

import type { Editor } from "@tiptap/react";
import type {
  RevisionCard,
  RevisionCommentCard as RevisionCommentCardData,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { getLinkedParagraphIds } from "@/links/links";
import { RevisionCommentCard } from "./RevisionCommentCard";
import { RevisionSuggestionCard } from "./RevisionSuggestionCard";

interface BuildArgs {
  cards: RevisionCard[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  jumpToCard: (card: RevisionCard, sourceEl?: HTMLElement | null) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  editor: Editor | null;
  updateCommentContent: (id: string, content: import("@tiptap/react").JSONContent) => void;
  setCommentAiRequest: (id: string, value: boolean) => void;
  updateSuggestionField: (
    id: string,
    field:
      | "original_text"
      | "suggested_text"
      | "explanation"
      | "user_text"
      | "instructions",
    value: string,
  ) => void;
  acceptSuggestion: (id: string) => void;
  rejectSuggestion: (id: string) => void;
  convertCard: (id: string, toKind: "comment" | "suggestion") => void;
  deleteCard: (id: string) => void;
}

/** Build OmniItems for revision comments and suggestions. Items are
 *  anchored to each linked paragraph (one item per anchor), or surface
 *  unanchored if the card has no linked paragraph. */
export function buildRevisionOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const card of a.cards) {
    const isSelected = a.selectedId === card.id;
    const pids = getLinkedParagraphIds(card);
    const baseId =
      card.kind === "suggestion"
        ? cardPopKey("revision-suggestion", card.id)
        : cardPopKey("comment", card.id);

    const renderCard = (omniId: string) =>
      card.kind === "suggestion" ? (
        <RevisionSuggestionCard
          key={omniId}
          card={card as RevisionSuggestionCardData}
          selected={isSelected}
          onUpdateField={a.updateSuggestionField}
          onAccept={a.acceptSuggestion}
          onReject={a.rejectSuggestion}
          onConvert={a.convertCard}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            pids.length > 0
              ? (sourceEl) => a.jumpToCard(card, sourceEl)
              : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ) : (
        <RevisionCommentCard
          key={omniId}
          card={card as RevisionCommentCardData}
          selected={isSelected}
          editor={a.editor}
          onUpdateContent={a.updateCommentContent}
          onSetAiRequest={a.setCommentAiRequest}
          onConvert={a.convertCard}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            pids.length > 0
              ? (sourceEl) => a.jumpToCard(card, sourceEl)
              : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      );

    if (pids.length === 0) {
      items.push({ id: baseId, pos: null, content: renderCard(baseId) });
    } else {
      for (let pi = 0; pi < pids.length; pi++) {
        const pid = pids[pi];
        const pos = a.findParagraphPos(pid);
        const suffix = pids.length > 1 ? `@${pi}` : "";
        const omniId = `${baseId}${suffix}`;
        items.push({ id: omniId, pos, content: renderCard(omniId) });
      }
    }
  }

  return items;
}
