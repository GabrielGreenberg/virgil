// @vitest-environment jsdom
//
// Task 1174 — the autosave debounce has a MAXWAIT. A pure trailing 1500 ms
// debounce never fired during an unbroken typing burst, so `dirtySince` aged
// past UNSAVED_WARN_MS (20 s) and the bar showed "Unsaved · a few seconds"
// while nothing was wrong. These legs type continuously (fake timers) and ask
// the REAL hook whether the work kept landing.


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
import { deriveSaveState } from "@/lib/save-state";
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS } from "../useDocument";

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
  // Task 557 — the door REPORTS. A fake that resolved `undefined` was the
  // pre-557 shape in which the caller had to guess the verdict from a second
  // source; it now has to state it, which is the whole contract.
  mockWrite.mockReset().mockResolvedValue({ landed: true });
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

function para(n: number): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: `word ${n}` }] }],
  };
}

describe("useDocument · autosave maxWait (task 1174)", () => {
  it("continuous typing for over 30 s lands saves and never reaches the `unsaved` tier", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      mockWrite.mockClear();

      // A keystroke every 400 ms — never a 1500 ms pause — for 32 s.
      const tiers = new Set<string>();
      for (let i = 0; i < 80; i++) {
        act(() => result.current.onUpdate(editor(para(i)), userTx));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(400);
        });
        tiers.add(deriveSaveState(getUnsavedWork("doc-1")).tier);
      }
      expect(tiers.has("unsaved")).toBe(false);
      // At least one write per maxWait window while typing.
      expect(mockWrite.mock.calls.length).toBeGreaterThanOrEqual(
        Math.floor(32_000 / AUTOSAVE_MAX_WAIT_MS),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("the trailing debounce is unchanged: a single edit writes after the pause, not before", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      mockWrite.mockClear();
      act(() => result.current.onUpdate(editor(SAMPLE), userTx));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 100);
      });
      expect(mockWrite).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(hasUnlandedWork("doc-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a PAUSED autosave is still held at the maxWait fire — the pause guard covers it", async () => {
    vi.useFakeTimers();
    try {
      unresolved = true;
      const { result } = renderHook(() => useDocument(), { wrapper: withPipeline("doc-1") });
      await vi.runOnlyPendingTimersAsync();
      for (let i = 0; i < 40; i++) {
        act(() => result.current.onUpdate(editor(para(i)), userTx));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(400);
        });
      }
      expect(mockWrite).not.toHaveBeenCalled();
      expect(getUnsavedWork("doc-1")?.reason).toBe("conflict");
    } finally {
      vi.useRealTimers();
    }
  });
});
