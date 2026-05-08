"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { CutterCommentCard as CutterCommentCardData } from "@/lib/types";
import {
  AiRequestCheckbox,
  BadgeLabel,
  BadgeOrphaned,
  CardDragHandle,
  CardTargetIcon,
  CardTypeLabel,
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
import { useTabIndent } from "@/hooks/useTabIndent";
import { FloatCard } from "@/components/FloatingCards";
import { cardPopKey } from "@/panels/panel-registry";
import { MIME_CUT } from "@/lib/marginalia";
import { FieldTitleRow } from "./CutterSuggestionCard";
import { useCardClaim, useCollabContext } from "@/hooks/useCollab";
import CollabClaimPill from "@/components/CollabClaimPill";
import CollabPresenceDots from "@/components/CollabPresenceDots";

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
  card: CutterCommentCardData;
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
  const theme = useCardTheme("cut");
  const cutBodyStyle = usePanelBodyStyle("cut");
  const cardRef = useRef<HTMLDivElement>(null);
  const isAnchored =
    getLinkedParagraphIds(card).length > 0 || hasTextAnchor(card);
  const isOrphaned = !isAnchored && !!card.selectedText;
  const anchorSummary = getAnchorSummary(card, editor ?? null);
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-comment", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();
  const [commentExpanded, setCommentExpanded] = useState(!!card.text);
  const [originalFolded, setOriginalFolded] = useState(false);
  const [commentFolded, setCommentFolded] = useState(false);
  const compressed = !selected && !isPoppedOut;
  const { partnerClaim, claim, release } = useCardClaim("cut", card.id);
  const collabCtx = useCollabContext();
  const partnerSelections = collabCtx.getCardSelections("cut", card.id);
  useEffect(() => {
    if (selected && commentExpanded && !card.text) taRef.current?.focus();
  }, [selected, commentExpanded, card.text]);

  const cardEl = (
    <PanelCard
      ref={cardRef}
      data-cutter-comment-entry={card.id}
      data-card-key={cardKey}
      data-pristine-card-id={card.id}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onTrashClick={() => onDelete(card.id)}
      draggable={!selected}
      onDragStart={(e) => startCutterCommentDrag(e, card.id)}
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
        <CardDragHandle />
        {isOrphaned ? (
          <BadgeOrphaned theme={theme} />
        ) : (
          <BadgeLabel label="C" theme={theme} />
        )}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <CardTypeLabel kind="cutter-comment" />
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
        {partnerClaim ? (
          <CollabClaimPill holder={partnerClaim.holder} color={partnerClaim.color} />
        ) : (
          <CollabPresenceDots presences={partnerSelections} />
        )}
      </div>

      <div
        className={`border-t transition-colors ${selected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={selected ? { borderTopColor: theme.separatorSelected } : undefined}
      />

      {compressed ? (
        <div
          className="px-3 pt-1 pb-1.5 text-xs truncate"
          style={
            partnerClaim
              ? { opacity: 0.55, filter: "saturate(0.7)" }
              : undefined
          }
        >
          {card.selectedText ? (
            <span className="text-red-700/80 italic">"{card.selectedText.replace(/\s+/g, " ").trim()}"</span>
          ) : card.text ? (
            <span className="text-ink-subtle">{card.text.replace(/\s+/g, " ").trim()}</span>
          ) : (
            <span className="text-ink-faint italic">empty comment</span>
          )}
        </div>
      ) : (
      <div
        className={`px-3 pt-2 pb-2 space-y-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
        onClick={(e) => e.stopPropagation()}
        style={
          partnerClaim
            ? { opacity: 0.55, pointerEvents: "none", filter: "saturate(0.7)" }
            : undefined
        }
        title={partnerClaim ? `${partnerClaim.holder} is editing this card` : undefined}
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
                onFocus={() => claim()}
                onBlur={() => release()}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={onTextareaKeyDown}
                placeholder="Comment text…"
                style={cutBodyStyle}
                className="w-full bg-surface border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[48px]"
                rows={3}
              />
            )}
          </div>
        )}

        <AiRequestCheckbox
          checked={card.aiRequest}
          onToggle={(next) => onSetAiRequest(card.id, next)}
        />
      </div>
      )}
    </PanelCard>
  );

  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{cardEl}</FloatCard>;
  return cardEl;
}
