// @vitest-environment jsdom
//
// The keep-alive primitive: LRU access-order + dedup (the dual-pipeline guard),
// survivor stability (no remount), capacity eviction, and the visibility slot +
// context.

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, render, cleanup } from "@testing-library/react";
import { useKeepAliveLRU, nextKeepAliveOrder } from "../useKeepAliveLRU";
import { KeepAliveSlot } from "../KeepAliveSlot";
import { useIsVisible } from "../visibility-context";

afterEach(cleanup);

describe("useKeepAliveLRU", () => {
  it("promotes the active id to the front and marks only it visible", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useKeepAliveLRU(id, 4),
      { initialProps: { id: "a" as string | null } },
    );
    expect(result.current).toEqual([{ id: "a", isVisible: true }]);

    rerender({ id: "b" });
    expect(result.current.map((e) => e.id)).toEqual(["b", "a"]);
    expect(result.current.find((e) => e.id === "b")!.isVisible).toBe(true);
    expect(result.current.find((e) => e.id === "a")!.isVisible).toBe(false);
  });

  it("DEDUPS — re-visiting an id MOVES it, never duplicates (dual-pipeline guard)", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useKeepAliveLRU(id, 4),
      { initialProps: { id: "a" as string | null } },
    );
    rerender({ id: "b" });
    rerender({ id: "c" });
    rerender({ id: "a" }); // re-visit a
    const ids = result.current.map((e) => e.id);
    expect(ids).toEqual(["a", "c", "b"]); // a moved to front, exactly once
    expect(ids.filter((x) => x === "a")).toHaveLength(1);
  });

  it("slices the tail at capacity (eviction)", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useKeepAliveLRU(id, 2),
      { initialProps: { id: "a" as string | null } },
    );
    rerender({ id: "b" });
    rerender({ id: "c" }); // overflow → evict oldest (a)
    expect(result.current.map((e) => e.id)).toEqual(["c", "b"]);
  });

  it("keeps survivor order stable so kept-alive entries do not remount", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useKeepAliveLRU(id, 4),
      { initialProps: { id: "a" as string | null } },
    );
    rerender({ id: "b" });
    rerender({ id: "c" });
    const before = result.current.map((e) => e.id); // [c, b, a]
    rerender({ id: "c" }); // re-activate the already-front id
    expect(result.current.map((e) => e.id)).toEqual(before); // unchanged → no churn
  });

  it("activeId=null leaves the list intact with everything hidden", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useKeepAliveLRU(id, 4),
      { initialProps: { id: "a" as string | null } },
    );
    rerender({ id: "b" });
    rerender({ id: null });
    expect(result.current.map((e) => e.id)).toEqual(["b", "a"]); // kept warm
    expect(result.current.every((e) => !e.isVisible)).toBe(true); // none shown
  });
});

describe("useKeepAliveLRU — LIVE population (task 1456)", () => {
  type P = { id: string | null; isLive: (id: string) => boolean };
  const liveExcept = (...dead: string[]) => (id: string) => !dead.includes(id);

  it("a dead id does not spend a slot: closing B then opening D keeps A warm", () => {
    const all = liveExcept();
    const { result, rerender } = renderHook(
      ({ id, isLive }: P) => useKeepAliveLRU(id, 3, isLive),
      { initialProps: { id: "a", isLive: all } as P },
    );
    rerender({ id: "b", isLive: all });
    rerender({ id: "c", isLive: all }); // [c, b, a]
    rerender({ id: "c", isLive: liveExcept("b") }); // close B
    expect(result.current.map((e) => e.id)).toEqual(["c", "a"]); // pruned at the SOURCE
    rerender({ id: "d", isLive: liveExcept("b") }); // open D
    expect(result.current.map((e) => e.id)).toEqual(["d", "c", "a"]); // A survives
  });

  it("prunes in the same transition as the activation (dead on arrival)", () => {
    const all = liveExcept();
    const { result, rerender } = renderHook(
      ({ id, isLive }: P) => useKeepAliveLRU(id, 3, isLive),
      { initialProps: { id: "a", isLive: all } as P },
    );
    rerender({ id: "b", isLive: all });
    rerender({ id: "c", isLive: all });
    rerender({ id: "d", isLive: liveExcept("b") }); // B failed + D opened at once
    expect(result.current.map((e) => e.id)).toEqual(["d", "c", "a"]);
  });

  it("never prunes the ACTIVE id, even if the predicate calls it dead", () => {
    const { result } = renderHook(
      ({ id, isLive }: P) => useKeepAliveLRU(id, 3, isLive),
      { initialProps: { id: "a", isLive: liveExcept("a") } as P },
    );
    expect(result.current).toEqual([{ id: "a", isVisible: true }]);
  });

  it("an unchanged live set returns the SAME entries (no churn, no remount)", () => {
    const all = liveExcept();
    const { result, rerender } = renderHook(
      ({ id, isLive }: P) => useKeepAliveLRU(id, 3, isLive),
      { initialProps: { id: "a", isLive: all } as P },
    );
    rerender({ id: "b", isLive: all });
    const before = result.current;
    rerender({ id: "b", isLive: liveExcept("zzz") }); // new predicate, same verdicts
    expect(result.current).toBe(before);
  });
});

describe("nextKeepAliveOrder", () => {
  it("returns prev by identity when nothing changes", () => {
    const prev = ["c", "b", "a"];
    expect(nextKeepAliveOrder(prev, "c", 3, () => true)).toBe(prev);
    expect(nextKeepAliveOrder(prev, null, 3, () => true)).toBe(prev);
  });
  it("prunes before slicing so capacity counts only live ids", () => {
    expect(
      nextKeepAliveOrder(["c", "b", "a"], "d", 3, (id) => id !== "b"),
    ).toEqual(["d", "c", "a"]);
  });
});

describe("KeepAliveSlot + useIsVisible", () => {
  function Probe() {
    return <span data-testid="vis">{String(useIsVisible())}</span>;
  }

  it("renders display:none when hidden and publishes isVisible to descendants", () => {
    const { container, getByTestId, rerender } = render(
      <KeepAliveSlot isVisible={false}>
        <Probe />
      </KeepAliveSlot>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.display).toBe("none");
    expect(getByTestId("vis").textContent).toBe("false");

    rerender(
      <KeepAliveSlot isVisible={true}>
        <Probe />
      </KeepAliveSlot>,
    );
    expect((container.firstElementChild as HTMLElement).style.display).toBe("flex");
    expect(getByTestId("vis").textContent).toBe("true");
  });

  it("useIsVisible defaults to true with no provider", () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("vis").textContent).toBe("true");
  });
});
