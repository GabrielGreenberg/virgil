// @vitest-environment jsdom
/**
 * Task 663 — `isTopRowOf` had no unit leg.
 *
 * It is the grab-handle hover SET's gate: a container's handle shows ONLY when
 * the hovered line is that container's own top row (Gabriel's rule, task 425).
 * Only component-level behaviour exercised it, so the two paths that are
 * DEFENSIVE — the `MAX_CONTAINER_DESCENT` exhaustion and the
 * no-grabbable-child bail — were unpinned, and so was the claim the function is
 * built on: that it is literally the descent `resolveFirstLineTarget` performs
 * to PLACE a container's handle, read as a predicate. That claim is the whole
 * reason "is this the top row" and "where does the container's handle go"
 * cannot disagree, and it is the one thing a component leg can't state.
 *
 * Fixtures are the shared builder, so these rows are the same DOM the
 * composition suite resolves frames over.
 */

import { describe, it, expect, afterEach } from "vitest";
import { isTopRowOf } from "@/text-objects/block-frame";
import { resolveFirstLineTarget, MAX_CONTAINER_DESCENT } from "@/lib/text-metrics";
import { buildNestedList, buildTopLevelList } from "./_block-frame-fixtures";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * A chain of CONTAINERS, each the next one's only grabbable child, ending in a
 * stamped `listItem`. That is the shape the recursion is for — a container whose
 * first grabbable child is itself a container — and the walk steps once per
 * level.
 *
 * A `<ul>` directly inside a `<ul>` is not schema-legal (a list's child is an
 * `<li>`), and stating that is the point: the descent's bound is DEFENSIVE, so
 * the only way to reach it is a shape the document cannot produce. A leg that
 * refused to build one could not test the bound at all.
 */
function buildContainerChain(depth: number) {
  const containers: HTMLElement[] = [];
  let parent: HTMLElement = document.body;
  for (let d = 0; d < depth; d++) {
    const ul = document.createElement("ul");
    ul.setAttribute("data-uuid", `C${d}`);
    ul.setAttribute("data-text-object-kind", "bulletList");
    parent.appendChild(ul);
    containers.push(ul);
    parent = ul;
  }
  const li = document.createElement("li");
  li.setAttribute("data-uuid", "row");
  li.setAttribute("data-text-object-kind", "listItem");
  const p = document.createElement("p");
  p.textContent = "row";
  li.appendChild(p);
  parent.appendChild(li);
  return { containers, item: li, paragraph: p };
}

describe("isTopRowOf", () => {
  it("a container's FIRST item is its top row; a later one is not", () => {
    const { block, items } = buildTopLevelList("ul", { itemCount: 3 });
    expect(isTopRowOf(block, items[0])).toBe(true);
    expect(isTopRowOf(block, items[1])).toBe(false);
    expect(isTopRowOf(block, items[2])).toBe(false);
  });

  it("an element IS its own top row — the identity rung the walk starts on", () => {
    const { block } = buildTopLevelList("ul");
    expect(isTopRowOf(block, block)).toBe(true);
  });

  it("recurses through INTERMEDIATE containers to the innermost row", () => {
    const { containers, item } = buildContainerChain(3);
    for (const c of containers) expect(isTopRowOf(c, item)).toBe(true);
    // ...and each container on the way down is its outer's top row too, which
    // is why a stack of containers sharing one line is a genuine coincidence
    // the same-row machinery has to handle rather than a bug.
    expect(isTopRowOf(containers[0], containers[1])).toBe(true);
    expect(isTopRowOf(containers[0], containers[2])).toBe(true);
  });

  it("a NON-container ancestor grants no top row but for itself", () => {
    // The walk STOPS at a `listItem`: an item has no "top row" of its own to
    // grant. So a nested list's row is NOT the outer list's top row, which is
    // exactly what keeps the handle set <=2 per row under the list schema — an
    // item's first child is a paragraph, so no line is the top row of two
    // nested lists at once.
    const outer = buildTopLevelList("ul", { uuid: "outer" });
    const inner = buildNestedList("ul", { parent: outer.items[0], uuid: "inner" });
    expect(isTopRowOf(outer.block, outer.items[0])).toBe(true);
    expect(isTopRowOf(outer.block, inner.items[0])).toBe(false);
    expect(isTopRowOf(outer.items[0], inner.items[0])).toBe(false);
    expect(isTopRowOf(outer.items[0], outer.items[0])).toBe(true);
  });

  it("a container with NO grabbable child answers false rather than throwing", () => {
    const { block } = buildTopLevelList("ul", { itemCount: 0 });
    const stray = document.createElement("li");
    expect(isTopRowOf(block, stray)).toBe(false);
  });

  it("gives up at MAX_CONTAINER_DESCENT rather than walking forever", () => {
    // The recursion guard, reached only by an over-deep chain. A defensive path
    // with no leg is a path whose bound can be flipped with nothing failing.
    const deep = buildContainerChain(MAX_CONTAINER_DESCENT + 3);
    expect(isTopRowOf(deep.containers[0], deep.item)).toBe(false);
    // Exactly AT the bound it still answers, so the leg above is the guard
    // firing rather than a chain that happens to miss. The walk takes one step
    // per level plus the identity check, so a chain of `MAX_CONTAINER_DESCENT`
    // containers is the deepest that resolves.
    const atBound = buildContainerChain(MAX_CONTAINER_DESCENT);
    expect(isTopRowOf(atBound.containers[0], atBound.item)).toBe(true);
  });

  it("shares its chain with the PLACEMENT descent — the two cannot disagree", () => {
    // The function's stated justification: a container's handle sits beside the
    // very element this walk reaches. So for every level of a chain, the element
    // `resolveFirstLineTarget` places that level's handle beside must be inside
    // the row `isTopRowOf` grants it.
    const { containers, item, paragraph } = buildContainerChain(3);
    for (const [i, c] of containers.entries()) {
      const placed = resolveFirstLineTarget(c);
      expect(placed, `level ${i} places on the innermost row's own line`).toBe(
        paragraph,
      );
      expect(isTopRowOf(c, item), `level ${i} grants that row`).toBe(true);
    }
  });
});
