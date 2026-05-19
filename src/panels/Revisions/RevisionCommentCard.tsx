"use client";

import { useCallback, useEffect } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { RevisionCommentCard as RevisionCommentCardData } from "@/lib/types";
import {
  AiRequestCheckbox,
  EditableCard,
  makeCompressedSummary,
  startTextDrag,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { normalizeRichContent } from "@/lib/footnote-content";
import { MIME_REVISION } from "./mime";

export function startRevisionCommentDrag(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(
    MIME_REVISION,
    JSON.stringify({ cardId, kind: "comment" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

export function RevisionCommentCard({
  card,
  selected,
  onUpdateContent,
  onSetAiRequest,
  onConvert,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  editor,
  extraDataAttrs,
}: {
  card: RevisionCommentCardData;
  selected: boolean;
  onUpdateContent: (id: string, content: JSONContent) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onConvert: (id: string, toKind: "comment" | "suggestion") => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  editor?: Editor | null;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardTheme("revision");
  const isAnchored =
    getLinkedParagraphIds(card).length > 0 || hasTextAnchor(card);
  const isOrphaned = !isAnchored && !!card.selectedText;
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const ac = useAnchoredCard({ kind: "comment", id: card.id });
  const isExpanded = ac.expanded || selected;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  const compressedSummary = compressed
    ? (makeCompressedSummary(card.content, compressedLines) || "")
    : undefined;

  void editor;
  void isOrphaned;

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdateContent(card.id, normalizeRichContent(json));
    },
    [card.id, onUpdateContent],
  );

  // Focus the body when a brand-new (empty) card is selected — mirrors the
  // textarea autofocus the old chrome did. Keeps the "click + → start
  // typing" path snappy.
  useEffect(() => {
    if (!isSelected) return;
    if (card.text) return;
    const el = document.querySelector<HTMLElement>(
      `[data-pristine-card-id="${card.id}"] [contenteditable="true"]`,
    );
    el?.focus();
  }, [isSelected, card.id, card.text]);

  const cardEl = (
    <EditableCard
      id={card.id}
      cardKind="comment"
      kind="comment"
      kindOptions={["comment", "suggestion"]}
      onKindChange={(k) => {
        if (k !== "comment") onConvert(card.id, k as "suggestion");
      }}
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
        cardStore.toggleSelection(ac.ref);
        if (!cardStore.isExpanded(ac.ref)) return;
        onSelect(card.id);
        if (onJump && isAnchored && !isOrphaned) {
          onJump(
            (e?.currentTarget as HTMLElement | undefined)?.closest(
              "[data-card]",
            ) as HTMLElement | null,
          );
        }
      }}
      onTextDragStart={(e) => startTextDrag(e, card.content, card.text)}
      onDelete={() => onDelete(card.id)}
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
      variant="footnote"
      panelKey="revision"
      placeholder="Comment text…"
      onChange={handleChange}
      dataAttr={{ name: "revision-comment-entry", value: card.id }}
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
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{cardEl}</FloatCard>;
  return cardEl;
}
