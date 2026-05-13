"use client";

import { useCallback, useEffect, useMemo, memo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote, AiRequest } from "@/lib/types";
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
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  onEditTitle?: (id: string, title: string) => void;
  onEditorFocus?: (editor: any) => void;
  recentlyAddedId?: string | null;
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
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  onEditTitle,
  onEditorFocus,
  recentlyAddedId,
}: FootnotePanelProps) {
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "footnote"),
    [aiRequests],
  );

  const onActivateFootnote = useCallback(
    (fn: FootnoteInfo) => {
      onSelect(fn.footnoteId);
      onScrollToMarker(fn.footnoteId);
    },
    [onSelect, onScrollToMarker],
  );
  const {
    idx: cycleIdx,
    next: cycleNext,
    prev: cyclePrev,
    setIdx: setCycleIdx,
  } = useCycle(footnotes, onActivateFootnote);

  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = footnotes.findIndex((fn) => fn.footnoteId === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, footnotes, cycleIdx, setCycleIdx]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (footnotes.length === 0) return;
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
    [footnotes, cycleNext, cyclePrev],
  );

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

  return (
    <CardListPanel
      kind="footnotes"
      count={footnotes.length}
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
      aiRequests={myAiRequests}
      onUpdateAiRequestText={onUpdateAiRequestText}
      onDeleteAiRequest={onDeleteAiRequest}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(it, { selected }) =>
        it.kind === "anchored" ? (
          <FootnoteCard
            footnote={it.data}
            isSelected={selected}
            onSelect={() =>
              onSelect(selectedId === it.data.footnoteId ? null : it.data.footnoteId)
            }
            onJump={(sourceEl) => onScrollToMarker(it.data.footnoteId, sourceEl)}
            onEdit={(json) => onEdit(it.data.footnoteId, json)}
            onDelete={() => onDelete(it.data.footnoteId)}
            onEditTitle={(title) => onEditTitle?.(it.data.footnoteId, title)}
            onEditorFocus={onEditorFocus}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
          />
        ) : (
          <OrphanedFootnoteCard
            orphan={it.data}
            isSelected={selected}
            onSelect={() =>
              onSelect(selectedId === it.data.footnoteId ? null : it.data.footnoteId)
            }
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
