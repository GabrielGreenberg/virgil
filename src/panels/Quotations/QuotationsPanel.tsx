"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  QuotationGroup,
  Quote,
  BibEntry,
  AiRequest,
} from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  useCycle,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import { getLinkedTextObjectIds } from "@/links/links";
import { QuotationGroupCard } from "./QuotationGroupCard";

export interface QuotationsPanelProps {
  groups: QuotationGroup[];
  bibEntries: BibEntry[];
  bibPackage: string;
  citationStyle: string;
  onAddGroup: (anchorRect?: DOMRect) => QuotationGroup;
  onDeleteGroup: (groupId: string) => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onAddReference: (groupId: string) => string;
  onDeleteReference: (groupId: string, referenceId: string) => void;
  onUpdateReferenceCiteKey: (groupId: string, referenceId: string, key: string) => void;
  onAddQuote: (groupId: string, referenceId: string) => string;
  onUpdateQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>,
  ) => void;
  onDeleteQuote: (groupId: string, referenceId: string, quoteId: string) => void;
  onUpdateNotes: (groupId: string, notes: string) => void;
  selectedGroupId?: string | null;
  onSelectGroup?: (groupId: string | null) => void;
  onJumpToCard?: (card: QuotationGroup) => void;
  aiRequests?: AiRequest[];
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  recentlyAddedId?: string | null;
}

export default function QuotationsPanel({
  groups,
  bibEntries,
  bibPackage,
  onAddGroup,
  onDeleteGroup,
  onUpdateGroupTitle,
  onAddReference,
  onDeleteReference,
  onUpdateReferenceCiteKey,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onUpdateNotes,
  selectedGroupId: controlledSelectedGroupId,
  onSelectGroup,
  onJumpToCard,
  aiRequests,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  recentlyAddedId,
}: QuotationsPanelProps) {
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "quotation"),
    [aiRequests],
  );
  const [internalSelectedGroupId, setInternalSelectedGroupId] = useState<
    string | null
  >(null);
  const selectedGroupId =
    controlledSelectedGroupId !== undefined
      ? controlledSelectedGroupId
      : internalSelectedGroupId;
  const setSelectedGroupId = useCallback(
    (id: string | null) => {
      if (onSelectGroup) onSelectGroup(id);
      else setInternalSelectedGroupId(id);
    },
    [onSelectGroup],
  );

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedGroupId) return;
    const el = listRef.current?.querySelector(
      `[data-quotation-group-id="${selectedGroupId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedGroupId]);

  const handleAdd = useCallback((anchorRect?: DOMRect) => {
    const g = onAddGroup(anchorRect);
    setSelectedGroupId(g.id);
  }, [onAddGroup, setSelectedGroupId]);

  const anchoredGroups = useMemo(
    () => groups.filter((g) => getLinkedTextObjectIds(g).length > 0),
    [groups],
  );

  const onActivateGroup = useCallback(
    (g: QuotationGroup) => {
      setSelectedGroupId(g.id);
      onJumpToCard?.(g);
    },
    [onJumpToCard, setSelectedGroupId],
  );
  const { idx: cycleIdx, setIdx: setCycleIdx } = useCycle(
    anchoredGroups,
    onActivateGroup,
  );

  useEffect(() => {
    if (!selectedGroupId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = anchoredGroups.findIndex((g) => g.id === selectedGroupId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedGroupId, anchoredGroups, cycleIdx, setCycleIdx]);

  const renderGroupCard = useCallback(
    (group: QuotationGroup, selected: boolean) => (
      <QuotationGroupCard
        group={group}
        bibEntries={bibEntries}
        bibPackage={bibPackage}
        selected={selected}
        onSelect={() => setSelectedGroupId(group.id)}
        onDelete={() => onDeleteGroup(group.id)}
        onJump={
          onJumpToCard && getLinkedTextObjectIds(group).length > 0
            ? () => onJumpToCard(group)
            : undefined
        }
        onUpdateGroupTitle={onUpdateGroupTitle}
        onAddReference={onAddReference}
        onDeleteReference={onDeleteReference}
        onUpdateReferenceCiteKey={onUpdateReferenceCiteKey}
        onAddQuote={onAddQuote}
        onUpdateQuote={onUpdateQuote}
        onDeleteQuote={onDeleteQuote}
        onUpdateNotes={onUpdateNotes}
      />
    ),
    [
      bibEntries,
      bibPackage,
      setSelectedGroupId,
      onDeleteGroup,
      onJumpToCard,
      onUpdateGroupTitle,
      onAddReference,
      onDeleteReference,
      onUpdateReferenceCiteKey,
      onAddQuote,
      onUpdateQuote,
      onDeleteQuote,
      onUpdateNotes,
    ],
  );

  return (
    <CardListPanel
      kind="quotations"
      count={groups.length}
      onAdd={handleAdd}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="quote" label="Quotation color" />
          </div>
        </ItemMenu>
      }
      items={withRecentlyAddedFirst(groups, recentlyAddedId, (g) => g.id)}
      getId={(g) => g.id}
      selectedId={selectedGroupId}
      onSelect={setSelectedGroupId}
      emptyState={
        <div className={PANEL.empty}>
          No quotations yet. Add a group to start collecting references.
        </div>
      }
      aiRequests={myAiRequests}
      onUpdateAiRequestText={onUpdateAiRequestText}
      onDeleteAiRequest={onDeleteAiRequest}
      scrollRef={listRef}
      renderCard={(group, { selected }) => renderGroupCard(group, selected)}
    />
  );
}
