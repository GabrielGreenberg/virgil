// @vitest-environment jsdom
//
// **Task 489 — the WIRING**, which is the half no test of the authority or the
// pause door can see.
//
// The mechanism was never missing: `/editor/*` skills have taken the pen on
// every commit since the apply_response chip shipped. What was missing is that
// the app asked the wrong record, and only while the USER had turned
// collaborator mode on — so on the ordinary solo paper the pen reached nothing.
//
// So these legs drive the REAL hooks and ask what the app DID: does
// `canEditMainText` flip from a `.virgil/pen-context.json` that `collab.json`
// knows nothing about, and does the autosave pause and SAY WHY.
//
// **No pre-489 suite could see any of this.** There is no `useCollab` suite in
// the repo at all, and `useDocument`'s own suites drive the conflict rung with
// a watcher — a boolean with no document in it, so a per-doc pause source is
// unrepresentable in every one of them.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import React from "react";

/* ── The disk, as the two hooks reach it ──────────────────────────────── */

const COLLAB_FILE = "collab.json";
const PEN_CONTEXT = ".virgil/pen-context.json";

/** What `.virgil/pen-context.json` holds, or `null` when no skill holds it. */
let penContextRaw: string | null = null;
/** What `virgil/collab.json` holds. Absent on an ordinary solo paper. */
let collabSidecar: unknown = null;

const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  // The collab poll.
  readSidecar: async (_docId: string, filename: string, fallback: unknown) =>
    filename === COLLAB_FILE ? (collabSidecar ?? fallback) : fallback,
  writeSidecar: async () => {},
  // The cowork-pen poll — the record the skill ALWAYS writes.
  readTextFile: async (_docId: string, relPath: string) =>
    relPath === PEN_CONTEXT ? penContextRaw : null,
  // useDocument's own surface.
  readDocBundle: async () => ({ content: { type: "doc", content: [] } }),
  writeDocBundle: (...a: unknown[]) => mockWrite(...a),
  snapshotConflictSides: async () => null,
  invalidateSidecarBundle: () => {},
}));

// No external change anywhere in this file: every pause a leg observes is the
// COWORK rung, never the 364 clobber guard.
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => ({
    watcher: { hasUnresolvedChange: () => false },
    activeDocId: "doc-1",
    registerUnsavedGetter: () => () => {},
    registerDocActions: () => () => {},
  }),
}));

vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
  keys: async () => [],
}));

import { useCollab } from "../useCollab";
import { useDocument } from "../useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import { clearUnsavedWork, getUnsavedWork } from "@/lib/unsaved-work";
import { clearCoworkPen, coworkPenHeld } from "@/lib/cowork-pen";
import { __resetTickersForTests } from "@/lib/emergency-mirror";
import { requestSaveNow } from "@/lib/save-request";

const SAMPLE: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
};
function fakeEditor(): Editor {
  return { getJSON: () => SAMPLE, isDestroyed: false } as unknown as Editor;
}
/** A REAL user edit — the write gate's own `addToHistory !== false` test. */
const userTx = { docChanged: true, getMeta: () => undefined } as never;

function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(DocPipeline, { docId, key: docId, children });
  };
}

/** The record `_common.acquire_pen` writes, verbatim in shape. */
function heldPen(ttlSec = 30) {
  const now = new Date();
  return JSON.stringify({
    holder: "claude",
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlSec * 1000).toISOString(),
    prior_collab_enabled: false,
    collab_existed: false,
    prior_pen: { holder: null },
  });
}

beforeEach(() => {
  penContextRaw = null;
  collabSidecar = null;
  mockWrite.mockReset().mockResolvedValue(undefined);
  resetPipelines();
  resetFlushers();
  __resetTickersForTests();
  clearUnsavedWork();
  clearCoworkPen();
});

afterEach(() => {
  cleanup();
  clearCoworkPen();
});

/* ── The read-only gate ───────────────────────────────────────────────── */

describe("useCollab · the cowork pen makes the main text read-only", () => {
  it("flips `canEditMainText` on a SOLO paper, where collab.json does not exist", async () => {
    // THE REPORTED CASE. `acquire_pen` only touches collab.json if the paper
    // already has one, so on this paper the pre-489 app saw nothing at all.
    const { result } = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(result.current.canEditMainText).toBe(true));

    penContextRaw = heldPen();
    await act(async () => {
      // The 5s poll. The suite drives real timers, so the poll is awaited
      // rather than advanced — the point is the WIRE, not the clock.
      await new Promise((r) => setTimeout(r, 0));
    });
    // Force the next tick without waiting five real seconds: remount is the
    // same door the poll enters (`load()` runs immediately on mount).
    cleanup();
    const second = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(second.result.current.canEditMainText).toBe(false));
    expect(second.result.current.coworkPen?.source).toBe("pen-context");
    expect(second.result.current.coworkPen?.holder).toBe("claude");
    // …and collaborator mode was never enabled by the user.
    expect(second.result.current.enabled).toBe(false);
  });

  it("publishes to the store, so the autosave gate can read it", async () => {
    penContextRaw = heldPen();
    renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(coworkPenHeld("doc-1")).toBe(true));
  });

  it("RELEASES when the skill's record is gone", async () => {
    penContextRaw = heldPen();
    const first = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(first.result.current.canEditMainText).toBe(false));

    penContextRaw = null; // release_pen deletes the file
    cleanup();
    const second = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(second.result.current.canEditMainText).toBe(true));
    expect(coworkPenHeld("doc-1")).toBe(false);
  });

  it("RELEASES a crashed skill's hold once its TTL has passed", async () => {
    // release_pen never ran, so the file is still there — the whole reason the
    // pen-context record carries an expiry rather than relying on a heartbeat.
    penContextRaw = heldPen(-60);
    const { result } = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(result.current.canEditMainText).toBe(true));
    expect(result.current.coworkPen).toBeNull();
  });

  // The CONTROL that keeps the gate from being "read-only whenever anything is
  // on disk": a HUMAN partner's pen is the collab feature, not a cowork lock.
  it("is NOT a human partner's pen — collab mode still decides that", async () => {
    collabSidecar = {
      enabled: true,
      participants: [{ name: "Gabriel", color: "#14b8a6", firstSeen: new Date().toISOString() }],
      pen: {
        holder: "Gabriel",
        since: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        requestedBy: [],
      },
      presence: {},
    };
    const { result } = renderHook(() => useCollab("doc-1"));
    // The pen is a partner's, so editing is refused by the COLLAB rule…
    await waitFor(() => expect(result.current.canEditMainText).toBe(false));
    // …and NOT by the cowork rung, which must see nothing here.
    expect(result.current.coworkPen).toBeNull();
    expect(coworkPenHeld("doc-1")).toBe(false);
  });

  // …and the other control: nothing held, nothing changed.
  it("leaves an ordinary solo paper editable", async () => {
    const { result } = renderHook(() => useCollab("doc-1"));
    await waitFor(() => expect(result.current.sidecar.enabled).toBe(false));
    expect(result.current.canEditMainText).toBe(true);
    expect(result.current.coworkPen).toBeNull();
  });
});

/* ── The autosave pause ───────────────────────────────────────────────── */

describe("useDocument · a held cowork pen pauses the autosave and SAYS WHY", () => {
  it("does not write, and reports `cowork` on the save-state channel", async () => {
    vi.useFakeTimers();
    try {
      // A skill is mid-commit against this paper.
      penContextRaw = heldPen();
      const { result: pen } = renderHook(() => useCollab("doc-1"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(coworkPenHeld("doc-1")).toBe(true);
      void pen;

      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      act(() => result.current.onUpdate(fakeEditor(), userTx));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(mockWrite).not.toHaveBeenCalled();
      expect(getUnsavedWork("doc-1")?.reason).toBe("cowork");
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes normally once the pen is released — the pause is transient", async () => {
    vi.useFakeTimers();
    try {
      penContextRaw = heldPen();
      renderHook(() => useCollab("doc-1"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();
      act(() => result.current.onUpdate(fakeEditor(), userTx));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).not.toHaveBeenCalled();

      // The skill's commit finished: release_pen deleted the record, and the
      // 5s poll re-derives. The debounce has been RE-ARMED throughout, so the
      // user's edit lands by itself.
      penContextRaw = null;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });
      expect(mockWrite).toHaveBeenCalled();
      expect(getUnsavedWork("doc-1")?.reason).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // The manual door: "Save now" must not walk past the guard either.
  it("the manual save door reports `cowork` rather than writing", async () => {
    vi.useFakeTimers();
    try {
      penContextRaw = heldPen();
      renderHook(() => useCollab("doc-1"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();
      act(() => result.current.onUpdate(fakeEditor(), userTx));

      // The door is published to `save-request.ts`, not returned by the hook —
      // its callers (the topbar badge, Cmd+S) are nowhere near this subtree.
      let outcome: { landed: boolean; reason?: string } = { landed: true };
      await act(async () => {
        outcome = (await requestSaveNow("doc-1")) as typeof outcome;
      });
      expect(outcome.landed).toBe(false);
      expect(outcome.reason).toBe("cowork");
      expect(mockWrite).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
