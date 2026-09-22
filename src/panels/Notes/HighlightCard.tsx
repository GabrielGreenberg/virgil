"use client";

import { useRef } from "react";
import type { HighlightCard as HighlightCardData } from "@/lib/types";
import {
  AiRequestCheckbox,
  CardEmptyText,
  PANEL,
  PanelCard,
  compressedBodyStyle,
  useCardDeleteKey,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { getTextAnchor, type CardWithLinks } from "@/links/links";
import { isModeB } from "@/links/_shared/types";
import { useLinkedAnchorText } from "@/links/_shared/useLinkedAnchorText";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { cardPopKey } from "@/panels/panel-registry";
import { cardKindsForPanel } from "@/cards/predicates";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import { FONT_SERIF } from "@/lib/font-stacks";

export function HighlightCard({
  card,
  selected,
  onConvert,
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
  /** Morph this highlight ⇄ note via the kind-chevron (R14, bidirectional). */
  onConvert?: (id: string, toKind: "note" | "highlight") => void;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardKindTheme("highlight");
  const cardRef = useRef<HTMLDivElement>(null);
  // The passage as it reads NOW (task 700): the live text under the
  // highlight's mark, falling back to the stored text only when the mark is
  // gone. The stored snapshot is the recovery key, not the display text — an
  // edit inside the highlight must reach the card.
  const textAnchor = getTextAnchor(card);
  const liveText = useLinkedAnchorText(textAnchor?.anchorId);
  const anchorText = liveText ?? storedHighlightText(card);
  // Jump is the HOST's decision (task 699): every host hands `onJump` only
  // through the card-anchor authority's gate, so the card re-derives nothing.
  // (The old local `isOrphaned` could never be true — it required text with
  // no anchor, and the text came FROM the anchor.)
  const canJump = !!onJump;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("highlight", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);

  const ac = useAnchoredCard({ kind: "highlight", id: card.id });
  const cardStore = useCardStore();
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  const handleDeleteKey = useCardDeleteKey(isSelected, () => onDelete(card.id));

  // The card body renders the highlighted text in the document's serif
  // face (matching the editor) so the snippet reads like an excerpt.
  // No yellow pill inside the card — the in-doc tint is the actual
  // highlight; the H badge tells the user this card is a highlight.
  const snippetFontStyle = {
    fontFamily: FONT_SERIF,
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
      chromeless={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
      onTrashClick={() => onDelete(card.id)}
      kind="highlight"
      kindOptions={onConvert ? cardKindsForPanel("notes") : undefined}
      onKindChange={
        onConvert
          ? (k) => {
              if (k !== "highlight") onConvert(card.id, "note");
            }
          : undefined
      }
      canJump={canJump}
      onJump={(e) => {
        if (onJump)
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      tabIndex={isSelected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        const el = (e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null;
        ac.onBodyActivate({
          onSelect: () => onSelect(card.id),
          jump: onJump ? () => onJump(el) : undefined,
        });
      }}
      onMouseEnter={() => { cardStore.setHover(ac.ref); onHoverChange?.(true); }}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
        onHoverChange?.(false);
      }}
      onKeyDown={handleDeleteKey}
      className="mb-2"
      {...(extraDataAttrs ?? {})}
    >
      {compressed ? (
        <div className="px-3 pt-1.5 pb-1.5 text-sm">
          <div style={{ ...snippetFontStyle, ...compressedBodyStyle(compressedLines) }}>
            {compressedSnippet || <CardEmptyText label="empty highlight" />}
          </div>
        </div>
      ) : (
        <div className={`${PANEL.cardBody} space-y-2`} onClick={(e) => e.stopPropagation()}>
          <div>
            <div
              className="text-sm whitespace-pre-wrap break-words py-1"
              style={snippetFontStyle}
            >
              {trimmedAnchor || (
                <CardEmptyText label="empty highlight" />
              )}
            </div>
          </div>

          {/* R14: the one-way "+ note" morph button is gone — note ↔ highlight
              is now BIDIRECTIONAL via the kind-chevron in the card header. */}
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

/**
 * The highlighted words as last STORED — the display fallback for a highlight
 * whose mark is gone. A live Mode-B link carries them as `textSnapshot`; a
 * highlight the snapshot rung relocated to Mode-A
 * (`resolve-card-anchor.ts` `relocateBySnapshot`) carries the same words as
 * its `paragraphSnapshot`, so it no longer reads "empty highlight" while it is
 * still anchored.
 */
function storedHighlightText(card: CardWithLinks): string {
  const ranged = getTextAnchor(card);
  if (ranged) return ranged.anchorText;
  for (const link of card.links ?? []) {
    if (link.anchor.type !== "textObject" || isModeB(link)) continue;
    if (link.anchor.paragraphSnapshot) return link.anchor.paragraphSnapshot;
  }
  return "";
}
