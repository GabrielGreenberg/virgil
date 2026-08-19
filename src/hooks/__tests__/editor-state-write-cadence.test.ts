// @vitest-environment jsdom
//
// Task 363 — the write cadence, measured as a COUNT.
//
// The storm's engine: `editor-state.json` was rewritten in full on every
// 400 ms scroll pause, every caret-paragraph change and every fold toggle. In
// the reporting folder that produced 102 of the 197 Dropbox conflicted copies —
// more than the whole rest of the paper's sidecars combined — for a file whose
// entire contents are a scroll offset, a paragraph uuid and a list of folded
// uuids.
//
// No pre-363 suite could see this, and the reason is worth knowing: every one
// of them asserts a SINGLE write's payload, which the pre-fix code satisfied
// perfectly. The defect is a RATE, so the leg has to be a count over a
// simulated session.
//
// Legs:
//   1. RATE       — a reading session's worth of scroll pauses costs ONE write.
//   2. PAYLOAD    — the coalesced write carries the LAST value, not the first.
//   3. SETTLE     — the value is never delayed past a boundary that matters:
//                   the tab going hidden flushes it.
//   4. UNMOUNT    — and so does unmount / a doc switch (pre-existing contract,
//                   pinned here because the coalescer is what makes it
//                   load-bearing).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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
import { VIEW_WRITE_DEBOUNCE_MS } from "@/lib/sidecar-value";

beforeEach(() => {
  mockRead.mockReset();
  mockRead.mockResolvedValue(null);
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountLoaded() {
  const hook = renderHook(() => useEditorUIState("doc-1", null));
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.loaded).toBe(true);
  return hook;
}

/** Fire `visibilitychange` with the document hidden — the settle edge. */
function hideTab() {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("editor-state write cadence (task 363)", () => {
  it("collapses a reading session's scroll pauses into ONE write", async () => {
    const { result } = await mountLoaded();
    // Twelve 400 ms scroll settles — i.e. a couple of minutes of reading. Each
    // one wrote the whole file before this fix.
    act(() => {
      for (let i = 1; i <= 12; i++) {
        result.current.writeScroll(i * 250);
        vi.advanceTimersByTime(400);
      }
    });
    expect(mockWrite).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(VIEW_WRITE_DEBOUNCE_MS + 50);
    });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it("writes the LAST value, not the first", async () => {
    const { result } = await mountLoaded();
    act(() => {
      result.current.writeScroll(100);
      result.current.writeScroll(200);
      result.current.writeScroll(4321);
      vi.advanceTimersByTime(VIEW_WRITE_DEBOUNCE_MS + 50);
    });
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][2]).toMatchObject({ scrollTop: 4321 });
  });

  it("settles when the tab goes hidden — no value is delayed past the moment it stops being live", async () => {
    const { result } = await mountLoaded();
    act(() => result.current.writeScroll(777));
    expect(mockWrite).not.toHaveBeenCalled();
    hideTab();
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][2]).toMatchObject({ scrollTop: 777 });
    // …and the flushed payload is not written a second time when the timer
    // would have fired.
    act(() => {
      vi.advanceTimersByTime(VIEW_WRITE_DEBOUNCE_MS + 50);
    });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it("settles on unmount (the doc-switch path)", async () => {
    const { result, unmount } = await mountLoaded();
    act(() => result.current.writeScroll(1234));
    expect(mockWrite).not.toHaveBeenCalled();
    act(() => unmount());
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][2]).toMatchObject({ scrollTop: 1234 });
  });
});
