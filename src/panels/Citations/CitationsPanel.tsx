"use client";

import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { BibEntry, CitationRef, AiRequest } from "@/lib/types";
import ViewToggle from "@/components/ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import {
  PANEL,
  PrevNextCounter,
  useCycle,
  clearStaleHover,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import CitationBuilder from "@/components/CitationBuilder";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CitationCard } from "./CitationCard";

interface CitationsPanelProps {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  citationStyle: string;
  bibPackage: string;
  bibPath: string;
  selectedId: string | null;
  citationOrder: string[];
  onSelect: (id: string | null) => void;
  onScrollToMarker: (citationId: string) => void;
  onUpdateCitation: (id: string, command: string) => void;
  onDeleteCitation: (id: string) => void;
  onSetStyle: (style: string) => void;
  onSetBibPackage: (pkg: string) => void;
  getDisplayText: (command: string) => string;
  pendingCreate: string | null;
  pendingCreateMode: "anchored" | "unanchored";
  onCreateCitation: (command: string) => string;
  onInsertCitation: (command: string, citationId: string, displayText: string) => void;
  onClearPendingCreate: () => void;
  onStartCreate: () => void;
  editor: Editor | null;
  panelSide: "left" | "right";
  citationPositions: Map<string, number>;
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (
    bibKey: string,
    type: "fields" | "notes",
  ) => "none" | "pending" | "complete";
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
}

const STYLES = [
  { value: "apa", label: "APA" },
  { value: "vancouver", label: "Vancouver" },
  { value: "harvard1", label: "Harvard" },
];

const BIB_PACKAGES = [
  { value: "biblatex", label: "biblatex" },
  { value: "natbib", label: "natbib" },
];

function CitationsPanel({
  citations,
  bibEntries,
  citationStyle,
  bibPackage,
  selectedId,
  citationOrder,
  onSelect,
  onScrollToMarker,
  onUpdateCitation,
  onSetStyle,
  onSetBibPackage,
  getDisplayText,
  pendingCreate,
  pendingCreateMode,
  onCreateCitation,
  onInsertCitation,
  onClearPendingCreate,
  onStartCreate,
  editor,
  panelSide,
  citationPositions,
  viewMode,
  onViewModeChange,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
}: CitationsPanelProps) {
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "citation"),
    [aiRequests],
  );
  const inTextItems = useMemo(
    () =>
      citations.map((c) => ({
        id: c.id,
        pos: citationPositions.get(c.id) ?? 0,
      })),
    [citations, citationPositions],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    viewMode === "in-text",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const orderedCitations = useMemo(
    () =>
      [...citations].sort((a, b) => {
        const ai = citationOrder.indexOf(a.id);
        const bi = citationOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }),
    [citations, citationOrder],
  );

  const handleBuilderCreate = (command: string) => {
    const id = onCreateCitation(command);
    if (pendingCreateMode === "anchored") {
      const display = getDisplayText(command);
      onInsertCitation(command, id, display);
    }
    onClearPendingCreate();
  };

  const anchoredIds = useMemo(() => new Set(citationOrder), [citationOrder]);

  const jumpToCitation = useCallback(
    (id: string) => {
      onSelect(id);
      onScrollToMarker(id);
    },
    [onSelect, onScrollToMarker],
  );

  const onActivateCitation = useCallback(
    (cit: CitationRef) => {
      jumpToCitation(cit.id);
      requestAnimationFrame(() => {
        const card = panelScrollRef.current?.querySelector(
          `[data-link-card="citation:${cit.id}"]`,
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [jumpToCitation, panelScrollRef],
  );
  const {
    idx: cycleIdx,
    next: cycleNext,
    prev: cyclePrev,
    setIdx: setCycleIdx,
  } = useCycle(orderedCitations, onActivateCitation);

  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = orderedCitations.findIndex((c) => c.id === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, orderedCitations, cycleIdx, setCycleIdx]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (orderedCitations.length === 0) return;
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
    [orderedCitations, cycleNext, cyclePrev],
  );

  const sharedCardProps = {
    bibEntries,
    bibPackage,
    getDisplayText,
    onUpdateCitation,
    getFormattedBib,
    getAnnotation,
    setAnnotation,
    onRequestReview,
    onCancelReview,
    getReviewStatus,
    onUpdateBibEntry,
    onUpdateBibKeyAndType,
  };

  return (
    <CardListPanel
      kind="citations"
      onAdd={() => {
        onStartCreate();
      }}
      onAiRequest={onAddAiRequest}
      headerLeading={
        <div className="relative -ml-3" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-0.5 text-ink-muted hover:text-ink-body transition-colors"
            title="View options"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="8" cy="13" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 bg-surface border border-[var(--border)] rounded-lg shadow-lg z-50 w-48 py-1">
              <div className="px-3 py-1.5 flex items-center justify-end gap-2">
                <PanelThemePicker panelKey="citation" label="Citation color" />
                <ViewToggle mode={viewMode} onChange={onViewModeChange} />
              </div>
              <div className="my-1 border-t border-edge-subtle" />
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">
                Package
              </div>
              {BIB_PACKAGES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => {
                    onSetBibPackage(p.value);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
                >
                  <span>{p.label}</span>
                  <span className="text-[var(--accent)]">
                    {bibPackage === p.value ? "\u2713" : ""}
                  </span>
                </button>
              ))}
              <div className="my-1 border-t border-edge-subtle" />
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">
                Style
              </div>
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    onSetStyle(s.value);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
                >
                  <span>{s.label}</span>
                  <span className="text-[var(--accent)]">
                    {citationStyle === s.value ? "\u2713" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      }
      headerExtras={
        <PrevNextCounter
          current={cycleIdx}
          total={orderedCitations.length}
          label=""
        />
      }
      panelExtras={
        pendingCreate !== null ? (
          <div className="mx-2 mt-2">
            <div className="text-xs font-medium text-ink-subtle mb-1">
              New citation
            </div>
            <CitationBuilder
              initialCommand={
                pendingCreate.includes("{") ? pendingCreate : undefined
              }
              bibPackage={bibPackage}
              bibEntries={bibEntries}
              getDisplayText={getDisplayText}
              onSave={handleBuilderCreate}
              onCancel={onClearPendingCreate}
              saveLabel="Add citation"
            />
          </div>
        ) : null
      }
      items={orderedCitations}
      getId={(c) => c.id}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        !pendingCreate ? (
          <div className={PANEL.empty}>
            <>
              No citations yet. Type{" "}
              <code className="text-xs bg-surface-muted-strong px-1 rounded">
                \cite
              </code>{" "}
              in the editor to add one.
            </>
          </div>
        ) : undefined
      }
      aiRequests={myAiRequests}
      onUpdateAiRequestText={onUpdateAiRequestText}
      onDeleteAiRequest={onDeleteAiRequest}
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={panelScrollRef}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(cit, { selected }) => (
        <CitationCard
          citation={cit}
          isSelected={selected}
          isAnchored={anchoredIds.has(cit.id)}
          onSelect={() => {
            onSelect(selected ? null : cit.id);
            panelScrollRef.current?.focus();
          }}
          onJump={() => jumpToCitation(cit.id)}
          {...sharedCardProps}
        />
      )}
      inTextRenderItem={(cit, { selected }) => (
        <CitationCard
          citation={cit}
          isSelected={selected}
          isAnchored={anchoredIds.has(cit.id)}
          onSelect={() => {
            onSelect(selected ? null : cit.id);
            panelScrollRef.current?.focus();
          }}
          onJump={() => jumpToCitation(cit.id)}
          wrapperClassName={`in-text-connector in-text-connector-${panelSide}`}
          {...sharedCardProps}
        />
      )}
    />
  );
}

export default memo(CitationsPanel);
