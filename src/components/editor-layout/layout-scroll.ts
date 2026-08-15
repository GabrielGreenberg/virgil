/**
 * Scroll helpers extracted from EditorLayout.
 *
 * Under the unified row scroll (A.1+A.2), the row containing all three
 * columns is the only `overflow-y-auto`. The editor pane has no inner
 * scroll. The mirror pane (split editor) keeps its own scroll because
 * the two panes scroll independently — it's marked with
 * `data-virgil-mirror-scroll`.
 *
 * `findScrollParent` resolves the entry's nearest scrollable ancestor
 * (still used for entries inside list-mode panel scrolls).
 */

import { isFullyVisible, mayReposition } from "@/lib/reposition-policy";

/**
 * The single "this section is now current" line, expressed as a fraction of
 * the editor viewport height measured from its top. A heading/parTitle becomes
 * the active section once its top scrolls above this line.
 *
 * This is the ONE source of truth shared by the position detector
 * (`EditorLayout` section-path recompute) and the jump-to-section scroll
 * (`scrollHeadingToActiveLine`). Keeping a single constant is what guarantees
 * that clicking a section in the Outline lands it exactly where the detector
 * then reads it as current — see the OUT-#6 alignment fix. Drift between the
 * two (the old 0.25-line detector vs a `block:"center"`/0.5 scroll) is exactly
 * what made a freshly-clicked section register as the *previous* one.
 */
export const SECTION_ACTIVE_LINE_FRACTION = 0.25;

/** A few px of slack so the jumped heading lands strictly ABOVE the active
 *  line (`headingTop <= referenceY`), robust to sub-pixel `coordsAtPos`
 *  rounding. */
const SECTION_ACTIVE_LINE_SLACK_PX = 8;

export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * The unified row scroll container — resolved to the VISIBLE pane.
 *
 * Multi-doc keep-alive (default ON) renders N panes at once: the active one is
 * `display:flex`, the warm/evicted ones `display:none`. Each pane has its own
 * `[data-virgil-row-scroll]`, so a bare `querySelector` returns the FIRST in DOM
 * order — which may be a hidden pane, silently scrolling the wrong (offscreen)
 * doc on every jump (the latent multi-pane bug behind the card-jump cluster).
 *
 * A `display:none` element has `offsetParent === null`, so we prefer the first
 * rendered match — mirroring the focused→visible precedence of
 * [active-editor-probe.ts](../../lib/active-editor-probe.ts) `pickProbeEditor`.
 * The common single-pane case (≤1 match) short-circuits, which also avoids a
 * false negative if a sole pane is mid-transition.
 */
export function findRowScroll(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>("[data-virgil-row-scroll]");
  if (all.length <= 1) return all[0] ?? null;
  for (const el of all) {
    if (el.offsetParent !== null) return el;
  }
  return all[0] ?? null;
}

/** The scroll container relevant to a given ProseMirror view. Mirror
 *  panes have their own `overflow-y-auto` (marked `data-virgil-mirror-scroll`);
 *  the canonical view's scroll source is the row. */
export function findEditorScrollFor(viewDom: HTMLElement | null | undefined): HTMLElement | null {
  if (!viewDom) return findRowScroll();
  const ownScroll = viewDom.closest("[data-virgil-mirror-scroll]") as HTMLElement | null;
  if (ownScroll) return ownScroll;
  return findRowScroll();
}

/**
 * The scroll container an align gesture would actually move for `entry`.
 *
 * List-mode entries scroll their own panel ancestor; editor-anchored entries
 * route through the unified row scroll. Shared by `alignEntryToY` (which
 * moves it) and `alignEntryToYIfNeeded` (which asks whether it should),
 * because the band the necessity rule judges visibility against MUST be the
 * container the scroll would move — two different answers there is a gate
 * that reasons about a different viewport than the one it governs.
 */
export function resolveAlignScroll(entry: HTMLElement): HTMLElement | null {
  const own = findScrollParent(entry);
  const row = findRowScroll();
  const isListPanelScroll = !!own && own !== row;
  return isListPanelScroll ? own : row;
}

/** Scroll so `entry` lines up with viewport-Y `targetY`.
 *
 *  UNCONDITIONAL by design — this is the mechanism, not the policy. Every
 *  gesture-driven caller goes through `alignEntryToYIfNeeded` below (CI:
 *  `gutter-stability-census`); the only direct callers left in this module
 *  are that door and `scrollHeadingToActiveLine`, whose Outline click is a
 *  deliberate "take me there" navigation rather than an incidental
 *  reposition. */
export function alignEntryToY(entry: HTMLElement, targetY: number) {
  const scrollEl = resolveAlignScroll(entry);
  if (!scrollEl) {
    entry.scrollIntoView({ block: "nearest" });
    return;
  }
  const cardY = entry.getBoundingClientRect().top;
  const desired = scrollEl.scrollTop + (cardY - targetY);
  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  scrollEl.scrollTop = Math.max(0, Math.min(maxScroll, desired));
}

/**
 * The ONE necessity-gated align door (task 328) — "put `entry` at `targetY`,
 * but only if it isn't already where the user needs it."
 *
 * Returns whether the scroll actually happened, which callers need for more
 * than logging: a jump that also pins its omni card publishes that pin ONLY
 * on a real scroll, because the pin exists to compensate for the document
 * moving under the card. No scroll, no compensation, nothing moves at all.
 *
 * The rule itself lives in `reposition-policy`; this door only supplies the
 * two measurements it takes — the entry's own rect and the band of the
 * container that would scroll.
 */
export function alignEntryToYIfNeeded(
  entry: HTMLElement,
  targetY: number,
): boolean {
  const scrollEl = resolveAlignScroll(entry);
  const rect = entry.getBoundingClientRect();
  const band = scrollEl ? scrollEl.getBoundingClientRect() : null;
  if (mayReposition({ current: rect.top, target: targetY, rect, band }) === "hold") {
    return false;
  }
  alignEntryToY(entry, targetY);
  return true;
}

/**
 * Bring `entry` into view ONLY if it isn't fully visible already.
 *
 * The `block: "nearest"` form of `scrollEntryIntoView` is self-gating (the
 * browser no-ops when the element is already in view), but `"center"` is
 * not: it re-centres a perfectly visible element, which is the same
 * unconditional-reposition shape one API over. Callers that want the
 * centring behaviour for a genuinely off-screen target use this.
 */
export function scrollEntryIntoViewIfNeeded(
  entry: HTMLElement,
  opts?: ScrollIntoViewOptions,
): boolean {
  const scrollEl = resolveAlignScroll(entry);
  const rect = entry.getBoundingClientRect();
  const band = scrollEl ? scrollEl.getBoundingClientRect() : null;
  if (isFullyVisible(rect, band)) return false;
  entry.scrollIntoView(opts ?? { behavior: "instant", block: "nearest" });
  return true;
}

/**
 * Jump so that block element `el` (a heading or parTitle row) lands on the
 * shared section-active line of its scroll viewport. Used by the Outline's
 * click-to-jump so the destination section is immediately what the position
 * detector reports as current (OUT-#6).
 *
 * `viewDom` is the ProseMirror view's `.dom` — it selects the right scroll
 * container (row scroll for the canonical pane, the mirror's own scroll for
 * the split pane), and `alignEntryToY` re-resolves the SAME container, so the
 * target Y and the scroll math agree. Falls back to a centered native scroll
 * only when no scroll container can be found.
 */
export function scrollHeadingToActiveLine(
  viewDom: HTMLElement | null | undefined,
  el: HTMLElement,
) {
  const scrollEl = findEditorScrollFor(viewDom);
  if (!scrollEl) {
    el.scrollIntoView({ behavior: "instant", block: "center" });
    return;
  }
  const rect = scrollEl.getBoundingClientRect();
  const targetY =
    rect.top + rect.height * SECTION_ACTIVE_LINE_FRACTION - SECTION_ACTIVE_LINE_SLACK_PX;
  alignEntryToY(el, targetY);
}

/** Bring `entry` into view. Native scrollIntoView walks up to find any
 *  scrollable ancestor — works for both row-scrolled entries and
 *  list-panel internal scrolls. */
export function scrollEntryIntoView(
  entry: HTMLElement,
  opts?: ScrollIntoViewOptions,
) {
  entry.scrollIntoView(opts ?? { behavior: "instant", block: "nearest" });
}
