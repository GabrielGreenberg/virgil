// @vitest-environment jsdom
//
// RENDER probe for the view-session hooks. The pure-data round-trip suite
// (view-session-store.test.ts) NEVER mounts the hooks, so it missed the
// `useSyncExternalStore` blocker: `usePanelSelection` / `useListView` returned
// a fresh object on every `getSnapshot` call, which React rejects with
// "getSnapshot should be cached" / "Maximum update depth exceeded" and loops
// the unconditional Library-tab mount path.
//
// This test MOUNTS each hook on BOTH the default (un-seeded) slice and a
// pre-seeded slice, and fails if React logs either symptom. It reproduces the
// crash on the pre-fix code and passes after the cache fix.

import { act } from "react";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  __resetViewSessionForTests,
  setListQuery,
  setSelection,
  togglePaperPin,
  useListView,
  usePanelSelection,
} from "../view-session-store";

// jsdom here doesn't ship a full localStorage; install the same in-memory
// shim the sibling data test uses.
const memStore = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
      setItem: (k: string, v: string) => void memStore.set(k, v),
      removeItem: (k: string) => void memStore.delete(k),
      clear: () => memStore.clear(),
    },
  });
});

beforeEach(() => {
  memStore.clear();
  __resetViewSessionForTests();
});

afterEach(() => {
  cleanup();
});

// Tiny mounts that exercise the two suspect hooks. They render the derived
// values into the DOM so React actually subscribes via useSyncExternalStore.
function SelectionProbe({ scope, panel }: { scope: string; panel: "left" | "right" }) {
  const { selectedKeys, anchorKey } = usePanelSelection(scope, panel);
  return (
    <div data-testid="sel">
      {[...selectedKeys].join(",")}|{anchorKey ?? "∅"}
    </div>
  );
}

function ListViewProbe({
  scope,
  panel,
  libId,
}: {
  scope: string;
  panel: "left" | "right";
  libId: string;
}) {
  const { sort, query, scrollTop } = useListView(scope, panel, libId);
  return (
    <div data-testid="lv">
      {sort.col}/{sort.dir}|{query}|{scrollTop}
    </div>
  );
}

/** Mount `ui`, capturing any console.error. Then drive an UNRELATED store
 *  commit (touches the global `paperPinned` slice, NOT any panel/list slice)
 *  to force every mounted hook's `getSnapshot` to be re-read and compared
 *  across a real notification. An unstable snapshot (fresh ref each call) makes
 *  `useSyncExternalStore` re-render forever → "Maximum update depth" / logs
 *  "getSnapshot should be cached"; a cached one no-ops. Fails on either symptom. */
function expectNoSnapshotLoop(ui: React.ReactElement, label: string) {
  const seen: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
    seen.push(args.map((a) => String(a)).join(" "));
  });
  try {
    const { rerender } = render(<div>{ui}</div>);
    // (1) A store mutation that does NOT change any of the probes' own slices.
    //     With a stable snapshot the probes don't re-render; with an unstable
    //     one the notify forces a fresh getSnapshot that differs and loops.
    act(() => {
      togglePaperPin("paper:unrelated");
    });
    // (2) A parent-driven re-render. React re-reads getSnapshot during the
    //     commit and compares it to the previous value with Object.is — an
    //     unstable hook logs "getSnapshot should be cached" right here even
    //     when (1) alone didn't trip the depth limiter.
    act(() => {
      rerender(<div data-pass="2">{ui}</div>);
    });
  } finally {
    spy.mockRestore();
  }
  const offending = seen.filter((m) =>
    /getSnapshot should be cached|Maximum update depth/i.test(m),
  );
  expect(
    offending,
    `[${label}] React logged a getSnapshot-cache / update-depth error:\n` +
      offending.join("\n"),
  ).toEqual([]);
}

describe("view-session hooks — render stability (getSnapshot cache)", () => {
  it("usePanelSelection mounts cleanly on the DEFAULT (un-seeded) slice", () => {
    expectNoSnapshotLoop(
      <SelectionProbe scope="" panel="left" />,
      "selection/default",
    );
  });

  it("usePanelSelection mounts cleanly on a PRE-SEEDED slice", () => {
    setSelection("", "left", { selectedKeys: ["a", "b"], anchorKey: "a" });
    expectNoSnapshotLoop(
      <SelectionProbe scope="" panel="left" />,
      "selection/seeded",
    );
  });

  it("useListView mounts cleanly on the DEFAULT (un-seeded) slice", () => {
    expectNoSnapshotLoop(
      <ListViewProbe scope="" panel="left" libId="central" />,
      "listview/default",
    );
  });

  it("useListView mounts cleanly on a PRE-SEEDED slice", () => {
    setListQuery("", "left", "central", "kant");
    expectNoSnapshotLoop(
      <ListViewProbe scope="" panel="left" libId="central" />,
      "listview/seeded",
    );
  });

  it("both hooks mount together (the real Library-tab path) without looping", () => {
    expectNoSnapshotLoop(
      <>
        <SelectionProbe scope="" panel="left" />
        <SelectionProbe scope="" panel="right" />
        <ListViewProbe scope="" panel="left" libId="central" />
        <ListViewProbe scope="outer:lib-1" panel="right" libId="paper:foo" />
      </>,
      "combined/default",
    );
  });
});
