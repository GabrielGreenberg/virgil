"use client";

import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { BibEntry, CitationRef, AiRequest } from "@/lib/types";
import {
  formatMinimalCitation,
  parseCiteCommand,
  serializeCiteCommand,
} from "@/lib/bib-parser";
import ViewToggle, { ViewMode as ToggleViewMode } from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { panelCard, PANEL, PanelHeader, PrevNextCounter, TargetIcon, useCycle, AiRequestCard, AiRequestsSectionHeader, clearStaleHover, cardOverrideStyle, headerOverrideStyle, separatorOverrideStyle } from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import PanelThemePicker from "./PanelThemePicker";
import BibEntryCard from "./BibEntryCard";
import CitationBuilder, { type CitationBuilderHandle } from "./CitationBuilder";
import { MIME_CITATION } from "@/lib/marginalia";

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
  // New citation creation
  pendingCreate: string | null;
  /** "anchored" inserts into the editor at cursor on save (used when
   *  the editor input rule fires); "unanchored" creates a panel-only
   *  citation that the user can later drag into the editor to anchor. */
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
  // Bib entry card props (for expanded bibliography pod)
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
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

/* ── CitationCard ─────────────────────────────────────────────────
   Standalone card component used by CitationsPanel's list and by
   OmniView. Keeps its own edit/expand state so multiple instances
   (e.g. one per citation in the panel list) are independent.
*/

export interface CitationCardProps {
  citation: CitationRef;
  isSelected: boolean;
  bibEntries: BibEntry[];
  bibPackage: string;
  getDisplayText: (command: string) => string;
  onSelect: () => void;
  onJump: () => void;
  onUpdateCitation: (id: string, command: string) => void;
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  /** Whether this citation has a corresponding node in the editor.
   *  Unanchored citations show with a dashed border + reduced opacity
   *  and can be dragged into the editor to anchor them. */
  isAnchored?: boolean;
  /** Extra class names appended to the card wrapper (used by in-text view). */
  wrapperClassName?: string;
  /** Inline style on the card wrapper (used by in-text view positioning). */
  wrapperStyle?: React.CSSProperties;
  /** Extra data-* attributes on the card wrapper (e.g. data-omni-entry). */
  extraDataAttrs?: Record<string, string>;
}

export function CitationCard({
  citation: cit,
  isSelected,
  bibEntries,
  bibPackage,
  getDisplayText,
  onSelect,
  onJump,
  onUpdateCitation,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  isAnchored = true,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
}: CitationCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [expandedBibKey, setExpandedBibKey] = useState<string | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const editWrapperRef = useRef<HTMLDivElement>(null);
  const builderHandleRef = useRef<CitationBuilderHandle>(null);
  const theme = useCardTheme("citation");

  const bibEntryMap = useMemo(
    () => new Map(bibEntries.map((e) => [e.key, e])),
    [bibEntries],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const display = getDisplayText(cit.command);
      const plain = display.replace(/<[^>]+>/g, "");
      e.dataTransfer.setData("text/plain", cit.command);
      e.dataTransfer.setData(
        MIME_CITATION,
        JSON.stringify({ command: cit.command, citationId: cit.id }),
      );
      e.dataTransfer.effectAllowed = "copy";
      const ghost = document.createElement("div");
      ghost.textContent =
        plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 14);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    },
    [cit, getDisplayText],
  );

  const handleBuilderEdit = useCallback(
    (command: string) => {
      onUpdateCitation(cit.id, command);
      setIsEditing(false);
    },
    [cit.id, onUpdateCitation],
  );

  // Click-outside auto-save: when the builder is open and the user clicks
  // anywhere outside the edit wrapper, commit the current builder state
  // (if it's a valid, non-empty command) and close the editor. The Save
  // and Cancel buttons inside the builder remain available and take
  // precedence since they live inside the wrapper.
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: MouseEvent) => {
      const wrapper = editWrapperRef.current;
      if (!wrapper || wrapper.contains(e.target as Node)) return;
      // Commit current builder state if it's valid (no-op if empty).
      builderHandleRef.current?.commit();
      setIsEditing(false);
    };
    // Use mousedown so we fire before focus/blur handlers inside inputs.
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isEditing]);

  const toggleBibKey = useCallback((key: string) => {
    setExpandedBibKey((prev) => (prev === key ? null : key));
  }, []);

  const expandedEntry = expandedBibKey
    ? bibEntryMap.get(expandedBibKey)
    : undefined;

  // Build a single-key citation command for dragging the expanded bib
  // pod. We preserve the parent citation's command type (e.g. \citep),
  // starred/capitalized variant, and drop any pre/post notes. If the
  // parent command can't be parsed, fall back to a plain \cite{key}.
  const buildSingleKeyCommand = useCallback(
    (key: string): string => {
      const parsed = parseCiteCommand(cit.command);
      if (!parsed) return `\\cite{${key}}`;
      return serializeCiteCommand(
        {
          type: parsed.type,
          starred: parsed.starred,
          capitalized: parsed.capitalized,
          entries: [{ key }],
        },
        bibPackage,
      );
    },
    [cit.command, bibPackage],
  );

  const handleBibPodDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!expandedBibKey) return;
      // Stop propagation so the parent card's drag handler doesn't also
      // fire and overwrite the dataTransfer with the multi-key parent
      // citation. The expanded bib pod must drag *only* its own key.
      e.stopPropagation();
      const cmd = buildSingleKeyCommand(expandedBibKey);
      const display = getDisplayText(cmd);
      const plain = display.replace(/<[^>]+>/g, "");
      e.dataTransfer.setData("text/plain", cmd);
      e.dataTransfer.setData(
        MIME_CITATION,
        JSON.stringify({ command: cmd, bibKey: expandedBibKey }),
      );
      e.dataTransfer.effectAllowed = "copy";
      const ghost = document.createElement("div");
      ghost.textContent =
        plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 14);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    },
    [expandedBibKey, buildSingleKeyCommand, getDisplayText],
  );

  // Drop handler: when a bibliography card (or expanded bib pod) is
  // dropped onto this citation card, append its key to this citation's
  // command. The drop data follows the same `application/x-virgil-citation`
  // shape used by other drag sources, with `bibKey` set on bib drops.
  const handleCardDragOver = useCallback((e: React.DragEvent) => {
    // Look at types only (Chrome doesn't expose dataTransfer.getData here).
    if (!e.dataTransfer.types.includes(MIME_CITATION)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!isDropTarget) setIsDropTarget(true);
  }, [isDropTarget]);

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    // currentTarget = the card; relatedTarget = where pointer moved to.
    // Only clear when leaving the card entirely, not when moving between
    // children.
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    setIsDropTarget(false);
  }, []);

  const handleCardDrop = useCallback(
    (e: React.DragEvent) => {
      const data = e.dataTransfer.getData(MIME_CITATION);
      if (!data) return;
      let parsed: { command?: string; bibKey?: string; citationId?: string };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      // Only react to bib-entry / bib-pod drops; ignore drops from other
      // citation cards (those carry a citationId, no bibKey).
      if (!parsed.bibKey) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDropTarget(false);

      const current = parseCiteCommand(cit.command);
      if (!current) return;
      // Don't add a key that's already present.
      if (current.entries.some((en) => en.key === parsed.bibKey)) return;
      const newCommand = serializeCiteCommand(
        {
          type: current.type,
          starred: current.starred,
          capitalized: current.capitalized,
          entries: [...current.entries, { key: parsed.bibKey! }],
        },
        bibPackage,
      );
      onUpdateCitation(cit.id, newCommand);
    },
    [cit.id, cit.command, bibPackage, onUpdateCitation],
  );

  // Compose the card class. Unanchored citations get a dashed border
  // and slightly muted appearance so they're visually distinct from
  // the in-text anchored ones. The drop-target ring overrides those
  // borders while a bib drag hovers.
  const stateClass = isDropTarget
    ? "ring-2 ring-amber-300 ring-offset-0"
    : !isAnchored
      ? "border-dashed opacity-80"
      : "";

  return (
    <div
      data-citation-entry={cit.id}
      {...(extraDataAttrs || {})}
      draggable={!isEditing}
      onDragStart={handleDragStart}
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={handleCardDrop}
      className={`group ${panelCard(isSelected, `cursor-pointer cursor-grab active:cursor-grabbing ${stateClass}`)}${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={{ ...cardOverrideStyle(theme, isSelected), ...wrapperStyle }}
      onClick={onSelect}
      title={!isAnchored ? "Unanchored citation — drag into the editor to anchor it" : undefined}
    >
      {isEditing ? (
        <div className={PANEL.cardInner}>
          <div ref={editWrapperRef} onClick={(e) => e.stopPropagation()}>
            <CitationBuilder
              ref={builderHandleRef}
              initialCommand={cit.command}
              bibPackage={bibPackage}
              bibEntries={bibEntries}
              getDisplayText={getDisplayText}
              onSave={handleBuilderEdit}
              onCancel={() => setIsEditing(false)}
              saveLabel="Save"
            />
          </div>
        </div>
      ) : (
        <>
          {/* Header: bib-key chips + target icon trailing */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 ${isSelected ? theme.headerSelected : theme.headerDefault}`}
            style={headerOverrideStyle(theme, isSelected)}
          >
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {cit.keys.map((key) => {
                const entry = bibEntryMap.get(key);
                const isActive = expandedBibKey === key;
                const label = entry
                  ? formatMinimalCitation(key, bibEntries)
                  : key;
                return (
                  <button
                    key={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBibKey(key);
                    }}
                    className={`inline-block rounded-[3px] border px-1.5 py-0.5 text-xs cursor-pointer transition-colors ${
                      !entry
                        ? "border-dashed border-red-300 text-red-400 bg-red-50/50"
                        : isActive
                          ? "bg-[#fef3c3] border-[#d4a843] text-[#4a3f20]"
                          : "bg-[#fdf8e1] border-[#e0d5a8] text-[#6b6245] hover:bg-[#fef3c3] hover:border-[#d4a843]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div
              className={`shrink-0 transition-opacity ${isSelected ? "opacity-100" : "opacity-60"}`}
              draggable={false}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <TargetIcon onClick={onJump} title="Jump to citation" />
            </div>
          </div>

          {/* Separator */}
          <div
            className={`border-t transition-colors ${isSelected ? theme.separatorSelected : "border-stone-200 group-hover:border-stone-300"}`}
            style={separatorOverrideStyle(theme, isSelected)}
          />

          {/* Body: command preview + edit, missing-key warnings, expanded bib pod */}
          <div className={PANEL.cardInner}>
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="text-xs font-mono text-stone-500 truncate flex-1 min-w-0">
                {cit.command}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-stone-200 text-stone-400 hover:text-stone-600 hover:bg-stone-100 hover:border-stone-300 transition-colors flex-shrink-0"
                title="Edit citation"
              >
                Edit
              </button>
            </div>

            {/* Missing keys */}
            {cit.keys
              .filter((k) => !bibEntryMap.has(k))
              .map((k) => (
                <div key={k} className="text-xs text-red-400 mt-1">
                  Key not found in .bib: <span className="font-mono">{k}</span>
                </div>
              ))}

            {/* Expanded bibliography pod — draggable, drops as a
                single-key citation for the key the user selected (not
                the parent multi-key command, and not the full bib card). */}
            {expandedEntry && (
              <div
                draggable
                onDragStart={handleBibPodDragStart}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 rounded-md border border-stone-200 bg-stone-50/40 p-2 cursor-grab active:cursor-grabbing"
                title="Drag to insert this citation"
              >
                <BibEntryCard
                  entry={expandedEntry}
                  isSelected={false}
                  onClick={() => {}}
                  getFormattedBib={getFormattedBib}
                  getAnnotation={getAnnotation}
                  setAnnotation={setAnnotation}
                  onRequestReview={onRequestReview}
                  onCancelReview={onCancelReview}
                  getReviewStatus={getReviewStatus}
                  onUpdateBibEntry={onUpdateBibEntry}
                  onUpdateBibKeyAndType={onUpdateBibKeyAndType}
                  bibPackage={bibPackage}
                  bibEntries={bibEntries}
                  compact
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CitationsPanel({
  citations, bibEntries, citationStyle, bibPackage, bibPath, selectedId, citationOrder,
  onSelect, onScrollToMarker, onUpdateCitation, onDeleteCitation, onSetStyle, onSetBibPackage,
  getDisplayText, pendingCreate, pendingCreateMode, onCreateCitation, onInsertCitation, onClearPendingCreate, onStartCreate,
  editor, panelSide, citationPositions,
  viewMode: toggleViewMode, onViewModeChange: handleToggleViewMode,
  getFormattedBib, getAnnotation, setAnnotation, onRequestReview, onCancelReview,
  getReviewStatus, onUpdateBibEntry, onUpdateBibKeyAndType,
  aiRequests, onAddAiRequest, onUpdateAiRequestText, onDeleteAiRequest,
}: CitationsPanelProps) {
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "citation"),
    [aiRequests],
  );
  const inTextItems = useMemo(
    () => citations.map((c) => ({ id: c.id, pos: citationPositions.get(c.id) ?? 0 })),
    [citations, citationPositions]
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor, inTextItems, toggleViewMode === "in-text"
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // `panelScrollRef` doubles as the keyboard-focus target and the handle we use
  // to scroll the selected card into view. It's always attached to the outer
  // list div; `useInTextPositions` only consults it when enabled.

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const orderedCitations = useMemo(() =>
    [...citations].sort((a, b) => {
      const ai = citationOrder.indexOf(a.id);
      const bi = citationOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }),
    [citations, citationOrder]
  );

  const handleBuilderCreate = (command: string) => {
    const id = onCreateCitation(command);
    if (pendingCreateMode === "anchored") {
      const display = getDisplayText(command);
      onInsertCitation(command, id, display);
    }
    onClearPendingCreate();
  };

  // Set of ids that have a corresponding citation node in the editor.
  // Anything in `citations` whose id is missing here is unanchored —
  // i.e. created via the panel + button and not yet dragged into text.
  const anchoredIds = useMemo(() => new Set(citationOrder), [citationOrder]);

  const visibleCitations = orderedCitations;

  // Target-button action: select the citation (which triggers the
  // persistent highlight sync in EditorLayout) and jump the editor to
  // its node. Card click-to-select alone does not jump — it only
  // highlights — per the sync rules.
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
      // Scroll the selected card into view within the panel list
      requestAnimationFrame(() => {
        const card = panelScrollRef.current?.querySelector(
          `[data-citation-entry="${cit.id}"]`,
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [jumpToCitation, panelScrollRef],
  );
  const { idx: cycleIdx, next: cycleNext, prev: cyclePrev, setIdx: setCycleIdx } =
    useCycle(orderedCitations, onActivateCitation);

  // Sync external selection back to cycle index — including deselect
  // (clears the cycle so the counter shows the plain total again).
  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = orderedCitations.findIndex((c) => c.id === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, orderedCitations, cycleIdx, setCycleIdx]);

  // Arrow-key navigation — mirrors SearchPanel's pattern
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

  // Shared card props derived from panel props — avoids repeating the
  // long bib-card pass-through list in both view-mode branches.
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
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      {/* Header */}
      <PanelHeader
        title="Citations"
        onAdd={() => { onStartCreate(); }}
        onAiRequest={onAddAiRequest}
      >
        <div className="flex items-center gap-1.5">
          <PrevNextCounter
            current={cycleIdx}
            total={orderedCitations.length}
            label=""
          />
          <div className="relative -mr-1" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-lg shadow-lg z-50 w-48 py-1">
                <div className="px-3 py-1.5 flex items-center justify-end gap-2">
                  <PanelThemePicker panelKey="citation" label="Citation color" />
                  <ViewToggle mode={toggleViewMode} onChange={handleToggleViewMode} />
                </div>
                <div className="my-1 border-t border-stone-200" />
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-stone-400 uppercase tracking-wide">Package</div>
                {BIB_PACKAGES.map((p) => (
                  <button key={p.value} onClick={() => { onSetBibPackage(p.value); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3">
                    <span>{p.label}</span>
                    <span className="text-[var(--accent)]">{bibPackage === p.value ? "\u2713" : ""}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-stone-200" />
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-stone-400 uppercase tracking-wide">Style</div>
                {STYLES.map((s) => (
                  <button key={s.value} onClick={() => { onSetStyle(s.value); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3">
                    <span>{s.label}</span>
                    <span className="text-[var(--accent)]">{citationStyle === s.value ? "\u2713" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PanelHeader>

      {/* New citation builder */}
      {pendingCreate !== null && (
        <div className="mx-2 mt-2">
          <div className="text-xs font-medium text-stone-500 mb-1">New citation</div>
          <CitationBuilder
            initialCommand={pendingCreate.includes("{") ? pendingCreate : undefined}
            bibPackage={bibPackage}
            bibEntries={bibEntries}
            getDisplayText={getDisplayText}
            onSave={handleBuilderCreate}
            onCancel={onClearPendingCreate}
            saveLabel="Add citation"
          />
        </div>
      )}

      {/* Citation list */}
      <div
        ref={panelScrollRef}
        tabIndex={0}
        onKeyDown={handleNavKeys}
        className={`${toggleViewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list} focus:outline-none`}
      >
        {visibleCitations.length === 0 && !pendingCreate && (
          <div className={PANEL.empty}>
            <>No citations yet. Type <code className="text-xs bg-stone-100 px-1 rounded">\cite</code> in the editor to add one.</>
          </div>
        )}

        {toggleViewMode === "in-text" && visibleCitations.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {visibleCitations.map((cit) => {
              const top = positions.get(cit.id);
              if (top === undefined) return null;
              const isSelected = selectedId === cit.id;
              return (
                <CitationCard
                  key={cit.id}
                  citation={cit}
                  isSelected={isSelected}
                  isAnchored={anchoredIds.has(cit.id)}
                  onSelect={() => {
                    onSelect(isSelected ? null : cit.id);
                    panelScrollRef.current?.focus();
                  }}
                  onJump={() => jumpToCitation(cit.id)}
                  wrapperClassName={`absolute left-2 right-2 in-text-connector in-text-connector-${panelSide}`}
                  wrapperStyle={{ top }}
                  {...sharedCardProps}
                />
              );
            })}
          </div>
        ) : (
          <>
            {myAiRequests.length > 0 && (
              <>
                <AiRequestsSectionHeader count={myAiRequests.length} />
                {myAiRequests.map((req) => (
                  <AiRequestCard
                    key={req.id}
                    request={req}
                    onChangeText={(text) => onUpdateAiRequestText?.(req.id, text)}
                    onDelete={() => onDeleteAiRequest?.(req.id)}
                  />
                ))}
              </>
            )}

            {visibleCitations.map((cit) => {
              const isSelected = selectedId === cit.id;
              return (
                <CitationCard
                  key={cit.id}
                  citation={cit}
                  isSelected={isSelected}
                  isAnchored={anchoredIds.has(cit.id)}
                  onSelect={() => {
                    onSelect(isSelected ? null : cit.id);
                    panelScrollRef.current?.focus();
                  }}
                  onJump={() => jumpToCitation(cit.id)}
                  {...sharedCardProps}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(CitationsPanel);
