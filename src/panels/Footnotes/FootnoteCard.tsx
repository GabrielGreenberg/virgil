"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote, FootnoteRef } from "@/lib/types";
import {
  EditableCard,
  AiRequestCheckbox,
  BadgeLabel,
  BadgeOrphaned,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { bodyVariantForCardKind } from "@/cards/predicates";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";

// FN-F7-01 (audit-confirmed dead code, removed): `startFootnoteDrag` set up a
// native HTML5 drag (MIME_FOOTNOTE + an 80-char-truncated ghost) but had NO
// call site \u2014 footnote panel cards drag through the unified drop-mode /
// InlineAtomGrab controller, not native DnD (see Editor.tsx handleDrop /
// atom-drag-and-observer-move). The matching `MIME_FOOTNOTE` drop branch in
// Editor.tsx is retained for any future re-introduction. If a panel-card
// footnote drag is wanted later, build it on the drop-mode controller, not a
// fresh native dragstart. Backlog: see MEMO_BUG_BACKLOG.md.

export function onFootnoteArchiveConsumed(archiveId: string) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-consumed-archive", {
      detail: { archiveId },
    }),
  );
}

/**
 * D1 (task 2026-07-03-016) — the AI-request affordance is a property of "has a
 * resolvable in-text anchor," NOT "is a footnote." A footnote can bear an AI
 * request only when it carries a real `\footnote` marker position the drain can
 * anchor the request to; orphan / unanchored footnotes (rendered by the sibling
 * `OrphanedFootnoteCard` / `UnanchoredFootnoteCard`, which never receive
 * `onSetAiRequest`) have no marker, so the checkbox is INTENTIONALLY suppressed
 * for them rather than incidentally absent. `FootnoteCard` only ever renders the
 * anchored variant, so in practice this is always true here — it makes the
 * invariant explicit and testable (a footnote with an unresolvable pos shows no
 * affordance, matching what the drain can route).
 */
export function footnoteCanAiRequest(fn: Pick<FootnoteInfo, "pos">): boolean {
  return typeof fn.pos === "number" && Number.isFinite(fn.pos) && fn.pos >= 0;
}

export interface FootnoteCardProps {
  footnote: FootnoteInfo;
  isSelected: boolean;
  onSelect: () => void;
  onJump: (sourceEl: HTMLElement | null) => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  onEditTitle?: (title: string) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  /** BUG #55: per-card AI-request flag + toggle. When `onSetAiRequest` is
   *  supplied the expanded card renders the unified AiRequestCheckbox (same as
   *  note/todo/comment). Omitted by surfaces with no flag source (e.g. the
   *  Reader). `aiRequest` is the current flag value (from the footnotes.json
   *  sidecar — FootnoteInfo itself is .tex-derived and carries no flag). */
  aiRequest?: boolean;
  onSetAiRequest?: (value: boolean) => void;
}

export function FootnoteCard({
  footnote: fn,
  isSelected,
  onSelect,
  onJump,
  onEdit,
  onDelete,
  onEditTitle,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
  onTogglePopout,
  isPoppedOut,
  aiRequest,
  onSetAiRequest,
}: FootnoteCardProps) {
  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );
  const cardStore = useCardStore();
  const theme = useCardTheme("footnote");
  const popped = usePoppedCards();
  const cardKey = popKey("footnotes", fn.footnoteId);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const ac = useAnchoredCard({ kind: "footnote", id: fn.footnoteId });
  const isExpanded = ac.expanded;
  const isHaloed = ac.selected || isSelected;
  const compressedLines = useCompressedLines();
  const compressed = !isExpanded && !isPoppedOut;
  const compressedSummary = compressed
    ? (makeCompressedSummary(fn.content, compressedLines) || "")
    : undefined;

  const card = (
    <EditableCard
      id={fn.footnoteId}
      cardKind="footnote"
      kind="footnote"
      kindLabelOverride={fn.thanks ? "Acknowledgement" : undefined}
      selected={isHaloed}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      footnoteBadge={<BadgeLabel label={fn.thanks ? "A" : fn.number} theme={theme} />}
      bodyTitle={fn.title}
      onBodyTitleChange={onEditTitle ?? undefined}
      canJump
      onJump={(e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
      onClick={(e) => {
        const card = (e?.currentTarget as HTMLElement | undefined)?.closest('[data-card]') as HTMLElement | null;
        ac.onBodyActivate({
          onSelect,
          jump: onJump ? () => onJump(card) : undefined,
        });
      }}
      onHoverChange={(h) => cardStore.setHover(h ? ac.ref : null)}
      onDelete={onDelete}
      footer={
        onSetAiRequest && !compressed && footnoteCanAiRequest(fn) ? (
          <div className="px-3 pb-2 -mt-1">
            <AiRequestCheckbox
              checked={!!aiRequest}
              onToggle={(next) => onSetAiRequest(next)}
            />
          </div>
        ) : undefined
      }
      value={fn.content}
      variant={bodyVariantForCardKind("footnote")}
      panelKey="footnote"
      placeholder="Text here."
      onChange={handleEdit}
      onArchiveConsumed={onFootnoteArchiveConsumed}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "footnote-entry", value: fn.footnoteId }}
      extraDataAttrs={{ "data-pristine-card-id": fn.footnoteId, "data-card-key": cardKey, ...(extraDataAttrs || {}) }}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      compressed={compressed}
      compressedSummary={compressedSummary}
      compressedContent={fn.content}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
    />
  );
  return card;
}

export interface OrphanedFootnoteCardProps {
  orphan: OrphanedFootnote;
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  onEditTitle?: (title: string) => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
}

export function OrphanedFootnoteCard({
  orphan,
  isSelected = false,
  onSelect,
  onEdit,
  onDelete,
  onEditTitle,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
}: OrphanedFootnoteCardProps) {
  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );
  const theme = useCardTheme("footnote");
  const compressedLines = useCompressedLines();
  // Backlog #12: orphans get a REAL expansion axis (the global store — the
  // footnoteId is stable and the `footnote` kind already has a slot), instead
  // of the old `compressed = !isSelected` weld. Header click toggles it like
  // every other card; body click keeps select+expand (no jump — orphans have
  // no in-text marker to jump to).
  const ac = useAnchoredCard({ kind: "footnote", id: orphan.footnoteId });
  const isHaloed = ac.selected || isSelected;
  const compressed = !ac.expanded;
  const compressedSummary = compressed
    ? (makeCompressedSummary(orphan.content, compressedLines) || "")
    : undefined;

  return (
    <EditableCard
      id={orphan.footnoteId}
      cardKind="footnote"
      kind="footnote"
      selected={isHaloed}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      footnoteBadge={<BadgeOrphaned theme={theme} />}
      bodyTitle={orphan.title}
      onBodyTitleChange={onEditTitle ?? undefined}
      // C15: single body-click composition (store-backed select+expand; the
      // monotonic onSelect mirrors it into the panel slot). Orphans have no
      // in-text marker, so no jump.
      onClick={() => ac.onBodyActivate({ onSelect })}
      onDelete={onDelete}
      value={orphan.content}
      variant={bodyVariantForCardKind("footnote")}
      panelKey="footnote"
      placeholder="Text here."
      onChange={handleEdit}
      onArchiveConsumed={onFootnoteArchiveConsumed}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "footnote-entry", value: orphan.footnoteId }}
      extraDataAttrs={extraDataAttrs}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
      compressed={compressed}
      compressedSummary={compressedSummary}
      compressedContent={orphan.content}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
    />
  );
}

export interface UnanchoredFootnoteCardProps {
  footnote: FootnoteRef;
  isSelected?: boolean;
  onSelect?: () => void;
  onEdit: (json: JSONContent) => void;
  onDelete: () => void;
  onEditorFocus?: (editor: any) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
  /** Set by the float builder when this card renders inside a popped-out
   *  window: suppresses the in-card header (AF's `FloatChrome` owns it) and
   *  pins the body open, exactly as the anchored twin does. */
  isPoppedOut?: boolean;
}

/**
 * Bug sweep #3: an ATOMLESS footnote ref (archived or unanchored) — its
 * `\footnote` marker has been spliced out, but the body lives on in the
 * footnotes.json sidecar (`FootnoteRef`). Renders like an orphan (no in-text
 * marker → no jump), but the EditableCard chrome's archive control (gated on the
 * cardArchive context + `isArchivable("footnote")`) drives archive ⇄ unarchive
 * — so the user re-surfaces or permanently removes it from the Archives view.
 *
 * Task 316: it also wears the parked cue, and the cue now CARRIES the card key
 * ({@link UnanchoredCardCue}) — so the "drag into the editor to anchor it"
 * tooltip this card has always shown is finally reachable: the header renders
 * the drop button, and the header lift pops it out (the float builder resolves
 * an atomless ref from the sidecar, so the lift lands on a real window).
 */
export function UnanchoredFootnoteCard({
  footnote: fn,
  isSelected = false,
  onSelect,
  onEdit,
  onDelete,
  onEditorFocus,
  getCitationDisplayText,
  onCitationCreated,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
  isPoppedOut,
}: UnanchoredFootnoteCardProps) {
  const handleEdit = useCallback(
    (json: JSONContent) => onEdit(normalizeRichContent(json)),
    [onEdit],
  );
  const content = normalizeRichContent(fn.content);
  const theme = useCardTheme("footnote");
  const compressedLines = useCompressedLines();
  const ac = useAnchoredCard({ kind: "footnote", id: fn.id });
  const isHaloed = ac.selected || isSelected;
  const compressed = !ac.expanded && !isPoppedOut;
  // Same key the anchored twin builds (`cardPopKey("footnote", id)`); a
  // `FootnoteRef.id` IS the footnoteId the atom would carry, so the key is
  // stable across park → re-anchor.
  const cardKey = popKey("footnotes", fn.id);
  const compressedSummary = compressed
    ? (makeCompressedSummary(content, compressedLines) || "")
    : undefined;

  return (
    <EditableCard
      id={fn.id}
      cardKind="footnote"
      kind="footnote"
      selected={isHaloed}
      theme={theme}
      hideToolbar
      inlineDelete
      onEditorFocus={onEditorFocus}
      // Twin-consistency (task 278): an unanchored footnote ref is DELIBERATELY
      // parked (its `\footnote` atom was spliced out and not re-inserted), so it
      // wears the same neutral "drag to anchor" cue as the Citation twin — a
      // dashed border + reduced opacity + tooltip — NOT the `orphaned` error
      // badge (its omni state is neutral `free`, see Footnotes/omni.tsx). No
      // `footnoteBadge` is passed: the parked chrome, not a badge, distinguishes
      // it from both the numbered (anchored) and BadgeOrphaned (error) siblings.
      //
      // Task 316: the cue carries the card key, so the tooltip's promise is
      // backed by a real drop button + header lift. The docked panel and omni
      // both mount THIS component, so neither call site has to remember.
      // `canAnchor` is unconditionally true here, and that is a statement about
      // footnotes rather than an omission: the body is the atom's only attr and
      // an empty body is a legal footnote, so a parked footnote can ALWAYS
      // rebuild its marker (`CardDropButton`'s own doc: "Footnotes are always
      // enabled"). The citation twin, whose atom needs a citekey, answers no
      // while it is keyless.
      unanchored={{ kind: "footnote", cardKey, canAnchor: true }}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      // No in-text marker for an atomless ref, so body click is select+expand
      // only (no jump) — same composition as an orphan card.
      onClick={() => ac.onBodyActivate({ onSelect })}
      onDelete={onDelete}
      value={content}
      variant={bodyVariantForCardKind("footnote")}
      panelKey="footnote"
      placeholder="Text here."
      onChange={handleEdit}
      onArchiveConsumed={onFootnoteArchiveConsumed}
      getCitationDisplayText={getCitationDisplayText}
      onCitationCreated={onCitationCreated}
      dataAttr={{ name: "footnote-entry", value: fn.id }}
      extraDataAttrs={extraDataAttrs}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
      compressed={compressed}
      compressedSummary={compressedSummary}
      compressedContent={content}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
    />
  );
}
