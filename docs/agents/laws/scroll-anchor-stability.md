<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Scroll-anchor stability

> **An overlay anchored to document content must not re-solve its position per scroll frame.** It must be either (a) **pod/host-relative** — living inside the scroll container so it moves with content by layout, with NO scroll listener (`top = elementRect.top − hostRect.top`); or (b) a **RAF-coalesced fixed portal** — `position:fixed`, recomputing `top` at most once per animation frame behind an equality bail (`placementsEqual` / `prev.top === next.top`). Never a raw `coordsAtPos`/`getBoundingClientRect` re-solve inside an `addEventListener('scroll')` / `onScroll` handler — that jitters and lags per frame.

This is the "card/overlay position recomputes and JUMPS on scroll" class (task 041/042). Two guards enforce it:

- **Runtime probe** — `window.__scrollRepositionStats()` ([src/lib/scroll-reposition-probe.ts](../../../src/lib/scroll-reposition-probe.ts)) reports per-portal `{ total, commitsThisScroll, distinctTopsThisScroll }`. On a pure scroll a stable portal reports **≤1 distinct top/frame**; a jittery one reports **>1**. The RAF-coalesced fixed portals (`SelectionActionsMenu`, `PendingChangePill`, `SlashCommandPopup`, `useFloatingMenuPosition`) each record one placement per coalesced frame.
- **Grep-allowlist test** — [src/lib/\_\_tests\_\_/scroll-reposition-guardrail.test.ts](../../../src/lib/__tests__/scroll-reposition-guardrail.test.ts) greps `src/` AND `library/` for the risky conjunction (a `position:fixed` overlay that measures via `coordsAtPos`/`getBoundingClientRect` and listens to `scroll`) and asserts every such site is on the silo's allowlist (`PERMITTED_SCROLL_REPOSITIONERS`; the library twin is deliberately empty). **Anything added to an allowlist needs a one-line comment explaining why it's stable** (pod-relative / RAF+equality-bail / hides-on-scroll) — same discipline as the keystroke-sanctity permitted-subscriber list above. A new naive per-scroll-frame re-solve fails CI.

## The menu half (task 747)

A portaled `<MenuProvider>` is shape (b) by construction — but only if it is handed something to re-read. A rect captured at open is a frozen anchor: the menu stays where its trigger WAS. Every portaled menu therefore passes `trackAnchor`, built from [src/components/menu/live-anchor.ts](../../../src/components/menu/live-anchor.ts) (`elementAnchor` for a DOM trigger, `caretAnchor` for a document position, `nodeAnchor` for an inline atom); a thunk returning `null` falls back to the open-time rect. `portal={false}` menus move with their host by layout and are exempt; a menu whose parent re-derives its rect every frame (the lightning menu) is allowlisted with that reason.

CI: `menu-live-anchor-census.test.ts` (census + allowlist-only-shrinks), `menu-live-anchor.test.tsx` (real consumers follow a moved anchor on scroll).
