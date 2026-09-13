// @vitest-environment jsdom
//
// **Task 557 — the mirror is destroyed at exactly the moment it is needed.**
//
// Task 391 exists because on 2026-08-19 ~70 minutes of writing was lost: every
// disk gate worked, autosave was correctly PAUSED, the work lived only in
// memory, and a reload dropped it. The emergency mirror is that state's durable
// second copy — and the mechanism built to keep it was overwriting it.
//
// > **Nothing may write, clear, or replace the emergency mirror without
// > POSITIVE EVIDENCE about the model it is acting on.** A mirror WRITE needs
// > evidence the model is newer than disk; a mirror CLEAR needs evidence THIS
// > model reached disk. Neither may be inferred from a fallback chain, and
// > neither from the absence of a flag.
//
// Three breaches, one law:
//
// - **M1** — the unmount's forced tick mirrored `lastSavedRef`, i.e. the last
//   model that LANDED ON DISK, over a good mirror of unlanded work. Two sibling
//   cleanups shared a mutable ref: the flush nulled it and the tick, running
//   after it by declaration order, fell through `currentModel`'s third rung.
// - **M2** — the debounce's PAUSE branch returned before populating that ref at
//   all, so throughout a conflict or cowork hold the only copy was the live
//   editor.
// - **M3** — an ACKNOWLEDGED notice makes `recordPreservationRefusal` drop a
//   later refusal without arming one, so `isWriteProtected` stays false and a
//   write that never happened was reported LANDED — deleting the mirror.
//
// **Why no pre-557 suite could see any of this.** Every one of them gives the
// hook a fake editor that never destroys itself, and the defect needs the
// editor GONE before the parent cleanup runs — which is what React does in
// production, and what `useDocument.ts` says at its own unmount site. So these
// legs destroy the editor on the unmount edge, exactly as the child cleanup
// does, and then ask what the mirror holds.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import React from "react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readDocBundle: (...a: unknown[]) => mockRead(...a),
  writeDocBundle: (...a: unknown[]) => mockWrite(...a),
  snapshotConflictSides: async () => null,
  invalidateSidecarBundle: () => {},
}));

let unresolved = false;
const fakeCtx = {
  watcher: { hasUnresolvedChange: () => unresolved },
  get activeDocId() {
    return "doc-1";
  },
  registerUnsavedGetter: () => () => {},
  registerDocActions: () => () => {},
};
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => fakeCtx,
}));

// A REAL in-memory IndexedDB. The mirror's own slot is the subject here — the
// load path reads it back to decide whether to raise a recovery offer — so a
// stub that forgets what it stored could not represent the question.
const idb = new Map<string, unknown>();
const mirrorWrites: { docId: string; content: JSONContent }[] = [];
let dels = 0;
vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (k: string) => idb.get(k),
  set: async (k: string, v: unknown) => {
    idb.set(k, v);
    mirrorWrites.push(v as { docId: string; content: JSONContent });
  },
  del: async (k: string) => {
    dels++;
    idb.delete(k);
  },
  keys: async () => [...idb.keys()],
}));

import { useDocument } from "../useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import { clearUnsavedWork, hasUnlandedWork, getUnsavedWork } from "@/lib/unsaved-work";
import {
  acknowledgePreservationNotice,
  clearPreservationNotice,
  isWriteProtected,
  recordPreservationRefusal,
} from "@/lib/preservation-notice";
import { __resetTickersForTests } from "@/lib/emergency-mirror";
import {
  __resetMirrorRecoveryForTests,
  getRecoveryOffer,
} from "@/lib/mirror-recovery";

const DISK: JSONContent = { type: "doc", content: [] };
const WORK: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "the work" }] }],
};

/**
 * A fake editor that can be DESTROYED, which is the whole point: in production
 * React tears the editor down in child cleanup BEFORE `useDocument`'s parent
 * cleanup runs, so the unmount's model source is whatever survives that.
 */
function destructibleEditor(c: JSONContent) {
  const state = { destroyed: false };
  const ed = {
    getJSON: () => c,
    get isDestroyed() {
      return state.destroyed;
    },
  } as unknown as Editor;
  return { ed, destroy: () => (state.destroyed = true) };
}

function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(DocPipeline, { docId, key: docId, children });
  };
}
/** A REAL user edit — the `addToHistory !== false` test both gates use. */
const userTx = { docChanged: true, getMeta: () => undefined } as never;

const refusal = {
  source: "write",
  region: "body",
  before: 100,
  after: 10,
  lost: 90,
  allowed: 4,
} as const;

/** The door refuses, exactly as the real one does: it publishes to the notice
 *  channel AND returns the refusal. */
function doorRefuses() {
  mockWrite.mockImplementation(async () => {
    recordPreservationRefusal("doc-1", { ...refusal });
    return { landed: false, reason: "preservation" };
  });
}

beforeEach(() => {
  mockRead.mockReset().mockResolvedValue({ content: DISK, editorState: {} });
  mockWrite.mockReset().mockResolvedValue({ landed: true });
  idb.clear();
  mirrorWrites.length = 0;
  dels = 0;
  resetPipelines();
  resetFlushers();
  __resetTickersForTests();
  clearUnsavedWork();
  clearPreservationNotice();
  __resetMirrorRecoveryForTests();
  unresolved = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const lastMirror = () => mirrorWrites.at(-1) ?? null;

describe("a document that leaves memory keeps a mirror of THE WORK", () => {
  it("M1 · a BLOCKED doc's unmount does not mirror the disk copy over it", async () => {
    vi.useFakeTimers();
    doorRefuses();
    const { ed, destroy } = destructibleEditor(WORK);
    const { result, unmount } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await vi.runOnlyPendingTimersAsync();

    act(() => result.current.onUpdate(ed, userTx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // the debounce fires and is refused
    });
    expect(getUnsavedWork("doc-1")?.reason).toBe("preservation");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000); // a 5 s tick mirrors the work
    });
    expect(lastMirror()?.content).toEqual(WORK);

    // React destroys the editor in CHILD cleanup, before the parent cleanup.
    act(() => {
      destroy();
      unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // PRE-557: the forced tick fell through to `lastSavedRef` and wrote DISK
    // over it. The mirror then matched the file and the next open offered
    // nothing — the 2026-08-19 loss, silently.
    expect(
      lastMirror()?.content,
      "the mirror must hold the unlanded work, never the copy already on disk",
    ).toEqual(WORK);
  });

  it("M1 · …and the next open raises a recovery offer holding that work", async () => {
    vi.useFakeTimers();
    doorRefuses();
    const { ed, destroy } = destructibleEditor(WORK);
    const first = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
    await vi.runOnlyPendingTimersAsync();
    act(() => first.result.current.onUpdate(ed, userTx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    act(() => {
      destroy();
      first.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Re-open. The load path compares the surviving mirror against the bundle
    // it just read; equal hashes mean "the work reached disk by some other
    // route" and the slot is dropped.
    mockWrite.mockReset().mockResolvedValue({ landed: true });
    resetPipelines();
    resetFlushers();
    __resetTickersForTests();
    clearUnsavedWork();
    clearPreservationNotice();
    renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
    // The load path's mirror comparison is a fire-and-forget async IIFE behind
    // the bundle read, so it settles several microtask hops later.
    await act(async () => {
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      getRecoveryOffer("doc-1")?.entry.content,
      "work that never reached disk must be offered back on the next open",
    ).toEqual(WORK);
  });

  it("M1 · with NOTHING newer than disk in memory, the tick reports no-model and the good mirror survives", async () => {
    vi.useFakeTimers();
    // A good mirror already on the slot — the 5 s ticks of an earlier blocked
    // stretch, or another window's.
    idb.set("emergency-mirror/doc-1", {
      docId: "doc-1",
      content: WORK,
      savedAt: Date.now(),
      lastLandedAt: null,
      reason: "preservation",
      windowId: "w",
      hash: "seeded",
    });

    const { ed, destroy } = destructibleEditor(WORK);
    const { result, unmount } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await vi.runOnlyPendingTimersAsync();
    mirrorWrites.length = 0;

    // Type, then leave BEFORE the 1500 ms debounce fires — an ordinary paper
    // switch. Nothing has ever populated the snapshot ref, so once the editor
    // is gone there is genuinely nothing in memory that is newer than disk.
    act(() => result.current.onUpdate(ed, userTx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => {
      destroy();
      unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // PRE-557 `currentModel`'s third rung answered `lastSavedRef` — by
    // definition the last model that REACHED DISK — so the forced tick wrote
    // the disk copy over the work. `emergency-mirror`'s own `no-model` bail
    // exists for exactly this and was unreachable: the chain never returned
    // null once a paper had saved even once.
    expect(
      mirrorWrites.map((m) => m.content),
      "with nothing newer than disk in memory the tick must write NOTHING",
    ).toEqual([]);
    expect(
      (idb.get("emergency-mirror/doc-1") as { content: JSONContent }).content,
      "the good mirror must survive untouched",
    ).toEqual(WORK);
  });

  it("M2 · an autosave PAUSE leaves a snapshot outside the live editor", async () => {
    vi.useFakeTimers();
    unresolved = true; // the 364 clobber guard holds every write
    const { ed, destroy } = destructibleEditor(WORK);
    const { result, unmount } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await vi.runOnlyPendingTimersAsync();

    act(() => result.current.onUpdate(ed, userTx));
    // The debounce fires into the PAUSE branch and re-arms. Deliberately short
    // of a 5 s mirror tick: the forced tick on unmount is the only chance this
    // work gets, which is exactly the state the mirror exists for.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(getUnsavedWork("doc-1")?.reason).toBe("conflict");
    expect(mockWrite, "a paused autosave writes nothing to disk").not.toHaveBeenCalled();
    expect(mirrorWrites, "no 5 s tick has run yet").toHaveLength(0);

    act(() => {
      destroy();
      unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // PRE-557: the pause branch returned nineteen lines before the snapshot
    // assignment, so the work was editor-only and the forced tick mirrored
    // `lastSavedRef` — the disk copy.
    expect(
      lastMirror()?.content,
      "a pause must leave the work somewhere other than the live editor",
    ).toEqual(WORK);
  });

  it("M3 · an ACKNOWLEDGED notice does not make a later refusal read as landed", async () => {
    vi.useFakeTimers();
    const { ed } = destructibleEditor(WORK);
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await vi.runOnlyPendingTimersAsync();

    // The user has already answered a standing refusal ("Save anyway").
    recordPreservationRefusal("doc-1", { ...refusal });
    acknowledgePreservationNotice("doc-1");
    expect(
      isWriteProtected("doc-1"),
      "the acknowledgment is what makes the retired flag lie",
    ).toBe(false);

    // A LATER, unrelated refusal — e.g. the serializer meeting a node this
    // build cannot express. `recordPreservationRefusal` drops it (the user made
    // the call), so the flag stays false while the door refuses.
    doorRefuses();
    dels = 0;
    act(() => result.current.onUpdate(ed, userTx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(mockWrite).toHaveBeenCalled();
    // PRE-557: `isWriteProtected` was false, so this reported LANDED — clearing
    // the dirty state, advancing `lastSavedRef` and DELETING the mirror.
    expect(
      hasUnlandedWork("doc-1"),
      "a refused write leaves the work unlanded, acknowledged notice or not",
    ).toBe(true);
    expect(getUnsavedWork("doc-1")?.reason).toBe("preservation");
    expect(dels, "nothing may clear the mirror for a write that did not land").toBe(0);
  });
});

describe("accepting controls — an implementation that never clears anything fails here", () => {
  it("a genuinely LANDED write still clears the dirty state and drops the mirror", async () => {
    vi.useFakeTimers();
    const { ed } = destructibleEditor(WORK);
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await vi.runOnlyPendingTimersAsync();
    dels = 0;

    act(() => result.current.onUpdate(ed, userTx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(mockWrite).toHaveBeenCalled();
    expect(hasUnlandedWork("doc-1")).toBe(false);
    expect(getUnsavedWork("doc-1")?.reason).toBe(null);
    expect(dels, "a landed write drops the mirror").toBeGreaterThan(0);
  });

  it("a CLEAN document takes no forced tick when it leaves memory", async () => {
    vi.useFakeTimers();
    const { destroy } = destructibleEditor(WORK);
    const { unmount } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await vi.runOnlyPendingTimersAsync();
    mirrorWrites.length = 0;

    act(() => {
      destroy();
      unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mirrorWrites, "nothing unlanded — nothing to mirror").toHaveLength(0);
  });

  it("a read-only document reports neither landed nor blocked", async () => {
    vi.useFakeTimers();
    mockWrite.mockImplementation(async () => ({
      landed: false,
      reason: "read-only",
    }));
    const { ed } = destructibleEditor(WORK);
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await vi.runOnlyPendingTimersAsync();
    dels = 0;

    act(() => result.current.onUpdate(ed, userTx));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Not a landed write (nothing reached disk, so nothing may be cleared) and
    // not blocked work (the channel is armed only by an undoable user edit,
    // which a read-only main text cannot produce). The `userTx` above is the
    // harness standing in for an editor this surface would not give the user.
    expect(mockWrite).toHaveBeenCalled();
    expect(dels, "a write that never happened may not drop the mirror").toBe(0);
    expect(getUnsavedWork("doc-1")?.reason).toBe(null);
  });
});
