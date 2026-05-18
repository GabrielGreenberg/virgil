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
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { BibEntry } from "@/lib/types";
import { searchBibFuzzy } from "@/lib/bib-searcher";
import { formatAuthorsTruncated } from "@/lib/bib-parser";
import type { LibraryIndexItem } from "@/lib/library/library-types";
import { LibraryMembershipChips } from "@/components/library/provenance-chips";

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
}

const POPUP_WIDTH = 360;
const VIEWPORT_MARGIN = 8;
const GAP = 4;

const DEFAULT_HINTS: NonNullable<BibEntryPickerMenuProps["emptyHint"]> = {
  noMatches: (q) => `No entries match "${q}".`,
  noEntries: "No entries available.",
  typeToSearch: "Type to search.",
};

export function BibEntryPickerMenu(props: BibEntryPickerMenuProps) {
  if (!props.open) return null;
  return <BibEntryPickerMenuInner {...props} />;
}

interface Coords {
  left: number;
  top: number;
  bottom: number;
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
  initialQuery,
  placeholder = "Search…",
  ariaLabel = "Search entries",
  emptyHint = DEFAULT_HINTS,
}: BibEntryPickerMenuProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [localAdded, setLocalAdded] = useState<Set<string>>(new Set());
  const [coords, setCoords] = useState<Coords | null>(null);

  const popupRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries.slice(0, 50);
    return searchBibFuzzy(entries, query, 50);
  }, [entries, query]);

  const safeSelectedIndex =
    filtered.length === 0
      ? 0
      : Math.min(Math.max(0, selectedIndex), filtered.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useLayoutEffect(() => {
    const update = () => {
      const rect =
        anchorRect ?? (anchorEl ? anchorEl.getBoundingClientRect() : null);
      if (!rect) {
        setCoords(null);
        return;
      }
      setCoords({ left: rect.left, top: rect.top, bottom: rect.bottom });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorEl, anchorRect]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!popupRef.current) return;
      if (popupRef.current.contains(e.target as Node)) return;
      if (anchorEl && anchorEl.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [anchorEl, onClose]);

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
  const showRawCommit = onCommitRaw && filtered.length === 0 && trimmedQuery.length > 0;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) {
        if (e.key === "Enter" && showRawCommit) {
          e.preventDefault();
          onCommitRaw?.(trimmedQuery);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = filtered[safeSelectedIndex];
        if (entry) void performPick(entry);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const entry = filtered[safeSelectedIndex];
        if (!entry) return;
        e.preventDefault();
        setExpandedKey((prev) => (prev === entry.key ? null : entry.key));
      }
    },
    [filtered, safeSelectedIndex, performPick, onClose, onCommitRaw, showRawCommit, trimmedQuery],
  );

  useEffect(() => {
    if (!listRef.current) return;
    const row = listRef.current.querySelector<HTMLDivElement>(
      `[data-row-index="${safeSelectedIndex}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [safeSelectedIndex]);

  if (!coords) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  let left = coords.left;
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, vw - POPUP_WIDTH - VIEWPORT_MARGIN),
  );
  const maxHeight = Math.min(440, vh - coords.bottom - GAP - VIEWPORT_MARGIN);
  const fitsBelow = maxHeight > 200 || vh - coords.bottom > vh - coords.top;
  const top = fitsBelow
    ? coords.bottom + GAP
    : Math.max(
        VIEWPORT_MARGIN,
        coords.top - GAP - Math.min(440, vh - 2 * VIEWPORT_MARGIN),
      );
  const computedMaxHeight = fitsBelow
    ? Math.max(220, maxHeight)
    : Math.min(440, coords.top - GAP - VIEWPORT_MARGIN);

  return createPortal(
    <div
      ref={popupRef}
      role="dialog"
      aria-label={ariaLabel}
      className="bib-entry-picker-menu bg-surface border border-edge-subtle rounded-md shadow-md"
      style={{
        position: "fixed",
        left,
        top,
        width: POPUP_WIDTH,
        maxHeight: computedMaxHeight,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
      }}
      onKeyDown={onKeyDown}
    >
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
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          placeholder={placeholder}
          className="flex-1 min-w-0 text-xs bg-transparent outline-none text-ink-body placeholder:text-ink-muted"
        />
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted hover:text-ink-body p-0.5 shrink-0"
          title="Close (Esc)"
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

      <div
        ref={listRef}
        role="listbox"
        className="flex-1 min-h-0 overflow-y-auto py-1"
      >
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
              selected={i === safeSelectedIndex}
              expanded={expandedKey === entry.key}
              state={rowStateFor(entry)}
              libraryItem={getLibraryItem?.(entry)}
              membershipChips={getMembershipChips?.(entry) ?? []}
              onHover={() => setSelectedIndex(i)}
              onToggleExpand={() =>
                setExpandedKey((prev) => (prev === entry.key ? null : entry.key))
              }
              onPickClick={() => void performPick(entry)}
            />
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}

interface RowProps {
  index: number;
  entry: BibEntry;
  selected: boolean;
  expanded: boolean;
  state: RowState;
  libraryItem: LibraryIndexItem | undefined;
  membershipChips: MembershipChips;
  onHover: () => void;
  onToggleExpand: () => void;
  onPickClick: () => void;
}

function BibEntryPickerRow({
  index,
  entry,
  selected,
  expanded,
  state,
  libraryItem,
  membershipChips,
  onHover,
  onToggleExpand,
  onPickClick,
}: RowProps) {
  const authors = formatAuthorsTruncated(entry.fields.author || "", 3);
  const year = entry.fields.year || entry.fields.date || "";
  const title = entry.fields.title || "";
  const verified = libraryItem?.bibState === "authenticated";
  const showVerifiedPill = libraryItem !== undefined;

  const showCluster = selected || expanded;

  return (
    <div
      data-row-index={index}
      role="option"
      aria-selected={selected}
      onMouseEnter={onHover}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onPickClick();
      }}
      className={`group relative px-2.5 py-1.5 cursor-pointer ${
        selected ? "bg-surface-muted" : "hover-on-light"
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
            title={title}
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
            title={expanded ? "Hide details" : "Show details"}
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
    ? "Library entry verified against authoritative sources (Crossref / OpenAlex / etc.)"
    : bibState === "manuscript"
      ? "Manuscript / forthcoming — no external source applies"
      : bibState === "canonical"
        ? "Pre-digital classic — no DOI/ISBN registry will ever index it"
        : bibState === "failed"
          ? "Library entry couldn't be verified against external sources"
          : bibState === "unverified"
            ? "Library entry partially matched a source — fields are best-effort"
            : "Library entry has not been verified";
  const cls = verified
    ? "text-emerald-700 bg-emerald-50 border border-emerald-200"
    : "text-amber-700 bg-amber-50 border border-amber-200";
  return (
    <span
      className={`text-[9px] uppercase tracking-wide px-1 py-0.5 rounded whitespace-nowrap ${cls}`}
      title={tooltip}
    >
      {verified ? "verified" : "unverified"}
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
        title="Already available here"
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
      title={title}
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
        title={copied ? "Copied" : "Copy citekey"}
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
