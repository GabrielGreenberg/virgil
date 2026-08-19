"use client";

import type { Editor } from "@tiptap/react";
import type {
  RevisionCard,
  RevisionRequestCard as RevisionRequestCardData,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";
import { RevisionRequestCard } from "./RevisionRequestCard";
import { RevisionSuggestionCard } from "./RevisionSuggestionCard";

interface BuildArgs {
  cards: RevisionCard[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  jumpToCard: (card: RevisionCard, sourceEl?: HTMLElement | null) => void;
  resolveCardRows: CardAnchorResolver;
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
    const baseId =
      card.kind === "suggestion"
        ? cardPopKey("revision-suggestion", card.id)
        : cardPopKey("revision-comment", card.id);
    // ONE authority for "where is this card anchored?" — the same rows the
    // margin marker builder draws from (task 369). An unlinked revision card
    // is deliberately FREE by this panel's own rule.
    const rows = buildOmniAnchorRows(card, baseId, a.resolveCardRows, {
      unanchored: true,
    });
    const linked = rows.some((r) => r.anchorUuid != null);

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
            linked ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ) : (
        <RevisionRequestCard
          key={omniId}
          card={card as RevisionRequestCardData}
          selected={isSelected}
          editor={a.editor}
          onUpdateContent={a.updateCommentContent}
          onSetAiRequest={a.setCommentAiRequest}
          onConvert={a.convertCard}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            linked ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      );

    for (const row of rows) {
      const omniId = row.omniId;
      items.push({
        id: omniId,
        pos: row.pos,
        anchorUuid: row.anchorUuid,
        anchorState: row.anchorState,
        content: renderCard(omniId),
      });
    }
  }

  return items;
}
