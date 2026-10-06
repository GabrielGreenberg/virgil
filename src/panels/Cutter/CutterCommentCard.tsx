"use client";

import { useCallback } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { CutterCommentCard as CutterCommentCardData } from "@/lib/types";
import {
  EditableCard,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { getAnchorSummary } from "@/links/links";
import { cardBodyPlaceholder } from "@/panels/panel-registry";
import { bodyVariantForCardKind } from "@/cards/predicates";
import { morphOptionsFor } from "@/cards/card-registry";
import type { CardMorphHandler } from "@/cards/types";
import { useAnchoredCardShell } from "@/panels/_shared/useAnchoredCardShell";
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
  isPoppedOut?: boolean;
  editor?: Editor | null;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardKindTheme("cutter-comment");
  const anchorSummary = getAnchorSummary(card, editor ?? null);
  const { ac, compressed, compressedLines, shell } = useAnchoredCardShell({
    kind: "cutter-comment",
    id: card.id,
    isPoppedOut,
    onSelect: () => onSelect(card.id),
  // Jump is gated ONCE, by the caller's `withJump` over the anchor authority
  // (task 966) — a card-side "stores a link" re-gate was a second answer.
    onJump,
  });
  const isSelected = ac.selected || selected;
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
      {...shell}
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
        ...(extraDataAttrs || {}),
      }}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );

  return cardEl;
}
