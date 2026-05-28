"use client";

/**
 * LiftedTextOverlay — the portal-rendered ghost that follows the cursor
 * during a TextObject lift gesture (L1 of the Lifted-Overlay refactor;
 * see LIFTED-OVERLAY-REFACTOR.md at repo root).
 *
 * Wired for `paragraph` (L1) and `heading` (L3a) via
 * `meta.liftMode === "lifted-overlay"`; the remaining 14 kinds stay on
 * instant-popout until subsequent L3 commits flip them. The header
 * label arrives as the `label` prop — the parent (TextObjectGrabHandle)
 * resolves it once at threshold cross via
 * `meta.computeLabel?.(editor, ref) ?? meta.label`, so per-instance
 * overrides (heading → "Chapter" / "Section" / "Subsection") land on
 * the overlay's popout-mode chrome with no per-kind logic here.
 *
 * Shape:
 *  - Renders TWO sibling elements inside `[data-lifted-overlay-portal]`
 *    (column-level inside the editor column — same architectural slot
 *    as the grab-handle portal, escapes the pod's clipPath, scrolls
 *    with the row):
 *      1. `.lifted-text-overlay` — `position: absolute`, sized to the
 *         source rect, contains the sanitized body clone.
 *      2. `.lifted-text-overlay__header` — `position: absolute`, sized
 *         independently by JS to sit flush above the overlay's top edge
 *         (left, top, width all inline). Both elements carry
 *         `data-lift-mode`; CSS hides the header in ghost mode.
 *    The sibling layout (L1.9) replaces L1.7's child-of-overlay header
 *    with `bottom: 100%` — that version was silently clipped by any
 *    overflow:hidden on the overlay root, which is exactly what
 *    Turbopack's stale bundler kept serving after L1.8's source-side
 *    overflow move.
 *  - Body content is a sanitized `cloneNode(true)` of `anchorDom`, with
 *    `contenteditable` stripped recursively and `pointer-events: none`
 *    so the live cursor underneath stays in control of hit-testing
 *    (containsContentZone) during the gesture. The body wrapper carries
 *    the `tiptap` class (L3b.1) so the editor's content-scoped rules
 *    reach the clone even though the portal lives outside `.tiptap`'s
 *    ancestor chain — list markers (`.tiptap ul/ol`), nested-list
 *    spacing (`.tiptap li > ul`), blockquote borders, and any future
 *    content-scoped styling. This is the descendant-rule counterpart to
 *    L1.5's typography capture, which only carries INHERITED properties
 *    and so could never restore `list-style` (set on the `<ul>` itself).
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

import { Fragment, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { EditorViewportCache } from "@/hooks/useEditorViewportCache";
import { resolveInlineContextElement } from "@/lib/text-metrics";
import type { TextObjectRef } from "./types";

/** Popout chrome dimensions. Mirror the real popout's chrome so the
 *  overlay's outer rect in popout mode and the `popOutAtRect` spawn rect
 *  produce a body-content rect that lands at exactly the ghost's text
 *  rect (L1.12 — text content stays still, chrome grows outward).
 *  HEADER_HEIGHT matches `.lifted-text-overlay__header` `height` in
 *  globals.css and `TextObjectFloat.tsx`'s header `h-6`. BODY_PADDING_X/Y
 *  match `.lifted-text-overlay__body[data-lift-mode="popout"]` padding
 *  and `paragraph-body.tsx`'s `px-8 py-4`. The header is rendered as a
 *  portal sibling of the overlay (L1.9 — the prior bottom:100%
 *  positioning silently clipped the header any time the overlay root
 *  carried overflow:hidden, even briefly via a stale Turbopack chunk).
 *  Sibling positioning takes the overlay's box out of the equation
 *  entirely; JS owns the header geometry. Mirrored in
 *  `TextObjectGrabHandle.tsx` (release-handoff spawn coords) and CSS
 *  (body popout-padding rule); L4 may centralize via the registry. */
const HEADER_HEIGHT = 24;
const BODY_PADDING_X = 32;
const BODY_PADDING_Y = 16;

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
  /** Header label for popout-mode chrome. Parent resolves this once at
   *  threshold cross via `meta.computeLabel?.(editor, ref) ?? meta.label`
   *  (L3a) so per-level / per-variant overrides (heading → "Chapter" /
   *  "Section" / "Subsection") match what the real popout's
   *  `setHeaderLabel` will push on release. The overlay no longer reads
   *  `meta.label` directly — keeping the resolution at the parent means
   *  any kind that grows a `computeLabel` slot gets the correct popout-
   *  mode header without touching the overlay. */
  label: string;
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
  label,
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
    // State-dependent attributes that drive visible chrome from globals.css
    // (linkedAnchor highlight tints, card-anchor outlines, etc.). These are
    // meaningful in the LIVE editor but the cloned ghost should be a clean
    // visual snapshot — the overlay's own chrome (ghost/popout) is the only
    // chrome the user should see during the gesture.
    const STATE_ATTRS_TO_STRIP = [
      "data-link-highlight",
      "data-tint-color",
      "data-card-hovered",
      "data-card-selected",
      "data-paragraph-kind",
    ];
    for (const attr of STATE_ATTRS_TO_STRIP) {
      if (c.hasAttribute(attr)) c.removeAttribute(attr);
      c.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    }
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
  //
  // L1.12: read computed styles from the resolved inline-context element
  // (e.g. the inner `<p>` inside `.par-title-wrapper`) rather than the
  // wrapper itself. The wrapper's font properties don't match the inner
  // text element's (paragraph styling lives on `.ProseMirror p`), which
  // produced a subtly larger / wider-spaced ghost in L1.10/L1.11. The
  // `?? anchorDom` fallback covers unrecognized wrapper shapes — safe
  // since `resolveInlineContextElement` already falls back internally
  // for raw `<p>`/`<blockquote>` etc.
  //
  // L3b.1 note (L4 to evaluate): with the body now carrying the `tiptap`
  // class, the `.tiptap p`/`.tiptap h2`/… rules apply to the cloned
  // elements directly and the editor sizing vars (`--editor-font-size`
  // etc.) are `:root`-global, so the scope alone reproduces this
  // typography. This inline capture may therefore be redundant; it is
  // retained here because it remains authoritative on conflict (inline
  // beats the scoped rules) and verifying full equivalence is an L4
  // cleanup concern, not this commit's.
  const typographyStyles = useMemo<CSSProperties>(() => {
    if (typeof window === "undefined") return {};
    const inlineEl = resolveInlineContextElement(anchorDom) ?? anchorDom;
    const computed = window.getComputedStyle(inlineEl);
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

  // The popout-mode header bar's label arrives as a prop (L3a) — the
  // parent resolves it once at threshold cross via
  // `meta.computeLabel?.(editor, ref) ?? meta.label` so per-instance
  // overrides (heading → Chapter/Section/Subsection) match the real
  // popout's `setHeaderLabel` at handoff. The chevron + X icons are
  // visual mimicry of TextObjectFloat.tsx:93-125; the overlay has
  // pointer-events: none so they aren't interactive. CSS hides the
  // header in ghost mode and fades it in when popout mode engages.

  // Convert viewport coords to portal-relative. The overlay tracks the
  // cursor (not the source) so scroll-during-gesture moves the source
  // but keeps the overlay glued under the cursor — the model the user
  // expects (the visual is "in your hand," not "in the doc").
  //
  // `textCoords` is the text content's top-left in portal coords. This
  // is the invariant across both modes (L1.12): the text never moves,
  // chrome grows outward to accommodate popout padding + header.
  const textCoords = cache.toPortalCoords(
    cursorX - grabOffsetX,
    cursorY - grabOffsetY,
  );

  // Overlay outer rect, mode-dependent (L1.12). In ghost mode the outer
  // box hugs the text (no chrome to make room for). In popout mode the
  // outer box grows OUTWARD by the body-padding on each axis — the
  // popout-mode body padding (set in globals.css) then insets the text
  // back to exactly `textCoords`, so the text stays at the same screen
  // pixel through the mode flip. The user only sees the chrome
  // materialize around the still text.
  const isPopout = mode === "popout";
  const overlayLeft = isPopout ? textCoords.x - BODY_PADDING_X : textCoords.x;
  const overlayTop = isPopout ? textCoords.y - BODY_PADDING_Y : textCoords.y;
  const overlayWidth = isPopout
    ? sourceWidth + 2 * BODY_PADDING_X
    : sourceWidth;
  const overlayHeight = isPopout
    ? sourceHeight + 2 * BODY_PADDING_Y
    : sourceHeight;

  // The header is a SIBLING of the overlay (both inside the same portal),
  // positioned by JS so its bottom edge aligns flush with the overlay's
  // top edge and its left/right edges align with the overlay's outer
  // border (the −1 / +2 covers the 1px border on each side in popout
  // mode, so the chrome reads as one continuous box). Sibling positioning
  // replaces L1.7's `position: absolute; bottom: 100%` child-of-overlay
  // approach, which silently clipped against any overflow:hidden on the
  // overlay root — see LIFTED-OVERLAY-REFACTOR.md L1.9.
  //
  // L1.12: the header tracks the overlay OUTER (not the text rect) so
  // it sits flush above the grown popout-mode chrome, not above the
  // smaller invariant text rect. CSS still hides the header in ghost
  // mode; computing the ghost coords here is cheap and keeps the JSX
  // symmetric.
  const headerLeft = overlayLeft - 1;
  const headerTop = overlayTop - HEADER_HEIGHT;
  const headerWidth = overlayWidth + 2;

  return createPortal(
    <Fragment>
      <div
        className="lifted-text-overlay"
        data-lift-mode={mode}
        data-lift-kind={ref.kind}
        style={{
          ...typographyStyles,
          position: "absolute",
          left: overlayLeft,
          top: overlayTop,
          width: overlayWidth,
          height: overlayHeight,
        }}
        aria-hidden="true"
      >
        {/* L3b.1: `tiptap` re-establishes the editor's content scope on
            the clone (see JSDoc). Deliberately NO neutralization overrides:
            the bare `.tiptap {}` rule is only `outline: none` + font/color/
            tab-size — no padding/min-height/caret — so it can't disturb the
            overlay geometry, and L1.11's popout body padding (0,3,0) still
            outweighs `.tiptap` (0,1,0). Add a dedicated inner wrapper only
            if a future `.tiptap {}` root property starts conflicting. */}
        <div ref={bodyRef} className="lifted-text-overlay__body tiptap" />
      </div>
      <div
        className="lifted-text-overlay__header"
        data-lift-mode={mode}
        data-lift-kind={ref.kind}
        style={{
          position: "absolute",
          left: headerLeft,
          top: headerTop,
          width: headerWidth,
          height: HEADER_HEIGHT,
        }}
        aria-hidden="true"
      >
        <span className="lifted-text-overlay__label">{label}</span>
        <span className="lifted-text-overlay__header-spacer" />
        <span className="lifted-text-overlay__icon">
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
        </span>
        <span className="lifted-text-overlay__icon">
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </span>
      </div>
    </Fragment>,
    portal ?? document.body,
  );
}
