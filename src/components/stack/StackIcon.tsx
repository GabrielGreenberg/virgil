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
 * resolved from the terminal registry at the GESTURE (`getStackTerminal()`).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStackDropTarget, setStackIconRect } from "@/lib/stack/stack-drop-target";
import {
  parkDuringLayoutGesture,
  useLayoutGestureActive,
} from "@/lib/pane-resize";
import { LAYOUT_SITE_STACK_ICON } from "@/lib/layout-gesture-probe";

export interface StackIconProps {
  open: boolean;
  onToggle: () => void;
}

/** Module-constant so `useLayoutGestureActive`'s snapshot memo keys on one
 *  stable value (it keys on the joined KINDS, so a fresh literal per render is
 *  merely wasteful rather than wrong — this makes it neither). */
const CONTENT_GESTURE = ["content"] as const;

const ICON_DIAMETER = 56;
export const STACK_INSET_LEFT = 12;
export const STACK_INSET_BOTTOM = 12;

export function StackIcon({ open, onToggle }: StackIconProps) {
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
  // drag costs two renders of a 56px button. Kind-filtered to `content` —
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
      const top = h - STACK_INSET_BOTTOM - ICON_DIAMETER;
      setStackIconRect(owner, {
        left,
        top,
        right: left + ICON_DIAMETER,
        bottom: top + ICON_DIAMETER,
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
  // Idle: warm mid-tone pod surface — darker than card chrome so the
  // icon reads as a discrete affordance against the canvas.
  // Open: a touch darker still.
  // Hover: subtle bump toward the darker end.
  // Illuminated (drag target): accent-blue ring, same family as
  // DockOutline + drop-mode indicator.
  // Resting bg: paper-light. Hover/open warm slightly. The outline
  // carries the contrast against the canvas: a warm mid-grey (the tone
  // we used for the previous resting fill).
  const ringColor =
    "color-mix(in srgb, var(--pod-dark, #eae6df) 88%, #000 12%)";
  const bg = illuminated
    ? "var(--accent-light, #f5f0ea)"
    : open
      ? "var(--pod-dark, #eae6df)"
      : hover && !contentDragActive
        ? "var(--pod-toolbar, #f5f3ef)"
        : "var(--surface, #ffffff)";
  const borderColor = illuminated ? "var(--accent-blue, #2563eb)" : ringColor;
  const borderWidth = illuminated ? 2 : 1;
  const boxShadow = illuminated
    ? "0 0 0 4px rgba(37, 99, 235, 0.18), var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))"
    : "var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))";

  return createPortal(
    <button
      ref={ref}
      type="button"
      aria-label="Stack"
      aria-pressed={open}
      data-stack-icon-hit="true"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "fixed",
        left: STACK_INSET_LEFT,
        bottom: STACK_INSET_BOTTOM,
        width: ICON_DIAMETER,
        height: ICON_DIAMETER,
        borderRadius: "50%",
        background: bg,
        border: `${borderWidth}px solid ${borderColor}`,
        boxShadow,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
        padding: 0,
        transition:
          "background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out",
      }}
    >
      <StackGlyph illuminated={illuminated} />
    </button>,
    document.body,
  );
}

/** Three stacked square pages, leaning up-and-to-the-right. Each rect
 *  is 16×16 with a 3px stagger per axis so the layers are clearly
 *  legible at 30px. Stroke + fill come from design tokens. */
function StackGlyph({ illuminated }: { illuminated: boolean }) {
  // Stroke matches the muted ink used by L-strip icons — readable
  // against the warm-tinted button background without going to harsh
  // black. Fill stays paper-white so each page reads as a discrete
  // sheet.
  const stroke = illuminated ? "var(--accent-blue, #2563eb)" : "var(--virgil-bar-text, #78716c)";
  const fill = illuminated
    ? "color-mix(in srgb, var(--accent-blue, #2563eb) 8%, var(--surface, #ffffff))"
    : "var(--surface, #ffffff)";
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
    >
      {/* Bottom-back page (lower-left) */}
      <rect
        x="3"
        y="10"
        width="16"
        height="16"
        rx="2"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      {/* Middle page */}
      <rect
        x="6"
        y="7"
        width="16"
        height="16"
        rx="2"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      {/* Top page (upper-right) */}
      <rect
        x="9"
        y="4"
        width="16"
        height="16"
        rx="2"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
    </svg>
  );
}
