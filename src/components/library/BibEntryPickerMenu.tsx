"use client";

/**
 * Presentational floating picker — searches a list of BibEntries, lets the
 * user pick one, and reports the resulting row state back to the caller.
 *
 * Used by:
 *   - `LibraryEntryMenu` (search the central library, add to local bib)
 *   - `CitekeyPicker` (search paper bib + library, pick a citekey for a
 *     citation card)
 *
 * The caller supplies the entries pool, per-entry RowState, and the pick
 * handler. Filtering is performed inside via `searchBibFuzzy`.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase C) ──
 * Migrated onto the `<Menu>` primitive's COMBOBOX path (`src/components/menu/`,
 * design `docs/agents/menu-system-design.md` §3.5 + §4 the BibEntryPicker row).
 * It renders via `<MenuProvider layout="combobox" role="listbox" portal>`; the
 * provider owns positioning (the old `useLayoutEffect` coord math + viewport
 * clamp → `placements` + the `maxHeight` clamp passthrough), click-outside
 * dismissal (the old `mousedown` effect → the provider's `useMenuDismiss`, with
 * `anchorEl` + `externalInputEl` moved into `excludeRefs`), Escape, and the
 * keyboard controller.
 *
 * The search `<input>` is the combobox input (`role="combobox" aria-expanded
 * aria-controls aria-activedescendant`) and the keyboard SOURCE — focus stays
 * in it. In INTERNAL-input mode the picker renders the input and spreads
 * `getInputProps(...)` onto it. In EXTERNAL-input mode the caller owns the
 * input; the picker attaches the composed `getInputProps(...).onKeyDown` to it
 * via an `addEventListener("keydown")` bridge (the input is also a dismiss
 * exemption via `excludeRefs`). Each `filtered` row registers via
 * `useMenuItem({ region: "list", role: "option", run })`; the bespoke
 * `selectedIndex` + `scrollIntoView` are replaced by the controller's roving
 * cursor + built-in scroll re-anchor.
 *
 * **ArrowLeft/Right = expand/collapse the active row's detail** rides the
 * combobox seam's `onArrowHorizontal` (design §4 / the new seam in
 * `useMenuCombobox`) instead of the old hand-rolled key handler.
 *
 * PRESERVED: the fuzzy filter, Enter picks the active entry OR commits raw
 * text, Escape closes, row expand/collapse, internal- AND external-input modes.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import type { BibEntry } from "@/lib/types";
import { searchBibFuzzy } from "@/lib/bib-searcher";
import { formatAuthorsTruncated } from "@/lib/bib-parser";
import type { LibraryIndexItem } from "@/lib/library/library-types";
import { LibraryMembershipChips } from "@/components/library/provenance-chips";
import { MenuProvider } from "@/components/menu/MenuProvider";
import { useMenuItem } from "@/components/menu/useMenuItem";
import { useMenuCombobox } from "@/components/menu/useMenuCombobox";
import { useMenuContext } from "@/components/menu/context";

export type RowState = "addable" | "added" | "conflict";

export type MembershipChips = React.ComponentProps<
  typeof LibraryMembershipChips
>["chips"];

export interface BibEntryPickerMenuProps {
  open: boolean;
  anchorEl?: HTMLElement | null;
  anchorRect?: DOMRect | null;
  onClose: () => void;
  /** Pool of entries to search. The component filters internally via
   *  `searchBibFuzzy`; the caller doesn't need to pre-filter. */
  entries: BibEntry[];
  /** Result of the pick. Return "conflict" to leave the row addable. */
  onPick: (entry: BibEntry) => Promise<RowState> | RowState;
  /** Per-entry initial state. Defaults to always "addable". */
  getRowState?: (entry: BibEntry) => RowState;
  /** Optional decoration data per entry (library-item provenance, chips). */
  getLibraryItem?: (entry: BibEntry) => LibraryIndexItem | undefined;
  getMembershipChips?: (entry: BibEntry) => MembershipChips;
  /** Free-text commit — invoked when the user presses Enter with no
   *  matching entry. Citation-card use enables this so an unknown citekey
   *  can still be locked in. */
  onCommitRaw?: (text: string) => void;
  /** Enter-commits-the-whole-pick hook for a DEFERRED create popover (the
   *  citation / any keep-open picker). When set, Enter still STAGES the
   *  active/raw key through the normal pick path, then ALSO fires this so the
   *  caller can commit everything staged and close in one keystroke. The
   *  just-staged key is passed through so the caller can fold it into the
   *  commit synchronously (the staged-state update is async). Absent for the
   *  in-card / panel pickers, where Enter picks-and-closes as before. */
  onEnterCommit?: (pickedKey?: string) => void;
  /** Optional initial query (e.g. preselect the current citekey when
   *  re-opening the picker on a filled citation row). */
  initialQuery?: string;
  placeholder?: string;
  /** Aria label for the dialog. */
  ariaLabel?: string;
  emptyHint?: {
    noMatches: (query: string) => string;
    noEntries: string;
    typeToSearch: string;
  };
  /** External-input mode — when set, the picker omits its own search input
   *  and reads the query from this prop. The caller (e.g. a citation card)
   *  renders the input so picker + trigger look like one field. The picker
   *  also attaches a keydown listener to `externalInputEl` to handle
   *  arrow navigation / Enter / Escape from the external input. */
  externalQuery?: string;
  /** Input element the caller owns. Required when `externalQuery` is set.
   *  The picker uses it both as the dismiss-exclusion zone (clicking the
   *  input doesn't close the picker) and as the keydown listener target. */
  externalInputEl?: HTMLElement | null;
  /** Optional sticky strip rendered INSIDE the popover, below the results list.
   *  The citation create popover uses it for the staged-citekey chips + the OK
   *  button (so they read as one floating surface with the search). Rendered as
   *  a `shrink-0` flex child; absent for every plain picker use. */
  footer?: React.ReactNode;
}

const POPUP_WIDTH = 360;

// The old hand-rolled positioner dropped the popover directly beneath the
// anchor and flipped it above when there was no room below — exactly
// `[{ side: "below", align: "start" }, { side: "above", align: "start" }]`.
const BIB_PICKER_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
];

const DEFAULT_HINTS: NonNullable<BibEntryPickerMenuProps["emptyHint"]> = {
  noMatches: (q) => `No entries match "${q}".`,
  noEntries: "No entries available.",
  typeToSearch: "Type to search.",
};

/** Stable registry id for an option row — keyed by the entry's citekey. */
function optionId(key: string): string {
  return `opt:${key}`;
}

export function BibEntryPickerMenu(props: BibEntryPickerMenuProps) {
  if (!props.open) return null;
  return <BibEntryPickerMenuInner {...props} />;
}

function BibEntryPickerMenuInner({
  anchorEl,
  anchorRect,
  onClose,
  entries,
  onPick,
  getRowState,
  getLibraryItem,
  getMembershipChips,
  onCommitRaw,
  onEnterCommit,
  initialQuery,
  placeholder = "Search…",
  ariaLabel = "Search entries",
  emptyHint = DEFAULT_HINTS,
  externalQuery,
  externalInputEl,
  footer,
}: BibEntryPickerMenuProps) {
  // The internal search input ref lives at the provider level so the
  // `getActiveDescendantHost` thunk (which the provider's keyboard controller
  // reads at keydown time) can resolve it. In external-input mode the
  // caller-owned `externalInputEl` is the host instead.
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Anchor priority: externalInputEl (external-input mode visually owns the
  // search field, so the popover must drop directly beneath it) > anchorRect
  // > anchorEl. Resolved lazily through a thunk so the provider re-reads the
  // live element rect (matching the old getBoundingClientRect-on-update).
  const anchorThunk = useCallback((): DOMRect | null => {
    if (anchorRect) return anchorRect;
    const sourceEl = externalInputEl ?? anchorEl ?? null;
    return sourceEl ? sourceEl.getBoundingClientRect() : null;
  }, [anchorRect, anchorEl, externalInputEl]);

  // The element whose `aria-activedescendant` mirrors the active option — the
  // caller-owned input in external mode, else our own search input.
  const getActiveDescendantHost = useCallback(
    (): HTMLElement | null => externalInputEl ?? inputRef.current,
    [externalInputEl],
  );

  // Dismiss exemptions: the trigger (clicking it again shouldn't self-close)
  // and the caller-owned external input (it IS the search field). These were
  // the old `mousedown` handler's `anchorEl`/`externalInputEl` contains-checks.
  const excludeRefs = useMemo(
    () => [anchorEl ?? null, externalInputEl ?? null],
    [anchorEl, externalInputEl],
  );

  if (typeof document === "undefined") return null;

  return (
    <MenuProvider
      id="bib-entry-picker"
      layout="combobox"
      role="listbox"
      portal
      anchorRect={anchorThunk}
      trackAnchor={anchorThunk}
      placements={BIB_PICKER_PLACEMENTS}
      gap={4}
      maxHeight
      keyboardSource="input"
      getActiveDescendantHost={getActiveDescendantHost}
      excludeRefs={excludeRefs}
      onClose={onClose}
      ariaLabel={ariaLabel}
      containerClassName="bib-entry-picker-menu bg-surface border border-edge-subtle rounded-lg shadow-md"
      containerStyle={{
        width: POPUP_WIDTH,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <BibEntryPickerBody
        entries={entries}
        onPick={onPick}
        getRowState={getRowState}
        getLibraryItem={getLibraryItem}
        getMembershipChips={getMembershipChips}
        onCommitRaw={onCommitRaw}
        onEnterCommit={onEnterCommit}
        initialQuery={initialQuery}
        placeholder={placeholder}
        emptyHint={emptyHint}
        externalQuery={externalQuery}
        externalInputEl={externalInputEl}
        inputRef={inputRef}
        onClose={onClose}
      />
      {footer}
    </MenuProvider>
  );
}

interface BodyProps {
  entries: BibEntry[];
  onPick: (entry: BibEntry) => Promise<RowState> | RowState;
  getRowState?: (entry: BibEntry) => RowState;
  getLibraryItem?: (entry: BibEntry) => LibraryIndexItem | undefined;
  getMembershipChips?: (entry: BibEntry) => MembershipChips;
  onCommitRaw?: (text: string) => void;
  onEnterCommit?: (pickedKey?: string) => void;
  initialQuery?: string;
  placeholder: string;
  emptyHint: NonNullable<BibEntryPickerMenuProps["emptyHint"]>;
  externalQuery?: string;
  externalInputEl?: HTMLElement | null;
  /** The provider-owned search-input ref (the activedescendant host in
   *  internal-input mode). */
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
}

/** The picker body — lives INSIDE the provider so it can drive the combobox
 *  (`useMenuCombobox`) and register each option (`useMenuItem`). */
function BibEntryPickerBody({
  entries,
  onPick,
  getRowState,
  getLibraryItem,
  getMembershipChips,
  onCommitRaw,
  onEnterCommit,
  initialQuery,
  placeholder,
  emptyHint,
  externalQuery,
  externalInputEl,
  inputRef,
  onClose,
}: BodyProps) {
  const isExternalInput = externalQuery !== undefined;
  const [internalQuery, setInternalQuery] = useState(initialQuery ?? "");
  const query = isExternalInput ? externalQuery! : internalQuery;

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [localAdded, setLocalAdded] = useState<Set<string>>(new Set());

  const { activeId, getInputProps } = useMenuCombobox();
  // The provider's registry — reached through the public context the primitive
  // already exposes (a leaf read, not a primitive change) so the body can seed
  // the default highlight onto the FIRST option. This preserves the old
  // `selectedIndex` default of 0: with matches present, the first row is
  // highlighted and Enter picks it without an explicit ArrowDown.
  const { registry } = useMenuContext();

  const filtered = useMemo(() => {
    if (!query.trim()) return entries.slice(0, 50);
    return searchBibFuzzy(entries, query, 50);
  }, [entries, query]);

  // Map an option's registry id back to its entry, so Enter on the roving-
  // active option commits the right one (built off the SAME `filtered` order
  // the rows register in).
  const idToEntry = useMemo(() => {
    const m = new Map<string, BibEntry>();
    for (const e of filtered) m.set(optionId(e.key), e);
    return m;
  }, [filtered]);

  // Default-highlight the FIRST filtered option (old: `selectedIndex` init 0 +
  // `setSelectedIndex(0)` on every query change). Re-seeds to the top whenever
  // the filtered set's head changes — i.e. on a query keystroke — so the active
  // id never lags behind the re-filtered list. A PASSIVE effect (not layout):
  // the rows register via their own passive `useMenuItem` effects, which — as
  // children of this body — run BEFORE this parent effect, so the first option
  // is already in the registry when we seed (`setActive` no-ops on an unknown
  // id). O(1) on a query change only (a small popover list), never per document
  // keystroke.
  const firstId = filtered.length > 0 ? optionId(filtered[0].key) : null;
  useEffect(() => {
    registry.setActive(firstId);
  }, [registry, firstId]);

  // Internal-input mode auto-focuses + selects the search field on open. Focus
  // synchronously AND re-assert on the next frame: the create popover (citation
  // / `\ref`) opens from an editor surface whose slash command re-focuses the
  // view (`view.focus()` after it deletes the typed `\cite`) and whose lightning/
  // grab menu blurs as it closes — either can steal the caret from the just-
  // mounted input. The rAF re-assert (mirroring `LabelRefPopover` create-mode)
  // lands the cursor in the search field regardless of that competition.
  useEffect(() => {
    if (isExternalInput) return;
    const focusInput = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    focusInput();
    const raf = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(raf);
  }, [isExternalInput, inputRef]);

  const rowStateFor = useCallback(
    (entry: BibEntry): RowState => {
      if (localAdded.has(entry.key)) return "added";
      return getRowState ? getRowState(entry) : "addable";
    },
    [getRowState, localAdded],
  );

  const performPick = useCallback(
    async (entry: BibEntry) => {
      const result = await Promise.resolve(onPick(entry));
      if (result === "added") {
        setLocalAdded((prev) => {
          const next = new Set(prev);
          next.add(entry.key);
          return next;
        });
      }
    },
    [onPick],
  );

  const trimmedQuery = query.trim();
  const showRawCommit =
    !!onCommitRaw && filtered.length === 0 && trimmedQuery.length > 0;

  // The active entry (the roving-active option), if any — used by Enter and by
  // the horizontal-arrow expand/collapse override.
  const activeEntry = activeId ? idToEntry.get(activeId) : undefined;

  // ArrowLeft/Right = expand/collapse the active row's detail. Routed through
  // the combobox seam's `onArrowHorizontal` (which intercepts a plain Left/
  // Right BEFORE the controller and preventDefaults it so the caret never
  // moves). Toggles regardless of direction, matching the old handler.
  const onArrowHorizontal = useCallback(() => {
    if (!activeEntry) return;
    setExpandedKey((prev) => (prev === activeEntry.key ? null : activeEntry.key));
  }, [activeEntry]);

  // The caller's keydown — the keys the combobox controller does NOT own
  // (Enter commits the active entry or the raw text; Escape closes). Arrow
  // nav + Home/End route through the controller; Left/Right route through
  // `onArrowHorizontal`. This is the merged handler for BOTH the internal
  // input (spread) and the external input (attached via addEventListener).
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Stage the active/raw key through the normal pick path (this is what
        // adds a library-only entry to the paper's bib), then — in a deferred
        // create popover (`onEnterCommit` set) — commit everything staged and
        // close. The just-staged key rides `onEnterCommit` so the caller can
        // fold it in synchronously (its own staged state hasn't ticked yet).
        if (activeEntry) {
          void performPick(activeEntry);
          onEnterCommit?.(activeEntry.key);
        } else if (showRawCommit) {
          onCommitRaw?.(trimmedQuery);
          onEnterCommit?.(trimmedQuery);
        } else {
          // Nothing to stage (empty list / empty query) — still let a create
          // popover commit whatever was staged earlier.
          onEnterCommit?.(undefined);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [
      activeEntry,
      performPick,
      showRawCommit,
      onCommitRaw,
      onEnterCommit,
      trimmedQuery,
      onClose,
    ],
  );

  const inputProps = getInputProps({
    open: filtered.length > 0,
    onKeyDown: onInputKeyDown,
    onArrowHorizontal,
  });

  // External-input mode: forward keyboard events from the caller-owned input
  // through the SAME composed combobox handler (nav → controller, Enter/
  // Escape/typing → onInputKeyDown). Replaces the old hand-rolled
  // addEventListener that called the bespoke key handler. `inputProps.onKeyDown`
  // only reads `e.key` + the modifier flags + `preventDefault`, so a coerced
  // native event is sufficient.
  useEffect(() => {
    if (!isExternalInput || !externalInputEl) return;
    const handler = (e: KeyboardEvent) => {
      inputProps.onKeyDown({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        preventDefault: () => e.preventDefault(),
      } as unknown as React.KeyboardEvent);
    };
    externalInputEl.addEventListener("keydown", handler);
    return () => externalInputEl.removeEventListener("keydown", handler);
  }, [isExternalInput, externalInputEl, inputProps]);

  return (
    <>
      {!isExternalInput && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge-subtle shrink-0">
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
            {...inputProps}
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setInternalQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 min-w-0 text-xs bg-transparent outline-none text-ink-body placeholder:text-ink-muted"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink-body p-0.5 shrink-0"
            data-hint="Close (Esc)"
            aria-label="Close (Esc)"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-ink-muted text-center space-y-2">
            <div>
              {trimmedQuery
                ? emptyHint.noMatches(trimmedQuery)
                : entries.length === 0
                  ? emptyHint.noEntries
                  : emptyHint.typeToSearch}
            </div>
            {showRawCommit && (
              <button
                type="button"
                onClick={() => onCommitRaw?.(trimmedQuery)}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-edge-subtle text-[11px] text-ink-body hover-on-light"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Use <span className="font-mono">{trimmedQuery}</span> as a raw
                citekey
              </button>
            )}
          </div>
        ) : (
          filtered.map((entry, i) => (
            <BibEntryPickerRow
              key={entry.key}
              index={i}
              entry={entry}
              expanded={expandedKey === entry.key}
              state={rowStateFor(entry)}
              libraryItem={getLibraryItem?.(entry)}
              membershipChips={getMembershipChips?.(entry) ?? []}
              onToggleExpand={() =>
                setExpandedKey((prev) => (prev === entry.key ? null : entry.key))
              }
              onPickClick={() => void performPick(entry)}
            />
          ))
        )}
      </div>
    </>
  );
}

interface RowProps {
  index: number;
  entry: BibEntry;
  expanded: boolean;
  state: RowState;
  libraryItem: LibraryIndexItem | undefined;
  membershipChips: MembershipChips;
  onToggleExpand: () => void;
  onPickClick: () => void;
}

function BibEntryPickerRow({
  index,
  entry,
  expanded,
  state,
  libraryItem,
  membershipChips,
  onToggleExpand,
  onPickClick,
}: RowProps) {
  const authors = formatAuthorsTruncated(entry.fields.author || "", 3);
  const year = entry.fields.year || entry.fields.date || "";
  const title = entry.fields.title || "";
  const verified = libraryItem?.bibState === "authenticated";
  const showVerifiedPill = libraryItem !== undefined;

  // The row registers as a listbox option — the roving cursor crosses it and
  // its `active` flag drives the selection highlight + aria-selected. Picking
  // is the registered `run` (Enter on the active row / click).
  const { active, getItemProps } = useMenuItem({
    id: optionId(entry.key),
    region: "list",
    role: "option",
    run: onPickClick,
    // The fuzzy search re-ranks key-stable rows (key={entry.key}), reordering
    // the DOM without remount — publish the live visual index so arrow-nav steps
    // through what the user sees, not stale insertion order.
    order: index,
  });
  const itemProps = getItemProps();

  const selected = active;
  const showCluster = selected || expanded;

  return (
    <div
      {...itemProps}
      data-row-index={index}
      aria-selected={selected}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        itemProps.onClick(e);
      }}
      className={`group relative px-2.5 py-1.5 cursor-pointer ${
        selected ? "bg-menu-roving" : "hover-on-light"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5 text-[12px] text-ink-body leading-tight">
            <span className="font-semibold truncate">
              {authors || entry.key}
            </span>
            {year && (
              <>
                <span className="text-ink-muted">·</span>
                <span className="font-semibold">{year}</span>
              </>
            )}
          </div>
          <div
            className="text-[11.5px] text-ink-body italic leading-tight mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap"
            data-hint={title}
            aria-label={title}
          >
            {title}
          </div>
        </div>
        <div
          className={`flex items-center gap-1 shrink-0 transition-opacity duration-100 ${
            showCluster
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="w-5 h-5 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover:bg-edge-subtle"
            data-hint={expanded ? "Hide details" : "Show details"}
            aria-label={expanded ? "Hide details" : "Show details"}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 120ms ease",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showVerifiedPill && (
            <VerifiedPill verified={verified} bibState={libraryItem?.bibState} />
          )}
          <AddButton state={state} onClick={onPickClick} />
        </div>
      </div>

      {expanded && (
        <ExpandedDetails entry={entry} membershipChips={membershipChips} />
      )}
    </div>
  );
}

function VerifiedPill({
  verified,
  bibState,
}: {
  verified: boolean;
  bibState: string | undefined;
}) {
  const tooltip = verified
    ? "Library entry authenticated against authoritative sources (Crossref / OpenAlex / etc.)"
    : bibState === "manuscript"
      ? "Manuscript / forthcoming — no external source applies"
      : bibState === "canonical"
        ? "Pre-digital classic — no DOI/ISBN registry will ever index it"
        : bibState === "failed"
          ? "Library entry couldn't be authenticated against external sources"
          : bibState === "unverified"
            ? "Library entry partially matched a source — fields are best-effort"
            : "Library entry has not been authenticated";
  const cls = verified
    ? "text-emerald-700 bg-emerald-50 border border-emerald-200"
    : "text-amber-700 bg-amber-50 border border-amber-200";
  return (
    <span
      className={`text-[9px] uppercase tracking-wide px-1 py-0.5 rounded whitespace-nowrap ${cls}`}
      data-hint={tooltip}
      aria-label={tooltip}
    >
      {verified ? "authenticated" : "unverified"}
    </span>
  );
}

function AddButton({
  state,
  onClick,
}: {
  state: RowState;
  onClick: () => void;
}) {
  if (state === "added") {
    return (
      <span
        className="w-5 h-5 flex items-center justify-center rounded-full text-emerald-600"
        data-hint="Already available here"
        aria-label="Already available here"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  const title = state === "conflict" ? "Add — citekey conflict" : "Add";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-5 h-5 flex items-center justify-center rounded-full text-blue-600 bg-blue-50 hover:bg-blue-100"
      data-hint={title}
      aria-label={title}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
}

function ExpandedDetails({
  entry,
  membershipChips,
}: {
  entry: BibEntry;
  membershipChips: MembershipChips;
}) {
  const author = entry.fields.author || "";
  const title = entry.fields.title || "";
  const year = entry.fields.year || entry.fields.date || "";
  const journal =
    entry.fields.journal ||
    entry.fields.booktitle ||
    entry.fields.series ||
    "";
  const volume = entry.fields.volume || "";
  const number = entry.fields.number || "";
  const pages = entry.fields.pages || "";
  const publisher = entry.fields.publisher || "";
  const doi = entry.fields.doi || "";

  const pubBits: string[] = [];
  if (journal) pubBits.push(journal);
  if (volume) pubBits.push(`vol. ${volume}${number ? `, no. ${number}` : ""}`);
  else if (number) pubBits.push(`no. ${number}`);
  if (pages) pubBits.push(`pp. ${pages}`);
  if (publisher) pubBits.push(publisher);

  return (
    <div className="mt-1.5 pl-2 border-l border-edge-subtle space-y-1">
      {author && (
        <div className="text-[11px] text-ink-body leading-snug">{author}</div>
      )}
      {title && (
        <div className="text-[11px] text-ink-body italic leading-snug">
          {title}
        </div>
      )}
      {(pubBits.length > 0 || year) && (
        <div className="text-[11px] text-ink-muted leading-snug">
          {pubBits.join(", ")}
          {pubBits.length > 0 && year ? ` (${year})` : year || ""}
        </div>
      )}
      {doi && (
        <div className="text-[10.5px] text-ink-muted font-mono leading-snug">
          doi:{doi}
        </div>
      )}
      <CitekeyRow citekey={entry.key} />
      {membershipChips.length > 0 && (
        <div className="pt-0.5">
          <LibraryMembershipChips chips={membershipChips} />
        </div>
      )}
    </div>
  );
}

function CitekeyRow({ citekey }: { citekey: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(citekey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [citekey]);
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] text-ink-muted font-mono">
      <span>citekey:</span>
      <span className="text-ink-body">{citekey}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
        className="text-ink-muted hover:text-ink-body p-0.5 rounded hover:bg-edge-subtle"
        data-hint={copied ? "Copied" : "Copy citekey"}
        aria-label={copied ? "Copied" : "Copy citekey"}
      >
        {copied ? (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-600"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
}
