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
import { StatusPills, StatusDots } from "./StatusPill";
import PaperAiRequestsMenu, {
  type AiRequestItem,
} from "./PaperAiRequestsMenu";
import { BibEntryChrome } from "@/components/library/bib-entry-chrome";
import { mapTier, useLibraryMemberships } from "@/hooks/useLibrary";
import { membershipChipsFor } from "@/components/library/provenance-chips";
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

/** Sole header for a paper-file tab — a 2-column grid:
 *  formatted bibliography entry on the left (full height); right column
 *  stacks the status pills, the Text/PDF toggle, an "AI requests:" row
 *  of checkboxes, and an instructions textarea. */
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

  // Membership chips for the bib-entry status stack. "Central" is implicit
  // for any real catalog entry (it lives in master.bib), so surface it
  // alongside any custom-library memberships.
  const { membershipMap } = useLibraryMemberships();
  const membershipChips = citekey
    ? membershipChipsFor({
        inLocal: false,
        inCentral: true,
        customLibraries: membershipMap.get(citekey),
      })
    : [];
  const apaHtml = bib ? formatBibliography(bib, "apa") : undefined;

  // Responsive status: swap full StatusPills → compact StatusDots below a
  // width threshold so the priority ViewToggle is never pushed off the edge.
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
    // 14px of horizontal padding, so mixing in `contentRect.width` (content-box)
    // could flip the StatusPills↔StatusDots swap differently on first paint vs.
    // after the first resize tick. Fall back to the border-box rect (then
    // contentRect) where `borderBoxSize` is unavailable.
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
          background: "var(--pod-panel)",
          borderRadius: "var(--panel-radius)",
          border: "var(--panel-border)",
          boxShadow: "var(--card-shadow-ambient)",
          padding: "10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minWidth: 0,
        }}
      >
        {/* Single flex ROW: bib region (yields) + controls cluster (pinned). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
          }}
        >
          {/* Bib region — the yielder. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <BibEntryChrome
              citekey={citekey ?? "?"}
              author={authorText || undefined}
              year={yearText || undefined}
              title={titleText || undefined}
              apaHtml={apaHtml}
              indexTier={mapTier(entry.indexed.state)}
              bibState={entry.bib.state}
              inLibrary={!!citekey}
              membershipChips={membershipChips}
              showOpenLink={showOpenInTab}
            />
            {/* edit + field-table affordances — mono micro-controls under the
                headline, aligned with the chip column. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingLeft: 18,
                marginTop: 2,
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
                @{bib?.type ?? "?"}{`{${citekey ?? "?"}}`}
              </code>
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

          {/* Controls cluster — never compresses; ViewToggle pinned rightmost. */}
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {narrow ? (
              <StatusDots
                pdfPresent={pdfAvailable}
                indexed={entry.indexed.state}
                bib={entry.bib.state}
              />
            ) : (
              <StatusPills
                pdfPresent={pdfAvailable}
                indexed={entry.indexed.state}
                bib={entry.bib.state}
                bibImported={!!entry.bib.imported}
              />
            )}
            {pgmarkPages && <PagePicker pages={pgmarkPages} narrow={narrow} />}
            <PaperAiRequestsMenu
              items={aiRequestItems}
              onToggle={(kind, next) => void onToggle(kind, next)}
              disabled={!handle || !citekey}
            />
            <div style={{ marginLeft: "auto", flexShrink: 0 }}>
              <ViewToggle
                mode={viewMode}
                onChange={onViewModeChange}
                pdfAvailable={pdfAvailable}
                indexedState={indexedState}
                narrow={narrow}
              />
            </div>
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
