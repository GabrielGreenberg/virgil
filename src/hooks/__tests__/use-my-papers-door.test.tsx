// @vitest-environment jsdom
//
// Task 868 — "My Papers" has ONE write door (`mutateMyPapers`), and the hook
// computes every change from the STORED list, never from its React state.
//
// The fake IDB models the property that matters (as in task 601's
// doc-index-mutation-door.test.ts): `update` reads the value WHEN the
// transaction runs; a `get` can be held back to model a slow initial read.
//
// Neutered against the pre-868 hook (a whole-value write of `[...prev, id]`
// from inside the setState updater): the add-before-read leg loses the stored
// ids, and the two-window leg loses one add.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const idb = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  let holdGet: Promise<void> | null = null;
  const pause = () => new Promise<void>((r) => setTimeout(r, 0));
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    data,
    holdNextGet(p: Promise<void>) {
      holdGet = p;
    },
    reset() {
      data.clear();
      holdGet = null;
    },
    api: {
      createStore: () => ({}),
      get: async (key: string) => {
        // The read snapshots NOW; the hold delays only its delivery.
        const v = clone(data.get(key));
        const h = holdGet;
        holdGet = null;
        if (h) await h;
        await pause();
        return v;
      },
      set: async (key: string, value: unknown) => {
        await pause();
        data.set(key, clone(value));
      },
      del: async (key: string) => {
        await pause();
        data.delete(key);
      },
      keys: async () => [...data.keys()],
      update: async (key: string, updater: (old: unknown) => unknown) => {
        await pause();
        data.set(key, clone(updater(clone(data.get(key)))));
      },
    },
  };
});

const bus = vi.hoisted(() => ({
  published: [] as unknown[],
  handlers: new Set<(e: unknown) => void>(),
}));

vi.mock("idb-keyval", () => idb.api);
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => "win-self" }));
vi.mock("@/lib/multi-window/bus", async () => {
  const { useEffect } = await import("react");
  return {
    publish: (e: unknown) => bus.published.push(e),
    useBus: (h: (e: unknown) => void) => {
      useEffect(() => {
        bus.handlers.add(h);
        return () => void bus.handlers.delete(h);
      }, [h]);
    },
  };
});

import { mutateMyPapers, purgeDoc, readMyPapers } from "@/lib/doc-index";
import { useMyPapers } from "@/hooks/useMyPapers";

beforeEach(() => {
  idb.reset();
  bus.published.length = 0;
  bus.handlers.clear();
});

describe("mutateMyPapers — interleaved writers both survive", () => {
  it("two windows adding at once each keep their add", async () => {
    idb.data.set("my-papers", { ids: ["a"] });
    await Promise.all([
      mutateMyPapers((ids) => [...ids, "b"]),
      mutateMyPapers((ids) => [...ids, "c"]),
    ]);
    expect((await readMyPapers()).ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("resolves with the list as written", async () => {
    idb.data.set("my-papers", { ids: ["a"] });
    expect(await mutateMyPapers((ids) => [...ids, "b"])).toEqual(["a", "b"]);
  });
});

describe("useMyPapers — storage is the truth", () => {
  it("an add landing before the initial read resolves keeps the stored ids", async () => {
    idb.data.set("my-papers", { ids: ["a", "b"] });
    let release!: () => void;
    idb.holdNextGet(new Promise<void>((r) => (release = r)));

    const { result } = renderHook(() => useMyPapers());
    act(() => result.current.addMyPaper("c"));

    await waitFor(() =>
      expect((idb.data.get("my-papers") as { ids: string[] }).ids).toEqual(["a", "b", "c"]),
    );
    // The slow initial read (a snapshot of ["a","b"]) resolves LAST — it must
    // not overwrite the newer written list.
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.myPaperIds).toEqual(["a", "b", "c"]);
  });

  it("a peer's add is not erased by this window's later add from stale state", async () => {
    idb.data.set("my-papers", { ids: ["a"] });
    const { result } = renderHook(() => useMyPapers());
    await waitFor(() => expect(result.current.myPaperIds).toEqual(["a"]));

    // A peer window adds "p" — its bus event has not arrived here yet.
    await mutateMyPapers((ids) => [...ids, "p"]);
    act(() => result.current.addMyPaper("c"));
    await waitFor(() => expect(result.current.myPaperIds).toEqual(["a", "p", "c"]));
    expect((await readMyPapers()).ids).toEqual(["a", "p", "c"]);
  });

  it("a peer's change event re-reads storage", async () => {
    const { result } = renderHook(() => useMyPapers());
    await waitFor(() => expect(result.current.myPaperIds).toEqual([]));
    await mutateMyPapers(() => ["x"]);
    act(() => {
      for (const h of bus.handlers) h({ type: "my-papers-changed", windowId: "peer" });
    });
    await waitFor(() => expect(result.current.myPaperIds).toEqual(["x"]));
  });

  it("broadcasts once per change, after the write", async () => {
    const { result } = renderHook(() => useMyPapers());
    act(() => result.current.addMyPaper("a"));
    await waitFor(() => expect(bus.published).toHaveLength(1));
    expect((await readMyPapers()).ids).toEqual(["a"]);
    act(() => result.current.removeMyPaper("a"));
    await waitFor(() => expect(bus.published).toHaveLength(2));
    expect((await readMyPapers()).ids).toEqual([]);
  });
});

describe("purgeDoc and the curated list", () => {
  it("removing a doc identity drops it from My Papers", async () => {
    idb.data.set("my-papers", { ids: ["a", "gone", "b"] });
    await purgeDoc("gone");
    expect((await readMyPapers()).ids).toEqual(["a", "b"]);
  });

  it("a RESET (the example's re-seed) keeps the fixed id listed", async () => {
    idb.data.set("my-papers", { ids: ["example"] });
    await purgeDoc("example", "reset");
    expect((await readMyPapers()).ids).toEqual(["example"]);
  });
});
