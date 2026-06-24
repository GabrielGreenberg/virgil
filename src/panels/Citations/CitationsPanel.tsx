"use client";

import { useMemo, useEffect, useCallback, memo, useRef } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import {
  ItemMenu,
  PANEL,
  useCycle,
  clearStaleHover,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import type { NestedFootnoteInfo } from "@/components/editor-layout/panels/nest-footnote-children";
import { partitionDockedCitations } from "@/components/editor-layout/panels/nest-footnote-children";
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
  onScrollToMarker: (citationId: string, sourceEl?: HTMLElement | null) => void;
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
  onAddBibEntry: (entry: BibEntry) => void;
  recentlyAddedId?: string | null;
  /** Footnote-nested cite nesting (Part B). `citationId → { footnoteId,
   *  footnoteNumber }` for every cite whose `\cite` lives inside a footnote
   *  body, derived snapshot-gated in `CitationsHost` from
   *  `structure.citations[].nestedInFootnoteId` (no per-keystroke doc walk).
   *  Such cites are pulled out of the flat top-level list and rendered as
   *  indented children, tagged "in footnote N" — the docked analog of the omni
   *  "nested under the footnote card" behavior. Absent / empty ⇒ the panel
   *  renders a flat list exactly as before. */
  nestedFootnoteOf?: ReadonlyMap<string, NestedFootnoteInfo>;
}

const STYLES = [
  { value: "apa", label: "APA" },
  { value: "vancouver", label: "Vancouver" },
  { value: "harvard1", label: "Harvard" },
];

/** Stable empty map so the partition memo doesn't churn when the host passes
 *  no nesting info (the common, no-footnote-nested-cite case). */
const EMPTY_NESTED: ReadonlyMap<string, NestedFootnoteInfo> = new Map();

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
  onDeleteCitation,
  onSetStyle,
  onSetBibPackage,
  getDisplayText,
  pendingCreate,
  pendingCreateMode,
  onCreateCitation,
  onInsertCitation,
  onClearPendingCreate,
  onStartCreate,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  onAddBibEntry,
  recentlyAddedId,
  nestedFootnoteOf,
}: CitationsPanelProps) {
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const sortedCitations = useMemo(
    () => {
      const out = [...citations].sort((a, b) => {
        const ai = citationOrder.indexOf(a.id);
        const bi = citationOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      return withRecentlyAddedFirst(out, recentlyAddedId, (c) => c.id);
    },
    [citations, citationOrder, recentlyAddedId],
  );

  // Part B — footnote-child nesting. Split the flat list into top-level cites
  // and footnote-nested children (identity-stable when nothing nests, so the
  // common case pays zero churn). The rendered order is: every flat cite, then
  // the nested cites grouped after — each nested cite carries its host footnote
  // info for the "in footnote N" label + the `ml-4` indent. `orderedCitations`
  // (the array driving CardListPanel + the keyboard cycle + selection) is this
  // combined order so nav/selection stay consistent with what's on screen.
  const { topLevel, nested } = useMemo(
    () => partitionDockedCitations(sortedCitations, nestedFootnoteOf ?? EMPTY_NESTED),
    [sortedCitations, nestedFootnoteOf],
  );
  const orderedCitations = useMemo<CitationRef[]>(
    () =>
      nested.length === 0
        ? [...topLevel]
        : [...topLevel, ...nested.map((n) => n.citation)],
    [topLevel, nested],
  );
  const nestedInfoById = useMemo(() => {
    const m = new Map<string, NestedFootnoteInfo>();
    for (const n of nested) m.set(n.citation.id, n.info);
    return m;
  }, [nested]);
  // (The "In footnotes" section divider is placed in `renderCard` below, on the
  // first nested cite that actually renders — see the flag at the return site.)

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
    (id: string, sourceEl?: HTMLElement | null) => {
      onSelect(id);
      onScrollToMarker(id, sourceEl);
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
    onAddBibEntry,
    getFormattedBib,
    getAnnotation,
    setAnnotation,
    onRequestReview,
    onCancelReview,
    getReviewStatus,
    onUpdateBibEntry,
    onUpdateBibKeyAndType,
  };

  const DRAFT_ID = "__virgil_draft_citation__";
  const draftCitation: CitationRef | null = useMemo(() => {
    if (pendingCreate === null) return null;
    return {
      id: DRAFT_ID,
      command: pendingCreate.includes("{") ? pendingCreate : "",
      keys: [],
      createdAt: new Date().toISOString(),
      unanchored: pendingCreateMode === "unanchored",
    };
  }, [pendingCreate, pendingCreateMode]);

  /** When the draft serialises to its first valid command, promote it to
   *  a real citation. Subsequent updates fall through harmlessly because
   *  pendingCreate is cleared by then. */
  const handleDraftUpdate = useCallback(
    (id: string, command: string) => {
      if (id !== DRAFT_ID) return;
      if (!command) return;
      const newId = onCreateCitation(command);
      if (pendingCreateMode === "anchored") {
        const display = getDisplayText(command);
        onInsertCitation(command, newId, display);
      }
      onClearPendingCreate();
    },
    [
      onCreateCitation,
      pendingCreateMode,
      getDisplayText,
      onInsertCitation,
      onClearPendingCreate,
    ],
  );

  // Render-scoped flag (reset every render): the first nested cite that
  // CardListPanel actually RENDERS gets the "In footnotes" divider. Tracking the
  // first rendered card (not a fixed pre-filter id) keeps the divider present
  // even when the archive-view filter drops the document-first nested cite.
  // `renderCard` is called synchronously in list order during this render.
  let footnoteDividerShown = false;
  return (
    <CardListPanel
      kind="citations"
      count={orderedCitations.length}
      onAdd={() => {
        onStartCreate();
      }}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="citation" label="Citation color" />
          </div>
          <div className="my-1 border-t border-edge-subtle" />
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">
            Package
          </div>
          {BIB_PACKAGES.map((p) => (
            <button
              key={p.value}
              onClick={() => onSetBibPackage(p.value)}
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
              onClick={() => onSetStyle(s.value)}
              className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            >
              <span>{s.label}</span>
              <span className="text-[var(--accent)]">
                {citationStyle === s.value ? "\u2713" : ""}
              </span>
            </button>
          ))}
          <CardViewModeMenuItems kind="citations" />
        </ItemMenu>
      }
      panelExtras={
        draftCitation ? (
          <div className="mx-2 mt-2">
            <div className="text-xs font-medium text-ink-subtle mb-1">
              New citation
            </div>
            <CitationCard
              citation={draftCitation}
              isSelected
              isDraft
              isAnchored={false}
              {...sharedCardProps}
              onUpdateCitation={handleDraftUpdate}
              onSelect={() => {}}
              onJump={() => {}}
              onDelete={() => onClearPendingCreate()}
            />
          </div>
        ) : null
      }
      items={orderedCitations}
      getId={(c) => c.id}
      getArchived={(c) => !!c.archived}
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
      scrollRef={panelScrollRef}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(cit, { selected }) => {
        // Part B — a footnote-nested cite renders indented (`ml-4`, pixel-
        // matching the omni nesting + bib-under-cite) and carries a small
        // "in footnote N" context line above it, the docked analog of sitting
        // under the footnote card. Top-level cites are unchanged.
        //
        // The nested cites are grouped after every top-level cite (see
        // `orderedCitations`), so the first nested card that RENDERS gets an
        // "In footnotes" section divider above it. A render-scoped flag (not a
        // fixed id) keeps the divider present even if the archive-view filter
        // drops the document-first nested cite.
        const nestedInfo = nestedInfoById.get(cit.id);
        const showSectionDivider = nestedInfo != null && !footnoteDividerShown;
        if (showSectionDivider) footnoteDividerShown = true;
        const card = (
          <CitationCard
            citation={cit}
            isSelected={selected}
            isAnchored={anchoredIds.has(cit.id)}
            wrapperClassName={nestedInfo ? "ml-4" : undefined}
            extraDataAttrs={
              nestedInfo
                ? { "data-citation-nested-in-footnote": nestedInfo.footnoteId }
                : undefined
            }
            onSelect={() => {
              // C15: monotonic select — the store is the single selection
              // source; the panel slot mirrors it. Re-click idempotence lives
              // in `ac.onBodyActivate`, not a toggling host slot.
              onSelect(cit.id);
              panelScrollRef.current?.focus();
            }}
            onJump={(sourceEl) => jumpToCitation(cit.id, sourceEl)}
            onDelete={onDeleteCitation}
            {...sharedCardProps}
          />
        );
        if (!nestedInfo) return card;
        return (
          <div data-citation-nested-group="">
            {showSectionDivider && (
              <div className="mt-1 mb-1 px-1 flex items-center gap-2">
                <span className="text-[10px] font-medium text-ink-muted uppercase tracking-wide">
                  In footnotes
                </span>
                <span className="flex-1 border-t border-edge-subtle" />
              </div>
            )}
            <div className="ml-4 mb-0.5 text-[10px] font-medium text-ink-muted">
              {nestedInfo.footnoteNumber != null
                ? `↳ in footnote ${nestedInfo.footnoteNumber}`
                : "↳ in footnote"}
            </div>
            {card}
          </div>
        );
      }}
    />
  );
}

export default memo(CitationsPanel);
