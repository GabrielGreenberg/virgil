"use client";

import { memo, type ReactNode } from "react";
import { activatableProps } from "@/lib/activatable-props";
import { IconX } from "./panel-icons";
import { FONT_MONO } from "@/lib/font-stacks";
import {
  TAB_LABEL_MAX_PX,
} from "@/components/chrome/folder-tab-geometry";
import {
  INACTIVE_TAB_LABEL_STYLE,
  TAB_LABEL_ATTRS,
} from "@/components/chrome/tab-strip-occupancy";
import { describedHint, iconHint } from "@/components/Hint";

/**
 * Inline (inactive) tab label rendered as flat clickable text in the Virgil
 * bar. Used for every outer tab that isn't the currently-active item, which is
 * the same box filled in as a lozenge (ActiveBarTab), so activating a tab
 * leaves its text where it was.
 *
 * Omitting `onClose` hides the × button (used by the Library root tab,
 * which is permanent and can't be closed).
 *
 * COMPRESSION (task 561): the strip's occupancy ladder
 * (src/components/chrome/tab-strip-occupancy.ts) squeezes inactive tabs
 * first. This component is the block-level child of a flexible wrapper in
 * `TabStrip`, so it takes the wrapper's width, and its LABEL is the part that
 * yields — `truncate` (overflow hidden + ellipsis) with the shared floor as
 * its `min-width`, so the tab's automatic flex minimum is its fixed chrome
 * (padding, icon, close) plus that floor. Everything else here is `shrink-0`
 * or fixed. The label also carries `TAB_LABEL_ATTRS`, which is how the bar's
 * occupancy rule recovers the row's NATURAL width from a compressed one.
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
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
};

function InlineTabLabelImpl({
  id,
  icon,
  label,
  title,
  monospace,
  onActivate,
  onClose,
}: InlineTabLabelProps) {
  return (
    <div
      // A tab is a CONTAINER (its close is a nested `<button>`, which the HTML
      // content model forbids inside a `<button>`), so it takes the ONE
      // spelling of the `button` role rather than re-deriving it (task 536).
      // The helper's target guard is what keeps Enter on the CLOSE button
      // from also ACTIVATING the tab by bubbling.
      {...activatableProps(() => onActivate(id))}
      {...describedHint(title)}
      // Named by its VISIBLE label — spelled out because the nested close
      // button would otherwise join the name computed from content; the
      // tooltip (often the fuller path) is the description (task 609).
      aria-label={label}
      className="group relative flex items-center gap-1.5 pl-2 pr-2 h-6 cursor-default focus-ring"
    >
      <div
        aria-hidden
        className="absolute inset-0 rounded-md transition-colors group-hover:bg-black/5"
      />
      {icon ? <span className="relative inline-flex">{icon}</span> : null}
      <span
        {...TAB_LABEL_ATTRS}
        className="relative text-sm leading-4 truncate"
        style={{
          // The bar-wide label cap (task 395) — shared with the ACTIVE tab's
          // label so the two renderers of one tab can't disagree about
          // how wide a name may get.
          maxWidth: TAB_LABEL_MAX_PX,
          // …and the compression FLOOR (task 561): under a squeeze the label
          // ellipsizes down to this and no further; past it the strip scrolls.
          ...INACTIVE_TAB_LABEL_STYLE,
          ...(monospace ? { fontFamily: FONT_MONO } : null),
        }}
      >
        {label}
      </span>
      {onClose ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose(id);
          }}
          className="relative topbarbtn topbarbtn-icon opacity-40 group-hover:opacity-100 hover:!opacity-100"
          {...iconHint({ label: "Close tab" })}
        >
          <IconX />
        </button>
      ) : null}
    </div>
  );
}

export const InlineTabLabel = memo(InlineTabLabelImpl);
