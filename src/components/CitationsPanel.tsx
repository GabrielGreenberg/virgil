"use client";

import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { BibEntry, CitationRef } from "@/lib/types";
import ViewToggle, { ViewMode as ToggleViewMode } from "./ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";

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
  editor: Editor | null;
  panelSide: "left" | "right";
  citationPositions: Map<string, number>; // citationId → doc pos
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
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

type ViewMode = "selected" | "all";

function CitationsPanel({
  citations,
  bibEntries,
  citationStyle,
  bibPackage,
  bibPath,
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
  onCreateCitation,
  onInsertCitation,
  onClearPendingCreate,
  editor,
  panelSide,
  citationPositions,
  viewMode: toggleViewMode,
  onViewModeChange: handleToggleViewMode,
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
  const [newCiteCmd, setNewCiteCmd] = useState("");
  const newCiteRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("selected");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (pendingCreate) {
      setNewCiteCmd(pendingCreate);
      setTimeout(() => newCiteRef.current?.focus(), 50);
    }
  }, [pendingCreate]);

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

  const handleNewCiteSubmit = () => {
    const cmd = newCiteCmd.trim();
    if (!cmd) return;
    const fullCmd = cmd.includes("{") ? cmd : cmd + "{}";
    const id = onCreateCitation(fullCmd);
    const display = getDisplayText(fullCmd);
    onInsertCitation(fullCmd, id, display);
    setNewCiteCmd("");
    onClearPendingCreate();
  };

  // Filter by view mode — in-text mode always shows all
  const visibleCitations = toggleViewMode === "in-text"
    ? orderedCitations
    : viewMode === "selected" && selectedId
    ? orderedCitations.filter((c) => c.id === selectedId)
    : orderedCitations;

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-700">
            Citations ({citations.length})
          </h3>
          <div className="flex items-center gap-2">
          <ViewToggle mode={toggleViewMode} onChange={handleToggleViewMode} />
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-xs px-2 py-1 rounded border border-stone-300 bg-white text-stone-500 hover:bg-stone-50 flex items-center gap-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-50 w-48 py-1">
                {/* View mode */}
                <div className="px-3 py-1 text-xs font-medium text-stone-400 uppercase tracking-wide">View</div>
                <button
                  onClick={() => { setViewMode("selected"); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 flex items-center gap-2"
                >
                  <span className="w-4 text-center">{viewMode === "selected" ? "✓" : ""}</span>
                  Selected only
                </button>
                <button
                  onClick={() => { setViewMode("all"); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 flex items-center gap-2"
                >
                  <span className="w-4 text-center">{viewMode === "all" ? "✓" : ""}</span>
                  Show all
                </button>

                <div className="border-t border-stone-100 my-1" />

                {/* Package */}
                <div className="px-3 py-1 text-xs font-medium text-stone-400 uppercase tracking-wide">Package</div>
                {BIB_PACKAGES.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => { onSetBibPackage(p.value); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 flex items-center gap-2"
                  >
                    <span className="w-4 text-center">{bibPackage === p.value ? "✓" : ""}</span>
                    {p.label}
                  </button>
                ))}

                <div className="border-t border-stone-100 my-1" />

                {/* Style */}
                <div className="px-3 py-1 text-xs font-medium text-stone-400 uppercase tracking-wide">Style</div>
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => { onSetStyle(s.value); setMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 flex items-center gap-2"
                  >
                    <span className="w-4 text-center">{citationStyle === s.value ? "✓" : ""}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          </div>
        </div>
        {bibPath && (
          <div className="text-xs text-stone-400 truncate mt-1" title={bibPath}>
            .bib: {bibPath}
          </div>
        )}
      </div>

      {/* New citation form */}
      {pendingCreate !== null && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-amber-50/50">
          <div className="text-xs font-medium text-stone-500 mb-1">New citation</div>
          <div className="flex gap-1.5">
            <input
              ref={newCiteRef}
              type="text"
              value={newCiteCmd}
              onChange={(e) => setNewCiteCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewCiteSubmit();
                if (e.key === "Escape") { setNewCiteCmd(""); onClearPendingCreate(); }
              }}
              placeholder="\citep{key}"
              className="flex-1 text-xs font-mono border border-stone-300 rounded px-2 py-1 bg-white"
            />
            <button
              onClick={handleNewCiteSubmit}
              className="text-xs px-2 py-1 bg-stone-700 text-white rounded hover:bg-stone-800"
            >
              Add
            </button>
          </div>
          {newCiteCmd && getDisplayText(newCiteCmd) !== newCiteCmd && (
            <div className="mt-1 text-xs text-stone-500">
              Preview: <span className="citation-preview">{getDisplayText(newCiteCmd)}</span>
            </div>
          )}
        </div>
      )}

      {/* Citation list */}
      <div
        ref={toggleViewMode === "in-text" ? panelScrollRef : undefined}
        className="flex-1 overflow-y-auto"
      >
        {visibleCitations.length === 0 && !pendingCreate && (
          <div className="p-6 text-center text-sm text-[var(--muted)]">
            {viewMode === "selected" && !selectedId
              ? "Click a citation in the editor to view it here."
              : <>No citations yet. Type <code className="text-xs bg-stone-100 px-1 rounded">\cite</code> in the editor to add one.</>
            }
          </div>
        )}

        {toggleViewMode === "in-text" && visibleCitations.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {visibleCitations.map((cit) => {
              const top = positions.get(cit.id);
              if (top === undefined) return null;
              const displayText = getDisplayText(cit.command);
              return (
                <div
                  key={cit.id}
                  data-citation-entry={cit.id}
                  className={`absolute left-0 right-0 px-3 py-1.5 border-t border-b border-[var(--border)] cursor-pointer transition-colors in-text-connector in-text-connector-${panelSide} ${
                    selectedId === cit.id ? "bg-amber-50 border-l-2 border-l-amber-400" : "hover:bg-stone-50"
                  }`}
                  style={{ top }}
                  onClick={() => { onSelect(selectedId === cit.id ? null : cit.id); onScrollToMarker(cit.id); }}
                >
                  <div className="citation-display-line text-xs">{displayText}</div>
                  <div className="text-[10px] font-mono text-stone-400 mt-0.5 truncate">{cit.command}</div>
                </div>
              );
            })}
          </div>
        ) : (

        visibleCitations.map((cit) => {
          const isSelected = selectedId === cit.id;
          const displayText = getDisplayText(cit.command);

          return (
            <div
              key={cit.id}
              data-citation-entry={cit.id}
              className={`border-b border-[var(--border)] cursor-pointer transition-colors ${
                isSelected ? "bg-amber-50 border-l-2 border-l-amber-400" : "hover:bg-stone-50"
              }`}
              onClick={() => {
                onSelect(isSelected ? null : cit.id);
                onScrollToMarker(cit.id);
              }}
            >
              <div className="px-4 py-2.5">
                {/* WYSIWYG display */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="citation-display-line text-sm flex-1">
                    {displayText}
                  </div>
                </div>

                {/* LaTeX command */}
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
                    className="text-xs font-mono text-stone-500 mb-1.5 hover:text-stone-700 cursor-text"
                    onClick={(e) => { e.stopPropagation(); startEditCmd(cit); }}
                    title="Click to edit command"
                  >
                    {cit.command}
                  </div>
                )}

                {/* Missing keys */}
                {cit.keys.filter((k) => !bibEntries.some((b) => b.key === k)).map((k) => (
                  <div key={k} className="text-xs text-red-400 mb-1">
                    Key not found in .bib: <span className="font-mono">{k}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        }))
        }
      </div>
    </div>
  );
}

export default memo(CitationsPanel);
