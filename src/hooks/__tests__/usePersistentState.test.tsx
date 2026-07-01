// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readSidecar: (...args: unknown[]) => mockRead(...args),
  readSidecarIfExists: (...args: unknown[]) => mockRead(...args),
  writeSidecar: (...args: unknown[]) => mockWrite(...args),
}));

import { type ReactNode } from "react";
import { usePersistentState } from "../usePersistentState";
import {
  SIDECAR_CHANGED_EVENT,
  dispatchSidecarChanged,
} from "@/lib/sidecar-watcher";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import {
  READER_CHROME,
  type EditorChromeConfig,
} from "@/components/editor-layout/chrome-config";

interface Shape {
  items: string[];
}

const EMPTY: Shape = { items: [] };

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

// Unmount every rendered hook between tests so their window event listeners
// (the live external-sidecar re-read subscription) don't leak across cases — a
// leaked listener from a prior `doc-live`/`revisions.json` test would re-read on
// the next test's dispatch and inflate the mockRead call count.
afterEach(() => {
  cleanup();
});

/**
 * The handle the storage layer is called with is opaque from the test's
 * point of view (its pipelineId is freshly minted on every begin call).
 * Most tests don't care about the exact handle — they care that the
 * write happens against the correct docId, with the right filename and
 * payload.
 */
function expectWriteToDoc(docId: string, filename: string, payload: unknown) {
  const calls = mockWrite.mock.calls;
  const matched = calls.find(
    ([handle, fn, p]) =>
      handle &&
      typeof handle === "object" &&
      handle.docId === docId &&
      fn === filename &&
      JSON.stringify(p) === JSON.stringify(payload),
  );
  expect(matched, `expected writeSidecar(${docId}, ${filename}, …)`).toBeTruthy();
}

describe("usePersistentState", () => {
  it("hydrates state from readSidecar on mount", async () => {
    beginDocPipeline("doc-1");
    mockRead.mockResolvedValue({ items: ["a", "b"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["a", "b"]));
    expect(mockRead).toHaveBeenCalledWith("doc-1", "test.json");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("persists on update() to the active pipeline's handle", async () => {
    beginDocPipeline("doc-1");
    mockRead.mockResolvedValue(EMPTY);
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    expect(result.current.state.items).toEqual(["x"]);
    await waitFor(() =>
      expectWriteToDoc("doc-1", "test.json", { items: ["x"] }),
    );
  });

  it("does not write when no pipeline is active", async () => {
    // No beginDocPipeline call — handle lookup returns null.
    mockRead.mockResolvedValue(EMPTY);
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    // State updates locally but the write is dropped.
    expect(result.current.state.items).toEqual(["x"]);
    // Give any pending microtasks a chance to drain.
    await Promise.resolve();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("resets to defaultValue without writing when docId becomes null", async () => {
    beginDocPipeline("doc-1");
    mockRead.mockResolvedValue({ items: ["loaded"] });
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) =>
        usePersistentState<Shape>(id, "test.json", EMPTY),
      { initialProps: { id: "doc-1" as string | null } },
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["loaded"]));

    mockWrite.mockClear();
    rerender({ id: null });
    await waitFor(() => expect(result.current.state).toBe(EMPTY));
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("reloads when docId switches", async () => {
    beginDocPipeline("doc-1");
    beginDocPipeline("doc-2");
    mockRead
      .mockResolvedValueOnce({ items: ["from-doc-1"] })
      .mockResolvedValueOnce({ items: ["from-doc-2"] });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        usePersistentState<Shape>(id, "test.json", EMPTY),
      { initialProps: { id: "doc-1" } },
    );
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["from-doc-1"]),
    );
    rerender({ id: "doc-2" });
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["from-doc-2"]),
    );
  });

  it("runs migrate() on loaded data", async () => {
    beginDocPipeline("doc-1");
    mockRead.mockResolvedValue({ items: ["raw"] });
    const migrate = vi.fn((raw: unknown) => {
      const r = raw as Shape;
      return { items: r.items.map((s) => s.toUpperCase()) };
    });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY, { migrate }),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["RAW"]));
    expect(migrate).toHaveBeenCalledWith({ items: ["raw"] });
  });

  it("persists migrated state when persistMigrationOnLoad is true", async () => {
    beginDocPipeline("doc-1");
    mockRead.mockResolvedValue({ items: ["legacy"] });
    const migrate = (raw: unknown) => {
      const r = raw as Shape;
      return { items: r.items.map((s) => s + "-upgraded") };
    };
    renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY, {
        migrate,
        persistMigrationOnLoad: true,
      }),
    );
    await waitFor(() =>
      expectWriteToDoc("doc-1", "test.json", { items: ["legacy-upgraded"] }),
    );
  });

  it("drops the write when the pipeline ended before persist resolves", async () => {
    const h = beginDocPipeline("doc-1");
    mockRead.mockResolvedValue(EMPTY);
    // Make writeSidecar throw a StalePipelineError as the storage layer
    // would once the handle is invalidated. The hook should swallow it.
    const { StalePipelineError } = await import("@/lib/multi-window/doc-pipeline");
    mockWrite.mockRejectedValue(new StalePipelineError("doc-1", h.pipelineId, "ended", null));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-1", "test.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    await Promise.resolve();
    await Promise.resolve();
    // No console.error fired — stale-pipeline rejections are silent.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

/**
 * Reader write-guard ENGAGEMENT, mounted through the real React context.
 *
 * `usePersistentState` reads `useEditorChrome()` and consults
 * `isSidecarWriteAllowed(chrome, filename)` before every disk write. The unit
 * test `sidecar-write-guard.test.ts` proves the predicate in isolation, but it
 * CANNOT catch the provider-placement defect this fix addresses: if no
 * `EditorChromeProvider` is an ancestor of the hook, `useContext` falls back to
 * the `FULL_CHROME` createContext default and the guard silently never engages
 * (a load-only Mode-A reconcile would then write card sidecars to disk on a
 * read-only library-paper open).
 *
 * These cases pin the END-TO-END contract: a hook rendered UNDER
 * `<EditorChromeProvider value={READER_CHROME}>` must REFUSE a non-note card
 * write and ALLOW a note write, while a hook with NO provider (main-app
 * default = FULL_CHROME) must keep writing everything. A regression that
 * detaches the provider from the hook's write path (the bug this fix repairs)
 * fails the first case here, where the in-isolation predicate test would still
 * pass.
 */
function chromeWrapper(value: EditorChromeConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <EditorChromeProvider value={value}>{children}</EditorChromeProvider>;
  };
}

describe("usePersistentState — Reader write-guard engages through context", () => {
  it("REFUSES a non-note card sidecar (todos.json) under READER_CHROME", async () => {
    beginDocPipeline("doc-guard");
    mockRead.mockResolvedValue(EMPTY);
    const { result } = renderHook(
      () => usePersistentState<Shape>("doc-guard", "todos.json", EMPTY),
      { wrapper: chromeWrapper(READER_CHROME) },
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    // In-memory state still updates; the DISK write is dropped by the guard.
    expect(result.current.state.items).toEqual(["x"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("ALLOWS the note sidecar (notes.json) under READER_CHROME", async () => {
    beginDocPipeline("doc-guard");
    mockRead.mockResolvedValue(EMPTY);
    const { result } = renderHook(
      () => usePersistentState<Shape>("doc-guard", "notes.json", EMPTY),
      { wrapper: chromeWrapper(READER_CHROME) },
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    await waitFor(() =>
      expectWriteToDoc("doc-guard", "notes.json", { items: ["x"] }),
    );
  });

  it("ALLOWS a non-note card sidecar with NO provider (main-app FULL_CHROME default)", async () => {
    // No wrapper → useEditorChrome() resolves the createContext default
    // (FULL_CHROME). This is the main-app path: everything stays writable.
    beginDocPipeline("doc-guard");
    mockRead.mockResolvedValue(EMPTY);
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-guard", "todos.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    await waitFor(() =>
      expectWriteToDoc("doc-guard", "todos.json", { items: ["x"] }),
    );
  });

  it("ALSO refuses an explicit FULL_CHROME-less Reader provider for reports.json", async () => {
    // A second non-note kind, to prove the guard isn't notes-specific.
    beginDocPipeline("doc-guard");
    mockRead.mockResolvedValue(EMPTY);
    const { result } = renderHook(
      () => usePersistentState<Shape>("doc-guard", "reports.json", EMPTY),
      { wrapper: chromeWrapper(READER_CHROME) },
    );
    await waitFor(() => expect(result.current.state).toEqual(EMPTY));

    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "x"] }));
    });
    expect(result.current.state.items).toEqual(["x"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

/**
 * LIVE external-sidecar reactivity: a `virgil-sidecar-changed` event (dispatched
 * by the SidecarWatcher after it invalidated the bundle) makes the owning
 * instance re-read from disk — but ONLY when clean (no pending local edit).
 *
 * The event carries `{docId, filename}`; each hook instance re-reads iff BOTH
 * match its own docId+filename, and iff it has no in-flight debounced write
 * (the dirty guard — no clobber of a local card edit). These tests drive the
 * event directly (no watcher / no timers).
 */
describe("usePersistentState — live external-sidecar re-read", () => {
  it("re-reads on a matching event when CLEAN and updates state", async () => {
    beginDocPipeline("doc-live");
    mockRead.mockResolvedValue({ items: ["initial"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-live", "revisions.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["initial"]));

    // Simulate an out-of-band write: the next read returns the AI-drafted card.
    mockRead.mockResolvedValue({ items: ["initial", "ai-drafted"] });
    act(() => {
      dispatchSidecarChanged({ docId: "doc-live", filename: "revisions.json" });
    });

    await waitFor(() =>
      expect(result.current.state.items).toEqual(["initial", "ai-drafted"]),
    );
  });

  it("IGNORES an event for a DIFFERENT filename (per-instance scoping)", async () => {
    beginDocPipeline("doc-live");
    mockRead.mockResolvedValue({ items: ["revs"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-live", "revisions.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["revs"]));

    mockRead.mockClear();
    // An event for cutter.json must not touch this revisions.json instance.
    act(() => {
      dispatchSidecarChanged({ docId: "doc-live", filename: "cutter.json" });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRead).not.toHaveBeenCalled();
    expect(result.current.state.items).toEqual(["revs"]);
  });

  it("IGNORES an event for a DIFFERENT docId", async () => {
    beginDocPipeline("doc-live");
    mockRead.mockResolvedValue({ items: ["revs"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-live", "revisions.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["revs"]));

    mockRead.mockClear();
    act(() => {
      dispatchSidecarChanged({ docId: "other-doc", filename: "revisions.json" });
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRead).not.toHaveBeenCalled();
    expect(result.current.state.items).toEqual(["revs"]);
  });

  it("DEFERS the re-read (no clobber) while a local edit is pending its debounced write", async () => {
    beginDocPipeline("doc-live");
    mockRead.mockResolvedValue({ items: ["initial"] });
    const { result } = renderHook(() =>
      // debounceMs > 0 so a pending write exists between update() and its flush.
      usePersistentState<Shape>("doc-live", "revisions.json", EMPTY, {
        debounceMs: 5000,
      }),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["initial"]));

    // Local edit → arms a pending debounced write (the DIRTY signal).
    act(() => {
      result.current.update((prev) => ({ items: [...prev.items, "local-edit"] }));
    });
    expect(result.current.state.items).toEqual(["initial", "local-edit"]);

    // An external event arrives WHILE dirty. It must be deferred — the local
    // edit is preserved, and the read is NOT run (so the on-disk value can't
    // stomp the unsaved local edit).
    mockRead.mockClear();
    mockRead.mockResolvedValue({ items: ["initial", "external-only"] });
    act(() => {
      dispatchSidecarChanged({ docId: "doc-live", filename: "revisions.json" });
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRead).not.toHaveBeenCalled(); // deferred
    expect(result.current.state.items).toEqual(["initial", "local-edit"]); // preserved
  });

  it("resets to the default when the sidecar was externally REMOVED (read returns null)", async () => {
    beginDocPipeline("doc-live");
    mockRead.mockResolvedValue({ items: ["will-be-removed"] });
    const { result } = renderHook(() =>
      usePersistentState<Shape>("doc-live", "revisions.json", EMPTY),
    );
    await waitFor(() =>
      expect(result.current.state.items).toEqual(["will-be-removed"]),
    );

    // The watcher's re-read now hits an absent file → readSidecarIfExists null.
    mockRead.mockResolvedValue(null);
    act(() => {
      dispatchSidecarChanged({ docId: "doc-live", filename: "revisions.json" });
    });
    await waitFor(() => expect(result.current.state).toBe(EMPTY));
  });

  it("unsubscribes from the event on unmount (no re-read after teardown)", async () => {
    beginDocPipeline("doc-live");
    mockRead.mockResolvedValue({ items: ["x"] });
    const { result, unmount } = renderHook(() =>
      usePersistentState<Shape>("doc-live", "revisions.json", EMPTY),
    );
    await waitFor(() => expect(result.current.state.items).toEqual(["x"]));

    unmount();
    mockRead.mockClear();
    // Firing after unmount must not re-read (listener removed). Use the raw
    // event to prove no handler remains.
    window.dispatchEvent(
      new CustomEvent(SIDECAR_CHANGED_EVENT, {
        detail: { docId: "doc-live", filename: "revisions.json" },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRead).not.toHaveBeenCalled();
  });
});
