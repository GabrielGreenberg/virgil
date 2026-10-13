// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

// This suite's disk: `mockRead(docId, filename)` / `mockWrite(handle, filename, payload)`.
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
// The re-resolve trigger needs a live bus; these fake editors have none, and
// every assertion here is about the docId/editor switch, not a structural rev.
vi.mock("@/hooks/useStructuralRevisions", () => ({
  useStructuralRevisions: () => ({ blocks: 0 }),
}));

import { useFocusMode } from "@/hooks/useFocusMode";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { __resetForTests as resetFlushers } from "@/lib/multi-window/pending-saves";

/**
 * Task 1092 — `useFocusMode` is mounted ONCE at layout level and its `docId`
 * switches under it. Under multi-doc keep-alive the incoming paper's editor is
 * warm in the very render the switch lands, while the persisted band is still
 * the OUTGOING paper's until the new `focus.json` read resolves. Pre-fix, the
 * re-anchor effect ran A's band against B's doc, found both anchors dead,
 * deactivated — stamping the loader-stomp guard so B's read was DISCARDED —
 * and wrote INACTIVE over B's file.
 */

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", attrs: { uuid: { default: null } } },
    text: {},
  },
});

function fakeEditor(uuids: string[]): Editor {
  const doc: PMNode = schema.node(
    "doc",
    null,
    uuids.map((u) => schema.node("paragraph", { uuid: u }, [schema.text(u)])),
  );
  return { state: { doc } } as unknown as Editor;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const A_BAND = { active: true, locked: true, startUuid: "a2", endUuid: "a3" };
const B_BAND = { active: true, locked: false, startUuid: "b1", endUuid: "b2" };
const editorA = fakeEditor(["a1", "a2", "a3", "a4"]);
const editorB = fakeEditor(["b0", "b1", "b2", "b3"]);

function writesTo(docId: string) {
  return mockWrite.mock.calls.filter(
    ([handle, fn]) => (handle as { docId: string }).docId === docId && fn === "focus.json",
  );
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
  resetFlushers();
  beginDocPipeline("doc-A");
  beginDocPipeline("doc-B");
});
afterEach(() => cleanup());

type Props = { id: string; editor: Editor };

describe("useFocusMode across a warm doc switch (task 1092)", () => {
  it("B's pending read is NOT stomped by A's band re-anchored against B's editor", async () => {
    const bRead = deferred<unknown>();
    mockRead.mockImplementation((docId: string) =>
      docId === "doc-A" ? Promise.resolve(A_BAND) : bRead.promise,
    );
    const { result, rerender, unmount } = renderHook(
      ({ id, editor }: Props) => useFocusMode(id, editor),
      { initialProps: { id: "doc-A", editor: editorA } },
    );
    await waitFor(() => expect(result.current.band.startUuid).toBe("a2"));
    expect(result.current.state).toMatchObject({ active: true, startBlockIndex: 1, endBlockIndex: 2 });

    // Switch: B's editor is already warm, B's focus.json read is in flight.
    rerender({ id: "doc-B", editor: editorB });
    // Nothing of A's band shows in B while B's read is pending.
    expect(result.current.band.active).toBe(false);

    await act(async () => {
      bRead.resolve(B_BAND);
      await bRead.promise;
    });
    await waitFor(() => expect(result.current.band).toEqual(B_BAND));
    expect(result.current.state).toMatchObject({ active: true, startBlockIndex: 1, endBlockIndex: 2 });

    // Settle any coalesced write; B's file must never have been written.
    unmount();
    await Promise.resolve();
    expect(writesTo("doc-B")).toEqual([]);
  });

  it("legacy leg: A's legacy indices are never resolved against B's doc and written into B", async () => {
    const bRead = deferred<unknown>();
    mockRead.mockImplementation((docId: string) =>
      docId === "doc-A"
        ? Promise.resolve({ active: true, startBlockIndex: 0, endBlockIndex: 1 })
        : bRead.promise,
    );
    const { result, rerender, unmount } = renderHook(
      ({ id, editor }: Props) => useFocusMode(id, editor),
      { initialProps: { id: "doc-A", editor: editorA } },
    );
    // Phase B upgrades A's legacy file to A's uuids (index 0 = doc start → null).
    await waitFor(() => expect(result.current.band.endUuid).toBe("a2"));
    expect(result.current.band).toMatchObject({ startUuid: null, endUuid: "a2" });

    rerender({ id: "doc-B", editor: editorB });
    await act(async () => {
      bRead.resolve(B_BAND);
      await bRead.promise;
    });
    await waitFor(() => expect(result.current.band).toEqual(B_BAND));
    unmount();
    await Promise.resolve();
    expect(writesTo("doc-B")).toEqual([]);
  });

  it("an ABSENT focus.json in B leaves B unfocused — A's band is not inherited", async () => {
    mockRead.mockImplementation((docId: string) =>
      Promise.resolve(docId === "doc-A" ? A_BAND : null),
    );
    // B shares A's uuids (a copied paper), so an inherited band WOULD resolve.
    const editorBCopy = fakeEditor(["a1", "a2", "a3", "a4"]);
    const { result, rerender, unmount } = renderHook(
      ({ id, editor }: Props) => useFocusMode(id, editor),
      { initialProps: { id: "doc-A", editor: editorA } },
    );
    await waitFor(() => expect(result.current.band.active).toBe(true));
    rerender({ id: "doc-B", editor: editorBCopy });
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith("doc-B", "focus.json"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.band.active).toBe(false);
    expect(result.current.state.active).toBe(false);
    unmount();
    await Promise.resolve();
    expect(writesTo("doc-B")).toEqual([]);
  });
});
