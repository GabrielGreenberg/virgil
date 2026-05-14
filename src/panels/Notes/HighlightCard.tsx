"use client";

import { useRef } from "react";
import type { HighlightCard as HighlightCardData } from "@/lib/types";
import {
  AiRequestCheckbox,
  PanelCard,
  compressedBodyStyle,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import {
  getLinkedParagraphIds,
  getTextAnchor,
  hasTextAnchor,
} from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";

export function HighlightCard({
  card,
  selected,
  onAddNote,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: {
  card: HighlightCardData;
  selected: boolean;
  /** Morph this highlight into a note. The yellow tint stays. */
  onAddNote: (id: string) => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardTheme("highlight");
  const cardRef = useRef<HTMLDivElement>(null);
  const isAnchored =
    getLinkedParagraphIds(card).length > 0 || hasTextAnchor(card);
  const anchorText = getTextAnchor(card)?.anchorText ?? "";
  const isOrphaned = !isAnchored && !!anchorText;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("highlight", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const ac = useAnchoredCard({ kind: "highlight", id: card.id });
  const isSelected = ac.selected || selected;
  const compressed = !isSelected && !isPoppedOut;
  const compressedLines = useCompressedLines();

  // The card body renders the highlighted text in the document's serif
  // face (matching the editor) so the snippet reads like an excerpt.
  // No yellow pill inside the card — the in-doc tint is the actual
  // highlight; the H badge tells the user this card is a highlight.
  const snippetFontStyle = {
    fontFamily:
      'var(--font-serif-override, var(--font-serif)), "Source Serif 4", Georgia, serif',
    color: "var(--editor-text-color)",
  } as const;
  const trimmedAnchor = anchorText.replace(/\s+/g, " ").trim();
  const snippetCap = 80 * Math.max(1, compressedLines);
  const compressedSnippet =
    trimmedAnchor.length > snippetCap
      ? `${trimmedAnchor.slice(0, snippetCap - 3)}…`
      : trimmedAnchor;

  const cardEl = (
    <PanelCard
      ref={cardRef}
      data-highlight-entry={card.id}
      data-card-key={cardKey}
      data-pristine-card-id={card.id}
      theme={theme}
      selected={isSelected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onTrashClick={() => onDelete(card.id)}
      kind="highlight"
      canJump={isAnchored && !isOrphaned && !!onJump}
      onJump={(e) => {
        if (onJump && isAnchored && !isOrphaned)
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      tabIndex={isSelected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        cardStore.toggleSelection(ac.ref);
        onSelect(isSelected ? null : card.id);
      }}
      onMouseEnter={() => { cardStore.setHover(ac.ref); onHoverChange?.(true); }}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
        onHoverChange?.(false);
      }}
      onKeyDown={(e) => {
        if (!isSelected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(card.id);
        }
      }}
      className="focus:outline-none mb-2"
      {...(extraDataAttrs ?? {})}
    >
      {compressed ? (
        <div className="px-3 pt-1.5 pb-1.5 text-sm">
          <div style={{ ...snippetFontStyle, ...compressedBodyStyle(compressedLines) }}>
            {compressedSnippet || (
              <span className="text-ink-faint italic">empty highlight</span>
            )}
          </div>
        </div>
      ) : (
        <div className="px-3 pt-2 pb-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          <div>
            <div
              className="text-sm whitespace-pre-wrap break-words"
              style={{ ...snippetFontStyle, padding: "4px 6px" }}
            >
              {trimmedAnchor || (
                <span className="text-ink-faint italic">empty highlight</span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddNote(card.id);
            }}
            className="text-[10px] text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1 py-0.5 hover-on-light"
          >
            + note
          </button>

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
