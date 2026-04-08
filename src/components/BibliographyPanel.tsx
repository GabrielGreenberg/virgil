"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import type { BibEntry, BibEntryRequest, CitationRef } from "@/lib/types";
import { PANEL, PanelHeader, PrevNextCounter } from "./panel-primitives";
import BibEntryCard from "./BibEntryCard";

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
  bibPackage?: string;
  // Add entry
  onAddBibEntry?: (entry: BibEntry) => void;
  // General bibliography
  generalBibPath: string | null;
  onSetGeneralBibPath: (path: string | null) => void;
  // Entry requests
  entryRequests: BibEntryRequest[];
  onAddEntryRequest: (description: string) => void;
  onRemoveEntryRequest: (id: string) => void;
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
  bibPackage,
  onAddBibEntry,
  generalBibPath,
  onSetGeneralBibPath,
  entryRequests,
  onAddEntryRequest,
  onRemoveEntryRequest,
}: BibliographyPanelProps) {
  const [keyOccurrenceIdx, setKeyOccurrenceIdx] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"cited" | "all">("cited");

  // Three-dot menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Add menu state
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Search UI state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BibEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Request form state
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestText, setRequestText] = useState("");
  const requestInputRef = useRef<HTMLTextAreaElement>(null);

  // Ref for the entries list — used for keyboard navigation scroll + focus
  const listRef = useRef<HTMLDivElement>(null);

  // Click-outside for three-dot menu
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Click-outside for add menu
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuOpen]);

  // Auto-focus search input
  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  // Auto-focus request textarea
  useEffect(() => {
    if (showRequestForm) requestInputRef.current?.focus();
  }, [showRequestForm]);

  // Debounced search
  useEffect(() => {
    if (!showSearch || !generalBibPath) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/bib/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generalBibPath, query: searchQuery }),
        });
        const data = await r.json();
        setSearchResults(data.results || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery, showSearch, generalBibPath]);

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
        onActiveCitationChange?.(targetId);
      }
    } else {
      onActiveCitationChange?.(null);
    }
  }, [onSelectBibKey, keyToCitationIds, keyOccurrenceIdx, onActiveCitationChange]);

  const handleJumpToBibKey = useCallback((key: string) => {
    const ids = keyToCitationIds()[key] || [];
    const idx = keyOccurrenceIdx[key] || 0;
    const targetId = ids[idx] || ids[0];
    if (targetId) {
      onScrollToCitation?.(targetId);
      onActiveCitationChange?.(targetId);
    }
  }, [keyToCitationIds, keyOccurrenceIdx, onScrollToCitation, onActiveCitationChange]);

  const citedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cit of citations) {
      for (const k of cit.keys) keys.add(k);
    }
    return keys;
  }, [citations]);

  const sortedEntries = useMemo(() => {
    const seen = new Set<string>();
    let entries: BibEntry[];

    if (filter === "cited") {
      entries = bibEntries.filter((e) => {
        if (!citedKeys.has(e.key) || seen.has(e.key)) return false;
        seen.add(e.key);
        return true;
      });
    } else {
      entries = bibEntries.filter((e) => {
        if (seen.has(e.key)) return false;
        seen.add(e.key);
        return true;
      });
    }

    return entries.sort((a, b) => {
      const authorA = (a.fields.author || a.key).toLowerCase();
      const authorB = (b.fields.author || b.key).toLowerCase();
      return authorA.localeCompare(authorB);
    });
  }, [bibEntries, citedKeys, filter]);

  const existingKeys = useMemo(() => new Set(bibEntries.map((e) => e.key)), [bibEntries]);

  /* ── Keyboard navigation (ArrowUp / ArrowDown) ─────────────────────── */

  const selectedIdx = useMemo(() => {
    if (!selectedBibKey) return -1;
    return sortedEntries.findIndex((e) => e.key === selectedBibKey);
  }, [selectedBibKey, sortedEntries]);

  const navigateToEntry = useCallback(
    (key: string) => {
      handleSelectBibKey(key);
      requestAnimationFrame(() => {
        const card = listRef.current?.querySelector(
          `[data-bib-entry="${CSS.escape(key)}"]`,
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [handleSelectBibKey],
  );

  const goNext = useCallback(() => {
    if (sortedEntries.length === 0) return;
    const next =
      selectedIdx === -1 ? 0 : (selectedIdx + 1) % sortedEntries.length;
    navigateToEntry(sortedEntries[next].key);
  }, [sortedEntries, selectedIdx, navigateToEntry]);

  const goPrev = useCallback(() => {
    if (sortedEntries.length === 0) return;
    const prev =
      selectedIdx === -1
        ? sortedEntries.length - 1
        : (selectedIdx - 1 + sortedEntries.length) % sortedEntries.length;
    navigateToEntry(sortedEntries[prev].key);
  }, [sortedEntries, selectedIdx, navigateToEntry]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (sortedEntries.length === 0) return;
      // Don't intercept when typing in a nested input, textarea, or
      // contenteditable (e.g. annotation editor, inline field edits).
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      }
    },
    [sortedEntries, goNext, goPrev],
  );

  // File picker for general bibliography
  const handlePickGeneralBib = useCallback(async () => {
    setMenuOpen(false);
    try {
      const r = await fetch("/api/files/pick?type=bib", { method: "POST" });
      const data = await r.json();
      if (data.filePath) onSetGeneralBibPath(data.filePath);
    } catch { /* cancelled */ }
  }, [onSetGeneralBibPath]);

  // Export only the cited entries to a downloadable .bib file.
  // Uses each entry's raw BibTeX source so the output is a clean, parseable
  // .bib file without any lossy round-tripping.
  const handleExportCited = useCallback(() => {
    setMenuOpen(false);
    const seen = new Set<string>();
    const cited = bibEntries.filter((e) => {
      if (!citedKeys.has(e.key) || seen.has(e.key)) return false;
      seen.add(e.key);
      return true;
    });
    if (cited.length === 0) return;
    cited.sort((a, b) => {
      const authorA = (a.fields.author || a.key).toLowerCase();
      const authorB = (b.fields.author || b.key).toLowerCase();
      return authorA.localeCompare(authorB);
    });
    const content = cited.map((e) => e.raw).filter(Boolean).join("\n\n") + "\n";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cited.bib";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [bibEntries, citedKeys]);

  const handleAddFromGeneralBib = useCallback(() => {
    setAddMenuOpen(false);
    setShowRequestForm(false);
    setShowSearch(true);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const handleOpenRequestForm = useCallback(() => {
    setAddMenuOpen(false);
    setShowSearch(false);
    setShowRequestForm(true);
    setRequestText("");
  }, []);

  const handleSubmitRequest = useCallback(() => {
    if (!requestText.trim()) return;
    onAddEntryRequest(requestText.trim());
    setShowRequestForm(false);
    setRequestText("");
  }, [requestText, onAddEntryRequest]);

  const handleAddEntry = useCallback((entry: BibEntry) => {
    onAddBibEntry?.(entry);
    setSearchResults((prev) => prev.filter((e) => e.key !== entry.key));
  }, [onAddBibEntry]);

  const generalBibFilename = generalBibPath ? generalBibPath.split("/").pop() : null;

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader
        title="Bibliography"
        onAdd={() => setAddMenuOpen((o) => !o)}
        onAiRequest={handleOpenRequestForm}
      >
        <PrevNextCounter
          current={selectedIdx >= 0 ? selectedIdx : null}
          total={sortedEntries.length}
          onPrev={goPrev}
          onNext={goNext}
          label=""
        />
        <div className="flex items-center gap-1">
          {/* Add menu dropdown (button is in PanelHeader via onAdd) */}
          <div className="relative" ref={addMenuRef}>
            {addMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-lg shadow-lg py-1 z-30 min-w-[200px]">
                <button
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                    generalBibPath
                      ? "text-stone-700 hover:bg-stone-50"
                      : "text-stone-300 cursor-not-allowed"
                  }`}
                  onClick={generalBibPath ? handleAddFromGeneralBib : undefined}
                  title={generalBibPath ? undefined : "Set general bibliography first"}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  From general bibliography
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center gap-2"
                  onClick={handleOpenRequestForm}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                  Request entry
                </button>
              </div>
            )}
          </div>

          {/* Three-dot menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
              title="View options"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-lg shadow-lg py-1 z-30 min-w-[200px]">
                {/* Display section */}
                <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-stone-400 uppercase tracking-wide">
                  Display
                </div>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  onClick={() => { setFilter("cited"); setMenuOpen(false); }}
                >
                  <span>Cited entries only</span>
                  <span className="text-[var(--accent)]">{filter === "cited" ? "✓" : ""}</span>
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  onClick={() => { setFilter("all"); setMenuOpen(false); }}
                >
                  <span>Full bibliography</span>
                  <span className="text-[var(--accent)]">{filter === "all" ? "✓" : ""}</span>
                </button>

                {/* Divider */}
                <div className="my-1 border-t border-stone-200" />

                {/* Export command */}
                <button
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                    citedKeys.size > 0
                      ? "text-stone-700 hover:bg-stone-50"
                      : "text-stone-300 cursor-not-allowed"
                  }`}
                  onClick={citedKeys.size > 0 ? handleExportCited : undefined}
                  title={citedKeys.size > 0 ? undefined : "No cited entries to export"}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export cited.bib
                </button>

                {/* Divider */}
                <div className="my-1 border-t border-stone-200" />

                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
                  onClick={handlePickGeneralBib}
                >
                  {generalBibPath ? "Change general bibliography..." : "Set general bibliography..."}
                </button>
                {generalBibPath && (
                  <>
                    <div className="px-3 py-1 text-[10px] text-stone-400 truncate" title={generalBibPath}>
                      {generalBibFilename}
                    </div>
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                      onClick={() => { onSetGeneralBibPath(null); setMenuOpen(false); }}
                    >
                      Clear general bibliography
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </PanelHeader>

      {/* Search bar (inline, between header and list) */}
      {showSearch && (
        <div className="px-3 py-2 border-b border-[var(--border-light)] bg-stone-50/50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wide">Search general bibliography</span>
            <button
              onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }}
              className="ml-auto text-stone-400 hover:text-stone-600 p-0.5"
              title="Close search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-stone-400 shrink-0">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setShowSearch(false); setSearchQuery(""); setSearchResults([]); } }}
              placeholder="Search by key, author, or title..."
              className="flex-1 text-xs bg-white border border-stone-200 rounded px-2 py-1 outline-none focus:border-stone-400"
            />
          </div>
          {searchLoading && (
            <div className="text-[10px] text-stone-400 mt-1.5">Searching...</div>
          )}
          {!searchLoading && searchResults.length > 0 && (
            <div className="mt-1.5 max-h-[200px] overflow-y-auto space-y-1">
              {searchResults.map((entry) => {
                const alreadyAdded = existingKeys.has(entry.key);
                return (
                  <div key={entry.key} className="flex items-start justify-between gap-2 text-xs px-1 py-1 rounded hover:bg-white">
                    <div className="min-w-0">
                      <span className="font-mono text-[10px] text-stone-500">{entry.key}</span>
                      <span className="text-stone-400 mx-1">&middot;</span>
                      <span className="text-stone-700">{entry.fields.author || "Unknown"}</span>
                      {entry.fields.year && <span className="text-stone-400"> ({entry.fields.year})</span>}
                      {entry.fields.title && (
                        <div className="text-[10px] text-stone-500 truncate">{entry.fields.title}</div>
                      )}
                    </div>
                    {alreadyAdded ? (
                      <span className="text-[10px] text-stone-400 shrink-0 py-0.5">Added</span>
                    ) : (
                      <button
                        onClick={() => handleAddEntry(entry)}
                        className="text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-1.5 py-0.5 rounded shrink-0"
                      >
                        Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!searchLoading && searchQuery.trim() && searchResults.length === 0 && (
            <div className="text-[10px] text-stone-400 mt-1.5">No results found</div>
          )}
        </div>
      )}

      {/* Request entry form (inline) */}
      {showRequestForm && (
        <div className="px-3 py-2 border-b border-[var(--border-light)] bg-amber-50/30">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-medium text-stone-500 uppercase tracking-wide">Request entry</span>
            <button
              onClick={() => { setShowRequestForm(false); setRequestText(""); }}
              className="ml-auto text-stone-400 hover:text-stone-600 p-0.5"
              title="Cancel"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <textarea
            ref={requestInputRef}
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setShowRequestForm(false); setRequestText(""); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmitRequest();
            }}
            placeholder="Describe the bibliography entry you need..."
            className="w-full text-xs bg-white border border-stone-200 rounded px-2 py-1.5 outline-none focus:border-stone-400 resize-none"
            rows={3}
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button
              onClick={() => { setShowRequestForm(false); setRequestText(""); }}
              className="text-[10px] text-stone-500 hover:text-stone-700 px-2 py-1 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitRequest}
              disabled={!requestText.trim()}
              className="text-[10px] text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 px-2 py-1 rounded"
            >
              Submit
            </button>
          </div>
        </div>
      )}

      <div
        ref={listRef}
        className={PANEL.list}
        tabIndex={0}
        onKeyDown={handleNavKeys}
        style={{ outline: "none" }}
      >
        {sortedEntries.length === 0 && (
          <div className={PANEL.empty}>
            {filter === "cited"
              ? "No cited entries found. Add citations in the editor and ensure a .bib file is available."
              : "No entries found in the .bib file."}
          </div>
        )}

        {sortedEntries.map((entry) => {
          const isSelected = selectedBibKey === entry.key;
          const ids = keyToCitationIds()[entry.key] || [];
          const idx = keyOccurrenceIdx[entry.key] || 0;
          const isCited = citedKeys.has(entry.key);

          return (
            <BibEntryCard
              key={entry.key}
              entry={entry}
              isSelected={isSelected}
              onClick={() => {
                handleSelectBibKey(isSelected ? null : entry.key);
                listRef.current?.focus();
              }}
              onJump={isCited ? () => handleJumpToBibKey(entry.key) : undefined}
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
              isCited={isCited}
              occurrenceInfo={ids.length > 1 ? {
                total: ids.length,
                current: idx,
                onCycle: (delta) => cycleOccurrence(entry.key, delta),
              } : undefined}
            />
          );
        })}

        {/* Pending entry requests */}
        {entryRequests.length > 0 && (
          <div className="mt-2 pt-2 border-t border-stone-200">
            <div className="text-[10px] font-medium text-stone-500 uppercase tracking-wide px-2 mb-1.5">
              Pending requests ({entryRequests.length})
            </div>
            {entryRequests.map((req) => (
              <div
                key={req.id}
                className="mx-1 mb-1.5 rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-stone-700 whitespace-pre-wrap">{req.description}</p>
                  <button
                    onClick={() => onRemoveEntryRequest(req.id)}
                    className="text-stone-400 hover:text-stone-600 shrink-0 p-0.5"
                    title="Dismiss"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="text-[10px] text-stone-400 mt-1">
                  {new Date(req.createdAt).toLocaleDateString()}
                  {req.status === "pending" && (
                    <span className="ml-1.5 inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Pending
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(BibliographyPanel);
