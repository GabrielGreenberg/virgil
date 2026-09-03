// @vitest-environment jsdom
/**
 * `createViewLifetime` — the ONE scope a NodeView arms its timers through
 * (task 548). The contract this pins:
 *
 *   - `dispose()` cancels every armed timeout / interval / frame, so nothing
 *     the view scheduled can fire after the view is gone;
 *   - a scheduling call made AFTER disposal arms nothing (and still returns a
 *     handle `clear` accepts, so a caller needs no branch);
 *   - a timeout / frame that has FIRED deregisters itself, so `pending` is a
 *     count of what is still armed, never of what was ever armed;
 *   - `onDispose` runs each hook once, and an unregistered hook not at all;
 *   - the platform is read at CALL time, so a lifetime built before
 *     `vi.useFakeTimers()` still arms FAKE timers — the property that lets the
 *     NodeView suite's `getTimerCount()` probe see a leak at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createViewLifetime } from "@/lib/tiptap/view-lifetime";

const FAKE: NonNullable<Parameters<typeof vi.useFakeTimers>[0]> = {
  toFake: [
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "requestAnimationFrame", "cancelAnimationFrame",
  ],
};

beforeEach(() => { vi.useFakeTimers(FAKE); });
afterEach(() => { vi.useRealTimers(); });

describe("createViewLifetime", () => {
  it("dispose() cancels every armed timer of every kind", () => {
    const lt = createViewLifetime();
    const fired: string[] = [];
    lt.setTimeout(() => fired.push("timeout"), 100);
    lt.setInterval(() => fired.push("interval"), 30);
    lt.requestAnimationFrame(() => fired.push("frame"));
    expect(lt.pending).toBe(3);
    expect(vi.getTimerCount()).toBe(3);

    lt.dispose();
    expect(lt.disposed).toBe(true);
    expect(lt.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([]);
  });

  it("a timer armed AFTER disposal arms nothing, and its handle is still clearable", () => {
    const lt = createViewLifetime();
    lt.dispose();
    const fired: string[] = [];
    const t = lt.setTimeout(() => fired.push("timeout"), 10);
    const i = lt.setInterval(() => fired.push("interval"), 10);
    const f = lt.requestAnimationFrame(() => fired.push("frame"));
    expect(vi.getTimerCount()).toBe(0);
    expect(lt.pending).toBe(0);
    vi.advanceTimersByTime(100);
    expect(fired).toEqual([]);
    expect(() => { lt.clear(t); lt.clear(i); lt.clear(f); lt.clear(null); }).not.toThrow();
  });

  it("a fired timeout / frame deregisters itself; an interval stays armed until cleared", () => {
    const lt = createViewLifetime();
    const fired: string[] = [];
    lt.setTimeout(() => fired.push("timeout"), 10);
    lt.requestAnimationFrame(() => fired.push("frame"));
    const i = lt.setInterval(() => fired.push("interval"), 10);
    vi.advanceTimersByTime(20);
    expect(fired).toContain("timeout");
    expect(fired).toContain("frame");
    expect(lt.pending).toBe(1); // the interval
    lt.clear(i);
    expect(lt.pending).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clear() is idempotent and ignores a foreign handle", () => {
    const lt = createViewLifetime();
    const t = lt.setTimeout(() => {}, 10);
    lt.clear(t);
    lt.clear(t);
    lt.clear({ kind: "timeout" });
    expect(lt.pending).toBe(0);
  });

  it("onDispose hooks run once on dispose, in registration order; an unregistered hook does not run", () => {
    const lt = createViewLifetime();
    const ran: string[] = [];
    lt.onDispose(() => ran.push("a"));
    const off = lt.onDispose(() => ran.push("b"));
    lt.onDispose(() => ran.push("c"));
    off();
    lt.dispose();
    lt.dispose();
    expect(ran).toEqual(["a", "c"]);
    // A hook registered on an already-disposed lifetime runs at once — the
    // resource it would have released is already orphaned.
    lt.onDispose(() => ran.push("late"));
    expect(ran).toEqual(["a", "c", "late"]);
  });

  it("reads the platform at CALL time — a lifetime built under real timers arms FAKE ones after the swap", () => {
    vi.useRealTimers();
    const lt = createViewLifetime();
    vi.useFakeTimers(FAKE);
    lt.setTimeout(() => {}, 10);
    expect(vi.getTimerCount()).toBe(1);
    lt.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
