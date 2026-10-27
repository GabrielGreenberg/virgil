"use client";

import { useMemo, useRef } from "react";
import type { HighlightCard as HighlightCardData } from "@/lib/types";
import {
  AiRequestRow,
  CardEmptyText,
  PANEL,
  PanelCard,
  clampCompressedText,
  compressedBodyStyle,
  usePanelCardTryDelete,
} from "@/components/panel-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { getTextAnchor, type CardWithLinks } from "@/links/links";
import { isModeB } from "@/links/_shared/types";
import { useLinkedAnchorPassage } from "@/links/_shared/useLinkedAnchorPassage";
import { morphOptionsFor } from "@/cards/card-registry";
import type { CardMorphHandler } from "@/cards/types";
import { useAnchoredCardShell } from "@/panels/_shared/useAnchoredCardShell";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import {
  CapturedPassage,
  capturedPassageOneLine,
  plainPassageContent,
} from "@/panels/_shared/captured-passage";

export function HighlightCard({
  card,
  selected,
  onConvert,
  onSetAiRequest,
  onDelete,
  onSelect,
  onJump,
  isPoppedOut,
  extraDataAttrs,
}: {
  card: HighlightCardData;
  selected: boolean;
  /** Morph this highlight ⇄ note via the kind-chevron (R14, bidirectional). */
  onConvert?: CardMorphHandler;
  onSetAiRequest: (id: string, value: boolean) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardKindTheme("highlight");
  const cardRef = useRef<HTMLDivElement>(null);
  // The passage as it reads NOW (task 700): the live text under the
  // highlight's mark, falling back to the stored text only when the mark is
  // gone. The stored snapshot is the recovery key, not the display text — an
  // edit inside the highlight must reach the card. The live read is RICH
  // (task 1324): the plain `textBetween` string drops every inline atom (a
  // citation, inline math, a footnote marker) and flattens the marks, so a
  // highlight quoted its passage wrongly. The stored fallback is plain words
  // only — highlights carry no rich capture.
  const textAnchor = getTextAnchor(card);
  const live = useLinkedAnchorPassage(textAnchor?.anchorId);
  // Jump is the HOST's decision (task 699): every host hands `onJump` only
  // through the card-anchor authority's gate, so the card re-derives nothing.
  // (The old local `isOrphaned` could never be true — it required text with
  // no anchor, and the text came FROM the anchor.)
  const { ac, compressed, compressedLines, shell } = useAnchoredCardShell({
    kind: "highlight",
    id: card.id,
    isPoppedOut,
    onSelect: () => onSelect(card.id),
    onJump,
  });
  const isSelected = ac.selected || selected;
  // The trash AND the shell's Delete key arm the permit-asking executor (task
  // 637's door), never a raw `onDelete` (task 702). `cardHasContent` is false
  // for a highlight, so no confirm is ever raised.
  const { tryDelete, dialog: deleteConfirmDialog } = usePanelCardTryDelete(
    "highlight",
    card,
    card.id,
    onDelete,
    { anchorRef: cardRef },
  );

  // No yellow pill inside the card — the in-doc tint is the actual
  // highlight; the H badge tells the user this card is a highlight.
  const storedText = live ? "" : storedHighlightText(card).replace(/\s+/g, " ").trim();
  const passage = useMemo(
    () =>
      live
        ? { latex: live.text, content: live.content }
        : { latex: storedText, content: plainPassageContent(storedText) },
    [live, storedText],
  );
  // ONE projection for the collapsed cue — the door's own one-liner, so the
  // cue and the expanded excerpt cannot disagree (a citation reads as its
  // display text, never a double space) — through the ONE compressed clamp.
  const oneLine = useMemo(() => capturedPassageOneLine(passage), [passage]);
  const compressedSnippet = clampCompressedText(oneLine, compressedLines);
  // Main-text typography for the quote, expanded AND collapsed, same as every
  // captured passage (the archive-card treatment). The collapsed cue drops
  // `color` exactly as the door does, so both inherit the card's ink.
  const passageStyle = usePanelBodyStyle("footnote");
  const cueStyle = useMemo(
    () => ({
      fontFamily: passageStyle.fontFamily,
      fontSize: passageStyle.fontSize,
      ...compressedBodyStyle(compressedLines),
    }),
    [passageStyle.fontFamily, passageStyle.fontSize, compressedLines],
  );

  const cardEl = (
    <PanelCard
      {...shell}
      ref={cardRef}
      data-highlight-entry={card.id}
      data-pristine-card-id={card.id}
      theme={theme}
      selected={isSelected}
      isCollapsed={compressed}
      onTrashClick={tryDelete}
      cardId={card.id}
      kind="highlight"
      kindOptions={onConvert ? morphOptionsFor("highlight", card) : undefined}
      onKindChange={onConvert ? (k) => onConvert("highlight", card.id, k) : undefined}
      className="mb-2"
      {...(extraDataAttrs ?? {})}
    >
      {compressed ? (
        <div className="px-3 pt-1.5 pb-1.5">
          <div style={cueStyle}>
            {compressedSnippet || <CardEmptyText label="empty highlight" />}
          </div>
        </div>
      ) : (
        <div className={`${PANEL.cardBody} space-y-2`} onClick={(e) => e.stopPropagation()}>
          {/* The highlighted words ARE a quote of the paper, so they render
              through the one door every quoting card uses (task 825) — the
              borrowed main-text treatment, not a hand-set serif line. */}
          {oneLine ? (
            <CapturedPassage
              latex={passage.latex}
              content={passage.content}
              bodyStyle={passageStyle}
              className="py-1 break-words"
            />
          ) : (
            <CardEmptyText label="empty highlight" />
          )}

          {/* R14: the one-way "+ note" morph button is gone — note ↔ highlight
              is now BIDIRECTIONAL via the kind-chevron in the card header. */}
        </div>
      )}
      {/* The shell's one AI-request placement, under the body (task 825). */}
      {!compressed && (
        <AiRequestRow
          checked={card.aiRequest}
          onToggle={(next) => onSetAiRequest(card.id, next)}
        />
      )}
    </PanelCard>
  );

  return (
    <>
      {cardEl}
      {deleteConfirmDialog}
    </>
  );
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
