"use client";

import RowMenu, { type RowMenuEntry } from "./RowMenu";
import { PAPER_REQUESTS_BY_KIND } from "@library/lib/paper-ai-requests";

interface Props {
  /** Disabled when the entry has no citekey (e.g. an unsorted triage row).
   *  All actions key off citekey so they can't run on triage rows. */
  disabled?: boolean;
  /** Label for the destructive item — "Delete…" or "Remove from library". */
  deleteLabel: string;
  onDelete: () => void;
  onBibReview: () => void;
  onDocReview: () => void;
  onImportBib: () => void;
}

/**
 * The catalog paper-row overflow menu. A thin declarative wrapper over the
 * shared `RowMenu` primitive (F#5/F#7) — keeps this component's public API
 * stable for `LeftListRow` callers while sharing one trigger/positioning/
 * escape/outside-click implementation with the rail pods.
 *
 * The three request labels are READ from `PAPER_REQUESTS_BY_KIND` — the paper
 * header's AI-requests menu declares the same actions, and the two had drifted
 * into two vocabularies ("AI text review" vs "Doc review", task 1382).
 */
export default function RowActionMenu({
  disabled = false,
  deleteLabel,
  onDelete,
  onBibReview,
  onDocReview,
  onImportBib,
}: Props) {
  const items: RowMenuEntry[] = [
    { key: "bib-review", label: PAPER_REQUESTS_BY_KIND.bib.label, onSelect: onBibReview },
    { key: "doc-review", label: PAPER_REQUESTS_BY_KIND.doc.label, onSelect: onDocReview },
    { key: "import-bib", label: PAPER_REQUESTS_BY_KIND.importbib.label, onSelect: onImportBib },
    { key: "div", divider: true },
    { key: "delete", label: deleteLabel, onSelect: onDelete, destructive: true },
  ];
  return (
    <RowMenu
      items={items}
      disabled={disabled}
      ariaLabel="Row actions"
      title={disabled ? "Triage this entry first" : "Actions"}
      minWidth={160}
    />
  );
}
