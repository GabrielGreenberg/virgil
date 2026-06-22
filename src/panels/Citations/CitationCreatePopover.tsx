"use client";

/**
 * The citation CREATE popover — the deferred-commit front door for making a new
 * citation. It opens OVER THE TEXT at the caret (cursor auto-focused in the
 * search field, exactly like the `\ref` picker), lets the user search + STAGE
 * one or more citekeys, and materializes the real `\cite{…}` pill + gutter card
 * only on commit (the OK button, or click-away / Escape) — and ONLY if at least
 * one key was staged. Clicking away with nothing staged creates nothing, so the
 * gutter never flashes a blank pristine card mid-pick.
 *
 * Thin shell over `CitekeyPicker` (`keepOpenOnPick`): the picker owns the
 * paper-bib + library merge, fuzzy search, provenance chips, and free-text
 * commit; this component owns the staged-key state, the chips + OK footer, and
 * the commit/dismiss semantics. Subsequent edits (prenote/postnote, command
 * type, add/remove keys) happen in the gutter card at its standard position —
 * unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BibEntry } from "@/lib/types";
import { CitekeyPicker } from "./CitekeyPicker";

export interface CitationCreatePopoverProps {
  /** Caret rect captured at trigger time — the popover anchors here. */
  anchorRect: DOMRect;
  /** Paper's local references.bib entries (merged with the library inside). */
  paperBibEntries: BibEntry[];
  /** Add a library-only entry to the paper's bib (fires when such an entry is
   *  staged, mirroring the in-card picker). */
  onAddBibEntry?: (entry: BibEntry) => void;
  /** Materialize the citation from the staged citekeys (≥1). Inserts the
   *  no-scroll atom at the captured pos + registers the gutter card. */
  onCommit: (keys: string[]) => void;
  /** Tear down the popover (always called after a commit, or alone on an
   *  empty dismiss). */
  onClose: () => void;
}

export function CitationCreatePopover({
  anchorRect,
  paperBibEntries,
  onAddBibEntry,
  onCommit,
  onClose,
}: CitationCreatePopoverProps) {
  const [staged, setStaged] = useState<string[]>([]);
  // Live mirror so the STABLE dismiss callback (handed to the picker's
  // click-outside / Escape) always reads the current staged set regardless of
  // how the menu primitive captured `onClose`. Updated in an effect (never
  // during render — React Compiler `refs` rule); a commit fires on a user
  // gesture, which always runs after the effect has synced the ref.
  const stagedRef = useRef<string[]>(staged);
  useEffect(() => {
    stagedRef.current = staged;
  }, [staged]);

  const stageKey = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setStaged((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }, []);

  const removeKey = useCallback((key: string) => {
    setStaged((prev) => prev.filter((k) => k !== key));
  }, []);

  // The single commit-or-close chokepoint, shared by OK and dismiss (click-away
  // / Escape): commit iff ≥1 key was staged, then tear down. Stable identity +
  // ref-read so a stale closure can never lose the staged keys.
  const commitAndClose = useCallback(() => {
    const keys = stagedRef.current;
    if (keys.length > 0) onCommit(keys);
    onClose();
  }, [onCommit, onClose]);

  return (
    <CitekeyPicker
      open
      anchorRect={anchorRect}
      paperBibEntries={paperBibEntries}
      onSelectKey={stageKey}
      onAddBibEntry={onAddBibEntry}
      onClose={commitAndClose}
      keepOpenOnPick
      footer={
        <StagedFooter
          staged={staged}
          onRemove={removeKey}
          onOk={commitAndClose}
        />
      }
    />
  );
}

interface StagedFooterProps {
  staged: string[];
  onRemove: (key: string) => void;
  onOk: () => void;
}

/** The sticky bottom strip: staged-citekey chips (removable) + the OK button.
 *  `preventDefault` on mousedown keeps the search input focused when the user
 *  clicks a chip's × or OK, so the picker doesn't blur-close mid-interaction. */
function StagedFooter({ staged, onRemove, onOk }: StagedFooterProps) {
  return (
    <div
      className="shrink-0 border-t border-edge-subtle px-2.5 py-2 flex items-center gap-2"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex-1 min-w-0 flex flex-wrap gap-1">
        {staged.length === 0 ? (
          <span className="text-[11px] text-ink-muted">
            Pick one or more citekeys…
          </span>
        ) : (
          staged.map((key) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded bg-edge-subtle text-[11px] text-ink-body font-mono"
            >
              {key}
              <button
                type="button"
                onClick={() => onRemove(key)}
                className="text-ink-muted hover:text-ink-body leading-none"
                data-hint={`Remove ${key}`}
                aria-label={`Remove ${key}`}
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={onOk}
        className="shrink-0 px-3 py-1 rounded text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        disabled={staged.length === 0}
        data-hint="Insert citation"
        aria-label="Insert citation"
      >
        OK
      </button>
    </div>
  );
}
