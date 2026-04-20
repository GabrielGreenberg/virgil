"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type {
  QuotationGroup,
  Quote,
  BibEntry,
  AiRequest,
} from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  PrevNextCounter,
  useCycle,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  getParagraphAnchorPositions,
} from "@/hooks/useInTextPositions";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { getLinkedParagraphIds } from "@/links/links";
import { QuotationGroupCard } from "./QuotationGroupCard";

export interface QuotationsPanelProps {
  groups: QuotationGroup[];
  bibEntries: BibEntry[];
  bibPackage: string;
  citationStyle: string;
  onAddGroup: () => QuotationGroup;
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
  onScrollToParagraph?: (uuid: string) => void;
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  editor: Editor | null;
  panelSide: "left" | "right";
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
  onScrollToParagraph,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  viewMode,
  onViewModeChange,
  editor,
  panelSide,
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

  const handleAdd = useCallback(() => {
    const g = onAddGroup();
    setSelectedGroupId(g.id);
  }, [onAddGroup, setSelectedGroupId]);

  const anchoredGroups = useMemo(
    () => groups.filter((g) => getLinkedParagraphIds(g).length > 0),
    [groups],
  );

  const inTextItems = useMemo(
    () => getParagraphAnchorPositions(editor, anchoredGroups),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, anchoredGroups],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    viewMode === "in-text",
    "data-quotation-group-id",
  );

  const onActivateGroup = useCallback(
    (g: QuotationGroup) => {
      setSelectedGroupId(g.id);
      const pid = getLinkedParagraphIds(g)[0];
      if (pid) onScrollToParagraph?.(pid);
    },
    [onScrollToParagraph, setSelectedGroupId],
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
        onJump={(() => {
          const pid = getLinkedParagraphIds(group)[0];
          return pid ? () => onScrollToParagraph?.(pid) : undefined;
        })()}
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
      onScrollToParagraph,
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
      onAdd={handleAdd}
      onAiRequest={onAddAiRequest}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="quote" label="Quotation color" />
            <ViewToggle mode={viewMode} onChange={onViewModeChange} />
          </div>
        </ItemMenu>
      }
      headerExtras={
        <PrevNextCounter
          current={cycleIdx}
          total={anchoredGroups.length}
          label=""
        />
      }
      items={viewMode === "in-text" ? anchoredGroups : groups}
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
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : listRef}
      renderCard={(group, { selected }) => renderGroupCard(group, selected)}
      inTextRenderItem={(group, { selected }) => (
        <div className={`in-text-connector in-text-connector-${panelSide}`}>
          {renderGroupCard(group, selected)}
        </div>
      )}
    />
  );
}
