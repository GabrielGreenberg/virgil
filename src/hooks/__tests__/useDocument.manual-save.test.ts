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

// RENEGOTIATED (task 557, then 567). Until 557 this read: "the preservation
// channel decides whether a write LANDED" — and driving the verdict from
// `isWriteProtected` was exactly the inference 557 retired. `isWriteProtected`
// answers *is a notice standing that the user has not answered?*, which comes
// apart from *did this write land?* the moment one is ACKNOWLEDGED. **The DOOR
// decides**, and it says so in its receipt.
//
// 557 left `restoreFromMirror` reading the flag after `save()` returned, and
// 567 retired that too: `save` RETURNS its receipt and every verdict door reads
// it, so the hook no longer reads the flag ANYWHERE. What it does reach in the
// store is the flag's one WRITER, `acknowledgePreservationNotice` — recorded on
// a landed receipt that carried the badge's "Save anyway" claim — spied here so
// the 567 legs can see whether, and when, it is called.
//
// `refusing` is what makes the fake door refuse, and the door steps aside for
// the claim exactly as both real backends do.
let refusing = false;
const ackSpy = vi.fn();
vi.mock("@/lib/preservation-notice", () => ({
  acknowledgePreservationNotice: (...a: unknown[]) => ackSpy(...a),
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
  // Task 557 — the write door REPORTS what it did, and `refusing` is what
  // makes it refuse. A fake that always resolved "landed" would make every
  // refusal leg below unfalsifiable.
  mockWrite.mockImplementation(
    async (_h: unknown, _doc: unknown, opts?: { acknowledgePreservation?: boolean }) =>
      refusing && !opts?.acknowledgePreservation
        ? { landed: false, reason: "preservation" }
        : { landed: true },
  );
  mockRead.mockResolvedValue({ content: EMPTY, editorState: {} });
  resetPipelines();
  resetFlushers();
  clearUnsavedWork();
  ackSpy.mockClear();
  unresolved = false;
  refusing = false;
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
    refusing = true;
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

    refusing = false;
    let out;
    await act(async () => {
      out = await requestSaveNow("doc-1");
    });
    expect(out).toEqual({ landed: true });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it("REPORTS the refusal off the channel, never from the absence of a throw", async () => {
    const result = await mounted();
    refusing = true; // a preservation gate is refusing
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

describe("requestSaveNow · the \"Save anyway\" CLAIM (task 567)", () => {
  // The preservation badge's danger confirm promises that saving will write the
  // version in the editor over the file. Until 567 it flipped the notice flag
  // and requested NO write — the refusal had already disarmed the debounce, so
  // the file stayed stale until the next keystroke while the save badge went
  // on saying "Not saving … Review…". The gesture asks THIS door now, carrying
  // the acknowledgment as a claim the gate steps aside for; the acknowledgment
  // is recorded on the LANDED receipt, and nowhere else.
  const type = (result: Awaited<ReturnType<typeof mounted>>) =>
    act(() => {
      result.current.onUpdate(editor(TYPED), {
        docChanged: true,
        getMeta: () => undefined,
      } as never);
    });

  it("a refused document is WRITTEN when the claim rides the door, and the notice is then acknowledged", async () => {
    const result = await mounted();
    refusing = true;
    type(result);
    await act(async () => {
      await requestSaveNow("doc-1"); // the gate refuses; the debounce is disarmed
    });
    expect(hasUnlandedWork("doc-1")).toBe(true);
    expect(ackSpy).not.toHaveBeenCalled();
    mockWrite.mockClear();

    let out: unknown;
    await act(async () => {
      out = await requestSaveNow("doc-1", { acknowledgePreservation: true });
    });
    // PRE-567: nothing was written at all — the badge flipped the flag and
    // returned, and this document stayed stale on disk.
    expect(out).toEqual({ landed: true });
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(
      (mockWrite.mock.calls[0][2] as { acknowledgePreservation?: boolean }).acknowledgePreservation,
      "the claim reaches the write door",
    ).toBe(true);
    expect(ackSpy, "the acknowledgment is recorded on the landed receipt").toHaveBeenCalledWith("doc-1");
    expect(hasUnlandedWork("doc-1"), "…and the save-state tier is clean").toBe(false);
  });

  it("a claim whose write THROWS records no acknowledgment and reports `error`", async () => {
    const result = await mounted();
    refusing = true;
    type(result);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mockWrite.mockImplementationOnce(async () => {
      throw new Error("EACCES: permission revoked");
    });
    let out: unknown;
    await act(async () => {
      out = await requestSaveNow("doc-1", { acknowledgePreservation: true });
    });
    quiet.mockRestore();
    expect(out).toEqual({ landed: false, reason: "error" });
    expect(
      ackSpy,
      "an acknowledgment the write could not honour is not recorded — the notice stands",
    ).not.toHaveBeenCalled();
    expect(hasUnlandedWork("doc-1")).toBe(true);
  });

  it("the claim never walks past the clobber guard", async () => {
    // A document can be BOTH refused and conflicted. The 364 pause is decided
    // before the door is asked, so the claim never reaches it; the caller is
    // routed to the conflict flow, which must be answered first.
    const result = await mounted();
    refusing = true;
    type(result);
    unresolved = true;
    mockWrite.mockClear();
    let out: unknown;
    await act(async () => {
      out = await requestSaveNow("doc-1", { acknowledgePreservation: true });
    });
    expect(out).toEqual({ landed: false, reason: "conflict" });
    expect(mockWrite).not.toHaveBeenCalled();
    expect(ackSpy).not.toHaveBeenCalled();
  });

  it("an ordinary Save carries NO claim — a refused document stays refused", async () => {
    // The Save button and Cmd+S enter this same door without the claim, and a
    // standing refusal must still refuse them: the acknowledgment is a decision
    // only the badge's confirm is entitled to make.
    const result = await mounted();
    refusing = true;
    type(result);
    let out: unknown;
    await act(async () => {
      out = await requestSaveNow("doc-1");
    });
    expect(out).toEqual({ landed: false, reason: "preservation" });
    expect(
      (mockWrite.mock.calls.at(-1)?.[2] as { acknowledgePreservation?: boolean } | undefined)
        ?.acknowledgePreservation,
    ).toBeUndefined();
    expect(ackSpy).not.toHaveBeenCalled();
  });
});
