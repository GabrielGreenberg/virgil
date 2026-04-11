"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
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
  PanelHeader,
  PrevNextCounter,
  TargetIcon,
  useCycle,
  AiRequestCard,
  AiRequestsSectionHeader,
} from "./panel-primitives";
import ConfirmDialog from "./ConfirmDialog";
import {
  formatMinimalCitation as fmtMinCite,
} from "@/lib/bib-parser";

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
        className="opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-stone-300 hover:text-red-400 hover:bg-red-50"
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
        <span className="text-[10px] text-stone-400 uppercase tracking-wider whitespace-nowrap">
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
          className="flex-1 text-xs font-mono bg-transparent border-b border-stone-200 focus:border-amber-400 outline-none py-0.5 text-stone-700"
        />
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-50 min-w-full max-h-48 overflow-y-auto">
          {results.map(({ entry }, i) => (
            <button
              key={entry.key}
              onMouseDown={(e) => { e.preventDefault(); selectEntry(entry.key); }}
              className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 text-xs ${
                i === highlightedIndex ? "bg-amber-50" : "hover:bg-stone-50"
              }`}
            >
              <span className="font-mono font-semibold text-stone-800 shrink-0">{entry.key}</span>
              <span className="text-stone-400 truncate">
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
      // Don't initiate a drag when the user is interacting with a form
      // control (textarea/input/button) inside the pod
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, button")) {
        e.preventDefault();
        return;
      }
      // Stop propagation so the enclosing group card's drag handler
      // (which drops a paragraph anchor) doesn't also fire
      e.stopPropagation();
      const command = buildQuoteCitationCommand(citeKey, page, bibPackage);
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData(
        "application/x-virgil-quote",
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

  return (
    <div
      className={`group/card ${PANEL.subpodWhite} p-3 cursor-grab active:cursor-grabbing`}
      draggable
      onDragStart={handleDragStart}
      title="Drag to insert quote with citation"
    >
      {/* Quote text */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <AutoTextarea
            value={text}
            onChange={handleTextChange}
            placeholder="Enter quoted text..."
            className="text-sm text-stone-700 leading-relaxed italic"
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
          <span className="text-[10px] text-stone-400">p.</span>
          <input
            type="text"
            value={page}
            onChange={handlePageChange}
            placeholder="--"
            className="w-14 text-xs font-mono bg-transparent outline-none text-stone-600 border-b border-transparent focus:border-stone-300"
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
                  ? "border-dashed border-red-300 text-red-400 bg-red-50/50"
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
            <p className="text-[11px] text-stone-500 leading-snug">
              {cleanTitle}
            </p>
          )}
          {!matchedEntry && !reference.citeKey && (
            <p className="text-xs text-stone-400 italic">No reference selected</p>
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
          <div className="text-xs font-mono text-stone-400 truncate flex-1 min-w-0">
            {reference.citeKey}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingCiteKey(true);
            }}
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-stone-200 text-stone-400 hover:text-stone-600 hover:bg-stone-100 hover:border-stone-300 transition-colors flex-shrink-0"
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
        className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 transition-colors"
      >
        <Chevron expanded={expanded} />
        <span>Notes</span>
        {!expanded && notes && (
          <span className="text-[10px] text-stone-400 truncate max-w-[140px]">
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
            className="w-full resize-none outline-none bg-transparent text-xs text-stone-600 leading-relaxed"
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
      // Don't initiate drag from inside form controls — let the user
      // interact with text fields normally
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, button")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "link";
      e.dataTransfer.setData(
        "application/x-virgil-quotation",
        JSON.stringify({ groupId: group.id })
      );
      // Plain-text fallback — first quote of first reference
      const firstQuote = group.references[0]?.quotes[0]?.text ?? "";
      e.dataTransfer.setData("text/plain", firstQuote);
    },
    [group.id, group.references]
  );

  return (
    <div
      className={`group/card ${panelCard(selected)}`}
      onClick={onSelect}
      draggable
      onDragStart={handleDragStart}
      data-quotation-group-id={group.id}
    >
      <div className={PANEL.cardInner}>
        {/* Group title — one big title for the whole group */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            onClick={(e) => e.stopPropagation()}
            placeholder="Group title..."
            className="flex-1 text-base font-semibold text-stone-800 bg-transparent outline-none placeholder:text-stone-300 placeholder:font-normal border-b border-transparent focus:border-stone-200 pb-0.5"
          />
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {selected && onJump && (
              <TargetIcon onClick={onJump} title="Jump to quotation in text" />
            )}
            <DeleteXButton
              onConfirm={onDelete}
              label="Delete this quotation group?"
            />
          </div>
        </div>

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
      </PanelHeader>

      <div className={PANEL.list} ref={listRef}>
        {groups.length === 0 && myAiRequests.length === 0 ? (
          <div className={PANEL.empty}>
            No quotations yet. Add a group to start collecting references.
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
