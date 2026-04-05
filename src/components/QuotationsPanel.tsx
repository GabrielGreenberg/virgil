"use client";

import { useState, useCallback, useRef, useEffect, useMemo, memo } from "react";
import type { QuotationGroup, Quotation, BibEntry } from "@/lib/types";
import { panelCard, PANEL, Chevron, PanelHeader } from "./panel-primitives";

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

/* ── Citation format helpers ─────────────────────────────────────── */

/** Minimal citation: Author (Year) */
function formatMinimalCitation(entry: BibEntry): string {
  const author = entry.fields.author;
  const year = entry.fields.year;
  if (!author && !year) return "";
  // Extract last name of first author
  const lastName = author
    ? author.split(",")[0].split(" and ")[0].trim().split(" ").pop() ?? author
    : "";
  if (lastName && year) return `${lastName} (${year})`;
  if (lastName) return lastName;
  return `(${year})`;
}

/** Medium citation: Author (Year). Title. */
function formatMediumCitation(entry: BibEntry): string {
  const minimal = formatMinimalCitation(entry);
  const title = entry.fields.title;
  if (!title) return minimal;
  // Clean braces from BibTeX title
  const cleanTitle = title.replace(/[{}]/g, "");
  return minimal ? `${minimal}. ${cleanTitle}.` : `${cleanTitle}.`;
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

  // Sync external value changes
  useEffect(() => { setInputValue(value); }, [value]);

  const results = useMemo(() => {
    if (inputValue.length < 1) {
      // Show all entries alphabetically when field is empty
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

  // Click-outside
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
            // Commit on blur if changed
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

/* ── Single Quotation Entry ──────────────────────────────────────── */

const QuotationEntry = memo(function QuotationEntry({
  quotation,
  groupId,
  canDelete,
  onUpdate,
  onDelete,
}: {
  quotation: Quotation;
  groupId: string;
  canDelete: boolean;
  onUpdate: (groupId: string, qId: string, fields: Partial<Pick<Quotation, "title" | "text" | "page">>) => void;
  onDelete: (groupId: string, qId: string) => void;
}) {
  const [title, setTitle] = useState(quotation.title);
  const [text, setText] = useState(quotation.text);
  const [page, setPage] = useState(quotation.page);

  const debouncedUpdate = useDebouncedCallback(onUpdate, 400);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setTitle(v);
      debouncedUpdate(groupId, quotation.id, { title: v });
    },
    [groupId, quotation.id, debouncedUpdate]
  );

  const handleTextChange = useCallback(
    (v: string) => {
      setText(v);
      debouncedUpdate(groupId, quotation.id, { text: v });
    },
    [groupId, quotation.id, debouncedUpdate]
  );

  const handlePageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setPage(v);
      debouncedUpdate(groupId, quotation.id, { page: v });
    },
    [groupId, quotation.id, debouncedUpdate]
  );

  // Sync from external changes
  useEffect(() => { setTitle(quotation.title); }, [quotation.title]);
  useEffect(() => { setText(quotation.text); }, [quotation.text]);
  useEffect(() => { setPage(quotation.page); }, [quotation.page]);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click-outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className={`${PANEL.subpodWhite} p-3`}>
      {/* Quotation title bar with three-dot menu */}
      <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-stone-100">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Title"
          className="flex-1 text-xs font-semibold text-stone-800 bg-transparent outline-none placeholder:text-stone-300 placeholder:font-normal"
        />
        <div ref={menuRef} className="relative ml-2 shrink-0">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="text-stone-500 hover:text-stone-700 transition-colors px-0.5 leading-none text-sm"
            title="Options"
          >
            &#x22EE;
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-50 min-w-[100px]">
              {canDelete && (
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onDelete(groupId, quotation.id);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quote text */}
      <AutoTextarea
        value={text}
        onChange={handleTextChange}
        placeholder="Enter quoted text..."
        className="text-sm text-stone-700 leading-relaxed italic"
        rows={1}
      />

      {/* Page number */}
      <div className="flex items-center mt-1.5 pt-1.5 border-t border-stone-100">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-stone-400">p.</span>
          <input
            type="text"
            value={page}
            onChange={handlePageChange}
            placeholder="—"
            className="w-14 text-xs font-mono bg-transparent outline-none text-stone-600 border-b border-transparent focus:border-stone-300"
          />
        </div>
      </div>
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
            — {notes.slice(0, 60)}
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

/* ── Quotation Group Card ────────────────────────────────────────── */

function QuotationGroupCard({
  group,
  bibEntries,
  selected,
  onSelect,
  onDelete,
  onUpdateGroupTitle,
  onAddQuotation,
  onUpdateQuotation,
  onDeleteQuotation,
  onUpdateCiteKey,
  onUpdateNotes,
}: {
  group: QuotationGroup;
  bibEntries: BibEntry[];
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onAddQuotation: (groupId: string) => string;
  onUpdateQuotation: (groupId: string, qId: string, fields: Partial<Pick<Quotation, "title" | "text" | "page">>) => void;
  onDeleteQuotation: (groupId: string, qId: string) => void;
  onUpdateCiteKey: (groupId: string, key: string) => void;
  onUpdateNotes: (groupId: string, notes: string) => void;
}) {
  const matchedEntry = bibEntries.find((e) => e.key === group.citeKey);

  const [groupTitle, setGroupTitle] = useState(group.title);
  const debouncedTitleUpdate = useDebouncedCallback(onUpdateGroupTitle, 400);

  useEffect(() => { setGroupTitle(group.title); }, [group.title]);

  const handleGroupTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setGroupTitle(v);
      debouncedTitleUpdate(group.id, v);
    },
    [group.id, debouncedTitleUpdate]
  );

  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const groupMenuRef = useRef<HTMLDivElement>(null);

  // Close group menu on click-outside
  useEffect(() => {
    if (!groupMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node)) {
        setGroupMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [groupMenuOpen]);

  const mediumCitation = useMemo(() => {
    if (!matchedEntry) return null;
    return formatMediumCitation(matchedEntry);
  }, [matchedEntry]);

  return (
    <div className={panelCard(selected)} onClick={onSelect}>
      <div className={PANEL.cardInner}>
        {/* Header: editable title + three-dot menu */}
        <div className="flex items-center justify-between mb-2">
          <input
            type="text"
            value={groupTitle}
            onChange={handleGroupTitleChange}
            onClick={(e) => e.stopPropagation()}
            placeholder="Title"
            className="flex-1 text-sm font-medium bg-transparent outline-none placeholder:text-stone-300"
            style={{ color: "#c45a5a" }}
          />
          <div ref={groupMenuRef} className="relative ml-2 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setGroupMenuOpen((o) => !o); }}
              className="text-stone-500 hover:text-stone-700 transition-colors px-0.5 leading-none text-sm"
              title="Options"
            >
              &#x22EE;
            </button>
            {groupMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-50 min-w-[100px]">
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete();
                    setGroupMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Medium citation display */}
        {matchedEntry && mediumCitation && (
          <p className="text-xs text-stone-500 leading-relaxed mb-2">{mediumCitation}</p>
        )}

        {/* Cite key autocomplete */}
        <div className="mb-3">
          <CiteKeyAutocomplete
            value={group.citeKey}
            bibEntries={bibEntries}
            onChange={(key) => onUpdateCiteKey(group.id, key)}
          />
        </div>

        {/* Quotation entries */}
        <div className="space-y-2">
          {group.quotations.map((q) => (
            <div key={q.id} className="group/entry">
              <QuotationEntry
                quotation={q}
                groupId={group.id}
                canDelete={group.quotations.length > 1}
                onUpdate={onUpdateQuotation}
                onDelete={onDeleteQuotation}
              />
            </div>
          ))}
        </div>

        {/* Add quotation button */}
        <button
          onClick={(e) => { e.stopPropagation(); onAddQuotation(group.id); }}
          className="mt-1.5 text-xs text-amber-600 hover:text-amber-700 transition-colors"
        >
          + Add quotation
        </button>

        {/* Collapsible notes */}
        <CollapsibleNotes
          notes={group.notes}
          onChange={(notes) => onUpdateNotes(group.id, notes)}
        />
      </div>
    </div>
  );
}

/* ── Main Panel ──────────────────────────────────────────────────── */

export interface QuotationsPanelProps {
  groups: QuotationGroup[];
  bibEntries: BibEntry[];
  citationStyle: string;
  onAddGroup: () => QuotationGroup;
  onDeleteGroup: (groupId: string) => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onAddQuotation: (groupId: string) => string;
  onUpdateQuotation: (groupId: string, qId: string, fields: Partial<Pick<Quotation, "title" | "text" | "page">>) => void;
  onDeleteQuotation: (groupId: string, qId: string) => void;
  onUpdateCiteKey: (groupId: string, key: string) => void;
  onUpdateNotes: (groupId: string, notes: string) => void;
}

export default function QuotationsPanel({
  groups,
  bibEntries,
  citationStyle,
  onAddGroup,
  onDeleteGroup,
  onUpdateGroupTitle,
  onAddQuotation,
  onUpdateQuotation,
  onDeleteQuotation,
  onUpdateCiteKey,
  onUpdateNotes,
}: QuotationsPanelProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const handleAdd = useCallback(() => {
    const g = onAddGroup();
    setSelectedGroupId(g.id);
  }, [onAddGroup]);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Quotations" count={groups.length} onAdd={handleAdd} />

      <div className={PANEL.list}>
        {groups.length === 0 ? (
          <div className={PANEL.empty}>
            No quotation groups yet. Click &ldquo;+ Add&rdquo; to start collecting quotes.
          </div>
        ) : (
          groups.map((group) => (
            <QuotationGroupCard
              key={group.id}
              group={group}
              bibEntries={bibEntries}
              selected={selectedGroupId === group.id}
              onSelect={() => setSelectedGroupId(group.id)}
              onDelete={() => onDeleteGroup(group.id)}
              onUpdateGroupTitle={onUpdateGroupTitle}
              onAddQuotation={onAddQuotation}
              onUpdateQuotation={onUpdateQuotation}
              onDeleteQuotation={onDeleteQuotation}
              onUpdateCiteKey={onUpdateCiteKey}
              onUpdateNotes={onUpdateNotes}
            />
          ))
        )}
      </div>
    </div>
  );
}
