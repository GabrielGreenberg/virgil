"use client";

import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import type { BibEntry, BibEntryRequest, CitationRef } from "@/lib/types";
import { Button, ItemMenu, PANEL, useListNavKeys } from "@/components/panel-primitives";
import BibEntryCard from "@/components/BibEntryCard";
import PanelThemePicker from "@/components/PanelThemePicker";
import { searchCentralLibrary, searchLocalBib } from "@/lib/bib-search";
import { serializeBibForExport } from "@/lib/bib-parser";
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
  LibraryMembershipChips,
  membershipChipsFor,
} from "@/components/library/provenance-chips";
import { LibraryStatusRow } from "@/components/library/library-entry-status";
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
  onReplaceBibEntry?: (key: string, fields: Record<string, string>, type?: string) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
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
  /** Bug 3: the persisted "Cited only / Full" filter + its setter (per-window,
   *  via useViewPrefs). Optional: when absent (the Reader path with no
   *  `viewPrefs` bundle) the panel falls back to a session-only local state so
   *  the control still works, just without reload survival. */
  bibFilter?: "cited" | "all";
  setBibFilter?: (v: "cited" | "all") => void;
}

function BibliographyPanel({
  citations,
  bibEntries,
  selectedBibKey,
  onSelectBibKey,
  onUpdateBibEntry,
  onReplaceBibEntry,
  onUpdateBibKeyAndType,
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
  bibFilter,
  setBibFilter,
}: BibliographyPanelProps) {
  // Occurrence cursor (which in-text citation a multi-cite entry's prev/next
  // arrows currently point at). Keyed on the entry's durable `uid`, NOT its
  // renameable citekey (BIB-A2-03 / BIB-F2-01): a rename mid-session must keep
  // the cursor where the user left it. Falls back to citekey for an entry with
  // no uid (legacy in-memory literal). Read with a clamp against the live
  // occurrence count so a citation deleted out from under the cursor can never
  // surface a stale "3 / 2" (BIB-F3-02).
  const [occurrenceIdxByUid, setOccurrenceIdxByUid] = useState<Record<string, number>>({});
  // Bug 3: the "Cited only / Full" filter now persists per-window via
  // useViewPrefs (threaded in as `bibFilter`/`setBibFilter`). The local
  // `useState` is retained ONLY as the Reader-path fallback (no `viewPrefs`
  // bundle there); when the persisted prop is wired, `filter`/`setFilter`
  // read/write it instead so the choice survives reload.
  const [localFilter, setLocalFilter] = useState<"cited" | "all">("cited");
  const filter = bibFilter ?? localFilter;
  const setFilter = setBibFilter ?? setLocalFilter;

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

  // Cross-library picker dropdown — opens from the add-menu's "Search
  // library…" item. Anchored to the rect of the "+" trigger at click
  // time (passed through by HeaderAddDropdown) so the popover lands
  // under the user's gesture even though the add-menu closes immediately
  // after.
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const [libraryMenuAnchor, setLibraryMenuAnchor] = useState<DOMRect | null>(
    null,
  );

  const listRef = useRef<HTMLDivElement>(null);

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

  // citekey → durable uid resolver. The cursor is uid-keyed but every cursor
  // call site addresses an entry by its (current) citekey, so we resolve the
  // uid here. An entry with no uid (legacy literal) falls back to its citekey
  // as the cursor key — harmless, just not rename-stable.
  const uidForKey = useCallback(
    (key: string): string => {
      const entry = bibEntries.find((e) => e.key === key);
      return entry?.uid || key;
    },
    [bibEntries],
  );

  // Clamped read of the occurrence cursor: the stored index is wrapped into the
  // live `[0, count)` range so a citation removed out from under the cursor can
  // never produce an out-of-range "N / M" (BIB-F3-02). Returns 0 when nothing
  // is stored or the entry is no longer cited.
  const clampedOccurrenceIdx = useCallback(
    (key: string, count: number): number => {
      if (count <= 0) return 0;
      const raw = occurrenceIdxByUid[uidForKey(key)] || 0;
      return ((raw % count) + count) % count;
    },
    [occurrenceIdxByUid, uidForKey],
  );

  const cycleOccurrence = useCallback(
    (key: string, delta: number) => {
      const ids = keyToCitationIds()[key] || [];
      if (ids.length <= 1) return;
      const cur = clampedOccurrenceIdx(key, ids.length);
      const next = (cur + delta + ids.length) % ids.length;
      setOccurrenceIdxByUid((prev) => ({ ...prev, [uidForKey(key)]: next }));
      const targetId = ids[next];
      if (targetId) {
        onScrollToCitation?.(targetId);
        onActiveCitationChange?.(targetId);
      }
    },
    [keyToCitationIds, clampedOccurrenceIdx, uidForKey, onScrollToCitation, onActiveCitationChange],
  );

  const handleSelectBibKey = useCallback(
    (key: string | null) => {
      onSelectBibKey(key);
      if (key) {
        const ids = keyToCitationIds()[key] || [];
        const idx = clampedOccurrenceIdx(key, ids.length);
        const targetId = ids[idx] || ids[0];
        if (targetId) {
          onActiveCitationChange?.(targetId);
        }
      } else {
        onActiveCitationChange?.(null);
      }
    },
    [onSelectBibKey, keyToCitationIds, clampedOccurrenceIdx, onActiveCitationChange],
  );

  const handleJumpToBibKey = useCallback(
    (key: string, sourceEl?: HTMLElement | null) => {
      const ids = keyToCitationIds()[key] || [];
      const idx = clampedOccurrenceIdx(key, ids.length);
      const targetId = ids[idx] || ids[0];
      if (targetId) {
        onScrollToCitation?.(targetId, sourceEl);
        onActiveCitationChange?.(targetId);
      }
    },
    [keyToCitationIds, clampedOccurrenceIdx, onScrollToCitation, onActiveCitationChange],
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

  // Shared list-nav handler (the editable-target guard + ArrowUp/Down cycling
  // this panel first grew inline is now the SSOT in `useListNavKeys`).
  const handleNavKeys = useListNavKeys(displayedEntries.length, goNext, goPrev);

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
    // Reconstruct every entry through the serializer — NEVER the raw-passthrough
    // that `.filter(Boolean)`-drops an in-memory entry with empty `raw`
    // (BIB-F7-01, DATA-LOSS). `serializeBibForExport` rebuilds from fields when
    // `raw === ""`, so a "Save under new citekey"/library-added/AI-found entry
    // exports its reconstructed block instead of silently vanishing.
    const content = serializeBibForExport(cited);
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
        // Toggling search off tears down the context that raised the conflict
        // strip — clear it too, same as `closeSearch` (task 096, Member A).
        setConflictDecision(null);
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
    // The citekey-conflict strip is owned by the library-search context that
    // raised it — tearing that context down must clear it, or an orphaned amber
    // strip lingers over an unrelated list with its four actions still live on a
    // stale snapshot (task 096, Member A).
    setConflictDecision(null);
  }, []);

  const handleOpenRequestForm = useCallback(() => {
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
    // "Replace with library" is set-all (D3 / BIB-A3-02): the local entry's
    // fields become EXACTLY the library version's — a local-only field the
    // library lacks must be dropped, not merge-retained. Route through
    // `replaceBibEntry` (which also carries the type) when available; fall back
    // to the legacy merge+separate-type-update path otherwise.
    if (onReplaceBibEntry) {
      onReplaceBibEntry(localEntry.key, libraryEntry.fields, libraryEntry.type);
    } else {
      onUpdateBibEntry(localEntry.key, libraryEntry.fields);
      if (libraryEntry.type !== localEntry.type) {
        onUpdateBibKeyAndType(localEntry.key, localEntry.key, libraryEntry.type);
      }
    }
    setConflictDecision(null);
    handleSelectBibKey(localEntry.key);
  }, [
    conflictDecision,
    onReplaceBibEntry,
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
    // Surface the just-added entry (task 096, Member B). A conflict is only
    // raised from the library-search "Add" affordance or the cross-library
    // dropdown, so the rendered list is library results / a local search that
    // never contains the suffixed `<key>-N` — `handleSelectBibKey(next)` alone
    // would resolve to selectedIdx === -1 (an invisible add). Leave the search
    // context (which also clears the conflict strip), widen the filter — a
    // brand-new entry is uncited and hidden under "Cited only" — then
    // select + scroll the new entry into view.
    closeSearch();
    setFilter("all");
    navigateToEntry(next);
  }, [
    conflictDecision,
    bibEntries,
    onAddBibEntry,
    closeSearch,
    setFilter,
    navigateToEntry,
  ]);

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
    </>
  );

  // The "+" add menu now folds onto the shared `HeaderAddDropdown` primitive
  // (via `onAddOptions`), which wraps the trigger + dropdown in one ref so its
  // outside-click correctly excludes the "+" — making the "+" a real toggle.
  // The trigger rect flows through to `handleAddFromCentralLibrary`, anchoring
  // the library picker under the "+".
  const addOptions = [
    {
      label: "Search library…",
      onClick: (rect?: DOMRect) => handleAddFromCentralLibrary(rect ?? null),
      disabled: !isLibraryConnected,
    },
    {
      label: "Request entry",
      onClick: () => handleOpenRequestForm(),
    },
  ];

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
                onClick={() => {
                  setSearchScope("local");
                  // Flipping away from library scope abandons the context that
                  // raised the conflict strip — clear it so it can't linger over
                  // the now-local list (task 096, Member A).
                  setConflictDecision(null);
                }}
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
        <div className="px-3 py-2 border-b border-[var(--amber-200)] bg-[var(--amber-50)]/50">
          <div className="text-[11px] text-ink-body mb-1.5">
            <span className="font-mono text-ink-muted">
              {conflictDecision.libraryEntry.key}
            </span>{" "}
            is already in your bib with different fields.
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="warm"
              size="sm"
              onClick={handleConflictReplace}
              data-hint="Overwrite local fields with the library version (citekey unchanged)"
            >
              Replace with library
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={dismissConflict}
              data-hint="Keep your existing local entry as-is"
            >
              Keep yours
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleConflictNewCitekey}
              data-hint="Add the library entry alongside under an auto-suffixed citekey"
            >
              Save under new citekey
            </Button>
            <Button
              variant="warm"
              size="sm"
              onClick={handleConflictRequestMerge}
              data-hint="File an AI bib-review request to merge both versions and authenticate"
            >
              Request AI merge &amp; authentication
            </Button>
          </div>
        </div>
      )}

      {showRequestForm && (
        <div className="px-3 py-2 border-b border-[var(--border-light)] bg-[var(--amber-50)]/30">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowRequestForm(false);
                setRequestText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="warm"
              size="sm"
              onClick={handleSubmitRequest}
              disabled={!requestText.trim()}
            >
              Submit
            </Button>
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
            className="mx-1 mb-1.5 rounded-md border border-[var(--amber-200)] bg-[var(--amber-50)]/40 px-3 py-2"
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
      onAddOptions={addOptions}
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
        const idx = clampedOccurrenceIdx(entry.key, ids.length);
        const isCited = citedKeys.has(entry.key);
        // `isCited` (persisted `citations`) answers the filter/label question —
        // it includes keys referenced only by an unanchored/archived citation
        // with no live in-text `\cite` node. Jumping needs a *live* occurrence
        // (`ids` from `allEditorCitations`), so gate the jump on that instead,
        // else a referenced-but-not-in-text entry shows a full-opacity chevron
        // that silently no-ops (`handleJumpToBibKey` finds `ids[…] === undefined`).
        const canJump = ids.length > 0;
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
        // Library meta, stacked under the title as two layers:
        //   layer 2 — membership chips (local / central / custom libraries),
        //   layer 3 — verification + processing-tier status + open link.
        // Scope-aware like the old `provenanceFor`: hide the chip that matches
        // the current search scope (a local result doesn't need a "local"
        // chip; a library result doesn't need a "central" one).
        const libItem = libraryByCitekey.get(entry.key);
        const membershipChips = membershipChipsFor({
          inLocal: localEntryByKey.has(entry.key) && searchScope !== "local",
          inCentral: libraryByCitekey.has(entry.key) && searchScope !== "library",
          customLibraries: membershipMap.get(entry.key),
        });
        const headerMeta =
          membershipChips.length > 0 || libItem ? (
            <>
              {membershipChips.length > 0 && (
                <LibraryMembershipChips chips={membershipChips} />
              )}
              <LibraryStatusRow
                indexTier={libItem?.indexTier}
                bibState={libItem?.bibState}
                citekey={entry.key}
                inLibrary={!!libItem}
              />
            </>
          ) : undefined;
        return (
          <BibEntryCard
            entry={entry}
            isSelected={selected}
            onClick={() => {
              handleSelectBibKey(selected ? null : entry.key);
              listRef.current?.focus();
            }}
            onJump={canJump ? (sourceEl) => handleJumpToBibKey(entry.key, sourceEl) : undefined}
            getAnnotation={getAnnotation}
            setAnnotation={setAnnotation}
            onRequestReview={onRequestReview}
            onCancelReview={onCancelReview}
            getReviewStatus={getReviewStatus}
            onUpdateBibEntry={onUpdateBibEntry}
            onReplaceBibEntry={onReplaceBibEntry}
            onUpdateBibKeyAndType={onUpdateBibKeyAndType}
            bibPackage={bibPackage}
            bibEntries={bibEntries}
            isCited={isCited}
            headerMeta={headerMeta}
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
