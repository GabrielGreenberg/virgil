// @vitest-environment jsdom
/**
 * Task 1503 — a card edit not yet on disk is published to the document's
 * unsaved-work channel by the sidecar hook itself: dirty from the moment the
 * debounce arms, through the in-flight write, clean only when a write LANDS
 * (a failed write keeps the document dirty — the edit is in memory only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readSidecar: (...args: unknown[]) => mockRead(...args),
  readSidecarIfExists: (...args: unknown[]) => mockRead(...args),
  writeSidecar: (...args: unknown[]) => mockWrite(...args),
  mutateSidecar: async (
    handle: { docId: string },
    filename: string,
    defaultValue: unknown,
    mutate: (current: unknown) => unknown,
  ) => {
    const current = (await mockRead(handle.docId, filename)) ?? defaultValue;
    const next = mutate(current);
    if (next === null) return null;
    await mockWrite(handle, filename, next);
    return next;
  },
}));

import { usePersistentState } from "../usePersistentState";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import {
  clearUnsavedWork,
  hasUnlandedModelWork,
  hasUnlandedWork,
} from "@/lib/unsaved-work";

interface Shape {
  words: string[];
}
const EMPTY: Shape = { words: [] };
const DOC = "doc-1503";
const FILE = "dictionary.json";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockRead.mockReset().mockResolvedValue({ words: [] });
  mockWrite.mockReset().mockResolvedValue(undefined);
  __resetForTests();
  resetFlushers();
  clearUnsavedWork();
});
afterEach(() => {
  cleanup();
});

async function mount(debounceMs: number) {
  beginDocPipeline(DOC);
  const hook = renderHook(() =>
    usePersistentState<Shape>(DOC, FILE, EMPTY, { debounceMs }),
  );
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

describe("usePersistentState publishes card work to the unsaved-work channel (task 1503)", () => {
  it("DEFECT: dirty from the ARMED debounce (before any write), through the in-flight write, clean on landing", async () => {
    const { result } = await mount(5_000);
    expect(hasUnlandedWork(DOC)).toBe(false);

    act(() => result.current.update((p) => ({ words: [...p.words, "typed"] })));
    // Pre-1503: false — the leave prompt and badge saw a clean document.
    expect(hasUnlandedWork(DOC)).toBe(true);
    // A card edit is not MODEL work: the bundle writer has nothing to write.
    expect(hasUnlandedModelWork(DOC)).toBe(false);

    const hold = deferred();
    mockWrite.mockImplementationOnce(() => hold.promise);
    const flushed = act(async () => {
      await result.current.persist({ words: ["typed"] });
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    expect(hasUnlandedWork(DOC)).toBe(true); // in flight
    hold.resolve();
    await flushed;
    expect(hasUnlandedWork(DOC)).toBe(false);
  });

  it("a FAILED write keeps the document dirty until a later write lands", async () => {
    const { result } = await mount(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockWrite.mockRejectedValueOnce(new Error("permission lost"));
    await act(async () => {
      await result.current.persist({ words: ["lost?"] });
    });
    expect(hasUnlandedWork(DOC)).toBe(true);

    await act(async () => {
      await result.current.persist({ words: ["lost?", "again"] });
    });
    expect(hasUnlandedWork(DOC)).toBe(false);
  });
});
