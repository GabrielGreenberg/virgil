"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { CutterCommentCard as CutterCommentCardData } from "@/lib/types";
import {
  AiRequestCheckbox,
  CardEmptyText,
  CollabCardTrailing,
  PanelCard,
  compressedBodyStyle,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import {
  getAnchorSummary,
  getLinkedTextObjectIds,
  hasTextAnchor,
} from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { cardPopKey } from "@/panels/panel-registry";
import { cardKindsForPanel, collabClaimScope } from "@/cards/predicates";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { MIME_CUT } from "@/lib/marginalia";
import { FieldTitleRow } from "./CutterSuggestionCard";
import { useCardClaim } from "@/hooks/useCollab";

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
  onUpdateText: (id: string, text: string) => void;
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
  const cutBodyStyle = usePanelBodyStyle("cut");
  const cardRef = useRef<HTMLDivElement>(null);
  const isAnchored =
    getLinkedTextObjectIds(card).length > 0 || hasTextAnchor(card);
  const isOrphaned = !isAnchored && !!card.selectedText;
  const anchorSummary = getAnchorSummary(card, editor ?? null);
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-comment", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();
  const [originalFolded, setOriginalFolded] = useState(false);
  const [commentFolded, setCommentFolded] = useState(false);
  const ac = useAnchoredCard({ kind: "cutter-comment", id: card.id });
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  // Collab claim scope is REGISTRY-DERIVED (R28/D-2) — no "cut" literal.
  const { partnerClaim, claim, release } = useCardClaim(
    collabClaimScope("cutter-comment"),
    card.id,
  );
  useEffect(() => {
    if (selected && !card.text) taRef.current?.focus();
  }, [selected, card.text]);

  const cardEl = (
    <PanelCard
      ref={cardRef}
      data-cutter-comment-entry={card.id}
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
      onTrashClick={() => onDelete(card.id)}
      draggable={!isSelected}
      onDragStart={(e) => startCutterCommentDrag(e, card.id)}
      tabIndex={isSelected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        ac.onActivate();
        onSelect(card.id);
        if (isAnchored && !isOrphaned && onJump) {
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
        }
      }}
      onMouseEnter={() => { cardStore.setHover(ac.ref); onHoverChange?.(true); }}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
        onHoverChange?.(false);
      }}
      onKeyDown={(e) => {
        if (!selected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(card.id);
        }
      }}
      className="focus:outline-none mb-2"
      kind="cutter-comment"
      kindOptions={onConvert ? cardKindsForPanel("cutter") : undefined}
      onKindChange={
        onConvert
          ? (k) => {
              if (k !== "cutter-comment") onConvert(card.id, "suggestion");
            }
          : undefined
      }
      canJump={isAnchored && !isOrphaned && !!onJump}
      onJump={(e) => {
        if (onJump && isAnchored && !isOrphaned)
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      headerTrailing={<CollabCardTrailing kind="cutter-comment" cardId={card.id} />}
    >
      {compressed ? (
        <div
          className="px-3 pt-1.5 pb-1.5"
          style={partnerClaim ? { opacity: 0.55, filter: "saturate(0.7)" } : undefined}
        >
          <div style={{ ...cutBodyStyle, ...compressedBodyStyle(compressedLines) }}>
            {card.selectedText ? (
              <span className="text-red-700/80 italic">"{card.selectedText.replace(/\s+/g, " ").trim()}"</span>
            ) : card.text ? (
              <span className="text-ink-subtle">{card.text.replace(/\s+/g, " ").trim()}</span>
            ) : (
              <CardEmptyText label="empty comment" />
            )}
          </div>
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
        data-hint={partnerClaim ? `${partnerClaim.holder} is editing this card` : undefined} aria-label={partnerClaim ? `${partnerClaim.holder} is editing this card` : undefined}
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

        <AiRequestCheckbox
          checked={card.aiRequest}
          onToggle={(next) => onSetAiRequest(card.id, next)}
        />
      </div>
      )}
    </PanelCard>
  );

  return cardEl;
}
