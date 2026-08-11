"use client";

import { memo, type ReactNode } from "react";
import { IconX } from "./panel-icons";
import { FONT_MONO } from "@/lib/font-stacks";

/**
 * Inline (inactive) tab label rendered as flat clickable text in the Virgil
 * bar. Used for every outer tab that isn't the currently-active item —
 * those keep the full DocumentFolderTab silhouette.
 *
 * `variant` defaults to "tight" (pl-2 pr-2): used by paper/library/doc
 * tabs whose active counterpart applies negative margins to keep text and
 * neighbors pixel-stable across activation. The Library root tab passes
 * "library-pinned" instead (pl-[26px] pr-[26px]) — Library can't shift
 * its silhouette leftward (it's the leftmost item), so the inline label
 * pre-reserves the swoop+inner-padding space, matching the folder
 * geometry exactly.
 *
 * Omitting `onClose` hides the × button (used by the Library root tab,
 * which is permanent and can't be closed).
 *
 * Perf: this component is `memo`'d, and the per-tab call-site arrows have
 * been removed. The owner threads the tab's stable `id` plus the
 * `onActivate(id)`/`onClose(id)` handlers (which are already useCallback-
 * stable in useFiles); the component calls them internally with the LIVE
 * id, so a reordered strip still activates/closes the right tab. With
 * stable props the leaf skips re-render on unrelated paneState ticks.
 */
export type InlineTabLabelProps = {
  /** Stable identity passed back to onActivate/onClose. */
  id: string;
  icon?: ReactNode;
  label: string;
  title: string;
  monospace?: boolean;
  variant?: "tight" | "library-pinned";
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
};

function InlineTabLabelImpl({
  id,
  icon,
  label,
  title,
  monospace,
  variant = "tight",
  onActivate,
  onClose,
}: InlineTabLabelProps) {
  const padding =
    variant === "library-pinned" ? "pl-[26px] pr-[26px]" : "pl-2 pr-2";
  // Hover lozenge hugs the content with ~8px breathing room on each
  // side. The tight variant's wrapper already sits at content + 8px,
  // so `inset-x-0` is correct. The library-pinned wrapper carries 26px
  // of padding (to keep the inline footprint stable with the active
  // Library folder silhouette), so the lozenge insets 18px to land at
  // the same content + 8px feel.
  const hoverBgInsetX =
    variant === "library-pinned" ? "inset-x-[18px]" : "inset-x-0";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onActivate(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(id);
        }
      }}
      data-hint={title}
      className={`group relative flex items-center gap-1.5 ${padding} h-[24px] cursor-default shrink-0`} aria-label={title}
    >
      <div
        aria-hidden
        className={`absolute inset-y-0 rounded transition-colors group-hover:bg-black/5 ${hoverBgInsetX}`}
      />
      {icon ? <span className="relative inline-flex">{icon}</span> : null}
      <span
        className="relative text-[13px] leading-4 truncate max-w-[220px]"
        style={monospace ? { fontFamily: FONT_MONO } : undefined}
      >
        {label}
      </span>
      {onClose ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose(id);
          }}
          className="relative topbarbtn topbarbtn-icon opacity-40 group-hover:opacity-100 hover:!opacity-100 transition-opacity"
          data-hint="Close tab"
        >
          <IconX />
        </button>
      ) : null}
    </div>
  );
}

export const InlineTabLabel = memo(InlineTabLabelImpl);
