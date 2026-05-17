"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  memo,
} from "react";
import type {
  QuotationGroup,
  Reference,
  Quote,
  BibEntry,
} from "@/lib/types";
import {
  PanelCard,
  PANEL,
  Chevron,
  CardBodyTitle,
  compressedBodyStyle,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import ConfirmDialog from "@/components/ConfirmDialog";
import { formatMediumCitationParts } from "@/lib/bib-parser";
import { MIME_QUOTE, MIME_QUOTATION } from "@/lib/marginalia";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";

function useDebouncedCallback<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): T {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback(
    (...args: any[]) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  ) as unknown as T;
}

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
        data-helper="Delete"
        data-helper-pos="above"
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
        onConfirm={() => {
          setAsking(false);
          onConfirm();
        }}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}

function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  rows = 2,
  style,
  dataPanelKind,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  style?: React.CSSProperties;
  dataPanelKind?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const onKeyDown = useTabIndent<HTMLTextAreaElement>();
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
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={rows}
      data-panel-kind={dataPanelKind}
      style={style}
      className={`w-full resize-none outline-none bg-transparent ${className ?? ""}`}
    />
  );
}

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

  useEffect(() => {
    setInputValue(value);
  }, [value]);

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
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
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
    [onChange],
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
    [results, highlightedIndex, isOpen, selectEntry, value],
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
              onMouseDown={(e) => {
                e.preventDefault();
                selectEntry(entry.key);
              }}
              className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 text-xs ${
                i === highlightedIndex ? "bg-amber-50" : "hover-on-light"
              }`}
            >
              <span className="font-mono font-semibold text-ink-strong shrink-0">
                {entry.key}
              </span>
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
  return postnote
    ? `\\${cmd}[${postnote}]{${key}}`
    : `\\${cmd}{${key}}`;
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
    fields: Partial<Pick<Quote, "text" | "page">>,
  ) => void;
  onDelete: (groupId: string, referenceId: string, quoteId: string) => void;
}) {
  const [text, setText] = useState(quote.text);
  const [page, setPage] = useState(quote.page);
  const debouncedUpdate = useDebouncedCallback(onUpdate, 400);
  const quoteBodyStyle = usePanelBodyStyle("quote");

  const handleTextChange = useCallback(
    (v: string) => {
      setText(v);
      debouncedUpdate(groupId, referenceId, quote.id, { text: v });
    },
    [groupId, referenceId, quote.id, debouncedUpdate],
  );

  const handlePageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setPage(v);
      debouncedUpdate(groupId, referenceId, quote.id, { page: v });
    },
    [groupId, referenceId, quote.id, debouncedUpdate],
  );

  useEffect(() => {
    setText(quote.text);
  }, [quote.text]);
  useEffect(() => {
    setPage(quote.page);
  }, [quote.page]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const command = buildQuoteCitationCommand(citeKey, page, bibPackage);
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData(
        MIME_QUOTE,
        JSON.stringify({ quoteText: text, command }),
      );
      const fallback = command ? `"${text}" ${command}` : `"${text}"`;
      e.dataTransfer.setData("text/plain", fallback);
    },
    [text, citeKey, page, bibPackage],
  );

  const podRef = useRef<HTMLDivElement>(null);
  const [askingDelete, setAskingDelete] = useState(false);

  return (
    <div
      ref={podRef}
      className={`group/card relative ${PANEL.subpodWhite} p-3`}
      title="Drag handle to insert quote with citation"
    >
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
          data-helper="Drag quote"
          data-helper-pos="above"
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
            className="text-sm text-ink-body leading-relaxed"
            rows={1}
            dataPanelKind="quote"
            style={quoteBodyStyle}
          />
        </div>
      </div>
      <div className="flex items-center mt-1.5 pt-1.5 border-t border-edge-subtle">
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
      {canDelete && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAskingDelete(true);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
            className="absolute bottom-1.5 right-1.5 opacity-0 group-hover/card:opacity-70 hover:!opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-ink-faint hover:text-danger hover:bg-danger-soft"
            title="Delete quote"
            aria-label="Delete quote"
            data-helper="Delete"
            data-helper-pos="above"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
          <ConfirmDialog
            open={askingDelete}
            message="Delete this quote?"
            confirmLabel="Delete"
            tone="danger"
            onConfirm={() => {
              setAskingDelete(false);
              onDelete(groupId, referenceId, quote.id);
            }}
            onCancel={() => setAskingDelete(false)}
          />
        </>
      )}
    </div>
  );
});

const ReferenceBlock = memo(function ReferenceBlock({
  reference,
  groupId,
  bibEntries,
  bibPackage,
  canDelete,
  notesSlot,
  onUpdateCiteKey,
  onDeleteReference,
  onUpdateQuote,
  onDeleteQuote,
}: {
  reference: Reference;
  groupId: string;
  bibEntries: BibEntry[];
  bibPackage: string;
  canDelete: boolean;
  notesSlot?: React.ReactNode;
  onUpdateCiteKey: (groupId: string, referenceId: string, key: string) => void;
  onDeleteReference: (groupId: string, referenceId: string) => void;
  onUpdateQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>,
  ) => void;
  onDeleteQuote: (groupId: string, referenceId: string, quoteId: string) => void;
}) {
  const matchedEntry = bibEntries.find((e) => e.key === reference.citeKey);
  const [editingCiteKey, setEditingCiteKey] = useState(false);

  const citParts = useMemo(() => {
    if (!matchedEntry) return null;
    const parts = formatMediumCitationParts(reference.citeKey, bibEntries);
    return { ...parts, title: parts.title.replace(/[{}]/g, "") };
  }, [matchedEntry, reference.citeKey, bibEntries]);

  const handleCiteKeyChange = useCallback(
    (key: string) => {
      onUpdateCiteKey(groupId, reference.id, key);
      setEditingCiteKey(false);
    },
    [onUpdateCiteKey, groupId, reference.id],
  );

  return (
    <div className="group/ref space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex-1 min-w-0 text-xs leading-snug">
              {citParts ? (
                <>
                  <span className="font-medium">{citParts.author}</span>
                  <span className="text-ink-subtle"> ({citParts.year})</span>
                  {citParts.title && (
                    <span className="text-ink-subtle">
                      {" — "}
                      <span className="italic">{citParts.title}</span>
                    </span>
                  )}
                </>
              ) : reference.citeKey ? (
                <span className="font-mono text-danger">{reference.citeKey}</span>
              ) : (
                <span className="text-ink-muted italic">No reference selected</span>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingCiteKey((v) => !v);
              }}
              className="shrink-0 opacity-0 group-hover/ref:opacity-100 focus:opacity-100 transition-opacity text-ink-muted hover:text-ink-body p-0.5 rounded"
              title="Edit cite key"
              data-helper="Edit key"
              data-helper-pos="above"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
          </div>
        </div>
        {canDelete && (
          <DeleteXButton
            onConfirm={() => onDeleteReference(groupId, reference.id)}
            label="Delete this reference and its quotes?"
          />
        )}
      </div>

      {editingCiteKey && (
        <CiteKeyAutocomplete
          value={reference.citeKey}
          bibEntries={bibEntries}
          onChange={handleCiteKeyChange}
        />
      )}

      {notesSlot}

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
    </div>
  );
});

function CollapsibleNotes({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => Boolean(notes));
  const [localNotes, setLocalNotes] = useState(notes);
  const debouncedSave = useDebouncedCallback(onChange, 400);
  const onKeyDown = useTabIndent<HTMLTextAreaElement>();

  useEffect(() => {
    setLocalNotes(notes);
  }, [notes]);

  const handleChange = useCallback(
    (v: string) => {
      setLocalNotes(v);
      debouncedSave(v);
    },
    [debouncedSave],
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
            onKeyDown={onKeyDown}
            placeholder="Add notes..."
            rows={3}
            className="w-full resize-none outline-none bg-transparent text-xs text-ink-body leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}

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
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: {
  group: QuotationGroup;
  bibEntries: BibEntry[];
  bibPackage: string;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onUpdateGroupTitle: (groupId: string, title: string) => void;
  onAddReference: (groupId: string) => string;
  onDeleteReference: (groupId: string, referenceId: string) => void;
  onUpdateReferenceCiteKey: (groupId: string, referenceId: string, key: string) => void;
  onAddQuote: (groupId: string, referenceId: string) => string;
  onUpdateQuote: (
    groupId: string,
    referenceId: string,
    quoteId: string,
    fields: Partial<Pick<Quote, "text" | "page">>,
  ) => void;
  onDeleteQuote: (groupId: string, referenceId: string, quoteId: string) => void;
  onUpdateNotes: (groupId: string, notes: string) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  /** Extra `data-*` attributes forwarded to the card root. Used by
   *  Omni to place `data-omni-entry` on the PanelCard itself so
   *  card-level styles (rounded corners, ambient shadow) apply. */
  extraDataAttrs?: Record<string, string>;
}) {
  const [title, setTitle] = useState(group.title);
  useEffect(() => {
    setTitle(group.title);
  }, [group.title]);
  const debouncedTitleUpdate = useDebouncedCallback(onUpdateGroupTitle, 400);
  void debouncedTitleUpdate;

  // TODO(grip-redesign): drop-into-document via the grip is disabled
  // during the unified header redesign. Re-introduce thoughtfully via a
  // separate body-level affordance, not the grip. Original helper:
  // const handleDragStart = useCallback(
  //   (e: React.DragEvent<HTMLDivElement>) => {
  //     e.dataTransfer.effectAllowed = "link";
  //     e.dataTransfer.setData(
  //       MIME_QUOTATION,
  //       JSON.stringify({ groupId: group.id }),
  //     );
  //   },
  //   [group.id],
  // );

  const cardRef = useRef<HTMLDivElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const theme = useCardTheme("quote");
  const popped = usePoppedCards();
  const cardKey = popKey("quotations", group.id);

  const tryDelete = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const el = document.activeElement;
        if (
          el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            (el as HTMLElement).isContentEditable)
        )
          return;
        e.preventDefault();
        tryDelete();
      }
    },
    [selected, tryDelete],
  );

  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const ac = useAnchoredCard({ kind: "quotation", id: group.id });
  const isSelected = ac.selected || selected;
  const compressed = !isSelected && !isPoppedOut;
  const compressedLines = useCompressedLines();
  const cardBodyStyle = usePanelBodyStyle("quote");
  const refCount = group.references.length;
  const quoteCount = group.references.reduce((s, r) => s + r.quotes.length, 0);
  const firstRef = group.references[0];
  const firstCit = firstRef
    ? formatMediumCitationParts(firstRef.citeKey, bibEntries)
    : null;

  const card = (
    <PanelCard
      ref={cardRef}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onTrashClick={tryDelete}
      className="focus:outline-none"
      onClick={(e) => {
        e.stopPropagation();
        cardStore.toggleSelection(ac.ref);
        if (cardStore.getState().selection === null) return;
        onSelect();
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
      }}
      data-quotation-group-id={group.id}
      data-pristine-card-id={group.id}
      data-card-key={cardKey}
      {...(extraDataAttrs || {})}
      tabIndex={isSelected ? 0 : -1}
      onFocusCapture={() => {
        if (!isSelected) onSelect();
      }}
      onKeyDown={handleKeyDown}
      kind="quotation"
      canJump={!!onJump}
      onJump={(e) => onJump?.((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
    >
      <ConfirmDialog
        open={confirmOpen}
        message="Delete this quotation group?"
        confirmLabel="Delete"
        tone="danger"
        anchorRef={cardRef}
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete();
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      {compressed ? (
        <div className="px-3 pt-1.5 pb-1.5 text-ink-subtle">
          <div style={{ ...cardBodyStyle, ...compressedBodyStyle(compressedLines) }}>
            {refCount === 0 ? (
              <span className="text-ink-faint italic">(empty)</span>
            ) : (
              <>
                <span className="text-ink-muted">{refCount} ref{refCount !== 1 ? "s" : ""} · {quoteCount} quote{quoteCount !== 1 ? "s" : ""}</span>
                {firstCit && firstCit.author && (
                  <span className="ml-2">
                    <span className="font-medium">{firstCit.author}</span>
                    {firstCit.year ? <span className="text-ink-muted"> ({firstCit.year})</span> : null}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
      <div
        className={`relative px-3 pt-1.5 pb-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : " overflow-y-auto"}`}
        style={
          isPoppedOut
            ? undefined
            : { maxHeight: "max(0px, calc(var(--dock-slot-frame-h, 80vh) - 160px))" }
        }
      >
        <CardBodyTitle
          value={title}
          onChange={(v) => {
            setTitle(v);
            onUpdateGroupTitle(group.id, v);
          }}
          placeholder="Group title..."
          theme={theme}
        />
        <div
          className="space-y-3 divide-y divide-stone-100 [&>*:not(:first-child)]:pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {group.references.map((r, idx) => (
            <ReferenceBlock
              key={r.id}
              reference={r}
              groupId={group.id}
              bibEntries={bibEntries}
              bibPackage={bibPackage}
              canDelete={group.references.length > 1}
              notesSlot={
                idx === 0 ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <CollapsibleNotes
                      notes={group.notes}
                      onChange={(notes) => onUpdateNotes(group.id, notes)}
                    />
                  </div>
                ) : undefined
              }
              onUpdateCiteKey={onUpdateReferenceCiteKey}
              onDeleteReference={onDeleteReference}
              onUpdateQuote={onUpdateQuote}
              onDeleteQuote={onDeleteQuote}
            />
          ))}
        </div>

        <div className="mt-2 flex items-center gap-2">
          {group.references.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const lastRef = group.references[group.references.length - 1];
                onAddQuote(group.id, lastRef.id);
              }}
              className="inline-flex items-center gap-1 text-amber-600 border border-transparent hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 active:bg-amber-100 transition-colors px-1.5 py-1 rounded"
              title="Add quote"
              aria-label="Add quote"
              data-helper="Add quote"
              data-helper-pos="above"
            >
              <span className="text-sm leading-none">+</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="3" />
                <path d="M8 9.5C8 11.5 9 13 10.5 13.5L9.5 15C8 14.5 6.5 12.8 6.5 10.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S10.5 11.2 9.2 11.2c-.4 0-.8-.1-1.2-.3v-1.4z" fill="currentColor" stroke="none" />
                <path d="M15 9.5C15 11.5 16 13 17.5 13.5L16.5 15C15 14.5 13.5 12.8 13.5 10.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" fill="currentColor" stroke="none" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddReference(group.id);
            }}
            className="inline-flex items-center gap-1 text-amber-600 border border-transparent hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 active:bg-amber-100 transition-colors px-1.5 py-1 rounded"
            title="Add reference"
            aria-label="Add reference"
            data-helper="Add reference"
            data-helper-pos="above"
          >
            <span className="text-sm leading-none">+</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <path d="M8 7h8" />
              <path d="M8 12h6" />
            </svg>
          </button>
        </div>
      </div>
      )}
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
