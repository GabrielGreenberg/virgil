"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import type { BibEntry, BibEntryRequest, CitationRef } from "@/lib/types";
import { ItemMenu, PANEL, clearStaleHover } from "@/components/panel-primitives";
import BibEntryCard from "@/components/BibEntryCard";
import PanelThemePicker from "@/components/PanelThemePicker";
import { searchCentralLibrary, searchLocalBib } from "@/lib/bib-search";
import { mintBibUid } from "@/lib/bib-uid";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import {
  useLibraryItems,
  useLibraryMasterBib,
  useLibraryMemberships,
} from "@/hooks/useLibrary";
import { useTabIndent } from "@/hooks/useTabIndent";
import type { LibraryIndexItem } from "@/lib/library/library-types";
import {
  ProvenanceChips,
  provenanceFor,
} from "@/components/library/provenance-chips";
import {
  LibraryEntryMenu,
  type RowState,
} from "@/components/library/LibraryEntryMenu";

/** True when two bib entries describe the same record at field level —
 *  same `@type` and exact field/value pairs. `raw` differences (whitespace,
 *  field order) don't count as a conflict. */
function bibEntryFieldsEqual(a: BibEntry, b: BibEntry): boolean {
  if (a.type !== b.type) return false;
  const aKeys = Object.keys(a.fields);
  const bKeys = Object.keys(b.fields);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a.fields[k] !== b.fields[k]) return false;
  }
  return true;
}

/** Fallback formatter used when `entry.raw` isn't available (e.g. for an
 *  entry assembled in-memory). Produces a BibTeX-ish block suitable for
 *  embedding in `requestNotes`. */
function formatBibEntryForNote(entry: BibEntry): string {
  const lines = [`@${entry.type}{${entry.key},`];
  for (const [field, value] of Object.entries(entry.fields)) {
    lines.push(`  ${field} = {${value}},`);
  }
  lines.push("}");
  return lines.join("\n");
}

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
  onScrollToCitation?: (citationId: string, sourceEl?: HTMLElement | null) => void;
  onActiveCitationChange?: (citationId: string | null) => void;
  bibPackage?: string;
  onAddBibEntry?: (entry: BibEntry) => void;
  docId: string | null;
  entryRequests: BibEntryRequest[];
  onAddEntryRequest: (description: string) => void;
  onRemoveEntryRequest: (id: string) => void;
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
  onScrollToCitation,
  onActiveCitationChange,
  bibPackage,
  onAddBibEntry,
  docId,
  entryRequests,
  onAddEntryRequest,
  onRemoveEntryRequest,
}: BibliographyPanelProps) {
  const [keyOccurrenceIdx, setKeyOccurrenceIdx] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<"cited" | "all">("cited");

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"local" | "library">("local");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestText, setRequestText] = useState("");
  const requestInputRef = useRef<HTMLTextAreaElement>(null);

  // Citekey-conflict inline confirmation strip: shown when the user clicks
  // "Add" on a library result whose citekey already exists locally but with
  // different fields. Null means no conflict pending.
  const [conflictDecision, setConflictDecision] = useState<
    | {
        libraryEntry: BibEntry;
        localEntry: BibEntry;
      }
    | null
  >(null);

  // Cross-library picker dropdown — opens from the addMenu's "Search
  // library…" item. Anchored to the rect of that menu item at click
  // time so the popover lands under the user's gesture even though the
  // addMenu itself closes immediately after.
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [libraryMenuAnchor, setLibraryMenuAnchor] = useState<DOMRect | null>(
    null,
  );

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
    (key: string, sourceEl?: HTMLElement | null) => {
      const ids = keyToCitationIds()[key] || [];
      const idx = keyOccurrenceIdx[key] || 0;
      const targetId = ids[idx] || ids[0];
      if (targetId) {
        onScrollToCitation?.(targetId, sourceEl);
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

  // Central-library master.bib — parsed once via the catalog-store's
  // FSA handle. Empty when no library is connected. Declared before
  // `displayedEntries` so the library-search branch can read it.
  const { entries: libraryBibEntries } = useLibraryMasterBib();

  // Custom-library memberships: `citekey → [{ id, label }, …]`. Central
  // is implicit (everything in master.bib belongs to Central) and is
  // NOT in this map; the panel renders the Central chip directly when
  // appropriate.
  const { membershipMap } = useLibraryMemberships();

  // The list actually rendered by CardListPanel and walked by keyboard nav.
  // Drives selectedIdx, goNext/goPrev, in-text positions, and PrevNextCounter
  // so that local-search filtering and central-library results both flow
  // through the same path.
  const displayedEntries = useMemo(() => {
    if (showSearch && searchScope === "local" && searchQuery.trim()) {
      return searchLocalBib(sortedEntries, searchQuery);
    }
    if (showSearch && searchScope === "library") {
      if (!searchQuery.trim()) return [];
      return searchCentralLibrary(libraryBibEntries, searchQuery);
    }
    return sortedEntries;
  }, [
    showSearch,
    searchScope,
    searchQuery,
    sortedEntries,
    libraryBibEntries,
  ]);

  const existingKeys = useMemo(
    () => new Set(bibEntries.map((e) => e.key)),
    [bibEntries],
  );

  // Library-status lookup: citekey → catalog row. Used for the
  // provenance chips (a citekey in master.bib gets a `central` chip,
  // and we surface bib auth state from the same row).
  const { items: libraryItems, hasFolder: isLibraryConnected } =
    useLibraryItems();
  const libraryByCitekey = useMemo(() => {
    const out = new Map<string, LibraryIndexItem>();
    for (const item of libraryItems) {
      if (item.citekey) out.set(item.citekey, item);
    }
    return out;
  }, [libraryItems]);

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

  const handleAddFromCentralLibrary = useCallback(
    (anchor: DOMRect | null) => {
      setAddMenuOpen(false);
      setShowRequestForm(false);
      setConflictDecision(null);
      setLibraryMenuAnchor(anchor);
      setLibraryMenuOpen(true);
    },
    [],
  );

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      const next = !prev;
      if (!next) {
        setSearchQuery("");
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

  const onRequestKeyDown = useTabIndent<HTMLTextAreaElement>((e) => {
    if (e.key === "Escape") {
      setShowRequestForm(false);
      setRequestText("");
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmitRequest();
  });

  const localEntryByKey = useMemo(() => {
    const out = new Map<string, BibEntry>();
    for (const e of bibEntries) out.set(e.key, e);
    return out;
  }, [bibEntries]);

  const handleAddEntry = useCallback(
    (entry: BibEntry) => {
      // Library-scope: if the citekey already exists locally and the
      // fields differ, surface the four-option conflict strip instead
      // of silently double-adding.
      if (searchScope === "library") {
        const local = localEntryByKey.get(entry.key);
        if (local) {
          if (bibEntryFieldsEqual(local, entry)) {
            // Byte-identical — silent no-op, navigate to it.
            handleSelectBibKey(entry.key);
            return;
          }
          setConflictDecision({ libraryEntry: entry, localEntry: local });
          return;
        }
      }
      onAddBibEntry?.(entry);
      // Keep the entry in the global/library results — existingKeys
      // re-render flips the chip from "Add" to "Added" so the list
      // doesn't shift under the user's cursor while they're typing.
    },
    [
      onAddBibEntry,
      searchScope,
      localEntryByKey,
      handleSelectBibKey,
    ],
  );

  // Pick handler for the cross-library dropdown. Returns the row state
  // the menu should adopt afterward — "added" on a clean add, "conflict"
  // when the local citekey diverges and the conflict strip takes over.
  const handlePickFromLibrary = useCallback(
    (entry: BibEntry): RowState => {
      const local = localEntryByKey.get(entry.key);
      if (local) {
        if (bibEntryFieldsEqual(local, entry)) {
          handleSelectBibKey(entry.key);
          return "added";
        }
        setConflictDecision({ libraryEntry: entry, localEntry: local });
        setLibraryMenuOpen(false);
        return "conflict";
      }
      onAddBibEntry?.(entry);
      return "added";
    },
    [localEntryByKey, handleSelectBibKey, onAddBibEntry],
  );

  const getLibraryRowState = useCallback(
    (entry: BibEntry): RowState => {
      const local = localEntryByKey.get(entry.key);
      if (!local) return "addable";
      return bibEntryFieldsEqual(local, entry) ? "added" : "conflict";
    },
    [localEntryByKey],
  );

  const dismissConflict = useCallback(() => setConflictDecision(null), []);

  const handleConflictReplace = useCallback(() => {
    if (!conflictDecision) return;
    const { libraryEntry, localEntry } = conflictDecision;
    onUpdateBibEntry(localEntry.key, libraryEntry.fields);
    if (libraryEntry.type !== localEntry.type) {
      onUpdateBibKeyAndType(localEntry.key, localEntry.key, libraryEntry.type);
    }
    setConflictDecision(null);
    handleSelectBibKey(localEntry.key);
  }, [
    conflictDecision,
    onUpdateBibEntry,
    onUpdateBibKeyAndType,
    handleSelectBibKey,
  ]);

  const handleConflictNewCitekey = useCallback(() => {
    if (!conflictDecision) return;
    const { libraryEntry } = conflictDecision;
    const existing = new Set(bibEntries.map((e) => e.key));
    let suffix = 2;
    let next = `${libraryEntry.key}-${suffix}`;
    while (existing.has(next)) {
      suffix += 1;
      next = `${libraryEntry.key}-${suffix}`;
    }
    // Drop `raw` so the serializer rebuilds the block from fields and the
    // new citekey — keeping `raw` would re-emit the library's original
    // `@type{<originalKey>,…}` and the suffix would never reach disk. Mint a
    // fresh `uid` (don't inherit the library entry's) — this is a new, distinct
    // bibliography entry that gets its own durable identity.
    onAddBibEntry?.({ ...libraryEntry, uid: mintBibUid(), key: next, raw: "" });
    setConflictDecision(null);
    handleSelectBibKey(next);
  }, [conflictDecision, bibEntries, onAddBibEntry, handleSelectBibKey]);

  const handleConflictRequestMerge = useCallback(() => {
    if (!conflictDecision) return;
    const { libraryEntry, localEntry } = conflictDecision;
    const libRaw = libraryEntry.raw?.trim() || formatBibEntryForNote(libraryEntry);
    const notes =
      `Merge with library entry ${libraryEntry.key}. The user's Virgil Library has an alternate version of this entry — please reconcile the two and verify against authoritative sources. ` +
      `\n\nLibrary version:\n${libRaw}`;
    onRequestReview(localEntry.key, "fields", notes);
    setConflictDecision(null);
    handleSelectBibKey(localEntry.key);
  }, [conflictDecision, onRequestReview, handleSelectBibKey]);

  const headerLeading = (
    <ItemMenu align="left">
      <div className="px-3 py-1.5 flex items-center justify-end gap-2">
        <PanelThemePicker panelKey="bib" label="Bibliography color" />
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
        data-hint="Export cited"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export cited.bib
      </button>
    </ItemMenu>
  );

  const headerExtras = (
    <>
      <button
        type="button"
        onClick={handleToggleSearch}
        className={`w-6 h-6 flex items-center justify-center rounded-md ${
          showSearch
            ? "text-ink-body bg-surface-muted"
            : "text-ink-muted hover:text-ink-body hover-on-light"
        }`}
        data-hint={showSearch ? "Close search" : "Search"}
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
                  isLibraryConnected
                    ? "text-ink-body hover-on-light"
                    : "text-ink-faint cursor-not-allowed"
                }`}
                onClick={
                  isLibraryConnected
                    ? (e) => {
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        handleAddFromCentralLibrary(rect);
                      }
                    : undefined
                }
                data-hint="Search library"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                Search library…
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
                  : "Search library…"
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
                data-hint="Search local"
              >
                Local
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isLibraryConnected) setSearchScope("library");
                }}
                disabled={!isLibraryConnected}
                className={`text-[10px] px-1.5 py-1 border-l border-edge-subtle ${
                  searchScope === "library"
                    ? "bg-surface-muted text-ink-body"
                    : isLibraryConnected
                      ? "text-ink-muted hover:text-ink-body"
                      : "text-ink-faint cursor-not-allowed"
                }`}
                data-hint="Search library"
              >
                Library
              </button>
            </div>
            <button
              onClick={closeSearch}
              className="text-ink-muted hover:text-ink-body p-0.5 shrink-0"
              data-hint="Close search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          {searchScope === "library" && !isLibraryConnected && (
            <div className="text-[10px] text-ink-muted mt-1.5">
              Connect the central library to search master.bib.
            </div>
          )}
          {searchScope === "library" &&
            isLibraryConnected &&
            !searchQuery.trim() && (
              <div className="text-[10px] text-ink-muted mt-1.5">
                Type to search the central library ({libraryBibEntries.length}{" "}
                entries).
              </div>
            )}
        </div>
      )}

      {conflictDecision && (
        <div className="px-3 py-2 border-b border-amber-200 bg-amber-50/50">
          <div className="text-[11px] text-ink-body mb-1.5">
            <span className="font-mono text-ink-muted">
              {conflictDecision.libraryEntry.key}
            </span>{" "}
            is already in your bib with different fields.
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={handleConflictReplace}
              className="text-[10px] text-white bg-amber-600 hover:bg-amber-700 px-2 py-1 rounded"
              data-hint="Overwrite local fields with the library version (citekey unchanged)"
            >
              Replace with library
            </button>
            <button
              onClick={dismissConflict}
              className="text-[10px] text-ink-body bg-surface border border-edge-subtle hover-on-light px-2 py-1 rounded"
              data-hint="Keep your existing local entry as-is"
            >
              Keep yours
            </button>
            <button
              onClick={handleConflictNewCitekey}
              className="text-[10px] text-ink-body bg-surface border border-edge-subtle hover-on-light px-2 py-1 rounded"
              data-hint="Add the library entry alongside under an auto-suffixed citekey"
            >
              Save under new citekey
            </button>
            <button
              onClick={handleConflictRequestMerge}
              className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-2 py-1 rounded"
              data-hint="File an AI bib-review request to merge both versions and authenticate"
            >
              Request AI merge &amp; authentication
            </button>
          </div>
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
              data-hint="Cancel"
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
            onKeyDown={onRequestKeyDown}
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
                data-hint="Dismiss"
                data-hint-pos="above"
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
    <>
    <CardListPanel
      kind="bibliography"
      count={displayedEntries.length}
      onAdd={() => setAddMenuOpen((o) => !o)}
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
            : showSearch && searchScope === "library" && searchQuery.trim()
              ? `No library entries match "${searchQuery}".`
              : showSearch && searchScope === "library" && !searchQuery.trim() && isLibraryConnected
                ? "Type to search the library."
                : filter === "cited"
                  ? "No cited entries found. Add citations in the editor and ensure a .bib file is available."
                  : "No entries found in the .bib file."}
        </div>
      }
      scrollRef={listRef}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      listTrailing={listTrailing}
      renderCard={(entry, { selected }) => {
        const ids = keyToCitationIds()[entry.key] || [];
        const idx = keyOccurrenceIdx[entry.key] || 0;
        const isCited = citedKeys.has(entry.key);
        const isLibraryResult = showSearch && searchScope === "library";
        const isPreviewResult = isLibraryResult;
        // For library results we keep the Add affordance even when the
        // citekey already exists locally, IF the fields differ — clicking
        // it then routes into the conflict-resolution strip. Only when the
        // local + library fields are byte-identical does the chip flip to
        // "Added" (a click would be a no-op anyway).
        const alreadyAddedFlag = (() => {
          if (!isPreviewResult) return false;
          if (!existingKeys.has(entry.key)) return false;
          if (!isLibraryResult) return true;
          const local = localEntryByKey.get(entry.key);
          return !!local && bibEntryFieldsEqual(local, entry);
        })();
        const addAction = isPreviewResult
          ? {
              onAdd: () => handleAddEntry(entry),
              alreadyAdded: alreadyAddedFlag,
            }
          : undefined;
        const provenance = provenanceFor(
          entry.key,
          searchScope,
          {
            inLocal: localEntryByKey.has(entry.key),
            inCentral: libraryByCitekey.has(entry.key),
            customLibraries: membershipMap.get(entry.key),
            bibState: libraryByCitekey.get(entry.key)?.bibState,
          },
        );
        return (
          <BibEntryCard
            entry={entry}
            isSelected={selected}
            onClick={() => {
              handleSelectBibKey(selected ? null : entry.key);
              listRef.current?.focus();
            }}
            onJump={isCited ? (sourceEl) => handleJumpToBibKey(entry.key, sourceEl) : undefined}
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
              provenance.length > 0 ? (
                <ProvenanceChips chips={provenance} />
              ) : undefined
            }
            addAction={addAction}
            draggable={!isPreviewResult}
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
    />
    <LibraryEntryMenu
      open={libraryMenuOpen}
      anchorRect={libraryMenuAnchor}
      onClose={() => setLibraryMenuOpen(false)}
      onPick={handlePickFromLibrary}
      getRowState={getLibraryRowState}
      placeholder="Search library…"
    />
    </>
  );
}

export default memo(BibliographyPanel);
