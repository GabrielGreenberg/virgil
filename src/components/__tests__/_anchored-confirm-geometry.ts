/**
 * Shared jsdom geometry for every test that asserts a confirm opens BESIDE its
 * anchor (task 1077).
 *
 * jsdom lays nothing out: every `getBoundingClientRect()` is all zeros. Since
 * task 1065 an anchored modal's placement is a MEASUREMENT
 * (`placeAnchoredFrame` in `system-dialog.tsx`), and a zero rect reads as
 * "wholly off-screen" (`bottom 0 <= insetTop 0`) — so the dialog correctly
 * CENTRES, and a test that only passed because the old code placed from any
 * rect goes red. The fix is the fixture, not the rule: give the anchor a real
 * on-screen box, and assert the frame's position is DERIVED from that box —
 * so the next placement refinement can't silently turn "beside the card" into
 * "somewhere fixed".
 */
import { expect } from "vitest";

/** A card-sized box well inside jsdom's default 1024×768 window. */
export const ON_SCREEN_CARD_RECT: DOMRect = {
  left: 100,
  top: 200,
  right: 400,
  bottom: 280,
  width: 300,
  height: 80,
  x: 100,
  y: 200,
  toJSON: () => ({}),
} as DOMRect;

/** Give an anchor element (a card shell) a real on-screen box. */
export function placeAnchorOnScreen(
  el: HTMLElement,
  box: DOMRect = ON_SCREEN_CARD_RECT,
): void {
  el.getBoundingClientRect = () => box;
}

/**
 * Assert a dialog frame is placed against `box` (not flex-centred in the
 * scrim): `position: fixed`, its top BELOW the anchor, and horizontally
 * within the anchor's span (jsdom frames measure 0 wide, so the placement's
 * centring lands on the anchor's midline).
 */
export function expectFrameBesideAnchor(
  frame: HTMLElement,
  box: DOMRect = ON_SCREEN_CARD_RECT,
): void {
  expect(frame.style.position).toBe("fixed");
  const top = parseFloat(frame.style.top);
  const left = parseFloat(frame.style.left);
  expect(top).toBeGreaterThan(box.bottom);
  expect(left).toBeGreaterThanOrEqual(box.left);
  expect(left).toBeLessThanOrEqual(box.right);
}
