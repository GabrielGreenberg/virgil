"use client";

import { useCallback } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { CutterCommentCard as CutterCommentCardData } from "@/lib/types";
import {
  EditableCard,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import {
  getAnchorSummary,
  isCardAnchored,
} from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { cardBodyPlaceholder, cardPopKey } from "@/panels/panel-registry";
import { bodyVariantForCardKind } from "@/cards/predicates";
import { morphOptionsFor } from "@/cards/card-registry";
import type { CardMorphHandler } from "@/cards/types";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import { normalizeRichContent } from "@/lib/footnote-content";
import { useExcerptCue } from "@/panels/_shared/suggestion-fields";

export function CutterCommentCard({
  card,
  selected,
  onUpdateContent,
  onConvert,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  editor,
  extraDataAttrs,
}: {
  card: CutterCommentCardData;
  selected: boolean;
  onUpdateContent: (id: string, content: JSONContent) => void;
  /** Morph comment ⇄ suggestion via the kind-chevron. */
  onConvert?: CardMorphHandler;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  editor?: Editor | null;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardKindTheme("cutter-comment");
  // The jump target exists iff the card is anchored (task 961: the old
  // `&& !isOrphaned` conjunct was dead — an orphan is un-anchored by definition).
  const jumpTo = isCardAnchored(card) ? onJump : undefined;
  const anchorSummary = getAnchorSummary(card, editor ?? null);
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-comment", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const ac = useAnchoredCard({ kind: "cutter-comment", id: card.id });
  const cardStore = useCardStore();
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  // The captured-selection excerpt cue (SSOT for both comment cards). The cut
  // excerpt is the cutter card's distinctive compressed cue — show it (red
  // italic) when present, falling back to the rich-text body summary.
  const { excerptBlock, compressedExcerpt } = useExcerptCue({
    selectedText: card.selectedText,
    selectedContent: card.selectedContent,
    kindHint: anchorSummary?.kind ?? null,
  });
  const compressedSummary = compressed
    ? (compressedExcerpt ??
      (makeCompressedSummary(card.content, compressedLines) || undefined))
    : undefined;

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdateContent(card.id, normalizeRichContent(json));
    },
    [card.id, onUpdateContent],
  );

  // (Caret-into-body on create is now owned centrally by `finishCreate` →
  // `focusNewCard` (CHIP B). The hand-rolled select+empty focus effect that
  // used to live here is removed — the chokepoint expands + focuses the body
  // for every editable-body kind at creation, so this per-kind workaround is
  // redundant.)

  const cardEl = (
    <EditableCard
      id={card.id}
      cardKind="cutter-comment"
      kind="cutter-comment"
      kindOptions={onConvert ? morphOptionsFor("cutter-comment") : undefined}
      onKindChange={
        onConvert ? (k) => onConvert("cutter-comment", card.id, k) : undefined
      }
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      canJump={!!jumpTo}
      onJump={
        jumpTo
          ? (e) =>
              jumpTo(
                (e.currentTarget as HTMLElement).closest(
                  "[data-card]",
                ) as HTMLElement | null,
              )
          : undefined
      }
      onClick={(e) => {
        const el = (e?.currentTarget as HTMLElement | undefined)?.closest(
          "[data-card]",
        ) as HTMLElement | null;
        ac.onBodyActivate({
          onSelect: () => onSelect(card.id),
          jump: jumpTo ? () => jumpTo(el) : undefined,
        });
      }}
      onDelete={() => onDelete(card.id)}
      aboveBody={excerptBlock}
      aiRequest={{ checked: card.aiRequest, onToggle: (next) => onSetAiRequest(card.id, next) }}
      value={card.content}
      variant={bodyVariantForCardKind("cutter-comment")}
      panelKey="cut"
      placeholder={cardBodyPlaceholder("cutter-comment")}
      onChange={handleChange}
      dataAttr={{ name: "cutter-comment-entry", value: card.id }}
      extraDataAttrs={{
        "data-pristine-card-id": card.id,
        "data-card-key": cardKey,
        ...(extraDataAttrs || {}),
      }}
      onHoverChange={(h) => {
        cardStore.setHoverFor(ac.ref, h);
        onHoverChange?.(h);
      }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
    />
  );

  return cardEl;
}
