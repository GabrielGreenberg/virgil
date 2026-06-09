"use client";

import type { ReactNode } from "react";
import { PopoutButton } from "@/components/panel-primitives";

/**
 * `FloatChrome` — the ONE header skeleton for every popped-out window, shared
 * by `Card` and `TextObject` floats. Promoted from the text-object
 * `FloatHeaderContent` and the card `PanelCard` popped-header branch, which are
 * both retired in its favor (the jump glyph is now drawn exactly once, here).
 *
 * Layout: grip · title · `{trailing}` · jump · close (X). Domain-neutral — it
 * imports nothing card- or text-specific. The two domain contributions ride in
 * as opaque nodes:
 *   - `titleNode` — the label-position override (e.g. the revision morph
 *     dropdown); supersedes the `title` string.
 *   - `trailing` — the narrow region before jump/close (collab pill, status
 *     dot, AI checkbox, …). For cards this is a `CardChromeTrailing` element
 *     that hosts its own `CardClaimContext`, so FloatChrome stays neutral.
 *
 * `redock` is intentionally absent — cards/text-objects never dock
 * (`canRedock=false`); panels keep their own chrome.
 */

/** The UI-chrome sans stack, mirrored verbatim from `body` so the label
 *  resolves identically wherever it mounts — honoring the user's
 *  `--font-sans-override` (the L3d.1 explicit-font fix, so no label can drift). */
const FLOAT_HEADER_FONT_FAMILY =
  'var(--font-sans-override, var(--font-sans)), "Inter", system-ui, sans-serif';

/** Decorative 6-dot grip (mirrors `CardDragHandle`). The whole header strip is
 *  the drag surface (FloatingPanel `onHeaderMouseDown`); this just signals it. */
function FloatGrip() {
  return (
    <div
      className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-ink-faint shrink-0"
      aria-hidden="true"
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </div>
  );
}

export interface FloatChromeProps {
  /** Resolved display title (`titleOverride ?? floatable.title`). */
  title: string;
  /** Label-position override (morph control); supersedes `title` when set. */
  titleNode?: ReactNode;
  /** The single domain-contributed trailing slot. */
  trailing?: ReactNode;
  /** Whether to show the jump-to-source chevron. */
  canJump: boolean;
  onJump: () => void;
  onClose: () => void;
}

export function FloatChrome({
  title,
  titleNode,
  trailing,
  canJump,
  onJump,
  onClose,
}: FloatChromeProps) {
  const labelNoun = title.toLowerCase();
  return (
    <div className="flex items-center gap-1 px-2 h-6 shrink-0 border-b border-edge-subtle bg-[var(--surface-muted-strong)]">
      <FloatGrip />
      {titleNode ?? (
        <span
          className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate"
          style={{ fontFamily: FLOAT_HEADER_FONT_FAMILY }}
        >
          {title}
        </span>
      )}
      <span className="flex-1" />
      {trailing}
      {canJump && (
        <button
          type="button"
          onClick={onJump}
          className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light"
          data-hint={`Jump to ${labelNoun}`}
          aria-label={`Jump to ${labelNoun}`}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </button>
      )}
      <PopoutButton
        isPoppedOut
        variant="x"
        labelNoun={labelNoun}
        className="iconbtn-xs"
        onClick={onClose}
      />
    </div>
  );
}
