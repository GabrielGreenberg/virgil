"use client";

import type { Editor } from "@tiptap/react";
import type {
  CutterCard,
  CutterCommentCard as CutterCommentCardData,
  CutterSuggestionCard as CutterSuggestionCardData,
} from "@/lib/types";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import type { CardAnchorResolver } from "@/links/card-anchor-rows";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";
import { CutterCommentCard } from "./CutterCommentCard";
import { CutterSuggestionCard } from "./CutterSuggestionCard";

interface BuildArgs {
  cards: CutterCard[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  jumpToCard: (card: CutterCard, sourceEl?: HTMLElement | null) => void;
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

/** Build OmniItems for cutter comments and suggestions. Both kinds
 *  collapse to a single "Cutter" filter via `getPanelByCardKind`'s
 *  polymorphic-card mapping. */
export function buildCutterOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const card of a.cards) {
    const isSelected = a.selectedId === card.id;
    const baseId =
      card.kind === "suggestion"
        ? cardPopKey("cutter-suggestion", card.id)
        : cardPopKey("cutter-comment", card.id);
    // ONE authority for "where is this card anchored?" — the same rows the
    // margin marker builder draws from (task 369). An unlinked cutter card is
    // deliberately FREE by this panel's own rule.
    const rows = buildOmniAnchorRows(card, baseId, a.resolveCardRows, {
      unanchored: true,
    });
    const linked = rows.some((r) => r.anchorUuid != null);

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
            linked ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ) : (
        <CutterCommentCard
          key={omniId}
          card={card as CutterCommentCardData}
          selected={isSelected}
          editor={a.editor}
          onUpdateContent={a.updateCommentContent}
          onConvert={a.convertCard}
          onSetAiRequest={a.setCommentAiRequest}
          onDelete={a.deleteCard}
          onSelect={a.setSelectedId}
          onJump={
            linked ? (sourceEl) => a.jumpToCard(card, sourceEl) : undefined
          }
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      );

    for (const row of rows) {
      items.push({
        id: row.omniId,
        pos: row.pos,
        anchorUuid: row.anchorUuid,
        anchorState: row.anchorState,
        content: renderCard(row.omniId),
      });
    }
  }

  return items;
}
