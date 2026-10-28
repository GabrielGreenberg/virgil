<!-- last-verified: 6b0fbf8e 2026-10-28 -->
<!-- derives-from: AGENTS.md#laws -->

# Scroll-anchor stability

> **An overlay anchored to document content must not re-solve its position per scroll frame.** It must be either (a) **pod/host-relative** — living inside the scroll container so it moves with content by layout, with NO scroll listener (`top = elementRect.top − hostRect.top`); or (b) a **RAF-coalesced fixed portal** — `position:fixed`, recomputing `top` at most once per animation frame behind an equality bail (`placementsEqual` / `prev.top === next.top`). Never a raw `coordsAtPos`/`getBoundingClientRect` re-solve inside an `addEventListener('scroll')` / `onScroll` handler — that jitters and lags per frame.

This is the "card/overlay position recomputes and JUMPS on scroll" class (task 041/042). Two guards enforce it:

- **Runtime probe** — `window.__scrollRepositionStats()` ([src/lib/scroll-reposition-probe.ts](../../../src/lib/scroll-reposition-probe.ts)) reports per-portal `{ total, commitsThisScroll, distinctTopsThisScroll }`. On a pure scroll a stable portal reports **≤1 distinct top/frame**; a jittery one reports **>1**. The RAF-coalesced fixed portals (`SelectionActionsMenu`, `PendingChangePill`, `SlashCommandPopup`, `useFloatingMenuPosition`) each record one placement per coalesced frame.
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
