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
 *  - Renders TWO sibling elements portaled to `document.body`
 *    (`position: fixed`, viewport coords) — the SAME top layer released
 *    floats (FloatingPanel) and the drop indicator use. NOT the editor
 *    column: the editor scrolls inside an `overflow-y:auto` container
 *    whose top edge sits flush under the Virgil bar (which lives OUTSIDE
 *    that container), so an overlay inside the column is geometrically
 *    clipped at that edge and can never paint over the bar at any z-index
 *    (Issue-11). A body-level fixed box escapes the clip while tracking
 *    the cursor identically (the column portal also only ever placed it at
 *    the cursor's viewport position):
 *      1. `.lifted-text-overlay` — `position: fixed`, sized to the
 *         source rect, contains the sanitized body clone.
 *      2. `.lifted-text-overlay__header` — `position: fixed`, sized
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
import { resolveInlineContextElement } from "@/lib/text-metrics";
import { FloatHeaderContent } from "./FloatHeaderContent";
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
/** Popout-mode overlay border, one side, in px (L3b.3). The overlay is
 *  `box-sizing: border-box` and gains `border: var(--pod-border)` (1px each
 *  side) in popout mode (globals.css `.lifted-text-overlay[data-lift-mode=
 *  "popout"]`); ghost mode has `border: none`. Under border-box that 1px
 *  eats into the overlay's content area where `.lifted-text-overlay__body
 *  { width: 100% }` lives, so without compensation the popout body content
 *  (and its text) is 2px narrower than the ghost's — a line one char short
 *  of wrapping in the ghost re-wraps in the popout. The popout geometry
 *  below grows the OUTER box by `2 * POPOUT_BORDER` and shifts it by
 *  `POPOUT_BORDER` so the text content lands at exactly `sourceWidth` (==
 *  ghost) while staying at the same absolute screen pixel (L1.12). Mirrors
 *  `--pod-border` width (globals.css ~51) and the released float's card
 *  border (FloatingPanel surface="card", same `--pod-border`); hardcoded
 *  like HEADER_HEIGHT / BODY_PADDING_* rather than parsed from the border
 *  shorthand at runtime. Mirrored in `TextObjectGrabHandle.tsx`. */
const POPOUT_BORDER = 1;

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
  /** View-toggle class tokens (dividers / hide-* / divider-width) applied
   *  to the overlay ROOT (`.lifted-text-overlay`), the ancestor of the
   *  `.tiptap` body. Lets the drag ghost honor the same show/hide state as
   *  the page and the released float: the toggle CSS rules are
   *  ancestor-agnostic (`.show-dividers-N .tiptap …`, `.hide-* …`, and the
   *  `.dividers-width-*` cascading vars), so carrying them on the root is
   *  all that's needed. Parent resolves them via `viewToggleClasses(menuBar)`
   *  — the ONE source the column and floats also use (Issue-12) — and pins
   *  them at threshold cross, same pattern as `label`. Empty string when
   *  there's no MenuBar (Reader / no view toggles). */
  viewToggleCls: string;
  /** Overridden ghost content (L3-Headings). When present, the clone path
   *  uses THIS element instead of `anchorDom.cloneNode(true)` — heading
   *  passes its whole-section clone here (resolved at the parent via
   *  `meta.renderGhost`, so the overlay stays kind-agnostic, same pattern
   *  as `label`). The element is sanitized in place by the same clone
   *  useMemo (contenteditable / ids / state attrs stripped, pointer-events
   *  none). Absent / null → default single-element clone. */
  ghostContent?: HTMLElement | null;
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
  viewToggleCls,
  ghostContent,
}: LiftedTextOverlayProps) {
  // Sanitize the clone once at mount. cloneNode(true) carries the full
  // subtree, whose `contenteditable` values are mixed: the source block is
  // `="true"`, but the TipTap NodeView tree also marks non-editable chrome
  // (the expex "Ex." pod, item markers, gloss labels) `="false"`. We strip
  // only the values that would make the clone EDITABLE (`"true"`/`""`/
  // `"plaintext-only"`) and KEEP `="false"` (L3d.3): a non-editable element
  // is no focus/edit risk (the overlay root is `pointer-events: none`), and
  // the editor's own white-space shield — `.tiptap [contenteditable="false"]
  // { white-space: normal }` in globals.css, mirroring prosemirror-view's
  // `.ProseMirror [contenteditable="false"]` — only fires while the
  // `="false"` marker survives. Stripping it (the pre-L3d.3 behavior) let
  // `.tiptap { white-space: break-spaces }` (L3b.2) leak into the pod,
  // widening it vs source. pointer-events: none lets the cursor pass through
  // to the editor underneath so the mode-flip predicate sees the actual
  // hit-test against the content rect.
  //
  // L3-Headings: when the parent supplied `ghostContent` (via the kind's
  // `meta.renderGhost` — heading's whole-section clone), sanitize THAT
  // instead of `anchorDom`. It's already a fresh detached element, so the
  // same in-place sanitization applies to it and its subtree (the section's
  // blocks get the same contenteditable/id/state-attr stripping — correct).
  const clone = useMemo(() => {
    const c = (ghostContent ?? anchorDom.cloneNode(true)) as HTMLElement;
    // Keep `contenteditable="false"`; strip only editable-making values.
    const stripIfEditable = (el: Element) => {
      const v = el.getAttribute("contenteditable");
      if (v !== null && v !== "false") el.removeAttribute("contenteditable");
    };
    stripIfEditable(c);
    c.querySelectorAll("[contenteditable]").forEach(stripIfEditable);
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
    // anchorDom + ghostContent identities are captured at threshold-cross
    // and stable for the gesture's lifetime; the deps are here for
    // correctness (ghostContent re-clones if the parent ever swaps it).
  }, [anchorDom, ghostContent]);

  // Capture computed typography from the source once at mount and apply
  // as inline styles on the overlay root, so the clone inherits via the
  // normal CSS cascade. cloneNode(true) copies the DOM subtree but the
  // overlay's portal mount sits outside .ProseMirror's ancestor chain
  // (it portals to document.body) — any font / color /
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
  // for raw `<p>`/`<blockquote>` etc. (L3d.2 carves out `font-size`: the
  // inherited cascade BASE is read from `anchorDom` itself, not the inline
  // element — see the in-body comment for why.)
  //
  // L3b.1 note (L4 to evaluate): with the body now carrying the `tiptap`
  // class, the `.tiptap p`/`.tiptap h2`/… rules apply to the cloned
  // elements directly and the editor sizing vars (`--editor-font-size`
  // etc.) are `:root`-global, so the scope alone reproduces this
  // typography. This inline capture may therefore be redundant; it is
  // retained here because it remains authoritative on conflict (inline
  // beats the scoped rules) and verifying full equivalence is an L4
  // cleanup concern, not this commit's. (L3d.3 resolved this question for
  // `line-height` specifically: it was not merely redundant but HARMFUL —
  // a captured LENGTH leaked oversized to non-prose descendants — so it is
  // no longer captured here; see the in-object note below.)
  const typographyStyles = useMemo<CSSProperties>(() => {
    if (typeof window === "undefined") return {};
    const inlineEl = resolveInlineContextElement(anchorDom) ?? anchorDom;
    const computed = window.getComputedStyle(inlineEl);
    // L3d.2: the cascade BASE — the font-size every relative-unit
    // descendant of the clone resolves its `em`/`%` against — must come
    // from `anchorDom` ITSELF (the block being cloned), NOT from the
    // resolved inline text element. The two diverge for any block whose
    // grid/markers inherit the editor ROOT size while its prose `<p>`
    // carries `--editor-font-size` (applied only to `.tiptap p`). For an
    // `exampleBlock`, `resolveInlineContextElement` descends to the inner
    // `<p>` (= `--editor-font-size`), but `.expex-number` /
    // `.expex-item-marker`'s `font-size: 0.95em` resolves in the SOURCE
    // against `.expex-block`'s own size (the root, e.g. 16px). Putting the
    // `<p>`'s size on the overlay root made every relative-unit marker
    // re-resolve against the wrong base — bigger when `--editor-font-size`
    // > root (an enlarged editor font: marker 0.95×20.8≈19.76px vs source
    // 15.2px), smaller when < it — then "resettle" the instant the gesture
    // released into the real popout (a true `.tiptap`/`.ProseMirror` whose
    // block inherits the root). `anchorDom`'s OWN computed font-size IS the
    // source block's cascade base, so reading it here makes EVERY
    // relative-unit descendant (the (1)/a. markers, gloss tiers, any future
    // em/%-sized label of any kind) resolve identically to the source. The
    // cloned `<p>` is unaffected: `.tiptap p` (reaching the clone since
    // L3b.1) sets its font-size explicitly, so prose still renders at
    // `--editor-font-size` regardless of the root base — and kinds whose
    // text owns an explicit rule (`.tiptap h2`, `.tiptap li`) are likewise
    // immune (measured: paragraph/heading/list visible text unchanged). The
    // remaining inherited typography stays read from the inline element
    // (L1.12's intent: the ghost's prose family/weight/spacing tracked the
    // text element, not the wrapper) — only the size BASE moves to the block.
    const baseFontSize = window.getComputedStyle(anchorDom).fontSize;
    return {
      fontFamily: computed.fontFamily,
      fontSize: baseFontSize,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      fontVariant: computed.fontVariant,
      // L3d.3: line-height is deliberately NOT captured. The L1.5 capture
      // applied the prose `<p>`'s computed line-height as a resolved LENGTH
      // (e.g. "24.32px"), which inherits VERBATIM to every clone descendant
      // regardless of its own font-size — so non-prose chrome (the expex
      // "Ex." pod, gloss labels, etc.) rendered too tall: 24.32px instead of
      // its natural `1.5 × 10.88 = 16.32px`. Omitting it lets the clone's
      // prose take its line-height from the `.tiptap p`/`h*`/`li` rules
      // (reaching the clone since L3b.1, identical to source) while non-prose
      // chrome inherits the document's unitless `1.5` and multiplies by its
      // OWN font-size — exactly the source editor's behavior. (Measured
      // unchanged: prose line-height across paragraph/heading/lists/
      // exampleBlock; pod height 28.32px → 20.32px, matching source.)
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

  // The overlay portals to document.body and positions with viewport-
  // fixed coords — the SAME layer + coordinate model released floats
  // (FloatingPanel) and the drop indicator use. This is NOT the L1 column
  // portal: the editor scrolls inside an `overflow-y:auto` container whose
  // top edge sits flush under the Virgil bar (the bar lives OUTSIDE that
  // container), so an overlay rendered inside the column is geometrically
  // CLIPPED at the container's top and can never paint over the bar at any
  // z-index (Issue-11 — measured: an absolute child of the column portal
  // at z:99999 is still clipped at the bar's bottom edge). A body-level box
  // escapes the clip. Cursor tracking is preserved: the column portal only
  // ever placed the overlay at the cursor's viewport position anyway (via
  // toPortalCoords reading the live column rect each frame), so position:
  // fixed at the raw viewport coords below lands at the identical pixel —
  // and stays glued to the cursor through scroll without a per-frame rect
  // read. See LIFTED-OVERLAY-REFACTOR.md (Issue-11).
  if (typeof document === "undefined") return null;

  // The popout-mode header bar's label arrives as a prop (L3a) — the
  // parent resolves it once at threshold cross via
  // `meta.computeLabel?.(editor, ref) ?? meta.label` so per-instance
  // overrides (heading → Chapter/Section/Subsection) match the real
  // popout's `setHeaderLabel` at handoff. The label + chevron + X are
  // rendered by the SHARED `FloatHeaderContent` (L3d.1) — the exact same
  // inner content the real popout mounts, so the label can't drift between
  // the overlay and the released popout. Handlers are omitted (visual-only)
  // and the overlay header is pointer-events:none, so the icons are inert.
  // CSS hides the header in ghost mode and fades it in when popout engages.

  // The overlay tracks the cursor (not the source) so scroll-during-
  // gesture moves the source but keeps the overlay glued under the cursor
  // — the model the user expects (the visual is "in your hand," not "in
  // the doc"). With the body-level portal + position: fixed, that's just
  // the raw viewport coords: the grab offset is already in viewport px, so
  // `cursor − grabOffset` is the text content's top-left in the viewport.
  //
  // `textCoords` is the text content's top-left (viewport coords). This is
  // the invariant across both modes (L1.12): the text never moves, chrome
  // grows outward to accommodate popout padding + header.
  const textCoords = {
    x: cursorX - grabOffsetX,
    y: cursorY - grabOffsetY,
  };

  // Overlay outer rect, mode-dependent (L1.12). In ghost mode the outer
  // box hugs the text (no chrome to make room for). In popout mode the
  // outer box grows OUTWARD by the body-padding on each axis — the
  // popout-mode body padding (set in globals.css) then insets the text
  // back to exactly `textCoords`, so the text stays at the same screen
  // pixel through the mode flip. The user only sees the chrome
  // materialize around the still text.
  // L3b.3: the popout outer box also grows by the 1px pod-border on each
  // axis (and shifts by it) so that, after the border + body-padding inset
  // under box-sizing: border-box, the body's text content lands at exactly
  // `sourceWidth × sourceHeight` (== ghost) — no ghost↔popout re-wrap. The
  // text stays at `textCoords` in both modes (L1.12): in popout the border
  // (POPOUT_BORDER) + padding (BODY_PADDING_*) inset the text back to
  // textCoords, e.g. left = (textX − 32 − 1) + 1 border + 32 padding = textX.
  const isPopout = mode === "popout";
  const overlayLeft = isPopout
    ? textCoords.x - BODY_PADDING_X - POPOUT_BORDER
    : textCoords.x;
  const overlayTop = isPopout
    ? textCoords.y - BODY_PADDING_Y - POPOUT_BORDER
    : textCoords.y;
  const overlayWidth = isPopout
    ? sourceWidth + 2 * BODY_PADDING_X + 2 * POPOUT_BORDER
    : sourceWidth;
  const overlayHeight = isPopout
    ? sourceHeight + 2 * BODY_PADDING_Y + 2 * POPOUT_BORDER
    : sourceHeight;

  // The header is a SIBLING of the overlay (both inside the same portal),
  // positioned by JS so its bottom edge aligns flush with the overlay's
  // top edge and its left/right OUTER edges coincide EXACTLY with the
  // overlay's (same left, same width). Both are box-sizing:border-box with
  // a 1px pod-border, so their left/right borders are collinear and the
  // chrome reads as one continuous box.
  //
  // Crucially this also makes the header's CONTENT box (the border+padding
  // inset where the shared `FloatHeaderContent` label sits) line up with the
  // released float's header content box, so the label does NOT shift on
  // release (Issue-6). The released `TextObjectFloat` header is a flex row
  // INSIDE the FloatCard's 1px border, so its label lands at
  // cardLeft + 1(border) + 8(padding); here the label lands at
  // overlayLeft + 1(border) + 8(padding), and overlayLeft == the released
  // card's left (both = textX − BODY_PADDING_X − POPOUT_BORDER). Equal x ⇒
  // no jump. A prior `overlayLeft − 1` / `overlayWidth + 2` (mis-described as
  // border-overlap) made the header 1px wider on each side, pushing its
  // content origin 1px left of the float's — a measured +1px label jump
  // right on release (overlay label .left 1133 vs released 1134, driven on a
  // real section/paragraph gesture); corrected here to delta 0.
  //
  // Sibling positioning replaces L1.7's `position: absolute; bottom: 100%`
  // child-of-overlay approach, which silently clipped against any
  // overflow:hidden on the overlay root — see LIFTED-OVERLAY-REFACTOR.md L1.9.
  //
  // L1.12: the header tracks the overlay OUTER (not the text rect) so
  // it sits flush above the grown popout-mode chrome, not above the
  // smaller invariant text rect. CSS still hides the header in ghost
  // mode; computing the ghost coords here is cheap and keeps the JSX
  // symmetric.
  const headerLeft = overlayLeft;
  const headerTop = overlayTop - HEADER_HEIGHT;
  const headerWidth = overlayWidth;

  return createPortal(
    <Fragment>
      <div
        className={`lifted-text-overlay${viewToggleCls ? ` ${viewToggleCls}` : ""}`}
        data-lift-mode={mode}
        data-lift-kind={ref.kind}
        style={{
          ...typographyStyles,
          position: "fixed",
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
          position: "fixed",
          left: headerLeft,
          top: headerTop,
          width: headerWidth,
          height: HEADER_HEIGHT,
        }}
        aria-hidden="true"
      >
        {/* Inner header content (label + chevron + X) is shared with the
            real popout via FloatHeaderContent — one source of truth so the
            label renders identically here and after release, with no drift
            (L3d.1). Handlers are omitted: the overlay header is
            pointer-events:none, so the icons are visual-only. */}
        <FloatHeaderContent label={label} />
      </div>
    </Fragment>,
    document.body,
  );
}
