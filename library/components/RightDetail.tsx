"use client";

import { useEffect, useState } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import { queueBibEdit } from "@library/lib/bib-edit";
import { usePaperViewMode } from "@library/lib/view-session-store";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
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
  /** View-session scope + panel — threaded into PaperRender so the reader
   *  scroll persists under (scope, panel, paper:<citekey>). */
  scope: string;
  panel: PanelKey;
}

type ViewMode = "text" | "pdf";

/** Whether a PDF source is on disk for this entry (canonical or kept as
 *  an alternate after a .docx superseded the original .pdf). */
function hasPdfSource(entry: CatalogEntry): boolean {
  if (!entry.pdf.present) return false;
  const fmt = entry.pdf.format ?? "pdf";
  if (fmt === "pdf") return true;
  return !!entry.pdf.alternates?.some((f) => f.toLowerCase().endsWith(".pdf"));
}

export default function RightDetail({
  handle,
  entry,
  bib,
  onBibChanged,
  scope,
  panel,
}: Props) {
  // View mode is persisted per-paper under the same `paper:<citekey>` slice
  // the reader scroll uses — so each source remembers Text vs PDF across
  // reloads AND intra-session paper switches. A paper never toggled defaults
  // to "text". `entry` can be null (empty-selection placeholder below); use a
  // stable sentinel libId so the hook order stays constant — it's read only
  // when a real paper is selected.
  const viewModeLibId = `paper:${entry?.citekey ?? "__none__"}`;
  const { viewMode, setViewMode } = usePaperViewMode(scope, panel, viewModeLibId);
  const [editOpen, setEditOpen] = useState(false);

  // Close the edit modal when the user navigates to a different paper. The
  // view mode itself is NOT force-reset here — it's persisted per-paper now,
  // so each source restores its own posture. The only place we coerce the
  // mode is when the persisted choice is genuinely unavailable for THIS paper
  // (e.g. a DOCX-only source that can't show "pdf"); see the `pdfOnDisk`
  // coercion effect below.
  useEffect(() => {
    setEditOpen(false);
  }, [entry?.citekey]);

  // Coerce the mode to "text" ONLY when the persisted/current choice is "pdf"
  // but no PDF is on disk for this paper (e.g. a DOCX-only source) — otherwise
  // the toggle would land on a disabled PDF view. This replaces the old
  // unconditional reset-to-text on every paper switch. Computed from `entry`
  // directly (not the post-early-return `pdfAvailable`) so the hook runs in a
  // stable order; a null entry has no PDF, but the coercion is moot then since
  // the mode isn't rendered.
  const pdfOnDisk = !!entry && hasPdfSource(entry);
  useEffect(() => {
    if (viewMode === "pdf" && !pdfOnDisk) setViewMode("text");
  }, [viewMode, pdfOnDisk, setViewMode]);

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

  // `entry` is non-null past the early return, so this equals `pdfOnDisk`.
  const pdfAvailable = pdfOnDisk;

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
          indexedState={entry.indexed.state}
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

  // Text mode: header above the editor area; the panel/editor
  // boundary uses the canonical `PanelColumn` drag-gap inside
  // `EditorPane` — Reader inherits the same affordance as the main
  // editor.
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
        indexedState={entry.indexed.state}
        onEdit={canEdit ? () => setEditOpen(true) : undefined}
      />
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
          scope={scope}
          panel={panel}
        />
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
