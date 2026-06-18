"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { CutterCommentCard as CutterCommentCardData } from "@/lib/types";
import {
  AiRequestCheckbox,
  EditableCard,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import {
  getAnchorSummary,
  getLinkedTextObjectIds,
  hasTextAnchor,
} from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { cardPopKey } from "@/panels/panel-registry";
import { cardKindsForPanel, bodyVariantForCardKind } from "@/cards/predicates";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { normalizeRichContent } from "@/lib/footnote-content";
import { FieldTitleRow } from "./CutterSuggestionCard";

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
  onConvert?: (id: string, toKind: "comment" | "suggestion") => void;
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
  const theme = useCardTheme("cut");
  const isAnchored =
    getLinkedTextObjectIds(card).length > 0 || hasTextAnchor(card);
  const isOrphaned = !isAnchored && !!card.selectedText;
  const anchorSummary = getAnchorSummary(card, editor ?? null);
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-comment", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const [originalFolded, setOriginalFolded] = useState(false);
  const ac = useAnchoredCard({ kind: "cutter-comment", id: card.id });
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  // The cut excerpt is the cutter card's distinctive compressed cue — show it
  // (red italic) when present, falling back to the rich-text body summary.
  const compressedSummary = compressed
    ? card.selectedText
      ? (
          <span className="text-red-700/80 italic">
            &quot;{card.selectedText.replace(/\s+/g, " ").trim()}&quot;
          </span>
        )
      : (makeCompressedSummary(card.content, compressedLines) || undefined)
    : undefined;

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdateContent(card.id, normalizeRichContent(json));
    },
    [card.id, onUpdateContent],
  );

  // Focus the body when a brand-new (empty) card is selected — mirrors the
  // textarea autofocus the old chrome did.
  useEffect(() => {
    if (!isSelected) return;
    if (card.text) return;
    const el = document.querySelector<HTMLElement>(
      `[data-pristine-card-id="${card.id}"] [contenteditable="true"]`,
    );
    el?.focus();
  }, [isSelected, card.id, card.text]);

  // The one structural element unique to cutter comments: the excised text,
  // rendered as an "Original" section ABOVE the comment body (via EditableCard's
  // additive `aboveBody` slot). Styled in the suggestion-card "Original" dialect
  // (FieldTitleRow + the red danger-soft block) for cross-panel consistency.
  const excerptBlock = card.selectedText ? (
    <div className="mb-2">
      <FieldTitleRow
        label="Original"
        kindHint={anchorSummary?.kind ?? null}
        text={card.selectedText}
        showCopy={true}
        showWordCount={true}
        folded={originalFolded}
        onToggleFold={() => setOriginalFolded((f) => !f)}
      />
      {!originalFolded && (
        <div className="bg-danger-soft border border-red-200 rounded px-2 py-1.5 text-xs text-red-700 whitespace-pre-wrap break-words">
          {card.selectedText}
        </div>
      )}
    </div>
  ) : undefined;

  const cardEl = (
    <EditableCard
      id={card.id}
      cardKind="cutter-comment"
      kind="cutter-comment"
      kindOptions={onConvert ? cardKindsForPanel("cutter") : undefined}
      onKindChange={
        onConvert
          ? (k) => {
              if (k !== "cutter-comment") onConvert(card.id, "suggestion");
            }
          : undefined
      }
      selected={isSelected}
      theme={theme}
      hideToolbar
      inlineDelete
      canJump={isAnchored && !isOrphaned && !!onJump}
      onJump={
        onJump && isAnchored && !isOrphaned
          ? (e) =>
              onJump(
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
          jump: onJump && isAnchored && !isOrphaned ? () => onJump(el) : undefined,
        });
      }}
      onDelete={() => onDelete(card.id)}
      aboveBody={excerptBlock}
      footer={
        !compressed ? (
          <div className="px-3 pb-2 -mt-1">
            <AiRequestCheckbox
              checked={card.aiRequest}
              onToggle={(next) => onSetAiRequest(card.id, next)}
            />
          </div>
        ) : undefined
      }
      value={card.content}
      variant={bodyVariantForCardKind("cutter-comment")}
      panelKey="cut"
      placeholder="Comment text…"
      onChange={handleChange}
      dataAttr={{ name: "cutter-comment-entry", value: card.id }}
      extraDataAttrs={{
        "data-pristine-card-id": card.id,
        "data-card-key": cardKey,
        ...(extraDataAttrs || {}),
      }}
      onHoverChange={(h) => {
        cardStore.setHover(h ? ac.ref : null);
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
