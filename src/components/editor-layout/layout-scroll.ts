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

export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** The unified row scroll container. */
export function findRowScroll(): HTMLElement | null {
  return document.querySelector("[data-virgil-row-scroll]") as HTMLElement | null;
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

/** Scroll so `entry` lines up with viewport-Y `targetY`. */
export function alignEntryToY(entry: HTMLElement, targetY: number) {
  // List-mode entries continue to scroll their own panel ancestor.
  // Editor-anchored entries route through the row scroll.
  const own = findScrollParent(entry);
  const row = findRowScroll();
  const isListPanelScroll = !!own && own !== row;
  const scrollEl = isListPanelScroll ? own : row;
  if (!scrollEl) {
    entry.scrollIntoView({ block: "nearest" });
    return;
  }
  const cardY = entry.getBoundingClientRect().top;
  const desired = scrollEl.scrollTop + (cardY - targetY);
  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  scrollEl.scrollTop = Math.max(0, Math.min(maxScroll, desired));
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
