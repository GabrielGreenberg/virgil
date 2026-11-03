// @vitest-environment jsdom
/**
 * Task 1451 — the paragraph Back/Forward recorder owns its latch timer and
 * reads its source LIVE.
 *
 * - A rapid double press: the latch ends NAV_LATCH_MS after the SECOND press,
 *   never on the first press's timer (which used to unlatch mid-scroll and let
 *   the recorder push a transient block and wipe Forward).
 * - A resetKey change (doc switch) and unmount end the latch: no timer survives.
 * - The source is a latest-ref: a callback that arrives after mount (the
 *   bubbled collab) is the one the recorder calls.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { NAV_LATCH_MS, useParaNavHistory, type ParaNavSource } from "../useParaNavHistory";

afterEach(() => {
  vi.useRealTimers();
});

/** A fake reading position the test moves by hand. */
function rig() {
  const state = { at: null as string | null, scrolls: [] as string[] };
  const source: ParaNavSource = {
    getActiveParagraphId: () => state.at,
    scrollToParagraph: (uuid) => {
      state.scrolls.push(uuid);
    },
  };
  return { state, source };
}

/** Record `ids` in order: land on each and let one poll + debounce elapse. */
function record(state: { at: string | null }, ids: string[]) {
  for (const id of ids) {
    state.at = id;
    act(() => {
      vi.advanceTimersByTime(3100);
    });
  }
}

describe("useParaNavHistory — the latch is ONE owned slot", () => {
  it("a second Back inside the window keeps the latch until NAV_LATCH_MS after it", () => {
    vi.useFakeTimers();
    const { state, source } = rig();
    const { result } = renderHook(() =>
      useParaNavHistory(source, { active: true, scrollEl: null }),
    );
    record(state, ["A", "B", "C", "D"]);
    expect(result.current.paraNavBackDisabled).toBe(false);

    act(() => result.current.paraNavBack()); // → C
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    act(() => result.current.paraNavBack()); // → B
    // The scroll is still settling on a transient block between C and B.
    state.at = "TRANSIENT";
    // t = first press + 1.6 s: the first press's timer would have unlatched.
    // Let a debounced poll land inside the window — it must be ignored.
    act(() => {
      vi.advanceTimersByTime(NAV_LATCH_MS - 100);
    });
    expect(result.current.paraNavForwardDisabled).toBe(false);
    // Settle on B, then let the latch run out and a poll happen.
    state.at = "B";
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.paraNavForwardDisabled).toBe(false);
    act(() => result.current.paraNavForward());
    expect(state.scrolls).toEqual(["C", "B", "C"]);
  });

  it("the transient block IS recorded once the latch from the last press has ended", () => {
    vi.useFakeTimers();
    const { state, source } = rig();
    const { result } = renderHook(() =>
      useParaNavHistory(source, { active: true, scrollEl: null }),
    );
    record(state, ["A", "B"]);
    act(() => result.current.paraNavBack()); // → A, Forward available
    act(() => {
      vi.advanceTimersByTime(NAV_LATCH_MS + 10);
    });
    state.at = "NEW";
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    // A genuine new position truncates Forward — the latch did end.
    expect(result.current.paraNavForwardDisabled).toBe(true);
  });

  it("a resetKey change clears history and the latch", () => {
    vi.useFakeTimers();
    const { state, source } = rig();
    const { result, rerender } = renderHook(
      ({ doc }: { doc: string }) =>
        useParaNavHistory(source, { active: true, scrollEl: null, resetKey: doc }),
      { initialProps: { doc: "d1" } },
    );
    record(state, ["A", "B"]);
    act(() => result.current.paraNavBack());
    rerender({ doc: "d2" });
    expect(result.current.paraNavBackDisabled).toBe(true);
    expect(result.current.paraNavForwardDisabled).toBe(true);
    // The new doc records immediately — the old press's latch is gone.
    state.at = "X";
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    state.at = "Y";
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(result.current.paraNavBackDisabled).toBe(false);
  });

  it("unmount leaves no para-nav timer armed", () => {
    vi.useFakeTimers();
    const { state, source } = rig();
    const { result, unmount } = renderHook(() =>
      useParaNavHistory(source, { active: true, scrollEl: null }),
    );
    record(state, ["A", "B"]);
    act(() => result.current.paraNavBack());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useParaNavHistory — the source is read live", () => {
  it("onParagraph reaches the callback supplied AFTER mount (late-bubbling collab)", () => {
    vi.useFakeTimers();
    const { state, source } = rig();
    const inert = vi.fn();
    const real = vi.fn();
    const { rerender } = renderHook(
      ({ onParagraph }: { onParagraph: (id: string) => void }) =>
        useParaNavHistory({ ...source, onParagraph }, { active: true, scrollEl: null }),
      { initialProps: { onParagraph: inert } },
    );
    rerender({ onParagraph: real });
    record(state, ["A"]);
    expect(real).toHaveBeenCalledWith("A");
    expect(inert).not.toHaveBeenCalled();
  });
});
