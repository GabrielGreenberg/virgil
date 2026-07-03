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
// `activeDocId` (read live via the getter) is which doc the single provider is
// watching — multi-doc keep-alive: only that doc honors the pause guard, so a
// WARM doc (docId !== activeDocId) sees a null watcher and never pauses.
let unresolved = false;
let activeDocId = "doc-1";
const fakeWatcher = {
  hasUnresolvedChange: () => unresolved,
};
const fakeCtx = {
  watcher: fakeWatcher,
  get activeDocId() {
    return activeDocId;
  },
  registerUnsavedGetter: () => () => {},
};
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => fakeCtx,
}));

import { useDocument } from "../useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import { dispatchTexDelimitersChanged } from "@/lib/tex-delimiters-event";

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
  activeDocId = "doc-1";
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

  it("a WARM doc (not the active/watched doc) does NOT pause — it never inherits the active doc's conflict", async () => {
    vi.useFakeTimers();
    try {
      // The ACTIVE doc (doc-1) has a live, unresolved external conflict...
      unresolved = true;
      activeDocId = "doc-1";

      // ...but THIS hook is a warm doc-2 (mounted-but-hidden under keep-alive).
      // It is NOT the watched doc, so the active doc's conflict must not pause
      // doc-2's autosave — it sees a null watcher and writes normally.
      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-2"),
      });
      await vi.runOnlyPendingTimersAsync();

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
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

  // ------------------------------------------------------------------
  // Code-pane delimiters commit during a pause (`saveWithDelimiters`):
  // the bridge consumed its own pendingPersist BEFORE calling us, so the
  // argument is the ONLY copy of the user's preamble edit — the pause
  // branch must STASH it, not drop it, and the next unpaused save must
  // carry it (the Dismiss / "Keep my version" resolution). The Reload
  // resolution (disk wins) instead clears the stash via refetch + the
  // tex-delimiters-changed event.
  // ------------------------------------------------------------------

  const DELIMS = {
    preamble:
      "\\documentclass{article}\n\\usepackage{tikz}\n\n\\begin{document}\n\n",
    postamble: "\n\\end{document}\n",
  };

  it("saveWithDelimiters during a pause STASHES the payload; the next unpaused save carries it exactly once (Dismiss / 'Keep mine')", async () => {
    vi.useFakeTimers();
    try {
      unresolved = true;

      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      // Code flush: body pushed into TipTap (onUpdate) + delimiters commit.
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(DELIMS);
      });
      // Paused → no write yet, and the payload must not be dropped.
      expect(mockWrite).not.toHaveBeenCalled();

      // Still unresolved → the re-armed debounce keeps skipping.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).not.toHaveBeenCalled();

      // User resolves via Dismiss ("Keep my version") — no reload, no
      // tex-delimiters-changed event. The next fire must write WITH the
      // stashed delimiters, or the preamble edit dies while the pane
      // keeps displaying it.
      unresolved = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite.mock.calls[0][2]).toEqual({ delimiters: DELIMS });

      // One-shot: a later autosave does NOT replay the stale delimiters
      // (writeDocBundle re-reads the now-fresh disk preamble instead).
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(mockWrite.mock.calls[1][2]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stashed payload does NOT survive an out-of-band delimiters change (Reload / style switch): the event clears it", async () => {
    vi.useFakeTimers();
    try {
      unresolved = true;

      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(DELIMS);
      });
      expect(mockWrite).not.toHaveBeenCalled();

      // User resolves via RELOAD: disk wins. The reload path dispatches
      // tex-delimiters-changed after the refetch settles — replaying the
      // stash would clobber the just-reloaded preamble.
      unresolved = false;
      act(() => {
        dispatchTexDelimitersChanged("doc-1");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite.mock.calls[0][2]).toBeUndefined(); // no stale replay
    } finally {
      vi.useRealTimers();
    }
  });

  it("the TERMINAL pagehide flush during a conflict carries a stashed delimiters payload ('Keep mine' includes the preamble edit)", async () => {
    unresolved = true;

    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      result.current.saveWithDelimiters(DELIMS);
    });
    expect(mockWrite).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
    expect(mockWrite.mock.calls[0][2]).toEqual({ delimiters: DELIMS });
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
