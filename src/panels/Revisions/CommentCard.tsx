"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { Comment } from "@/lib/types";
import {
  EditableCard,
  BadgeLabel,
  BadgeOrphaned,
  CardTargetIcon,
  startTextDrag,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { popKey } from "@/panels/panel-registry";

const CLAUDE_ID = "claude";
const ME_ID = "me";

function AiBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-medium"
      title="AI request"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 L13 10 L20 10 L14 14 L16 21 L12 17 L8 21 L10 14 L4 10 L11 10 Z" />
      </svg>
      AI
    </span>
  );
}

export interface CommentCardProps {
  comment: Comment;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  onUpdateContent: (id: string, content: JSONContent) => void;
  onSetAuthor: (id: string, authorId: string) => void;
  onDelete: (id: string) => void;
  registerRef?: (el: HTMLDivElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}

export function CommentCard({
  comment,
  selected,
  onSelect,
  onJump,
  onUpdateContent,
  onSetAuthor,
  onDelete,
  registerRef,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: CommentCardProps) {
  const theme = useCardTheme("revision");
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", comment.id);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);

  const isAiRequest = comment.authorId === CLAUDE_ID;
  const quotedText = comment.selectedText;
  const isAnchored = quotedText != null;
  const isOrphaned =
    isAnchored && getLinkedParagraphIds(comment).length === 0;

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdateContent(comment.id, normalizeRichContent(json));
    },
    [onUpdateContent, comment.id],
  );

  const handleToggleAi = useCallback(
    (checked: boolean) => {
      onSetAuthor(comment.id, checked ? CLAUDE_ID : ME_ID);
    },
    [onSetAuthor, comment.id],
  );

  const badge = isAiRequest ? (
    <AiBadge />
  ) : isAnchored && isOrphaned ? (
    <BadgeOrphaned theme={theme} />
  ) : (
    <BadgeLabel label="C" theme={theme} />
  );

  const headerContent = quotedText ? (
    <div className="flex-1 min-w-0 text-xs italic text-[var(--muted)] border-l-2 border-edge-subtle pl-2 truncate">
      &ldquo;{quotedText}&rdquo;
    </div>
  ) : undefined;

  const headerTrailing = isAnchored ? (
    <CardTargetIcon
      selected={selected}
      disabled={!onJump || isOrphaned}
      onClick={(e) => {
        e.stopPropagation();
        if (onJump && !isOrphaned) onJump();
      }}
      title="Jump to text in document"
    />
  ) : undefined;

  const footer = (
    <div
      className="flex items-center justify-between gap-2 px-3 pb-2 pt-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-[var(--muted)] select-none">
        <input
          type="checkbox"
          checked={isAiRequest}
          onChange={(e) => handleToggleAi(e.target.checked)}
          className="cursor-pointer accent-[var(--accent)]"
        />
        <span>AI request</span>
      </label>
    </div>
  );

  const card = (
    <EditableCard
      id={comment.id}
      selected={selected}
      theme={theme}
      grabHandle={false}
      hideToolbar={false}
      inlineDelete
      badge={badge}
      headerContent={headerContent}
      headerTrailing={headerTrailing}
      footer={footer}
      value={comment.content}
      variant="note"
      panelKey="revision"
      placeholder="Comment text…"
      onChange={handleChange}
      onDelete={() => onDelete(comment.id)}
      onClick={() => onSelect(selected ? null : comment.id)}
      onTextDragStart={(e) => startTextDrag(e, comment.content, comment.text)}
      onHoverChange={onHoverChange}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      dataAttr={isAnchored ? { name: "revision-entry", value: comment.id } : undefined}
      extraDataAttrs={{ "data-card-key": cardKey, ...(extraDataAttrs || {}) }}
      wrapperStyle={{}}
    />
  );

  return (
    <div ref={registerRef}>
      {isPoppedOut ? <FloatCard cardKey={cardKey}>{card}</FloatCard> : card}
    </div>
  );
}
