"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";

interface CitationPanelProps {
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
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onSetStyle: (style: string) => void;
  onSetBibPackage: (pkg: string) => void;
  getDisplayText: (command: string) => string;
  getFormattedBib: (entry: BibEntry) => string;
  // New citation creation
  pendingCreate: string | null;
  onCreateCitation: (command: string) => string; // returns citationId
  onInsertCitation: (command: string, citationId: string, displayText: string) => void;
  onClearPendingCreate: () => void;
  // All citation nodes from editor, for occurrence counting
  allEditorCitations?: Array<{ citationId: string; command: string; keys: string[] }>;
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

function CitationPanel({
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
  onUpdateBibEntry,
  onSetStyle,
  onSetBibPackage,
  getDisplayText,
  getFormattedBib,
  pendingCreate,
  onCreateCitation,
  onInsertCitation,
  onClearPendingCreate,
  allEditorCitations = [],
}: CitationPanelProps) {
  const [expandedBib, setExpandedBib] = useState<Set<string>>(new Set());
  const [editingCmd, setEditingCmd] = useState<string | null>(null);
  const [editCmdValue, setEditCmdValue] = useState("");
  const [editingBibKey, setEditingBibKey] = useState<string | null>(null);
  const [editBibFields, setEditBibFields] = useState<Record<string, string>>({});
  const [showBibWarning, setShowBibWarning] = useState(false);
  const [newCiteCmd, setNewCiteCmd] = useState("");
  const newCiteRef = useRef<HTMLInputElement>(null);
  // Track which occurrence is active per bib key (for 1/n cycling)
  const [keyOccurrenceIdx, setKeyOccurrenceIdx] = useState<Record<string, number>>({});

  // When a pending create comes in, open the new-cite form
  useEffect(() => {
    if (pendingCreate) {
      setNewCiteCmd(pendingCreate);
      setTimeout(() => newCiteRef.current?.focus(), 50);
    }
  }, [pendingCreate]);

  // Sort citations by document order
  const orderedCitations = [...citations].sort((a, b) => {
    const ai = citationOrder.indexOf(a.id);
    const bi = citationOrder.indexOf(b.id);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const bibMap = new Map(bibEntries.map((e) => [e.key, e]));

  // Build a map of bib key → all citation IDs that reference it (in document order)
  const keyToCitationIds = useCallback(() => {
    const map: Record<string, string[]> = {};
    for (const cit of allEditorCitations) {
      for (const key of cit.keys) {
        if (!map[key]) map[key] = [];
        map[key].push(cit.citationId);
      }
    }
    return map;
  }, [allEditorCitations]);

  // Sync occurrence index when selectedId changes (e.g. from clicking in-text)
  useEffect(() => {
    if (!selectedId) return;
    const occMap = keyToCitationIds();
    for (const [key, ids] of Object.entries(occMap)) {
      const idx = ids.indexOf(selectedId);
      if (idx >= 0) {
        setKeyOccurrenceIdx((prev) => ({ ...prev, [key]: idx }));
      }
    }
  }, [selectedId, keyToCitationIds]);

  const cycleOccurrence = useCallback((key: string, delta: number) => {
    const ids = keyToCitationIds()[key] || [];
    if (ids.length <= 1) return;
    const cur = keyOccurrenceIdx[key] || 0;
    const next = (cur + delta + ids.length) % ids.length;
    const targetId = ids[next];
    setKeyOccurrenceIdx((prev) => ({ ...prev, [key]: next }));
    if (targetId) {
      onSelect(targetId);
      onScrollToMarker(targetId);
      // Scroll panel entry into view too
      requestAnimationFrame(() => {
        const entry = document.querySelector(`[data-citation-entry="${targetId}"]`);
        entry?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }, [keyToCitationIds, keyOccurrenceIdx, onScrollToMarker, onSelect]);

  const toggleBibExpand = (key: string) => {
    setExpandedBib((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

  const startEditBib = (entry: BibEntry) => {
    setEditingBibKey(entry.key);
    setEditBibFields({ ...entry.fields });
    setShowBibWarning(true);
  };

  const commitEditBib = () => {
    if (editingBibKey) {
      onUpdateBibEntry(editingBibKey, editBibFields);
    }
    setEditingBibKey(null);
    setShowBibWarning(false);
  };

  const cancelEditBib = () => {
    setEditingBibKey(null);
    setShowBibWarning(false);
  };

  const handleNewCiteSubmit = () => {
    const cmd = newCiteCmd.trim();
    if (!cmd) return;
    // Ensure it has braces
    const fullCmd = cmd.includes("{") ? cmd : cmd + "{}";
    // Validate it parses
    const id = onCreateCitation(fullCmd);
    const display = getDisplayText(fullCmd);
    onInsertCitation(fullCmd, id, display);
    setNewCiteCmd("");
    onClearPendingCreate();
  };

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-stone-700">
            Reference Notes ({citations.length})
          </h3>
          <div className="flex items-center gap-1.5">
            <select
              value={bibPackage}
              onChange={(e) => onSetBibPackage(e.target.value)}
              className="text-xs border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-600"
            >
              {BIB_PACKAGES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <select
              value={citationStyle}
              onChange={(e) => onSetStyle(e.target.value)}
              className="text-xs border border-stone-300 rounded px-1.5 py-0.5 bg-white text-stone-600"
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
        {bibPath && (
          <div className="text-xs text-stone-400 truncate" title={bibPath}>
            .bib: {bibPath || "references.bib"}
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
      <div className="flex-1 overflow-y-auto">
        {orderedCitations.length === 0 && !pendingCreate && (
          <div className="p-6 text-center text-sm text-[var(--muted)]">
            No citations yet. Type <code className="text-xs bg-stone-100 px-1 rounded">\cite</code> in the editor to add one.
          </div>
        )}

        {orderedCitations.map((cit) => {
          const isSelected = selectedId === cit.id;
          const displayText = getDisplayText(cit.command);
          const bibEntriesForCit = cit.keys.map((k) => bibMap.get(k)).filter(Boolean) as BibEntry[];
          const occMap = keyToCitationIds();

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
                {/* Layer 1: WYSIWYG display + occurrence counter */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="citation-display-line text-sm flex-1">
                    {displayText}
                  </div>
                  {/* Show 1/n counter if any key is cited multiple times */}
                  {cit.keys.some((k) => (occMap[k]?.length || 0) > 1) && (
                    <div className="flex items-center gap-0.5 text-xs text-stone-400 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); cit.keys.forEach((k) => cycleOccurrence(k, -1)); }}
                        className="hover:text-stone-600 px-0.5"
                        title="Previous occurrence"
                      >
                        ▲
                      </button>
                      <span className="font-mono">
                        {(() => {
                          const k = cit.keys[0];
                          const ids = occMap[k] || [];
                          const idx = keyOccurrenceIdx[k] ?? ids.indexOf(cit.id);
                          return `${idx + 1}/${ids.length}`;
                        })()}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); cit.keys.forEach((k) => cycleOccurrence(k, 1)); }}
                        className="hover:text-stone-600 px-0.5"
                        title="Next occurrence"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </div>

                {/* Layer 2: LaTeX command */}
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

                {/* Layer 3: BibTeX entries */}
                {bibEntriesForCit.map((entry) => (
                  <div key={entry.key} className="mb-1.5">
                    <div
                      className="flex items-center gap-1 text-xs text-stone-400 cursor-pointer hover:text-stone-600"
                      onClick={(e) => { e.stopPropagation(); toggleBibExpand(entry.key); }}
                    >
                      <span className="font-mono">@{entry.type}{"{" + entry.key + "}"}</span>
                      <span>{expandedBib.has(entry.key) ? "▾" : "▸"}</span>
                    </div>

                    {expandedBib.has(entry.key) && (
                      <div className="ml-2 mt-1 text-xs text-stone-500 space-y-0.5">
                        {editingBibKey === entry.key ? (
                          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                            {showBibWarning && (
                              <div className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">
                                Warning: editing will modify the .bib file.
                              </div>
                            )}
                            {Object.entries(editBibFields).map(([field, val]) => (
                              <div key={field} className="flex gap-1 items-start">
                                <span className="font-mono text-stone-400 w-16 flex-shrink-0 text-right">{field}:</span>
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) =>
                                    setEditBibFields((prev) => ({ ...prev, [field]: e.target.value }))
                                  }
                                  className="flex-1 font-mono border border-stone-200 rounded px-1 py-0.5 text-xs"
                                />
                              </div>
                            ))}
                            <div className="flex gap-1 mt-1">
                              <button
                                onClick={commitEditBib}
                                className="text-xs px-2 py-0.5 bg-stone-700 text-white rounded hover:bg-stone-800"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditBib}
                                className="text-xs px-2 py-0.5 border border-stone-300 rounded hover:bg-stone-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {Object.entries(entry.fields).map(([field, val]) => (
                              <div key={field}>
                                <span className="font-mono text-stone-400">{field}:</span>{" "}
                                <span className="text-stone-600">{val}</span>
                              </div>
                            ))}
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditBib(entry); }}
                              className="text-xs text-stone-400 hover:text-stone-600 underline mt-0.5"
                            >
                              Edit entry
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Missing keys */}
                {cit.keys.filter((k) => !bibMap.has(k)).map((k) => (
                  <div key={k} className="text-xs text-red-400 mb-1">
                    Key not found in .bib: <span className="font-mono">{k}</span>
                  </div>
                ))}

                {/* Layer 4: Formatted bibliography */}
                {bibEntriesForCit.map((entry) => (
                  <div
                    key={entry.key + "-bib"}
                    className="text-xs text-stone-600 leading-relaxed bib-formatted"
                    dangerouslySetInnerHTML={{ __html: getFormattedBib(entry) }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(CitationPanel);
