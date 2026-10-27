// @vitest-environment jsdom
// Task 1327 — the React owner of the ONE write coalescer: stable identity,
// the LATEST fire runs, timing fixed at mount, no cancel on unmount.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWriteCoalescer } from "../useWriteCoalescer";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useWriteCoalescer", () => {
  it("returns a stable object and fires the LATEST fire", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ fire }) => useWriteCoalescer({ delayMs: 300, maxWaitMs: 1000, fire }),
      { initialProps: { fire: first } },
    );
    const stable = result.current;
    act(() => stable.arm());
    rerender({ fire: second });
    expect(result.current).toBe(stable);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("caps a burst at maxWaitMs", () => {
    const fire = vi.fn();
    const { result } = renderHook(() =>
      useWriteCoalescer({ delayMs: 300, maxWaitMs: 1000, fire }),
    );
    for (let t = 0; t < 1000; t += 100) {
      act(() => {
        result.current.arm();
        vi.advanceTimersByTime(100);
      });
    }
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("an owner's cleanup flush delivers the held write; unmount alone never cancels it", () => {
    const fire = vi.fn();
    const { result, unmount } = renderHook(() =>
      useWriteCoalescer({ delayMs: 300, fire }),
    );
    act(() => result.current.arm());
    unmount();
    vi.advanceTimersByTime(300);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
