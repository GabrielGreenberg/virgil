"use client";

import { useEffect, useState } from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import { cancelBibReview, queueBibEdit, queueBibReview } from "@library/lib/bib-edit";
import { useBibReviewState } from "@library/hooks/useBibReviewState";
import BibCard from "./BibCard";
import BibEditModal from "./BibEditModal";
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

/** Whether a PDF source is on disk for this entry (canonical or kept as
 *  an alternate after a .docx superseded the original .pdf). */
function hasPdfSource(entry: CatalogEntry): boolean {
  if (!entry.pdf.present) return false;
  const fmt = entry.pdf.format ?? "pdf";
  if (fmt === "pdf") return true;
  return !!entry.pdf.alternates?.some((f) => f.toLowerCase().endsWith(".pdf"));
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

  const canEdit = !!(handle && bib && entry?.citekey);

  // Track whether an AI-review request is currently sitting in queue/.
  // The button reflects this (stuck-down) and clicking toggles it.
  const { queued: aiReviewQueued, setQueued: setAIReviewQueued, reload: reloadAIReview } =
    useBibReviewState(handle, entry?.citekey ?? null);

  const onEdit = canEdit ? () => setEditOpen(true) : undefined;
  const onAIReview = canEdit
    ? async (note?: string) => {
        if (!handle || !entry?.citekey) return;
        if (aiReviewQueued) {
          // Currently queued → cancel.
          const removed = await cancelBibReview(handle, entry.citekey);
          // Optimistic flip; reload settles the truth in case another
          // session already drained it (cancel returned false).
          setAIReviewQueued(removed ? false : aiReviewQueued);
          await reloadAIReview();
        } else {
          await queueBibReview(handle, entry.citekey, note);
          setAIReviewQueued(true);
        }
      }
    : undefined;

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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: 16,
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
          background: "var(--background)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <ViewToggle
          mode={viewMode}
          onChange={setViewMode}
          pdfAvailable={pdfAvailable}
        />
        <BibCard
          entry={bib ?? null}
          citekey={entry.citekey}
          onEdit={onEdit}
          onAIReview={onAIReview}
          aiReviewQueued={aiReviewQueued}
        />
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: viewMode === "text" ? "auto" : "hidden",
          padding: viewMode === "text" ? 16 : 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {viewMode === "text" ? (
          <PaperRender
            handle={handle}
            citekey={entry.citekey}
            indexedState={entry.indexed.state}
          />
        ) : (
          <PdfView handle={handle} citekey={entry.citekey} />
        )}
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

interface ViewToggleProps {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
  pdfAvailable: boolean;
}

function ViewToggle({ mode, onChange, pdfAvailable }: ViewToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Document view"
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        border: "1px solid var(--border-light)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <ToggleButton
        active={mode === "text"}
        onClick={() => onChange("text")}
        label="Text view"
      />
      <ToggleButton
        active={mode === "pdf"}
        onClick={() => onChange("pdf")}
        label="PDF view"
        disabled={!pdfAvailable}
        disabledTitle="No PDF on disk for this paper"
      />
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  disabledTitle?: string;
}

function ToggleButton({ active, onClick, label, disabled, disabledTitle }: ToggleButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: disabled
          ? "var(--muted)"
          : active
            ? "white"
            : "var(--foreground)",
        border: "none",
        padding: "5px 12px",
        fontSize: 12,
        fontFamily: "var(--sans, inherit)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {label}
    </button>
  );
}
