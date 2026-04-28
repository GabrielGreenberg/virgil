"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { CutterCommentCard as CutterCommentCardData } from "@/lib/types";
import {
  CARD_THEMES,
  EditableCard,
  BadgeLabel,
  BadgeOrphaned,
  CardTargetIcon,
  startTextDrag,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { MIME_CUT } from "@/lib/marginalia";
import { cardPopKey } from "@/panels/panel-registry";

export function startCutterCommentDrag(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(
    MIME_CUT,
    JSON.stringify({ cardId, kind: "comment" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

export function CutterCommentCard({
  card,
  selected,
  onUpdate,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
}: {
  card: CutterCommentCardData;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const theme = useCardTheme("cut");
  const handleChange = useCallback(
    (json: JSONContent) => onUpdate(card.id, normalizeRichContent(json)),
    [card.id, onUpdate],
  );
  const isAnchored =
    getLinkedParagraphIds(card).length > 0 || hasTextAnchor(card);
  const isOrphaned = !isAnchored && !!card.selectedText;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-comment", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const headerContent = card.selectedText ? (
    <div className="flex-1 min-w-0 text-xs italic text-[var(--muted)] border-l-2 border-edge-subtle pl-2 truncate">
      &ldquo;{card.selectedText}&rdquo;
    </div>
  ) : undefined;

  const footer = (
    <div
      className="flex items-center justify-between gap-2 px-3 pb-2 pt-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-[var(--muted)] select-none">
        <input
          type="checkbox"
          checked={card.aiRequest}
          onChange={(e) => onSetAiRequest(card.id, e.target.checked)}
          className="cursor-pointer accent-[var(--accent)]"
        />
        <span>AI request</span>
      </label>
    </div>
  );

  const cardEl = (
    <EditableCard
      id={card.id}
      selected={selected}
      theme={theme}
      grabHandle
      hideToolbar
      inlineDelete
      badge={
        isOrphaned ? (
          <BadgeOrphaned theme={theme} />
        ) : (
          <BadgeLabel label="C" theme={CARD_THEMES.cut} />
        )
      }
      headerContent={headerContent}
      headerTrailing={
        onJump ? (
          <CardTargetIcon
            selected={selected}
            disabled={isOrphaned}
            onClick={(e) => {
              e.stopPropagation();
              if (!isOrphaned) onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
            }}
            title="Jump to text in document"
          />
        ) : (
          <CardTargetIcon selected={false} disabled onClick={() => {}} />
        )
      }
      footer={footer}
      onClick={() => onSelect(selected ? null : card.id)}
      onDragStart={(e) => startCutterCommentDrag(e, card.id)}
      onTextDragStart={(e) => startTextDrag(e, card.content, card.text)}
      onDelete={() => onDelete(card.id)}
      value={card.content}
      variant="note"
      panelKey="cut"
      placeholder="Comment text…"
      onChange={handleChange}
      dataAttr={{ name: "cutter-comment-entry", value: card.id }}
      extraDataAttrs={{
        "data-pristine-card-id": card.id,
        "data-card-key": cardKey,
      }}
      onHoverChange={onHoverChange}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
    />
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{cardEl}</FloatCard>;
  return cardEl;
}
