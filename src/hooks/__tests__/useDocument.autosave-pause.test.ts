// @vitest-environment jsdom
//
// The autosave-clobber guard (DESIGN §4) at the useDocument integration level:
// while the disk watcher reports an unresolved external change, the BACKGROUND
// debounced autosave must NOT write (it would clobber the on-disk edit) — it
// re-arms instead — and it RESUMES once the change clears. The TERMINAL flush
// (pagehide) must STILL write even during a conflict (work-preservation
// carve-out). We inject a controllable fake watcher by mocking the disk-watcher
// context module.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import React from "react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readDocBundle: (...args: unknown[]) => mockRead(...args),
  writeDocBundle: (...args: unknown[]) => mockWrite(...args),
}));

// Controllable fake watcher: the test flips `unresolved` to model an external
// change appearing / being resolved. registerUnsavedGetter is a no-op here (the
// guard we exercise is hasUnresolvedChange, not the dirty-getter injection).
let unresolved = false;
const fakeWatcher = {
  hasUnresolvedChange: () => unresolved,
};
const fakeCtx = {
  watcher: fakeWatcher,
  registerUnsavedGetter: () => () => {},
};
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => fakeCtx,
}));

import { useDocument } from "../useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";

const EMPTY_CONTENT: JSONContent = { type: "doc", content: [] };
const SAMPLE_CONTENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
};

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  mockRead.mockResolvedValue({ content: EMPTY_CONTENT, editorState: {} });
  resetPipelines();
  resetFlushers();
  unresolved = false;
});

function makeMockEditor(content: JSONContent): Editor {
  return { getJSON: () => content, isDestroyed: false } as unknown as Editor;
}

function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    // children-in-props mirrors the sibling useDocument.test.ts harness;
    // DocPipelineProps requires `children`, so the createElement(child-arg)
    // form fails tsc. (The react/no-children-prop lint note is pre-existing in
    // that sibling test and accepted there.)
    return React.createElement(DocPipeline, { docId, key: docId, children });
  };
}

describe("useDocument autosave-pause guard (DESIGN §4)", () => {
  it("PAUSES the background debounced autosave while an external change is unresolved, then RESUMES after it clears", async () => {
    vi.useFakeTimers();
    try {
      unresolved = true; // external change is live and unresolved

      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      // User types — the debounce arms.
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      });

      // Advance past the 1500 ms debounce. The guard must SKIP the write (the
      // external edit on disk must not be clobbered) — the timer re-arms.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).not.toHaveBeenCalled();

      // Advance again — still unresolved → still no write (it keeps re-arming).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).not.toHaveBeenCalled();

      // The user resolves the change (Reload / Dismiss) → watcher clears.
      unresolved = false;

      // The NEXT debounce fire writes normally — the edit was retained, not
      // dropped.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes normally when there is NO unresolved change (guard is transparent)", async () => {
    vi.useFakeTimers();
    try {
      unresolved = false;
      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("TERMINAL flush (pagehide) STILL writes during an unresolved conflict (work-preservation carve-out)", async () => {
    unresolved = true; // conflict is live

    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
    });
    expect(mockWrite).not.toHaveBeenCalled();

    // Tab close during the conflict — the user's in-editor work must be saved
    // (resolves in the user's favor, "Keep mine"); the guard does NOT block
    // this terminal path.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
  });
});
