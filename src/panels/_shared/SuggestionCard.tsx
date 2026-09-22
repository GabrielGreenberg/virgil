"use client";

import { useRef } from "react";
import { cardKindsForPanel } from "@/cards/predicates";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type {
  CutterSuggestionCard as CutterSuggestionCardData,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";
import {
  CardEmptyText,
  PanelCard,
  compressedBodyStyle,
  useCardDeleteKey,
  usePanelCardTryDelete,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { getLinkedTextObjectIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { PANEL_KIND_TO_BODY_KEY } from "@/lib/panel-typography";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import type { PendingChangeFamily } from "@/links/apply-suggestion";
import {
  PendingActionRow,
  AppliedRecordBody,
  FIELD_ORDER,
  FieldBlock,
  PendingAiRecordBody,
  READONLY_HUMAN_FIELDS,
  StaleNotice,
  SuggestionTrailing,
  type SuggestionField,
} from "@/panels/_shared/suggestion-fields";
// The collapsed cue's ORIGINAL half reads the same door the expanded excerpt
// does, so the two cannot disagree about what the passage says.
// `suggested_text` deliberately stays raw: it is EDITABLE currency the user is
// composing, and its cue must show exactly the bytes they typed.
import { capturedPassageOneLine } from "@/panels/_shared/captured-passage";
import { isPendingChangesOn } from "@/lib/pending-changes-flag";

/**
 * THE suggestion card — one component, two families (task 714).
 *
 * `RevisionSuggestionCard` and `CutterSuggestionCard` were byte-similar
 * transcriptions of each other: same four body branches, same chrome, same
 * hooks, same handlers, differing only in a kind token. Keeping two copies in
 * step by hand is what this pair kept failing at — task 714 is the THIRD
 * twin-divergence filed on it (after 304's overline label and 109's prompt
 * drift), and the one it names is the worst of the three: task 488 shipped a
 * RICH capture of the quoted passage (`selectedContent`) so an "Original" could
 * render a citation, an emphasis or an inline `$x$` as prose rather than as
 * source bytes; 694 and 696 then built the machinery that keeps it alive through
 * load, morph and clone; and the Revisions transcription simply never asked for
 * it. Every quoted passage in that panel rendered as `\citep{…}` / `\emph{…}`,
 * on all four of its surfaces, while the Cutter card one directory over rendered
 * the same passage correctly.
 *
 * So the fix is not to transcribe the four missing props a fourth time. It is to
 * stop transcribing: there is now ONE card, and every per-family fact it needs
 * is DERIVED from `CARD_REGISTRY[family]` rather than restated as a literal —
 *
 *   - the accent            → `useCardKindTheme(family)` → `registry.themeKey`
 *   - the owning panel      → `registry.panel`
 *   - the morph kind menu   → `cardKindsForPanel(registry.panel)`
 *   - the body typography   → `PANEL_KIND_TO_BODY_KEY[registry.panel]`
 *   - the pop / anchor keys → `cardPopKey(family, id)` / `{ kind: family, id }`
 *   - the docked hook attr  → `data-<family>-entry`
 *
 * — which means a new suggestion family, or a re-themed one, costs a registry
 * row and no card edit at all. The two panel-side files survive as named
 * wrappers (their import sites, their `*Trailing` exports and the Cutter's
 * legacy `CopyButton` / `FieldTitleRow` re-exports are load-bearing), each one
 * now a single delegation that has nothing left to forget.
 */

/** The two suggestion shapes are field-for-field identical (`src/lib/types.ts`),
 *  which is why one component can render both. The union — rather than a
 *  hand-written structural type — keeps that identity CHECKED: if the two
 *  shapes ever diverge, the card stops compiling instead of silently rendering
 *  the intersection. */
export type SuggestionCardData =
  | RevisionSuggestionCardData
  | CutterSuggestionCardData;

/** Per-family chrome facets, all derived from the registry row (see the header
 *  comment). Not a table: a second table keyed by family is exactly the drift
 *  this component exists to retire. */
function familyFacets(family: PendingChangeFamily) {
  const panel = CARD_REGISTRY[family].panel;
  return {
    panel,
    /** `undefined` is a legitimate answer for a panel with no tunable body row;
     *  `usePanelBodyStyle` takes it and yields `{}`. */
    bodyKey: panel ? PANEL_KIND_TO_BODY_KEY[panel] : undefined,
  };
}

export function SuggestionCard({
  card,
  family,
  selected,
  onUpdateField,
  onConvert,
  onDelete,
  onSelect,
  onJump,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: {
  card: SuggestionCardData;
  /** Which suggestion family this card belongs to — the ONE per-mount fact,
   *  and the key every other facet is derived through. */
  family: PendingChangeFamily;
  selected: boolean;
  onUpdateField: (id: string, field: SuggestionField, value: string) => void;
  /* NO landing-verb props (task 684). Apply / Accept / Reject / Keep / Revert
     all resolve from the `PendingChangeController` context, so the card behaves
     identically on every surface and a new mount site has nothing to forget.
     A prop the type still has is a prop a future host will pass instead — which
     is exactly how `onApply` came to be honoured docked and dropped in omni and
     float, leaving one card doing three different things under one global flag. */
  /** Morph suggestion ⇄ comment via the kind-chevron. */
  onConvert?: (id: string, toKind: "comment" | "suggestion") => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  const { panel, bodyKey } = familyFacets(family);
  const theme = useCardKindTheme(family);
  const cardStore = useCardStore();
  const cardRef = useRef<HTMLDivElement>(null);
  const isPending = card.status === "pending";
  // Pending-changes (flag-ON) status branches. With the flag OFF these are all
  // false (status never reaches applied/stale), so the card renders exactly as
  // today and the Accept/Reject path is untouched. Keep/Revert now flow through
  // the PendingChangeController context (not per-mount callbacks), so the applied
  // card renders on EVERY surface — no `hasPendingCallbacks` gate.
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
  // Unified AF key: the suggestion gets its own kind token (no legacy `s:`
  // infix). Was `popKey("revisions", `s:${card.id}`)` → `revision:s:<id>`.
  const cardKey = cardPopKey(family, card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);
  const ac = useAnchoredCard({ kind: family, id: card.id });
  const isExpanded = ac.expanded;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  const cardBodyStyle = usePanelBodyStyle(bodyKey);
  // CI-F7-01 class: this card renders via PanelCard directly (like CitationCard),
  // so its docked trash + Delete-key must route through the SAME content-aware
  // confirm every EditableCard sibling and the in-text margin marker use — not
  // the raw `onDelete`, which assumes the confirm already happened upstream.
  const { tryDelete, dialog: deleteConfirmDialog } = usePanelCardTryDelete(
    family,
    card,
    card.id,
    onDelete,
  );
  const handleDeleteKey = useCardDeleteKey(isSelected, tryDelete);

  return (
    <PanelCard
      ref={cardRef}
      // The docked hook the panel + its suites address this row by, spelled off
      // the family rather than per-file: `data-revision-suggestion-entry` /
      // `data-cutter-suggestion-entry`, byte-identical to the two literals the
      // twins carried.
      //
      // CONCATENATED, not a template literal, on purpose: `dead-css-hook-census`
      // reads an interpolation followed by a literal suffix as a producer of
      // ANY class ending in that suffix (its stated permissiveness at the
      // margin), so a `-entry` template here silently vouched for an unrelated
      // bibliography-entry hook and disarmed that allowlist row. Same string,
      // no false vouch. (Nor may this comment spell such a class name: the
      // census scans source text, comments included.)
      {...{ ["data-" + family + "-entry"]: card.id }}
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
      onTrashClick={tryDelete}
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
      onKeyDown={handleDeleteKey}
      className="mb-2"
      kind={family}
      kindOptions={onConvert && panel ? cardKindsForPanel(panel) : undefined}
      onKindChange={
        onConvert
          ? (k) => {
              if (k !== family) onConvert(card.id, "comment");
            }
          : undefined
      }
      canJump={isAnchored && !!onJump}
      onJump={(e) => {
        if (onJump && isAnchored)
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      headerTrailing={<SuggestionTrailing status={card.status} author={card.author} />}
    >
      {isApplied ? (
        // Flag-ON applied: the surviving original-record card. Wins over
        // `compressed` so the preview toggle + commit icons are always reachable.
        // Every action routes through the PendingChangeController context
        // (family-tagged); `explanation` surfaces what the AI did and why.
        <AppliedRecordBody
          id={card.id}
          originalText={card.appliedChange?.originalText ?? card.original_text}
          // The rich capture (task 488) describes `original_text`, so it is
          // only the right companion when that is what is being shown — an
          // APPLIED card's original is the pre-splice paragraph, real `.tex`
          // the door's parse rung reads.
          originalContent={card.appliedChange ? undefined : card.selectedContent}
          explanation={card.explanation}
          family={family}
        />
      ) : isStale ? (
        // Flag-ON stale: quiet notice + Dismiss (delete). No doc mutation.
        <StaleNotice id={card.id} family={family} />
      ) : compressed ? (
        <div className="px-3 pt-1.5 pb-1.5">
          <div style={{ ...cardBodyStyle, ...compressedBodyStyle(compressedLines) }}>
            {card.suggested_text ? (
              /* affirmative-green-exempt: a DIFF legend, not an affirmative
              control — `text-emerald-700/90` (added / suggested) reads only
              against the `text-red-700/70` (removed / original) two lines
              below, and its red twin is likewise pinned rather than
              repainted (`destructive-red-tokens.test.ts` →
              PINNED_STOCK_RED_SITES). Converting one half onto the
              `--positive` role family would say "accept" where the surface
              means "this is the added text", and would leave the pair
              speaking two vocabularies. Repainting BOTH halves is a colour
              decision about the compressed diff dialect, not this sweep. */
              <span className="text-emerald-700/90">{card.suggested_text.replace(/\s+/g, " ").trim()}</span>
            ) : card.original_text ? (
              <span className="text-ink-subtle">→ <span className="text-red-700/70 italic">{capturedPassageOneLine({ latex: card.original_text, content: card.selectedContent })}</span></span>
            ) : (
              <CardEmptyText label="empty suggestion" />
            )}
          </div>
        </div>
      ) : card.author === "ai" ? (
        // Flag-agnostic: an AI-drafted pending suggestion NEVER shows the 4-field
        // grid — it shows the minimal Insert-below body (retires the fallback).
        <PendingAiRecordBody
          card={card}
          originalContent={card.selectedContent}
          explanation={card.explanation}
          family={family}
        />
      ) : (
        <div
          className={`px-3 pt-2 pb-2 space-y-2.5${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* This branch is HUMAN-authored only (AI cards render the minimal
              Insert-below body above), so the read-only set is just
              `original_text` (READONLY_HUMAN_FIELDS — the shared SSOT the
              delete-confirm content model is pinned against) and the AI-only
              `instructions` field never applies. */}
          {FIELD_ORDER.map((field) => (
            <FieldBlock
              key={field}
              field={field}
              value={card[field]}
              // The rich capture behind `original_text` (task 488); the door
              // ignores it for every other field and for the editable path.
              content={field === "original_text" ? card.selectedContent : undefined}
              onChange={(v) => onUpdateField(card.id, field, v)}
              readOnly={READONLY_HUMAN_FIELDS.has(field)}
              kindHint={field === "original_text" ? anchorKind : null}
              panelKey={bodyKey}
            />
          ))}

          {/* Flag-ON: a single primary Apply (manual for Phase 1b; Phase 2
              auto-applies). Flag-OFF: the legacy Reject / Accept pair. BOTH now
              live behind the one shared row, which reads the verb from the
              controller — see PendingActionRow (task 684). */}
          {isPending && <PendingActionRow card={card} family={family} />}
        </div>
      )}
      {deleteConfirmDialog}
    </PanelCard>
  );
}
