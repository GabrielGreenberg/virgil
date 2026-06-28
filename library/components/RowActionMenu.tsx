"use client";

import RowMenu, { type RowMenuEntry } from "./RowMenu";

interface Props {
  /** Disabled when the entry has no citekey (e.g. an unsorted triage row).
   *  All actions key off citekey so they can't run on triage rows. */
  disabled?: boolean;
  /** Label for the destructive item — "Delete…" or "Remove from library". */
  deleteLabel: string;
  onDelete: () => void;
  onBibReview: () => void;
  onTextReview: () => void;
  onImportBib: () => void;
}

/**
 * The catalog paper-row overflow menu. A thin declarative wrapper over the
 * shared `RowMenu` primitive (F#5/F#7) — keeps this component's public API
 * stable for `LeftListRow` callers while sharing one trigger/positioning/
 * escape/outside-click implementation with the rail pods.
 */
export default function RowActionMenu({
  disabled = false,
  deleteLabel,
  onDelete,
  onBibReview,
  onTextReview,
  onImportBib,
}: Props) {
  const items: RowMenuEntry[] = [
    { key: "bib-review", label: "AI bib review", onSelect: onBibReview },
    { key: "text-review", label: "AI text review", onSelect: onTextReview },
    { key: "import-bib", label: "Import bibliography", onSelect: onImportBib },
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
