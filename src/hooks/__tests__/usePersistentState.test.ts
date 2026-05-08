// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readSidecar: (...args: unknown[]) => mockRead(...args),
  writeSidecar: (...args: unknown[]) => mockWrite(...args),
}));

import { usePersistentState } from "../usePersistentState";
import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

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
    expect(mockRead).toHaveBeenCalledWith("doc-1", "test.json", EMPTY);
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
    mockWrite.mockRejectedValue(new StalePipelineError("doc-1", h.pipelineId));
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
