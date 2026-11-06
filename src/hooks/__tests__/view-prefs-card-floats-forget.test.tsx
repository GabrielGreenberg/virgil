// @vitest-environment jsdom
//
// Task 1491 — a forgotten document's popped-float slice does not outlive it.
//
// `cardFloats[docId]` (task 1400) was removed only when it EMPTIED; `purgeDoc`
// ran every registered doc-forget and none touched view prefs, so a deleted
// paper's keys + rects stayed in the window blob forever and "Reset example"
// (same fixed id) reopened the discarded copy's floats. Pinned here: the
// forget drops the slice from live prefs, from this window's blob and from
// every other stored window blob, tells live peers on the bus, and leaves
// other owners alone; and the load door keeps only an OPEN key's rect.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "forget-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
const busHandlers = new Set<(e: { type: string; docId?: string }) => void>();
const published: Array<{ type: string; docId?: string }> = [];
vi.mock("@/lib/multi-window/bus", () => ({
  publish: (e: { type: string }) => void published.push(e),
  subscribe: (fn: (e: { type: string }) => void) => {
    busHandlers.add(fn);
    return () => busHandlers.delete(fn);
  },
}));

import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useViewPrefs, loadPrefs } from "../useViewPrefs";
import { forgetDocInMemory } from "@/lib/doc-forget";
import { forgetCardFloatOwner } from "@/floats/owner-floats";

const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;
const PEER_KEY = "virgil-view-prefs/window/peer-window";
const read = (k: string) => JSON.parse(localStorage.getItem(k) || "{}");
const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

const KEY = "float:card:note:n1";
const RECT = { x: 1, y: 2, width: 3, height: 4 };

function FloatProbe() {
  const vp = useViewPrefs();
  return (
    <>
      <button data-testid="pop-a" onClick={() => vp.toggleCardPopout("docA", KEY)} />
      <button data-testid="pop-b" onClick={() => vp.toggleCardPopout("docB", KEY)} />
      <span data-testid="floats">{JSON.stringify(vp.prefs.cardFloats)}</span>
    </>
  );
}

beforeAll(() => {
  installStorageShim("localStorage");
  installStorageShim("sessionStorage");
});
beforeEach(() => {
  localStorage.clear();
  published.length = 0;
});
afterEach(cleanup);

describe("forgetCardFloatOwner", () => {
  it("drops the whole slice, seeded rects included; same reference when absent", () => {
    const floats = {
      docA: { keys: [KEY], positions: { [KEY]: RECT, "float:card:note:seed": RECT } },
      docB: { keys: [KEY], positions: {} },
    };
    expect(forgetCardFloatOwner(floats, "docA")).toEqual({ docB: floats.docB });
    expect(forgetCardFloatOwner(floats, "docZ")).toBe(floats);
  });
});

describe("a forgotten document's floats do not outlive it (task 1491)", () => {
  it("purge drops the slice from live prefs and this window's blob; other owners untouched", () => {
    const { getByTestId } = render(<FloatProbe />);
    fireEvent.click(getByTestId("pop-a"));
    fireEvent.click(getByTestId("pop-b"));
    expect(Object.keys(read(WINDOW_KEY).cardFloats).sort()).toEqual(["docA", "docB"]);

    act(() => forgetDocInMemory("docA", "remove"));

    expect(JSON.parse(getByTestId("floats").textContent!)).toEqual({
      docB: { keys: [KEY], positions: {} },
    });
    expect(read(WINDOW_KEY).cardFloats).toEqual({ docB: { keys: [KEY], positions: {} } });
  });

  it("a closed window's stored blob is scrubbed too, its other keys kept", () => {
    write(PEER_KEY, {
      collapsedLeft: true,
      cardFloats: { docA: { keys: [KEY], positions: { [KEY]: RECT } }, docB: { keys: [KEY], positions: {} } },
    });
    forgetDocInMemory("docA", "remove");
    expect(read(PEER_KEY)).toEqual({
      collapsedLeft: true,
      cardFloats: { docB: { keys: [KEY], positions: {} } },
    });
  });

  it("live peer windows are told on the bus, and a peer's event drops this window's copy", () => {
    const { getByTestId } = render(<FloatProbe />);
    fireEvent.click(getByTestId("pop-a"));
    forgetDocInMemory("docZ", "remove");
    expect(published).toContainEqual({ type: "card-floats-forgotten", docId: "docZ" });

    act(() => {
      for (const h of busHandlers) h({ type: "card-floats-forgotten", docId: "docA" });
    });
    expect(JSON.parse(getByTestId("floats").textContent!)).toEqual({});
    expect(read(WINDOW_KEY).cardFloats ?? {}).toEqual({});
  });

  it("a reset (same id) starts with no floats", () => {
    const { getByTestId, unmount } = render(<FloatProbe />);
    fireEvent.click(getByTestId("pop-a"));
    act(() => forgetDocInMemory("docA", "reset"));
    unmount();
    expect(loadPrefs().cardFloats).toEqual({});
  });
});

describe("the load door keeps only an open key's rect", () => {
  it("a seeded rect for a never-opened key is dropped; a slice left empty is dropped whole", () => {
    write(WINDOW_KEY, {
      cardFloats: {
        docA: { keys: [KEY], positions: { [KEY]: RECT, "float:card:note:seed": RECT } },
        docB: { keys: [], positions: { "float:card:note:seed": RECT } },
      },
    });
    expect(loadPrefs().cardFloats).toEqual({ docA: { keys: [KEY], positions: { [KEY]: RECT } } });
  });
});
