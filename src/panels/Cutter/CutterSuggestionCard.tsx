"use client";

import { useRef } from "react";
import type { CutterSuggestionCard as CutterSuggestionCardData } from "@/lib/types";
import {
  Button,
  CardEmptyText,
  PanelCard,
  compressedBodyStyle,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedTextObjectIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { cardPopKey } from "@/panels/panel-registry";
import { cardKindsForPanel } from "@/cards/predicates";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { MIME_CUT } from "@/lib/marginalia";
import {
  CopyButton,
  FIELD_ORDER,
  FieldBlock,
  FieldTitleRow,
  SuggestionTrailing,
  type SuggestionField,
} from "@/panels/_shared/suggestion-fields";

// Re-exported for backward compatibility — these now live in the shared
// suggestion-fields module (CutterCommentCard + RevisionSuggestionCard import
// them from here, and the Cutter barrel re-exports them).
export { CopyButton, FieldTitleRow };

export function startCutterSuggestionDrag(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(
    MIME_CUT,
    JSON.stringify({ cardId, kind: "suggestion" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

/** Status dot + author chip + status label — the cutter-suggestion header
 *  trailing, shown docked and (via the `toFloatable` factory) in `FloatChrome`. */
export function CutterSuggestionTrailing({
  card,
}: {
  card: CutterSuggestionCardData;
}) {
  return <SuggestionTrailing status={card.status} author={card.author} />;
}

export function CutterSuggestionCard({
  card,
  selected,
  onUpdateField,
  onConvert,
  onAccept,
  onReject,
  onDelete,
  onSelect,
  onJump,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: {
  card: CutterSuggestionCardData;
  selected: boolean;
  onUpdateField: (
    id: string,
    field: SuggestionField,
    value: string,
  ) => void;
  /** Morph suggestion ⇄ comment via the kind-chevron. */
  onConvert?: (id: string, toKind: "comment" | "suggestion") => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardTheme("cut");
  const cardRef = useRef<HTMLDivElement>(null);
  const isPending = card.status === "pending";
  const isAnchored =
    getLinkedTextObjectIds(card).length > 0 || hasTextAnchor(card);
  const anchorKind: "selection" | "paragraph" | null = hasTextAnchor(card)
    ? "selection"
    : getLinkedTextObjectIds(card).length > 0
      ? "paragraph"
      : null;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-suggestion", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);
  const ac = useAnchoredCard({ kind: "cutter-suggestion", id: card.id });
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  const cardBodyStyle = usePanelBodyStyle("cut");

  const cardEl = (
    <PanelCard
      ref={cardRef}
      data-cutter-suggestion-entry={card.id}
      data-card-key={cardKey}
      data-pristine-card-id={card.id}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={isSelected}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
      onTrashClick={() => onDelete(card.id)}
      draggable={!isSelected}
      onDragStart={(e) => startCutterSuggestionDrag(e, card.id)}
      tabIndex={isSelected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        ac.onActivate();
        onSelect(card.id);
        if (isAnchored && onJump) {
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
        }
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
      }}
      onKeyDown={(e) => {
        if (!isSelected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(card.id);
        }
      }}
      className="focus:outline-none mb-2"
      kind="cutter-suggestion"
      kindOptions={onConvert ? cardKindsForPanel("cutter") : undefined}
      onKindChange={
        onConvert
          ? (k) => {
              if (k !== "cutter-suggestion") onConvert(card.id, "comment");
            }
          : undefined
      }
      canJump={isAnchored && !!onJump}
      onJump={(e) => {
        if (onJump && isAnchored)
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      headerTrailing={<CutterSuggestionTrailing card={card} />}
    >
      {compressed ? (
        <div className="px-3 pt-1.5 pb-1.5">
          <div style={{ ...cardBodyStyle, ...compressedBodyStyle(compressedLines) }}>
            {card.suggested_text ? (
              <span className="text-emerald-700/90">{card.suggested_text.replace(/\s+/g, " ").trim()}</span>
            ) : card.original_text ? (
              <span className="text-ink-subtle">→ <span className="text-red-700/70 italic">{card.original_text.replace(/\s+/g, " ").trim()}</span></span>
            ) : (
              <CardEmptyText label="empty suggestion" />
            )}
          </div>
        </div>
      ) : (
      <div
        className={`px-3 pt-2 pb-2 space-y-2.5${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {FIELD_ORDER.map((field) => (
          <FieldBlock
            key={field}
            field={field}
            value={card[field]}
            onChange={(v) => onUpdateField(card.id, field, v)}
            readOnly={
              field === "original_text" ||
              (card.author === "ai" && field !== "user_text")
            }
            kindHint={field === "original_text" ? anchorKind : null}
            panelKey="cut"
          />
        ))}

        {card.author === "ai" && (
          <FieldBlock
            field="instructions"
            value={card.instructions}
            onChange={(v) => onUpdateField(card.id, "instructions", v)}
            panelKey="cut"
          />
        )}

        {isPending && (
          <div className="flex gap-1.5 pt-1 pr-7">
            <Button
              variant="danger"
              size="sm"
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
              onClick={(e) => {
                e.stopPropagation();
                onAccept(card.id);
              }}
            >
              Accept
            </Button>
          </div>
        )}
      </div>
      )}
    </PanelCard>
  );

  return cardEl;
}
