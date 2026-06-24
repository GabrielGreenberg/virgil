// @vitest-environment jsdom
//
// The keep-alive primitive: LRU access-order + dedup (the dual-pipeline guard),
// survivor stability (no remount), capacity eviction, and the visibility slot +
// context.

import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, render, cleanup } from "@testing-library/react";
import { useKeepAliveLRU } from "../useKeepAliveLRU";
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
