// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { JSONContent } from "@tiptap/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readDocBundle: (...args: unknown[]) => mockRead(...args),
  writeDocBundle: (...args: unknown[]) => mockWrite(...args),
}));

import { useDocument } from "../useDocument";
import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import {
  flushPendingForDoc,
  __resetForTests as resetFlushers,
} from "@/lib/multi-window/pending-saves";

const EMPTY_CONTENT: JSONContent = { type: "doc", content: [] };
const SAMPLE_CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "hello" }],
    },
  ],
};

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  mockRead.mockResolvedValue({ content: EMPTY_CONTENT, editorState: {} });
  resetPipelines();
  resetFlushers();
});

describe("useDocument autosave persistence", () => {
  it("flushes pending debounced edits on unmount", async () => {
    beginDocPipeline("doc-1");
    const { result, unmount } = renderHook(() => useDocument("doc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(SAMPLE_CONTENT);
    });
    // Debounce is 1500 ms; we unmount immediately, well inside that window.
    expect(mockWrite).not.toHaveBeenCalled();

    unmount();
    // The unmount cleanup fires the pending save synchronously.
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    const [handle, content] = mockWrite.mock.calls[0];
    expect(handle.docId).toBe("doc-1");
    expect(content).toEqual(SAMPLE_CONTENT);
  });

  it("flushes pending edits on pagehide", async () => {
    beginDocPipeline("doc-1");
    const { result } = renderHook(() => useDocument("doc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(SAMPLE_CONTENT);
    });
    expect(mockWrite).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });

    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
  });

  it("registers a flusher reachable via flushPendingForDoc", async () => {
    beginDocPipeline("doc-1");
    const { result } = renderHook(() => useDocument("doc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(SAMPLE_CONTENT);
    });
    expect(mockWrite).not.toHaveBeenCalled();

    // External caller (e.g. useFiles.flushOutgoing during a doc switch)
    // can drive the flush before the pipeline ends.
    await act(async () => {
      await flushPendingForDoc("doc-1");
    });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
  });

  it("does not double-write when the debounce timer subsequently fires", async () => {
    vi.useFakeTimers();
    try {
      beginDocPipeline("doc-1");
      const { result } = renderHook(() => useDocument("doc-1"));
      // Advance past any sync-y mount work.
      await vi.runOnlyPendingTimersAsync();

      act(() => {
        result.current.onUpdate(SAMPLE_CONTENT);
      });

      await act(async () => {
        await flushPendingForDoc("doc-1");
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Advance past the 1500 ms debounce — there should be NO second write
      // because flushPending cleared latestContentRef.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a pipeline lazily on first render so saves work immediately", async () => {
    // No explicit `beginDocPipeline` call. Before the idempotency fix
    // this test would have asserted writes are dropped; now the hook
    // creates the pipeline itself during render, which is the whole
    // point — saves must work from the first edit, not just after some
    // separate effect happens to start the pipeline.
    const { result } = renderHook(() => useDocument("doc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(SAMPLE_CONTENT);
    });
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
  });

  it("does not write when docId is null", async () => {
    const { result } = renderHook(({ id }) => useDocument(id), {
      initialProps: { id: null as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(SAMPLE_CONTENT);
    });
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await Promise.resolve();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("unregisters the flusher on unmount", async () => {
    beginDocPipeline("doc-1");
    const { result, unmount } = renderHook(() => useDocument("doc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();
    endDocPipeline({ docId: "doc-1", pipelineId: "" } as any);
    // After unmount, flushPendingForDoc is a no-op — no stale writes.
    await act(async () => {
      await flushPendingForDoc("doc-1");
    });
    // Only writes from the unmount itself; since nothing was pending,
    // there should be zero writes.
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
