"use client";

import { attrSelector } from "@/lib/attr-selector";
import { useState, useCallback, useMemo, useRef, useEffect, memo } from "react";
import type { BibEntry, BibEntryRequest, CitationRef } from "@/lib/types";
import type { SaveBibEntry } from "@/hooks/useCitations";
import type { RequestBibReview } from "@/hooks/useBibReview";
import { ItemMenu, PANEL } from "@/components/panel-primitives";
import { Input } from "@/components/field-primitives";
import BibEntryCard from "@/components/BibEntryCard";
import { PanelThemeMenuRow } from "@/components/PanelThemePicker";
import { MenuSeparator, MenuSectionLabel } from "@/components/menu/MenuChrome";
import { MenuRadioGroup } from "@/components/menu/MenuRadioGroup";
import { MenuActionRow } from "@/components/menu/MenuActionRow";
import { searchCentralLibrary, searchLocalBib } from "@/lib/bib-search";
import { byProjectedAuthor, downloadCitedBib } from "@/lib/bib-export-cited";
import {
  BibConflictStrip,
  BibLibraryPicker,
  BibPendingRequests,
  BibRequestForm,
  LIBRARY_NOT_CONNECTED_HINT,
  bibEntryFieldsEqual,
  useBibLibraryFlow,
} from "./bib-library-flow";
import { bibKeyIndex, findBibEntryByKey } from "@/lib/bib-address";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import {
  useLibraryItems,
  useLibraryMasterBib,
  useLibraryMemberships,
} from "@/hooks/useLibrary";
import type { LibraryIndexItem } from "@/lib/library/library-types";
import {
  LibraryMembershipChips,
  membershipChipsFor,
} from "@/components/library/provenance-chips";
import { LibraryStatusRow } from "@/components/library/library-entry-status";
import { iconHint } from "@/components/Hint";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import {
  VIEW_PREF_REGISTRY,
  enumOptions,
  type RegistryPrefs,
} from "@/lib/view-prefs/registry";
import { isCancelEscape } from "@/lib/key-intent";
import { CloseIcon } from "@/components/icons/CloseIcon";


interface BibliographyPanelProps {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  /** The raw `.bib` text `bibEntries` projects — "Export cited.bib" exports
   *  the cited entries' dependency CLOSURE from it (`@string` macros,
   *  `@preamble`, crossref parents; task 949). */
  bibSource?: string;
  selectedBibKey: string | null;
  onSelectBibKey: (key: string | null) => void;
  /** Takes the ENTRY, not its citekey (task 690) — a citekey names as many
   *  blocks as carry it, and the mutator used to rewrite every one. */
  /** THE bib-entry write door — one write per gesture (task 691). */
  onSaveBibEntry: SaveBibEntry;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: RequestBibReview;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  getReviewNotes?: (bibKey: string, type: "fields" | "notes") => string | undefined;
  allEditorCitations?: Array<{ citationId: string; command: string; keys: string[] }>;
  onScrollToCitation?: (citationId: string, sourceEl?: HTMLElement | null) => void;
  onActiveCitationChange?: (citationId: string | null) => void;
  onAddBibEntry?: (entry: BibEntry) => void;
  docId: string | null;
  entryRequests: BibEntryRequest[];
  onAddEntryRequest: (description: string) => void;
  onRemoveEntryRequest: (id: string) => void;
  /** Bug 3: the persisted "Cited only / Full" filter + its setter (per-window,
   *  via useViewPrefs). Optional: when absent (the Reader path with no
   *  `viewPrefs` bundle) the panel falls back to a session-only local state so
   *  the control still works, just without reload survival. The setter is the
   *  panel's own presentational hook — the host binds it to the ONE registry
   *  writer, `setViewPref("bibFilter", v)` (task 274). */
  bibFilter?: BibFilter;
  onSetBibFilter?: (v: BibFilter) => void;
}

/** The filter's value domain, generated from `VIEW_PREF_REGISTRY.bibFilter`. */
type BibFilter = RegistryPrefs["bibFilter"];

/** The kebab's Display pair — a pick-ONE set (task 770 `MenuRadioGroup`).
 *  Values + labels are the registry's own (task 931). */
const BIB_FILTER_OPTIONS = enumOptions("bibFilter");


function BibliographyPanel({
  citations,
  bibEntries,
  bibSource = "",
  selectedBibKey,
  onSelectBibKey,
  onSaveBibEntry,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  getReviewNotes,
  allEditorCitations = [],
  onScrollToCitation,
  onActiveCitationChange,
  onAddBibEntry,
  docId,
  entryRequests,
  onAddEntryRequest,
  onRemoveEntryRequest,
  bibFilter,
  onSetBibFilter,
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
  // useViewPrefs (threaded in as `bibFilter`/`onSetBibFilter`). The local
  // `useState` is retained ONLY as the Reader-path fallback (no `viewPrefs`
  // bundle there); when the persisted prop is wired, `filter`/`setFilter`
  // read/write it instead so the choice survives reload.
  const [localFilter, setLocalFilter] = useState<BibFilter>(
    VIEW_PREF_REGISTRY.bibFilter.default,
  );
  const filter = bibFilter ?? localFilter;
  const setFilter = onSetBibFilter ?? setLocalFilter;

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"local" | "library">("local");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

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
      const entry = findBibEntryByKey(bibEntries, key);
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

  /**
   * The entries this panel lists — EVERY block, including two that share a
   * citekey (task 690).
   *
   * This used to drop the duplicate: a `seen` set kept the first block with a
   * given citekey and filtered the rest out. That existed only because the
   * citekey WAS the entry's identity — a second card for "the same" entry
   * looked like a rendering bug. It is not: `parseBibFile` yields two ordered
   * entries for two blocks on purpose, a hand-merged or imported
   * `references.bib` really carries them, and hiding one made it unfixable —
   * while every edit to the visible card silently overwrote the hidden one
   * too. Now that a mutation is ADDRESSED rather than key-matched
   * (`bib-address.ts`), an edit reaches exactly one block, so showing both is
   * the honest list AND the only way the user can repair the duplicate.
   */
  const sortedEntries = useMemo(() => {
    const entries =
      filter === "cited" ? bibEntries.filter((e) => citedKeys.has(e.key)) : bibEntries.slice();
    return entries.sort(byProjectedAuthor);
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
  // Drives keyboard nav (CardListPanel cycles exactly what it renders) and
  // in-text positions, so that local-search filtering and central-library
  // results both flow through the same path.
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

  const navigateToEntry = useCallback(
    (key: string) => {
      handleSelectBibKey(key);
      requestAnimationFrame(() => {
        const card = listRef.current?.querySelector(
          attrSelector("data-bib-entry", key),
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [handleSelectBibKey],
  );

  // Leave the search context (field, query, scope). The conflict strip it may
  // have raised is cleared by `closeSearch` / the flow itself.
  const leaveSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery("");
    setSearchScope("local");
  }, []);

  // The library flow — add from the library, the four-way citekey conflict,
  // entry requests — shared with the tool gutter's bibliography list.
  const flow = useBibLibraryFlow({
    bibEntries,
    onAddBibEntry,
    onSaveBibEntry,
    onRequestReview,
    onAddEntryRequest,
    select: handleSelectBibKey,
    onAddedUnderNewKey: (key) => {
      // A conflict is only raised from library results, which never contain
      // the suffixed `<key>-N`: leave the search, widen the filter (a new
      // entry is uncited and hidden under "Cited only"), then reveal it.
      leaveSearch();
      setFilter("all");
      navigateToEntry(key);
    },
  });
  const clearConflict = flow.clearConflict;

  const handleExportCited = useCallback(() => {
    downloadCitedBib(bibEntries, citedKeys, bibSource);
}, [bibEntries, bibSource, citedKeys]);

  const handleAddFromCentralLibrary = flow.libraryMenu.openAt;

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      const next = !prev;
      if (!next) {
        setSearchQuery("");
        setSearchScope("local");
        // Toggling search off tears down the context that raised the conflict
        // strip — clear it too, same as `closeSearch` (task 096, Member A).
        clearConflict();
      } else {
        flow.request.hide();
      }
      return next;
    });
  }, [clearConflict, flow.request]);

  const closeSearch = useCallback(() => {
    leaveSearch();
    // The citekey-conflict strip is owned by the library-search context that
    // raised it — tearing that context down must clear it, or an orphaned amber
    // strip lingers over an unrelated list with its four actions still live on a
    // stale snapshot (task 096, Member A).
    clearConflict();
  }, [leaveSearch, clearConflict]);

  const handleOpenRequestForm = useCallback(() => {
    setShowSearch(false);
    flow.request.show();
  }, [flow.request]);

  // Case-folded (task 1325): a library `smith2020` beside a local `Smith2020`
  // is the SAME key to BibTeX and to `addBibEntry`'s dedupe, so it must take
  // the conflict / navigate paths below — an exact Map sent it straight to an
  // add the mutator silently refused, and the chip stayed "Add".
  const localEntryByKey = useMemo(() => bibKeyIndex(bibEntries), [bibEntries]);

  const handleAddEntry = useCallback(
    (entry: BibEntry) => flow.addEntry(entry, searchScope === "library"),
    [flow, searchScope],
  );



  // Row migration (task 477): the two filter rows and the export command were
  // bare `<button>`s, so this kebab's registry was EMPTY and the shared
  // keyboard controller swallowed Enter/Space/every arrow at window capture and
  // activated nothing. The filters are a mutually-exclusive PAIR, so they take
  // the `menuitemradio` spelling; the export is a `MenuActionRow`, whose
  // `disabled` renders a real disabled `<button>` (inert to click, skipped by
  // nav) rather than a live control with a `cursor-not-allowed` class and no
  // handler. All three still dismiss the kebab on pick — none passes
  // `keepMenuOpen` — which is what they did before through the bubbled click.
  const headerMenu = (
    <ItemMenu panelHeader>
      <PanelThemeMenuRow keys={["bib"]} />
      <MenuSeparator />
      <MenuSectionLabel>Display</MenuSectionLabel>
      <MenuRadioGroup
        idPrefix="filter-"
        ariaLabel="Display"
        options={BIB_FILTER_OPTIONS}
        value={filter}
        onPick={setFilter}
      />
      <MenuSeparator />
      <MenuActionRow
        id="export-cited"
        label="Export cited.bib"
        disabledReason={citedKeys.size === 0 ? "The paper cites nothing yet" : undefined}
        leading={
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        }
        onSelect={handleExportCited}
      />
    </ItemMenu>
  );

  const headerExtras = (
    <>
      <button
        type="button"
        onClick={handleToggleSearch}
        className="iconbtn-sm iconbtn-toggle"
        {...iconHint({ label: showSearch ? "Close search" : "Search" })}
        aria-pressed={showSearch}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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
      disabledReason: isLibraryConnected ? undefined : LIBRARY_NOT_CONNECTED_HINT,
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
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (isCancelEscape(e)) closeSearch();
              }}
              placeholder={
                searchScope === "local"
                  ? "Search local bibliography…"
                  : "Search library…"
              }
              density="dense"
              className="flex-1 min-w-0 text-xs px-2 py-1"
            />
            <SegmentedToggle
              ariaLabel="Search scope"
              value={searchScope}
              onChange={(scope) => {
                setSearchScope(scope);
                // Flipping away from library scope abandons the context that
                // raised the conflict strip — clear it so it can't linger over
                // the now-local list (task 096, Member A).
                if (scope === "local") clearConflict();
              }}
              options={[
                { value: "local", label: "Local", hint: "Search local" },
                {
                  value: "library",
                  label: "Library",
                  hint: "Search library",
                  disabled: !isLibraryConnected,
                  disabledHint: LIBRARY_NOT_CONNECTED_HINT,
                },
              ]}
            />
            <button
              type="button"
              onClick={closeSearch}
              className="iconbtn-xs"
              {...iconHint({ label: "Close search" })}
            >
              <CloseIcon size={12} />
            </button>
          </div>
          {searchScope === "library" && !isLibraryConnected && (
            <div className="text-2xs text-ink-muted mt-1.5">
              {LIBRARY_NOT_CONNECTED_HINT}
            </div>
          )}
          {searchScope === "library" &&
            isLibraryConnected &&
            !searchQuery.trim() && (
              <div className="text-2xs text-ink-muted mt-1.5">
                Type to search the central library ({libraryBibEntries.length}{" "}
                entries).
              </div>
            )}
        </div>
      )}

      <BibConflictStrip flow={flow} />
      <BibRequestForm flow={flow} />
    </>
  );

  const listTrailing =
    entryRequests.length > 0 ? (
      <BibPendingRequests requests={entryRequests} onRemove={onRemoveEntryRequest} />
    ) : null;

  return (
    <>
    <CardListPanel
      kind="bibliography"
      onAddOptions={addOptions}
      headerMenu={headerMenu}
      headerExtras={headerExtras}
      panelExtras={panelExtras}
      items={displayedEntries}
      getId={(e) => e.key}
      // Two blocks may share a citekey, and both are now listed (task 690), so
      // the reconciliation key is the block's own durable uid. The SELECTION id
      // above stays the citekey — that is what the occurrence cursor, the jump
      // and the identity cascade speak.
      getRenderKey={(e) => e.uid || e.key}
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
          if (!localEntryByKey.has(entry.key)) return false;
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
        // Scope-aware: hide the chip that matches the current search scope (a
        // local result doesn't need a "local" chip; a library result doesn't
        // need a "central" one). This used to name `provenanceFor`, a helper
        // with no production caller that task 500 deleted along with its dead
        // bib-state colour table — the naming is what made it read as live.
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
            onSelect={() => handleSelectBibKey(entry.key)}
            onJump={canJump ? (sourceEl) => handleJumpToBibKey(entry.key, sourceEl) : undefined}
            getAnnotation={getAnnotation}
            setAnnotation={setAnnotation}
            onRequestReview={onRequestReview}
            onCancelReview={onCancelReview}
            getReviewStatus={getReviewStatus}
            getReviewNotes={getReviewNotes}
            onSaveBibEntry={onSaveBibEntry}
            bibEntries={bibEntries}
            isCited={isCited}
            headerMeta={headerMeta}
            addAction={addAction}
            // A library result is a PREVIEW of `master.bib`'s record, not of
            // this paper's — so the card's whole write surface is withheld
            // (task 692). Every write it offers is addressed by citekey into
            // THIS paper's stores, so on a preview it either landed nowhere
            // (silently) or landed on a different record than the card names.
            // This is also the card's drag + pop-out gate, so "preview" is one
            // fact with one switch rather than a prop per affordance.
            readOnly={
              isPreviewResult
                ? {
                    reason:
                      "Library preview — add this entry to the paper to edit it.",
                  }
                : undefined
            }
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
    <BibLibraryPicker flow={flow} />
    </>
  );
}

export default memo(BibliographyPanel);
