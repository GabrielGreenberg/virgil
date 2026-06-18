"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { BibEntry } from "@/lib/types";
import { formatMinimalCitation } from "@/lib/bib-parser";
import { PanelCard, PANEL, Chevron, TargetIcon, Button, CardPopoutButton, CardDragHandle, cardTitleStyle } from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { MIME_CITATION } from "@/lib/marginalia";
import { attachClampedDragGhost } from "@/lib/drag-ghost";
import { popKey as buildPopKey } from "@/panels/panel-registry";
import { sanitizeAnnotationHtml } from "@/lib/sanitize-html";

export interface BibEntryCardProps {
  entry: BibEntry;
  isSelected: boolean;
  onClick: () => void;
  // BIB-F1-02 (audit-confirmed dead surface, removed): a `getFormattedBib`
  // prop implied a CSL-formatted reference preview inside the bib card, but
  // no such preview was ever built — the prop was destructured and never
  // read. (The genuine formatted-bib preview lives in the Citations card,
  // which keeps its own `getFormattedBib`.) Backlog: see MEMO_BUG_BACKLOG.md
  // if a CSL preview in the Bibliography card is later wanted.
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  /** Set-all field replacement (D3 — honors field deletion). The bib editor's
   *  Save routes here (the editor's `editBibFields` IS the complete intended
   *  field set, so clearing a field must remove it — BIB-A3-02). Optional for
   *  back-compat: when absent, Save falls back to the merge `onUpdateBibEntry`. */
  onReplaceBibEntry?: (key: string, fields: Record<string, string>, type?: string) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  occurrenceInfo?: { total: number; current: number; onCycle: (delta: number) => void };
  /** Bib package ("natbib" | "biblatex") — used to determine the default cite command for drag. */
  bibPackage?: string;
  /** Bib entries list — needed for formatMinimalCitation in drag ghost. */
  bibEntries?: BibEntry[];
  /** Whether this entry is cited in the document. */
  isCited?: boolean;
  /** Called when user clicks the target icon to jump to this entry in the text. Only shown when selected. */
  onJump?: (sourceEl: HTMLElement | null) => void;
  /** When provided, renders a popout chevron at the left edge of the header. */
  onTogglePopout?: (anchor: DOMRect) => void;
  /** Whether this card is currently rendered in a floating window. */
  isPoppedOut?: boolean;
  /** Small badge/chip rendered at the right side of the header — used by
   *  the Bibliography panel to surface library-status (in library /
   *  processing / no PDF) without this component needing to know about
   *  the Library feature. */
  libraryChip?: React.ReactNode;
  /** Optional Add-to-local affordance for global search results. When set,
   *  renders a small "Add" / "Added" pill in the card header. */
  addAction?: { onAdd: () => void; alreadyAdded: boolean };
  /** When false, disables HTML5 drag of this card (e.g. for Global preview
   *  cards that aren't yet in the local bib — dragging would yield a
   *  broken \cite). Defaults to true. */
  draggable?: boolean;
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
        className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-ink-body hover-on-light" data-hint="Bold">B</button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs italic text-ink-body hover-on-light" data-hint="Italic">I</button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-xs underline text-ink-body hover-on-light" data-hint="Underline">U</button>
      <div className="w-px h-4 bg-edge-subtle mx-0.5" />
      <button onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-ink-body hover-on-light" data-hint="Bullet list" aria-label="Bullet list">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="2" cy="4" r="1.5" /><rect x="5" y="3" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="8" r="1.5" /><rect x="5" y="7" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="12" r="1.5" /><rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
      <button onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}
        className="w-6 h-6 flex items-center justify-center rounded text-ink-body hover-on-light" data-hint="Numbered list" aria-label="Numbered list">
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
  const onKeyDown = useTabIndent<HTMLDivElement>();

  // SECURITY (BIB-F5-01): the annotation HTML is untrusted (AI-written via
  // answer-bib-review, or carried in a shared paper's annotations.json), so it
  // must be sanitized before it ever reaches the live contentEditable's
  // innerHTML — otherwise <img onerror>/<svg onload>/<iframe> payloads fire on
  // open (stored XSS). Sanitize on SEED (here, defensively cleaning anything
  // already on disk)…
  useEffect(() => {
    const clean = sanitizeAnnotationHtml(content || "");
    if (editorRef.current && editorRef.current.innerHTML !== clean) {
      editorRef.current.innerHTML = clean;
    }
  }, [bibKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // …and on WRITE, so a payload is never persisted back to annotations.json.
  const handleInput = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const html = sanitizeAnnotationHtml(editorRef.current?.innerHTML || "");
      onUpdate(bibKey, html);
    }, 400);
  }, [bibKey, onUpdate]);

  // Paste is the one live vector the seed/write paths don't cover (a pasted
  // <img onerror> renders into the editable immediately). Intercept rich-HTML
  // pastes, sanitize, and re-insert; plain-text pastes are already safe.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData("text/html");
    if (!html) return;
    e.preventDefault();
    document.execCommand("insertHTML", false, sanitizeAnnotationHtml(html));
    handleInput();
  }, [handleInput]);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {focused && <FormatToolbar editorRef={editorRef} />}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="annotation-editor px-3 py-2 text-sm text-ink-body leading-relaxed focus:outline-none min-h-[2.5rem]"
        data-placeholder="Write an annotation for this reference..."
      />
    </div>
  );
}

/* ── BibEntryCard ─────────────────────────────────────────────────── */
export default function BibEntryCard({
  entry, isSelected, onClick, getAnnotation, setAnnotation,
  onRequestReview, onCancelReview, getReviewStatus, onUpdateBibEntry, onReplaceBibEntry, onUpdateBibKeyAndType,
  occurrenceInfo, bibPackage, bibEntries, isCited = true, onJump,
  onTogglePopout, isPoppedOut, libraryChip, addAction, draggable = true,
}: BibEntryCardProps) {
  const popped = usePoppedCards();
  const popKey = buildPopKey("bibliography", entry.key);
  const theme = useCardTheme("bib");
  const bibBodyStyle = usePanelBodyStyle("bib");
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
    // The editor's `editBibFields` is the COMPLETE intended field set (seeded
    // from `entry.fields`, edited in place), so a Save is set-all — a field the
    // user cleared must be deleted, not silently retained (BIB-A3-02). Route to
    // `replaceBibEntry` (D3) when available; fall back to the merge path so a
    // caller that hasn't wired the new prop keeps working unchanged.
    if (onReplaceBibEntry) onReplaceBibEntry(entry.key, editBibFields, editBibType.trim() || undefined);
    else onUpdateBibEntry(entry.key, editBibFields);
    if (editBibKey.trim() && (editBibKey.trim() !== entry.key || editBibType.trim() !== entry.type)) {
      onUpdateBibKeyAndType(entry.key, editBibKey.trim(), editBibType.trim());
    }
    setEditingBib(false);
    setShowBibWarning(false);
  };
  const cancelEditBib = () => { setEditingBib(false); setShowBibWarning(false); };
  /** Drop a field from the in-progress edit map. Because Save routes through
   *  the set-all `replaceBibEntry` (D3), a field removed here is DELETED on
   *  Save — not silently retained as `field = {}` (BIB-F5-04, "I cleared the
   *  field but it came back"). Deletion is only honored by the set-all path;
   *  the merge `updateBibEntry` fallback can only patch, never remove. */
  const removeEditBibField = (field: string) => {
    setEditBibFields((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

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
    attachClampedDragGhost({
      dragStartEvent: e,
      buildGhost: () => {
        const ghost = document.createElement("div");
        ghost.textContent = display.length > 80 ? display.slice(0, 80) + "\u2026" : display;
        ghost.style.cssText = "max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        return ghost;
      },
      cursorOffsetX: 10,
      cursorOffsetY: 14,
    });
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
  const showTargetIcon = !!onJump;

  // Header: author · year · title (single line, truncates).
  const headerText = [author, year, title].filter(Boolean).join(" · ");

  const bodyContent = (
    <>
      {/* Remaining publication details (excludes author/year/title already shown in header) */}
      {(() => {
        // SECURITY (backlog #28): build the publication-details row as JSX
        // nodes, never an HTML string. A `.bib` field may carry markup/script
        // (fetched by find-citation from an external source, or a shared
        // paper's references.bib); routing it through `dangerouslySetInnerHTML`
        // would inject it live. Italic emphasis lives in known-safe <i>
        // wrappers; the raw field text is rendered as a JSX child (React
        // escapes it), so the sink is gone entirely.
        const parts: React.ReactNode[] = [];
        const f = entry.fields;
        if (f.journal) parts.push(<i>{f.journal}</i>);
        if (f.booktitle) parts.push(<>In <i>{f.booktitle}</i></>);
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
          // BODY CONTENT — the per-panel font picker applies here (the
          // header line above stays in the fixed TITLE dialect).
          <div
            data-panel-kind="bib"
            className="leading-relaxed break-words overflow-hidden"
            style={{ ...bibBodyStyle, overflowWrap: "anywhere" }}
          >
            {parts.map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 ? ". " : null}
                {part}
              </React.Fragment>
            ))}
            {"."}
          </div>
        );
      })()}

      {/* Cite key + copy */}
      <div className="mt-1.5 inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="text-xs font-mono text-ink-muted break-all">{entry.key}</span>
        <button
          onClick={handleCopyKey}
          className="p-0.5 text-ink-faint hover:text-ink-subtle transition-colors"
          data-hint="Copy cite key" aria-label="Copy cite key"
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
            data-hint={fieldsReviewStatus === "pending" ? "Click to cancel request" : "Request AI review of fields"} aria-label={fieldsReviewStatus === "pending" ? "Click to cancel request" : "Request AI review of fields"}
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
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeEditBibField(field); }}
                        className="iconbtn-sm text-ink-muted hover:text-red-600 flex-shrink-0"
                        data-hint={`Remove ${field}`} aria-label={`Remove field ${field}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
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
            data-hint={notesReviewStatus === "pending" ? "Click to cancel request" : "Request AI-generated annotation"} aria-label={notesReviewStatus === "pending" ? "Click to cancel request" : "Request AI-generated annotation"}
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

  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(popKey, anchor)
      : undefined);

  // Docked cards no longer render a pop-out button (drag the card header
  // out instead). The X close button on a popped float is rendered
  // manually below — see the cluster block — because BibEntryCard's
  // top-right slot is already occupied by the target/occurrence cluster
  // and we don't want PanelCard's auto-positioned X to fight it.
  const showCluster = (!!onToggleFromCtx && isPoppedOut) || showTargetIcon;
  const compressed = !isSelected && !isPoppedOut;

  const card = (
    <PanelCard
      data-bib-entry={entry.key}
      data-card-key={popKey}
      theme={theme}
      selected={isSelected}
      isPoppedOut={isPoppedOut}
      cardKey={popKey}
      isCollapsed={compressed}
      extraCardClass={`cursor-pointer${draggable ? " cursor-grab active:cursor-grabbing" : ""}${!isCited ? " opacity-60" : ""}`}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onClick={onClick}
    >
      {/* Header — pr-14 reserves space for the absolute top-right control
          stack (target + popout cluster, with optional occurrence counter
          stacked below). */}
      <div
        className="flex items-center gap-2 pl-3 pr-14 py-1.5"
        style={{ backgroundColor: isSelected ? theme.headerSelected : theme.headerDefault }}
      >
        <CardDragHandle />
        {/* TITLE dialect — design-system-fixed; the per-panel body-font
            picker (`bibBodyStyle`) applies to the publication-details body
            row, never to this header line. */}
        <div
          className="flex-1 min-w-0 leading-snug"
          style={{
            ...cardTitleStyle(theme),
            overflowWrap: "anywhere",
          }}
          data-hint={headerText} aria-label={headerText}
        >
          {author && <span className="font-semibold">{author}</span>}
          {author && year && <span className="text-ink-muted mx-1.5">&middot;</span>}
          {year && <span className="font-semibold">{year}</span>}
          {(author || year) && title && <span className="text-ink-muted mx-1.5">&middot;</span>}
          {title && <span className="italic">{title}</span>}
        </div>
        {addAction ? (
          <div
            className="shrink-0"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            {addAction.alreadyAdded ? (
              <span className="text-[10px] text-ink-muted py-0.5">Added</span>
            ) : (
              <button
                onClick={addAction.onAdd}
                className="text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-1.5 py-0.5 rounded"
              >
                Add
              </button>
            )}
          </div>
        ) : null}
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
      </div>

      {/* Top-right control stack: target + popout in a cluster, with the
          occurrence counter stacked below when there is more than one ref. */}
      {(showCluster || hasOccCounter) && (
        <div
          className="absolute top-1.5 right-1.5 z-10 flex flex-col items-start gap-1"
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          {showCluster && (
            <div className="flex items-center gap-1">
              {showTargetIcon && (
                <div className={`transition-opacity ${isSelected ? "opacity-100" : "opacity-60"}`}>
                  <TargetIcon
                    onClick={(e) => onJump?.((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
                    title="Jump to citation"
                  />
                </div>
              )}
              {/* X close button only on the popped-out float — docked
                  cards lift off via the header drag gesture instead. */}
              {onToggleFromCtx && isPoppedOut && (
                <CardPopoutButton isPoppedOut onClick={onToggleFromCtx} />
              )}
            </div>
          )}
          {hasOccCounter && (
            <div className="flex items-center gap-1 text-xs text-ink-muted">
              <div className="flex flex-col items-center leading-none w-6">
                <button onClick={() => occurrenceInfo!.onCycle(-1)} className="hover:text-ink-body flex items-center justify-center" data-hint="Previous occurrence" aria-label="Previous occurrence">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 15 12 9 18 15" />
                  </svg>
                </button>
                <button onClick={() => occurrenceInfo!.onCycle(1)} className="hover:text-ink-body flex items-center justify-center" data-hint="Next occurrence" aria-label="Next occurrence">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
              <span className="font-mono">{occurrenceInfo!.current + 1}/{occurrenceInfo!.total}</span>
            </div>
          )}
        </div>
      )}

      {!compressed && (
        <>
          {/* Separator */}
          <div
            className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
            style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
          />

          {/* Body — keeps the roomier `cardInner` (px-4 py-3) rather than the
              ratified `cardBody` (px-3): the multi-pod publication-details +
              BibTeX-fields + annotations layout reads better with the extra
              breathing room. Exempted in PANEL.cardBody's doc-comment
              (backlog #28). */}
          <div className={`${PANEL.cardInner}${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}>
            {bodyContent}
          </div>
        </>
      )}
    </PanelCard>
  );
  return card;
}
