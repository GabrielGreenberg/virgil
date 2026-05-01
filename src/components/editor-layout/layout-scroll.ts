/**
 * Scroll helpers extracted from EditorLayout.
 *
 * Two flavors of "scroll an entry into alignment":
 *
 *  - For entries inside a transform-driven panel (OmniView), the panel
 *    itself doesn't scroll — the editor does. We compute the editor
 *    scrollTop that lands the entry at `targetY` on screen.
 *
 *  - For entries inside a list-mode panel (its own `overflow-y-auto`),
 *    we scroll that panel directly, like before.
 *
 * `findScrollParent` resolves the entry's nearest scrollable ancestor.
 * For transform-panel entries, we route through the editor scroll
 * container instead, which is found by the `data-virgil-in-text-transform`
 * ancestor combined with the page's `.overflow-y-auto` editor element.
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

/** Resolve the main editor's scroll container, marked by Editor.tsx
 *  with `data-virgil-editor-scroll`. In split mode the canonical pane
 *  is the first occurrence; the mirror pane has its own scroll element
 *  but isn't the OmniView source of truth. */
function findEditorScroll(): HTMLElement | null {
  return document.querySelector("[data-virgil-editor-scroll]") as HTMLElement | null;
}

/** True when the entry is rendered inside a transform-driven panel
 *  (currently only OmniView). */
function isInTransformPanel(entry: HTMLElement): boolean {
  return entry.closest("[data-virgil-in-text-transform]") !== null;
}

/** Scroll so `entry` lines up with viewport-Y `targetY`. */
export function alignEntryToY(entry: HTMLElement, targetY: number) {
  const scrollEl = isInTransformPanel(entry)
    ? findEditorScroll()
    : findScrollParent(entry);
  if (!scrollEl) {
    entry.scrollIntoView({ behavior: "instant", block: "nearest" });
    return;
  }

  // entry.getBoundingClientRect() reflects the post-transform screen
  // position, so the same formula works for both the transform-panel and
  // list-mode cases.
  const cardY = entry.getBoundingClientRect().top;
  const desired = scrollEl.scrollTop + (cardY - targetY);
  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  scrollEl.scrollTop = Math.max(0, Math.min(maxScroll, desired));
}

/** Bring `entry` into view. Routes through the editor's scroll for
 *  transform-panel entries; falls back to native `scrollIntoView`
 *  otherwise. */
export function scrollEntryIntoView(
  entry: HTMLElement,
  opts?: ScrollIntoViewOptions,
) {
  if (isInTransformPanel(entry)) {
    const editorScrollEl = findEditorScroll();
    if (editorScrollEl) {
      // Approximate native scrollIntoView's `block: "nearest"` semantics
      // by aligning the entry's top to the editor's top when above the
      // viewport, or its bottom to the editor's bottom when below.
      const editorRect = editorScrollEl.getBoundingClientRect();
      const cardRect = entry.getBoundingClientRect();
      let delta = 0;
      if (cardRect.top < editorRect.top) {
        delta = cardRect.top - editorRect.top;
      } else if (cardRect.bottom > editorRect.bottom) {
        delta = cardRect.bottom - editorRect.bottom;
      }
      if (delta !== 0) {
        const maxScroll = editorScrollEl.scrollHeight - editorScrollEl.clientHeight;
        editorScrollEl.scrollTop = Math.max(
          0,
          Math.min(maxScroll, editorScrollEl.scrollTop + delta),
        );
      }
      return;
    }
  }
  entry.scrollIntoView(opts ?? { behavior: "instant", block: "nearest" });
}
