"use client";

/**
 * Cross-library entry picker — compact floating dropdown that lets the
 * user search the central Virgil Library and pick one entry to act on.
 *
 * Reused by:
 *   - Bibliography panel: pick an entry to add to the paper's local bib.
 *
 * For citation-card use (search paper bib + library, lock a citekey onto
 * a row) see `src/panels/Citations/CitekeyPicker.tsx`.
 *
 * Thin wrapper around `BibEntryPickerMenu` — supplies the library data
 * source and per-entry decoration (verified pill, membership chips).
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
  type RowState,
  type MembershipChips,
} from "./BibEntryPickerMenu";

export type { RowState };

export interface LibraryEntryMenuProps {
  open: boolean;
  /** Trigger element for positioning. `anchorRect` wins if both given. */
  anchorEl?: HTMLElement | null;
  /** Caret-coord / floating-position anchor. */
  anchorRect?: DOMRect | null;
  onClose: () => void;
  /** Result of the pick. Return "conflict" to leave the row addable. */
  onPick: (entry: BibEntry) => Promise<RowState> | RowState;
  /** Per-entry initial state. Defaults to always "addable". */
  getRowState?: (entry: BibEntry) => RowState;
  placeholder?: string;
}

export function LibraryEntryMenu(props: LibraryEntryMenuProps) {
  const { entries: libraryBibEntries } = useLibraryMasterBib();
  const { items: libraryItems } = useLibraryItems();
  const { membershipMap } = useLibraryMemberships();

  const libraryByCitekey = useMemo(() => {
    const out = new Map<string, LibraryIndexItem>();
    for (const item of libraryItems) {
      if (item.citekey) out.set(item.citekey, item);
    }
    return out;
  }, [libraryItems]);

  const getLibraryItem = useCallback(
    (entry: BibEntry) => libraryByCitekey.get(entry.key),
    [libraryByCitekey],
  );

  const getMembershipChips = useCallback(
    (entry: BibEntry): MembershipChips =>
      membershipChipsFor({
        inLocal: false,
        inCentral: libraryByCitekey.has(entry.key),
        customLibraries: membershipMap.get(entry.key),
      }),
    [libraryByCitekey, membershipMap],
  );

  return (
    <BibEntryPickerMenu
      open={props.open}
      anchorEl={props.anchorEl}
      anchorRect={props.anchorRect}
      onClose={props.onClose}
      entries={libraryBibEntries}
      onPick={props.onPick}
      getRowState={props.getRowState}
      getLibraryItem={getLibraryItem}
      getMembershipChips={getMembershipChips}
      placeholder={props.placeholder ?? "Search library…"}
      ariaLabel="Search the central library"
      emptyHint={{
        noMatches: (q) => `No library entries match "${q}".`,
        noEntries: "Library is empty.",
        typeToSearch: "Type to search the library.",
      }}
    />
  );
}
