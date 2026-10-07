"use client";

import React, { useState, useCallback, useMemo } from "react";
import type { BibEntry } from "@/lib/types";
import type { BibEntrySave } from "@/hooks/useCitations";
import { bibFieldDisplay, formatMinimalCitation } from "@/lib/bib-parser";
import { PanelCard, PANEL, Chevron, Button, CardJumpTarget, cardTitleStyle } from "./panel-primitives";
import { Input } from "./field-primitives";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { MIME_CITATION, MIME_BIB_MERGE } from "@/lib/marginalia";
import { attachClampedDragGhost, buildTextDragGhost } from "@/lib/drag-ghost";
import { popKey as buildPopKey } from "@/panels/panel-registry";
import { AMBER_ATTENTION_INK } from "@/panels/_shared/amber-attention";
import { sanitizeAnnotationHtml } from "@/lib/sanitize-html";
import { annotationHtmlToRich, richToAnnotationHtml } from "@/lib/annotation-html";
import RichTextField from "@/components/RichTextField";
import type { JSONContent } from "@tiptap/react";
import { iconHint } from "@/components/Hint";
import { bibAddressOf } from "@/lib/bib-address";
import {
  ReviewRequestChip,
  ReviewRequestStrip,
  useReviewRequestComposer,
} from "@/components/bib-review-request";
import { validateBibEntryHeadChange } from "@/lib/bib-entry-head";
import { useCopyFlash } from "@/hooks/useCopyFlash";

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
  /** The note a PENDING request was sent with, read back from the persisted
   *  row (task 981) — so the strip shows what the skill will receive. */
  getReviewNotes?: (bibKey: string, type: "fields" | "notes") => string | undefined;
  /**
   * Save this entry — ONE write for the whole gesture (task 691). Takes the
   * ENTRY, not its citekey (task 690): a citekey names as many blocks as carry
   * it, and the mutator used to rewrite all of them, so editing the one card
   * the panel showed destroyed a second, hidden block's fields.
   *
   * The editor used to fire TWO of these — a set-all field write, then a
   * head write — which raced in the `.bib`'s serial queue and could drop the
   * field edits silently. There is one door now, so it cannot.
   */
  onSaveBibEntry: (entry: BibEntry, patch: BibEntrySave) => void;
  occurrenceInfo?: { total: number; current: number; onCycle: (delta: number) => void };
  /** Bib entries list — needed for formatMinimalCitation in drag ghost. */
  bibEntries?: BibEntry[];
  /** Whether this entry is cited in the document. */
  isCited?: boolean;
  /** Called when user clicks the target icon to jump to this entry in the text. Only shown when selected. */
  onJump?: (sourceEl: HTMLElement | null) => void;
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
  /**
   * Present ⇒ this card is a PREVIEW of a record that does not belong to this
   * paper — today, a central-library (`master.bib`) search result — and the
   * whole write surface is withheld, with `reason` shown in its place
   * (task 692).
   *
   * Every write this card can perform is addressed by `entry.key` into THIS
   * paper's stores: the `.bib` save, the annotation, the review requests. On a
   * library result that address is either NOTHING (the citekey is not in the
   * local bib — the edit vanished with no feedback) or, worse, a DIFFERENT
   * record (the citekey is local, so a set-all Save from a library-seeded
   * editor overwrote the paper's own entry, deleting every field the library
   * copy lacked). The card is what knows which affordances write, so the card
   * is where the question is answered — ONCE, not per affordance: the
   * callbacks are reachable only through `writes`, which is `null` here, so a
   * write surface added later cannot reach one without answering it.
   *
   * It also withholds the two doors that lead BACK to a writable card: the
   * drag (a `\cite{}` for a key the paper's bibliography does not hold) and
   * the pop-out identity (`registerCardFloatable("bib")` resolves an id
   * against the LOCAL entries, so lifting a library result opened either a
   * blank float or a fully-writable card for whichever local entry shared its
   * citekey — the cross-target write again, one gesture further out).
   */
  readOnly?: { reason: string };
}

/* ── Rich-text annotation editor ──────────────────────────────────── */
//
// Task 952: the annotation is edited in the SHARED `RichTextField` — the same
// TipTap stack and the same toolbar as footnote/note bodies — not a hand-rolled
// contentEditable driven by the deprecated `document.execCommand`, whose
// toolbar had drifted from the shared one (no focus ring on four of five
// buttons, no small caps, no disabled state). One editor stack, one toolbar.
//
// The value is still stored as sanitized HTML (`annotations.json`, keyed by
// uid); `annotation-html.ts` is the bridge at the field boundary, one door
// each way, with `sanitizeAnnotationHtml` on both (BIB-F5-01 — the stored
// string is untrusted; a paste is parsed by the schema, never `innerHTML`'d).
//
// C4 (BIB-F8-01 / BIB-F8-02) contracts, now held by `RichTextField` itself:
//   • FLUSH on blur AND unmount — the debounce never outlives the field.
//   • RE-SEED from the controlled `content` when another surface (the docked
//     card ⇄ the popped float) writes the same entry — but never while THIS
//     field is focused (that would stomp the caret); an entry switch
//     (`instanceKey` = the citekey) remounts, so it always re-seeds.
function AnnotationEditor({
  bibKey, content, onUpdate,
}: {
  bibKey: string; content: string; onUpdate: (key: string, html: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  // The read door — sanitized once per stored value, not per render.
  const value = useMemo(() => annotationHtmlToRich(content), [content]);
  // The write door. Bound to `bibKey` through the closure, and RichTextField
  // flushes a pending edit to the OUTGOING handler on a key change, so an edit
  // can never land on the next entry.
  const handleChange = useCallback(
    (json: JSONContent) => onUpdate(bibKey, sanitizeAnnotationHtml(richToAnnotationHtml(json))),
    [bibKey, onUpdate],
  );
  const handleFocusChange = useCallback((f: boolean) => setFocused(f), []);

  return (
    <div className="px-3 py-2 text-sm leading-relaxed" onClick={(e) => e.stopPropagation()}>
      <RichTextField
        value={value}
        instanceKey={bibKey}
        onChange={handleChange}
        onFocusChange={handleFocusChange}
        placeholder="Write an annotation for this reference..."
        variant="note"
        panelKey="bib"
        hideToolbar={!focused}
      />
    </div>
  );
}

/* ── BibEntryCard ─────────────────────────────────────────────────── */
export default function BibEntryCard({
  entry, isSelected, onClick, getAnnotation, setAnnotation,
  onRequestReview, onCancelReview, getReviewStatus, getReviewNotes, onSaveBibEntry,
  occurrenceInfo, bibEntries, isCited = true, onJump,
  isPoppedOut, headerMeta, addAction, readOnly,
}: BibEntryCardProps) {
  /**
   * THE gate (task 692). Every write callback this card holds is reachable
   * only through here, and here is `null` on a preview card — so "may this
   * card write to the paper?" is asked once, structurally, instead of being
   * re-answered (or forgotten) by each affordance. A new write surface that
   * reaches for `onSaveBibEntry` directly is the defect; reaching through
   * `writes` makes the compiler ask the question.
   */
  const writes = readOnly
    ? null
    : {
        save: onSaveBibEntry,
        setAnnotation,
        requestReview: onRequestReview,
        cancelReview: onCancelReview,
      };
  /** A preview card never drags: its `\cite{key}` would name a key this
   *  paper's `references.bib` does not hold. (This was a separate `draggable`
   *  prop whose only producer was the same preview flag — one fact, one
   *  switch.) */
  const draggable = !readOnly;
  const popped = usePoppedCards();
  /** No float IDENTITY for a preview card — `canLift` clause 1 reads exactly
   *  this, so withholding it is the registry's own "not poppable" answer. */
  const popKey = readOnly ? undefined : buildPopKey("bibliography", entry.key);
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
  const { copied, copy } = useCopyFlash();

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
  // THE review-request control (task 981) — compose-then-send, one state
  // machine for both pods. A review request is a WRITE (it mints an AI request
  // against this paper's inbox), so its doors come through `writes`: a preview
  // card hands over null and the composer can mint nothing.
  const reviewComposer = useReviewRequestComposer({
    bibKey: entry.key,
    request: writes?.requestReview ?? null,
    cancel: writes?.cancelReview ?? null,
    getStatus: getReviewStatus,
    onOpen: (type) => (type === "fields" ? setFieldsOpen(true) : setAnnotationOpen(true)),
  });

  /**
   * Is the head the user has typed writable to `references.bib`? Read twice —
   * once to disable Save (and say why), once inside `commitEditBib` — so the
   * rule is never re-derived, and the control the user is looking at reflects
   * the same answer the write door will give (task 690).
   *
   * `self` is this entry's address, so "the key you already have" is not a
   * collision while "the key that other block has" is.
   */
  const headCheck = useMemo(() => {
    if (!editingBib) return { ok: true } as const;
    const entries = bibEntries ?? [];
    // Measured against the head the entry ALREADY has (task 691), so Save is
    // disabled for what this edit changes and not for what it inherits — a
    // `references.bib` may legally hold two blocks under one citekey, and the
    // absolute check called that a collision, refusing to write the FIELDS of
    // either duplicate.
    return validateBibEntryHeadChange(
      { key: entry.key, type: entry.type },
      { key: editBibKey, type: editBibType },
      { entries, self: bibAddressOf(entries, entry) },
    );
  }, [editingBib, editBibKey, editBibType, bibEntries, entry]);

  const startEditBib = () => {
    setEditingBib(true);
    setEditBibFields({ ...entry.fields });
    setEditBibType(entry.type);
    setEditBibKey(entry.key);
    setShowBibWarning(true);
  };
  const commitEditBib = () => {
    // The gate, read where the write actually happens (task 692). The editor
    // that reaches this is not rendered on a preview card at all, so this is
    // belt-and-braces — but it is the compiler's belt: `writes.save` cannot be
    // called without it.
    if (!writes) return;
    // THE door (task 690). Save used to accept anything the two free-text
    // boxes held: an empty `@type` wrote `@{key,…}` — a block Virgil's own
    // extractor cannot read back, so the next parse dropped the entry and the
    // write after that removed it from the user's only copy — and a citekey
    // that already named another entry silently fused the two.
    if (!headCheck.ok) return;
    // ONE write for the whole gesture (task 691). This used to be two — a
    // set-all field write, then a head write whenever the key or type had
    // changed — issued back-to-back with nothing awaited between them. They
    // reached the `.bib`'s serial queue in whatever order their (IO-costing)
    // queue keys resolved, and when the rename won, the field write addressed
    // an entry that no longer had that key, matched nothing, and was declined
    // in silence.
    //
    // The editor's `editBibFields` is the COMPLETE intended field set (seeded
    // from `entry.fields`, edited in place), so a Save is set-all — a field the
    // user cleared must be deleted, not silently retained (BIB-A3-02).
    writes.save(entry, {
      fields: editBibFields,
      type: editBibType.trim(),
      key: editBibKey.trim(),
    });
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
    void copy(entry.key);
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
  }, [entry.key, bibEntries]);

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
        <span className="text-xs card-mono text-ink-muted break-all">{entry.key}</span>
        <button
          type="button"
          onClick={handleCopyKey}
          className="iconbtn-xs iconbtn-meta"
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
          {writes && (
          <ReviewRequestChip type="fields" status={fieldsReviewStatus} composer={reviewComposer} />
          )}
        </div>

        {fieldsOpen && (
          <div className="mt-1.5 space-y-1.5">
            {writes && (
              <ReviewRequestStrip
                type="fields"
                status={fieldsReviewStatus}
                sentNote={getReviewNotes?.(entry.key, "fields")}
                composer={reviewComposer}
              />
            )}
            <div className={PANEL.subpod}>
              {editingBib ? (
                <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                  {showBibWarning && (
                    <div className="text-[var(--amber-600)] bg-[var(--amber-50)] border border-[var(--amber-200)] rounded px-2 py-1 mb-1 text-xs">
                      Warning: editing will modify the .bib file. Changing the
                      key also rewrites every <code>\cite</code> of it in the
                      document, and moves this entry&rsquo;s annotation and
                      review requests with it.
                    </div>
                  )}
                  {/* Editable @type and key */}
                  <div className="flex gap-1 items-start">
                    <span className="card-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">@type:</span>
                    <Input value={editBibType} density="dense"
                      onChange={(e) => setEditBibType(e.target.value)}
                      className="flex-1 card-mono px-1 py-0.5 text-xs" />
                  </div>
                  <div className="flex gap-1 items-start">
                    <span className="card-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">key:</span>
                    <Input value={editBibKey} density="dense"
                      onChange={(e) => setEditBibKey(e.target.value)}
                      className="flex-1 card-mono px-1 py-0.5 text-xs" />
                  </div>
                  {Object.entries(editBibFields).map(([field, val]) => (
                    <div key={field} className="flex gap-1 items-start">
                      <span className="card-mono text-ink-muted w-16 flex-shrink-0 text-right text-xs">{field}:</span>
                      <Input value={val} density="dense"
                        onChange={(e) => setEditBibFields((prev) => ({ ...prev, [field]: e.target.value }))}
                        className="flex-1 card-mono px-1 py-0.5 text-xs" />
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
                  {!headCheck.ok && (
                    <div className="text-error text-xs px-2 py-1" role="alert">
                      {headCheck.reason}
                    </div>
                  )}
                  <div className="flex gap-1 mt-1">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={commitEditBib}
                      disabled={!headCheck.ok}
                      title={headCheck.ok ? undefined : headCheck.reason}
                    >
                      Save
                    </Button>
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
                  <div className="break-words card-mono text-ink-muted mb-0.5">
                    @{entry.type}{"{" + entry.key + "}"}
                  </div>
                  {Object.entries(entry.fields).map(([field, val]) => (
                    <div key={field} className="break-words" style={{ overflowWrap: "anywhere" }}>
                      <span className="card-mono text-ink-muted">{field}:</span>{" "}
                      <span className="text-ink-body">{val}</span>
                    </div>
                  ))}
                  {/* The write surface, or the reason there isn't one
                      (task 692). A preview card's Save addressed this paper's
                      bibliography by citekey: it either matched nothing and
                      vanished, or matched a DIFFERENT record and overwrote it
                      set-all. Saying so beats a button that lies. */}
                  {writes ? (
                    <button onClick={(e) => { e.stopPropagation(); startEditBib(); }}
                      className="text-xs text-ink-muted hover:text-ink-body underline mt-1">Edit entry</button>
                  ) : (
                    <div className="text-xs text-ink-muted mt-1 italic">{readOnly!.reason}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Pod: Annotations ──────────────────────────── */}
      {/* The annotation is THIS paper's note on THIS paper's entry, read and
          written by citekey. On a library-preview card it is neither: it
          would show (and overwrite) the note of whatever local entry happened
          to share the citekey, or silently file one under a key the
          bibliography does not hold. The pod is the write, so it goes with
          the gate (task 692). */}
      {writes && (
      <div className="mt-2">
        <div className="flex items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); setAnnotationOpen((p) => !p); }}
            className={`flex items-center gap-1.5 text-xs transition-colors ${
              annotation ? AMBER_ATTENTION_INK : "text-ink-subtle hover:text-ink-body"
            }`}>
            <Chevron expanded={annotationOpen} />
            <span>Annotations</span>
          </button>
          <ReviewRequestChip type="notes" status={notesReviewStatus} composer={reviewComposer} />
        </div>

        {annotationOpen && (
          <div className="mt-1.5 space-y-1.5">
            <ReviewRequestStrip
              type="notes"
              status={notesReviewStatus}
              sentNote={getReviewNotes?.(entry.key, "notes")}
              composer={reviewComposer}
            />
            <div className={PANEL.subpodWhite}>
              <AnnotationEditor bibKey={entry.key} content={annotation} onUpdate={writes.setAnnotation} />
            </div>
          </div>
        )}
      </div>
      )}
    </>
  );

  const onToggleFromCtx = popped && popKey
    ? (anchor: DOMRect) => popped.toggleAtAnchor(popKey, anchor)
    : undefined;

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
      data-hint={headerText}
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
              data-button-exempt="10px inline card-chrome chip, below Button's sm scale"
              onClick={(e) => { e.stopPropagation(); addAction.onAdd(); }}
              className="focus-ring text-[10px] text-positive-ink hover:text-positive-strong hover:bg-positive-soft px-1.5 py-0.5 rounded"
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
            data-iconbtn-exempt="inline text glyph sized by its text line, not a box"
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
            data-iconbtn-exempt="inline text glyph sized by its text line, not a box"
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
      extraCardClass={`cursor-pointer${!isCited ? " opacity-60" : ""}`}
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
