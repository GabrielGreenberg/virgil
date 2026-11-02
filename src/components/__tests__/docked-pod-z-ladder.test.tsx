// @vitest-environment jsdom
//
// Task 1416 — the band-frame z ladder. A docked pod used to carry the
// floating-window rung (FLOATING_PANEL_Z_BASE + i = 1000+i) into the sticky
// band frame's LOCAL stacking context (z 30), where it outranked the
// BandDivider (z-10) on both sides — so both pods painted (and hit-tested)
// over the divider's --gutter-grab overhang and the reachable grab was the
// 10px painted gap, not the 18px grab task 1241 promised.
//
// jsdom cannot hit-test, so this pins the CONTRACT: a docked pod takes the
// frame's pod rung, a float keeps the floating rung, and the grips outrank
// both the pods and the bin slot. The elementsFromPoint sweep is a preview
// check (owed).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import { BandDivider } from "@/components/panel-primitives";
import {
  BAND_GRIP_Z,
  DOCKED_POD_Z,
  FLOATING_PANEL_Z_BASE,
  OMNI_BIN_SLOT_Z,
} from "@/components/editor-layout/constants";

// panel-primitives reaches the storage barrel, whose FSA backend jsdom
// cannot resolve.
vi.mock("@/lib/storage", () => ({}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function Panel({ mode }: { mode: "docked" | "floating" }) {
  return (
    <FloatingPanel
      panelId={"outline" as never}
      mode={mode}
      slotKey={"left-0" as never}
      initialX={100}
      initialY={100}
      initialWidth={300}
      initialHeight={200}
      zIndex={FLOATING_PANEL_Z_BASE + 2}
      onChange={vi.fn()}
    >
      <div>body</div>
    </FloatingPanel>
  );
}

const shell = () =>
  document.querySelector<HTMLElement>('[data-floating-panel="true"]');

describe("the band-frame z ladder (task 1416)", () => {
  it("states pods < bins < grips, all far under the floating rung", () => {
    expect(DOCKED_POD_Z).toBeLessThan(OMNI_BIN_SLOT_Z);
    expect(OMNI_BIN_SLOT_Z).toBeLessThan(BAND_GRIP_Z);
    expect(BAND_GRIP_Z).toBeLessThan(FLOATING_PANEL_Z_BASE);
  });

  it("a docked pod in its band anchor takes the pod rung, not the floating rung", () => {
    const anchor = document.createElement("div");
    anchor.setAttribute("data-dock-slot", "left-0");
    // jsdom lays nothing out; stub the fail-closed visibility rung's read.
    Object.defineProperty(anchor, "offsetHeight", { configurable: true, get: () => 100 });
    document.body.appendChild(anchor);
    render(<Panel mode="docked" />);
    const el = shell();
    expect(el).not.toBeNull();
    expect(anchor.contains(el)).toBe(true);
    // A rung (not auto) — the pod stays its own stacking context.
    expect(el!.style.zIndex).toBe(String(DOCKED_POD_Z));
  });

  it("the body-portal fallback (no anchor) keeps the floating rung", () => {
    render(<Panel mode="docked" />);
    const el = shell();
    expect(el!.parentElement).toBe(document.body);
    expect(el!.style.zIndex).toBe(String(FLOATING_PANEL_Z_BASE + 2));
  });

  it("a floating panel keeps the floating rung", () => {
    render(<Panel mode="floating" />);
    expect(shell()!.style.zIndex).toBe(String(FLOATING_PANEL_Z_BASE + 2));
  });

  it("the BandDivider sits on the grip rung, above the pods it separates", () => {
    const { container } = render(
      <BandDivider
        side="left"
        aboveId={"outline" as never}
        belowId={"notes" as never}
        onTradeHeight={vi.fn()}
        containerRef={{ current: null }}
      />,
    );
    const wrapper = container.querySelector<HTMLElement>("[data-band-divider]");
    expect(wrapper!.style.zIndex).toBe(String(BAND_GRIP_Z));
    expect(wrapper!.className).not.toMatch(/\bz-\d/);
  });
});
