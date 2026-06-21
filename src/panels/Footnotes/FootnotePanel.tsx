"use client";

import { useCallback, useEffect, useMemo, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  useCycle,
  clearStaleHover,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import {
  FootnoteCard,
  OrphanedFootnoteCard,
} from "./FootnoteCard";

type FootnoteItem =
  | { kind: "anchored"; data: FootnoteInfo }
  | { kind: "orphan"; data: OrphanedFootnote };

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
        ...footnotes.map(
          (f): FootnoteItem => ({ kind: "anchored", data: f }),
        ),
      ];
      return withRecentlyAddedFirst(out, recentlyAddedId, (item) =>
        item.kind === "orphan" ? item.data.footnoteId : item.data.footnoteId,
      );
    },
    [orphanedFootnotes, footnotes, recentlyAddedId],
  );

  // C25 (FN-F2-02): cycle the RENDERED union, not the anchored sub-array, so
  // ArrowUp/Down keyboard nav visits the orphan cards that render at the top.
  // Selection works for both kinds; only anchored footnotes have an in-text
  // marker to scroll to (orphans have no callout), so the jump is gated.
  const onActivateItem = useCallback(
    (item: FootnoteItem) => {
      onSelect(item.data.footnoteId);
      if (item.kind === "anchored") onScrollToMarker(item.data.footnoteId);
    },
    [onSelect, onScrollToMarker],
  );
  const {
    idx: cycleIdx,
    next: cycleNext,
    prev: cyclePrev,
    setIdx: setCycleIdx,
  } = useCycle(items, onActivateItem);

  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = items.findIndex((it) => it.data.footnoteId === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, items, cycleIdx, setCycleIdx]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cycleNext();
        clearStaleHover(e.currentTarget as HTMLElement);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cyclePrev();
        clearStaleHover(e.currentTarget as HTMLElement);
      }
    },
    [items, cycleNext, cyclePrev],
  );

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
        </ItemMenu>
      }
      items={items}
      getId={(it) => it.data.footnoteId}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No footnotes. Select text and use the toolbar to create one.
        </div>
      }
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(it, { selected }) =>
        it.kind === "anchored" ? (
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
        ) : (
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
        )
      }
    />
  );
}

export default memo(FootnotePanel);
