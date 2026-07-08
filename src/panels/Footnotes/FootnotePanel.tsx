"use client";

import { useCallback, useEffect, useMemo, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote, FootnoteRef } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  useCycle,
  useListNavKeys,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { useArchiveVisibleItems } from "@/panels/_shared/card-archive-view";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import {
  FootnoteCard,
  OrphanedFootnoteCard,
  UnanchoredFootnoteCard,
} from "./FootnoteCard";

type FootnoteItem =
  | { kind: "anchored"; data: FootnoteInfo }
  | { kind: "orphan"; data: OrphanedFootnote }
  // Bug sweep #3: an atomless footnote ref (archived or unanchored) from the
  // footnotes.json sidecar — no `\footnote` atom, so no in-text marker to jump
  // to. Archived ones surface under the panel's Archives view (getArchived).
  | { kind: "ref"; data: FootnoteRef };

/** The stable id for any footnote item (anchored/orphan key on `footnoteId`; a
 *  sidecar ref keys on `id`). */
function itemId(it: FootnoteItem): string {
  return it.kind === "ref" ? it.data.id : it.data.footnoteId;
}

interface FootnotePanelProps {
  footnotes: FootnoteInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, newContent: JSONContent) => void;
  onDelete: (id: string) => void;
  onScrollToMarker: (id: string, sourceEl?: HTMLElement | null) => void;
  orphanedFootnotes: OrphanedFootnote[];
  onDeleteOrphan: (id: string) => void;
  onEditOrphan: (id: string, newContent: JSONContent) => void;
  onEditOrphanTitle?: (id: string, title: string) => void;
  /** Bug sweep #3: atomless footnote refs (archived or unanchored). Archived
   *  ones show under the Archives view; the card's archive button (chrome)
   *  unarchives. */
  unanchoredFootnotes?: FootnoteRef[];
  onDeleteUnanchored?: (id: string) => void;
  onEditUnanchored?: (id: string, newContent: JSONContent) => void;
  onAdd?: (anchorRect?: DOMRect) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  onEditTitle?: (id: string, title: string) => void;
  onEditorFocus?: (editor: any) => void;
  recentlyAddedId?: string | null;
  /** BUG #55: per-footnote AI-request flags (footnoteId → bool) from the
   *  footnotes.json sidecar, + the toggle callback. When `onSetFootnoteAiRequest`
   *  is supplied each anchored footnote card renders the AI-request checkbox. */
  footnoteAiRequests?: Record<string, boolean>;
  onSetFootnoteAiRequest?: (id: string, value: boolean) => void;
}

function FootnotePanel({
  footnotes,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onScrollToMarker,
  orphanedFootnotes,
  onDeleteOrphan,
  onEditOrphan,
  onEditOrphanTitle,
  unanchoredFootnotes,
  onDeleteUnanchored,
  onEditUnanchored,
  onAdd,
  getCitationDisplayText,
  onCitationCreated,
  onEditTitle,
  onEditorFocus,
  recentlyAddedId,
  footnoteAiRequests,
  onSetFootnoteAiRequest,
}: FootnotePanelProps) {
  const items = useMemo<FootnoteItem[]>(
    () => {
      const out: FootnoteItem[] = [
        ...orphanedFootnotes.map(
          (o): FootnoteItem => ({ kind: "orphan", data: o }),
        ),
        ...(unanchoredFootnotes ?? []).map(
          (r): FootnoteItem => ({ kind: "ref", data: r }),
        ),
        ...footnotes.map(
          (f): FootnoteItem => ({ kind: "anchored", data: f }),
        ),
      ];
      return withRecentlyAddedFirst(out, recentlyAddedId, itemId);
    },
    [orphanedFootnotes, unanchoredFootnotes, footnotes, recentlyAddedId],
  );

  // C25 (FN-F2-02): cycle the RENDERED union, not the anchored sub-array, so
  // ArrowUp/Down keyboard nav visits the orphan/ref cards that render at the top.
  // Selection works for all kinds; only anchored footnotes have an in-text
  // marker to scroll to (orphans + atomless refs have no callout), so the jump
  // is gated.
  const onActivateItem = useCallback(
    (item: FootnoteItem) => {
      onSelect(itemId(item));
      if (item.kind === "anchored") onScrollToMarker(item.data.footnoteId);
    },
    [onSelect, onScrollToMarker],
  );
  // The keyboard cycle iterates the SAME set CardListPanel renders. Archived
  // atomless refs filter out of the Active view; feed the cycle the archive-
  // filtered list (via the shared hook, same accessor CardListPanel gets) so
  // ArrowUp/Down never steps onto an archived, off-screen ref card (M1).
  const getFnArchived = useCallback(
    (it: FootnoteItem) => (it.kind === "ref" ? !!it.data.archived : false),
    [],
  );
  const visibleItems = useArchiveVisibleItems("footnotes", items, getFnArchived);
  const {
    idx: cycleIdx,
    next: cycleNext,
    prev: cyclePrev,
    setIdx: setCycleIdx,
  } = useCycle(visibleItems, onActivateItem);

  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = visibleItems.findIndex((it) => itemId(it) === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, visibleItems, cycleIdx, setCycleIdx]);

  const handleNavKeys = useListNavKeys(visibleItems.length, cycleNext, cyclePrev);

  return (
    <CardListPanel
      kind="footnotes"
      // C25 (FN-C1-01 / FN-F1-03): the badge counts the RENDERED union (orphans
      // + anchored), not the anchored sub-list — otherwise a panel showing N
      // orphans + M anchored displayed only M (and "0", i.e. no badge, when the
      // panel held orphans only).
      count={items.length}
      onAdd={onAdd}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="footnote" label="Footnote color" />
          </div>
          <CardViewModeMenuItems kind="footnotes" />
        </ItemMenu>
      }
      items={items}
      getId={itemId}
      // Bug sweep #3: archived atomless refs filter into the Archives view; live
      // anchored footnotes + orphans + unanchored-but-active refs stay in Active.
      getArchived={getFnArchived}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No footnotes. Select text and use the toolbar to create one.
        </div>
      }
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(it, { selected }) => {
        if (it.kind === "anchored") {
          return (
            <FootnoteCard
              footnote={it.data}
              isSelected={selected}
              // C15: MONOTONIC select (never the toggling `selectedId===id?null:id`).
              // The store is the single selection source; the panel slot mirrors
              // it. Re-click idempotence + skip-jump live in `ac.onBodyActivate`.
              onSelect={() => onSelect(it.data.footnoteId)}
              onJump={(sourceEl) => onScrollToMarker(it.data.footnoteId, sourceEl)}
              onEdit={(json) => onEdit(it.data.footnoteId, json)}
              onDelete={() => onDelete(it.data.footnoteId)}
              onEditTitle={(title) => onEditTitle?.(it.data.footnoteId, title)}
              onEditorFocus={onEditorFocus}
              getCitationDisplayText={getCitationDisplayText}
              onCitationCreated={onCitationCreated}
              aiRequest={!!footnoteAiRequests?.[it.data.footnoteId]}
              onSetAiRequest={
                onSetFootnoteAiRequest
                  ? (value) => onSetFootnoteAiRequest(it.data.footnoteId, value)
                  : undefined
              }
            />
          );
        }
        if (it.kind === "orphan") {
          return (
            <OrphanedFootnoteCard
              orphan={it.data}
              isSelected={selected}
              // C15: monotonic select (see anchored FootnoteCard above).
              onSelect={() => onSelect(it.data.footnoteId)}
              onEdit={(json) => onEditOrphan(it.data.footnoteId, json)}
              onDelete={() => onDeleteOrphan(it.data.footnoteId)}
              onEditTitle={(title) => onEditOrphanTitle?.(it.data.footnoteId, title)}
              onEditorFocus={onEditorFocus}
              getCitationDisplayText={getCitationDisplayText}
              onCitationCreated={onCitationCreated}
            />
          );
        }
        // kind === "ref": an atomless archived/unanchored footnote. No in-text
        // marker → no jump. The card's archive button (EditableCard chrome,
        // gated on the cardArchive context) toggles archive/unarchive.
        return (
          <UnanchoredFootnoteCard
            footnote={it.data}
            isSelected={selected}
            onSelect={() => onSelect(it.data.id)}
            onEdit={(json) => onEditUnanchored?.(it.data.id, json)}
            onDelete={() => onDeleteUnanchored?.(it.data.id)}
            onEditorFocus={onEditorFocus}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        );
      }}
    />
  );
}

export default memo(FootnotePanel);
