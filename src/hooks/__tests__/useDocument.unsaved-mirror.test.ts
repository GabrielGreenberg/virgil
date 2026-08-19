// @vitest-environment jsdom
//
// Task 391 — the WIRING, which is the half no test of the mirror or the door
// can see. The 2026-08-19 loss did not happen because a mechanism was wrong; it
// happened because nothing in the save path published "this work has not
// reached disk", so every guard downstream read a refused write as a success.
//
// So these legs drive the REAL `useDocument` and ask the channel what it was
// told. Each fails on the pre-391 behaviour: `save()` advanced `lastSavedRef`
// and reported saved with no channel write at all, and `onBeforeUnload` tested
// the debounce handle, which the timer callback had already nulled.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import React from "react";

const mockRead = vi.fn();
const mockWrite = vi.fn();
const mockSnapshot = vi.fn(async (_h: unknown, _mine: JSONContent | null) => ({
  slot: "s",
  disk: ["main.tex"],
  mine: "unsaved-main.tex",
}));

vi.mock("@/lib/storage", () => ({
  readDocBundle: (...a: unknown[]) => mockRead(...a),
  writeDocBundle: (...a: unknown[]) => mockWrite(...a),
  snapshotConflictSides: (h: unknown, mine: JSONContent | null) =>
    mockSnapshot(h, mine),
  // Reached only by DocPipeline's unmount cleanup, which `cleanup()` drives.
  invalidateSidecarBundle: () => {},
}));

let unresolved = false;
let docActions: {
  reload: () => void | Promise<void>;
  keepMine: () => Promise<boolean>;
  archiveSides: () => Promise<unknown>;
} | null = null;
const fakeCtx = {
  watcher: { hasUnresolvedChange: () => unresolved },
  get activeDocId() {
    return "doc-1";
  },
  registerUnsavedGetter: () => () => {},
  registerDocActions: (_id: string, a: unknown) => {
    docActions = a as typeof docActions;
    return () => {};
  },
};
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => fakeCtx,
}));

// The mirror's IndexedDB half is not what these legs are about; the ticker
// registry is real so the FORCE path can be observed.
const mirrorWrites: unknown[] = [];
vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async (_k: unknown, v: unknown) => {
    mirrorWrites.push(v);
  },
  del: async () => {},
  keys: async () => [],
}));

import { useDocument } from "../useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import {
  clearUnsavedWork,
  getUnsavedWork,
  hasUnlandedWork,
} from "@/lib/unsaved-work";
import { isWriteProtected, clearPreservationNotice, recordPreservationRefusal } from "@/lib/preservation-notice";
import { __resetTickersForTests } from "@/lib/emergency-mirror";
import {
  __resetMirrorRecoveryForTests,
  getRecoveryActions,
  getRecoveryOffer,
  offerMirrorRecovery,
} from "@/lib/mirror-recovery";
import { hashContent } from "@/lib/disk-ledger";

const EMPTY: JSONContent = { type: "doc", content: [] };
const SAMPLE: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
};

function editor(c: JSONContent): Editor {
  return { getJSON: () => c, isDestroyed: false } as unknown as Editor;
}
function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(DocPipeline, { docId, key: docId, children });
  };
}
/** A REAL user edit — the write gate's own `addToHistory !== false` test. */
const userTx = { docChanged: true, getMeta: () => undefined } as never;

beforeEach(() => {
  mockRead.mockReset().mockResolvedValue({ content: EMPTY, editorState: {} });
  mockWrite.mockReset().mockResolvedValue(undefined);
  mockSnapshot.mockReset().mockResolvedValue({
    slot: "s",
    disk: ["main.tex"],
    mine: "unsaved-main.tex",
  });
  mirrorWrites.length = 0;
  resetPipelines();
  resetFlushers();
  __resetTickersForTests();
  clearUnsavedWork();
  clearPreservationNotice();
  __resetMirrorRecoveryForTests();
  unresolved = false;
  docActions = null;
});

// Every leg installs window-level unload listeners through the REAL hook, so a
// hook left mounted by an earlier leg would answer this one's `beforeunload`.
// Unmount while the pipeline registry is still live — after the resets it is
// not, and the cleanup throws inside React's passive-unmount phase.
afterEach(() => {
  cleanup();
});

describe("useDocument publishes to the unsaved-work channel", () => {
  it("marks the doc dirty on a real edit and CLEAN only when the write lands", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();

      expect(hasUnlandedWork("doc-1")).toBe(false);
      act(() => result.current.onUpdate(editor(SAMPLE), userTx));
      expect(hasUnlandedWork("doc-1")).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalled();
      expect(hasUnlandedWork("doc-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a PAUSED autosave reports `conflict` — the incident's state, said out loud", async () => {
    vi.useFakeTimers();
    try {
      unresolved = true;
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      act(() => result.current.onUpdate(editor(SAMPLE), userTx));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).not.toHaveBeenCalled();
      expect(getUnsavedWork("doc-1")?.reason).toBe("conflict");
      expect(hasUnlandedWork("doc-1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a REFUSED write reports `preservation` and never reads as saved", async () => {
    vi.useFakeTimers();
    try {
      // The 357 gate refuses inside writeDocBundle and returns NORMALLY.
      mockWrite.mockImplementation(async () => {
        recordPreservationRefusal("doc-1", {
          source: "write",
          region: "body",
          before: 100,
          after: 10,
          lost: 90,
          allowed: 4,
        });
      });
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      act(() => result.current.onUpdate(editor(SAMPLE), userTx));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalled();
      expect(isWriteProtected("doc-1")).toBe(true);
      expect(getUnsavedWork("doc-1")?.reason).toBe("preservation");
      expect(hasUnlandedWork("doc-1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a THROWN write reports `error` rather than going quiet", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockWrite.mockRejectedValue(new Error("permission lost"));
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      act(() => result.current.onUpdate(editor(SAMPLE), userTx));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(getUnsavedWork("doc-1")?.reason).toBe("error");
    } finally {
      err.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keepMine REPORTS whether the write landed — the conflict door's permission", async () => {
    const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
    await act(async () => {});
    act(() => result.current.onUpdate(editor(SAMPLE), userTx));

    // Landing case.
    await act(async () => {
      await expect(docActions!.keepMine()).resolves.toBe(true);
    });

    // Refusal case: the write returns normally and the door must say so.
    act(() => result.current.onUpdate(editor(SAMPLE), userTx));
    mockWrite.mockImplementation(async () => {
      recordPreservationRefusal("doc-1", {
        source: "serialize",
        region: "body",
        before: 1,
        after: 0,
        lost: 1,
        allowed: 0,
      });
    });
    await act(async () => {
      await expect(docActions!.keepMine()).resolves.toBe(false);
    });
  });
});

describe("the unload prompt asks the CHANNEL, not the debounce handle", () => {
  it("prompts while a refused write leaves work unlanded, with no debounce armed", async () => {
    vi.useFakeTimers();
    try {
      mockWrite.mockImplementation(async () => {
        recordPreservationRefusal("doc-1", {
          source: "write",
          region: "body",
          before: 100,
          after: 10,
          lost: 90,
          allowed: 4,
        });
      });
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      act(() => result.current.onUpdate(editor(SAMPLE), userTx));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      // The debounce fired and nulled its own handle; the write was refused.
      // Pre-391 this is exactly where `beforeUnload` went silent.
      expect(hasUnlandedWork("doc-1")).toBe(true);

      const ev = new Event("beforeunload", { cancelable: true });
      act(() => {
        window.dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays silent on a clean document", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      const ev = new Event("beforeunload", { cancelable: true });
      act(() => {
        window.dispatchEvent(ev);
      });
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The RESTORE door, driven through the real hook — because the ordering that
 * matters is between two collaborators (`snapshotConflictSides` and
 * `writeDocBundle`) that only `useDocument` puts in sequence. A net that lands
 * after the write it exists to survive is a copy of the outcome, not a net.
 */
describe("restoring the mirror", () => {
  const RECOVERED: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "70 minutes" }] }],
  };

  function offerFor(docId: string) {
    offerMirrorRecovery({
      docId,
      content: RECOVERED,
      savedAt: Date.now() - 60_000,
      lastLandedAt: null,
      reason: "conflict",
      windowId: "w1",
      hash: hashContent(JSON.stringify(RECOVERED)),
    });
  }

  it("nets BOTH sides before it writes, and writes the recovered model as the user's decision", async () => {
    const order: string[] = [];
    mockSnapshot.mockImplementation(async () => {
      order.push("archive");
      return { slot: "s", disk: ["main.tex"], mine: "unsaved-main.tex" };
    });
    mockWrite.mockImplementation(async () => {
      order.push("write");
    });
    mockRead.mockImplementation(async () => {
      order.push("reload");
      return { content: RECOVERED, editorState: {} };
    });

    renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
    await act(async () => {});
    order.length = 0; // drop the mount load
    offerFor("doc-1");

    await act(async () => {
      await expect(getRecoveryActions("doc-1")!.restore()).resolves.toBe(true);
    });

    expect(order).toEqual(["archive", "write", "reload"]);
    // The archived "mine" side is the model being restored — not the editor's
    // current one, which is what the user is choosing to replace.
    expect(mockSnapshot.mock.calls[0]?.[1]).toEqual(RECOVERED);
    // The user's explicit decision, so the 357 write gate steps aside.
    expect(mockWrite.mock.calls[0]?.[2]).toMatchObject({ userResolvedConflict: true });
    expect(getRecoveryOffer("doc-1")).toBe(null);
  });

  it("a REFUSED restore keeps the offer standing rather than claiming a recovery", async () => {
    mockWrite.mockImplementation(async () => {
      recordPreservationRefusal("doc-1", {
        source: "serialize",
        region: "body",
        before: 1,
        after: 0,
        lost: 1,
        allowed: 0,
      });
    });
    renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
    await act(async () => {});
    offerFor("doc-1");

    await act(async () => {
      await expect(getRecoveryActions("doc-1")!.restore()).resolves.toBe(false);
    });
    expect(getRecoveryOffer("doc-1")).not.toBe(null);
  });

  it("discard leaves the disk version alone", async () => {
    renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
    await act(async () => {});
    mockWrite.mockClear();
    offerFor("doc-1");
    await act(async () => {
      await getRecoveryActions("doc-1")!.discard();
    });
    expect(getRecoveryOffer("doc-1")).toBe(null);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

/**
 * Task 391's verification ask for the 364 net: the incident's 13:28 `.history`
 * slot held no `unsaved-*` file. The leading theory (a pre-364 running build)
 * is recorded in the task log; this is the leg that keeps the flow honest from
 * here on — a conflict standing, a DIRTY editor, and the net carrying the
 * editor's live model rather than the last-saved one.
 */
describe("the conflict net carries the LIVE unsaved side", () => {
  it("archives what is in the editor, not what last reached disk", async () => {
    unresolved = true;
    const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
    await act(async () => {});
    act(() => result.current.onUpdate(editor(SAMPLE), userTx));

    await act(async () => {
      await docActions!.archiveSides();
    });
    expect(mockSnapshot).toHaveBeenCalledTimes(1);
    expect(mockSnapshot.mock.calls[0]?.[1]).toEqual(SAMPLE);
    expect(mockSnapshot.mock.calls[0]?.[1]).not.toEqual(EMPTY);
  });
});
