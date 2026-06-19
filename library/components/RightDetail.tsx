"use client";

import { useEffect, useState } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import { queueBibEdit } from "@library/lib/bib-edit";
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
  const [viewMode, setViewMode] = useState<ViewMode>("text");
  const [editOpen, setEditOpen] = useState(false);

  // Reset to text view when the selection changes — otherwise switching
  // from a PDF-having paper to a DOCX-only one would land on a disabled
  // PDF view. Also close the edit modal if the user navigates away.
  useEffect(() => {
    setViewMode("text");
    setEditOpen(false);
  }, [entry?.citekey]);

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
