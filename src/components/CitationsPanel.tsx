"use client";

import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { BibEntry, CitationRef } from "@/lib/types";
import { formatMinimalCitation } from "@/lib/bib-parser";
import ViewToggle, { ViewMode as ToggleViewMode } from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import { panelCard, PANEL, PanelHeader } from "./panel-primitives";
import BibEntryCard from "./BibEntryCard";
import CitationBuilder from "./CitationBuilder";

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
  citations, bibEntries, citationStyle, bibPackage, bibPath, selectedId, citationOrder,
  onSelect, onScrollToMarker, onUpdateCitation, onDeleteCitation, onSetStyle, onSetBibPackage,
  getDisplayText, pendingCreate, onCreateCitation, onInsertCitation, onClearPendingCreate, onStartCreate,
  editor, panelSide, citationPositions,
  viewMode: toggleViewMode, onViewModeChange: handleToggleViewMode,
  getFormattedBib, getAnnotation, setAnnotation, onRequestReview, onCancelReview,
  getReviewStatus, onUpdateBibEntry, onUpdateBibKeyAndType,
}: CitationsPanelProps) {
  const inTextItems = useMemo(
    () => citations.map((c) => ({ id: c.id, pos: citationPositions.get(c.id) ?? 0 })),
    [citations, citationPositions]
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor, inTextItems, toggleViewMode === "in-text"
  );
  const [editingCmd, setEditingCmd] = useState<string | null>(null);
  const [editCmdValue, setEditCmdValue] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelInitiatedCreate, setPanelInitiatedCreate] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Per-citation: which bib key's pod is expanded (null = none)
  const [expandedBibKeys, setExpandedBibKeys] = useState<Record<string, string | null>>({});

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

  const startEditCmd = (cit: CitationRef) => {
    setEditingCmd(cit.id);
    setEditCmdValue(cit.command);
  };

  const commitEditCmd = () => {
    if (editingCmd && editCmdValue.trim()) {
      onUpdateCitation(editingCmd, editCmdValue.trim());
    }
    setEditingCmd(null);
  };

  const handleBuilderSubmit = useCallback((command: string) => {
    const id = onCreateCitation(command);
    if (!panelInitiatedCreate) {
      const display = getDisplayText(command);
      onInsertCitation(command, id, display);
    }
    setPanelInitiatedCreate(false);
    onClearPendingCreate();
  }, [onCreateCitation, getDisplayText, onInsertCitation, onClearPendingCreate, panelInitiatedCreate]);

  const visibleCitations = orderedCitations;

  const bibEntryMap = useMemo(
    () => new Map(bibEntries.map((e) => [e.key, e])),
    [bibEntries]
  );

  const handleCiteDragStart = useCallback((e: React.DragEvent, cit: CitationRef) => {
    const display = getDisplayText(cit.command);
    e.dataTransfer.setData("text/plain", cit.command);
    e.dataTransfer.setData("application/x-virgil-citation", JSON.stringify({ command: cit.command, citationId: cit.id }));
    e.dataTransfer.effectAllowed = "copy";
    const ghost = document.createElement("div");
    ghost.textContent = display.length > 80 ? display.slice(0, 80) + "\u2026" : display;
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 14);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, [getDisplayText]);

  const toggleBibKey = (citId: string, key: string) => {
    setExpandedBibKeys((prev) => ({
      ...prev,
      [citId]: prev[citId] === key ? null : key,
    }));
  };

  /* ── Shared card content (used in both views) ──────────────────── */
  const renderCardContent = (cit: CitationRef) => {
    const expandedKey = expandedBibKeys[cit.id] ?? null;
    const expandedEntry = expandedKey ? bibEntryMap.get(expandedKey) : undefined;

    return (
      <>
        {/* Citation key buttons */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {cit.keys.map((key) => {
            const entry = bibEntryMap.get(key);
            const isActive = expandedKey === key;
            const label = entry ? formatMinimalCitation(key, bibEntries) : key;
            return (
              <button
                key={key}
                onClick={(e) => { e.stopPropagation(); toggleBibKey(cit.id, key); }}
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

        {/* LaTeX command (editable) */}
        {editingCmd === cit.id ? (
          <div className="mb-1.5">
            <input
              type="text"
              value={editCmdValue}
              onChange={(e) => setEditCmdValue(e.target.value)}
              onBlur={commitEditCmd}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEditCmd();
                if (e.key === "Escape") setEditingCmd(null);
              }}
              autoFocus
              className="w-full text-xs font-mono border border-stone-300 rounded px-2 py-1"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <div
            className="text-xs font-mono text-stone-500 mb-1.5 hover:text-stone-700 cursor-text truncate"
            onClick={(e) => { e.stopPropagation(); startEditCmd(cit); }}
            title="Click to edit command"
          >
            {cit.command}
          </div>
        )}

        {/* Missing keys */}
        {cit.keys.filter((k) => !bibEntryMap.has(k)).map((k) => (
          <div key={k} className="text-xs text-red-400 mb-1">
            Key not found in .bib: <span className="font-mono">{k}</span>
          </div>
        ))}

        {/* Expanded bibliography pod */}
        {expandedEntry && (
          <div className="mt-2 border-t border-stone-100 pt-2">
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
      </>
    );
  };

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      {/* Header */}
      <PanelHeader title="Citations" count={citations.length} onAdd={() => { setPanelInitiatedCreate(true); onStartCreate(); }}>
        <div className="flex items-center gap-1.5">
          <ViewToggle mode={toggleViewMode} onChange={handleToggleViewMode} />
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50 w-48 py-1">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Package</div>
                {BIB_PACKAGES.map((p) => (
                  <button key={p.value} onClick={() => { onSetBibPackage(p.value); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 flex items-center gap-2">
                    <span className="w-4 text-center text-stone-400">{bibPackage === p.value ? "\u2713" : ""}</span>
                    {p.label}
                  </button>
                ))}
                <div className="border-t border-stone-100 my-1" />
                <div className="px-3 py-1.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Style</div>
                {STYLES.map((s) => (
                  <button key={s.value} onClick={() => { onSetStyle(s.value); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 flex items-center gap-2">
                    <span className="w-4 text-center text-stone-400">{citationStyle === s.value ? "\u2713" : ""}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PanelHeader>

      {/* New citation form */}
      {pendingCreate !== null && (
        <CitationBuilder
          bibEntries={bibEntries}
          bibPackage={bibPackage}
          pendingCreate={pendingCreate}
          getDisplayText={getDisplayText}
          onSubmit={handleBuilderSubmit}
          onCancel={() => { setPanelInitiatedCreate(false); onClearPendingCreate(); }}
        />
      )}

      {/* Citation list */}
      <div
        ref={toggleViewMode === "in-text" ? panelScrollRef : undefined}
        className={toggleViewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
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
                <div
                  key={cit.id}
                  data-citation-entry={cit.id}
                  draggable
                  onDragStart={(e) => handleCiteDragStart(e, cit)}
                  className={`absolute left-2 right-2 ${panelCard(isSelected, "cursor-pointer cursor-grab active:cursor-grabbing")} in-text-connector in-text-connector-${panelSide}`}
                  style={{ top }}
                  onClick={() => { onSelect(isSelected ? null : cit.id); onScrollToMarker(cit.id); }}
                >
                  <div className={PANEL.cardInner}>
                    {renderCardContent(cit)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          visibleCitations.map((cit) => {
            const isSelected = selectedId === cit.id;
            return (
              <div
                key={cit.id}
                data-citation-entry={cit.id}
                draggable
                onDragStart={(e) => handleCiteDragStart(e, cit)}
                className={panelCard(isSelected, "cursor-pointer cursor-grab active:cursor-grabbing")}
                onClick={() => { onSelect(isSelected ? null : cit.id); onScrollToMarker(cit.id); }}
              >
                <div className={PANEL.cardInner}>
                  {renderCardContent(cit)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default memo(CitationsPanel);
