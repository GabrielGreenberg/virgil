"use client";

/**
 * Canonical contract for "open a Virgil Library entry" from anywhere in the
 * paper UI — bibliography cards, citation cards, and any future surface that
 * references a library citekey.
 *
 * A window `CustomEvent` is the decoupling seam: deeply-nested cards dispatch
 * it without importing the layout / `useFiles` internals. EditorLayout's
 * library bridge (`src/components/editor-layout/event-bridges/library.ts`)
 * is the single listener that routes by `target`:
 *
 *   - `target: "tab"`     → `openPaperTab(citekey)` — opens the entry's paper
 *                           as a NEW outer Virgil-bar tab (`PaperOuterView`),
 *                           "as if opened from the library tab".
 *   - `target: "library"` → reveal inside the singleton Library tab (the
 *                           legacy switch-and-select behaviour).
 *
 * This module replaces the dead `BibLibraryChip.tsx`, which owned the same
 * event name but was never wired to a live dispatcher.
 */

import { useCallback } from "react";
import { ExternalLinkIcon } from "@/components/icons/ExternalLinkIcon";

export const OPEN_LIBRARY_EVENT = "virgil-open-library";

export type OpenLibraryTarget = "tab" | "library";

export interface OpenLibraryEventDetail {
  citekey?: string;
  itemId?: string;
  /** Defaults to `"library"` for back-compat with the legacy reveal path. */
  target?: OpenLibraryTarget;
}

export function dispatchOpenLibrary(detail: OpenLibraryEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenLibraryEventDetail>(OPEN_LIBRARY_EVENT, { detail }),
  );
}

/** Stable opener callbacks for the two open targets. Reusable by any card. */
export function useOpenLibraryEntry() {
  const openInTab = useCallback((citekey: string, itemId?: string) => {
    dispatchOpenLibrary({ citekey, itemId, target: "tab" });
  }, []);
  const revealInLibrary = useCallback((citekey: string, itemId?: string) => {
    dispatchOpenLibrary({ citekey, itemId, target: "library" });
  }, []);
  return { openInTab, revealInLibrary };
}

/**
 * The shared "Open" affordance — an external-link button that opens the
 * referenced library entry in a new Virgil-bar paper tab. Used by the
 * bibliography card's status layer and (modularly) by citation cards.
 */
export function OpenEntryLink({
  citekey,
  label = "Open",
  className,
}: {
  citekey: string;
  label?: string;
  className?: string;
}) {
  const { openInTab } = useOpenLibraryEntry();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openInTab(citekey);
      }}
      draggable={false}
      onDragStart={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      data-hint="Open entry in a new tab"
      aria-label={`Open ${citekey} in a new tab`}
      className={
        className ??
        "inline-flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink-body transition-colors"
      }
    >
      <ExternalLinkIcon size={11} />
      <span>{label}</span>
    </button>
  );
}
