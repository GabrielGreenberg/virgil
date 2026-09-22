// @vitest-environment jsdom
//
// Task 709 (M2) — the focus band is always the rect OF its in-band rows, or
// nothing. Folding the band's parent heading unmounts every in-band row; the
// pre-709 measure kept the PREVIOUS rect forever ("transient miss"), so the
// yellow band + its drag handles sat over whatever rows moved into those
// pixels. Now a miss earns one frame of grace, then the band is dropped, and
// it returns on the first measure that finds an in-band row again.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { FocusBandOverlay } from "../OutlinePanel";

let rafCallbacks = new Map<number, FrameRequestCallback>();
let rafSeq = 0;
const flushRaf = () => {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(0);
};

beforeEach(() => {
  rafCallbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafCallbacks.set(rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => rafCallbacks.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function row(attr: string, top: number): HTMLElement {
  const el = document.createElement("div");
  el.dataset.outlinePos = attr;
  Object.defineProperty(el, "offsetTop", { value: top });
  Object.defineProperty(el, "offsetHeight", { value: 20 });
  return el;
}

// Outline: docstart(0) · §1 h-1 (index 1, level 1) · §1.1 h-2 (index 2, level 2, IN BAND) · §2 h-5.
const HEADINGS = [
  { id: "h1", uuid: "u1", level: 1, text: "One", label: null, sectionNumber: "1", index: 1, parTitles: [] },
  { id: "h2", uuid: "u2", level: 2, text: "One.one", label: null, sectionNumber: "1.1", index: 2, parTitles: [] },
  { id: "h5", uuid: "u5", level: 1, text: "Two", label: null, sectionNumber: "2", index: 5, parTitles: [] },
];

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const rows = {
    docstart: row("docstart", 0),
    h1: row("h-1", 20),
    h2: row("h-2", 40),
    h5: row("h-5", 60),
  };
  container.append(rows.docstart, rows.h1, rows.h2, rows.h5);
  const scrollRef = { current: container };
  const utils = render(
    <FocusBandOverlay
      scrollRef={scrollRef}
      focusState={{ active: true, locked: false, startBlockIndex: 2, endBlockIndex: 4 }}
      headings={HEADINGS}
      preambleTitles={[]}
      totalBlocks={7}
      onSnapBoundary={() => {}}
    />,
  );
  const bandEl = () =>
    [...utils.container.querySelectorAll<HTMLElement>("div")].find((d) => d.style.height !== "") ?? null;
  return { container, rows, bandEl };
}

describe("FocusBand overlay measure (task 709)", () => {
  it("paints over exactly its in-band rows", () => {
    const { bandEl } = setup();
    expect(bandEl()?.style.top).toBe("40px");
    expect(bandEl()?.style.height).toBe("20px");
  });

  it("folding the parent heading (in-band rows unmount) drops the band after one frame — never the stale rect", async () => {
    const { rows, bandEl } = setup();
    await act(async () => {
      rows.h2.remove(); // the §1 fold unmounts the in-band §1.1 row
      await Promise.resolve(); // MutationObserver delivery
    });
    // One frame of grace (a remount can miss a single measure)…
    expect(bandEl()).not.toBeNull();
    act(() => flushRaf());
    // …then the band — and its drag handles — are gone.
    expect(bandEl()).toBeNull();
  });

  it("a one-frame miss that recovers keeps the band (no flash)", async () => {
    const { container, rows, bandEl } = setup();
    await act(async () => {
      rows.h2.remove();
      await Promise.resolve();
    });
    await act(async () => {
      container.insertBefore(rows.h2, rows.h5); // the remount lands
      await Promise.resolve();
    });
    act(() => flushRaf());
    expect(bandEl()?.style.top).toBe("40px");
  });

  it("unfolding brings the band back onto the rows", async () => {
    const { container, rows, bandEl } = setup();
    await act(async () => {
      rows.h2.remove();
      await Promise.resolve();
    });
    act(() => flushRaf());
    expect(bandEl()).toBeNull();
    await act(async () => {
      container.insertBefore(rows.h2, rows.h5);
      await Promise.resolve();
    });
    expect(bandEl()?.style.top).toBe("40px");
  });
});
