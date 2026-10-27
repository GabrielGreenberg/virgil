// Task 1327 — the ONE write coalescer: trailing debounce + maxWait + flush.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWriteCoalescer } from "../write-coalescer";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createWriteCoalescer", () => {
  it("fires once, delayMs after the LAST arm (trailing)", () => {
    const fire = vi.fn();
    const c = createWriteCoalescer({ delayMs: 300, fire });
    c.arm();
    vi.advanceTimersByTime(200);
    c.arm();
    vi.advanceTimersByTime(299);
    expect(fire).not.toHaveBeenCalled();
    expect(c.pending).toBe(true);
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe(false);
  });

  it("caps an unbroken burst at maxWaitMs from its first arm", () => {
    const fire = vi.fn();
    const c = createWriteCoalescer({ delayMs: 300, maxWaitMs: 2000, fire });
    // An arm every 100 ms for 10 s — never a 300 ms pause.
    for (let t = 0; t < 10_000; t += 100) {
      c.arm();
      vi.advanceTimersByTime(100);
    }
    // One fire per 2 s cap (each fire ends the burst; the next arm starts one).
    expect(fire.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(fire.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("without maxWaitMs, an unbroken burst never fires (a pure trailing debounce)", () => {
    const fire = vi.fn();
    const c = createWriteCoalescer({ delayMs: 300, fire });
    for (let t = 0; t < 10_000; t += 100) {
      c.arm();
      vi.advanceTimersByTime(100);
    }
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("a cap shorter than the window is raised to it", () => {
    const fire = vi.fn();
    const c = createWriteCoalescer({ delayMs: 5000, maxWaitMs: 2000, fire });
    c.arm();
    vi.advanceTimersByTime(4999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("flush fires a pending window once, synchronously, and nothing fires later", () => {
    const fire = vi.fn();
    const c = createWriteCoalescer({ delayMs: 300, maxWaitMs: 2000, fire });
    expect(c.flush()).toBe(false);
    c.arm();
    expect(c.flush()).toBe(true);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(c.flush()).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("cancel disarms without firing", () => {
    const fire = vi.fn();
    const c = createWriteCoalescer({ delayMs: 300, fire });
    c.arm();
    c.cancel();
    expect(c.pending).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(fire).not.toHaveBeenCalled();
  });

  it("a fire ends the burst: pending is false inside fire, and an arm from fire starts a fresh window", () => {
    const seen: boolean[] = [];
    let rearm = true;
    const c = createWriteCoalescer({
      delayMs: 300,
      maxWaitMs: 1000,
      fire: () => {
        seen.push(c.pending);
        if (rearm) {
          rearm = false;
          c.arm(); // the useDocument pause re-arm shape
        }
      },
    });
    c.arm();
    vi.advanceTimersByTime(300);
    expect(seen).toEqual([false]);
    expect(c.pending).toBe(true);
    // A FRESH window — the full delay, not the old burst's remainder.
    vi.advanceTimersByTime(299);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([false, false]);
  });
});
