"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { BibEntry } from "@/lib/types";
import { formatMinimalCitation } from "@/lib/bib-parser";
import { PanelCard, PANEL, Chevron, TargetIcon, Button } from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "./FloatingCards";
import { MIME_CITATION } from "@/lib/marginalia";
import { popKey as buildPopKey } from "@/panels/panel-registry";

export interface BibEntryCardProps {
  entry: BibEntry;
  isSelected: boolean;
  onClick: () => void;
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  occurrenceInfo?: { total: number; current: number; onCycle: (delta: number) => void };
  /** When true, skip outer card wrapper (for embedding inside another card). */
  compact?: boolean;
  /** Bib package ("natbib" | "biblatex") — used to determine the default cite command for drag. */
  bibPackage?: string;
  /** Bib entries list — needed for formatMinimalCitation in drag ghost. */
  bibEntries?: BibEntry[];
  /** Whether this entry is cited in the document. */
  isCited?: boolean;
  /** Called when user clicks the target icon to jump to this entry in the text. Only shown when selected. */
  onJump?: () => void;
  /** When provided, renders a popout chevron at the left edge of the header. */
  onTogglePopout?: (anchor: DOMRect) => void;
  /** Whether this card is currently rendered in a floating window. */
  isPoppedOut?: boolean;
  /** Small badge/chip rendered at the right side of the header — used by
   *  the Bibliography panel to surface library-status (in library /
   *  processing / no PDF) without this component needing to know about
   *  the Library feature. */
  libraryChip?: React.ReactNode;
}

/* ── Pulsing dot for pending request ──────────────────────────────── */
function PulsingDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
    </span>
  );
}

/* ── Format toolbar ──────────────────────────────────────────────── */
function FormatToolbar({ editorRef }: { editorRef: React.RefObject<HTMLDivElement | null> }) {
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 border-b border-edge-subtle">
      <button onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-ink-body hover-on-light" title="Bold">B</button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs italic text-ink-body hover-on-light" title="Italic">I</button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs underline text-ink-body hover-on-light" title="Underline">U</button>
      <div className="w-px h-4 bg-edge-subtle mx-0.5" />
      <button onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-ink-body hover-on-light" title="Bullet list">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="2" cy="4" r="1.5" /><rect x="5" y="3" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="8" r="1.5" /><rect x="5" y="7" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="12" r="1.5" /><rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-ink-body hover-on-light" title="Numbered list">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <text x="0" y="5.5" fontSize="5" fontWeight="600">1</text><rect x="5" y="3" width="10" height="2" rx="0.5" />
          <text x="0" y="9.5" fontSize="5" fontWeight="600">2</text><rect x="5" y="7" width="10" height="2" rx="0.5" />
          <text x="0" y="13.5" fontSize="5" fontWeight="600">3</text><rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
    </div>
  );
}

/* ── Rich-text annotation editor ──────────────────────────────────── */
function AnnotationEditor({
  bibKey, content, onUpdate,
}: {
  bibKey: string; content: string; onUpdate: (key: string, html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== content) {
      editorRef.current.innerHTML = content || "";
    }
  }, [bibKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const html = editorRef.current?.innerHTML || "";
      onUpdate(bibKey, html);
    }, 400);
  }, [bibKey, onUpdate]);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {focused && <FormatToolbar editorRef={editorRef} />}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => e.stopPropagation()}
        className="annotation-editor px-3 py-2 text-sm text-ink-body leading-relaxed focus:outline-none min-h-[2.5rem]"
        data-placeholder="Write an annotation for this reference..."
      />
    </div>
  );
}

/* ── BibEntryCard ─────────────────────────────────────────────────── */
export default function BibEntryCard({
  entry, isSelected, onClick, getFormattedBib, getAnnotation, setAnnotation,
  onRequestReview, onCancelReview, getReviewStatus, onUpdateBibEntry, onUpdateBibKeyAndType,
  occurrenceInfo, compact, bibPackage, bibEntries, isCited = true, onJump,
  onTogglePopout, isPoppedOut, libraryChip,
}: BibEntryCardProps) {
  const popped = usePoppedCards();
  const popKey = buildPopKey("bibliography", entry.key);
  // Per-entry state
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [editingBib, setEditingBib] = useState(false);
  const [editBibFields, setEditBibFields] = useState<Record<string, string>>({});
  const [editBibType, setEditBibType] = useState("");
  const [editBibKey, setEditBibKey] = useState("");
  const [showBibWarning, setShowBibWarning] = useState(false);
  const [requestNoteDrafts, setRequestNoteDrafts] = useState<Record<string, string>>({});
  const [requestNoteOpen, setRequestNoteOpen] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const draftKey = (type: string) => `${entry.key}:${type}`;

  const author = entry.fields.author || "";
  const year = entry.fields.year || entry.fields.date || "";
  const title = entry.fields.title || "";
  const annotation = getAnnotation(entry.key);
  const fieldsReviewStatus = getReviewStatus(entry.key, "fields");
  const notesReviewStatus = getReviewStatus(entry.key, "notes");
  const fieldsDk = draftKey("fields");
  const notesDk = draftKey("notes");

  const startEditBib = () => {
    setEditingBib(true);
    setEditBibFields({ ...entry.fields });
    setEditBibType(entry.type);
    setEditBibKey(entry.key);
    setShowBibWarning(true);
  };
  const commitEditBib = () => {
    onUpdateBibEntry(entry.key, editBibFields);
    if (editBibKey.trim() && (editBibKey.trim() !== entry.key || editBibType.trim() !== entry.type)) {
      onUpdateBibKeyAndType(entry.key, editBibKey.trim(), editBibType.trim());
    }
    setEditingBib(false);
    setShowBibWarning(false);
  };
  const cancelEditBib = () => { setEditingBib(false); setShowBibWarning(false); };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(entry.key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const cmd = `\\cite{${entry.key}}`;
    const display = bibEntries ? formatMinimalCitation(entry.key, bibEntries) : entry.key;
    e.dataTransfer.setData("text/plain", cmd);
    e.dataTransfer.setData(MIME_CITATION, JSON.stringify({ command: cmd, bibKey: entry.key }));
    e.dataTransfer.effectAllowed = "copy";
    const ghost = document.createElement("div");
    ghost.textContent = display.length > 80 ? display.slice(0, 80) + "\u2026" : display;
    ghost.style.cssText = "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 14);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, [entry.key, bibPackage, bibEntries]);

  const handleRequestToggle = (type: "fields" | "notes") => {
    const status = getReviewStatus(entry.key, type);
    const dk = draftKey(type);
    if (status === "pending") {
      onCancelReview(entry.key, type);
      setRequestNoteOpen((prev) => { const n = new Set(prev); n.delete(dk); return n; });
      setRequestNoteDrafts((prev) => { const n = { ...prev }; delete n[dk]; return n; });
    } else {
      const notes = requestNoteDrafts[dk] || "";
      onRequestReview(entry.key, type, notes || undefined);
      if (type === "fields") setFieldsOpen(true);
      else setAnnotationOpen(true);
      setRequestNoteOpen((prev) => { const n = new Set(prev); n.add(dk); return n; });
    }
  };

  const hasOccCounter = occurrenceInfo && occurrenceInfo.total > 1;
  // Target icon is always rendered (when the entry is cited) so its
  // hover/selected opacity states can fade in/out without layout shift.
  const showTargetIcon = !!onJump && !compact;

  // Header: author · year · title (single line, truncates).
  const headerText = [author, year, title].filter(Boolean).join(" · ");

  const bodyContent = (
    <>
      {/* Remaining publication details (excludes author/year/title already shown in header) */}
      {(() => {
        const parts: string[] = [];
        const f = entry.fields;
        if (f.journal) parts.push(`<i>${f.journal}</i>`);
        if (f.booktitle) parts.push(`In <i>${f.booktitle}</i>`);
        if (f.editor) parts.push(`Ed. ${f.editor}`);
        if (f.volume) parts.push(f.number ? `${f.volume}(${f.number})` : `vol. ${f.volume}`);
        if (f.pages) parts.push(`pp. ${f.pages}`);
        if (f.publisher) parts.push(f.publisher);
        if (f.institution) parts.push(f.institution);
        if (f.school) parts.push(f.school);
        if (f.edition) parts.push(`${f.edition} ed.`);
        if (f.doi) parts.push(`doi: ${f.doi}`);
        if (f.url && !f.doi) parts.push(f.url);
        if (parts.length === 0) return null;
        return (
          <div
            className="text-xs text-ink-subtle leading-relaxed break-words overflow-hidden"
            style={{ overflowWrap: "anywhere" }}
            dangerouslySetInnerHTML={{ __html: parts.join(". ") + "." }}
          />
        );
      })()}

      {/* Cite key + copy */}
      <div className="mt-1.5 inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="text-xs font-mono text-ink-muted break-all">{entry.key}</span>
        <button
          onClick={handleCopyKey}
          className="p-0.5 text-ink-faint hover:text-ink-subtle transition-colors"
          title="Copy cite key"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="13" height="13" rx="2" />
              <path d="M19 9h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-1" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Pod: BibTeX Fields ──────────────────────────── */}
      <div className="mt-3">
        <div className="flex items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); setFieldsOpen((p) => !p); }}
            className="flex items-center gap-1.5 text-xs text-ink-subtle hover:text-ink-body transition-colors">
            <Chevron expanded={fieldsOpen} />
            <span>BibTeX Fields</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleRequestToggle("fields"); }}
            className={`ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              fieldsReviewStatus === "pending"
                ? "text-amber-600 bg-amber-50 hover:bg-amber-100"
                : "text-ink-muted hover:text-ink-body hover-on-light"
            }`}
            title={fieldsReviewStatus === "pending" ? "Click to cancel request" : "Request AI review of fields"}
          >
            {fieldsReviewStatus === "pending" ? (<><PulsingDot /><span>Requested</span></>) : (<><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><g transform="rotate(15 12 12)"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/></g></svg><span>Request review</span></>)}
          </button>
        </div>

        {fieldsOpen && (
          <div className="mt-1.5 space-y-1.5">
            {requestNoteOpen.has(fieldsDk) && fieldsReviewStatus === "pending" && (
              <div className="rounded-md border border-amber-200 bg-amber-50/50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <input type="text" value={requestNoteDrafts[fieldsDk] || ""}
                  onChange={(e) => setRequestNoteDrafts((prev) => ({ ...prev, [fieldsDk]: e.target.value }))}
                  placeholder="Request annotation..."
                  className="w-full text-xs px-3 py-2 bg-transparent text-ink-body placeholder:text-ink-muted focus:outline-none" />
              </div>
            )}
            <div className={PANEL.subpod}>
              {editingBib ? (
                <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                  {showBibWarning && (
                    <div className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1 text-xs">
                      Warning: editing will modify the .bib file.
                    </div>
                  )}
                  {/* Editable @type and key */}
                  <div className="flex gap-1 items-start">
                    <span className="font-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">@type:</span>
                    <input type="text" value={editBibType}
                      onChange={(e) => setEditBibType(e.target.value)}
                      className="flex-1 font-mono border border-edge-subtle rounded px-1 py-0.5 text-xs" />
                  </div>
                  <div className="flex gap-1 items-start">
                    <span className="font-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">key:</span>
                    <input type="text" value={editBibKey}
                      onChange={(e) => setEditBibKey(e.target.value)}
                      className="flex-1 font-mono border border-edge-subtle rounded px-1 py-0.5 text-xs" />
                  </div>
                  {Object.entries(editBibFields).map(([field, val]) => (
                    <div key={field} className="flex gap-1 items-start">
                      <span className="font-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">{field}:</span>
                      <input type="text" value={val}
                        onChange={(e) => setEditBibFields((prev) => ({ ...prev, [field]: e.target.value }))}
                        className="flex-1 font-mono border border-edge-subtle rounded px-1 py-0.5 text-xs" />
                    </div>
                  ))}
                  <div className="flex gap-1 mt-1">
                    <Button variant="primary" size="sm" onClick={commitEditBib}>Save</Button>
                    <Button variant="secondary" size="sm" onClick={cancelEditBib}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5 text-xs text-ink-subtle min-w-0">
                  {/* @type{key} shown as first line */}
                  <div className="break-words font-mono text-ink-muted mb-0.5">
                    @{entry.type}{"{" + entry.key + "}"}
                  </div>
                  {Object.entries(entry.fields).map(([field, val]) => (
                    <div key={field} className="break-words" style={{ overflowWrap: "anywhere" }}>
                      <span className="font-mono text-ink-muted">{field}:</span>{" "}
                      <span className="text-ink-body">{val}</span>
                    </div>
                  ))}
                  <button onClick={(e) => { e.stopPropagation(); startEditBib(); }}
                    className="text-xs text-ink-muted hover:text-ink-body underline mt-1">Edit entry</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Pod: Annotations ──────────────────────────── */}
      <div className="mt-2">
        <div className="flex items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); setAnnotationOpen((p) => !p); }}
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              annotation ? "text-amber-600 hover:text-amber-700" : "text-ink-subtle hover:text-ink-body"
            }`}>
            <Chevron expanded={annotationOpen} />
            <span>Annotations</span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleRequestToggle("notes"); }}
            className={`ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              notesReviewStatus === "pending"
                ? "text-amber-600 bg-amber-50 hover:bg-amber-100"
                : "text-ink-muted hover:text-ink-body hover-on-light"
            }`}
            title={notesReviewStatus === "pending" ? "Click to cancel request" : "Request AI-generated annotation"}
          >
            {notesReviewStatus === "pending" ? (<><PulsingDot /><span>Requested</span></>) : (<><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><g transform="rotate(15 12 12)"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/></g></svg><span>Request annotation</span></>)}
          </button>
        </div>

        {annotationOpen && (
          <div className="mt-1.5 space-y-1.5">
            {requestNoteOpen.has(notesDk) && notesReviewStatus === "pending" && (
              <div className="rounded-md border border-amber-200 bg-amber-50/50 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <input type="text" value={requestNoteDrafts[notesDk] || ""}
                  onChange={(e) => setRequestNoteDrafts((prev) => ({ ...prev, [notesDk]: e.target.value }))}
                  placeholder="Request annotation..."
                  className="w-full text-xs px-3 py-2 bg-transparent text-ink-body placeholder:text-ink-muted focus:outline-none" />
              </div>
            )}
            <div className={PANEL.subpodWhite}>
              <AnnotationEditor bibKey={entry.key} content={annotation} onUpdate={setAnnotation} />
            </div>
          </div>
        )}
      </div>
    </>
  );

  if (compact) {
    // Embedded use (inside a CitationCard expansion) — no outer wrapper, no header.
    // Show the author/year/title inline at the top of the body.
    return (
      <div className="relative">
        {headerText && (
          <div className="text-sm text-ink-strong font-semibold mb-1.5 leading-snug">
            {headerText}
          </div>
        )}
        {bodyContent}
      </div>
    );
  }

  const theme = useCardTheme("bib");
  const bibBodyStyle = usePanelBodyStyle("bib");
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(popKey, anchor)
      : undefined);

  const card = (
    <PanelCard
      data-bib-entry={entry.key}
      data-card-key={popKey}
      theme={theme}
      selected={isSelected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      extraCardClass={`cursor-pointer cursor-grab active:cursor-grabbing${!isCited ? " opacity-60" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
    >
      {/* Header — pr-7 reserves space for the absolute top-right popout overlay */}
      <div
        className="flex items-start gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: isSelected ? theme.headerSelected : theme.headerDefault }}
      >
        <div
          data-panel-kind="bib"
          className="flex-1 min-w-0 leading-snug"
          style={{
            fontSize: "var(--par-title-size, 0.78rem)",
            color: theme.titleColor,
            fontWeight: 500,
            fontFamily: "var(--font-sans), Inter, sans-serif",
            letterSpacing: "0.02em",
            overflowWrap: "anywhere",
            ...bibBodyStyle,
          }}
          title={headerText}
        >
          {author && <span className="font-semibold">{author}</span>}
          {author && year && <span className="text-ink-muted mx-1.5">&middot;</span>}
          {year && <span className="font-semibold">{year}</span>}
          {(author || year) && title && <span className="text-ink-muted mx-1.5">&middot;</span>}
          {title && <span className="italic">{title}</span>}
        </div>
        {libraryChip ? (
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            {libraryChip}
          </div>
        ) : null}
        {hasOccCounter && (
          <div
            className="flex items-center gap-0.5 text-xs text-ink-muted shrink-0"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            <button onClick={() => occurrenceInfo!.onCycle(-1)} className="hover:text-ink-body px-0.5" title="Previous occurrence">&#x25B2;</button>
            <span className="font-mono">{occurrenceInfo!.current + 1}/{occurrenceInfo!.total}</span>
            <button onClick={() => occurrenceInfo!.onCycle(1)} className="hover:text-ink-body px-0.5" title="Next occurrence">&#x25BC;</button>
          </div>
        )}
        {showTargetIcon && (
          <div
            className={`shrink-0 transition-opacity ${isSelected ? "opacity-100" : "opacity-60"}`}
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            <TargetIcon onClick={() => onJump?.()} title="Jump to citation" />
          </div>
        )}
      </div>

      {/* Separator */}
      <div
        className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
      />

      {/* Body */}
      <div className={`${PANEL.cardInner}${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}>
        {bodyContent}
      </div>
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={popKey}>{card}</FloatCard>;
  return card;
}
