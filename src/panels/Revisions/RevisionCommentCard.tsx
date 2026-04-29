"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { RevisionCommentCard as RevisionCommentCardData } from "@/lib/types";
import {
  BadgeLabel,
  BadgeOrphaned,
  CardTargetIcon,
  PanelCard,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import {
  getAnchorSummary,
  getLinkedParagraphIds,
  hasTextAnchor,
} from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { FloatCard } from "@/components/FloatingCards";
import { popKey } from "@/panels/panel-registry";
import { MIME_REVISION } from "./mime";
import { FieldTitleRow } from "@/panels/Cutter/CutterSuggestionCard";

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
  onUpdateText,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  editor,
}: {
  card: RevisionCommentCardData;
  selected: boolean;
  onUpdateText: (id: string, text: string) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  editor?: Editor | null;
}) {
  const theme = useCardTheme("revision");
  const revisionBodyStyle = usePanelBodyStyle("revision");
  const cardRef = useRef<HTMLDivElement>(null);
  const isAnchored =
    getLinkedParagraphIds(card).length > 0 || hasTextAnchor(card);
  const isOrphaned = !isAnchored && !!card.selectedText;
  const anchorSummary = getAnchorSummary(card, editor ?? null);
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [commentExpanded, setCommentExpanded] = useState(!!card.text);
  const [originalFolded, setOriginalFolded] = useState(false);
  const [commentFolded, setCommentFolded] = useState(false);
  useEffect(() => {
    if (selected && commentExpanded && !card.text) taRef.current?.focus();
  }, [selected, commentExpanded, card.text]);

  const cardEl = (
    <PanelCard
      ref={cardRef}
      data-revision-comment-entry={card.id}
      data-card-key={cardKey}
      data-pristine-card-id={card.id}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      onTrashClick={() => onDelete(card.id)}
      draggable={!selected}
      onDragStart={(e) => startRevisionCommentDrag(e, card.id)}
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : card.id);
      }}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      onKeyDown={(e) => {
        if (!selected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(card.id);
        }
      }}
      className="focus:outline-none mb-2"
    >
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: selected ? theme.headerSelected : theme.headerDefault }}
      >
        {isOrphaned ? (
          <BadgeOrphaned theme={theme} />
        ) : (
          <BadgeLabel label="C" theme={theme} />
        )}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">
            Comment
          </span>
        </div>
        {onJump && (
          <CardTargetIcon
            selected={selected}
            disabled={!isAnchored || isOrphaned}
            onClick={(e) => {
              e.stopPropagation();
              if (isAnchored && !isOrphaned)
                onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
            }}
            title={
              isOrphaned
                ? "No anchor in document"
                : isAnchored
                  ? "Jump to text in document"
                  : "Not anchored in document"
            }
          />
        )}
      </div>

      <div
        className={`border-t transition-colors ${selected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={selected ? { borderTopColor: theme.separatorSelected } : undefined}
      />

      <div
        className={`px-3 pt-2 pb-2 space-y-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {card.selectedText && (
          <div>
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
        )}

        {!card.text && !commentExpanded ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setCommentExpanded(true);
            }}
            className="text-[10px] text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1 py-0.5 hover-on-light"
          >
            + comment
          </button>
        ) : (
          <div>
            <FieldTitleRow
              label="Comment"
              text={card.text}
              showCopy={false}
              showWordCount={false}
              folded={commentFolded}
              onToggleFold={() => setCommentFolded((f) => !f)}
            />
            {!commentFolded && (
              <textarea
                ref={taRef}
                value={card.text}
                onChange={(e) => onUpdateText(card.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="Comment text…"
                style={revisionBodyStyle}
                className="w-full bg-surface border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[48px]"
                rows={3}
              />
            )}
          </div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSetAiRequest(card.id, !card.aiRequest);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 text-[11px] text-ink-subtle cursor-pointer select-none bg-transparent p-0"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
            <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" fill="none" />
            {card.aiRequest && (
              <path d="M4.5 8l2.5 2.5 4.5-5" stroke="#0369a1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            )}
          </svg>
          AI request
        </button>
      </div>
    </PanelCard>
  );

  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{cardEl}</FloatCard>;
  return cardEl;
}
