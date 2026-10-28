// @vitest-environment jsdom
//
// TASK 1339 — `useMarginaliaHost` subscribes ONCE per editor, and never to
// `update`.
//
// The hook handed `useSyncExternalStore` fresh `subscribe` / `getSnapshot`
// closures every render, so each `Marginalia` render (every `registryVersion`
// bump) tore down and re-added its editor listeners + a RAF. It also kept a raw
// per-transaction `editor.on("update")` subscriber to notice a host element
// appearing — a MOUNT fact a keystroke cannot change. The host is now
// re-resolved on `create`, one RAF after subscribe, and the geometry service's
// viewport channel (which fires when the editor element attaches/detaches).
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const viewportSubs = new Set<() => void>();
const subscribeViewport = vi.fn((cb: () => void) => {
  viewportSubs.add(cb);
  return () => viewportSubs.delete(cb);
});
vi.mock("@/lib/editor-geometry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor-geometry")>();
  return {
    ...actual,
    getOrCreateGeometry: () => ({
      retain: () => () => {},
      subscribeViewport,
      getViewportFrame: () => null,
    }),
  };
});
vi.mock("@/hooks/useMarginaliaRegistry", () => {
  const registry = { getMetrics: () => null };
  return {
    useMarginaliaRegistry: () => registry,
    useRegistryVersion: () => 0,
  };
});

import { render, cleanup } from "@testing-library/react";
import Marginalia from "@/components/Marginalia";

afterEach(() => {
  cleanup();
  viewportSubs.clear();
  subscribeViewport.mockClear();
});

function fakeEditor() {
  const dom = document.createElement("div");
  const on = vi.fn();
  const off = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = { isDestroyed: false, view: { dom }, on, off } as any;
  return { editor, on, off };
}

describe("useMarginaliaHost subscription (task 1339)", () => {
  it("re-rendering Marginalia with the same editor subscribes once — and never to 'update'", () => {
    const { editor, on, off } = fakeEditor();
    const { rerender } = render(<Marginalia editor={editor} markers={[]} panelSides={{} as never} />);
    for (let i = 0; i < 3; i++) {
      rerender(<Marginalia editor={editor} markers={[]} panelSides={{} as never} />);
    }
    const events = on.mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e === "create")).toHaveLength(1);
    expect(events).not.toContain("update");
    expect(off).not.toHaveBeenCalled();
    // The viewport channel is the host-change signal; the lane-regime hook
    // subscribes too, so count the stable total across re-renders.
    const afterFirst = subscribeViewport.mock.calls.length;
    rerender(<Marginalia editor={editor} markers={[]} panelSides={{} as never} />);
    expect(subscribeViewport.mock.calls.length).toBe(afterFirst);
  });

});
