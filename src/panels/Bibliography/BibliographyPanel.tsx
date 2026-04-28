"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { BibEntry, BibEntryRequest, CitationRef } from "@/lib/types";
import { ItemMenu, PANEL, PrevNextCounter, clearStaleHover } from "@/components/panel-primitives";
import BibEntryCard from "@/components/BibEntryCard";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import {
  useInTextPositions,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import { searchGeneralBib, searchLocalBib } from "@/lib/bib-search";
import { pickGeneralBib } from "@/lib/storage";
import { formatMinimalCitation } from "@/lib/bib-parser";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { useLibraryItems } from "@/hooks/useLibrary";
import {
  BibLibraryChip,
  type BibLibraryChipKind,
} from "@/components/library/BibLibraryChip";
import type { LibraryIndexItem } from "@/lib/library/library-types";

interface BibliographyPanelProps {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  selectedBibKey: string | null;
  onSelectBibKey: (key: string | null) => void;
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  allEditorCitations?: Array<{ citationId: string; command: string; keys: string[] }>;
  citationPositions?: Map<string, number>;
  onScrollToCitation?: (citationId: string) => void;
  onActiveCitationChange?: (citationId: string | null) => void;
  bibPackage?: string;
  onAddBibEntry?: (entry: BibEntry) => void;
  docId: string | null;
  generalBibPath: string | null;
  onSetGeneralBibPath: (path: string | null) => void;
  entryRequests: BibEntryRequest[];
  onAddEntryRequest: (description: string) => void;
  onRemoveEntryRequest: (id: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}

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
  citationPositions,
  onScrollToCitation,
  onActiveCitationChange,
  bibPackage,
  onAddBibEntry,
  docId,
  generalBibPath,
  onSetGeneralBibPath,
  entryRequests,
  onAddEntryRequest,
  onRemoveEntryRequest,
  editor,
  panelSide = "left",
  viewMode = "list",
  onViewModeChange,
}: BibliographyPanelProps) {
  const bibTheme = useCardTheme("bib");
  const bibBodyStyle = usePanelBodyStyle("bib");
  const [keyOccurrenceIdx, setKeyOccurrenceIdx] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"cited" | "all">("cited");

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"local" | "global">("local");
  const [searchResults, setSearchResults] = useState<BibEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestText, setRequestText] = useState("");
  const requestInputRef = useRef<HTMLTextAreaElement>(null);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node))
        setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuOpen]);

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    if (showRequestForm) requestInputRef.current?.focus();
  }, [showRequestForm]);

  useEffect(() => {
    if (!showSearch || searchScope !== "global" || !generalBibPath || !docId) {
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await searchGeneralBib(docId, searchQuery);
        setSearchResults(data?.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, showSearch, searchScope, generalBibPath, docId]);

  useEffect(() => {
    if (searchScope === "local") {
      setSearchResults([]);
      setSearchLoading(false);
    }
  }, [searchScope]);

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

  const cycleOccurrence = useCallback(
    (key: string, delta: number) => {
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
    },
    [keyToCitationIds, keyOccurrenceIdx, onScrollToCitation, onActiveCitationChange],
  );

  const handleSelectBibKey = useCallback(
    (key: string | null) => {
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
    },
    [onSelectBibKey, keyToCitationIds, keyOccurrenceIdx, onActiveCitationChange],
  );

  const handleJumpToBibKey = useCallback(
    (key: string) => {
      const ids = keyToCitationIds()[key] || [];
      const idx = keyOccurrenceIdx[key] || 0;
      const targetId = ids[idx] || ids[0];
      if (targetId) {
        onScrollToCitation?.(targetId);
        onActiveCitationChange?.(targetId);
      }
    },
    [keyToCitationIds, keyOccurrenceIdx, onScrollToCitation, onActiveCitationChange],
  );

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

  // The list actually rendered by CardListPanel and walked by keyboard nav.
  // Drives selectedIdx, goNext/goPrev, in-text positions, and PrevNextCounter
  // so that local-search filtering and global-search results both flow
  // through the same path.
  const displayedEntries = useMemo(() => {
    if (showSearch && searchScope === "local" && searchQuery.trim()) {
      return searchLocalBib(sortedEntries, searchQuery);
    }
    if (showSearch && searchScope === "global") {
      return searchResults;
    }
    return sortedEntries;
  }, [showSearch, searchScope, searchQuery, sortedEntries, searchResults]);

  const existingKeys = useMemo(
    () => new Set(bibEntries.map((e) => e.key)),
    [bibEntries],
  );

  // Library-status lookup: citekey → chip info. The library is global,
  // so a single item's state applies to every doc that cites it.
  const { items: libraryItems } = useLibraryItems();
  const libraryByCitekey = useMemo(() => {
    const out = new Map<string, LibraryIndexItem>();
    for (const item of libraryItems) {
      if (item.citekey) out.set(item.citekey, item);
    }
    return out;
  }, [libraryItems]);
  const libraryChipFor = useCallback(
    (key: string): BibLibraryChipKind => {
      const item = libraryByCitekey.get(key);
      if (!item) return { kind: "missing" };
      if (item.status === "ready") return { kind: "ready", itemId: item.id };
      if (item.status === "failed") return { kind: "failed", itemId: item.id };
      return { kind: "processing", itemId: item.id, status: item.status };
    },
    [libraryByCitekey],
  );

  const inTextItems = useMemo<PositionItem[]>(() => {
    if (!citationPositions || citationPositions.size === 0) return [];
    const firstCitationByKey = new Map<string, number>();
    for (const cit of allEditorCitations) {
      const pos = citationPositions.get(cit.citationId);
      if (pos === undefined) continue;
      for (const k of cit.keys) {
        if (!firstCitationByKey.has(k)) firstCitationByKey.set(k, pos);
      }
    }
    const out: PositionItem[] = [];
    for (const e of displayedEntries) {
      const pos = firstCitationByKey.get(e.key);
      if (pos !== undefined) out.push({ id: e.key, pos });
    }
    return out;
  }, [allEditorCitations, citationPositions, displayedEntries]);
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null,
    inTextItems,
    viewMode === "in-text",
  );

  const selectedIdx = useMemo(() => {
    if (!selectedBibKey) return -1;
    return displayedEntries.findIndex((e) => e.key === selectedBibKey);
  }, [selectedBibKey, displayedEntries]);

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
    if (displayedEntries.length === 0) return;
    const next =
      selectedIdx === -1 ? 0 : (selectedIdx + 1) % displayedEntries.length;
    navigateToEntry(displayedEntries[next].key);
  }, [displayedEntries, selectedIdx, navigateToEntry]);

  const goPrev = useCallback(() => {
    if (displayedEntries.length === 0) return;
    const prev =
      selectedIdx === -1
        ? displayedEntries.length - 1
        : (selectedIdx - 1 + displayedEntries.length) % displayedEntries.length;
    navigateToEntry(displayedEntries[prev].key);
  }, [displayedEntries, selectedIdx, navigateToEntry]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (displayedEntries.length === 0) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
        clearStaleHover(e.currentTarget as HTMLElement);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
        clearStaleHover(e.currentTarget as HTMLElement);
      }
    },
    [displayedEntries, goNext, goPrev],
  );

  const handlePickGeneralBib = useCallback(async () => {
    if (!docId) return;
    try {
      const result = await pickGeneralBib(docId);
      if (result) onSetGeneralBibPath(result.filename);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Failed to pick general bib:", err);
    }
  }, [docId, onSetGeneralBibPath]);

  const handleExportCited = useCallback(() => {
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
    const content =
      cited.map((e) => e.raw).filter(Boolean).join("\n\n") + "\n";
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
    setSearchScope("global");
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      const next = !prev;
      if (!next) {
        setSearchQuery("");
        setSearchResults([]);
        setSearchScope("local");
      } else {
        setShowRequestForm(false);
      }
      return next;
    });
  }, []);

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchScope("local");
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

  const handleAddEntry = useCallback(
    (entry: BibEntry) => {
      onAddBibEntry?.(entry);
      // Keep the entry in the global results — existingKeys re-render flips
      // the chip from "Add" to "Added" so the list doesn't shift under the
      // user's cursor while they're typing.
    },
    [onAddBibEntry],
  );

  const generalBibFilename = generalBibPath
    ? generalBibPath.split("/").pop()
    : null;

  const headerLeading = (
    <ItemMenu align="left">
      <div className="px-3 py-1.5 flex items-center justify-end gap-2">
        <PanelThemePicker panelKey="bib" label="Bibliography color" />
        {onViewModeChange && !(showSearch && searchScope === "global") && (
          <ViewToggle mode={viewMode} onChange={onViewModeChange} />
        )}
      </div>
      <div className="my-1 border-t border-edge-subtle" />
      <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">
        Display
      </div>
      <button
        className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
        onClick={() => setFilter("cited")}
      >
        <span>Cited entries only</span>
        <span className="text-[var(--accent)]">
          {filter === "cited" ? "✓" : ""}
        </span>
      </button>
      <button
        className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
        onClick={() => setFilter("all")}
      >
        <span>Full bibliography</span>
        <span className="text-[var(--accent)]">
          {filter === "all" ? "✓" : ""}
        </span>
      </button>
      <div className="my-1 border-t border-edge-subtle" />
      <button
        className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
          citedKeys.size > 0
            ? "text-ink-body hover-on-light"
            : "text-ink-faint cursor-not-allowed"
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
      <div className="my-1 border-t border-edge-subtle" />
      <button
        className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light"
        onClick={handlePickGeneralBib}
      >
        {generalBibPath
          ? "Change general bibliography..."
          : "Set general bibliography..."}
      </button>
      {generalBibPath && (
        <>
          <div
            className="px-3 py-1 text-[10px] text-ink-muted truncate"
            title={generalBibPath}
          >
            {generalBibFilename}
          </div>
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-danger-soft"
            onClick={() => onSetGeneralBibPath(null)}
          >
            Clear general bibliography
          </button>
        </>
      )}
    </ItemMenu>
  );

  const headerExtras = (
    <>
      <PrevNextCounter
        current={selectedIdx >= 0 ? selectedIdx : null}
        total={displayedEntries.length}
        label=""
      />
      <button
        type="button"
        onClick={handleToggleSearch}
        className={`w-6 h-6 flex items-center justify-center rounded-md ${
          showSearch
            ? "text-ink-body bg-surface-muted"
            : "text-ink-muted hover:text-ink-body hover-on-light"
        }`}
        title={showSearch ? "Close search" : "Search bibliography"}
        aria-pressed={showSearch}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      <div className="flex items-center gap-1">
        <div className="relative" ref={addMenuRef}>
          {addMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-surface border border-[var(--border)] rounded-lg shadow-lg py-1 z-30 min-w-[200px]">
              <button
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                  generalBibPath
                    ? "text-ink-body hover-on-light"
                    : "text-ink-faint cursor-not-allowed"
                }`}
                onClick={generalBibPath ? handleAddFromGeneralBib : undefined}
                title={generalBibPath ? undefined : "Set general bibliography first"}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Search general bibliography…
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center gap-2"
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
      </div>
    </>
  );

  const panelExtras = (
    <>
      {showSearch && (
        <div className="px-3 py-2 border-b border-[var(--border-light)] bg-surface-muted/50">
          <div className="flex items-center gap-1.5">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-ink-muted shrink-0"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              placeholder={
                searchScope === "local"
                  ? "Search local bibliography…"
                  : "Search general bibliography…"
              }
              className="flex-1 min-w-0 text-xs bg-surface border border-edge-subtle rounded px-2 py-1 outline-none focus:border-edge-strong"
            />
            <div className="flex items-center bg-surface border border-edge-subtle rounded overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setSearchScope("local")}
                className={`text-[10px] px-1.5 py-1 ${
                  searchScope === "local"
                    ? "bg-surface-muted text-ink-body"
                    : "text-ink-muted hover:text-ink-body"
                }`}
                title="Search this paper's bibliography"
              >
                Local
              </button>
              <button
                type="button"
                onClick={() => {
                  if (generalBibPath) setSearchScope("global");
                  else handlePickGeneralBib();
                }}
                className={`text-[10px] px-1.5 py-1 border-l border-edge-subtle ${
                  searchScope === "global"
                    ? "bg-surface-muted text-ink-body"
                    : generalBibPath
                      ? "text-ink-muted hover:text-ink-body"
                      : "text-ink-faint hover:text-ink-body"
                }`}
                title={
                  generalBibPath
                    ? "Search the user-wide general bibliography"
                    : "Set a general bibliography first…"
                }
              >
                Global
              </button>
            </div>
            <button
              onClick={closeSearch}
              className="text-ink-muted hover:text-ink-body p-0.5 shrink-0"
              title="Close search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          {searchScope === "global" && searchLoading && (
            <div className="text-[10px] text-ink-muted mt-1.5">Searching…</div>
          )}
          {searchScope === "global" && !generalBibPath && (
            <div className="text-[10px] text-ink-muted mt-1.5">
              No general bibliography is set. Click Global to choose one.
            </div>
          )}
          {searchScope === "global" &&
            !searchLoading &&
            generalBibPath &&
            !searchQuery.trim() && (
              <div className="text-[10px] text-ink-muted mt-1.5">
                Type to search the general bibliography.
              </div>
            )}
        </div>
      )}

      {showRequestForm && (
        <div className="px-3 py-2 border-b border-[var(--border-light)] bg-amber-50/30">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-medium text-ink-subtle uppercase tracking-wide">
              Request entry
            </span>
            <button
              onClick={() => {
                setShowRequestForm(false);
                setRequestText("");
              }}
              className="ml-auto text-ink-muted hover:text-ink-body p-0.5"
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
              if (e.key === "Escape") {
                setShowRequestForm(false);
                setRequestText("");
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                handleSubmitRequest();
            }}
            placeholder="Describe the bibliography entry you need..."
            className="w-full text-xs bg-surface border border-edge-subtle rounded px-2 py-1.5 outline-none focus:border-edge-strong resize-none"
            rows={3}
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <button
              onClick={() => {
                setShowRequestForm(false);
                setRequestText("");
              }}
              className="text-[10px] text-ink-subtle hover:text-ink-body px-2 py-1 rounded"
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
    </>
  );

  const listTrailing =
    entryRequests.length > 0 ? (
      <div className="mt-2 pt-2 border-t border-edge-subtle">
        <div className="text-[10px] font-medium text-ink-subtle uppercase tracking-wide px-2 mb-1.5">
          Pending requests ({entryRequests.length})
        </div>
        {entryRequests.map((req) => (
          <div
            key={req.id}
            className="mx-1 mb-1.5 rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-ink-body whitespace-pre-wrap">
                {req.description}
              </p>
              <button
                onClick={() => onRemoveEntryRequest(req.id)}
                className="text-ink-muted hover:text-ink-body shrink-0 p-0.5"
                title="Dismiss"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="text-[10px] text-ink-muted mt-1">
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
    ) : null;

  return (
    <CardListPanel
      kind="bibliography"
      onAdd={() => setAddMenuOpen((o) => !o)}
      onAiRequest={handleOpenRequestForm}
      headerLeading={headerLeading}
      headerExtras={headerExtras}
      panelExtras={panelExtras}
      items={displayedEntries}
      getId={(e) => e.key}
      selectedId={selectedBibKey}
      onSelect={handleSelectBibKey}
      emptyState={
        <div className={PANEL.empty}>
          {showSearch && searchScope === "local" && searchQuery.trim()
            ? `No local entries match "${searchQuery}"${filter === "cited" ? " (cited only — switch to Full bibliography to widen)" : ""}.`
            : showSearch && searchScope === "global" && searchQuery.trim() && !searchLoading
              ? `No general-bib entries match "${searchQuery}".`
              : showSearch && searchScope === "global" && !searchQuery.trim() && generalBibPath
                ? "Type to search the general bibliography."
                : filter === "cited"
                  ? "No cited entries found. Add citations in the editor and ensure a .bib file is available."
                  : "No entries found in the .bib file."}
        </div>
      }
      viewMode={searchScope === "global" && showSearch ? "list" : viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : listRef}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      listTrailing={listTrailing}
      renderCard={(entry, { selected }) => {
        const ids = keyToCitationIds()[entry.key] || [];
        const idx = keyOccurrenceIdx[entry.key] || 0;
        const isCited = citedKeys.has(entry.key);
        const libInfo = libraryChipFor(entry.key);
        const isGlobalResult = showSearch && searchScope === "global";
        const addAction = isGlobalResult
          ? {
              onAdd: () => handleAddEntry(entry),
              alreadyAdded: existingKeys.has(entry.key),
            }
          : undefined;
        return (
          <BibEntryCard
            entry={entry}
            isSelected={selected}
            onClick={() => {
              handleSelectBibKey(selected ? null : entry.key);
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
            libraryChip={
              libInfo.kind === "missing"
                ? undefined
                : <BibLibraryChip citekey={entry.key} info={libInfo} />
            }
            addAction={addAction}
            draggable={!isGlobalResult}
            occurrenceInfo={
              ids.length > 1
                ? {
                    total: ids.length,
                    current: idx,
                    onCycle: (delta) => cycleOccurrence(entry.key, delta),
                  }
                : undefined
            }
          />
        );
      }}
      inTextRenderItem={(entry, { selected }) => {
        const author =
          (entry.fields.author || "").split(/\s+and\s+/)[0]?.split(",")[0] || "";
        const year = entry.fields.year || "";
        const title = entry.fields.title || "";
        const borderColor =
          bibTheme.borderSelected;
        const selectedBg = bibTheme.headerSelected;
        return (
          <div
            data-bib-entry={entry.key}
            className={`px-2 pr-4 py-2 border-b cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-edge-hover" : "border-b-edge-hover hover-on-light"}`}
            style={
              selected
                ? {
                    borderLeftColor: borderColor,
                    backgroundColor:
                      selectedBg ?? "rgba(184, 169, 104, 0.1)",
                  }
                : undefined
            }
            onClick={() => handleSelectBibKey(selected ? null : entry.key)}
          >
            <div
              data-panel-kind="bib"
              className="text-xs text-ink-strong leading-snug truncate pr-6"
              title={`${author} ${year} — ${title}`}
              style={bibBodyStyle}
            >
              {author && <span className="font-semibold">{author}</span>}
              {author && year && <span className="text-ink-muted mx-1.5">&middot;</span>}
              {year && <span className="font-semibold">{year}</span>}
              {(author || year) && title && (
                <span className="text-ink-muted mx-1.5">&middot;</span>
              )}
              {title && <span className="italic text-ink-body">{title}</span>}
            </div>
            <div
              className="text-[10px] font-mono text-ink-muted truncate mt-0.5"
              style={{ color: bibTheme.titleColor }}
            >
              {formatMinimalCitation(entry.key, bibEntries)}
            </div>
          </div>
        );
      }}
    />
  );
}

export default memo(BibliographyPanel);
