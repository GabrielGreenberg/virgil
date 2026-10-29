<!-- last-verified: 6b0fbf8e 2026-10-28 -->
<!-- derives-from: AGENTS.md#laws -->

# Scroll-anchor stability

> **An overlay anchored to document content must not re-solve its position per scroll frame.** It must be either (a) **pod/host-relative** — living inside the scroll container so it moves with content by layout, with NO scroll listener (`top = elementRect.top − hostRect.top`); or (b) a **RAF-coalesced fixed portal** — `position:fixed`, recomputing `top` at most once per animation frame behind an equality bail (`placementsEqual` / `prev.top === next.top`). Never a raw `coordsAtPos`/`getBoundingClientRect` re-solve inside an `addEventListener('scroll')` / `onScroll` handler — that jitters and lags per frame.

This is the "card/overlay position recomputes and JUMPS on scroll" class (task 041/042). Two guards enforce it:

- **Runtime probe** — `window.__scrollRepositionStats()` ([src/lib/scroll-reposition-probe.ts](../../../src/lib/scroll-reposition-probe.ts)) reports per-portal `{ total, commitsThisScroll, distinctTopsThisScroll }`. On a pure scroll a stable portal reports **≤1 distinct top/frame**; a jittery one reports **>1**. The RAF-coalesced fixed portals (`PendingChangePill`, `SlashCommandPopup`, `useFloatingMenuPosition`) each record one placement per coalesced frame; `SelectionActionsMenu` still records per placement pass, which a scroll no longer triggers (see "The resting-bolt half").
- **Grep-allowlist test** — [src/lib/\_\_tests\_\_/scroll-reposition-guardrail.test.ts](../../../src/lib/__tests__/scroll-reposition-guardrail.test.ts) greps `src/` AND `library/` for the risky conjunction (a `position:fixed` overlay that measures via `coordsAtPos`/`getBoundingClientRect` and listens to `scroll`) and asserts every such site is on the silo's allowlist (`PERMITTED_SCROLL_REPOSITIONERS`; the library twin is deliberately empty). **Anything added to an allowlist needs a one-line comment explaining why it's stable** (pod-relative / RAF+equality-bail / hides-on-scroll) — same discipline as the keystroke-sanctity permitted-subscriber list above. A new naive per-scroll-frame re-solve fails CI.

## The menu half (task 747)

A portaled `<MenuProvider>` is shape (b) by construction — but only if it is handed something to re-read. A rect captured at open is a frozen anchor: the menu stays where its trigger WAS. Every portaled menu therefore passes `trackAnchor`, built from [src/components/menu/live-anchor.ts](../../../src/components/menu/live-anchor.ts) (`elementAnchor` for a DOM trigger, `caretAnchor` for a document position, `nodeAnchor` for an inline atom); a thunk returning `null` falls back to the open-time rect. `portal={false}` menus move with their host by layout and are exempt; a menu whose parent re-derives its rect every frame (the lightning menu) is allowlisted with that reason.

CI: `menu-live-anchor-census.test.ts` (census + allowlist-only-shrinks), `menu-live-anchor.test.tsx` (real consumers follow a moved anchor on scroll).

## The selection-alignment half (task 1179)

Selecting a card from the document (margin marker, in-text anchor, footnote /
citation atom) aligns the card with the click through ONE door,
`placeSelectedCard` ([selected-card-placement.ts](../../../src/components/editor-layout/selected-card-placement.ts)).
Both of its strategies are case (a): the Omni pin is anchor-relative inside the
pod, and the native-list slide is a one-shot `scrollTop` delta plus transient
spacer padding on the list's OWN scroller — the card then moves with its list by
layout. Nothing listens to `scroll`: release is driven by user INTENT events
(wheel / touchmove / scroll keys / scrollbar press), the doc store's DESELECT
(selecting another card continues the slide), a childList change on the card's ancestor path (re-sort / filter), and a
zero-height ResizeObserver delivery (hidden). It reads two rects per gesture,
in the frame after the selection commits, and never the document. It is the
reposition policy's one named exception (`intent: "selection-alignment"` in
`reposition-policy.ts`) — never a bypass. CI: `selected-card-placement.test.ts`,
`selection-halo-census.test.ts`, `gutter-stability-census.test.ts`.

## The resting-bolt half (task 1355)

The resting ⚡ bolt was a shape-(b) fixed portal that took the third, forbidden road: it HID for every scroll (a 120 ms scroll-idle suppression) and re-seated after — so momentum scrolling read as "the bolt vanishes and flickers back". A text-anchored trigger that cannot keep up with its line is not stabilised by hiding it; it is moved into the scroll container. The bolt now portals into the column-level `[data-grab-handle-portal]` host (its left-side twin `TextObjectGrabHandle`'s host), `position:absolute` in `toPortalCoords` coordinates, with no scroll listener, no scroll-band gate and no top clamp — it rides its line rigidly, scrolls under the sticky pod caps and out of view with it. Its z is `IN_SCROLL_MARGIN_TRIGGER_Z` (20, the grab handle's tier): under the caps, and therefore below panels and floats (BUG #50 by construction). Hiding survives only where the column itself REFLOWS — a press-drag and a layout gesture (which also covers a content drag's auto-scroll). The OPEN menu stays a fixed `<Menu>` (shape (b), `trackAnchor`), and its off-screen close moved into that live read, since `placement` no longer hears scrolls. CI: `SelectionActionsMenu-placement-decouple.test.tsx` (mounted mid-scroll, portal coords, in-scroll host, off-band close), `scroll-reposition-guardrail.test.ts` (allowlist entry removed), `float-policy.test.ts` (tier pin). Residual: `PendingChangePill` is still shape (b) and gesture-hidden — the next member of this class.
