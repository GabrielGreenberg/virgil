"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import {
  formatMediumCitationParts,
  parseCiteCommand,
  serializeCiteCommand,
  type ParsedCiteKey,
} from "@/lib/bib-parser";
import {
  PanelCard,
  PANEL,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import BibEntryCard from "@/components/BibEntryCard";
import { MIME_CITATION } from "@/lib/marginalia";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { CitekeyPicker } from "./CitekeyPicker";

/* ── Command type options per package ─────────────────────────────── */

const NATBIB_TYPES = [
  { value: "cite", label: "\\cite" },
  { value: "citep", label: "\\citep" },
  { value: "citet", label: "\\citet" },
  { value: "citealt", label: "\\citealt" },
  { value: "citealp", label: "\\citealp" },
  { value: "citeauthor", label: "\\citeauthor" },
  { value: "citeyear", label: "\\citeyear" },
  { value: "citeyearpar", label: "\\citeyearpar" },
];

const BIBLATEX_TYPES = [
  { value: "cite", label: "\\cite" },
  { value: "cites", label: "\\cites" },
  { value: "autocite", label: "\\autocite" },
  { value: "autocites", label: "\\autocites" },
  { value: "textcite", label: "\\textcite" },
  { value: "textcites", label: "\\textcites" },
  { value: "parencite", label: "\\parencite" },
  { value: "parencites", label: "\\parencites" },
  { value: "footcite", label: "\\footcite" },
  { value: "footcites", label: "\\footcites" },
  { value: "smartcite", label: "\\smartcite" },
  { value: "smartcites", label: "\\smartcites" },
  { value: "fullcite", label: "\\fullcite" },
  { value: "footfullcite", label: "\\footfullcite" },
  { value: "citeauthor", label: "\\citeauthor" },
  { value: "citeyear", label: "\\citeyear" },
  { value: "citetitle", label: "\\citetitle" },
  { value: "citedate", label: "\\citedate" },
  { value: "citeurl", label: "\\citeurl" },
  { value: "nocite", label: "\\nocite" },
];

/** Biblatex command bases that have a `\xxxs` plural form, so per-key
 *  postnotes survive serialization. */
const HAS_PLURAL = new Set([
  "cite",
  "textcite",
  "parencite",
  "autocite",
  "footcite",
  "smartcite",
]);

/* ── Helpers ──────────────────────────────────────────────────────── */

function lastNameOf(author: string): string {
  const commaParts = author.split(",");
  if (commaParts.length >= 2) return commaParts[0].trim();
  const words = author.trim().split(/\s+/);
  return words[words.length - 1] || author.trim();
}

function firstThreeAuthorLastNames(authorField: string): string {
  const authors = authorField
    .split(" and ")
    .map((a) => a.trim())
    .filter(Boolean);
  if (authors.length === 0) return "";
  const names = authors.slice(0, 3).map(lastNameOf);
  if (authors.length === 1) return names[0];
  if (authors.length === 2) return `${names[0]} and ${names[1]}`;
  if (authors.length === 3)
    return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]}, ${names[1]}, ${names[2]}, et al.`;
}

function fullAuthorsForRow(authorField: string): string {
  const authors = authorField
    .split(" and ")
    .map((a) => a.trim())
    .filter(Boolean);
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  if (authors.length === 3)
    return `${authors[0]}, ${authors[1]}, and ${authors[2]}`;
  return `${authors[0]}, ${authors[1]}, ${authors[2]}, et al.`;
}

function venueForRow(entry: BibEntry | undefined): string {
  if (!entry) return "";
  const f = entry.fields;
  const journal = f.journal || f.booktitle || f.series || "";
  const bits: string[] = [];
  if (journal) bits.push(journal);
  if (f.volume) bits.push(`vol. ${f.volume}${f.number ? `, no. ${f.number}` : ""}`);
  else if (f.number) bits.push(`no. ${f.number}`);
  if (f.pages) bits.push(`pp. ${f.pages}`);
  if (f.publisher) bits.push(f.publisher);
  return bits.join(", ");
}

let _rowIdCounter = 0;
const nextRowId = () => `row_${++_rowIdCounter}`;

interface UiRow {
  id: string;
  key: string;
  prenote?: string;
  postnote?: string;
}

function inferTypeFromBare(command: string): {
  type: string;
  starred: boolean;
  capitalized: boolean;
} | null {
  const m = command.match(/^\\([A-Za-z]+)(\*?)$/);
  if (!m) return null;
  let name = m[1];
  const isUpper = name[0] >= "A" && name[0] <= "Z";
  if (isUpper) name = name[0].toLowerCase() + name.slice(1);
  return { type: name, starred: m[2] === "*", capitalized: isUpper };
}

function rowsFromCommand(command: string): UiRow[] {
  const parsed = parseCiteCommand(command);
  if (!parsed || parsed.entries.length === 0) return [{ id: nextRowId(), key: "" }];
  // For natbib, the parser puts pre/post at the top level. Mirror that
  // onto each row so the UI shows the shared value uniformly.
  const sharedPre = parsed.entries[0]?.prenote ?? parsed.prenote;
  const sharedPost = parsed.entries[0]?.postnote ?? parsed.postnote;
  return parsed.entries.map((e) => ({
    id: nextRowId(),
    key: e.key,
    prenote: e.prenote ?? sharedPre,
    postnote: e.postnote ?? sharedPost,
  }));
}

/* ── Card props ───────────────────────────────────────────────────── */

export interface CitationCardProps {
  citation: CitationRef;
  isSelected: boolean;
  bibEntries: BibEntry[];
  bibPackage: string;
  getDisplayText: (command: string) => string;
  onSelect: () => void;
  onJump: (sourceEl: HTMLElement | null) => void;
  onUpdateCitation: (id: string, command: string) => void;
  /** Add a library-only entry into the paper's references.bib. Used when
   *  the citekey picker locks onto an entry that doesn't yet exist in the
   *  local bib. */
  onAddBibEntry?: (entry: BibEntry) => void;
  /** Unused in the new layout (the inline BibEntryCard expansion is gone)
   *  but kept so the panel host can keep passing the callbacks for now. */
  getFormattedBib?: (entry: BibEntry) => string;
  getAnnotation?: (key: string) => string;
  setAnnotation?: (key: string, text: string) => void;
  onRequestReview?: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  onCancelReview?: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus?: (
    bibKey: string,
    type: "fields" | "notes",
  ) => "none" | "pending" | "complete";
  onUpdateBibEntry?: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType?: (
    oldKey: string,
    newKey: string,
    newType: string,
  ) => void;
  isAnchored?: boolean;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  onDelete?: (id: string) => void;
  /** True when this card is a placeholder for a not-yet-created citation
   *  (rendered by the panel's "+ Add citation" flow). Forces expanded
   *  layout. */
  isDraft?: boolean;
}

export function CitationCard({
  citation: cit,
  isSelected,
  bibEntries,
  bibPackage,
  getDisplayText,
  onSelect,
  onJump,
  onUpdateCitation,
  onAddBibEntry,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  isAnchored = true,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
  onTogglePopout,
  isPoppedOut,
  onDelete,
  isDraft = false,
}: CitationCardProps) {
  const theme = useCardTheme("citation");
  const bodyStyle = usePanelBodyStyle("citation");
  const popped = usePoppedCards();
  const cardKey = popKey("citations", cit.id);
  const ac = useAnchoredCard({ kind: "citation", id: cit.id });
  const isExpanded = isDraft || ac.expanded;
  const isHaloed = ac.selected || isSelected;
  const compressed = !isExpanded && !isPoppedOut;

  const bibEntryMap = useMemo(
    () => new Map(bibEntries.map((e) => [e.key, e])),
    [bibEntries],
  );

  /* ── Local UI state synced from cit.command ──────────────────────── */

  const [rows, setRows] = useState<UiRow[]>(() => rowsFromCommand(cit.command));
  const initialParsed = useMemo(
    () => parseCiteCommand(cit.command),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const initialBare = useMemo(
    () => (initialParsed ? null : inferTypeFromBare(cit.command)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [type, setType] = useState(
    initialParsed?.type || initialBare?.type || "cite",
  );
  const [starred, setStarred] = useState(
    initialParsed?.starred ?? initialBare?.starred ?? false,
  );
  const [capitalized, setCapitalized] = useState(
    initialParsed?.capitalized ?? initialBare?.capitalized ?? false,
  );

  /** Track the last command we wrote so we don't re-sync on our own
   *  writes (the panel echoes them back through cit.command). */
  const lastWrittenRef = useRef(cit.command);

  useEffect(() => {
    if (cit.command === lastWrittenRef.current) return;
    const fresh = parseCiteCommand(cit.command);
    setRows(rowsFromCommand(cit.command));
    setType(fresh?.type || "cite");
    setStarred(fresh?.starred ?? false);
    setCapitalized(fresh?.capitalized ?? false);
    lastWrittenRef.current = cit.command;
  }, [cit.command]);

  /** Serialize and emit. If validRows is empty, emit "" (won't survive
   *  in the parent store but the draft flow uses this to know it's empty). */
  const persist = useCallback(
    (overrides: {
      rows?: UiRow[];
      type?: string;
      starred?: boolean;
      capitalized?: boolean;
    }) => {
      const nextRows = overrides.rows ?? rows;
      const nextType = overrides.type ?? type;
      const nextStarred = overrides.starred ?? starred;
      const nextCapitalized = overrides.capitalized ?? capitalized;

      const validRows = nextRows.filter((r) => r.key.trim());
      if (validRows.length === 0) {
        if (cit.command !== "") {
          lastWrittenRef.current = "";
          onUpdateCitation(cit.id, "");
        }
        return;
      }
      const entries: ParsedCiteKey[] = validRows.map((r) => ({
        key: r.key.trim(),
        prenote: r.prenote || undefined,
        postnote: r.postnote || undefined,
      }));
      const command = serializeCiteCommand(
        {
          type: nextType,
          starred: nextStarred,
          capitalized: nextCapitalized,
          entries,
        },
        bibPackage,
      );
      lastWrittenRef.current = command;
      onUpdateCitation(cit.id, command);
    },
    [
      rows,
      type,
      starred,
      capitalized,
      cit.command,
      cit.id,
      bibPackage,
      onUpdateCitation,
    ],
  );

  /* ── Row mutations ───────────────────────────────────────────────── */

  // Each mutator computes `next` from the closure's current `rows`, calls
  // `setRows(next)`, then calls `persist({ rows: next })` — both at event
  // time. Calling `persist` from *inside* a `setRows` updater would invoke
  // `onUpdateCitation` (a parent setState) during React's reducer phase,
  // which React 18+ warns about as "Cannot update a component while
  // rendering a different component".
  const setRowKey = useCallback(
    (rowId: string, key: string) => {
      const next = rows.map((r) => (r.id === rowId ? { ...r, key } : r));
      setRows(next);
      persist({ rows: next });
    },
    [rows, persist],
  );

  const setRowPostnote = useCallback(
    (rowId: string, postnote: string) => {
      const next = rows.map((r) => (r.id === rowId ? { ...r, postnote } : r));

      // Auto-promote singular biblatex → plural form when rows now have
      // distinct postnotes, so each per-key range survives serialize.
      const distinctPostnotes =
        new Set(next.map((r) => r.postnote || "")).size > 1;
      const shouldPromote =
        bibPackage === "biblatex" &&
        HAS_PLURAL.has(type) &&
        next.length >= 2 &&
        distinctPostnotes;
      const nextType = shouldPromote ? type + "s" : type;

      setRows(next);
      if (shouldPromote) setType(nextType);
      persist({ rows: next, type: nextType });
    },
    [rows, persist, bibPackage, type],
  );

  const removeRow = useCallback(
    (rowId: string) => {
      const next =
        rows.length <= 1
          ? [{ id: nextRowId(), key: "" }]
          : rows.filter((r) => r.id !== rowId);
      setRows(next);
      persist({ rows: next });
    },
    [rows, persist],
  );

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, { id: nextRowId(), key: "" }]);
  }, []);

  /* ── Picker ──────────────────────────────────────────────────────── */

  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  /** When the picker is opened from the empty-row's merged search input,
   *  this is the live query text. The input is owned by `CitationKeyRow`;
   *  the value lives here so the picker can read it via `externalQuery`. */
  const [pickerExternalQuery, setPickerExternalQuery] = useState<string | null>(null);
  const [pickerExternalInputEl, setPickerExternalInputEl] = useState<HTMLInputElement | null>(null);
  const rowAnchorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const openPickerFor = useCallback((rowId: string) => {
    setPickerRowId(rowId);
    setPickerAnchor(rowAnchorRefs.current.get(rowId) ?? null);
    // Reset the external-input plumbing — set by the empty-row input on focus.
    setPickerExternalQuery(null);
    setPickerExternalInputEl(null);
  }, []);
  /** Opened from the merged "Add from library…" input. The input itself
   *  drives the query; the picker dropdown anchors beneath it. */
  const openPickerForInput = useCallback(
    (rowId: string, inputEl: HTMLInputElement, initialQuery: string) => {
      setPickerRowId(rowId);
      setPickerAnchor(inputEl);
      setPickerExternalQuery(initialQuery);
      setPickerExternalInputEl(inputEl);
    },
    [],
  );
  const closePicker = useCallback(() => {
    setPickerRowId(null);
    setPickerAnchor(null);
    setPickerExternalQuery(null);
    setPickerExternalInputEl(null);
  }, []);

  /* ── Inline BibEntryCard expansion ───────────────────────────────── */

  const [expandedBibKey, setExpandedBibKey] = useState<string | null>(null);
  const toggleBibKey = useCallback((key: string) => {
    setExpandedBibKey((prev) => (prev === key ? null : key));
  }, []);
  // Clear the expansion when the row's key disappears (e.g. row removed
  // or citekey replaced via the picker).
  useEffect(() => {
    if (expandedBibKey && !rows.some((r) => r.key === expandedBibKey)) {
      setExpandedBibKey(null);
    }
  }, [expandedBibKey, rows]);

  /* ── Drag and drop (merge a dragged bib key into the card) ───────── */

  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const display = getDisplayText(cit.command);
      const plain = display.replace(/<[^>]+>/g, "");
      e.dataTransfer.setData("text/plain", cit.command);
      e.dataTransfer.setData(
        MIME_CITATION,
        JSON.stringify({ command: cit.command, citationId: cit.id }),
      );
      e.dataTransfer.effectAllowed = "copy";
      const ghost = document.createElement("div");
      ghost.textContent =
        plain.length > 80 ? plain.slice(0, 80) + "…" : plain;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 14);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    },
    [cit, getDisplayText],
  );

  const handleCardDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME_CITATION)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!isDropTarget) setIsDropTarget(true);
    },
    [isDropTarget],
  );

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    setIsDropTarget(false);
  }, []);

  const handleCardDrop = useCallback(
    (e: React.DragEvent) => {
      const data = e.dataTransfer.getData(MIME_CITATION);
      if (!data) return;
      let parsed: { command?: string; bibKey?: string; citationId?: string };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!parsed.bibKey) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDropTarget(false);
      setRows((prev) => {
        if (prev.some((r) => r.key === parsed.bibKey)) return prev;
        // If the only row is empty, fill it instead of adding a new row.
        const allEmpty = prev.every((r) => !r.key.trim());
        const next = allEmpty
          ? [{ id: nextRowId(), key: parsed.bibKey! }]
          : [...prev, { id: nextRowId(), key: parsed.bibKey! }];
        persist({ rows: next });
        return next;
      });
    },
    [persist],
  );

  /* ── Code line (raw LaTeX editor) ────────────────────────────────── */

  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const codeDraftRef = useRef<string | null>(null);
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const commitCodeDraft = useCallback(() => {
    const v = codeDraftRef.current;
    if (codeDebounceRef.current) {
      clearTimeout(codeDebounceRef.current);
      codeDebounceRef.current = null;
    }
    if (v !== null && v !== cit.command) {
      lastWrittenRef.current = v;
      onUpdateCitation(cit.id, v);
    }
    codeDraftRef.current = null;
    setCodeDraft(null);
  }, [cit.command, cit.id, onUpdateCitation]);

  const updateCodeDraft = useCallback(
    (v: string) => {
      codeDraftRef.current = v;
      setCodeDraft(v);
      if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
      codeDebounceRef.current = setTimeout(() => {
        codeDebounceRef.current = null;
        lastWrittenRef.current = v;
        onUpdateCitation(cit.id, v);
      }, 250);
    },
    [cit.id, onUpdateCitation],
  );

  /* ── Overflow popover (* and Aa) ─────────────────────────────────── */

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowAnchorRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (!overflowAnchorRef.current) return;
      const target = e.target as Node;
      if (overflowAnchorRef.current.contains(target)) return;
      // The popover is a sibling inside the same card — allow clicks
      // inside the card; otherwise close.
      const card = overflowAnchorRef.current.closest(
        `[data-link-card="citation:${cit.id}"]`,
      );
      if (card && card.contains(target)) return;
      setOverflowOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [overflowOpen, cit.id]);

  /* ── Header (matches the compressed view in both states) ─────────── */

  const headerStyle: React.CSSProperties = {
    fontSize: "var(--par-title-size, 0.78rem)",
    color: theme.titleColor,
    fontWeight: 500,
    fontFamily: "var(--font-sans), Inter, sans-serif",
    letterSpacing: "0.02em",
    ...bodyStyle,
  };
  const headerRowSources = rows.filter((r) => r.key.trim());
  const headerRowData = (headerRowSources.length > 0
    ? headerRowSources
    : [{ id: "h_fallback", key: cit.keys[0] || "" }]
  ).map((r) => {
    const key = r.key.trim();
    const entry = key ? bibEntryMap.get(key) : undefined;
    return {
      id: r.id,
      key,
      author: entry
        ? firstThreeAuthorLastNames(entry.fields.author || "")
        : "",
      year: entry?.fields.year || entry?.fields.date || "",
      title: entry?.fields.title || "",
    };
  });
  const hasAnyHeaderKey = headerRowData.some((r) => r.key);
  const headerContent = (
    <div
      data-panel-kind="citation"
      className="leading-snug space-y-0.5"
      style={{
        ...headerStyle,
        overflowWrap: "anywhere",
      }}
      data-hint={
        hasAnyHeaderKey
          ? headerRowData
              .map((r) =>
                [r.author || r.key, r.year, r.title]
                  .filter(Boolean)
                  .join(" · "),
              )
              .join("\n")
          : "Citation"
      } aria-label={
                  hasAnyHeaderKey
                    ? headerRowData
                        .map((r) =>
                          [r.author || r.key, r.year, r.title]
                            .filter(Boolean)
                            .join(" · "),
                        )
                        .join("\n")
                    : "Citation"
                }
    >
      {hasAnyHeaderKey ? (
        headerRowData.map((r) => (
          <div key={r.id}>
            <span className="font-semibold">{r.author || r.key}</span>
            {r.year && (
              <>
                <span className="text-ink-body mx-1">&middot;</span>
                <span className="font-semibold">{r.year}</span>
              </>
            )}
            {r.title && (
              <>
                <span className="text-ink-body mx-1">&middot;</span>
                <span className="italic text-ink-body">{r.title}</span>
              </>
            )}
          </div>
        ))
      ) : (
        <span className="text-ink-faint italic">Citation</span>
      )}
    </div>
  );

  /* ── Visual state classes ────────────────────────────────────────── */

  const stateClass = isDropTarget
    ? "ring-2 ring-drag-target ring-offset-0"
    : !isAnchored
      ? "border-dashed opacity-80"
      : "";

  const onToggleFromCtx =
    onTogglePopout ??
    (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);

  const types = bibPackage === "natbib" ? NATBIB_TYPES : BIBLATEX_TYPES;

  /* ── Preview (rendered HTML) ─────────────────────────────────────── */

  const preview = useMemo(() => {
    if (!cit.command) return "";
    return getDisplayText(cit.command);
  }, [cit.command, getDisplayText]);

  /* ── Render ──────────────────────────────────────────────────────── */

  const card = (
    <PanelCard
      data-link-card={`citation:${cit.id}`}
      data-pristine-card-id={cit.id}
      data-card-key={cardKey}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={isHaloed}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      onTrashClick={!compressed && onDelete ? () => onDelete(cit.id) : undefined}
      cardKey={cardKey}
      isCollapsed={compressed}
      onToggleExpanded={ac.onToggleExpanded}
      onHeaderActivate={ac.onHeaderActivate}
      extraCardClass={`cursor-pointer cursor-grab active:cursor-grabbing ${stateClass}`}
      draggable={!isDraft && pickerRowId === null && codeDraft === null}
      onDragStart={handleDragStart}
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={handleCardDrop}
      className={wrapperClassName}
      style={wrapperStyle}
      onClick={(e) => {
        if (isDraft) return;
        ac.onActivate();
        onSelect();
        if (isAnchored) {
          onJump(
            (e.currentTarget as HTMLElement).closest(
              "[data-card]",
            ) as HTMLElement | null,
          );
        }
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id)
          cardStore.setHover(null);
      }}
      kind="citation"
      canJump={!isDraft}
      onJump={(e) =>
        onJump(
          (e.currentTarget as HTMLElement).closest(
            "[data-card]",
          ) as HTMLElement | null,
        )
      }
      title={
        !isAnchored && !isDraft
          ? "Unanchored citation — drag into the editor to anchor it"
          : undefined
      }
    >
      {compressed ? (
        <div className="px-3 py-1.5">{headerContent}</div>
      ) : (
        <>
          <div
            className={`${PANEL.cardInner}${
              isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <ul className="flex flex-col gap-2 list-none m-0 p-0">
              {rows.map((row) => (
                <CitationKeyRow
                  key={row.id}
                  row={row}
                  bibEntryMap={bibEntryMap}
                  canRemove={rows.length > 1 || row.key.trim().length > 0}
                  bibExpanded={
                    !!row.key.trim() && expandedBibKey === row.key.trim()
                  }
                  pickerOpenHere={pickerRowId === row.id && pickerExternalInputEl !== null}
                  pickerQuery={pickerRowId === row.id ? pickerExternalQuery : null}
                  onToggleBib={() => toggleBibKey(row.key.trim())}
                  onOpenPicker={() => openPickerFor(row.id)}
                  onOpenPickerForInput={(el, q) => openPickerForInput(row.id, el, q)}
                  onPickerQueryChange={(q) => setPickerExternalQuery(q)}
                  onChangePostnote={(p) => setRowPostnote(row.id, p)}
                  onRemove={() => removeRow(row.id)}
                  registerAnchor={(el) => {
                    if (el) rowAnchorRefs.current.set(row.id, el);
                    else rowAnchorRefs.current.delete(row.id);
                  }}
                />
              ))}
            </ul>

            {rows.some((r) => r.key.trim()) && (
              <button
                type="button"
                onClick={addRow}
                className="mt-2 inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink-body transition-colors"
                data-hint="Add another reference"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add reference…
              </button>
            )}
          </div>

          <div
            className={`border-t transition-colors ${
              isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"
            }`}
            style={
              isSelected
                ? { borderTopColor: theme.separatorSelected }
                : undefined
            }
          />

          <div
            className="px-3 py-2 bg-surface-muted/30 space-y-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-ink-body shrink-0">
                Type
              </span>
              <select
                value={type}
                onChange={(e) => {
                  const v = e.target.value;
                  setType(v);
                  persist({ type: v });
                }}
                className="text-xs font-mono border border-edge-hover rounded px-1.5 py-0.5 bg-surface min-w-0"
              >
                {types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="relative">
                <button
                  ref={overflowAnchorRef}
                  type="button"
                  onClick={() => setOverflowOpen((v) => !v)}
                  className="iconbtn-sm text-ink-body"
                  data-hint="More options" aria-label="More options"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>
                {overflowOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-edge-subtle rounded-md shadow-md p-2 space-y-1 w-44">
                    <label className="flex items-center gap-2 text-xs text-ink-body cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={starred}
                        onChange={(e) => {
                          setStarred(e.target.checked);
                          persist({ starred: e.target.checked });
                        }}
                        className="rounded border-edge-hover"
                      />
                      <span>
                        <span className="font-mono">*</span> Full author list
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ink-body cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={capitalized}
                        onChange={(e) => {
                          setCapitalized(e.target.checked);
                          persist({ capitalized: e.target.checked });
                        }}
                        className="rounded border-edge-hover"
                      />
                      <span>
                        <span className="font-mono">Aa</span> Sentence start
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] uppercase tracking-wide text-ink-body shrink-0">
                Code
              </span>
              {codeDraft !== null ? (
                <input
                  ref={codeInputRef}
                  autoFocus
                  type="text"
                  value={codeDraft}
                  onChange={(e) => updateCodeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                      e.preventDefault();
                      commitCodeDraft();
                    }
                  }}
                  onBlur={commitCodeDraft}
                  spellCheck={false}
                  className="text-[11px] font-mono text-ink-body bg-surface border border-edge-strong rounded px-1 py-0 outline-none flex-1 min-w-0 focus:ring-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    codeDraftRef.current = cit.command;
                    setCodeDraft(cit.command);
                  }}
                  className="text-[11px] font-mono text-ink-body truncate flex-1 min-w-0 text-left bg-transparent border border-transparent rounded px-1 py-0 cursor-text hover:border-edge-hover hover:bg-surface transition-colors"
                  data-hint="Edit raw LaTeX" aria-label="Edit raw LaTeX"
                >
                  {cit.command || (
                    <span className="text-ink-body italic">
                      no command yet
                    </span>
                  )}
                </button>
              )}
            </div>

            {preview && (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-ink-body shrink-0">
                  Preview
                </span>
                <span
                  className="text-[13px] text-ink-body truncate"
                  style={{
                    fontFamily:
                      "var(--font-serif-override, var(--font-serif)), 'Source Serif 4', Georgia, serif",
                  }}
                  dangerouslySetInnerHTML={{
                    __html: preview.replace(
                      /<\/?(?!\/?[ib]>)[^>]+>/gi,
                      "",
                    ),
                  }}
                />
              </div>
            )}
          </div>
        </>
      )}
    </PanelCard>
  );

  const expandedBibEntry = expandedBibKey
    ? bibEntryMap.get(expandedBibKey)
    : undefined;
  const canRenderBib =
    !!expandedBibEntry &&
    !!getFormattedBib &&
    !!getAnnotation &&
    !!setAnnotation &&
    !!onRequestReview &&
    !!onCancelReview &&
    !!getReviewStatus &&
    !!onUpdateBibEntry &&
    !!onUpdateBibKeyAndType;

  const bibInline = canRenderBib ? (
    <div
      className="ml-4 overflow-y-auto"
      style={
        isPoppedOut
          ? undefined
          : { maxHeight: "max(0px, calc(var(--dock-slot-frame-h, 80vh) - 160px))" }
      }
      onClick={(e) => e.stopPropagation()}
    >
      <BibEntryCard
        entry={expandedBibEntry!}
        isSelected={false}
        onClick={() => {}}
        getFormattedBib={getFormattedBib!}
        getAnnotation={getAnnotation!}
        setAnnotation={setAnnotation!}
        onRequestReview={onRequestReview!}
        onCancelReview={onCancelReview!}
        getReviewStatus={getReviewStatus!}
        onUpdateBibEntry={onUpdateBibEntry!}
        onUpdateBibKeyAndType={onUpdateBibKeyAndType!}
        bibPackage={bibPackage}
        bibEntries={bibEntries}
        isCited
      />
    </div>
  ) : null;

  const cardEl = (
    <>
      {bibInline ? (
        <div className="space-y-2">
          {card}
          {bibInline}
        </div>
      ) : (
        card
      )}
      <CitekeyPicker
        open={pickerRowId !== null}
        anchorEl={pickerAnchor}
        onClose={closePicker}
        paperBibEntries={bibEntries}
        initialQuery={
          pickerRowId
            ? rows.find((r) => r.id === pickerRowId)?.key || ""
            : ""
        }
        onSelectKey={(k) => {
          if (pickerRowId) setRowKey(pickerRowId, k);
        }}
        onAddBibEntry={onAddBibEntry}
        externalQuery={pickerExternalQuery ?? undefined}
        externalInputEl={pickerExternalInputEl}
      />
    </>
  );

  return cardEl;
}

/* ── CitationKeyRow ──────────────────────────────────────────────── */

interface CitationKeyRowProps {
  row: UiRow;
  bibEntryMap: Map<string, BibEntry>;
  canRemove: boolean;
  bibExpanded: boolean;
  /** True iff the picker is currently open on this row's empty input. The
   *  card owns the open/close state; the row uses this to know whether
   *  its input is the live search field. */
  pickerOpenHere: boolean;
  pickerQuery: string | null;
  onToggleBib: () => void;
  /** Open the picker for a filled-row citekey button (jump-to-change). */
  onOpenPicker: () => void;
  /** Open the picker from this row's empty merged input. */
  onOpenPickerForInput: (inputEl: HTMLInputElement, initialQuery: string) => void;
  onPickerQueryChange: (q: string) => void;
  onChangePostnote: (postnote: string) => void;
  onRemove: () => void;
  registerAnchor: (el: HTMLElement | null) => void;
}

function CitationKeyRow({
  row,
  bibEntryMap,
  canRemove,
  bibExpanded,
  pickerOpenHere,
  pickerQuery,
  onToggleBib,
  onOpenPicker,
  onOpenPickerForInput,
  onPickerQueryChange,
  onChangePostnote,
  onRemove,
  registerAnchor,
}: CitationKeyRowProps) {
  const trimmed = row.key.trim();
  const entry = trimmed ? bibEntryMap.get(trimmed) : undefined;
  const [pgOpen, setPgOpen] = useState(!!row.postnote);
  const [pgDraft, setPgDraft] = useState(row.postnote || "");
  const pgInputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPgDraft(row.postnote || "");
    if (row.postnote) setPgOpen(true);
  }, [row.postnote]);

  useEffect(() => {
    if (pgOpen && !row.postnote) {
      pgInputRef.current?.focus();
    }
  }, [pgOpen, row.postnote]);

  const commitPg = () => {
    if (pgDraft === (row.postnote || "")) return;
    onChangePostnote(pgDraft);
  };

  const copyCitekey = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trimmed) return;
    void navigator.clipboard.writeText(trimmed).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <li className="group/row flex flex-col gap-0.5">
      {/* Top line: filled = formatted citation. Empty = search input. */}
      {trimmed ? (
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="text-ink-body mt-[1px] select-none text-[12px] leading-none"
          >
            •
          </span>
          <div className="flex-1 min-w-0 text-[12px] leading-snug">
            {entry ? (
              <div className="text-ink-body">
                <span className="font-medium">
                  {fullAuthorsForRow(entry.fields.author || "") || trimmed}
                </span>
                {(entry.fields.year || entry.fields.date) && (
                  <>
                    <span className="text-ink-body">. </span>
                    <span className="font-medium">
                      {entry.fields.year || entry.fields.date}
                    </span>
                  </>
                )}
                {entry.fields.title && (
                  <>
                    <span className="text-ink-body">. </span>
                    <span className="italic">
                      “{entry.fields.title}”
                    </span>
                  </>
                )}
                {venueForRow(entry) && (
                  <>
                    <span className="text-ink-body">. </span>
                    <span>
                      {venueForRow(entry)}
                      {/\.$/.test(venueForRow(entry)) ? "" : "."}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="text-danger text-[11.5px]">
                <span className="font-mono">{trimmed}</span> — not in your
                bibliography
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="text-ink-body select-none text-[12px] leading-none"
          >
            •
          </span>
          <EmptyRowSearchInput
            pickerOpenHere={pickerOpenHere}
            pickerQuery={pickerQuery}
            onOpenPickerForInput={onOpenPickerForInput}
            onPickerQueryChange={onPickerQueryChange}
            registerAnchor={registerAnchor}
          />
          {canRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink-body hover:text-danger hover:bg-edge-subtle opacity-0 group-hover/row:opacity-100 transition-opacity"
              data-hint="Remove this row" aria-label="Remove this row"
            >
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Bottom line: citekey controls. Only shown when row has a key. */}
      {trimmed && (
        <div className="pl-[14px] flex items-center gap-1.5 text-[10.5px] text-ink-muted">
          <button
            type="button"
            ref={(el) => registerAnchor(el)}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPicker();
            }}
            className="font-mono text-ink-muted hover:text-ink-body underline decoration-dotted decoration-edge-hover underline-offset-2"
            data-hint="Click to change" aria-label="Click to change"
          >
            {trimmed}
          </button>
          <button
            type="button"
            onClick={copyCitekey}
            className="iconbtn-sm text-ink-muted hover:text-ink-body"
            data-hint={copied ? "Copied" : "Copy citekey"} aria-label={copied ? "Copied" : "Copy citekey"}
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
          {entry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleBib();
              }}
              className={`text-[10px] uppercase tracking-wide px-1 py-0 rounded ${
                bibExpanded
                  ? "text-ink-body bg-edge-subtle"
                  : "text-ink-muted hover:text-ink-body hover:bg-edge-subtle"
              }`}
              data-hint={bibExpanded ? "Hide bib entry" : "Show bib entry"}
            >
              Bib
            </button>
          )}
          {pgOpen ? (
            <span className="flex items-center gap-1">
              <input
                ref={pgInputRef}
                type="text"
                value={pgDraft}
                onChange={(e) => setPgDraft(e.target.value)}
                onBlur={commitPg}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitPg();
                    pgInputRef.current?.blur();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setPgDraft(row.postnote || "");
                    setPgOpen(!!row.postnote);
                    pgInputRef.current?.blur();
                  }
                }}
                placeholder="range"
                className="w-14 text-[10.5px] font-mono border border-edge-subtle rounded px-1 py-0 bg-surface focus:border-edge-strong outline-none"
              />
              {!row.postnote && pgDraft === "" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPgOpen(false);
                  }}
                  className="text-ink-muted hover:text-ink-body p-0.5"
                  data-hint="Close" aria-label="Close"
                >
                  <svg
                    width="9"
                    height="9"
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
              )}
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPgOpen(true);
              }}
              className="text-[10px] tracking-wide text-ink-muted hover:text-ink-body px-1 py-0 rounded hover:bg-edge-subtle"
              data-hint="Add a page range or locator"
            >
              +range
            </button>
          )}
          <div className="flex-1" aria-hidden />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink-muted hover:text-danger hover:bg-edge-subtle opacity-0 group-hover/row:opacity-100 transition-opacity ${
              !canRemove ? "pointer-events-none" : ""
            }`}
            data-hint="Remove this key" aria-label="Remove this key"
          >
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </li>
  );
}

/* ── EmptyRowSearchInput ─────────────────────────────────────────── */

/** Merged "Add from library…" + search field. When the user focuses it,
 *  the card opens its picker with this input as the external search field
 *  (so the dropdown sprouts directly beneath, with no second input). */
function EmptyRowSearchInput({
  pickerOpenHere,
  pickerQuery,
  onOpenPickerForInput,
  onPickerQueryChange,
  registerAnchor,
}: {
  pickerOpenHere: boolean;
  pickerQuery: string | null;
  onOpenPickerForInput: (inputEl: HTMLInputElement, initialQuery: string) => void;
  onPickerQueryChange: (q: string) => void;
  registerAnchor: (el: HTMLElement | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The picker owns the query when open; we display whatever it has.
  const displayValue = pickerOpenHere ? pickerQuery ?? "" : "";

  return (
    <input
      ref={(el) => {
        inputRef.current = el;
        registerAnchor(el);
      }}
      type="text"
      value={displayValue}
      placeholder="Add from library…"
      onFocus={(e) => {
        if (!pickerOpenHere) {
          onOpenPickerForInput(e.currentTarget, "");
        }
      }}
      onChange={(e) => {
        if (!pickerOpenHere) {
          onOpenPickerForInput(e.currentTarget, e.target.value);
        } else {
          onPickerQueryChange(e.target.value);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 text-[12px] text-ink-body placeholder:text-ink-body bg-transparent border border-dashed border-edge-subtle rounded px-2 py-1 outline-none hover:border-edge-hover focus:border-edge-strong focus:border-solid"
    />
  );
}
