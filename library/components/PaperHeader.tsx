"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BibEntry } from "@library/lib/types";
import type { CatalogEntry, IndexedState } from "@library/lib/catalog";
import {
  PAPER_REQUESTS,
  PAPER_REQUESTS_BY_KIND,
  type PaperRequestKind,
} from "@library/lib/paper-ai-requests";
import {
  isQueued,
  refreshQueueState,
  useQueueState,
} from "@library/lib/queue-state-store";
import { formatBibliography } from "@library/lib/bib-parser";
import { ExpandedFields } from "./BibCard";
import { IndexedPill, BibPill, BibImportedPill } from "./StatusPill";
import PaperAiRequestsMenu, {
  type AiRequestItem,
} from "./PaperAiRequestsMenu";
import { BibEntryChrome } from "@/components/library/bib-entry-chrome";
import { dispatchOpenLibrary } from "@/components/library/open-library-entry";
import { CopyIcon } from "@/components/icons/CopyIcon";
import { ExternalLinkIcon } from "@/components/icons/ExternalLinkIcon";
import { mapTier } from "@/hooks/useLibrary";
import { type PgmarkPages } from "@library/hooks/usePgmarkPages";
import PagePicker from "./PagePicker";
import { FONT_MONO, FONT_SANS } from "@/lib/font-stacks";

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
  /** Live viewport geometry of the reader's text pod (`[data-pod-frame]`),
   *  measured by RightDetail. When present (TEXT mode) the header pins its own
   *  pod to match — same width, same left edge — so the two line up instead of
   *  the header centering in the full detail width while the editor card sits
   *  offset by the left panel rail. Null in PDF mode → the header falls back to
   *  its centered max-width default. */
  textPodRect?: { left: number; width: number } | null;
}

type RequestKind = PaperRequestKind;

/** Per-kind all-false seed, shared by the `busy` state and the derived
 *  `queued` map so neither can enumerate the kinds differently. */
const ALL_FALSE: Record<RequestKind, boolean> = {
  index: false,
  deep: false,
  bib: false,
  doc: false,
  importbib: false,
};

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
  textPodRect,
}: Props) {
  const citekey = entry.citekey;
  const [expanded, setExpanded] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<RequestKind, boolean>>(ALL_FALSE);

  const isIndexed = indexedState === "indexed" || indexedState === "deepIndexed";
  const indexNeeded = indexedState === "none" || indexedState === "failed";

  // Per-kind queued state, DERIVED from the shared queue-state store rather
  // than read once per mount. This header is kept alive by `ReaderLRU`
  // (`KeepAliveSlot` hides it with `display:none` instead of unmounting), so a
  // `[handle, citekey]` effect never re-runs for the whole life of the tab —
  // which is how the checkboxes and the menu's count badge kept claiming
  // "queued" after a background skill drained the queue (task 132). The store
  // polls the queue directory on the same 6 s cowork cadence the catalog and
  // the row dots use, and every local writer pushes through it. Inside the
  // Library tab that scan is already running for the list's row dots, so N
  // kept-alive headers cost nothing extra.
  const queueSnapshot = useQueueState(handle);
  const queued = useMemo(() => {
    // No library handle → nothing is filable and nothing is cancellable, so
    // the boxes read empty rather than borrowing the store's snapshot (which
    // belongs to a library this header isn't connected to).
    if (!handle || !citekey) return ALL_FALSE;
    const out = { ...ALL_FALSE };
    for (const req of PAPER_REQUESTS) {
      out[req.kind] = isQueued(queueSnapshot, citekey, req.queueKind);
    }
    return out;
  }, [queueSnapshot, citekey, handle]);

  const flashFor = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2400);
  };

  const setKindBusy = (kind: RequestKind, b: boolean) =>
    setBusy((cur) => ({ ...cur, [kind]: b }));

  const onToggle = async (kind: RequestKind, nextChecked: boolean) => {
    if (!handle || !citekey) return;
    if (busy[kind]) return;
    const req = PAPER_REQUESTS_BY_KIND[kind];
    const ctx = {
      root: handle,
      citekey,
      note: instructions.trim(),
      indexNeeded,
    };
    setKindBusy(kind, true);
    try {
      if (nextChecked) {
        await req.enqueue(ctx);
        flashFor("queued ✓");
      } else {
        await req.cancel(ctx);
        flashFor("cancelled");
      }
      // Re-read the queue rather than trusting our own write: index/bib share
      // `queue/<citekey>.json`, so a toggle on one can implicitly clear the
      // other, and a deep-index request can plant a companion index entry.
      // Pushing it through the shared store also updates the list's row dot
      // (and any other open reader) in the same beat.
      await refreshQueueState();
    } catch (e) {
      flashFor(`failed: ${(e as Error).message}`);
    } finally {
      setKindBusy(kind, false);
    }
  };

  // Disabled state per checkbox — the precondition is declared on the request
  // descriptor, so a new kind states its own rule instead of growing another
  // branch here.
  const disabledFor = (kind: RequestKind): { disabled: boolean; title?: string } => {
    if (!handle || !citekey) return { disabled: true };
    if (busy[kind]) return { disabled: true };
    const requiresIndexed = PAPER_REQUESTS_BY_KIND[kind].requiresIndexed;
    if (requiresIndexed && !isIndexed) {
      return { disabled: true, title: requiresIndexed };
    }
    return { disabled: false };
  };

  // ── render ──────────────────────────────────────────────────────────
  const fields = bib?.fields ?? {};
  const titleText = fields.title ?? entry.title ?? "(no title)";
  const authorText = fields.author ?? (entry.authors?.join(", ") ?? "");
  const yearText = fields.year ?? (entry.year ? String(entry.year) : "");

  // Disclosure for the instructions field. `queued` is now externally polled,
  // so gating purely on it would let a background drain unmount a textarea the
  // user has the caret in — the field would vanish and focus fall back to
  // `<body>` mid-sentence. The note is the user's INTENT, not disk truth, and
  // it is attached to the next request they check (see `onToggle`), so a
  // non-empty note holds the field open on its own.
  const anyChecked = Object.values(queued).some(Boolean);
  const showInstructions = anyChecked || instructions.length > 0;

  const apaHtml = bib ? formatBibliography(bib, "apa") : undefined;

  // Compact-label threshold: measure the pod's border-box width; below ~560px the
  // `narrow` flag switches PagePicker ("p." prefix dropped) and ViewToggle
  // ("Text" vs. "Virgil Text"/"Raw Text") to their compact labels so they stay
  // legible on a tight detail panel. (The header groups are always stacked rows
  // now — a single-column grid — so `narrow` no longer drives any column layout.)
  const podRef = useRef<HTMLDivElement | null>(null);
  // `narrowMeasured` = the pod's OWN measured width < 560, used only as the
  // fallback (PDF mode / no text pod). When we pin to the text pod we derive
  // `narrow` from the TARGET width instead (below), so setting the pod's width
  // can't feed back through this observer and oscillate the compact-label flag.
  const [narrowMeasured, setNarrowMeasured] = useState(false);
  const narrowRaf = useRef<number | null>(null);
  useEffect(() => {
    const el = podRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = (w: number) => setNarrowMeasured(w < 560);
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
        if (typeof w === "number") setNarrowMeasured(w < 560);
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

  // Stacking flag: when pinned to the text pod, derive it from the TARGET width
  // (stable input) so it can't oscillate with the pin; otherwise fall back to
  // the pod's own measured width.
  const narrow = textPodRect ? textPodRect.width < 560 : narrowMeasured;

  // ── Pin the pod to the reader's text pod (change 1) ───────────────────
  // When RightDetail hands us the live text-pod geometry (TEXT mode), match the
  // header pod's width + left edge to it so the two line up — instead of the
  // header centering in the full detail width while the editor card sits offset
  // by the left panel rail. In PDF mode (textPodRect null) → centered max-width
  // fallback. RAF-coalesced + equality-gated so it never churns on a no-op
  // measure. (Pinning even when the pinned width is < 560 is fine — the groups
  // are always stacked rows regardless; `narrow` above just also flips the
  // compact labels to match the narrow text pod.)
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [podAlign, setPodAlign] = useState<{
    marginLeft: number;
    width: number;
  } | null>(null);
  const alignRaf = useRef<number | null>(null);
  useEffect(() => {
    if (!textPodRect) {
      setPodAlign(null);
      return;
    }
    const compute = () => {
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(wrap).paddingLeft) || 0;
      const marginLeft = textPodRect.left - (wr.left + padL);
      setPodAlign((prev) =>
        prev &&
        Math.abs(prev.marginLeft - marginLeft) < 0.5 &&
        Math.abs(prev.width - textPodRect.width) < 0.5
          ? prev
          : { marginLeft, width: textPodRect.width },
      );
    };
    if (alignRaf.current !== null) cancelAnimationFrame(alignRaf.current);
    alignRaf.current = requestAnimationFrame(() => {
      alignRaf.current = null;
      compute();
    });
    return () => {
      if (alignRaf.current !== null) {
        cancelAnimationFrame(alignRaf.current);
        alignRaf.current = null;
      }
    };
  }, [textPodRect]);

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

  // Build the dropdown items from the request descriptors + live
  // queued/disabled state. Order + labels come from the same table the toggle
  // dispatch and the queue-kind mapping do.
  const aiRequestItems: AiRequestItem<RequestKind>[] = PAPER_REQUESTS.map(
    ({ kind, label }) => {
      const { disabled, title } = disabledFor(kind);
      return { kind, label, checked: queued[kind], disabled, title };
    },
  );

  // Pod sizing: pinned to the reader's text pod when we have its geometry
  // (change 1), else the centered max-width default.
  const podSizing: CSSProperties = podAlign
    ? {
        width: podAlign.width,
        maxWidth: "none",
        marginLeft: podAlign.marginLeft,
        marginRight: 0,
      }
    : { width: "100%", maxWidth: 620, marginInline: "auto" };

  return (
    <div
      ref={wrapperRef}
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
          minWidth: 0,
          // Width/position: pinned to the text pod when available (change 1),
          // else a comfortable centered max-width. Stacks below 560px either way.
          ...podSizing,
        }}
      >
        {/* ROW-BASED header: bib · status · view as three stacked ROWS (was a
            3-column grid). A single-column grid stacks the groups; each group
            lays its own items out horizontally (below). */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            alignItems: "start",
            gap: 10,
            minWidth: 0,
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
              dedupeApaHeadline
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
                  fontFamily: FONT_MONO,
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
                    display: "inline-flex",
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: "0 4px",
                  }}
                >
                  <CopyIcon size={12} />
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
                    fontFamily: FONT_MONO,
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
                    fontFamily: FONT_MONO,
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
                    fontFamily: FONT_MONO,
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

          {/* ── ROW 2 — STATUS pills + AI menu (horizontal) ── */}
          <div
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
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

          {/* ── ROW 3 — VIEW controls (horizontal) ── Text/PDF toggle · pop-out
              · page-count · (PDF-mode) picker, flowing left-to-right. In TEXT
              mode the picker lives in the editor chrome band, not here. */}
          <div
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <ViewToggle
              mode={viewMode}
              onChange={onViewModeChange}
              pdfAvailable={pdfAvailable}
              indexedState={indexedState}
              narrow={narrow}
            />
            {citekey && (
              <button
                type="button"
                onClick={() => dispatchOpenLibrary({ citekey, target: "tab" })}
                title="Open this paper in a new tab"
                aria-label="Open this paper in a new tab"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  fontFamily: FONT_SANS,
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "2px 0",
                }}
              >
                <ExternalLinkIcon size={12} />
                <span>Pop out</span>
              </button>
            )}
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: "var(--muted)",
                whiteSpace: "nowrap",
              }}
            >
              {pageCountLabel}
            </span>
            {viewMode === "pdf" && pgmarkPages && (
              <PagePicker pages={pgmarkPages} narrow={narrow} />
            )}
          </div>
        </div>

        {/* Flash text — its own thin line so it never displaces the row. */}
        {flash && (
          <div
            style={{
              fontFamily: FONT_MONO,
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
        {showInstructions && (
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
                fontFamily: FONT_MONO,
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
                fontFamily: FONT_MONO,
                fontSize: 12,
                lineHeight: 1.4,
                color: "var(--foreground)",
                background: "var(--surface)",
                border: "1px solid var(--border-light)",
                borderRadius: "var(--radius-sm)",
                outline: "none",
              }}
            />
          </div>
        )}
      </div>
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
        borderRadius: "var(--radius-md)",
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
        fontFamily: FONT_SANS,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}
