"use client";

/**
 * Floating picker for choosing a citekey on a citation card.
 *
 * Searches the union of the paper's `references.bib` and the central
 * Virgil Library, with paper entries shown as already-available and
 * library-only entries shown as addable. Picking a library entry both
 * adds it to `references.bib` and reports the citekey back to the caller
 * in one motion. Free-text Enter on no match commits a raw citekey so
 * unknown sources can still be referenced from the card.
 *
 * Thin wrapper around `BibEntryPickerMenu`.
 */

import { useCallback, useMemo } from "react";
import type { BibEntry } from "@/lib/types";
import {
  useLibraryItems,
  useLibraryMasterBib,
  useLibraryMemberships,
} from "@/hooks/useLibrary";
import type { LibraryIndexItem } from "@/lib/library/library-types";
import { membershipChipsFor } from "@/components/library/provenance-chips";
import {
  BibEntryPickerMenu,
  type MembershipChips,
  type RowState,
} from "@/components/library/BibEntryPickerMenu";

export interface CitekeyPickerProps {
  open: boolean;
  anchorEl?: HTMLElement | null;
  anchorRect?: DOMRect | null;
  onClose: () => void;
  /** Paper's local references.bib entries. */
  paperBibEntries: BibEntry[];
  /** Commit a citekey onto the citation row. Called with the picked
   *  entry's key (existing or just-added) or the raw text from free-text
   *  commit. */
  onSelectKey: (citekey: string) => void;
  /** Add a library-only entry to the paper's bib. The picker calls this
   *  right before reporting the citekey — once the bib mutation lands,
   *  the entry will turn into a paper-bib row on next render. */
  onAddBibEntry?: (entry: BibEntry) => void;
  /** Initial query — set to the current row's citekey when re-opening the
   *  picker on a filled citation row. */
  initialQuery?: string;
}

export function CitekeyPicker({
  open,
  anchorEl,
  anchorRect,
  onClose,
  paperBibEntries,
  onSelectKey,
  onAddBibEntry,
  initialQuery,
}: CitekeyPickerProps) {
  const { entries: libraryBibEntries } = useLibraryMasterBib();
  const { items: libraryItems } = useLibraryItems();
  const { membershipMap } = useLibraryMemberships();

  const paperByCitekey = useMemo(() => {
    const out = new Map<string, BibEntry>();
    for (const e of paperBibEntries) out.set(e.key, e);
    return out;
  }, [paperBibEntries]);

  const libraryByCitekey = useMemo(() => {
    const out = new Map<string, LibraryIndexItem>();
    for (const item of libraryItems) {
      if (item.citekey) out.set(item.citekey, item);
    }
    return out;
  }, [libraryItems]);

  /** Merge paper bib + library; paper wins on citekey collisions. */
  const mergedEntries = useMemo(() => {
    const out: BibEntry[] = [...paperBibEntries];
    const seen = new Set(paperBibEntries.map((e) => e.key));
    for (const e of libraryBibEntries) {
      if (!seen.has(e.key)) {
        out.push(e);
        seen.add(e.key);
      }
    }
    return out;
  }, [paperBibEntries, libraryBibEntries]);

  const getRowState = useCallback(
    (entry: BibEntry): RowState =>
      paperByCitekey.has(entry.key) ? "added" : "addable",
    [paperByCitekey],
  );

  const getLibraryItem = useCallback(
    (entry: BibEntry) => libraryByCitekey.get(entry.key),
    [libraryByCitekey],
  );

  const getMembershipChips = useCallback(
    (entry: BibEntry): MembershipChips =>
      membershipChipsFor({
        inLocal: paperByCitekey.has(entry.key),
        inCentral: libraryByCitekey.has(entry.key),
        customLibraries: membershipMap.get(entry.key),
      }),
    [paperByCitekey, libraryByCitekey, membershipMap],
  );

  const onPick = useCallback(
    async (entry: BibEntry): Promise<RowState> => {
      if (!paperByCitekey.has(entry.key) && onAddBibEntry) {
        onAddBibEntry(entry);
      }
      onSelectKey(entry.key);
      onClose();
      return "added";
    },
    [paperByCitekey, onAddBibEntry, onSelectKey, onClose],
  );

  const onCommitRaw = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      onSelectKey(trimmed);
      onClose();
    },
    [onSelectKey, onClose],
  );

  return (
    <BibEntryPickerMenu
      open={open}
      anchorEl={anchorEl}
      anchorRect={anchorRect}
      onClose={onClose}
      entries={mergedEntries}
      onPick={onPick}
      getRowState={getRowState}
      getLibraryItem={getLibraryItem}
      getMembershipChips={getMembershipChips}
      onCommitRaw={onCommitRaw}
      initialQuery={initialQuery}
      placeholder="Search references or library…"
      ariaLabel="Pick a citation key"
      emptyHint={{
        noMatches: (q) => `No entries match "${q}". Press Enter to use it as a raw citekey.`,
        noEntries: "No bibliography entries available.",
        typeToSearch: "Type to search your bibliography and library.",
      }}
    />
  );
}
