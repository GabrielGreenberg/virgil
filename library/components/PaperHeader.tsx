"use client";

import { useEffect, useState } from "react";
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
import { StatusPills } from "./StatusPill";
import PaperAiRequestsMenu, {
  type AiRequestItem,
} from "./PaperAiRequestsMenu";

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
  const venueText = fields.journal ?? fields.booktitle ?? fields.publisher ?? "";
  const doiText = fields.doi ?? entry.doi ?? "";

  const metaSegments: string[] = [];
  if (authorText) metaSegments.push(authorText);
  if (yearText) metaSegments.push(yearText);
  if (venueText) metaSegments.push(venueText);
  if (fields.volume) metaSegments.push(`vol. ${fields.volume}`);
  if (fields.pages) metaSegments.push(`pp. ${fields.pages}`);

  const anyChecked = Object.values(queued).some(Boolean);

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
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px calc(4px + var(--pod-gap))",
        background: "var(--background)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 8,
          alignItems: "stretch",
        }}
      >
        {/* ── Left cell: formatted bibliography entry ─────────────── */}
        <div
          style={{
            background: "var(--surface)",
            border: "var(--pod-border)",
            borderRadius: "var(--pod-radius)",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <code
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--muted)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              @{bib?.type ?? "?"}{`{${citekey ?? "?"}}`}
            </code>
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse bib entry" : "Expand bib entry"}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--muted)",
                fontFamily: "var(--mono)",
                fontSize: 10,
                cursor: "pointer",
                padding: "0 4px",
                flexShrink: 0,
              }}
            >
              {expanded ? "▾ less" : "▸ more"}
            </button>
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
                  flexShrink: 0,
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
                  flexShrink: 0,
                  opacity: 0.55,
                }}
              >
                edit
              </button>
            ) : null}
          </div>
          {bib ? (
            <div
              className="library-bib-formatted"
              style={{
                fontFamily: "var(--serif)",
                fontSize: 13,
                lineHeight: 1.45,
                color: "var(--foreground)",
                wordBreak: "break-word",
              }}
              dangerouslySetInnerHTML={{ __html: formatBibliography(bib, "apa") }}
            />
          ) : (
            <div
              style={{
                fontFamily: "var(--serif)",
                fontSize: 13,
                lineHeight: 1.45,
                color: "var(--foreground)",
                wordBreak: "break-word",
              }}
            >
              <span style={{ fontWeight: 600 }}>{titleText}</span>
              {metaSegments.length > 0 && (
                <>
                  {" — "}
                  <span style={{ color: "var(--muted)" }}>{metaSegments.join(" · ")}</span>
                </>
              )}
              {doiText && (
                <>
                  {" "}
                  <span style={{ fontFamily: "var(--mono)", color: "var(--muted)" }}>doi:{doiText}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Right column: status / view toggle / AI requests / instructions ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minWidth: 0,
          }}
        >
          {/* Status pills (left) + Text / PDF toggle (right) — bare, no pod. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 22,
            }}
          >
            <StatusPills
              pdfPresent={pdfAvailable}
              indexed={entry.indexed.state}
              bib={entry.bib.state}
              bibImported={!!entry.bib.imported}
            />
            <ViewToggle
              mode={viewMode}
              onChange={onViewModeChange}
              pdfAvailable={pdfAvailable}
              indexedState={indexedState}
            />
          </div>

          {/* AI requests: a single dropdown of the five toggleable requests
           *  (replaces the inline checkbox row). Each item stays an independent
           *  toggle (multi-select); a ✓ marks queued ones and the trigger badge
           *  counts them. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              minHeight: 22,
            }}
          >
            <PaperAiRequestsMenu
              items={aiRequestItems}
              onToggle={(kind, next) => void onToggle(kind, next)}
              disabled={!handle || !citekey}
            />
            {flash && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--accent, var(--muted))",
                  marginLeft: "auto",
                }}
              >
                {flash}
              </span>
            )}
          </div>

          {/* Instructions textarea — only rendered when at least one
           *  request is checked. Text persists across toggles; whatever's
           *  here at the moment of a toggle gets sent with the queue
           *  entry's `note` field. */}
          {anyChecked && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
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

      {expanded && bib && (
        <div
          style={{
            background: "var(--surface)",
            border: "var(--pod-border)",
            borderRadius: 6,
            padding: 12,
            marginTop: 4,
          }}
        >
          <ExpandedFields entry={bib} />
        </div>
      )}
    </div>
  );
}

// ─── view toggle ─────────────────────────────────────────────────────

function ViewToggle({
  mode,
  onChange,
  pdfAvailable,
  indexedState,
}: {
  mode: "text" | "pdf";
  onChange: (m: "text" | "pdf") => void;
  pdfAvailable: boolean;
  indexedState: IndexedState;
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
        label={indexedState === "deepIndexed" ? "Virgil Text" : "Raw Text"}
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
