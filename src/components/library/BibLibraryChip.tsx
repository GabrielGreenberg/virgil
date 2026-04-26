"use client";

/**
 * Small status chip rendered inside a BibEntry card header when the
 * Bibliography panel has library info for that citekey. Clicking the
 * chip dispatches a window-level custom event that EditorLayout listens
 * for and routes to the Library tab for the current document.
 */

import type { LibraryItemStatus } from "@/lib/library/library-types";

export type BibLibraryChipKind =
  /** Item present in library and ready. */
  | { kind: "ready"; itemId: string }
  /** Item present but Cowork is still processing it. */
  | { kind: "processing"; itemId: string; status: LibraryItemStatus }
  /** Item present but Cowork failed to process. */
  | { kind: "failed"; itemId: string }
  /** No library item has this citekey. */
  | { kind: "missing" };

interface Props {
  citekey: string;
  info: BibLibraryChipKind;
}

export const OPEN_LIBRARY_EVENT = "virgil-open-library";

export interface OpenLibraryEventDetail {
  citekey?: string;
  itemId?: string;
}

function dispatchOpen(detail: OpenLibraryEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenLibraryEventDetail>(OPEN_LIBRARY_EVENT, { detail }),
  );
}

export function BibLibraryChip({ citekey, info }: Props) {
  const common = "text-[10px] px-1.5 py-[1px] rounded border transition-colors";
  if (info.kind === "ready") {
    return (
      <button
        type="button"
        onClick={() => dispatchOpen({ citekey, itemId: info.itemId })}
        title="Open in library"
        className={`${common} bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100`}
      >
        ✓ library
      </button>
    );
  }
  if (info.kind === "processing") {
    return (
      <button
        type="button"
        onClick={() => dispatchOpen({ citekey, itemId: info.itemId })}
        title={`Processing: ${info.status}`}
        className={`${common} bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100`}
      >
        ⋯ processing
      </button>
    );
  }
  if (info.kind === "failed") {
    return (
      <button
        type="button"
        onClick={() => dispatchOpen({ citekey, itemId: info.itemId })}
        title="Processing failed"
        className={`${common} bg-red-50 text-red-700 border-red-200 hover:bg-red-100`}
      >
        ! failed
      </button>
    );
  }
  // missing
  return (
    <button
      type="button"
      onClick={() => dispatchOpen({ citekey })}
      title="Not in library — open to add"
      className={`${common} bg-stone-50 text-ink-muted border-edge-hover hover-on-dark`}
    >
      — no PDF
    </button>
  );
}
