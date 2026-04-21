/**
 * Scroll helpers extracted from EditorLayout.
 *
 * Scroll a panel entry so its top aligns with the given viewport Y.
 * Walks up from the entry to find its nearest scrollable ancestor, then:
 *   1. Resets any previously-applied alignment padding.
 *   2. Adjusts scrollTop so the entry's top matches targetY.
 *   3. If the required scroll goes past either end of the scroll range,
 *      adds temporary top/bottom padding on the scroll container to make
 *      up the difference (so e.g. the first card can still be pushed
 *      down to match a citation near the bottom of the viewport).
 * The padding is marked with a data attribute so repeat clicks reset it
 * before re-measuring.
 */
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

// In in-text view the panel's scroll is yoked to the editor's via
// useInTextPositions. Mark the panel during programmatic scrolls so the
// panel→editor half of that sync sees the flag and skips — otherwise
// aligning a card would drag the main text along with it.
export function suppressReverseSync(scrollEl: HTMLElement) {
  scrollEl.dataset.virgilSuppressReverseSync = "1";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      delete scrollEl.dataset.virgilSuppressReverseSync;
    });
  });
}

export function alignEntryToY(entry: HTMLElement, targetY: number) {
  // Find the nearest ancestor whose overflow-y is auto or scroll. We pick
  // the *declared* scroll container, not the nearest one that currently
  // overflows — the content may fit before we add alignment padding, but
  // the container is still where we need to scroll.
  const scrollEl = findScrollParent(entry);
  if (!scrollEl) {
    entry.scrollIntoView({ behavior: "instant", block: "nearest" });
    return;
  }

  suppressReverseSync(scrollEl);

  // Reset any prior alignment padding we applied so measurements are clean.
  if (scrollEl.dataset.virgilAlignPadding === "1") {
    scrollEl.style.paddingTop = "";
    scrollEl.style.paddingBottom = "";
    scrollEl.dataset.virgilAlignPadding = "0";
  }

  // First pass: move scrollTop so the entry lines up with targetY.
  const cardY1 = entry.getBoundingClientRect().top;
  const desired = scrollEl.scrollTop + (cardY1 - targetY);
  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (desired < 0) scrollEl.scrollTop = 0;
  else if (desired > maxScroll) scrollEl.scrollTop = maxScroll;
  else scrollEl.scrollTop = desired;

  // Second pass: if we clamped, add padding to bridge the residual gap.
  // The inline style overrides whatever baseline padding the class sets,
  // so we add to the currently-computed value (otherwise we'd accidentally
  // wipe out the panel's natural py-2 and end up off by ~8px).
  const cardY2 = entry.getBoundingClientRect().top;
  const residual = cardY2 - targetY;
  if (residual > 0.5) {
    // Card is still below target — need more scroll room at the bottom.
    const baseBot = parseFloat(getComputedStyle(scrollEl).paddingBottom) || 0;
    scrollEl.style.paddingBottom = `${baseBot + residual}px`;
    scrollEl.scrollTop = scrollEl.scrollTop + residual;
    scrollEl.dataset.virgilAlignPadding = "1";
  } else if (residual < -0.5) {
    // Card is still above target — pad the top to push it down.
    const baseTop = parseFloat(getComputedStyle(scrollEl).paddingTop) || 0;
    scrollEl.style.paddingTop = `${baseTop + -residual}px`;
    // scrollTop is already 0 from the first-pass clamp.
    scrollEl.dataset.virgilAlignPadding = "1";
  }
}

// Wraps entry.scrollIntoView to suppress the panel→editor scroll sync
// (same reason as suppressReverseSync above).
export function scrollEntryIntoView(
  entry: HTMLElement,
  opts?: ScrollIntoViewOptions,
) {
  const scrollEl = findScrollParent(entry);
  if (scrollEl) suppressReverseSync(scrollEl);
  entry.scrollIntoView(opts ?? { behavior: "instant", block: "nearest" });
}
