"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import type { Editor } from "@tiptap/react";
import type {
  QuotationGroup,
  Reference,
  Quote,
  BibEntry,
  AiRequest,
} from "@/lib/types";
import {
  panelCard,
  PANEL,
  Chevron,
  ItemMenu,
  PanelHeader,
  PrevNextCounter,
  TargetIcon,
  useCycle,
  AiRequestCard,
  AiRequestsSectionHeader,
  cardOverrideStyle,
  headerOverrideStyle,
} from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import PanelThemePicker from "./PanelThemePicker";
import ViewToggle from "./ViewToggle";
import { useInTextPositions, getParagraphAnchorPositions } from "@/hooks/useInTextPositions";
import ConfirmDialog from "./ConfirmDialog";
import {
  formatMinimalCitation as fmtMinCite,
} from "@/lib/bib-parser";
import { MIME_QUOTE, MIME_QUOTATION } from "@/lib/marginalia";

/* ── Debounce helper ─────────────────────────────────────────────── */

function useDebouncedCallback<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args: any[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]) as unknown as T;
}

/* ── Delete X button with confirm dialog ────────────────────────── */

/**
 * A small "×" button that appears on hover of its parent (via the
 * `group-hover` / `group/xxx` pattern). Clicking it shows a
 * ConfirmDialog (fixed viewport overlay) before actually deleting,
 * so the confirmation is never clipped by scroll containers.
 */
function DeleteXButton({
  onConfirm,
  label = "Delete this item?",
}: {
  onConfirm: () => void;
  label?: string;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setAsking(true);
        }}
        className="opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-ink-faint hover:text-danger hover:bg-danger-soft"
        title="Delete"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <ConfirmDialog
        open={asking}
        message={label}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => { setAsking(false); onConfirm(); }}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}

/* ── Auto-resizing textarea ──────────────────────────────────────── */

function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  rows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);
  useEffect(resize, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      placeholder={placeholder}
      rows={rows}
      className={`w-full resize-none outline-none bg-transparent ${className ?? ""}`}
    />
  );
}

/* ── Cite Key Autocomplete ───────────────────────────────────────── */

function CiteKeyAutocomplete({
  value,
  bibEntries,
  onChange,
}: {
  value: string;
  bibEntries: BibEntry[];
  onChange: (key: string) => void;
}) {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setInputValue(value); }, [value]);

  const results = useMemo(() => {
    if (inputValue.length < 1) {
      return bibEntries
        .slice()
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, 12)
        .map((entry) => ({ entry, score: 0 }));
    }
    const q = inputValue.toLowerCase();
    const scored: { entry: BibEntry; score: number }[] = [];
    for (const entry of bibEntries) {
      let score = 0;
      if (entry.key.toLowerCase().startsWith(q)) score += 80;
      else if (entry.key.toLowerCase().includes(q)) score += 60;
      if (entry.fields.author?.toLowerCase().includes(q)) score += 40;
      if (entry.fields.title?.toLowerCase().includes(q)) score += 20;
      if (entry.fields.year?.includes(q)) score += 10;
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 12);
  }, [inputValue, bibEntries]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectEntry = useCallback(
    (key: string) => {
      setInputValue(key);
      onChange(key);
      setIsOpen(false);
    },
    [onChange]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && isOpen && results[highlightedIndex]) {
        e.preventDefault();
        selectEntry(results[highlightedIndex].entry.key);
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setInputValue(value);
      }
    },
    [results, highlightedIndex, isOpen, selectEntry, value]
  );

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-ink-muted uppercase tracking-wider whitespace-nowrap">
          Cite key
        </span>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            setTimeout(() => {
              if (inputValue !== value) onChange(inputValue);
            }, 150);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search bibliography..."
          className="flex-1 text-xs font-mono bg-transparent border-b border-edge-subtle focus:border-amber-400 outline-none py-0.5 text-ink-body"
        />
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 z-50 min-w-full max-h-48 overflow-y-auto">
          {results.map(({ entry }, i) => (
            <button
              key={entry.key}
              onMouseDown={(e) => { e.preventDefault(); selectEntry(entry.key); }}
              className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 text-xs ${
                i === highlightedIndex ? "bg-amber-50" : "hover:bg-surface-muted"
              }`}
            >
              <span className="font-mono font-semibold text-ink-strong shrink-0">{entry.key}</span>
              <span className="text-ink-muted truncate">
                {entry.fields.author ? entry.fields.author.slice(0, 30) : ""}
                {entry.fields.year ? ` (${entry.fields.year})` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Single Quote Entry (text + page only — no title) ────────────── */

/**
 * Build a citation command for the given cite key + optional page. The
 * command format matches the document's bib package (natbib → \citep,
 * biblatex → \parencite). Returns an empty string if no citeKey is set.
 */
function buildQuoteCitationCommand(
  citeKey: string,
  page: string,
  bibPackage: string,
): string {
  const key = citeKey.trim();
  if (!key) return "";
  const cmd = bibPackage === "natbib" ? "citep" : "parencite";
  const p = page.trim();
  const postnote = p
    ? /^[0-9ivxlcdmIVXLCDM]/.test(p)
      ? `p.~${p}`
      : p
    : "";
  return postnote ? `\\${cmd}[${postnote}]{${key}}` : `\\${cmd}{${key}}`;
}

const QuoteEntry = memo(function QuoteEntry({
  quote,
  groupId,
  referenceId,
  citeKey,
  bibPackage,
  canDelete,
  onUpdate,
  onDelete,
}: {
  quote: Quote;
  groupId: string;
  referenceId: string;
  citeKey: string;
  bibPackage: string;
  canDelete: boolean;
  onUpdate: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>
  ) => void;
  onDelete: (groupId: string, referenceId: string, quoteId: string) => void;
}) {
  const [text, setText] = useState(quote.text);
  const [page, setPage] = useState(quote.page);

  const debouncedUpdate = useDebouncedCallback(onUpdate, 400);

  const handleTextChange = useCallback(
    (v: string) => {
      setText(v);
      debouncedUpdate(groupId, referenceId, quote.id, { text: v });
    },
    [groupId, referenceId, quote.id, debouncedUpdate]
  );

  const handlePageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setPage(v);
      debouncedUpdate(groupId, referenceId, quote.id, { page: v });
    },
    [groupId, referenceId, quote.id, debouncedUpdate]
  );

  useEffect(() => { setText(quote.text); }, [quote.text]);
  useEffect(() => { setPage(quote.page); }, [quote.page]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Stop propagation so the enclosing group card's drag handler
      // (which drops a paragraph anchor) doesn't also fire
      e.stopPropagation();
      const command = buildQuoteCitationCommand(citeKey, page, bibPackage);
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData(
        MIME_QUOTE,
        JSON.stringify({
          quoteText: text,
          command,
        }),
      );
      // Plain-text fallback — quoted text with citation marker
      const fallback = command ? `"${text}" ${command}` : `"${text}"`;
      e.dataTransfer.setData("text/plain", fallback);
    },
    [text, citeKey, page, bibPackage],
  );

  const podRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={podRef}
      className={`group/card ${PANEL.subpodWhite} p-3`}
      title="Drag handle to insert quote with citation"
    >
      {/* Quote text */}
      <div className="flex items-start gap-2">
        <div
          draggable
          onDragStart={(e) => {
            handleDragStart(e);
            if (podRef.current) {
              e.dataTransfer.setDragImage(podRef.current, 20, -10);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing p-0.5 pt-1 -ml-1 rounded text-ink-faint group-hover/card:text-ink-subtle transition-colors shrink-0"
          title="Drag quote into document"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="2" r="1.2" />
            <circle cx="7" cy="2" r="1.2" />
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="7" cy="7" r="1.2" />
            <circle cx="3" cy="12" r="1.2" />
            <circle cx="7" cy="12" r="1.2" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <AutoTextarea
            value={text}
            onChange={handleTextChange}
            placeholder="Enter quoted text..."
            className="text-sm text-ink-body leading-relaxed italic"
            rows={1}
          />
        </div>
        {canDelete && (
          <DeleteXButton
            onConfirm={() => onDelete(groupId, referenceId, quote.id)}
            label="Delete this quote?"
          />
        )}
      </div>

      {/* Page number */}
      <div className="flex items-center mt-1.5 pt-1.5 border-t border-stone-100">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-ink-muted">p.</span>
          <input
            type="text"
            value={page}
            onChange={handlePageChange}
            placeholder="--"
            className="w-14 text-xs font-mono bg-transparent outline-none text-ink-body border-b border-transparent focus:border-edge-hover"
          />
        </div>
      </div>
    </div>
  );
});

/* ── Reference block (flat: citeKey + quote pods, no enclosing sub-pod) ── */

const ReferenceBlock = memo(function ReferenceBlock({
  reference,
  groupId,
  bibEntries,
  bibPackage,
  canDelete,
  onUpdateCiteKey,
  onDeleteReference,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
}: {
  reference: Reference;
  groupId: string;
  bibEntries: BibEntry[];
  bibPackage: string;
  canDelete: boolean;
  onUpdateCiteKey: (groupId: string, referenceId: string, key: string) => void;
  onDeleteReference: (groupId: string, referenceId: string) => void;
  onAddQuote: (groupId: string, referenceId: string) => string;
  onUpdateQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>
  ) => void;
  onDeleteQuote: (groupId: string, referenceId: string, quoteId: string) => void;
}) {
  const matchedEntry = bibEntries.find((e) => e.key === reference.citeKey);
  const [editingCiteKey, setEditingCiteKey] = useState(false);

  const cleanTitle = useMemo(() => {
    if (!matchedEntry?.fields.title) return null;
    return matchedEntry.fields.title.replace(/[{}]/g, "");
  }, [matchedEntry]);

  const handleCiteKeyChange = useCallback(
    (key: string) => {
      onUpdateCiteKey(groupId, reference.id, key);
      setEditingCiteKey(false);
    },
    [onUpdateCiteKey, groupId, reference.id]
  );

  // Label for the cite key chip — mirrors CitationCard's key buttons
  const chipLabel = matchedEntry
    ? fmtMinCite(reference.citeKey, bibEntries)
    : reference.citeKey || "No key";

  return (
    <div className="group/card space-y-2">
      {/* Reference header — cite key chip + author info (modeled after CitationCard) */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* Cite key chip */}
          <div className="flex flex-wrap gap-1.5 mb-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingCiteKey((v) => !v);
              }}
              className={`inline-block rounded-[3px] border px-1.5 py-0.5 text-xs cursor-pointer transition-colors ${
                !matchedEntry
                  ? "border-dashed border-red-300 text-danger bg-danger-soft/50"
                  : editingCiteKey
                    ? "bg-[#fef3c3] border-[#d4a843] text-[#4a3f20]"
                    : "bg-[#fdf8e1] border-[#e0d5a8] text-[#6b6245] hover:bg-[#fef3c3] hover:border-[#d4a843]"
              }`}
            >
              {chipLabel}
            </button>
          </div>
          {/* Author + title display */}
          {matchedEntry && cleanTitle && (
            <p className="text-[11px] text-ink-subtle leading-snug">
              {cleanTitle}
            </p>
          )}
          {!matchedEntry && !reference.citeKey && (
            <p className="text-xs text-ink-muted italic">No reference selected</p>
          )}
        </div>
        {/* Delete reference X button */}
        {canDelete && (
          <DeleteXButton
            onConfirm={() => onDeleteReference(groupId, reference.id)}
            label="Delete this reference and its quotes?"
          />
        )}
      </div>

      {/* Cite key autocomplete — toggled by clicking the chip */}
      {editingCiteKey && (
        <CiteKeyAutocomplete
          value={reference.citeKey}
          bibEntries={bibEntries}
          onChange={handleCiteKeyChange}
        />
      )}

      {/* Inline cite key display + edit button (matches CitationCard pattern) */}
      {!editingCiteKey && reference.citeKey && (
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-xs font-mono text-ink-muted truncate flex-1 min-w-0">
            {reference.citeKey}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingCiteKey(true);
            }}
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-edge-subtle text-ink-muted hover:text-ink-body hover:bg-surface-muted-strong hover:border-edge-hover transition-colors flex-shrink-0"
            title="Edit cite key"
          >
            Edit
          </button>
        </div>
      )}

      {/* Quote pods — each draggable onto the editor */}
      <div className="space-y-1.5">
        {reference.quotes.map((q) => (
          <QuoteEntry
            key={q.id}
            quote={q}
            groupId={groupId}
            referenceId={reference.id}
            citeKey={reference.citeKey}
            bibPackage={bibPackage}
            canDelete={reference.quotes.length > 1}
            onUpdate={onUpdateQuote}
            onDelete={onDeleteQuote}
          />
        ))}
      </div>

      {/* Add quote button */}
      <button
        onClick={() => onAddQuote(groupId, reference.id)}
        className="text-[11px] text-amber-600 hover:text-amber-700 transition-colors"
      >
        + Add quote
      </button>
    </div>
  );
});

/* ── Collapsible Notes ───────────────────────────────────────────── */

function CollapsibleNotes({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [localNotes, setLocalNotes] = useState(notes);
  const debouncedSave = useDebouncedCallback(onChange, 400);

  useEffect(() => { setLocalNotes(notes); }, [notes]);

  const handleChange = useCallback(
    (v: string) => {
      setLocalNotes(v);
      debouncedSave(v);
    },
    [debouncedSave]
  );

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-xs text-ink-subtle hover:text-ink-body transition-colors"
      >
        <Chevron expanded={expanded} />
        <span>Notes</span>
        {!expanded && notes && (
          <span className="text-[10px] text-ink-muted truncate max-w-[140px]">
            -- {notes.slice(0, 60)}
          </span>
        )}
      </button>
      {expanded && (
        <div className={`${PANEL.subpod} mt-1.5`}>
          <textarea
            value={localNotes}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Add notes..."
            rows={3}
            className="w-full resize-none outline-none bg-transparent text-xs text-ink-body leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}

/* ── Group Card ──────────────────────────────────────────────────── */

export function QuotationGroupCard({
  group,
  bibEntries,
  bibPackage,
  selected,
  onSelect,
  onDelete,
  onJump,
  onUpdateGroupTitle,
  onAddReference,
  onDeleteReference,
  onUpdateReferenceCiteKey,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onUpdateNotes,
}: {
  group: QuotationGroup;
  bibEntries: BibEntry[];
  bibPackage: string;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onJump?: () => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onAddReference: (groupId: string) => string;
  onDeleteReference: (groupId: string, referenceId: string) => void;
  onUpdateReferenceCiteKey: (groupId: string, referenceId: string, key: string) => void;
  onAddQuote: (groupId: string, referenceId: string) => string;
  onUpdateQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>
  ) => void;
  onDeleteQuote: (groupId: string, referenceId: string, quoteId: string) => void;
  onUpdateNotes: (groupId: string, notes: string) => void;
}) {
  // Local title state with debounced persist
  const [title, setTitle] = useState(group.title);
  useEffect(() => { setTitle(group.title); }, [group.title]);
  const debouncedTitleUpdate = useDebouncedCallback(onUpdateGroupTitle, 400);
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setTitle(v);
      debouncedTitleUpdate(group.id, v);
    },
    [group.id, debouncedTitleUpdate]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = "link";
      e.dataTransfer.setData(
        MIME_QUOTATION,
        JSON.stringify({ groupId: group.id })
      );
    },
    [group.id]
  );

  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const theme = useCardTheme("quote");

  const tryDelete = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
        e.preventDefault();
        tryDelete();
      }
    },
    [selected, tryDelete],
  );

  return (
    <div
      ref={cardRef}
      className={`group ${panelCard(selected)} focus:outline-none`}
      style={cardOverrideStyle(theme, selected)}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      data-quotation-group-id={group.id}
      tabIndex={selected ? 0 : -1}
      onFocusCapture={() => { if (!selected) onSelect(); }}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div
        ref={headerRef}
        className={`flex items-center gap-2 px-3 py-1.5 ${selected ? "bg-amber-50/60" : "bg-amber-50/30"}`}
        style={headerOverrideStyle(theme, selected)}
      >
        {/* Grab handle — card-level anchor drag (marginalia). Drag ghost
            is just the header, since the card-level drop only places a
            marginalia anchor (not the inner quotes). */}
        <div
          draggable
          onDragStart={(e) => {
            handleDragStart(e);
            if (headerRef.current) {
              e.dataTransfer.setDragImage(headerRef.current, 20, -10);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-ink-faint group-hover:text-ink-subtle transition-colors shrink-0"
          title="Drag to anchor to paragraph"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="2" r="1.2" />
            <circle cx="7" cy="2" r="1.2" />
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="7" cy="7" r="1.2" />
            <circle cx="3" cy="12" r="1.2" />
            <circle cx="7" cy="12" r="1.2" />
          </svg>
        </div>
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          placeholder="Group title..."
          className="flex-1 min-w-0 bg-transparent outline-none overflow-hidden text-ellipsis placeholder:text-ink-muted placeholder:font-normal"
          style={{ fontSize: "var(--par-title-size, 0.78rem)", color: theme.override ? theme.titleColor : "#92700a", fontWeight: 500, fontFamily: "var(--font-sans), Inter, sans-serif", letterSpacing: "0.02em" }}
        />
        {/* Inline delete */}
        <button
          onClick={(e) => { e.stopPropagation(); tryDelete(); }}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-ink-muted hover:text-danger shrink-0"
          title="Delete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <ConfirmDialog
          open={confirmOpen}
          message="Delete this quotation group?"
          confirmLabel="Delete"
          tone="danger"
          anchorRef={cardRef}
          onConfirm={() => { setConfirmOpen(false); onDelete(); }}
          onCancel={() => setConfirmOpen(false)}
        />
        {onJump && (
          <TargetIcon onClick={onJump} title="Jump to quotation in text" />
        )}
      </div>

      {/* Separator */}
      <div className={`border-t transition-colors ${selected ? "border-amber-200" : "border-edge-subtle group-hover:border-edge-hover"}`} />

      {/* Body */}
      <div className="relative px-3 pt-1.5 pb-2">
        {/* References — flat, separated by a thin divider when multiple */}
        <div
          className="space-y-3 divide-y divide-stone-100 [&>*:not(:first-child)]:pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {group.references.map((r) => (
            <ReferenceBlock
              key={r.id}
              reference={r}
              groupId={group.id}
              bibEntries={bibEntries}
              bibPackage={bibPackage}
              canDelete={group.references.length > 1}
              onUpdateCiteKey={onUpdateReferenceCiteKey}
              onDeleteReference={onDeleteReference}
              onAddQuote={onAddQuote}
              onUpdateQuote={onUpdateQuote}
              onDeleteQuote={onDeleteQuote}
            />
          ))}
        </div>

        {/* Add reference button */}
        <button
          onClick={(e) => { e.stopPropagation(); onAddReference(group.id); }}
          className="mt-2 text-xs text-amber-600 hover:text-amber-700 transition-colors"
        >
          + Add reference
        </button>

        {/* Collapsible notes */}
        <div onClick={(e) => e.stopPropagation()}>
          <CollapsibleNotes
            notes={group.notes}
            onChange={(notes) => onUpdateNotes(group.id, notes)}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Main Panel ──────────────────────────────────────────────────── */

export interface QuotationsPanelProps {
  groups: QuotationGroup[];
  bibEntries: BibEntry[];
  bibPackage: string;
  citationStyle: string;
  onAddGroup: () => QuotationGroup;
  onDeleteGroup: (groupId: string) => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onAddReference: (groupId: string) => string;
  onDeleteReference: (groupId: string, referenceId: string) => void;
  onUpdateReferenceCiteKey: (groupId: string, referenceId: string, key: string) => void;
  onAddQuote: (groupId: string, referenceId: string) => string;
  onUpdateQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>
  ) => void;
  onDeleteQuote: (groupId: string, referenceId: string, quoteId: string) => void;
  onUpdateNotes: (groupId: string, notes: string) => void;
  /** Optional controlled selected group id */
  selectedGroupId?: string | null;
  onSelectGroup?: (groupId: string | null) => void;
  onScrollToParagraph?: (uuid: string) => void;
  aiRequests?: AiRequest[];
  onAddAiRequest?: () => void;
  onUpdateAiRequestText?: (id: string, text: string) => void;
  onDeleteAiRequest?: (id: string) => void;
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  editor: Editor | null;
  panelSide: "left" | "right";
}

export default function QuotationsPanel({
  groups,
  bibEntries,
  bibPackage,
  onAddGroup,
  onDeleteGroup,
  onUpdateGroupTitle,
  onAddReference,
  onDeleteReference,
  onUpdateReferenceCiteKey,
  onAddQuote,
  onUpdateQuote,
  onDeleteQuote,
  onUpdateNotes,
  selectedGroupId: controlledSelectedGroupId,
  onSelectGroup,
  onScrollToParagraph,
  aiRequests,
  onAddAiRequest,
  onUpdateAiRequestText,
  onDeleteAiRequest,
  viewMode,
  onViewModeChange,
  editor,
  panelSide,
}: QuotationsPanelProps) {
  const myAiRequests = useMemo(
    () => (aiRequests ?? []).filter((r) => r.kind === "quotation"),
    [aiRequests],
  );
  const [internalSelectedGroupId, setInternalSelectedGroupId] = useState<
    string | null
  >(null);
  const selectedGroupId =
    controlledSelectedGroupId !== undefined
      ? controlledSelectedGroupId
      : internalSelectedGroupId;
  const setSelectedGroupId = useCallback(
    (id: string | null) => {
      if (onSelectGroup) onSelectGroup(id);
      else setInternalSelectedGroupId(id);
    },
    [onSelectGroup]
  );

  // Scroll the selected group into view when selection changes externally
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedGroupId) return;
    const el = listRef.current?.querySelector(
      `[data-quotation-group-id="${selectedGroupId}"]`
    );
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedGroupId]);

  const handleAdd = useCallback(() => {
    const g = onAddGroup();
    setSelectedGroupId(g.id);
  }, [onAddGroup, setSelectedGroupId]);

  // Anchored groups (with paragraphId) for prev/next cycling
  const anchoredGroups = useMemo(
    () => groups.filter((g) => g.paragraphIds.length > 0),
    [groups],
  );

  const inTextItems = useMemo(
    () => getParagraphAnchorPositions(editor, anchoredGroups),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, anchoredGroups],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    viewMode === "in-text",
    "data-quotation-group-id",
  );

  const onActivateGroup = useCallback(
    (g: QuotationGroup) => {
      setSelectedGroupId(g.id);
      if (g.paragraphIds.length > 0) onScrollToParagraph?.(g.paragraphIds[0]);
    },
    [onScrollToParagraph, setSelectedGroupId],
  );
  const { idx: cycleIdx, next: cycleNext, prev: cyclePrev, setIdx: setCycleIdx } =
    useCycle(anchoredGroups, onActivateGroup);

  // Sync external selection back to cycle index — including deselect
  useEffect(() => {
    if (!selectedGroupId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = anchoredGroups.findIndex((g) => g.id === selectedGroupId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedGroupId, anchoredGroups, cycleIdx, setCycleIdx]);

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader
        title="Quotations"
        onAdd={handleAdd}
        onAiRequest={onAddAiRequest}
      >
        <PrevNextCounter
          current={cycleIdx}
          total={anchoredGroups.length}
          label=""
        />
        <ItemMenu>
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="quote" label="Quotation color" />
            <ViewToggle mode={viewMode} onChange={onViewModeChange} />
          </div>
        </ItemMenu>
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : listRef}
        className={viewMode === "in-text" ? "flex-1 overflow-y-auto" : PANEL.list}
      >
        {groups.length === 0 && myAiRequests.length === 0 ? (
          <div className={PANEL.empty}>
            No quotations yet. Add a group to start collecting references.
          </div>
        ) : viewMode === "in-text" ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {anchoredGroups.map((group) => {
              const top = positions.get(group.id);
              if (top === undefined) return null;
              return (
                <div
                  key={group.id}
                  className={`absolute left-2 right-2 in-text-connector in-text-connector-${panelSide}`}
                  style={{ top }}
                >
                  <QuotationGroupCard
                    group={group}
                    bibEntries={bibEntries}
                    bibPackage={bibPackage}
                    selected={selectedGroupId === group.id}
                    onSelect={() => setSelectedGroupId(group.id)}
                    onDelete={() => onDeleteGroup(group.id)}
                    onJump={() => onScrollToParagraph?.(group.paragraphIds[0])}
                    onUpdateGroupTitle={onUpdateGroupTitle}
                    onAddReference={onAddReference}
                    onDeleteReference={onDeleteReference}
                    onUpdateReferenceCiteKey={onUpdateReferenceCiteKey}
                    onAddQuote={onAddQuote}
                    onUpdateQuote={onUpdateQuote}
                    onDeleteQuote={onDeleteQuote}
                    onUpdateNotes={onUpdateNotes}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {myAiRequests.length > 0 && (
              <>
                <AiRequestsSectionHeader count={myAiRequests.length} />
                {myAiRequests.map((req) => (
                  <AiRequestCard
                    key={req.id}
                    request={req}
                    onChangeText={(text) => onUpdateAiRequestText?.(req.id, text)}
                    onDelete={() => onDeleteAiRequest?.(req.id)}
                  />
                ))}
              </>
            )}

            {groups.map((group) => (
              <QuotationGroupCard
                key={group.id}
                group={group}
                bibEntries={bibEntries}
                bibPackage={bibPackage}
                selected={selectedGroupId === group.id}
                onSelect={() => setSelectedGroupId(group.id)}
                onDelete={() => onDeleteGroup(group.id)}
                onJump={group.paragraphIds.length > 0 ? () => onScrollToParagraph?.(group.paragraphIds[0]) : undefined}
                onUpdateGroupTitle={onUpdateGroupTitle}
                onAddReference={onAddReference}
                onDeleteReference={onDeleteReference}
                onUpdateReferenceCiteKey={onUpdateReferenceCiteKey}
                onAddQuote={onAddQuote}
                onUpdateQuote={onUpdateQuote}
                onDeleteQuote={onDeleteQuote}
                onUpdateNotes={onUpdateNotes}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
