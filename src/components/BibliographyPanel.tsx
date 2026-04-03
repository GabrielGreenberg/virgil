"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import { panelCard, PANEL, Chevron, PanelHeader } from "./panel-primitives";

interface BibliographyPanelProps {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  selectedBibKey: string | null;
  onSelectBibKey: (key: string | null) => void;
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  getFormattedBib: (entry: BibEntry) => string;
  // Annotations
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  // Review requests
  onRequestReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  // Occurrence cycling
  allEditorCitations?: Array<{ citationId: string; command: string; keys: string[] }>;
  onScrollToCitation?: (citationId: string) => void;
  onActiveCitationChange?: (citationId: string | null) => void;
}

/* ── Pulsing dot for pending request ──────────────────────────────── */
function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
    </span>
  );
}

/* ── Format toolbar (matches NotesPanel) ──────────────────────────── */
function FormatToolbar({ editorRef }: { editorRef: React.RefObject<HTMLDivElement | null> }) {
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 border-b border-stone-200">
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-stone-600 hover:bg-stone-100 transition-colors"
        title="Bold"
      >
        B
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs italic text-stone-600 hover:bg-stone-100 transition-colors"
        title="Italic"
      >
        I
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs underline text-stone-600 hover:bg-stone-100 transition-colors"
        title="Underline"
      >
        U
      </button>
      <div className="w-px h-4 bg-stone-200 mx-0.5" />
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-stone-600 hover:bg-stone-100 transition-colors"
        title="Bullet list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="2" cy="4" r="1.5" />
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="8" r="1.5" />
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="12" r="1.5" />
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-stone-600 hover:bg-stone-100 transition-colors"
        title="Numbered list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <text x="0" y="5.5" fontSize="5" fontWeight="600">1</text>
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <text x="0" y="9.5" fontSize="5" fontWeight="600">2</text>
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <text x="0" y="13.5" fontSize="5" fontWeight="600">3</text>
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
    </div>
  );
}

/* ── Rich-text annotation editor ──────────────────────────────────── */
function AnnotationEditor({
  bibKey,
  content,
  onUpdate,
}: {
  bibKey: string;
  content: string;
  onUpdate: (key: string, html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== content) {
      editorRef.current.innerHTML = content || "";
    }
  }, [bibKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const html = editorRef.current?.innerHTML || "";
      onUpdate(bibKey, html);
    }, 400);
  }, [bibKey, onUpdate]);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {focused && <FormatToolbar editorRef={editorRef} />}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => e.stopPropagation()}
        className="annotation-editor px-3 py-2 text-sm text-stone-700 leading-relaxed focus:outline-none min-h-[2.5rem]"
        data-placeholder="Write summary notes for this reference..."
      />
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────────────── */
function BibliographyPanel({
  citations,
  bibEntries,
  selectedBibKey,
  onSelectBibKey,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
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
  // Key/type inline editing
  const [editingHandle, setEditingHandle] = useState<string | null>(null);
  const [editHandleKey, setEditHandleKey] = useState("");
  const [editHandleType, setEditHandleType] = useState("");
  // Request notes drafts (per bibKey+type)
  const [requestNoteDrafts, setRequestNoteDrafts] = useState<Record<string, string>>({});
  // Which entries have the request notes input open (key = `${bibKey}:${type}`)
  const [requestNoteOpen, setRequestNoteOpen] = useState<Set<string>>(new Set());

  const draftKey = (bibKey: string, type: string) => `${bibKey}:${type}`;

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

  const citedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cit of citations) {
      for (const k of cit.keys) keys.add(k);
    }
    return keys;
  }, [citations]);

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

  const startEditHandle = (entry: BibEntry) => {
    setEditingHandle(entry.key);
    setEditHandleKey(entry.key);
    setEditHandleType(entry.type);
  };

  const commitEditHandle = () => {
    if (editingHandle && editHandleKey.trim()) {
      onUpdateBibKeyAndType(editingHandle, editHandleKey.trim(), editHandleType.trim());
    }
    setEditingHandle(null);
  };

  const cancelEditHandle = () => {
    setEditingHandle(null);
  };

  // Request button handler — toggles between request and cancel
  const handleRequestToggle = (bibKey: string, type: "fields" | "notes") => {
    const status = getReviewStatus(bibKey, type);
    const dk = draftKey(bibKey, type);
    if (status === "pending") {
      // Cancel the request
      onCancelReview(bibKey, type);
      // Close the notes input and clear draft
      setRequestNoteOpen((prev) => { const n = new Set(prev); n.delete(dk); return n; });
      setRequestNoteDrafts((prev) => { const n = { ...prev }; delete n[dk]; return n; });
    } else {
      // Submit the request with any draft notes
      const notes = requestNoteDrafts[dk] || "";
      onRequestReview(bibKey, type, notes || undefined);
      // Auto-open the pod
      if (type === "fields") {
        setExpandedEntries((prev) => { const n = new Set(prev); n.add(bibKey); return n; });
      } else {
        setExpandedAnnotations((prev) => { const n = new Set(prev); n.add(bibKey); return n; });
      }
      // Open the request notes input
      setRequestNoteOpen((prev) => { const n = new Set(prev); n.add(dk); return n; });
    }
  };

  const citationCountForKey = useCallback((key: string) => {
    return citations.filter((c) => c.keys.includes(key)).length;
  }, [citations]);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Bibliography" count={sortedEntries.length} />

      <div className={PANEL.list}>
        {sortedEntries.length === 0 && (
          <div className={PANEL.empty}>
            No cited entries found. Add citations in the editor and ensure a .bib file is available.
          </div>
        )}

        {sortedEntries.map((entry) => {
          const isSelected = selectedBibKey === entry.key;
          const annotation = getAnnotation(entry.key);
          const isFieldsOpen = expandedEntries.has(entry.key);
          const isAnnotationOpen = expandedAnnotations.has(entry.key);
          const fieldsReviewStatus = getReviewStatus(entry.key, "fields");
          const notesReviewStatus = getReviewStatus(entry.key, "notes");
          const fieldsDk = draftKey(entry.key, "fields");
          const notesDk = draftKey(entry.key, "notes");

          const author = entry.fields.author || "";
          const year = entry.fields.year || entry.fields.date || "";
          const title = entry.fields.title || "";

          return (
            <div
              key={entry.key}
              data-bib-entry={entry.key}
              className={panelCard(isSelected, "cursor-pointer")}
              onClick={() => handleSelectBibKey(isSelected ? null : entry.key)}
            >
              <div className={PANEL.cardInner}>
                {/* Occurrence counter — top right */}
                {(() => {
                  const ids = keyToCitationIds()[entry.key] || [];
                  if (ids.length <= 1) return null;
                  const idx = keyOccurrenceIdx[entry.key] || 0;
                  return (
                    <div
                      className="absolute top-2.5 right-3 flex items-center gap-0.5 text-xs text-stone-400"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => cycleOccurrence(entry.key, -1)}
                        className="hover:text-stone-600 px-0.5"
                        title="Previous occurrence"
                      >
                        &#x25B2;
                      </button>
                      <span className="font-mono">{idx + 1}/{ids.length}</span>
                      <button
                        onClick={() => cycleOccurrence(entry.key, 1)}
                        className="hover:text-stone-600 px-0.5"
                        title="Next occurrence"
                      >
                        &#x25BC;
                      </button>
                    </div>
                  );
                })()}

                {/* Author · Year */}
                {(author || year) && (
                  <div className="text-sm text-stone-800 pr-16">
                    {author && <span className="font-semibold">{author}</span>}
                    {author && year && <span className="text-stone-400 mx-1.5">&middot;</span>}
                    {year && <span className="font-semibold">{year}</span>}
                  </div>
                )}

                {/* Title */}
                {title && (
                  <div className="text-sm font-semibold italic text-stone-700 mt-0.5 pr-16 leading-snug">
                    {title}
                  </div>
                )}

                {/* Formatted citation (full) */}
                <div
                  className="text-xs text-stone-500 leading-relaxed mt-1.5 bib-formatted pr-16 break-words overflow-hidden"
                  style={{ overflowWrap: "anywhere" }}
                  dangerouslySetInnerHTML={{ __html: getFormattedBib(entry) }}
                />

                {/* Key / Handle — editable */}
                <div className="mt-1.5 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  {editingHandle === entry.key ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs text-stone-400">@</span>
                      <input
                        type="text"
                        value={editHandleType}
                        onChange={(e) => setEditHandleType(e.target.value)}
                        className="font-mono text-xs border border-stone-200 rounded px-1 py-0.5 w-24"
                        placeholder="type"
                      />
                      <span className="text-xs text-stone-400">{"{"}</span>
                      <input
                        type="text"
                        value={editHandleKey}
                        onChange={(e) => setEditHandleKey(e.target.value)}
                        className="font-mono text-xs border border-stone-200 rounded px-1 py-0.5 flex-1 min-w-[80px]"
                        placeholder="key"
                      />
                      <span className="text-xs text-stone-400">{"}"}</span>
                      <button
                        onClick={commitEditHandle}
                        className="text-xs px-1.5 py-0.5 bg-stone-700 text-white rounded hover:bg-stone-800"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEditHandle}
                        className="text-xs px-1.5 py-0.5 border border-stone-300 rounded hover:bg-stone-100"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span className="group inline-flex items-center gap-1">
                      <span className="text-xs font-mono text-stone-400 break-all">
                        @{entry.type}{"{" + entry.key + "}"}
                      </span>
                      <button
                        onClick={() => startEditHandle(entry)}
                        className="text-stone-300 hover:text-stone-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Edit handle"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    </span>
                  )}
                </div>

                {/* ── Pod: BibTeX Fields ──────────────────────────── */}
                <div className="mt-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(entry.key); }}
                      className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-700 transition-colors"
                    >
                      <Chevron expanded={isFieldsOpen} />
                      <span>BibTeX Fields</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRequestToggle(entry.key, "fields");
                      }}
                      className={`ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        fieldsReviewStatus === "pending"
                          ? "text-amber-600 bg-amber-50 hover:bg-amber-100"
                          : "text-stone-400 hover:text-stone-600 hover:bg-stone-100"
                      }`}
                      title={fieldsReviewStatus === "pending" ? "Click to cancel request" : "Request AI review of fields"}
                    >
                      {fieldsReviewStatus === "pending" ? (
                        <>
                          <PulsingDot />
                          <span>Requested</span>
                        </>
                      ) : (
                        <span>Request review</span>
                      )}
                    </button>
                  </div>

                  {isFieldsOpen && (
                    <div className="mt-1.5 space-y-1.5">
                      {/* Request notes input (shows when request is pending) */}
                      {requestNoteOpen.has(fieldsDk) && fieldsReviewStatus === "pending" && (
                        <div
                          className="rounded-md border border-amber-200 bg-amber-50/50 overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={requestNoteDrafts[fieldsDk] || ""}
                            onChange={(e) => setRequestNoteDrafts((prev) => ({ ...prev, [fieldsDk]: e.target.value }))}
                            placeholder="Request notes..."
                            className="w-full text-xs px-3 py-2 bg-transparent text-stone-600 placeholder:text-stone-400 focus:outline-none"
                          />
                        </div>
                      )}

                      <div className={PANEL.subpod}>
                        {editingBibKey === entry.key ? (
                          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                            {showBibWarning && (
                              <div className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1 text-xs">
                                Warning: editing will modify the .bib file.
                              </div>
                            )}
                            {Object.entries(editBibFields).map(([field, val]) => (
                              <div key={field} className="flex gap-1 items-start">
                                <span className="font-mono text-stone-400 w-16 flex-shrink-0 text-right text-xs">{field}:</span>
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
                          <div className="space-y-0.5 text-xs text-stone-500 min-w-0">
                            {Object.entries(entry.fields).map(([field, val]) => (
                              <div key={field} className="break-words" style={{ overflowWrap: "anywhere" }}>
                                <span className="font-mono text-stone-400">{field}:</span>{" "}
                                <span className="text-stone-600">{val}</span>
                              </div>
                            ))}
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditBib(entry); }}
                              className="text-xs text-stone-400 hover:text-stone-600 underline mt-1"
                            >
                              Edit entry
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Pod: Summary Notes ──────────────────────────── */}
                <div className="mt-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleAnnotation(entry.key); }}
                      className={`flex items-center gap-1.5 text-xs transition-colors ${
                        annotation
                          ? "text-amber-600 hover:text-amber-700"
                          : "text-stone-500 hover:text-stone-700"
                      }`}
                    >
                      <Chevron expanded={isAnnotationOpen} />
                      <span>Summary Notes</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRequestToggle(entry.key, "notes");
                      }}
                      className={`ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                        notesReviewStatus === "pending"
                          ? "text-amber-600 bg-amber-50 hover:bg-amber-100"
                          : "text-stone-400 hover:text-stone-600 hover:bg-stone-100"
                      }`}
                      title={notesReviewStatus === "pending" ? "Click to cancel request" : "Request AI-generated summary notes"}
                    >
                      {notesReviewStatus === "pending" ? (
                        <>
                          <PulsingDot />
                          <span>Requested</span>
                        </>
                      ) : (
                        <span>Request notes</span>
                      )}
                    </button>
                  </div>

                  {isAnnotationOpen && (
                    <div className="mt-1.5 space-y-1.5">
                      {/* Request notes input (shows when request is pending) */}
                      {requestNoteOpen.has(notesDk) && notesReviewStatus === "pending" && (
                        <div
                          className="rounded-md border border-amber-200 bg-amber-50/50 overflow-hidden"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={requestNoteDrafts[notesDk] || ""}
                            onChange={(e) => setRequestNoteDrafts((prev) => ({ ...prev, [notesDk]: e.target.value }))}
                            placeholder="Request notes..."
                            className="w-full text-xs px-3 py-2 bg-transparent text-stone-600 placeholder:text-stone-400 focus:outline-none"
                          />
                        </div>
                      )}

                      <div className="${PANEL.subpodWhite}">
                        <AnnotationEditor
                          bibKey={entry.key}
                          content={annotation}
                          onUpdate={setAnnotation}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(BibliographyPanel);
