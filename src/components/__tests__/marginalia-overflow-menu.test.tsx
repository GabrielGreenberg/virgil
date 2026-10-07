// @vitest-environment jsdom
//
// Task 997 — the margin's "+K" overflow pill opens a menu that HAS items.
//
// It was a hand-built `role="menu"` whose children were bare `MarkerButton`s,
// so a screen reader heard a menu with zero items, the trigger spelled
// `aria-haspopup="true"`, and no key roved. It now opens the shared
// `AnchoredMenu` and lists `MarkerMenuRow`s — the row `UnanchoredCardsChip`
// fixed the same defect with (task 477). The SOURCE half is
// `menu-declared-aria-census.test.ts`; this is the rendered half.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: () => true,
  commitDropSession: async () => {},
  armReleaseCommit: () => () => {},
}));

import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { MarginColumn } from "@/components/Marginalia";
import type { MarginaliaMarker, MarkerOverflowGroup } from "@/lib/marginalia";

afterEach(cleanup);

function marker(i: number): MarginaliaMarker {
  return {
    id: `n${i}:p1`,
    entityId: `n${i}`,
    entityKind: "note",
    type: "note",
    textObjectId: "p1",
    side: "right",
    title: `hidden ${i}`,
  };
}

function renderPill(n: number) {
  const group: MarkerOverflowGroup = {
    side: "right",
    cell: { col: 0, row: 1, x: 4, y: 40 },
    textObjectId: "p1",
    hidden: Array.from({ length: n }, (_, i) => marker(i)),
  };
  return render(
    <MarginColumn side="right" markers={[]} overflow={[group]} dragEnabled={false} />,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('"+K" overflow pill (task 997)', () => {
  it("its trigger states the menu contract, not a hand-spelled aria-haspopup", () => {
    const { getByText } = renderPill(3);
    const trigger = getByText("+3").closest("button")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-label")).toBe("3 hidden markers");
    // The drop-mode click-through + card click-away hook still wraps it.
    expect(trigger.closest("[data-marginalia-overflow]")).not.toBeNull();
  });

  it("opens a role=menu whose rows are menuitems — one per hidden marker", async () => {
    const { getByText } = renderPill(3);
    const trigger = getByText("+3").closest("button")!;
    fireEvent.click(trigger);
    await settle();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = document.body.querySelector('[role="menu"][aria-label="3 hidden markers"]');
    expect(menu).not.toBeNull();
    const items = menu!.querySelectorAll('[role="menuitem"]');
    expect(items).toHaveLength(3);
    expect([...items].map((el) => el.textContent)).toEqual(["hidden 0", "hidden 1", "hidden 2"]);
    // Each row still hosts the marker's own button (its click/drag surface).
    for (const el of items) expect(el.querySelector("button")).not.toBeNull();
  });
});
