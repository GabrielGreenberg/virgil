// @vitest-environment jsdom
//
// Task 1152 — the trailing-click guard's lifetime is the gesture's: armed on a
// drag, it swallows exactly the click dispatched with the release, disarms on
// the task after the release, and leaves no listener/timer past unmount.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useTrailingClickGuard } from "@/hooks/useTrailingClickGuard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("useTrailingClickGuard", () => {
  it("unarmed: consume() is false — a plain click passes", () => {
    const { result } = renderHook(() => useTrailingClickGuard());
    expect(result.current.consume()).toBe(false);
  });

  it("swallows the click dispatched with the release, once", () => {
    const { result } = renderHook(() => useTrailingClickGuard());
    result.current.arm();
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(result.current.consume()).toBe(true);
    expect(result.current.consume()).toBe(false);
  });

  it("disarms on the task after the release when no click came", async () => {
    const { result } = renderHook(() => useTrailingClickGuard());
    result.current.arm();
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(result.current.armed).toBe(true);
    await tick();
    expect(result.current.armed).toBe(false);
    expect(result.current.consume()).toBe(false);
  });

  it("stays armed while the press is still held", async () => {
    const { result } = renderHook(() => useTrailingClickGuard());
    result.current.arm();
    await tick();
    expect(result.current.armed).toBe(true);
  });

  it("release() (missed release) disarms on the next task", async () => {
    const { result } = renderHook(() => useTrailingClickGuard());
    result.current.arm();
    result.current.release();
    await tick();
    expect(result.current.armed).toBe(false);
  });

  it("unmount mid-gesture removes the end-edge listener", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useTrailingClickGuard());
    result.current.arm();
    unmount();
    expect(remove).toHaveBeenCalledWith("mouseup", expect.any(Function), true);
  });

  it("the guard object is stable across renders", () => {
    const { result, rerender } = renderHook(() => useTrailingClickGuard());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
