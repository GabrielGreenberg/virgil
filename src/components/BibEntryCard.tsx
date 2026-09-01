"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { BibEntry } from "@/lib/types";
import { bibFieldDisplay, formatMinimalCitation } from "@/lib/bib-parser";
import { PanelCard, PANEL, Chevron, Button, CardJumpTarget, cardTitleStyle } from "./panel-primitives";
import { Input } from "./field-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { MIME_CITATION, MIME_BIB_MERGE } from "@/lib/marginalia";
import { attachClampedDragGhost, buildTextDragGhost } from "@/lib/drag-ghost";
import { popKey as buildPopKey } from "@/panels/panel-registry";
import { AMBER_ATTENTION_STRIP } from "@/panels/_shared/amber-attention";
import { sanitizeAnnotationHtml } from "@/lib/sanitize-html";
import { iconHint } from "@/components/Hint";

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
  /** Meta block stacked BELOW the title line (layers 2 + 3 of the card:
   *  library membership chips, then the verification / processing-tier
   *  status row). Supplied by the Bibliography panel so this component stays
   *  agnostic of the Library feature — it just renders the node in a column
   *  under the title. Replaces the old single-row `libraryChip`, which
   *  competed with the title for horizontal space and collapsed at narrow
   *  widths. */
  headerMeta?: React.ReactNode;
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
        className="w-6 h-6 flex items-center justify-center rounded text-ink-body hover-on-light focus-ring" {...iconHint({ label: "Bullet list" })}>
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
//
// C4 (BIB-F8-01 DATA-LOSS / BIB-F8-02 HIGH): one controlled, flushed annotation
// field with a SINGLE owner. The owner of the value is the `useAnnotations`
// sidecar store (keyed by BibEntry.uid) — the docked card and the popped float
// both read/write it through the SAME `getAnnotation`/`setAnnotation` pair, so
// there is exactly one source of truth. This component's job is to keep its
// uncontrolled contentEditable faithful to that single source:
//
//   • FLUSH on blur AND unmount (BIB-F8-01). The debounce no longer survives an
//     unmount as an orphaned timer that fires against a null ref and writes ''.
//     Instead, on blur/unmount we synchronously commit the live DOM (while the
//     ref is still mounted) and cancel the pending timer. A fast collapse/close/
//     doc-switch within the debounce window therefore persists the edit instead
//     of wiping it.
//
//   • RE-SEED from the controlled `content` when an EXTERNAL writer changes it
//     (BIB-F8-02). The seed effect now depends on `content`, so when the float
//     saves, the docked instance re-renders with the fresh value and re-syncs
//     its DOM — the two surfaces converge. We never re-seed while THIS field is
//     focused (that would stomp the user's live caret), and we skip the echo of
//     our own just-committed value (lastCommittedRef), so a save never clobbers
//     in-progress typing or fights itself.
//
// The single write seam is `commit()`. SECURITY (BIB-F5-01) sanitization is
// applied there (and on seed/paste) by a SEPARATE chip; this slice leaves that
// one seam intact and adds no second writer.
function AnnotationEditor({
  bibKey, content, onUpdate,
}: {
  bibKey: string; content: string; onUpdate: (key: string, html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The HTML captured at the moment the debounce was last (re)scheduled. The
  // unmount-flush reads THIS, not the live ref: React detaches the contentEditable
  // ref during the commit phase, so by the time a passive-effect cleanup runs on
  // unmount `editorRef.current` is already null. Capturing the value on input
  // keeps the last-typed content recoverable across the unmount (BIB-F8-01).
  const pendingHtmlRef = useRef<string | null>(null);
  const [focused, setFocused] = useState(false);
  const onKeyDown = useTabIndent<HTMLDivElement>();

  // Latest props captured in refs so the unmount-flush cleanup (which must run
  // with empty deps to fire only on unmount, not on every prop change) reads
  // current values without re-subscribing. Synced in an effect, not during
  // render (react-hooks/refs); commit() — the only reader — runs from event
  // handlers / effects after commit, so the post-render sync is in time.
  const onUpdateRef = useRef(onUpdate);
  const bibKeyRef = useRef(bibKey);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
    bibKeyRef.current = bibKey;
  }, [onUpdate, bibKey]);

  // The bibKey the DOM was last seeded for. A change means the entry switched
  // (a new entry is never the "edit in progress"), so we always re-seed even
  // from a focused field.
  const seededKeyRef = useRef<string | null>(null);

  // The single write seam. SECURITY (BIB-F5-01) sanitization is applied here by
  // a separate chip — this is the one place an annotation HTML string is
  // persisted, so the sanitizer slots in cleanly without a second writer.
  //
  // Reads the live DOM when mounted; falls back to the captured pending value
  // when the ref has already been detached (unmount-flush path). Clears the
  // pending capture once committed so a later flush can't double-write a stale
  // value.
  const commit = useCallback(() => {
    const raw = editorRef.current?.innerHTML ?? pendingHtmlRef.current;
    if (raw == null) return; // nothing live and nothing captured
    pendingHtmlRef.current = null;
    onUpdateRef.current(bibKeyRef.current, sanitizeAnnotationHtml(raw));
  }, []);

  // SECURITY (BIB-F5-01): seed the contentEditable from the untrusted stored
  // HTML through the sanitizer, so an <img onerror>/<svg onload>/<iframe>
  // payload never reaches the live innerHTML.
  //
  // BIB-F8-02: this effect now depends on `content`, so an EXTERNAL write (the
  // other surface saving the same entry) re-seeds this DOM and the two surfaces
  // converge. The seed is gated on focus to protect the user's live caret:
  //   - ENTRY switch (bibKey changed): always re-seed — a different entry is
  //     never the edit-in-progress, even if the field happens to be focused.
  //   - same entry, content delta while NOT focused: re-seed — this is the
  //     other surface's write landing; we own no live caret, so converge now.
  //   - same entry, content delta while focused: DON'T touch the DOM — the user
  //     owns the field; re-seeding would stomp their caret. Convergence for the
  //     other surface happens on this field's next blur/commit (the user's edit
  //     is authoritative while they type). The blur flush guarantees the store
  //     ends up consistent, so the surfaces still converge — just on blur, not
  //     mid-keystroke.
  useEffect(() => {
    const entrySwitched = seededKeyRef.current !== bibKey;
    if (focused && !entrySwitched) return; // protect the live caret
    const clean = sanitizeAnnotationHtml(content || "");
    const el = editorRef.current;
    if (el && el.innerHTML !== clean) el.innerHTML = clean;
    seededKeyRef.current = bibKey;
  }, [bibKey, content, focused]);

  // …and on WRITE, so a payload is never persisted back to annotations.json.
  // Debounced commit — keystroke-sane (no doc-size work; a single timer reset).
  // Capture the live HTML on every input so the unmount-flush has a value even
  // after the ref detaches (BIB-F8-01).
  const handleInput = useCallback(() => {
    pendingHtmlRef.current = editorRef.current?.innerHTML ?? "";
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(commit, 400);
  }, [commit]);

  // BIB-F8-01: flush on blur. Collapsing/closing the card deselects it (blur
  // fires before the unmount), so the in-flight edit is committed synchronously
  // — a fast collapse can no longer drop it.
  const handleBlur = useCallback(() => {
    setFocused(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    commit();
  }, [commit]);

  // BIB-F8-01: flush on UNMOUNT. The card body unmounts when it collapses /
  // closes / the doc switches. We cancel the pending timer and, if an edit was
  // in flight (pendingHtmlRef set), commit the captured value — the ref is
  // already detached by now, so commit() reads the capture, not the DOM. The
  // edit is never lost and no orphan timer fires against a null ref. Empty deps
  // (commit is stable) → runs only on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
      }
      if (pendingHtmlRef.current != null) commit();
    };
  }, [commit]);

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
        onBlur={handleBlur}
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
  onTogglePopout, isPoppedOut, headerMeta, addAction, draggable = true,
}: BibEntryCardProps) {
  const popped = usePoppedCards();
  const popKey = buildPopKey("bibliography", entry.key);
  const theme = useCardKindTheme("bib");
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

  // DISPLAY — projected through the bib-row door (task 409), so `L{\'o}pez`
  // and `\&` read as characters here exactly as they do in body text. The
  // RAW field bytes are still what the fields pod below shows and what the
  // editor seeds from; nothing projected is ever written back.
  const author = bibFieldDisplay(entry, "author") || "";
  const year = bibFieldDisplay(entry, "year") || bibFieldDisplay(entry, "date") || "";
  const title = bibFieldDisplay(entry, "title") || "";
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
    // Also advertise the card-merge discriminator so a CitationCard's drop ring
    // lights ONLY for a bib-entry drag (which merges), never for another
    // citation card's atom-move drag (MIME_CITATION alone). `dragover` can read
    // `types` but not `getData`, so the distinct type is the only signal the
    // ring can predict the drop from. See MIME_BIB_MERGE in marginalia.ts.
    e.dataTransfer.setData(MIME_BIB_MERGE, JSON.stringify({ bibKey: entry.key }));
    // "copyMove", not "copy": the editor drop surface shows a "move" affordance
    // (Editor.tsx dragover); the card/panel merge targets still take "copy".
    e.dataTransfer.effectAllowed = "copyMove";
    attachClampedDragGhost({
      dragStartEvent: e,
      buildGhost: () =>
        // Citation cream via tokens \u2014 one home with CitationCard's ghost.
        buildTextDragGhost(display, {
          maxChars: 80,
          bg: "var(--citation-ghost-bg, #fdf8e1)",
          border: "var(--citation-border-color, #e0d5a8)",
          ink: "var(--citation-color, #6b6245)",
        }),
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
  // The jump-to-citation chevron is always rendered (when the entry is cited)
  // so its hover/selected opacity states can fade in/out without layout shift.
  const showJumpTarget = !!onJump;

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
        // DISPLAY — every field read through the bib-row door (task 409).
        const f = (name: string) => bibFieldDisplay(entry, name) || "";
        const journal = f("journal"), booktitle = f("booktitle"), editor = f("editor");
        const volume = f("volume"), number = f("number"), pages = f("pages");
        const publisher = f("publisher"), institution = f("institution");
        const school = f("school"), edition = f("edition");
        const doi = f("doi"), url = f("url");
        if (journal) parts.push(<i>{journal}</i>);
        if (booktitle) parts.push(<>In <i>{booktitle}</i></>);
        if (editor) parts.push(`Ed. ${editor}`);
        if (volume) parts.push(number ? `${volume}(${number})` : `vol. ${volume}`);
        if (pages) parts.push(`pp. ${pages}`);
        if (publisher) parts.push(publisher);
        if (institution) parts.push(institution);
        if (school) parts.push(school);
        if (edition) parts.push(`${edition} ed.`);
        if (doi) parts.push(`doi: ${doi}`);
        if (url && !doi) parts.push(url);
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
          className="p-0.5 text-ink-faint hover:text-ink-subtle transition-colors focus-ring"
          {...iconHint({ label: "Copy cite key" })}
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
              <div className={`${AMBER_ATTENTION_STRIP} rounded-md border overflow-hidden`} onClick={(e) => e.stopPropagation()}>
                <input type="text" value={requestNoteDrafts[fieldsDk] || ""}
                  onChange={(e) => setRequestNoteDrafts((prev) => ({ ...prev, [fieldsDk]: e.target.value }))}
                  placeholder="Request annotation..."
                  className="w-full text-xs bg-transparent text-ink-body placeholder:text-ink-muted focus:outline-none" />
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
                    <Input value={editBibType} density="dense"
                      onChange={(e) => setEditBibType(e.target.value)}
                      className="flex-1 font-mono px-1 py-0.5 text-xs" />
                  </div>
                  <div className="flex gap-1 items-start">
                    <span className="font-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">key:</span>
                    <Input value={editBibKey} density="dense"
                      onChange={(e) => setEditBibKey(e.target.value)}
                      className="flex-1 font-mono px-1 py-0.5 text-xs" />
                  </div>
                  {Object.entries(editBibFields).map(([field, val]) => (
                    <div key={field} className="flex gap-1 items-start">
                      <span className="font-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">{field}:</span>
                      <Input value={val} density="dense"
                        onChange={(e) => setEditBibFields((prev) => ({ ...prev, [field]: e.target.value }))}
                        className="flex-1 font-mono px-1 py-0.5 text-xs" />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeEditBibField(field); }}
                        /* The X is muted until you reach for it, so the ink is the
                           `-hover` variant: `.iconbtn-*` writes `color` at rest AND
                           hover from an UNLAYERED rule, so the `hover:text-danger`
                           that used to sit here painted nothing (task 509). The
                           dropped `text-ink-muted` / `flex-shrink-0` were the base
                           values restated. */
                        className="iconbtn-sm iconbtn-danger-hover"
                        {...iconHint({ label: `Remove field ${field}`, hint: `Remove ${field}` })}
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
                  {/* RAW-SOURCE VIEW — deliberately unprojected (task 409,
                      decision 2). This pod is the `.bib` entry's own source,
                      shown field-by-field beside the "Edit entry" button that
                      seeds from exactly these bytes; a projected header above a
                      raw source pod in one card is the same relationship the
                      editor has to the code pane. Projecting here is the one
                      change that would round-trip a rendering into the file. */}
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
              <div className={`${AMBER_ATTENTION_STRIP} rounded-md border overflow-hidden`} onClick={(e) => e.stopPropagation()}>
                <input type="text" value={requestNoteDrafts[notesDk] || ""}
                  onChange={(e) => setRequestNoteDrafts((prev) => ({ ...prev, [notesDk]: e.target.value }))}
                  placeholder="Request annotation..."
                  className="w-full text-xs bg-transparent text-ink-body placeholder:text-ink-muted focus:outline-none" />
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

  const compressed = !isSelected && !isPoppedOut;

  // TITLE dialect — design-system-fixed; the per-panel body-font picker
  // (`bibBodyStyle`) applies to the publication-details body row, never to
  // this title line. Rendered inside the body now (not a bespoke header) so
  // the card reads through the unified card-standard header like every other
  // kind (task 055 — retiring the last hand-rolled panel-card header).
  const titleLine = (
    <div
      className="min-w-0 leading-snug"
      style={{ ...cardTitleStyle(theme), overflowWrap: "anywhere" }}
      data-hint={headerText} aria-label={headerText}
    >
      {author && <span className="font-semibold">{author}</span>}
      {author && year && <span className="text-ink-muted mx-1.5">&middot;</span>}
      {year && <span className="font-semibold">{year}</span>}
      {(author || year) && title && <span className="text-ink-muted mx-1.5">&middot;</span>}
      {title && <span className="italic">{title}</span>}
    </div>
  );

  // Trailing header chrome — the standard narrow slot between the kind label
  // and the jump/X chrome (PanelCard `headerTrailing`). Retires the bespoke
  // absolute top-right cluster. Each control stops propagation so it never
  // trips the header's click-to-select activation; buttons are auto-excluded
  // from the header drag-lift (`INTERACTIVE_CONTROL_SELECTOR`).
  const headerTrailing = (
    <>
      {addAction ? (
        <span
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          {addAction.alreadyAdded ? (
            <span className="text-[10px] text-ink-muted">Added</span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); addAction.onAdd(); }}
              className="text-[10px] text-positive-ink hover:text-positive-strong hover:bg-positive-soft px-1.5 py-0.5 rounded"
            >
              Add
            </button>
          )}
        </span>
      ) : null}
      {hasOccCounter && (
        <span
          className="inline-flex items-center gap-0.5 text-[10px] text-ink-muted"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => { e.stopPropagation(); occurrenceInfo!.onCycle(-1); }}
            className="hover:text-ink-body flex items-center focus-ring"
            {...iconHint({ label: "Previous occurrence" })}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="card-mono tabular-nums">{occurrenceInfo!.current + 1}/{occurrenceInfo!.total}</span>
          <button
            onClick={(e) => { e.stopPropagation(); occurrenceInfo!.onCycle(1); }}
            className="hover:text-ink-body flex items-center focus-ring"
            {...iconHint({ label: "Next occurrence" })}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </span>
      )}
      {showJumpTarget && (
        <CardJumpTarget
          selected={isSelected}
          onClick={(e) => onJump?.((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
          title="Jump to citation"
        />
      )}
    </>
  );

  const card = (
    <PanelCard
      data-bib-entry={entry.key}
      data-card-key={popKey}
      theme={theme}
      selected={isSelected}
      isPoppedOut={isPoppedOut}
      cardKey={popKey}
      // Unified card-standard header: [drag] BIBLIOGRAPHY ITEM [trailing] [X].
      // `bib` resolves to "Bibliography" in the registry, so override the label
      // to the "Bibliography item" the card reads as (uppercased by the
      // overline). Bib is `droppable:false`, so no drop button renders.
      kind="bib"
      kindLabelOverride="Bibliography item"
      headerTrailing={headerTrailing}
      // Docked: no pop-out button (header drag-lift is the only path). Popped:
      // PanelCard renders the standard X from this same handler.
      onTogglePopout={onToggleFromCtx}
      // Selection IS the expansion axis here (compressed = !selected), so a
      // header click toggles selection just like a body click.
      onHeaderActivate={onClick}
      isCollapsed={compressed}
      extraCardClass={`cursor-pointer${draggable ? " cursor-grab active:cursor-grabbing" : ""}${!isCited ? " opacity-60" : ""}`}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onClick={onClick}
    >
      {compressed ? (
        <div className="px-3 py-1.5">{titleLine}</div>
      ) : (
        /* Body — keeps the roomier `cardInner` (px-4 py-3) rather than the
           ratified `cardBody` (px-3): the title + library meta + multi-pod
           publication-details / BibTeX-fields / annotations layout reads
           better with the extra breathing room (backlog #28 exemption). */
        <div className={`${PANEL.cardInner}${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}>
          {titleLine}
          {/* Library membership chips + verification / processing-tier status
              row — a standard body meta row under the title (was header layers
              2+3). */}
          {headerMeta ? (
            <div
              className="mt-2 flex flex-col gap-1"
              onClick={(e) => e.stopPropagation()}
              draggable={false}
              onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
            >
              {headerMeta}
            </div>
          ) : null}
          <div className="mt-2">{bodyContent}</div>
        </div>
      )}
    </PanelCard>
  );
  return card;
}
