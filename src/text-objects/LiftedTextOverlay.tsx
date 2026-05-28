"use client";

/**
 * LiftedTextOverlay — the portal-rendered ghost that follows the cursor
 * during a TextObject lift gesture (L1 of the Lifted-Overlay refactor;
 * see LIFTED-OVERLAY-REFACTOR.md at repo root).
 *
 * Wired only for `paragraph` in L1 (via `meta.liftMode === "lifted-overlay"`);
 * the other 15 kinds stay on instant-popout until L3 generalizes.
 *
 * Shape:
 *  - Renders as `position: absolute` inside `[data-lifted-overlay-portal]`,
 *    which lives at column level (sibling of the pod) inside the editor
 *    column — same architectural slot as the grab-handle portal, so the
 *    overlay escapes the pod's `clipPath` and scrolls with the row.
 *  - Body content is a sanitized `cloneNode(true)` of `anchorDom`, with
 *    `contenteditable` stripped recursively and `pointer-events: none`
 *    so the live cursor underneath stays in control of hit-testing
 *    (containsContentZone) during the gesture.
 *  - Width/height pinned to the source's rendered rect (captured once
 *    at threshold-cross by the parent — the overlay never reads it
 *    again). Mode flips via `data-lift-mode`, CSS handles the chrome
 *    diff (see `.lifted-text-overlay` in globals.css).
 *
 * The component is dumb: the parent (TextObjectGrabHandle) drives
 * cursor coords + mode through prop updates. The cloneNode happens
 * once at mount via useMemo; only the inline `top`/`left`/`data-lift-mode`
 * change per frame.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { EditorViewportCache } from "@/hooks/useEditorViewportCache";
import type { TextObjectRef } from "./types";

export interface LiftedTextOverlayProps {
  /** The ref the gesture is lifting. Informational — the overlay
   *  doesn't dispatch by kind, but having it lets future per-kind
   *  chrome tweaks live next to the registry rather than in CSS. */
  ref: TextObjectRef;
  /** The source block element whose visual the overlay clones. Captured
   *  once at threshold-cross; the overlay re-clones if this prop
   *  identity changes (it normally won't during a gesture). */
  anchorDom: HTMLElement;
  /** User's grab point as an offset from the source rect's top-left,
   *  in viewport pixels. The overlay positions itself such that the
   *  cursor lands at exactly this offset within the clone — preserving
   *  the spot the user clicked. */
  grabOffsetX: number;
  grabOffsetY: number;
  /** Pinned width/height of the overlay — matches the source's rendered
   *  rect at threshold-cross. The overlay never re-reads the source. */
  sourceWidth: number;
  sourceHeight: number;
  /** Current cursor position in viewport coords. Parent updates every
   *  mousemove (RAF-coalesced upstream of the overlay isn't required —
   *  React's diff handles a single-attribute re-render). */
  cursorX: number;
  cursorY: number;
  /** Current chrome mode. Parent flips this based on
   *  `cache.containsContentZone(cursor)` — true → ghost, false → popout. */
  mode: "ghost" | "popout";
  /** Viewport cache used for `toPortalCoords` (viewport → portal-relative)
   *  and for resolving the column-level portal target. */
  cache: EditorViewportCache;
}

export function LiftedTextOverlay({
  ref,
  anchorDom,
  grabOffsetX,
  grabOffsetY,
  sourceWidth,
  sourceHeight,
  cursorX,
  cursorY,
  mode,
  cache,
}: LiftedTextOverlayProps) {
  // Sanitize the clone once at mount. cloneNode(true) carries the full
  // subtree including any nested contenteditable=true (the source block
  // itself, plus its descendants in the TipTap NodeView tree) — we
  // strip recursively. pointer-events: none lets the cursor pass through
  // to the editor underneath so the mode-flip predicate sees the actual
  // hit-test against the content rect.
  const clone = useMemo(() => {
    const c = anchorDom.cloneNode(true) as HTMLElement;
    c.removeAttribute("contenteditable");
    c.querySelectorAll("[contenteditable]").forEach((el) =>
      el.removeAttribute("contenteditable"),
    );
    // Strip ids on the clone so they don't collide with the live source
    // (which is still mounted under the editor). data-uuid attrs are
    // harmless — the hover resolver hit-tests through pointer-events:none
    // on the overlay root, so the clone's data-uuid never matches.
    c.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    c.removeAttribute("id");
    c.style.pointerEvents = "none";
    return c;
    // anchorDom identity is captured at threshold-cross and stable for
    // the gesture's lifetime; the dep is here for correctness.
  }, [anchorDom]);

  // Capture computed typography from the source once at mount and apply
  // as inline styles on the overlay root, so the clone inherits via the
  // normal CSS cascade. cloneNode(true) copies the DOM subtree but the
  // overlay's portal mount sits outside .ProseMirror's ancestor chain
  // (it lives at column level, sibling of the pod) — any font / color /
  // spacing rule defined at or below .ProseMirror would otherwise be
  // lost, and the clone would reflow at a different width than the
  // source. Holding the computed values for the gesture's lifetime is
  // safe because they're stable: the source isn't restyled mid-drag.
  const typographyStyles = useMemo<CSSProperties>(() => {
    if (typeof window === "undefined") return {};
    const computed = window.getComputedStyle(anchorDom);
    return {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      fontVariant: computed.fontVariant,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      color: computed.color,
      textAlign: computed.textAlign as CSSProperties["textAlign"],
      textIndent: computed.textIndent,
      textTransform: computed.textTransform as CSSProperties["textTransform"],
      fontFeatureSettings: computed.fontFeatureSettings,
    };
  }, [anchorDom]);

  // The clone is an HTMLElement, not a React tree — attach it directly
  // via ref callback rather than dangerouslySetInnerHTML (which would
  // re-serialize and lose the live computed styles inherited via the
  // wrapper's class chain).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;
    if (!host.contains(clone)) {
      // Clear any prior clone (defensive — useMemo replaces `clone`
      // identity only on anchorDom change).
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(clone);
    }
  }, [clone]);

  // Resolve the portal target from the cache's column element. Falls
  // back to document.body if the column / portal div haven't mounted
  // yet — same defensive pattern as the grab handle.
  if (typeof document === "undefined") return null;
  const portal =
    (cache.paperEl?.querySelector(
      "[data-lifted-overlay-portal]",
    ) as HTMLElement | null) ?? null;

  // Convert viewport coords to portal-relative. The overlay tracks the
  // cursor (not the source) so scroll-during-gesture moves the source
  // but keeps the overlay glued under the cursor — the model the user
  // expects (the visual is "in your hand," not "in the doc").
  const portalCoords = cache.toPortalCoords(
    cursorX - grabOffsetX,
    cursorY - grabOffsetY,
  );

  return createPortal(
    <div
      className="lifted-text-overlay"
      data-lift-mode={mode}
      data-lift-kind={ref.kind}
      style={{
        ...typographyStyles,
        position: "absolute",
        left: portalCoords.x,
        top: portalCoords.y,
        width: sourceWidth,
        height: sourceHeight,
      }}
      aria-hidden="true"
    >
      <div ref={bodyRef} className="lifted-text-overlay__body" />
    </div>,
    portal ?? document.body,
  );
}
