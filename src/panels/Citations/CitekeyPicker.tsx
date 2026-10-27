"use client";

/**
 * Floating picker for choosing a citekey on a citation card.
 *
 * Searches the union of the paper's `references.bib` and the central
 * Virgil Library, with paper entries shown as already-available and
 * library-only entries shown as addable. Picking a library entry both
 * adds it to `references.bib` and reports the citekey back to the caller
 * in one motion. Free-text Enter on no match commits a raw citekey so
 * unknown sources can still be referenced from the card — but only text that
 * IS a citekey (or a comma list of them): the commit goes through
 * `parseRawCitekeys`, the cite-side door of the one key rule (task 945), so a
 * search phrase or a stray `}` / `%` never reaches the `.tex`. A comma list
 * reaches the caller as its KEYS (task 1144) — every report out of this picker
 * is an array of single citekeys, so a card row or a staged chip can never
 * hold `a,b` as one key.
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
import { parseRawCitekeys } from "@/lib/bib-entry-head";
import { bibKeyIndex, citekeyIdentity } from "@/lib/bib-address";
import type { LiveAnchor } from "@/components/menu/live-anchor";
import {
  BibEntryPickerMenu,
  type MembershipChips,
  type RawCheck,
  type RowState,
} from "@/components/library/BibEntryPickerMenu";

export interface CitekeyPickerProps {
  open: boolean;
  anchorEl?: HTMLElement | null;
  anchorRect?: DOMRect | null;
  /** Forwarded to `BibEntryPickerMenu` (task 1190). */
  trackAnchor?: LiveAnchor;
  onClose: () => void;
  /** Escape / the header × — the CANCEL door, forwarded to
   *  `BibEntryPickerMenu`. Defaults to `onClose`; the deferred citation CREATE
   *  popover is the one caller that supplies it (task 687). */
  onCancel?: () => void;
  /** Paper's local references.bib entries. */
  paperBibEntries: BibEntry[];
  /** Commit citekeys onto the citation. Called with the picked entry's key
   *  (existing or just-added) or with the KEYS of a free-text commit — a
   *  typed comma list arrives split, one citekey per element (task 1144). */
  onSelectKeys: (citekeys: string[]) => void;
  /** Add a library-only entry to the paper's bib. The picker calls this
   *  right before reporting the citekey — once the bib mutation lands,
   *  the entry will turn into a paper-bib row on next render. REQUIRED
   *  (task 1143); `null` = this surface cannot add, so the picker lists only
   *  the paper's own entries rather than promising an add it cannot make. */
  onAddBibEntry: ((entry: BibEntry) => void) | null;
  /** Initial query — set to the current row's citekey when re-opening the
   *  picker on a filled citation row. */
  initialQuery?: string;
  /** External-input mode (see `BibEntryPickerMenuProps.externalQuery`). */
  externalQuery?: string;
  externalInputEl?: HTMLElement | null;
  /**
   * Stay open after a pick (the deferred citation CREATE popover). When true,
   * `onPick` / `onCommitRaw` report the key + add the bib entry but do NOT close
   * — the caller stages keys and commits on OK / click-away. Default `false`
   * keeps the in-card / panel behavior byte-identical (pick → commit → close).
   */
  keepOpenOnPick?: boolean;
  /** Enter-commits-the-whole-pick hook, forwarded to `BibEntryPickerMenu`. In
   *  `keepOpenOnPick` mode the deferred create popover passes this so Return
   *  stages the active key then commits + closes in one keystroke. The
   *  just-staged keys ride through (split like `onSelectKeys`; empty when
   *  nothing was staged) so the caller can fold them into the commit
   *  synchronously. Absent for the in-card / panel picker. */
  onEnterCommit?: (pickedKeys: string[]) => void;
  /** Sticky strip rendered inside the popover below the list (staged chips +
   *  OK), forwarded to `BibEntryPickerMenu`. */
  footer?: React.ReactNode;
}

export function CitekeyPicker({
  open,
  anchorEl,
  anchorRect,
  trackAnchor,
  onClose,
  onCancel,
  paperBibEntries,
  onSelectKeys,
  onAddBibEntry,
  initialQuery,
  externalQuery,
  externalInputEl,
  keepOpenOnPick = false,
  onEnterCommit,
  footer,
}: CitekeyPickerProps) {
  const { entries: libraryBibEntries } = useLibraryMasterBib();
  const { items: libraryItems } = useLibraryItems();
  const { membershipMap } = useLibraryMemberships();

  // Case-folded (task 1325): library `smith2020` IS paper `Smith2020` — the
  // same identity the add mutator's dedupe asks, so the picker never offers
  // an add that would be refused as a case-twin.
  const paperByCitekey = useMemo(
    () => bibKeyIndex(paperBibEntries),
    [paperBibEntries],
  );

  const libraryByCitekey = useMemo(() => {
    const out = new Map<string, LibraryIndexItem>();
    for (const item of libraryItems) {
      if (item.citekey) out.set(item.citekey, item);
    }
    return out;
  }, [libraryItems]);

  /** Merge paper bib + library; paper wins on citekey collisions. Without an
   *  add door no library-only row is offered: picking one would cite a key
   *  the paper's bib never gains (task 1143). */
  const canAdd = onAddBibEntry !== null;
  const mergedEntries = useMemo(() => {
    const out: BibEntry[] = [...paperBibEntries];
    if (!canAdd) return out;
    const seen = new Set(paperBibEntries.map((e) => citekeyIdentity(e.key)));
    for (const e of libraryBibEntries) {
      const id = citekeyIdentity(e.key);
      if (!seen.has(id)) {
        out.push(e);
        seen.add(id);
      }
    }
    return out;
  }, [paperBibEntries, libraryBibEntries, canAdd]);

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
      // A pick the paper already holds (even under another case) cites the
      // BIB's spelling, so the `\cite` resolves exactly under biber too.
      const held = paperByCitekey.get(entry.key);
      if (!held && onAddBibEntry !== null) {
        onAddBibEntry(entry);
      }
      onSelectKeys([held?.key ?? entry.key]);
      // Deferred create popover stays open to stage more keys (the caller
      // commits on OK / click-away); the in-card / panel picker closes on pick.
      if (!keepOpenOnPick) onClose();
      return "added";
    },
    [paperByCitekey, onAddBibEntry, onSelectKeys, onClose, keepOpenOnPick],
  );

  const checkRaw = useCallback((raw: string): RawCheck => {
    const parsed = parseRawCitekeys(raw);
    return parsed.ok ? { ok: true, text: parsed.keys.join(",") } : parsed;
  }, []);

  const onCommitRaw = useCallback(
    (raw: string) => {
      // The menu only offers text `checkRaw` passed; re-read it here anyway so
      // this door holds for any caller.
      const parsed = parseRawCitekeys(raw);
      if (!parsed.ok) return;
      onSelectKeys(parsed.keys);
      if (!keepOpenOnPick) onClose();
    },
    [onSelectKeys, onClose, keepOpenOnPick],
  );

  // The menu reports the just-staged key as ONE string — the active entry's
  // key or the raw text it vetted. Split it here exactly as `onCommitRaw` did,
  // so the Return-commit folds in the same keys the stage did. Text the key
  // rule refuses (only reachable as an existing entry's own key) passes whole:
  // it is the bib's own bytes, already the paper's to cite.
  const handleEnterCommit = useMemo(() => {
    if (!onEnterCommit) return undefined;
    return (pickedKey?: string) => {
      if (pickedKey === undefined) return onEnterCommit([]);
      const parsed = parseRawCitekeys(pickedKey);
      onEnterCommit(parsed.ok ? parsed.keys : [pickedKey]);
    };
  }, [onEnterCommit]);

  return (
    <BibEntryPickerMenu
      open={open}
      anchorEl={anchorEl}
      anchorRect={anchorRect}
      trackAnchor={trackAnchor}
      onClose={onClose}
      onCancel={onCancel}
      entries={mergedEntries}
      onPick={onPick}
      getRowState={getRowState}
      getLibraryItem={getLibraryItem}
      getMembershipChips={getMembershipChips}
      onCommitRaw={onCommitRaw}
      checkRaw={checkRaw}
      onEnterCommit={handleEnterCommit}
      initialQuery={initialQuery}
      placeholder="Search references or library…"
      ariaLabel="Pick a citation key"
      emptyHint={{
        noMatches: (q) => `No entries match "${q}". Press Enter to use it as a raw citekey.`,
        noEntries: "No bibliography entries available.",
        typeToSearch: "Type to search your bibliography and library.",
      }}
      externalQuery={externalQuery}
      externalInputEl={externalInputEl}
      footer={footer}
    />
  );
}
