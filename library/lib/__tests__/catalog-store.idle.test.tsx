// @vitest-environment jsdom
//
// R6 — idle-churn guard for the catalog store's 6 s poll. The FSA handle
// object has a FRESH identity on every resolve (production idb-keyval
// deserializes a new FileSystemDirectoryHandle from the structured clone per
// `get`; dev-storage mints a new synthetic per call), so the store must gate
// its emits on the catalog VERSION alone: an unchanged-version tick must
// produce ZERO notifications (same snapshot identity, no consumer re-render)
// and must not re-read catalog.json. The pre-fix code adopted the fresh
// handle reference on every tick — a setState → whole-Library-tree re-render
// every 6 seconds at idle, in prod too.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const versionRef = vi.hoisted(() => ({ current: "1" }));
const reads = vi.hoisted(() => ({ version: 0, catalog: 0, handle: 0 }));

vi.mock("../catalog", () => ({
  readCatalogVersion: vi.fn(async () => {
    reads.version += 1;
    return versionRef.current;
  }),
  readCatalog: vi.fn(async () => {
    reads.catalog += 1;
    return { entries: [{ citekey: `entry-v${versionRef.current}` }] };
  }),
}));

vi.mock("../library-folder", () => ({
  // Fresh object identity per resolve — the exact R6 trigger.
  getLibraryHandle: vi.fn(async () => {
    reads.handle += 1;
    return {
      queryPermission: async () => "granted" as PermissionState,
    };
  }),
}));

// Macrotask flush so the store's fire-and-forget async reload chain
// (handle → permission → version → catalog → setState) fully settles.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  versionRef.current = "1";
  reads.version = 0;
  reads.catalog = 0;
  reads.handle = 0;
});

afterEach(() => {
  cleanup();
});

describe("catalog-store — idle 6 s poll is silent when the version is unchanged (R6)", () => {
  it("an unchanged-version tick emits nothing despite a fresh handle identity; a version bump still emits", async () => {
    // Fresh module instance so the module-level singleton starts clean.
    const { useCatalogItems, refreshCatalogStore } = await import(
      "../catalog-store"
    );

    // Render-count probe via Map mutation (the sibling LeftList.render.test's
    // renderCounts pattern); the entries snapshot is read back from the
    // rendered DOM so the render stays pure.
    const renderCounts = new Map<string, number>();
    function Probe() {
      renderCounts.set("probe", (renderCounts.get("probe") ?? 0) + 1);
      const { entries } = useCatalogItems();
      return <div data-testid="probe" data-entries={JSON.stringify(entries)} />;
    }
    const renders = () => renderCounts.get("probe") ?? 0;

    const { getByTestId } = render(<Probe />);
    const entriesShown = () =>
      JSON.parse(getByTestId("probe").getAttribute("data-entries") ?? "[]");
    await act(flush); // initial load: resolve handle + read version + catalog
    expect(entriesShown()).toEqual([{ citekey: "entry-v1" }]);
    expect(reads.catalog).toBe(1);

    // Idle tick: same version, brand-new handle object. Must NOT notify —
    // no re-render, no catalog re-read.
    const rendersAfterLoad = renders();
    await act(async () => {
      refreshCatalogStore();
      await flush();
    });
    expect(reads.handle).toBeGreaterThanOrEqual(2); // a fresh handle WAS resolved
    expect(renders()).toBe(rendersAfterLoad);
    expect(reads.catalog).toBe(1);

    // A real change (version bump) still flows through untouched.
    versionRef.current = "2";
    await act(async () => {
      refreshCatalogStore();
      await flush();
    });
    expect(renders()).toBeGreaterThan(rendersAfterLoad);
    expect(reads.catalog).toBe(2);
    expect(entriesShown()).toEqual([{ citekey: "entry-v2" }]);
  });
});
