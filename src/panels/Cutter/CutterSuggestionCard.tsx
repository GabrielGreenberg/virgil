"use client";

import type { CutterSuggestionCard as CutterSuggestionCardData } from "@/lib/types";
import {
  Button,
  CARD_THEMES,
  CardTargetIcon,
  themedCard,
  themedCardStyle,
} from "@/components/panel-primitives";
import { getLinkedParagraphIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { cardPopKey } from "@/panels/panel-registry";
import { MIME_CUT } from "@/lib/marginalia";

const STATUS_DOT: Record<CutterSuggestionCardData["status"], string> = {
  pending: "bg-blue-400",
  accepted: "bg-emerald-500",
  rejected: "bg-red-400",
};

const STATUS_LABEL: Record<CutterSuggestionCardData["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function startCutterSuggestionDrag(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(
    MIME_CUT,
    JSON.stringify({ cardId, kind: "suggestion" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

export function CutterSuggestionCard({
  card,
  selected,
  onUpdateField,
  onAccept,
  onReject,
  onDelete,
  onSelect,
  onJump,
  onTogglePopout,
  isPoppedOut,
}: {
  card: CutterSuggestionCardData;
  selected: boolean;
  onUpdateField: (
    id: string,
    field: "original_text" | "suggested_text" | "explanation",
    value: string,
  ) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const theme = CARD_THEMES.cutterSuggestion;
  const isPending = card.status === "pending";
  const isAnchored =
    getLinkedParagraphIds(card).length > 0 || hasTextAnchor(card);
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-suggestion", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const dot = (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[card.status]}`}
      title={STATUS_LABEL[card.status]}
    />
  );

  const cardEl = (
    <div
      data-cutter-suggestion-entry={card.id}
      data-card-key={cardKey}
      data-pristine-card-id={card.id}
      draggable={!selected}
      onDragStart={(e) => startCutterSuggestionDrag(e, card.id)}
      className={`${themedCard(theme, selected)} overflow-hidden cursor-pointer mb-2`}
      style={themedCardStyle(theme, selected)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : card.id);
      }}
      onDoubleClick={(e) => {
        if (!onToggleFromCtx) return;
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onToggleFromCtx(r);
      }}
    >
      {!selected ? (
        <div className="px-3 py-2 flex items-center gap-2">
          {dot}
          <span className="flex-1 min-w-0 text-xs text-ink-body truncate">
            {card.explanation || card.suggested_text || (
              <span className="italic text-ink-muted">Empty suggestion</span>
            )}
          </span>
          <span className="text-[10px] text-ink-muted whitespace-nowrap">
            {STATUS_LABEL[card.status]}
          </span>
        </div>
      ) : (
        <div
          className="p-3 space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            {dot}
            <span className="flex-1 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">
              Suggestion
            </span>
            <span className="text-[10px] text-ink-muted">
              {STATUS_LABEL[card.status]}
            </span>
            {onJump && (
              <CardTargetIcon
                selected={selected}
                disabled={!isAnchored}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isAnchored) onJump();
                }}
                title={
                  isAnchored
                    ? "Jump to text in document"
                    : "Not anchored in document"
                }
              />
            )}
          </div>

          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium mb-1">
              Original
            </div>
            <textarea
              value={card.original_text}
              onChange={(e) =>
                onUpdateField(card.id, "original_text", e.target.value)
              }
              placeholder="Target text…"
              className="w-full bg-danger-soft border border-red-200 rounded px-2 py-1.5 text-xs text-red-700 placeholder:text-red-300 focus:outline-none focus:border-red-400 resize-none min-h-[36px]"
              rows={2}
            />
          </div>

          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium mb-1">
              Suggested
            </div>
            <textarea
              value={card.suggested_text}
              onChange={(e) =>
                onUpdateField(card.id, "suggested_text", e.target.value)
              }
              placeholder="Replacement text…"
              className="w-full bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 text-xs text-emerald-800 placeholder:text-emerald-400 focus:outline-none focus:border-emerald-400 resize-none min-h-[36px]"
              rows={2}
            />
          </div>

          <div>
            <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium mb-1">
              Explanation
            </div>
            <textarea
              value={card.explanation}
              onChange={(e) =>
                onUpdateField(card.id, "explanation", e.target.value)
              }
              placeholder="Why this change…"
              className="w-full bg-surface border border-[var(--border)] rounded px-2 py-1.5 text-xs text-ink-strong placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]"
              rows={2}
            />
          </div>

          {isPending && (
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(card.id);
                }}
              >
                Delete
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(card.id);
                }}
              >
                Reject
              </Button>
              <Button
                variant="warm"
                size="sm"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(card.id);
                }}
              >
                Accept
              </Button>
            </div>
          )}
          {!isPending && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(card.id);
                }}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{cardEl}</FloatCard>;
  return cardEl;
}
