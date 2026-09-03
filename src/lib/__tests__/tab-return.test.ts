// @vitest-environment jsdom
//
// Task 542 — the RETURN edge of the shared tab-edge module.
//
// `tab-hidden.ts` has published the SETTLE edge since task 363; this pins the
// mirror edge it now publishes for READERS of disk state: the user coming back
// to the tab. Two events carry it (visibilitychange → visible, window focus),
// a return is coalesced so a tab switch's back-to-back pair costs one delivery,
// and the settle edge is byte-unchanged.
//
// Legs:
//   1. EDGES     — visible fires RETURN and not HIDDEN; hidden fires HIDDEN and
//                  not RETURN; window focus fires RETURN.
//   2. COALESCE  — two return events inside the window are one delivery; past
//                  it, the next return is delivered again.
//   3. SILENT    — subscribing never fires (a reader does its own initial
//                  pass, so subscribing cannot double a doc-open read).
//   4. ONE       — one document listener and one window listener however many
//                  subscribers of either edge; both removed with the last.
//   5. ISOLATED  — a throwing subscriber does not strand the next.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  onTabHidden,
  onTabReturn,
  RETURN_COALESCE_MS,
  __resetTabReturnForTests,
} from "@/lib/tab-hidden";

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}
function visibilityChange(state: "visible" | "hidden"): void {
  setVisibility(state);
  document.dispatchEvent(new Event("visibilitychange"));
}
function windowFocus(): void {
  window.dispatchEvent(new Event("focus"));
}

const offs: Array<() => void> = [];
function track(off: () => void): () => void {
  offs.push(off);
  return off;
}

beforeEach(() => {
  __resetTabReturnForTests();
  setVisibility("visible");
});
afterEach(() => {
  while (offs.length) offs.pop()!();
  vi.useRealTimers();
});

describe("tab edges — RETURN vs HIDDEN", () => {
  it("visible fires RETURN and not HIDDEN; hidden fires HIDDEN and not RETURN", () => {
    const ret = vi.fn();
    const hid = vi.fn();
    track(onTabReturn(ret));
    track(onTabHidden(hid));

    visibilityChange("hidden");
    expect(hid).toHaveBeenCalledTimes(1);
    expect(ret).not.toHaveBeenCalled();

    visibilityChange("visible");
    expect(ret).toHaveBeenCalledTimes(1);
    expect(hid).toHaveBeenCalledTimes(1);
  });

  it("window focus fires RETURN — the partly-covered PWA window that was never hidden", () => {
    const ret = vi.fn();
    const hid = vi.fn();
    track(onTabReturn(ret));
    track(onTabHidden(hid));
    windowFocus();
    expect(ret).toHaveBeenCalledTimes(1);
    expect(hid).not.toHaveBeenCalled();
  });

  it("coalesces a tab switch's back-to-back pair into ONE return, and delivers again past the window", () => {
    vi.useFakeTimers();
    const ret = vi.fn();
    track(onTabReturn(ret));
    visibilityChange("visible");
    windowFocus();
    expect(ret).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RETURN_COALESCE_MS - 1);
    windowFocus();
    expect(ret).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    windowFocus();
    expect(ret).toHaveBeenCalledTimes(2);
  });

  it("never fires on subscribe", () => {
    const ret = vi.fn();
    track(onTabReturn(ret));
    expect(ret).not.toHaveBeenCalled();
  });

  it("installs ONE document listener and ONE window listener for any number of subscribers, and removes both with the last", () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");
    type Spy = { mock: { calls: unknown[][] } };
    const countVis = (spy: Spy) =>
      spy.mock.calls.filter((c) => c[0] === "visibilitychange").length;
    const countFocus = (spy: Spy) =>
      spy.mock.calls.filter((c) => c[0] === "focus").length;

    const a = onTabReturn(() => {});
    const b = onTabReturn(() => {});
    const c = onTabHidden(() => {});
    expect(countVis(docAdd)).toBe(1);
    expect(countFocus(winAdd)).toBe(1);

    a();
    b();
    expect(countVis(docRemove)).toBe(0);
    expect(countFocus(winRemove)).toBe(0);
    c();
    expect(countVis(docRemove)).toBe(1);
    expect(countFocus(winRemove)).toBe(1);

    // …and a fresh subscriber re-installs.
    track(onTabReturn(() => {}));
    expect(countVis(docAdd)).toBe(2);
    expect(countFocus(winAdd)).toBe(2);
    docAdd.mockRestore();
    docRemove.mockRestore();
    winAdd.mockRestore();
    winRemove.mockRestore();
  });

  it("a throwing subscriber does not strand the next", () => {
    const later = vi.fn();
    track(
      onTabReturn(() => {
        throw new Error("boom");
      }),
    );
    track(onTabReturn(later));
    expect(() => visibilityChange("visible")).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });
});
