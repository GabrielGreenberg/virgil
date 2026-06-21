"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote } from "@/lib/types";
import {
  EditableCard,
  AiRequestCheckbox,
  BadgeLabel,
  BadgeOrphaned,
  makeCompressedSummary,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";

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
        onSetAiRequest && !compressed ? (
          <div className="px-3 pb-2 -mt-1">
            <AiRequestCheckbox
              checked={!!aiRequest}
              onToggle={(next) => onSetAiRequest(next)}
            />
          </div>
        ) : undefined
      }
      value={fn.content}
      variant="footnote"
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
      variant="footnote"
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
