"use client";

import { useState, useCallback, useMemo, memo } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";

interface BibliographyPanelProps {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  selectedBibKey: string | null;
  onSelectBibKey: (key: string | null) => void;
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  getFormattedBib: (entry: BibEntry) => string;
  // Annotations
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  // Occurrence cycling
  allEditorCitations?: Array<{ citationId: string; command: string; keys: string[] }>;
  onScrollToCitation?: (citationId: string) => void;
  // Notify parent of the currently active citation ID (for connector lines)
  onActiveCitationChange?: (citationId: string | null) => void;
}

function BibliographyPanel({
  citations,
  bibEntries,
  selectedBibKey,
  onSelectBibKey,
  onUpdateBibEntry,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  allEditorCitations = [],
  onScrollToCitation,
  onActiveCitationChange,
}: BibliographyPanelProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [expandedAnnotations, setExpandedAnnotations] = useState<Set<string>>(new Set());
  const [editingBibKey, setEditingBibKey] = useState<string | null>(null);
  const [editBibFields, setEditBibFields] = useState<Record<string, string>>({});
  const [showBibWarning, setShowBibWarning] = useState(false);
  const [keyOccurrenceIdx, setKeyOccurrenceIdx] = useState<Record<string, number>>({});

  // Map bib key → all citation IDs that reference it (in document order)
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

  const cycleOccurrence = useCallback((key: string, delta: number) => {
    const ids = keyToCitationIds()[key] || [];
    if (ids.length <= 1) return;
    const cur = keyOccurrenceIdx[key] || 0;
    const next = (cur + delta + ids.length) % ids.length;
    setKeyOccurrenceIdx((prev) => ({ ...prev, [key]: next }));
    const targetId = ids[next];
    if (targetId) {
      onScrollToCitation?.(targetId);
      onActiveCitationChange?.(targetId);
    }
  }, [keyToCitationIds, keyOccurrenceIdx, onScrollToCitation, onActiveCitationChange]);

  // When a bib key is selected, scroll to and activate its first (or current) occurrence
  const handleSelectBibKey = useCallback((key: string | null) => {
    onSelectBibKey(key);
    if (key) {
      const ids = keyToCitationIds()[key] || [];
      const idx = keyOccurrenceIdx[key] || 0;
      const targetId = ids[idx] || ids[0];
      if (targetId) {
        onScrollToCitation?.(targetId);
        onActiveCitationChange?.(targetId);
      }
    } else {
      onActiveCitationChange?.(null);
    }
  }, [onSelectBibKey, keyToCitationIds, keyOccurrenceIdx, onScrollToCitation, onActiveCitationChange]);

  // Collect all unique bib keys that are actually cited
  const citedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cit of citations) {
      for (const k of cit.keys) keys.add(k);
    }
    return keys;
  }, [citations]);

  // Filter bib entries to only cited ones, deduplicate by key, sorted alphabetically
  const sortedEntries = useMemo(() => {
    const seen = new Set<string>();
    const cited = bibEntries.filter((e) => {
      if (!citedKeys.has(e.key) || seen.has(e.key)) return false;
      seen.add(e.key);
      return true;
    });
    return cited.sort((a, b) => {
      const authorA = (a.fields.author || a.key).toLowerCase();
      const authorB = (b.fields.author || b.key).toLowerCase();
      return authorA.localeCompare(authorB);
    });
  }, [bibEntries, citedKeys]);

  const toggleExpand = (key: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAnnotation = (key: string) => {
    setExpandedAnnotations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  // Count how many citation commands reference a given key
  const citationCountForKey = useCallback((key: string) => {
    return citations.filter((c) => c.keys.includes(key)).length;
  }, [citations]);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-semibold text-stone-700">
          Bibliography ({sortedEntries.length})
        </h3>
      </div>

      {/* Bibliography list */}
      <div className="flex-1 overflow-y-auto">
        {sortedEntries.length === 0 && (
          <div className="p-6 text-center text-sm text-[var(--muted)]">
            No cited entries found. Add citations in the editor and ensure a .bib file is available.
          </div>
        )}

        {sortedEntries.map((entry) => {
          const isSelected = selectedBibKey === entry.key;
          const count = citationCountForKey(entry.key);
          const annotation = getAnnotation(entry.key);
          const isAnnotationOpen = expandedAnnotations.has(entry.key);

          return (
            <div
              key={entry.key}
              data-bib-entry={entry.key}
              className={`border-b border-[var(--border)] cursor-pointer transition-colors ${
                isSelected ? "bg-amber-50 border-l-2 border-l-amber-400" : "hover:bg-stone-50"
              }`}
              onClick={() => handleSelectBibKey(isSelected ? null : entry.key)}
            >
              <div className="px-4 py-2.5 relative">
                {/* Occurrence counter — top right */}
                {(() => {
                  const ids = keyToCitationIds()[entry.key] || [];
                  if (ids.length <= 1) return null;
                  const idx = keyOccurrenceIdx[entry.key] || 0;
                  return (
                    <div
                      className="absolute top-2 right-3 flex items-center gap-0.5 text-xs text-stone-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => cycleOccurrence(entry.key, -1)}
                        className="hover:text-stone-600 px-0.5"
                        title="Previous occurrence"
                      >
                        ▲
                      </button>
                      <span className="font-mono">{idx + 1}/{ids.length}</span>
                      <button
                        onClick={() => cycleOccurrence(entry.key, 1)}
                        className="hover:text-stone-600 px-0.5"
                        title="Next occurrence"
                      >
                        ▼
                      </button>
                    </div>
                  );
                })()}

                {/* Formatted bibliography */}
                <div
                  className="text-sm text-stone-700 leading-relaxed bib-formatted pr-16"
                  dangerouslySetInnerHTML={{ __html: getFormattedBib(entry) }}
                />

                {/* Key */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-mono text-stone-400">
                    @{entry.type}{"{" + entry.key + "}"}
                  </span>
                </div>

                {/* Expandable fields */}
                {expandedEntries.has(entry.key) && (
                  <div className="ml-2 mt-2 text-xs text-stone-500 space-y-0.5">
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

                {/* Action buttons row */}
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(entry.key); }}
                    className="text-xs text-stone-400 hover:text-stone-600"
                  >
                    {expandedEntries.has(entry.key) ? "Hide fields ▾" : "Show fields ▸"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleAnnotation(entry.key); }}
                    className={`text-xs hover:text-stone-600 ${
                      annotation ? "text-amber-600" : "text-stone-400"
                    }`}
                  >
                    {isAnnotationOpen ? "Hide notes ▾" : annotation ? "Notes ▸" : "Add notes ▸"}
                  </button>
                </div>

                {/* Annotation textarea */}
                {isAnnotationOpen && (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={annotation}
                      onChange={(e) => setAnnotation(entry.key, e.target.value)}
                      placeholder="Add your notes about this reference..."
                      className="w-full text-xs border border-stone-200 rounded px-2 py-1.5 bg-white text-stone-600 resize-y min-h-[60px] focus:outline-none focus:border-amber-300"
                      rows={3}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(BibliographyPanel);
