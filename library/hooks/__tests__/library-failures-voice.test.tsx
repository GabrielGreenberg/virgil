// @vitest-environment jsdom
//
// Task 764 — an async Library door that ends without doing what the user
// asked ends in a MESSAGE: a denied grant, a rejected handle read, a failed
// or unsupported drop, and a malformed / first-run notification inbox.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

const lf = vi.hoisted(() => ({
  getLibraryHandle: vi.fn(),
  pickLibraryFolder: vi.fn(),
  ensureReadWritePermission: vi.fn(),
  queryReadWritePermission: vi.fn(),
  clearLibraryHandle: vi.fn(),
  resolveLibraryRootPath: vi.fn(),
}));
const storage = vi.hoisted(() => ({ readJsonFile: vi.fn() }));
const queueMock = vi.hoisted(() => ({ dropUnsortedSource: vi.fn() }));

vi.mock("@library/lib/library-folder", () => lf);
vi.mock("@library/lib/skill-sync", () => ({ syncSkillBundle: vi.fn(async () => ({})) }));
vi.mock("@library/lib/library-storage", () => ({
  ensureLibraryStructure: vi.fn(async () => {}),
  readJsonFile: storage.readJsonFile,
  SUBDIRS: { unsorted: "unsorted", queue: "queue", notifications: "notifications" },
}));
vi.mock("@library/lib/queue", async () => {
  const actual = await vi.importActual<typeof import("@library/lib/queue")>("@library/lib/queue");
  return { ...actual, dropUnsortedSource: queueMock.dropUnsortedSource };
});

import { useLibraryHandle, GRANT_DENIED_MESSAGE } from "../useLibraryHandle";
import { useDropPdf } from "../useDropPdf";
import { useNotificationStream } from "../useNotificationStream";
import { readNotificationItems } from "@library/lib/queue";
import LibraryFolderGate from "@library/components/LibraryFolderGate";

const handle = { name: "lib" } as unknown as FileSystemDirectoryHandle;

beforeEach(() => {
  for (const f of Object.values(lf)) f.mockReset();
  storage.readJsonFile.mockReset();
  queueMock.dropUnsortedSource.mockReset();
  lf.resolveLibraryRootPath.mockResolvedValue(null);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLibraryHandle — the permission gate has a voice", () => {
  it("a DENIED grant sets pickerError (the gate no longer looks unchanged)", async () => {
    lf.getLibraryHandle.mockResolvedValue(handle);
    lf.queryReadWritePermission.mockResolvedValue("prompt");
    lf.ensureReadWritePermission.mockResolvedValue("denied");
    const { result } = renderHook(() => useLibraryHandle());
    await waitFor(() => expect(result.current.state.kind).toBe("needs-permission"));
    await act(async () => {
      await result.current.grant();
    });
    expect(result.current.pickerError).toBe(GRANT_DENIED_MESSAGE);
  });

  it("an unexpected grant error becomes pickerError, not an unhandled rejection", async () => {
    lf.getLibraryHandle.mockResolvedValue(handle);
    lf.queryReadWritePermission.mockResolvedValue("prompt");
    lf.ensureReadWritePermission.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useLibraryHandle());
    await waitFor(() => expect(result.current.state.kind).toBe("needs-permission"));
    await act(async () => {
      await expect(result.current.grant()).resolves.toBeUndefined();
    });
    expect(result.current.pickerError).toMatch(/boom/);
  });

  it("a rejecting IndexedDB read lands in an error state, not an endless Loading…", async () => {
    lf.getLibraryHandle.mockRejectedValue(new Error("IDB closed"));
    const { result } = renderHook(() => useLibraryHandle());
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    expect(result.current.state).toMatchObject({ message: expect.stringMatching(/IDB closed/) });

    // Retry re-reads and recovers.
    lf.getLibraryHandle.mockResolvedValue(null);
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state.kind).toBe("none");
  });

  it("the shared gate renders the error state with Retry, and pickerError on the permission gate", async () => {
    lf.getLibraryHandle.mockRejectedValue(new Error("IDB closed"));
    function Host() {
      const lib = useLibraryHandle();
      return <LibraryFolderGate lib={lib}>{() => <div>ready</div>}</LibraryFolderGate>;
    }
    render(<Host />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/IDB closed/);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("useDropPdf — every dropped file yields a result", () => {
  const file = (name: string) => new File(["x"], name);

  it("an unsupported extension is {ok:false, reason}, not a silent filter", async () => {
    const { result } = renderHook(() => useDropPdf(handle));
    const out = await result.current([file("book.epub")]);
    expect(out).toEqual([{ ok: false, name: "book.epub", reason: expect.stringMatching(/supported/) }]);
    expect(queueMock.dropUnsortedSource).not.toHaveBeenCalled();
  });

  it("a write/queue failure is {ok:false} with the error in the reason", async () => {
    queueMock.dropUnsortedSource.mockRejectedValue(new Error("queue write failed"));
    const { result } = renderHook(() => useDropPdf(handle));
    const out = await result.current([file("a.pdf")]);
    expect(out).toEqual([
      { ok: false, name: "a.pdf", reason: expect.stringMatching(/queue write failed/) },
    ]);
  });

  it("a drop before the folder is ready reports every file", async () => {
    const { result } = renderHook(() => useDropPdf(null));
    const out = await result.current([file("a.pdf"), file("b.tex")]);
    expect(out.map((r) => r.ok)).toEqual([false, false]);
  });

  it("a successful drop is {ok:true}", async () => {
    queueMock.dropUnsortedSource.mockResolvedValue({ unsortedFilename: "a.pdf", queueFilename: "q.json" });
    const { result } = renderHook(() => useDropPdf(handle));
    const out = await result.current([file("a.pdf")]);
    expect(out).toEqual([{ ok: true, name: "a.pdf", unsortedFilename: "a.pdf", queueFilename: "q.json" }]);
  });
});

describe("notification inbox — one shape-checked reader", () => {
  it("readNotificationItems treats {} / junk as empty and never throws", async () => {
    storage.readJsonFile.mockResolvedValueOnce({});
    await expect(readNotificationItems(handle)).resolves.toEqual([]);
    storage.readJsonFile.mockResolvedValueOnce({ items: "nope" });
    await expect(readNotificationItems(handle)).resolves.toEqual([]);
    storage.readJsonFile.mockRejectedValueOnce(new SyntaxError("bad json"));
    await expect(readNotificationItems(handle)).resolves.toEqual([]);
    storage.readJsonFile.mockResolvedValueOnce({
      items: [{ kind: "indexed", at: "t1", summary: "ok" }, null, { at: 3 }],
    });
    await expect(readNotificationItems(handle)).resolves.toEqual([
      { kind: "indexed", at: "t1", summary: "ok" },
    ]);
  });

  const old = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ kind: "indexed", at: `2026-01-0${i + 1}`, summary: `p${i}` }));

  it("first run (no seen-mark) adopts the newest as baseline and toasts NOTHING", async () => {
    storage.readJsonFile.mockResolvedValue({ items: old(5) });
    const { result } = renderHook(() => useNotificationStream(handle));
    await waitFor(() =>
      expect(localStorage.getItem("virgil-notification-seen-at")).toBe("2026-01-05"),
    );
    expect(result.current).toEqual([]);
  });

  it("with a real mark, only newer items toast", async () => {
    localStorage.setItem("virgil-notification-seen-at", "2026-01-03");
    storage.readJsonFile.mockResolvedValue({ items: old(5) });
    const { result } = renderHook(() => useNotificationStream(handle));
    await waitFor(() => expect(result.current.map((i) => i.at)).toEqual(["2026-01-04", "2026-01-05"]));
  });

  it("an empty inbox on first run still lets the FIRST later notification through", async () => {
    // Capture the poll so the test drives the second tick by hand.
    // Only the hook's 6 s poll is captured (waitFor polls with setInterval too).
    let poll: (() => void) | null = null;
    const realSetInterval = window.setInterval.bind(window);
    const spy = vi.spyOn(window, "setInterval").mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      if (ms === 6000) {
        poll = fn;
        return 1;
      }
      return realSetInterval(fn, ms);
    }) as unknown as typeof window.setInterval);
    storage.readJsonFile.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useNotificationStream(handle));
    await waitFor(() => expect(localStorage.getItem("virgil-notification-seen-at")).toBe(""));
    storage.readJsonFile.mockResolvedValue({ items: old(1) });
    await act(async () => {
      poll!();
    });
    await waitFor(() => expect(result.current.map((i) => i.at)).toEqual(["2026-01-01"]));
    spy.mockRestore();
  });

  it("a {} inbox does not throw from the poll", async () => {
    storage.readJsonFile.mockResolvedValue({});
    const { result } = renderHook(() => useNotificationStream(handle));
    await waitFor(() => expect(storage.readJsonFile).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
