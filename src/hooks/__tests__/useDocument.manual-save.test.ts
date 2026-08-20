// @vitest-environment jsdom
//
// THE MANUAL-SAVE DOOR (task 392) — Gabriel's "a save button that becomes
// available whenever things haven't been auto saved", at the level where the
// surgical version of the feature would have failed.
//
// A button wired to `flushPending` would have reported success throughout the
// 2026-08-19 incident, because a REFUSED write resolves normally. So every leg
// here asserts the door's REPORT against the channel rather than against the
// absence of a throw, and the conflict leg asserts that nothing reached disk —
// a manual save that walked past the clobber guard would be doing the one thing
// every automatic path in this file refuses to do.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import React from "react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readDocBundle: (...args: unknown[]) => mockRead(...args),
  writeDocBundle: (...args: unknown[]) => mockWrite(...args),
  snapshotConflictSides: async () => null,
  invalidateSidecarBundle: () => {},
}));

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

// The preservation channel decides whether a write LANDED. Drive it directly:
// that is exactly what a real gate does, and it is what makes "the report is
// the channel" testable without a storage backend.
let protectedDoc = false;
vi.mock("@/lib/preservation-notice", () => ({
  isWriteProtected: () => protectedDoc,
}));

import { useDocument } from "../useDocument";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";
import { clearUnsavedWork, hasUnlandedWork } from "@/lib/unsaved-work";
import { requestSaveNow } from "@/lib/save-request";

const EMPTY: JSONContent = { type: "doc", content: [] };
const TYPED: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
};

beforeEach(() => {
  cleanup(); // unmount before the registry forgets these pipelines
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  mockRead.mockResolvedValue({ content: EMPTY, editorState: {} });
  resetPipelines();
  resetFlushers();
  clearUnsavedWork();
  unresolved = false;
  protectedDoc = false;
});

function editor(content: JSONContent): Editor {
  return { getJSON: () => content, isDestroyed: false } as unknown as Editor;
}

function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    // `DocPipelineProps` requires `children`, so the createElement(child-arg)
    // form fails tsc — the same trade the two sibling useDocument harnesses
    // make, with the lint note stated rather than inherited silently.
    // eslint-disable-next-line react/no-children-prop
    return React.createElement(DocPipeline, { docId, key: docId, children });
  };
}

async function mounted(docId = "doc-1") {
  const { result } = renderHook(() => useDocument(), {
    wrapper: withPipeline(docId),
  });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

describe("requestSaveNow · the door", () => {
  it("with no pipeline registered, reports `no-door` rather than success", async () => {
    // A Cmd+S with nothing open, or fired at a pipeline mid-teardown, must not
    // report work safe that nobody wrote.
    const out = await requestSaveNow("doc-nobody");
    expect(out).toEqual({ landed: false, reason: "no-door" });
  });

  it("lands the pending edit and reports it, clearing the channel", async () => {
    const result = await mounted();
    act(() => {
      result.current.onUpdate(editor(TYPED), {
        docChanged: true,
        getMeta: () => undefined,
      } as never);
    });
    expect(hasUnlandedWork("doc-1")).toBe(true);

    let out;
    await act(async () => {
      out = await requestSaveNow("doc-1");
    });
    expect(out).toEqual({ landed: true });
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][1]).toEqual(TYPED);
    expect(hasUnlandedWork("doc-1")).toBe(false);
  });

  it("writes even with NO armed debounce — a refused write leaves work with no retry", async () => {
    // The surgical version of this feature calls `flushPending`, which
    // early-returns on a null debounce handle. After a refusal the handle IS
    // null and the work is very much unlanded, so "nothing pending" is exactly
    // the wrong answer to a user asking for their work to be saved.
    const result = await mounted();
    protectedDoc = true;
    act(() => {
      result.current.onUpdate(editor(TYPED), {
        docChanged: true,
        getMeta: () => undefined,
      } as never);
    });
    await act(async () => {
      await requestSaveNow("doc-1"); // refused; the debounce is disarmed
    });
    mockWrite.mockClear();

    protectedDoc = false;
    let out;
    await act(async () => {
      out = await requestSaveNow("doc-1");
    });
    expect(out).toEqual({ landed: true });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it("REPORTS the refusal off the channel, never from the absence of a throw", async () => {
    const result = await mounted();
    protectedDoc = true; // a preservation gate is refusing
    act(() => {
      result.current.onUpdate(editor(TYPED), {
        docChanged: true,
        getMeta: () => undefined,
      } as never);
    });
    let out;
    await act(async () => {
      out = await requestSaveNow("doc-1");
    });
    // `writeDocBundle` resolved normally — the whole trap this closes.
    expect(mockWrite).toHaveBeenCalled();
    expect(out).toEqual({ landed: false, reason: "preservation" });
    expect(hasUnlandedWork("doc-1")).toBe(true);
  });

  it("respects the clobber guard: a conflict reports, and writes NOTHING", async () => {
    const result = await mounted();
    act(() => {
      result.current.onUpdate(editor(TYPED), {
        docChanged: true,
        getMeta: () => undefined,
      } as never);
    });
    unresolved = true; // an external change is standing
    mockWrite.mockClear();

    let out;
    await act(async () => {
      out = await requestSaveNow("doc-1");
    });
    expect(out).toEqual({ landed: false, reason: "conflict" });
    // The defect this leg exists for: a manual save that reached
    // `writeDocBundle` would overwrite the external edit the 364 guard is
    // deliberately protecting — the one thing no automatic path here does.
    expect(mockWrite).not.toHaveBeenCalled();
    expect(hasUnlandedWork("doc-1")).toBe(true);
  });

  it("a clean document answers `landed` without inventing work", async () => {
    await mounted();
    let out;
    await act(async () => {
      out = await requestSaveNow("doc-1");
    });
    expect(out).toEqual({ landed: true });
  });

  it("the door is per DOCUMENT — asking doc A never writes doc B", async () => {
    const a = await mounted("doc-a");
    await mounted("doc-b");
    act(() => {
      a.current.onUpdate(editor(TYPED), {
        docChanged: true,
        getMeta: () => undefined,
      } as never);
    });
    mockWrite.mockClear();
    await act(async () => {
      await requestSaveNow("doc-b");
    });
    // doc-b had nothing to write; doc-a's edit is untouched and still unlanded.
    expect(hasUnlandedWork("doc-a")).toBe(true);
    for (const call of mockWrite.mock.calls) {
      expect((call[0] as { docId: string }).docId).toBe("doc-b");
    }
  });
});
