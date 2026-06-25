"use client";

/**
 * Vertical line marking the insertion point during a paper-tab drag
 * onto the Virgil bar. Mirrors the inner library strip's drop indicator
 * shape (2px accent line) but positioned inside the outer tab strip.
 */
export function PaperDropIndicator({
  stripEl,
  tabRefs,
  order,
  index,
}: {
  stripEl: HTMLDivElement | null;
  tabRefs: Map<string, HTMLElement>;
  order: string[];
  index: number;
}) {
  if (!stripEl) return null;
  const stripRect = stripEl.getBoundingClientRect();
  let x: number;
  if (order.length === 0) {
    x = 4;
  } else if (index <= 0) {
    const first = tabRefs.get(order[0]);
    x = first ? first.getBoundingClientRect().left - stripRect.left - 1 : 4;
  } else if (index >= order.length) {
    const last = tabRefs.get(order[order.length - 1]);
    x = last ? last.getBoundingClientRect().right - stripRect.left + 1 : 4;
  } else {
    const left = tabRefs.get(order[index - 1]);
    const right = tabRefs.get(order[index]);
    if (left && right) {
      const lr = left.getBoundingClientRect();
      const rr = right.getBoundingClientRect();
      x = (lr.right + rr.left) / 2 - stripRect.left - 1;
    } else {
      x = 4;
    }
  }
  return (
    <div
      style={{
        position: "absolute",
        top: 4,
        bottom: 0,
        left: x,
        width: 2,
        background: "var(--accent)",
        borderRadius: 1,
        pointerEvents: "none",
        zIndex: 30,
      }}
    />
  );
}
