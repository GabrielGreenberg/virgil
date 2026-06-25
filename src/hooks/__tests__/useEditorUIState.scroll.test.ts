// @vitest-environment jsdom
//
// Phase D — durable per-doc scroll memory. useEditorUIState now persists the
// editor scroll offset to editor-state.json (round-tripped through migrate) and
// restores it on cold mount, so an LRU-evicted / reloaded doc returns to where
// it was. These cover the persistence side (the restore/capture DOM wiring lives
// in EditorPane): the loaded-gate, the same-value bail, and the migrate round-trip.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readSidecarIfExists: (...args: unknown[]) => mockRead(...args),
  writeSidecar: (...args: unknown[]) => mockWrite(...args),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: () => ({ docId: "doc-1", pipelineId: "p1" }),
  isStalePipelineError: () => false,
}));

import { useEditorUIState } from "../useEditorUIState";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
});

describe("useEditorUIState scroll persistence (Phase D)", () => {
  it("migrates scrollTop from disk on load", async () => {
    mockRead.mockResolvedValue({
      lastParagraphId: "para-x",
      foldedSections: [],
      scrollTop: 742,
      lastModified: "t",
    });
    const { result } = renderHook(() => useEditorUIState("doc-1", null));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.state.scrollTop).toBe(742);
  });

  it("persists a scroll write (rounded) once loaded", async () => {
    mockRead.mockResolvedValue(null); // fresh doc
    const { result } = renderHook(() => useEditorUIState("doc-1", null));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.writeScroll(523.6));
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][2]).toMatchObject({ scrollTop: 524 });
  });

  it("bails on a same-value scroll write (the programmatic restore re-fires 'scroll')", async () => {
    mockRead.mockResolvedValue({
      lastParagraphId: null,
      foldedSections: [],
      scrollTop: 300,
      lastModified: "t",
    });
    const { result } = renderHook(() => useEditorUIState("doc-1", null));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.writeScroll(300)); // equals the restored value
    expect(mockWrite).not.toHaveBeenCalled();

    act(() => result.current.writeScroll(900)); // a real change does persist
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][2]).toMatchObject({ scrollTop: 900 });
  });
});
