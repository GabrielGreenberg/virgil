"use client";

import type { Editor } from "@tiptap/react";
import type {
  CutterCard,
  CutterCommentCard as CutterCommentCardData,
  CutterSuggestionCard as CutterSuggestionCardData,
} from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { getLinkedTextObjectIds } from "@/links/links";
import { CutterCommentCard } from "./CutterCommentCard";
import { CutterSuggestionCard } from "./CutterSuggestionCard";

interface BuildArgs {
  cards: CutterCard[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  jumpToCard: (card: CutterCard, sourceEl?: HTMLElement | null) => void;
  findParagraphPos: (uuid: string | null) => number | null;
  editor: Editor | null;
  updateCommentText: (id: string, text: string) => void;
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

/** Build OmniItems for cutter comments and suggestions. Both kinds
 *  collapse to a single "Cutter" filter via `getPanelByCardKind`'s
 *  polymorphic-card mapping. */
export function buildCutterOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const card of a.cards) {
    const isSelected = a.selectedId === card.id;
    const pids = getLinkedTextObjectIds(card);
    const baseId =
      card.kind === "suggestion"
        ? cardPopKey("cutter-suggestion", card.id)
        : cardPopKey("cutter-comment", card.id);

    const renderCard = (omniId: string) =>
      card.kind === "suggestion" ? (
        <CutterSuggestionCard
          key={omniId}
          card={card as CutterSuggestionCardData}
          selected={isSelected}
          onUpdateField={a.updateSuggestionField}
          onConvert={a.convertCard}
          onAccept={a.acceptSuggestion}
          onReject={a.rejectSuggestion}
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
        <CutterCommentCard
          key={omniId}
          card={card as CutterCommentCardData}
          selected={isSelected}
          editor={a.editor}
          onUpdateText={a.updateCommentText}
          onConvert={a.convertCard}
          onSetAiRequest={a.setCommentAiRequest}
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
