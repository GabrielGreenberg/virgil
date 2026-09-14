// @vitest-environment jsdom
//
// TASK 568 — the code-pane preamble stash is consumed by a LANDED write, never
// by an attempt.
//
// `pendingDelimitersRef` is, by its own comment, the ONLY durable copy of the
// user's preamble edit until a write lands: the code-pane bridge clears its
// own `pendingPersist` BEFORE calling the persist callback, and it keeps
// rendering the pane from the edited preamble, so a lost stash is a MASKED
// loss. Until 568 every save path spent the stash up front (`takeDelimitersOpts`
// nulled the ref and handed the payload to `save`), so a write that was then
// refused by the preservation gate, threw, or was dropped by a stale pipeline
// left the payload nowhere — the next autosave carried no delimiters,
// `writeDocBundle` re-read the OLD preamble off disk and wrote it back, and
// the pane kept showing the new one. Forever.
//
// **No pre-568 suite could see this**: `useDocument.autosave-pause.test.ts`
// drives the stash through the PAUSE branch, where the payload is stashed and
// no attempt is made — the attempt that fails is unrepresentable there, and
// its write door always lands. Every leg here drives the REAL hook over a fake
// door that REFUSES, THROWS or DROPS exactly once and then lands, and asserts
// what the LANDING write carried — never the rendered pane, which is what
// looked right the whole time.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import React from "react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readDocBundle: (...args: unknown[]) => mockRead(...args),
  writeDocBundle: (...args: unknown[]) => mockWrite(...args),
  snapshotConflictSides: async () => ({
    slot: "2026-09-14T00-00-00-000Z",
    disk: ["main.tex"],
    mine: "unsaved-main.tex",
  }),
  invalidateSidecarBundle: () => {},
}));

// The pause guard is a separate contract (autosave-pause.test.ts); every leg
// here runs UNPAUSED so the attempt is actually made — that is the half the
// pause suite cannot represent. `activeDocId` matches so the watcher is read.
let unresolved = false;
const fakeCtx = {
  watcher: { hasUnresolvedChange: () => unresolved },
  activeDocId: "doc-1",
  registerUnsavedGetter: () => () => {},
  registerDocActions: () => () => {},
};
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => fakeCtx,
}));

import { useDocument } from "../useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import {
  StalePipelineError,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import {
  __resetForTests as resetFlushers,
  flushPendingForDoc,
} from "@/lib/multi-window/pending-saves";
import { clearUnsavedWork, hasUnlandedWork } from "@/lib/unsaved-work";

const EMPTY_CONTENT: JSONContent = { type: "doc", content: [] };
const SAMPLE_CONTENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
};
const D1 = {
  preamble: "\\documentclass{article}\n\\usepackage{tikz}\n\n\\begin{document}\n\n",
  postamble: "\n\\end{document}\n",
};
const D2 = {
  preamble: "\\documentclass{article}\n\\usepackage{forest}\n\n\\begin{document}\n\n",
  postamble: "\n\\end{document}\n",
};

beforeEach(() => {
  cleanup();
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue({ landed: true });
  mockRead.mockResolvedValue({ content: EMPTY_CONTENT, editorState: {} });
  resetPipelines();
  resetFlushers();
  clearUnsavedWork();
  unresolved = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function makeMockEditor(content: JSONContent): Editor {
  return { getJSON: () => content, isDestroyed: false } as unknown as Editor;
}

function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(DocPipeline, { docId, key: docId, children });
  };
}

/** The `opts` argument of the i-th `writeDocBundle` call. */
const optsOf = (i: number) => mockWrite.mock.calls[i]?.[2] as
  | { delimiters?: { preamble: string; postamble: string } }
  | undefined;

async function mountUnpaused() {
  vi.useFakeTimers();
  const { result } = renderHook(() => useDocument(), {
    wrapper: withPipeline("doc-1"),
  });
  await vi.runOnlyPendingTimersAsync();
  return result;
}

/** A body keystroke, then the 1500 ms debounce landing its autosave. */
async function keystrokeThenAutosave(
  result: { current: ReturnType<typeof useDocument> },
) {
  act(() => {
    result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
}

describe("task 568 · a delimiters payload survives every NON-LANDED write outcome and rides the next landing", () => {
  it("DEFECT — a write REFUSED by the preservation gate: the next autosave carries the delimiters", async () => {
    try {
      const result = await mountUnpaused();
      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(optsOf(0)).toEqual({ delimiters: D1 });

      // The user acknowledges the notice and types one character. Pre-568 this
      // write carried NOTHING — the stash was spent on the refused attempt —
      // and `writeDocBundle` re-read the OLD preamble off disk.
      await keystrokeThenAutosave(result);
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toEqual({ delimiters: D1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("DEFECT — a write that THROWS (an FSA error): the next autosave carries the delimiters", async () => {
    try {
      const result = await mountUnpaused();
      mockWrite.mockRejectedValueOnce(new Error("NotAllowedError: permission lapsed"));

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      expect(mockWrite).toHaveBeenCalledTimes(1);

      await keystrokeThenAutosave(result);
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toEqual({ delimiters: D1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("DEFECT — a write DROPPED by a stale pipeline: the next autosave carries the delimiters", async () => {
    try {
      const result = await mountUnpaused();
      mockWrite.mockRejectedValueOnce(
        new StalePipelineError("doc-1", "old-pipeline-id", "superseded", "new-pipeline-id"),
      );

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      expect(mockWrite).toHaveBeenCalledTimes(1);

      await keystrokeThenAutosave(result);
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toEqual({ delimiters: D1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("DEFECT — the payload rides the next landing EXACTLY once: refused, then landed, then a later autosave carries nothing", async () => {
    try {
      const result = await mountUnpaused();
      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      await keystrokeThenAutosave(result); // lands, carrying D1
      expect(optsOf(1)).toEqual({ delimiters: D1 });

      await keystrokeThenAutosave(result); // the stash was consumed by that landing
      expect(mockWrite).toHaveBeenCalledTimes(3);
      expect(optsOf(2)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("DEFECT — a manual Save that fails still leaves the stash for the next landing (the 392 door consumes nothing on an attempt)", async () => {
    try {
      const result = await mountUnpaused();
      // First: the pane commit itself is refused.
      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      // Then the user presses Save now, and THAT is refused too.
      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });
      const { requestSaveNow } = await import("@/lib/save-request");
      await act(async () => {
        await requestSaveNow("doc-1");
      });
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toMatchObject({ delimiters: D1 });
      // Third attempt lands and carries it.
      await keystrokeThenAutosave(result);
      expect(optsOf(2)).toEqual({ delimiters: D1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("task 568 · the stash's lifecycle: supersede, identity, disk-wins, and the channel", () => {
  it("CONTROL — a delimiters write that LANDS consumes the stash: the write after carries nothing", async () => {
    try {
      const result = await mountUnpaused();
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      expect(optsOf(0)).toEqual({ delimiters: D1 });

      await keystrokeThenAutosave(result);
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a FRESHER payload supersedes an older refused one: the landing carries D2, and D1 never rides a later write", async () => {
    try {
      const result = await mountUnpaused();
      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      expect(optsOf(0)).toEqual({ delimiters: D1 }); // refused

      // The user edits the preamble again; the bridge hands the FULL,
      // re-extracted delimiters (D1's edit already folded in).
      act(() => {
        result.current.saveWithDelimiters(D2);
      });
      await act(async () => {});
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toEqual({ delimiters: D2 }); // lands

      await keystrokeThenAutosave(result);
      expect(mockWrite).toHaveBeenCalledTimes(3);
      expect(optsOf(2)).toBeUndefined();
      for (const c of mockWrite.mock.calls.slice(1)) {
        expect((c[2] as { delimiters?: unknown } | undefined)?.delimiters).not.toEqual(D1);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("IDENTITY — an older write LANDING while a fresher payload is stashed does not consume the fresher one", async () => {
    try {
      const result = await mountUnpaused();
      // D1's write is held IN FLIGHT.
      let landD1!: (r: { landed: boolean; reason?: string }) => void;
      mockWrite.mockImplementationOnce(
        () => new Promise((resolve) => { landD1 = resolve; }),
      );
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      // D2 arrives while D1 is in flight, and D2's own write is REFUSED.
      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });
      act(() => {
        result.current.saveWithDelimiters(D2);
      });
      await act(async () => {});
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toEqual({ delimiters: D2 });

      // Now D1 lands. A byte- or presence-based consume would empty the stash
      // here and D2 — refused, and the only copy — would be gone.
      await act(async () => {
        landD1({ landed: true });
      });

      await keystrokeThenAutosave(result);
      expect(mockWrite).toHaveBeenCalledTimes(3);
      expect(optsOf(2)).toEqual({ delimiters: D2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("DISK WINS — `refetch()` drops a refused-then-standing stash (Reload is the user choosing the disk copy)", async () => {
    try {
      const result = await mountUnpaused();
      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      expect(mockWrite).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.refetch();
      });
      await keystrokeThenAutosave(result);
      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(optsOf(1)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("CHANNEL — a preamble edit is unlanded work from the moment it is handed over, before any attempt resolves", async () => {
    try {
      const result = await mountUnpaused();
      // A write that never resolves: the only thing the channel can read is
      // the gesture itself.
      mockWrite.mockImplementationOnce(() => new Promise(() => {}));
      expect(hasUnlandedWork("doc-1")).toBe(false);
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      });
      // Let the body keystroke's channel edge be cleared so the leg reads the
      // preamble gesture ALONE.
      clearUnsavedWork("doc-1");
      act(() => {
        result.current.saveWithDelimiters(D1);
      });
      expect(hasUnlandedWork("doc-1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("PREDICATE — a standing stash counts as work to write even when the debounce is idle and the channel has been cleared by another landing", async () => {
    try {
      const result = await mountUnpaused();
      await keystrokeThenAutosave(result); // clean: timer null, channel clear
      expect(mockWrite).toHaveBeenCalledTimes(1);

      mockWrite.mockResolvedValueOnce({ landed: false, reason: "preservation" });
      act(() => {
        result.current.saveWithDelimiters(D1);
      });
      await act(async () => {});
      expect(mockWrite).toHaveBeenCalledTimes(2);
      // The channel residual task 567 records: a landing elsewhere can clear
      // the channel under a payload that has not landed. The stash is then
      // the ONLY evidence, and `hasWorkToWrite` must read it.
      clearUnsavedWork("doc-1");

      await act(async () => {
        await flushPendingForDoc("doc-1");
      });
      expect(mockWrite).toHaveBeenCalledTimes(3);
      expect(optsOf(2)).toEqual({ delimiters: D1 });
    } finally {
      vi.useRealTimers();
    }
  });
});
