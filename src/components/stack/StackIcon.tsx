"use client";

/**
 * StackIcon — always-visible round button at the bottom-left of the
 * viewport. Click toggles the StackStrip. Drag-over by an in-flight
 * capture gesture — a FloatingPanel move or a content lift, both of them
 * in-app pointer sessions — illuminates the ring blue. There is no HTML5
 * drop door here: every Stack producer is an in-app gesture (task 590).
 *
 * Pinned via `position: fixed; bottom; left` — viewport-anchored, never
 * follows page scroll. Visual style reads from Virgil design tokens so
 * the icon belongs to the same material family as floating cards.
 *
 * MOUNTED ONCE, by `StackChromeHost` (task 589) — never per `EditorPane`. It
 * portals to `document.body`, which escapes the keep-alive wrapper's
 * `display:none`, so a per-pane mount put one identical button per warm pane at
 * the same fixed spot and let an evicted pane's teardown erase the one global
 * icon rect. It therefore takes NO per-doc props: the doc that owns a capture is
 * the pane whose own gesture produced it — a float drag or a content lift both
 * run inside their pane and capture through that pane's refs.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { STACK_CHROME_Z } from "@/floats/float-policy";
import { FONT_SANS } from "@/lib/font-stacks";
import { useStackDropTarget, setStackIconRect } from "@/lib/stack/stack-drop-target";
import {
  parkDuringLayoutGesture,
  useLayoutGestureActive,
} from "@/lib/pane-resize";
import { LAYOUT_SITE_STACK_ICON } from "@/lib/layout-gesture-probe";

export interface StackIconProps {
  open: boolean;
  onToggle: () => void;
  /** Receives the button, so the strip's dismiss door can EXCLUDE it (task
   *  862): a press on the icon toggles, never close-then-reopen. */
  hitRef?: RefObject<HTMLButtonElement | null>;
}

/** Module-constant so `useLayoutGestureActive`'s snapshot memo keys on one
 *  stable value (it keys on the joined KINDS, so a fresh literal per render is
 *  merely wasteful rather than wrong — this makes it neither). */
const CONTENT_GESTURE = ["content"] as const;

export const STACK_ICON_WIDTH = 76;
export const STACK_ICON_HEIGHT = 32;
export const STACK_INSET_LEFT = 8;
export const STACK_INSET_BOTTOM = 8;

export function StackIcon({ open, onToggle, hitRef }: StackIconProps) {
  const [hover, setHover] = useState(false);
  const stackTarget = useStackDropTarget();
  // Task 456 — WHAT THE HOVER OFFERS IS WHAT THE COMMIT ACCEPTS, applied to
  // this icon's own chrome. The lift overlay is `pointer-events: none` (the
  // content-drag click-through law), so during a content drag the button still
  // receives `mouseenter` and painted its ordinary hover darken — which reads
  // as a drop affordance and was, for the lift gesture, the ONLY signal the
  // icon gave (Gabriel: "It darkens on mouse over, but when you let go, the
  // text dragged just pops out"). Wiring the lift's real ring is half the fix;
  // the other half is that during a content drag the DARKEN stops speaking, so
  // a drag whose payload the Stack cannot take offers nothing at all.
  //
  // Edge-only: the bus publishes begin/end edges, never per frame, so a whole
  // drag costs two renders of one button. Kind-filtered to `content` —
  // a pane-divider drag or an OS window resize moves nothing over this icon,
  // and suppressing hover for them would be a decision nobody made.
  const contentDragActive = useLayoutGestureActive(CONTENT_GESTURE);
  const ref = useRef<HTMLButtonElement | null>(null);
  // Identity of THIS icon in the module-level rect slot. Since task 589 the
  // chrome is mounted once (`StackChromeHost`), so there is only ever one — but
  // the slot is owner-checked anyway, because "my cleanup erases the global
  // value" is exactly the defect this task retired, and an unowned `null` on
  // teardown is one re-introduced second mount away from killing capture again.
  const rectOwner = useRef<object>({});

  // Publish the icon's viewport rect for the FloatingPanel hit-test.
  // Viewport-anchored, so the rect only changes on resize.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const owner = rectOwner.current;
    const update = () => {
      const h = window.innerHeight;
      const left = STACK_INSET_LEFT;
      const top = h - STACK_INSET_BOTTOM - STACK_ICON_HEIGHT;
      setStackIconRect(owner, {
        left,
        top,
        right: left + STACK_ICON_WIDTH,
        bottom: top + STACK_ICON_HEIGHT,
      });
    };
    update();
    // Parked (task 317): the icon is bottom-left-anchored and its published
    // rect is only read by the FloatingPanel hit-test, which cannot fire
    // mid-gesture (an OS window drag delivers no pointer events to the page).
    const park = parkDuringLayoutGesture(update, LAYOUT_SITE_STACK_ICON);
    const onResize = () => park.fire();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      park.dispose();
      setStackIconRect(owner, null);
    };
  }, []);

  if (typeof document === "undefined") return null;

  const illuminated = stackTarget;

  // ── Color resolution from Virgil design tokens ─────────────────────
  // Idle: the gutter's own ground, opaque, so it reads as text on the
  // manila and still covers whatever scrolls under it.
  // Hover and open: the same ground, one and two steps darker.
  // Illuminated (drag target): accent-blue ring, same family as
  // DockOutline + drop-mode indicator.
  const bg = illuminated
    ? "var(--accent-light)"
    : open
      ? "color-mix(in srgb, var(--background) 90%, #000)"
      : hover && !contentDragActive
        ? "color-mix(in srgb, var(--background) 95%, #000)"
        : "var(--background)";
  const borderColor = illuminated ? "var(--accent-blue)" : "transparent";
  const borderWidth = illuminated ? 2 : 1;
  const boxShadow = illuminated
    ? "0 0 0 4px color-mix(in srgb, var(--accent-blue) 18%, transparent)"
    : "none";

  return createPortal(
    <button
      ref={(el) => {
        ref.current = el;
        if (hitRef) hitRef.current = el;
      }}
      type="button"
      // The outline member of the focus door: the drag halo below owns
      // `box-shadow` inline, which would beat the ring.
      className="focus-outline"
      aria-pressed={open}
      data-stack-icon-hit="true"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "fixed",
        left: STACK_INSET_LEFT,
        bottom: STACK_INSET_BOTTOM,
        width: STACK_ICON_WIDTH,
        height: STACK_ICON_HEIGHT,
        borderRadius: "var(--radius-md)",
        background: bg,
        border: `${borderWidth}px solid ${borderColor}`,
        boxShadow,
        color: illuminated ? "var(--accent-blue)" : "var(--virgil-bar-text)",
        fontFamily: FONT_SANS,
        fontSize: 12,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        zIndex: STACK_CHROME_Z,
        padding: 0,
        transition:
          "background-color var(--motion-fast) ease-out, border-color var(--motion-fast) ease-out, box-shadow var(--motion-fast) ease-out",
      }}
    >
      <StackGlyph />
      Stack
    </button>,
    document.body,
  );
}

/** Two stacked pages, drawn in the button's own ink. */
function StackGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="2.5" width="8.5" height="8.5" rx="2" />
      <path d="M11 13.5H4.5a2 2 0 0 1-2-2V5" />
    </svg>
  );
}
