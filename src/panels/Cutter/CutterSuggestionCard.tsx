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
import { useCardStore } from "@/links/_shared/anchored-card-store";
import {
  ApplyActionRow,
  AppliedRecordBody,
  CopyButton,
  FIELD_ORDER,
  FieldBlock,
  FieldTitleRow,
  PendingAiRecordBody,
  StaleNotice,
  SuggestionTrailing,
  type SuggestionField,
} from "@/panels/_shared/suggestion-fields";
import { isPendingChangesOn } from "@/lib/pending-changes-flag";

// Re-exported for backward compatibility — these now live in the shared
// suggestion-fields module (CutterCommentCard + RevisionSuggestionCard import
// them from here, and the Cutter barrel re-exports them).
export { CopyButton, FieldTitleRow };

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
  onApply,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- tolerated-vestigial: Keep/Revert now flow through the PendingChangeController context; kept so docked callers don't break.
  onKeep,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- tolerated-vestigial: see onKeep.
  onRevert,
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
  /** Pending-changes (flag-ON) client-side apply. `onApply` still wires the
   *  docked pending→apply button. `onKeep`/`onRevert` are now tolerated-vestigial
   *  (kept so existing docked callers don't break): the applied card routes
   *  Keep/Revert through the `PendingChangeController` context instead, so the
   *  minimal applied card renders identically on every surface (docked / omni /
   *  float) without per-mount callbacks. */
  onApply?: (id: string) => void;
  onKeep?: (id: string) => void;
  onRevert?: (id: string) => void;
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
  // Pending-changes (flag-ON) status branches. Flag OFF → all false (status
  // never reaches applied/stale), so the card renders exactly as today. Keep/
  // Revert now flow through the PendingChangeController context (not per-mount
  // callbacks), so the applied card renders on EVERY surface — no
  // `hasPendingCallbacks` gate.
  const pendingChangesOn = isPendingChangesOn();
  const isApplied = pendingChangesOn && card.status === "applied";
  const isStale = pendingChangesOn && card.status === "stale";
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
  const cardStore = useCardStore();
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
      // Applied cards always show their (minimal) body, so the header must not
      // display a misleading collapsed chevron.
      isCollapsed={compressed && !isApplied}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
      onTrashClick={() => onDelete(card.id)}
      tabIndex={isSelected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        const el = (e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null;
        ac.onBodyActivate({
          onSelect: () => onSelect(card.id),
          jump: isAnchored && onJump ? () => onJump(el) : undefined,
        });
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
      {isApplied ? (
        // Flag-ON applied: the surviving original-record card. Wins over
        // `compressed` so the preview toggle + commit icons are always reachable.
        // Every action routes through the PendingChangeController context
        // (family-tagged); `explanation` surfaces what the AI did and why.
        <AppliedRecordBody
          id={card.id}
          originalText={card.appliedChange?.originalText ?? card.original_text}
          explanation={card.explanation}
          cardKind="cutter-suggestion"
          panelKey="cut"
          themeKey="cut"
          family="cutter-suggestion"
        />
      ) : isStale ? (
        // Flag-ON stale: quiet notice + Dismiss (delete). No doc mutation.
        <StaleNotice id={card.id} onDismiss={onReject} />
      ) : compressed ? (
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
      ) : card.author === "ai" ? (
        // Flag-agnostic: an AI-drafted pending suggestion NEVER shows the 4-field
        // grid — it shows the minimal Insert-below body (retires the fallback).
        <PendingAiRecordBody
          id={card.id}
          originalText={card.original_text}
          suggestedText={card.suggested_text}
          explanation={card.explanation}
          family="cutter-suggestion"
        />
      ) : (
      <div
        className={`px-3 pt-2 pb-2 space-y-2.5${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* This branch is HUMAN-authored only (AI cards render the minimal
            Insert-below body above), so `original_text` is the sole read-only
            field and the AI-only `instructions` field never applies. */}
        {FIELD_ORDER.map((field) => (
          <FieldBlock
            key={field}
            field={field}
            value={card[field]}
            onChange={(v) => onUpdateField(card.id, field, v)}
            readOnly={field === "original_text"}
            kindHint={field === "original_text" ? anchorKind : null}
            panelKey="cut"
          />
        ))}

        {isPending &&
          (pendingChangesOn && onApply ? (
            // Flag-ON pending: a single primary Apply (manual for Phase 1b;
            // Phase 2 auto-applies). Replaces the Accept/Reject pair.
            <ApplyActionRow id={card.id} onApply={onApply} />
          ) : (
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
          ))}
      </div>
      )}
    </PanelCard>
  );

  return cardEl;
}
