"use client";

import { useCallback } from "react";
import { bodyVariantForCardKind } from "@/cards/predicates";
import { morphOptionsFor } from "@/cards/card-registry";
import type { CardMorphHandler } from "@/cards/types";
import type { Editor, JSONContent } from "@tiptap/react";
import type { RevisionRequestCard as RevisionRequestCardData } from "@/lib/types";
import {
  EditableCard,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import {
  getAnchorSummary,
  isCardAnchored,
} from "@/links/links";
import { cardBodyPlaceholder } from "@/panels/panel-registry";
import { useAnchoredCardShell } from "@/panels/_shared/useAnchoredCardShell";
import { normalizeRichContent } from "@/lib/footnote-content";
import { useExcerptCue } from "@/panels/_shared/suggestion-fields";

export function RevisionRequestCard({
  card,
  selected,
  onUpdateContent,
  onSetAiRequest,
  onConvert,
  onDelete,
  onSelect,
  onJump,
  isPoppedOut,
  editor,
  extraDataAttrs,
}: {
  card: RevisionRequestCardData;
  selected: boolean;
  onUpdateContent: (id: string, content: JSONContent) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onConvert?: CardMorphHandler;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  isPoppedOut?: boolean;
  editor?: Editor | null;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardKindTheme("revision-comment");
  // The jump target exists iff the card is anchored (task 961: the old
  // `&& !isOrphaned` conjunct was dead — an orphan is un-anchored by definition).
  const jumpTo = isCardAnchored(card) ? onJump : undefined;
  const anchorSummary = getAnchorSummary(card, editor ?? null);
  const { ac, compressed, compressedLines, shell } = useAnchoredCardShell({
    kind: "revision-comment",
    id: card.id,
    isPoppedOut,
    onSelect: () => onSelect(card.id),
    onJump: jumpTo,
  });
  const isSelected = ac.selected || selected;
  // The captured-selection excerpt cue (SSOT for both comment cards). A
  // selection-anchored revision comment shows its excerpt (red italic) as the
  // compressed cue, falling back to the rich-text body summary.
  const { excerptBlock, compressedExcerpt } = useExcerptCue({
    selectedText: card.selectedText,
    selectedContent: card.selectedContent,
    kindHint: anchorSummary?.kind ?? null,
  });
  const compressedSummary = compressed
    ? (compressedExcerpt ??
      (makeCompressedSummary(card.content, compressedLines) || ""))
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
      cardKind="revision-comment"
      kind="revision-comment"
      kindOptions={onConvert ? morphOptionsFor("revision-comment") : undefined}
      onKindChange={
        onConvert ? (k) => onConvert("revision-comment", card.id, k) : undefined
      }
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      onDelete={() => onDelete(card.id)}
      aboveBody={excerptBlock}
      aiRequest={{ checked: card.aiRequest, onToggle: (next) => onSetAiRequest(card.id, next) }}
      value={card.content}
      variant={bodyVariantForCardKind("revision-comment")}
      panelKey="revision"
      placeholder={cardBodyPlaceholder("revision-comment")}
      onChange={handleChange}
      dataAttr={{ name: "revision-request-entry", value: card.id }}
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
