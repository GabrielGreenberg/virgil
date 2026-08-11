// @vitest-environment jsdom
//
// The queue is written by BOTH sides — the frontend files intent, a background
// Claude session drains the file and deletes it — and before task 132 it was
// the one cowork channel with no poll: `PaperHeader` read five queue files
// once per mount, and the Reader is kept alive (`display:none`, not a
// remount), so a drained request kept rendering as "queued" forever.
//
// This suite pins the store that closes it:
//   1. a drained file CLEARS the snapshot with no remount (the reported bug);
//   2. an idle tick over an unchanged queue emits NOTHING (the catalog-store
//      R6 rule — a 6 s re-render of the whole Library tree is its own bug);
//   3. the kind comes from the entry, not the filename (index vs authenticate
//      share `<citekey>.json`; the legacy `richIndex` spelling normalizes);
//   4. newest-scan-wins, so a scan in flight when a local write lands can
//      never overwrite the scan that observed the write.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

interface DiskFile {
  kind: string;
  status: string;
  citekey?: string;
}

const disk = vi.hoisted(() => ({
  files: new Map<string, unknown>(),
  listCalls: 0,
  /** ms of latency for the NEXT listDir call only (interleaving test). */
  slowNextList: 0,
}));

vi.mock("../library-storage", () => ({
  SUBDIRS: { queue: ".virgil/queue", notifications: ".virgil/notifications" },
  listDir: vi.fn(async (_root: unknown, path: string) => {
    disk.listCalls += 1;
    const delay = disk.slowNextList;
    disk.slowNextList = 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (path !== ".virgil/queue") return undefined;
    return [...disk.files.keys()].map((name) => ({
      name,
      kind: "file" as const,
    }));
  }),
  readJsonFile: vi.fn(async (_root: unknown, path: string) => {
    const name = path.split("/").pop() ?? "";
    return disk.files.get(name);
  }),
}));

const HANDLE = {} as unknown as FileSystemDirectoryHandle;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function put(name: string, entry: DiskFile) {
  disk.files.set(name, entry);
}

beforeEach(() => {
  vi.resetModules();
  disk.files.clear();
  disk.listCalls = 0;
  disk.slowNextList = 0;
});

afterEach(() => {
  cleanup();
});

async function loadStore() {
  return await import("../queue-state-store");
}

describe("queue-state-store — the queue's missing poll channel", () => {
  it("clears a drained request WITHOUT a remount, and stays silent on an unchanged tick", async () => {
    put("alpha.json", { kind: "index", status: "requested", citekey: "alpha" });
    const { useQueueState, isQueued, refreshQueueState } = await loadStore();

    const renderCounts = new Map<string, number>();
    function Probe() {
      renderCounts.set("probe", (renderCounts.get("probe") ?? 0) + 1);
      const snap = useQueueState(HANDLE);
      return (
        <div
          data-testid="probe"
          data-index={isQueued(snap, "alpha", "index") ? "1" : "0"}
        />
      );
    }
    const renders = () => renderCounts.get("probe") ?? 0;

    const { getByTestId } = render(<Probe />);
    const indexQueued = () => getByTestId("probe").getAttribute("data-index");
    await act(flush);
    expect(indexQueued()).toBe("1");

    // Idle tick — nothing on disk changed. No emit, so no re-render.
    const rendersAfterLoad = renders();
    await act(async () => {
      void refreshQueueState();
      await flush();
    });
    expect(renders()).toBe(rendersAfterLoad);

    // A background skill drains the request and deletes the file. The probe
    // is never unmounted — exactly the kept-alive Reader's situation.
    disk.files.delete("alpha.json");
    await act(async () => {
      void refreshQueueState();
      await flush();
    });
    expect(indexQueued()).toBe("0");
    expect(renders()).toBeGreaterThan(rendersAfterLoad);
  });

  it("reads the kind from the ENTRY, not the filename, and ignores non-requested / non-paper files", async () => {
    // index and authenticate share `<citekey>.json` — only the entry's own
    // `kind` field can tell them apart.
    put("alpha.json", {
      kind: "authenticate",
      status: "requested",
      citekey: "alpha",
    });
    // Legacy spelling of the deep-index kind + filename.
    put("alpha-richindex.json", {
      kind: "richIndex",
      status: "requested",
      citekey: "alpha",
    });
    // In flight, not queued: the checkbox must not claim it is cancellable.
    put("beta-paperreview.json", {
      kind: "paper-review",
      status: "running",
      citekey: "beta",
    });
    // Aggregate / triage / rotated-done files carry no per-paper request.
    put("pending-reviews.json", { kind: "authenticate", status: "requested" });
    put("_triage-something.json", { kind: "triage", status: "requested" });
    put("gamma.done.json", { kind: "index", status: "requested", citekey: "gamma" });

    const { useQueueState, isQueued, hasQueuedRequest, refreshQueueState } =
      await loadStore();
    let snap!: import("../queue-state-store").QueueSnapshot;
    function Probe() {
      snap = useQueueState(HANDLE);
      return null;
    }
    render(<Probe />);
    await act(async () => {
      void refreshQueueState();
      await flush();
    });

    expect(isQueued(snap, "alpha", "authenticate")).toBe(true);
    expect(isQueued(snap, "alpha", "index")).toBe(false);
    expect(isQueued(snap, "alpha", "deepIndex")).toBe(true);
    expect(hasQueuedRequest(snap, "beta")).toBe(false);
    expect(hasQueuedRequest(snap, "gamma")).toBe(false);
    expect(snap.requested.size).toBe(1);
  });

  it("a scan already in flight can never overwrite one that observed a later write", async () => {
    put("alpha.json", { kind: "index", status: "requested", citekey: "alpha" });
    const { useQueueState, hasQueuedRequest, refreshQueueState } =
      await loadStore();
    let snap!: import("../queue-state-store").QueueSnapshot;
    function Probe() {
      snap = useQueueState(HANDLE);
      return null;
    }
    render(<Probe />);
    await act(flush);
    expect(hasQueuedRequest(snap, "alpha")).toBe(true);

    await act(async () => {
      // A poll tick starts and stalls mid-read…
      disk.slowNextList = 30;
      const stale = refreshQueueState();
      // …while the user cancels the request and the writer pushes through.
      disk.files.delete("alpha.json");
      await refreshQueueState();
      await stale;
      await flush();
    });
    expect(hasQueuedRequest(snap, "alpha")).toBe(false);
  });

  it("polls once for N consumers and stops when the last one unmounts", async () => {
    vi.useFakeTimers();
    try {
      put("alpha.json", { kind: "index", status: "requested", citekey: "alpha" });
      const { useQueueState } = await loadStore();
      function Probe() {
        useQueueState(HANDLE);
        return null;
      }
      const a = render(
        <>
          <Probe />
          <Probe />
          <Probe />
        </>,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      const afterMount = disk.listCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      // ONE shared 6 s scan, not one per mounted consumer.
      expect(disk.listCalls).toBe(afterMount + 1);

      a.unmount();
      const afterUnmount = disk.listCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(24000);
      });
      expect(disk.listCalls).toBe(afterUnmount);
    } finally {
      vi.useRealTimers();
    }
  });
});
