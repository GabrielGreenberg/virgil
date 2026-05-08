"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import { queueBibEdit } from "@library/lib/bib-edit";
import BibEditModal from "./BibEditModal";
import PaperHeader from "./PaperHeader";
import PaperRender from "./PaperRender";
import PdfView from "./PdfView";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  entry: CatalogEntry | null;
  bib: BibEntry | undefined;
  /** Reload master.bib after a save lands. */
  onBibChanged?: () => void;
}

type ViewMode = "text" | "pdf";

const LEFT_MARGIN_KEY = "virgil-paper-left-margin";
const RIGHT_MARGIN_KEY = "virgil-paper-right-margin";
const DEFAULT_MARGIN = 24;
const MIN_CONTENT = 320;
// Header content aligns with the editor pod's edges, not the outer scroll
// container — so we inset by the page-strip column on the left and the
// scrollbar gutter on the right.
const HEADER_LEFT_INSET = 26;  // PageScrollStrip width (24) + 2px gap.
const HEADER_RIGHT_INSET = 6;  // Scrollbar width inside the scroll container.

/** Whether a PDF source is on disk for this entry (canonical or kept as
 *  an alternate after a .docx superseded the original .pdf). */
function hasPdfSource(entry: CatalogEntry): boolean {
  if (!entry.pdf.present) return false;
  const fmt = entry.pdf.format ?? "pdf";
  if (fmt === "pdf") return true;
  return !!entry.pdf.alternates?.some((f) => f.toLowerCase().endsWith(".pdf"));
}

function readSavedMargin(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return DEFAULT_MARGIN;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return DEFAULT_MARGIN;
    return n;
  } catch {
    return DEFAULT_MARGIN;
  }
}

export default function RightDetail({ handle, entry, bib, onBibChanged }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("text");
  const [editOpen, setEditOpen] = useState(false);

  // Reset to text view when the selection changes — otherwise switching
  // from a PDF-having paper to a DOCX-only one would land on a disabled
  // PDF view. Also close the edit modal if the user navigates away.
  useEffect(() => {
    setViewMode("text");
    setEditOpen(false);
  }, [entry?.citekey]);

  // ── Resizable left/right margins ───────────────────────────────────
  // Two independent drag handles set the editor column's left and right
  // margins. The handles ARE the margins (cursor: col-resize on the
  // empty side strips). Persisted to localStorage so layout survives
  // reloads.
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [leftMargin, setLeftMargin] = useState<number>(DEFAULT_MARGIN);
  const [rightMargin, setRightMargin] = useState<number>(DEFAULT_MARGIN);
  useEffect(() => {
    setLeftMargin(readSavedMargin(LEFT_MARGIN_KEY));
    setRightMargin(readSavedMargin(RIGHT_MARGIN_KEY));
  }, []);

  const startResize = useCallback(
    (side: "left" | "right") => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startLeft = leftMargin;
      const startRight = rightMargin;
      const panelWidth = outerRef.current?.getBoundingClientRect().width
        ?? window.innerWidth;
      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        if (side === "left") {
          // Dragging the left handle right grows the left margin.
          const maxLeft = Math.max(0, panelWidth - startRight - MIN_CONTENT);
          const next = Math.max(0, Math.min(maxLeft, startLeft + delta));
          setLeftMargin(next);
        } else {
          // Dragging the right handle left grows the right margin.
          const maxRight = Math.max(0, panelWidth - startLeft - MIN_CONTENT);
          const next = Math.max(0, Math.min(maxRight, startRight - delta));
          setRightMargin(next);
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          if (side === "left") {
            setLeftMargin((w) => {
              try { localStorage.setItem(LEFT_MARGIN_KEY, String(Math.round(w))); } catch { /* ignore */ }
              return w;
            });
          } else {
            setRightMargin((w) => {
              try { localStorage.setItem(RIGHT_MARGIN_KEY, String(Math.round(w))); } catch { /* ignore */ }
              return w;
            });
          }
        } catch { /* ignore */ }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [leftMargin, rightMargin],
  );

  const canEdit = !!(handle && bib && entry?.citekey);

  if (!entry) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontStyle: "italic",
          background: "var(--background)",
        }}
      >
        Select a paper from the list.
      </div>
    );
  }

  const pdfAvailable = hasPdfSource(entry);

  if (viewMode === "pdf") {
    // PDF mode: full-width layout, no drag handles.
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          background: "var(--background)",
        }}
      >
        <PaperHeader
          handle={handle}
          entry={entry}
          bib={bib}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          pdfAvailable={pdfAvailable}
          onEdit={canEdit ? () => setEditOpen(true) : undefined}
        />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <PdfView handle={handle} citekey={entry.citekey} />
        </div>
        {editOpen && bib && handle && entry.citekey && (
          <BibEditModal
            entry={bib}
            onClose={() => setEditOpen(false)}
            onSave={async (type, fields) => {
              await queueBibEdit(handle, entry.citekey!, { type, fields });
              onBibChanged?.();
            }}
          />
        )}
      </div>
    );
  }

  // Text mode: header + editor share a constrained column with
  // independently draggable left/right edges.
  return (
    <div
      ref={outerRef}
      style={{
        display: "flex",
        height: "100%",
        minHeight: 0,
        background: "var(--background)",
      }}
    >
      <ResizeHandle width={leftMargin} side="left" onPointerDown={startResize("left")} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            paddingLeft: HEADER_LEFT_INSET,
            paddingRight: HEADER_RIGHT_INSET,
          }}
        >
          <PaperHeader
            handle={handle}
            entry={entry}
            bib={bib}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            pdfAvailable={pdfAvailable}
            onEdit={canEdit ? () => setEditOpen(true) : undefined}
          />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <PaperRender
            handle={handle}
            citekey={entry.citekey}
            indexedState={entry.indexed.state}
          />
        </div>
      </div>
      <ResizeHandle width={rightMargin} side="right" onPointerDown={startResize("right")} />
      {editOpen && bib && handle && entry.citekey && (
        <BibEditModal
          entry={bib}
          onClose={() => setEditOpen(false)}
          onSave={async (type, fields) => {
            await queueBibEdit(handle, entry.citekey!, { type, fields });
            onBibChanged?.();
          }}
        />
      )}
    </div>
  );
}

function ResizeHandle({
  width,
  side,
  onPointerDown,
}: {
  width: number;
  side: "left" | "right";
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Resize left margin" : "Resize right margin"}
      onPointerDown={onPointerDown}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
      style={{
        width,
        flexShrink: 0,
        cursor: "col-resize",
        background: "transparent",
        transition: "background 120ms",
        touchAction: "none",
      }}
    />
  );
}
