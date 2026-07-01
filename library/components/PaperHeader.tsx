"use client";

import { useEffect, useRef, useState } from "react";
import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry, IndexedState } from "@library/lib/catalog";
import {
  cancelBibReview,
  cancelDeepIndex,
  cancelImportBib,
  cancelPaperReview,
  queueBibReview,
  queueDeepIndex,
  queueImportBib,
  queuePaperReview,
  readBibReviewState,
  readDeepIndexState,
  readImportBibState,
  readPaperReviewState,
} from "@library/lib/bib-edit";
import { writeQueueEntry } from "@library/lib/queue";
import type { QueueEntry } from "@library/lib/queue";
import { deleteFile, readJsonFile, SUBDIRS } from "@library/lib/library-storage";
import { formatBibliography } from "@library/lib/bib-parser";
import { ExpandedFields } from "./BibCard";
import { IndexedPill, BibPill, BibImportedPill } from "./StatusPill";
import PaperAiRequestsMenu, {
  type AiRequestItem,
} from "./PaperAiRequestsMenu";
import { BibEntryChrome } from "@/components/library/bib-entry-chrome";
import { mapTier } from "@/hooks/useLibrary";
import { type PgmarkPages } from "@library/hooks/usePgmarkPages";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  entry: CatalogEntry;
  bib: BibEntry | null | undefined;
  viewMode: "text" | "pdf";
  onViewModeChange: (m: "text" | "pdf") => void;
  pdfAvailable: boolean;
  /** Deep-index state of this paper — drives the Text button's dynamic
   *  label ("Virgil Text" when deepIndexed, else "Raw Text"). */
  indexedState: IndexedState;
  /** Open the manual bib edit modal. Owned by the parent so the modal
   *  state can outlive header re-renders. Absent when editing isn't allowed
   *  (no real full bib entry resolved yet — see RightDetail's `canEdit`). */
  onEdit?: () => void;
  /** The full bib entry that edit needs is still loading. Shows the edit
   *  affordance visible-but-disabled ("Loading bibliography…") instead of
   *  hiding it, so the control doesn't pop in late. Ignored when `onEdit` is
   *  present (already editable). */
  editPending?: boolean;
  /** Whether to surface the "Open in a new tab" link inside the bib-entry
   *  status row (F#9). False in the OUTER Virgil-bar tab (already a tab, so
   *  the link is self-referential); true in the in-library Reader. */
  showOpenInTab?: boolean;
  /** The shared printed-page derivation that drives the header page picker.
   *  F#11: in TEXT mode this is computed ONCE in RightDetail (the single owner)
   *  off the live reader refs and threaded down here AND into PageScrollLozenge,
   *  so both consumers share one ResizeObserver / scroll listener / doc-scan.
   *  F#11(a): in PDF mode RightDetail instead synthesizes this from the live
   *  pdf.js viewer page state (`pdfPagesToPgmark`) so the SAME PagePicker drives
   *  the PDF picker at parity. Either way PaperHeader stays agnostic — it just
   *  renders the picker from whatever `PgmarkPages` it's handed. Absent only
   *  when no picker applies (e.g. no entry). */
  pgmarkPages?: PgmarkPages;
}

type RequestKind = "index" | "deep" | "bib" | "doc" | "importbib";

const REQUESTS: { kind: RequestKind; label: string }[] = [
  { kind: "index", label: "Index" },
  { kind: "deep", label: "Deep index" },
  { kind: "bib", label: "Bib review" },
  { kind: "doc", label: "Doc review" },
  { kind: "importbib", label: "Import bib" },
];

/** Sole header for a paper-file tab — a narrow, centered warm-sheet pod
 *  (max-width ~620px, margin-inline auto) with three EQUAL-width columns:
 *  (1) BIB DATA — the formatted bibliography headline (author · year, then the
 *      title on its own line) + the full APA citation, with the raw citekey, a
 *      copy button, and the fields/edit controls as its footer; (2) STATUS —
 *      the index-state, bib-auth, and (when imported) "Bibliography imported"
 *      pills as full-phrase stacked lozenges, with the AI-requests dropdown
 *      beneath; (3) PDF / PAPER — a page-count label and the printed-page
 *      picker. The Text/PDF view toggle is PINNED at the pod's top-right so it
 *      stays fixed as content changes. Flash text, the expanded fields table,
 *      and the AI-instructions textarea run full-width below the row. Below
 *      ~560px the three columns stack. */
export default function PaperHeader({
  handle,
  entry,
  bib,
  viewMode,
  onViewModeChange,
  pdfAvailable,
  indexedState,
  onEdit,
  editPending = false,
  showOpenInTab = true,
  pgmarkPages,
}: Props) {
  const citekey = entry.citekey;
  const [expanded, setExpanded] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  // Per-kind queued state. Index and bib share `queue/<citekey>.json` so
  // they're effectively mutually exclusive on disk; the UI reflects whatever
  // ends up there after each toggle.
  const [queued, setQueued] = useState<Record<RequestKind, boolean>>({
    index: false,
    deep: false,
    bib: false,
    doc: false,
    importbib: false,
  });
  const [busy, setBusy] = useState<Record<RequestKind, boolean>>({
    index: false,
    deep: false,
    bib: false,
    doc: false,
    importbib: false,
  });

  const isIndexed = indexedState === "indexed" || indexedState === "deepIndexed";
  const indexNeeded = indexedState === "none" || indexedState === "failed";

  // Refresh all queue states for this citekey.
  const refreshAll = async () => {
    if (!handle || !citekey) {
      setQueued({ index: false, deep: false, bib: false, doc: false, importbib: false });
      return;
    }
    const [bibR, docR, deepR, importR, shared] = await Promise.all([
      readBibReviewState(handle, citekey),
      readPaperReviewState(handle, citekey),
      readDeepIndexState(handle, citekey),
      readImportBibState(handle, citekey),
      readJsonFile<QueueEntry>(handle, `${SUBDIRS.queue}/${citekey}.json`),
    ]);
    const indexQueued = !!shared && shared.kind === "index" && shared.status === "requested";
    setQueued({
      index: indexQueued,
      deep: !!deepR,
      bib: !!bibR,
      doc: !!docR,
      importbib: !!importR,
    });
  };

  useEffect(() => {
    let cancelled = false;
    if (!handle || !citekey) {
      setQueued({ index: false, deep: false, bib: false, doc: false, importbib: false });
      return;
    }
    void (async () => {
      const [bibR, docR, deepR, importR, shared] = await Promise.all([
        readBibReviewState(handle, citekey),
        readPaperReviewState(handle, citekey),
        readDeepIndexState(handle, citekey),
        readImportBibState(handle, citekey),
        readJsonFile<QueueEntry>(handle, `${SUBDIRS.queue}/${citekey}.json`),
      ]);
      if (cancelled) return;
      const indexQueued = !!shared && shared.kind === "index" && shared.status === "requested";
      setQueued({
        index: indexQueued,
        deep: !!deepR,
        bib: !!bibR,
        doc: !!docR,
        importbib: !!importR,
      });
    })();
    return () => { cancelled = true; };
  }, [handle, citekey]);

  const flashFor = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2400);
  };

  const setKindBusy = (kind: RequestKind, b: boolean) =>
    setBusy((cur) => ({ ...cur, [kind]: b }));

  const queueIndex = async (note: string) => {
    if (!handle || !citekey) return;
    const entry: QueueEntry = {
      kind: "index",
      status: "requested",
      citekey,
      requestedAt: new Date().toISOString(),
      attempts: 0,
      ...(note.length > 0 ? { note } : {}),
    };
    await writeQueueEntry(handle, entry);
  };

  const cancelIndex = async () => {
    if (!handle || !citekey) return;
    const path = `${SUBDIRS.queue}/${citekey}.json`;
    const cur = await readJsonFile<QueueEntry>(handle, path);
    if (cur && cur.kind === "index" && cur.status === "requested") {
      await deleteFile(handle, path);
    }
  };

  const onToggle = async (kind: RequestKind, nextChecked: boolean) => {
    if (!handle || !citekey) return;
    if (busy[kind]) return;
    const note = instructions.trim();
    setKindBusy(kind, true);
    try {
      if (nextChecked) {
        if (kind === "index") await queueIndex(note);
        else if (kind === "deep") await queueDeepIndex(handle, citekey, note, indexNeeded);
        else if (kind === "bib") await queueBibReview(handle, citekey, note);
        else if (kind === "importbib") await queueImportBib(handle, citekey, note);
        else await queuePaperReview(handle, citekey, note);
        flashFor("queued ✓");
      } else {
        if (kind === "index") await cancelIndex();
        else if (kind === "deep") await cancelDeepIndex(handle, citekey);
        else if (kind === "bib") await cancelBibReview(handle, citekey);
        else if (kind === "importbib") await cancelImportBib(handle, citekey);
        else await cancelPaperReview(handle, citekey);
        flashFor("cancelled");
      }
      // Refresh all queued states — index/bib share a slot on disk, so a
      // toggle on one can implicitly clear the other.
      await refreshAll();
    } catch (e) {
      flashFor(`failed: ${(e as Error).message}`);
    } finally {
      setKindBusy(kind, false);
    }
  };

  // Disabled state per checkbox.
  const disabledFor = (kind: RequestKind): { disabled: boolean; title?: string } => {
    if (!handle || !citekey) return { disabled: true };
    if (busy[kind]) return { disabled: true };
    if (kind === "doc") {
      // Doc review needs the paper text to exist.
      if (!isIndexed) return { disabled: true, title: "Index the paper first to file a document AI request" };
    }
    if (kind === "importbib") {
      // Importing folds the paper's references.bib into master.bib — needs
      // an indexed paper (no references.bib otherwise).
      if (!isIndexed) return { disabled: true, title: "Index the paper first to import its bibliography" };
    }
    return { disabled: false };
  };

  // ── render ──────────────────────────────────────────────────────────
  const fields = bib?.fields ?? {};
  const titleText = fields.title ?? entry.title ?? "(no title)";
  const authorText = fields.author ?? (entry.authors?.join(", ") ?? "");
  const yearText = fields.year ?? (entry.year ? String(entry.year) : "");

  const anyChecked = Object.values(queued).some(Boolean);

  const apaHtml = bib ? formatBibliography(bib, "apa") : undefined;

  // Responsive layout: measure the pod's border-box width and, below a
  // threshold, STACK the 3 status columns (flexDirection: column) instead of
  // laying them side-by-side, so the detail panel can shrink to ~330px without
  // the columns overflowing. The SAME `narrow` flag also drives the compact
  // labels in PagePicker ("p." prefix dropped) and ViewToggle ("Text" vs.
  // "Virgil Text"/"Raw Text") so the bottom-of-column controls stay legible
  // when stacked.
  const podRef = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const narrowRaf = useRef<number | null>(null);
  useEffect(() => {
    const el = podRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = (w: number) => setNarrow(w < 560);
    // Initial sync uses the BORDER-box width (getBoundingClientRect).
    measure(el.getBoundingClientRect().width);
    // RAF-coalesced so a resize storm can't thrash setState (keystroke
    // sanctity / AGENTS.md — a width-watching RO must be RAF-guarded). Read the
    // BORDER-box (`borderBoxSize.inlineSize`) here too so the 560px threshold
    // resolves against the SAME box as the initial sync above — the pod carries
    // 14px of horizontal padding, so mixing in `contentRect.width`
    // (content-box) could flip the side-by-side↔stacked layout differently on
    // first paint vs. after the first resize tick. Fall back to the border-box
    // rect (then contentRect) where `borderBoxSize` is unavailable.
    const ro = new ResizeObserver((entries) => {
      if (narrowRaf.current !== null) return;
      narrowRaf.current = requestAnimationFrame(() => {
        narrowRaf.current = null;
        const entry = entries[0];
        const w =
          entry?.borderBoxSize?.[0]?.inlineSize ??
          el.getBoundingClientRect().width ??
          entry?.contentRect.width;
        if (typeof w === "number") setNarrow(w < 560);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (narrowRaf.current !== null) {
        cancelAnimationFrame(narrowRaf.current);
        narrowRaf.current = null;
      }
    };
  }, []);

  // ── PDF / paper page-count label (column 3) ──────────────────────────
  const pdfStatus = entry.pdf;
  const pageCountLabel = (() => {
    if (pdfStatus.present && typeof pdfStatus.pageCount === "number") {
      const n = pdfStatus.pageCount;
      return `${n} page${n !== 1 ? "s" : ""}`;
    }
    const fmt = pdfStatus.format;
    if (fmt === "docx") return "Word document";
    if (fmt === "tex") return "LaTeX source";
    if (pdfStatus.present) return "PDF";
    return "No PDF";
  })();

  // Build the dropdown items from the static REQUESTS list + live queued/disabled
  // state. Order + labels match the old checkbox row.
  const aiRequestItems: AiRequestItem<RequestKind>[] = REQUESTS.map(
    ({ kind, label }) => {
      const { disabled, title } = disabledFor(kind);
      return { kind, label, checked: queued[kind], disabled, title };
    },
  );

  return (
    <div
      style={{
        padding: "8px calc(4px + var(--pod-gap))",
        background: "var(--background)",
      }}
    >
      {/* ── One cohesive warm-sheet pod (borderless; ambient shadow). The old
          50/50 grid + two nested --surface pods are gone; internal regions are
          delimited by spacing + hairline dividers. ── */}
      <div
        ref={podRef}
        style={{
          position: "relative",
          background: "var(--pod-panel)",
          borderRadius: "var(--panel-radius)",
          border: "var(--panel-border)",
          boxShadow: "var(--card-shadow-ambient)",
          padding: "10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          // NARROW + CENTERED (change 6): the pod does not stretch full-width.
          // A comfortable max-width centered over the text pod below; it shrinks
          // freely on narrow panels and still stacks below the 560px threshold.
          width: "100%",
          maxWidth: 620,
          marginInline: "auto",
          minWidth: 0,
        }}
      >
        {/* Text/PDF view toggle — PINNED top-right of the pod so it never moves
            as the columns' content changes. Reserved space (paddingRight on the
            row) keeps it from overlapping col-3 content at any width. */}
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 14,
            zIndex: 1,
          }}
        >
          <ViewToggle
            mode={viewMode}
            onChange={onViewModeChange}
            pdfAvailable={pdfAvailable}
            indexedState={indexedState}
            narrow={narrow}
          />
        </div>

        {/* THREE EQUAL-width columns: bib data · status · pdf/paper. A grid of
            `repeat(3, minmax(0, 1fr))` keeps col1/col2/col3 the same width.
            Below ~560px the columns STACK (single column) so the detail panel
            can shrink to ~330px without overflow. The top row reserves space on
            the right for the pinned view toggle. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: narrow ? "1fr" : "repeat(3, minmax(0, 1fr))",
            alignItems: "start",
            gap: narrow ? 10 : 16,
            minWidth: 0,
            // Reserve vertical room for the pinned toggle so it never overlaps
            // col-1 headline content; stacked layout gets the same clearance.
            paddingTop: 26,
          }}
        >
          {/* ── COLUMN 1 — BIB DATA (the yielder) ── */}
          <div style={{ minWidth: 0 }}>
            <BibEntryChrome
              citekey={citekey ?? "?"}
              author={authorText || undefined}
              year={yearText || undefined}
              title={titleText || undefined}
              apaHtml={apaHtml}
              indexTier={mapTier(entry.indexed.state)}
              bibState={entry.bib.state}
              inLibrary={!!citekey}
              membershipChips={[]}
              showMembershipChips={false}
              showOpenLink={showOpenInTab}
              showStatusRow={false}
            />
            {/* raw citekey + copy + fields/edit — mono micro-controls under
                the headline, aligned with the chip column. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingLeft: 18,
                marginTop: 2,
                flexWrap: "wrap",
              }}
            >
              <code
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {citekey ?? "?"}
              </code>
              {citekey && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(citekey).then(
                      () => flashFor("citekey copied ✓"),
                      () => flashFor("copy failed"),
                    );
                  }}
                  title="Copy citekey"
                  aria-label="Copy citekey"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    cursor: "pointer",
                    padding: "0 4px",
                  }}
                >
                  copy
                </button>
              )}
              {bib && (
                <button
                  type="button"
                  onClick={() => setExpanded((x) => !x)}
                  aria-expanded={expanded}
                  aria-label={expanded ? "Collapse fields" : "Expand fields"}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    cursor: "pointer",
                    padding: "0 4px",
                  }}
                >
                  {expanded ? "▾ fields" : "▸ fields"}
                </button>
              )}
              {onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    cursor: "pointer",
                    padding: "0 4px",
                  }}
                >
                  edit
                </button>
              ) : editPending ? (
                <button
                  type="button"
                  disabled
                  title="Loading bibliography…"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    cursor: "not-allowed",
                    padding: "0 4px",
                    opacity: 0.55,
                  }}
                >
                  edit
                </button>
              ) : null}
            </div>
          </div>

          {/* ── COLUMN 2 — STATUS (full-phrase pills, stacked) + AI menu ── */}
          <div
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 5,
              alignItems: "flex-start",
            }}
          >
            <IndexedPill state={entry.indexed.state} long />
            <BibPill state={entry.bib.state} long />
            {entry.bib.imported && <BibImportedPill long />}
            <PaperAiRequestsMenu
              items={aiRequestItems}
              onToggle={(kind, next) => void onToggle(kind, next)}
              disabled={!handle || !citekey}
            />
          </div>

          {/* ── COLUMN 3 — PDF / PAPER (page count · picker) ── The view toggle
              lives pinned at the pod's top-right, not in this column. */}
          <div
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 5,
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--muted)",
                whiteSpace: "nowrap",
              }}
            >
              {pageCountLabel}
            </span>
            {pgmarkPages && <PagePicker pages={pgmarkPages} narrow={narrow} />}
          </div>
        </div>

        {/* Flash text — its own thin line so it never displaces the row. */}
        {flash && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--accent, var(--muted))",
              textAlign: "right",
            }}
          >
            {flash}
          </div>
        )}

        {/* Field table — inline under a hairline (no nested pod). */}
        {expanded && bib && (
          <div
            style={{
              borderTop: "1px solid var(--border-light)",
              paddingTop: 10,
            }}
          >
            <ExpandedFields entry={bib} />
          </div>
        )}

        {/* Instructions textarea — full width below the row, gated on a
            checked request. */}
        {anyChecked && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 0,
              borderTop: "1px solid var(--border-light)",
              paddingTop: 8,
            }}
          >
            <label
              htmlFor="paper-ai-instructions"
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--muted)",
                letterSpacing: 0.3,
              }}
            >
              instructions
            </label>
            <textarea
              id="paper-ai-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder="Optional note. Sent with the next request you check on."
              style={{
                resize: "vertical",
                minHeight: 38,
                padding: "6px 8px",
                fontFamily: "var(--mono)",
                fontSize: 12,
                lineHeight: 1.4,
                color: "var(--foreground)",
                background: "var(--surface)",
                border: "1px solid var(--border-light)",
                borderRadius: 4,
                outline: "none",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── text-view page picker ───────────────────────────────────────────

/** `[label] / count [go]` — seeds the input with the current page label, jumps
 *  to the typed LABEL on Enter / go. Renders nothing for pgmark-less papers
 *  (DOCX / plain-tex). The page COUNT is `pages.length`; the input matches the
 *  literal printed-page LABEL (not a 1..N ordinal). */
function PagePicker({ pages, narrow }: { pages: PgmarkPages; narrow: boolean }) {
  const { pages: marks, currentLabel, scrollToPage } = pages;
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // No anchors → nothing to pick.
  if (marks.length === 0) return null;

  const shown = editing ? (draft ?? "") : (currentLabel ?? "");
  const commit = () => {
    if (draft != null && draft.trim()) scrollToPage(draft.trim());
    setEditing(false);
    setDraft(null);
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--muted)",
        flexShrink: 0,
      }}
      title="Jump to a printed page"
    >
      {!narrow && <span aria-hidden="true">p.</span>}
      <input
        type="text"
        value={shown}
        onFocus={() => {
          setEditing(true);
          setDraft(currentLabel ?? "");
        }}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setEditing(false);
            setDraft(null);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        aria-label="Go to printed page"
        style={{
          width: 40,
          padding: "2px 4px",
          fontFamily: "var(--mono)",
          fontSize: 11,
          textAlign: "center",
          color: "var(--foreground)",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: 4,
          outline: "none",
        }}
      />
      <span aria-hidden="true">/ {marks.length}</span>
    </div>
  );
}

// ─── view toggle ─────────────────────────────────────────────────────

function ViewToggle({
  mode,
  onChange,
  pdfAvailable,
  indexedState,
  narrow = false,
}: {
  mode: "text" | "pdf";
  onChange: (m: "text" | "pdf") => void;
  pdfAvailable: boolean;
  indexedState: IndexedState;
  narrow?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Document view"
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-light)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <ToggleButton
        active={mode === "text"}
        onClick={() => onChange("text")}
        label={
          narrow
            ? "Text"
            : indexedState === "deepIndexed"
              ? "Virgil Text"
              : "Raw Text"
        }
      />
      <ToggleButton
        active={mode === "pdf"}
        onClick={() => onChange("pdf")}
        label="PDF"
        disabled={!pdfAvailable}
        disabledTitle="No PDF on disk for this paper"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  disabled,
  disabledTitle,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      style={{
        background: active ? "var(--control-selected)" : "transparent",
        color: disabled ? "var(--muted)" : active ? "white" : "var(--foreground)",
        border: "none",
        padding: "4px 10px",
        fontSize: 11,
        fontFamily: "var(--sans, inherit)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}
