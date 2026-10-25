// @vitest-environment jsdom
//
// Task 1283 — "this selection change must not scroll the document" is a
// PLACEMENT INTENT on the doc's own CardStore, bound to the selection change
// it governs. It used to be one module-level boolean (`_suppressNextPlacement`)
// consumed up front by EVERY `usePlacement` effect run in EVERY mounted pane,
// which broke the per-doc-services law two ways:
//   1. cross-pane consumption — another pane's effect ran first and ate pane
//      A's flag, so A aligned (dragged the document) anyway;
//   2. stranding — a no-op select (same ref) raised the flag with no
//      selection change to consume it, so the NEXT real card→text selection's
//      alignment was silently swallowed.
// Both legs are pinned here against the real store + the real hook; only the
// geometry leaves (anchor resolution, the alignment door) are stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { act } from "react";

vi.mock("@/components/editor-layout/layout-scroll", () => ({
  alignEntryToYIfNeeded: vi.fn(),
}));
vi.mock("@/links/links", () => ({
  resolveLink: () => ({ domEl: document.getElementById("anchor") }),
}));
vi.mock("../card-anchor-links", () => ({
  linksForCardRef: () => [{ fake: true }],
}));

import { alignEntryToYIfNeeded } from "@/components/editor-layout/layout-scroll";
import { usePlacement } from "../usePlacement";
import { createCardStore, type AnchoredCardRef, type CardStore } from "../anchored-card-store";
import { cardKeyForEntity } from "../entity-hover";

const alignMock = vi.mocked(alignEntryToYIfNeeded);
const editor = { isDestroyed: false, isInitialized: true } as never;

function Host({ store, tick }: { store: CardStore; tick: number }) {
  // `collections` is a fresh literal each render, exactly as at the real call
  // site — so the effect re-runs on every render of this host.
  void tick;
  usePlacement({ editor, collections: {} as never, store });
  return null;
}

function mountCard(ref: AnchoredCardRef): void {
  const el = document.createElement("div");
  el.setAttribute("data-card-key", cardKeyForEntity(ref)!);
  document.body.appendChild(el);
}

const A: AnchoredCardRef = { kind: "note", id: "a" };
const B: AnchoredCardRef = { kind: "note", id: "b" };

beforeEach(() => {
  alignMock.mockClear();
  const anchor = document.createElement("span");
  anchor.id = "anchor";
  document.body.appendChild(anchor);
  mountCard(A);
  mountCard(B);
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("placement intent rides the doc's own CardStore (task 1283)", () => {
  it("a suppressed select on store A is not consumed by host B re-rendering", () => {
    const storeA = createCardStore();
    const storeB = createCardStore();
    // Host B mounts FIRST, so its effect runs earlier in the commit — the
    // order in which the old single slot was stolen.
    const tree = (tick: number) => (
      <>
        <Host store={storeB} tick={tick} />
        <Host store={storeA} tick={tick} />
      </>
    );
    const r = render(tree(0));
    act(() => {
      storeA.select(A, { placement: "none" });
      r.rerender(tree(1));
    });
    expect(alignMock).not.toHaveBeenCalled();
  });

  it("an unsuppressed select still aligns (the intent is not sticky)", () => {
    const store = createCardStore();
    render(<Host store={store} tick={0} />);
    act(() => store.select(A, { placement: "none" }));
    act(() => store.select(B));
    expect(alignMock).toHaveBeenCalledTimes(1);
  });

  it("a no-op suppressed select cannot strand the next real selection's alignment", () => {
    const store = createCardStore();
    store.select(A);
    const r = render(<Host store={store} tick={0} />);
    alignMock.mockClear();
    // Re-click an already-selected atom: select() is a no-op on an equal ref.
    act(() => store.select(A, { placement: "none" }));
    expect(store.getState().placementSuppressedFor).toBeNull();
    // Then a real card→text selection: its alignment must run.
    act(() => {
      store.select(B);
      r.rerender(<Host store={store} tick={1} />);
    });
    expect(alignMock).toHaveBeenCalledTimes(1);
  });

  it("withoutPlacement tags only the selection changes made inside its scope", () => {
    const store = createCardStore();
    store.withoutPlacement(() => store.select(A));
    expect(store.isPlacementSuppressed(A)).toBe(true);
    store.select(B);
    expect(store.isPlacementSuppressed(B)).toBe(false);
    store.clearSelection();
    expect(store.getState().placementSuppressedFor).toBeNull();
  });

  it("CENSUS: usePlacement.ts holds no module-level mutable flag", () => {
    const src = readFileSync(join(__dirname, "..", "usePlacement.ts"), "utf8");
    expect(src).not.toMatch(/^let\s/m);
    expect(src).not.toMatch(/suppressNextPlacement|consumeSuppressFlag/);
  });
});
