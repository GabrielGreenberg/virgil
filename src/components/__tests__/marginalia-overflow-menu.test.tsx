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

function renderPill(n: number, decorate: (m: MarginaliaMarker, i: number) => MarginaliaMarker = (m) => m) {
  const group: MarkerOverflowGroup = {
    side: "right",
    cell: { col: 0, row: 1, x: 4, y: 40 },
    textObjectId: "p1",
    hidden: Array.from({ length: n }, (_, i) => decorate(marker(i), i)),
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

// Task 1529 — the menu controller consumes Delete/Backspace and acts only
// through the ACTIVE row's remove verb; arrowing never moves DOM focus into the
// row's `MarkerButton`, so the button's own Delete handler cannot fire. The row
// re-exposes `m.onDelete` as its remove verb — present exactly when the host's
// permit left `onDelete` on the marker (task 1527).
describe('"+K" overflow pill — Delete on an arrowed-to row (task 1529)', () => {
  async function openAndArrowTo(getByText: (t: string) => HTMLElement, label: string, steps: number) {
    fireEvent.click(getByText(label).closest("button")!);
    await settle();
    for (let i = 0; i < steps; i++) {
      fireEvent.keyDown(window, { key: "ArrowDown" });
      await settle();
    }
    const menu = document.body.querySelector('[role="menu"]')!;
    return menu.querySelector('[role="menuitem"][data-active]');
  }

  it("deletes the ACTIVE row's marker through the same onDelete the button calls", async () => {
    const deletes = [vi.fn(), vi.fn(), vi.fn()];
    const { getByText } = renderPill(3, (m, i) => ({ ...m, onDelete: deletes[i] }));
    const active = await openAndArrowTo(getByText, "+3", 2);
    expect(active).not.toBeNull();
    const idx = Number(active!.textContent!.replace("hidden ", ""));
    fireEvent.keyDown(window, { key: "Delete" });
    await settle();
    expect(deletes[idx]).toHaveBeenCalledTimes(1);
    for (const [i, fn] of deletes.entries()) if (i !== idx) expect(fn).not.toHaveBeenCalled();
    // Backspace is the same verb.
    const next = document.body.querySelector('[role="menuitem"][data-active]');
    const nextIdx = Number(next!.textContent!.replace("hidden ", ""));
    fireEvent.keyDown(window, { key: "Backspace" });
    await settle();
    expect(deletes[nextIdx]).toHaveBeenCalledTimes(1);
  });

  it("announces the verb only on a row whose marker carries onDelete", async () => {
    const { getByText } = renderPill(2, (m, i) => (i === 0 ? { ...m, onDelete: vi.fn() } : m));
    fireEvent.click(getByText("+2").closest("button")!);
    await settle();
    const items = [...document.body.querySelectorAll('[role="menuitem"]')];
    expect(items[0].getAttribute("aria-keyshortcuts") ?? "").toMatch(/Delete/);
    expect(items[1].getAttribute("aria-keyshortcuts") ?? "").not.toMatch(/Delete/);
  });

  it("a permit-refused row (no onDelete) has no verb — Delete is a no-op", async () => {
    const click = vi.fn();
    const { getByText } = renderPill(2, (m) => ({ ...m, onClick: click }));
    const active = await openAndArrowTo(getByText, "+2", 1);
    expect(active).not.toBeNull();
    fireEvent.keyDown(window, { key: "Delete" });
    await settle();
    // Nothing removed, nothing activated, and the menu is still open.
    expect(click).not.toHaveBeenCalled();
    expect(document.body.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  });
});
