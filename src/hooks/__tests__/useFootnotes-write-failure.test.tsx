// @vitest-environment jsdom
//
// Task 1516 — a failed footnotes.json write is REPORTED, and stays reported
// across an external-change Reload.
//
// (1) Until 1516 the footnote hook's failed write only `console.error`d, while
//     `usePersistentState`'s failed writes record a sidecar refusal (task 637):
//     a footnote body in memory only raised no notice at all.
// (2) The work publisher cached "already published for A" privately, so after
//     `clearUnsavedWork(A)` (the Reload door — the doc and hook stay mounted)
//     the next failed write never re-entered the channel: `hasUnlandedWork(A)`
//     said clean and the leave prompt stood down over unlanded work.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let failWrites = false;

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, _file: string, dflt: unknown) => dflt),
  writeSidecar: vi.fn(async () => {
    if (failWrites) throw new Error("disk full");
  }),
  mutateSidecar: vi.fn(
    async (_h: unknown, _f: string, dflt: unknown, mutate: (c: unknown) => unknown) => {
      if (failWrites) throw new Error("disk full");
      return mutate(dflt);
    },
  ),
}));

vi.mock("@/lib/ai-request-bridge", () => ({ bridgeFlagForCard: vi.fn() }));

import { useFootnotes } from "../useFootnotes";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { getSidecarRefusal, resetSidecarRefusals } from "@/lib/sidecar-refusal";
import { clearUnsavedWork, hasUnlandedWork } from "@/lib/unsaved-work";

const DOC = "doc-fn-write-failure";
const BODY = { type: "doc", content: [{ type: "paragraph" }] };
const liveBody = (id: string) => (id.startsWith("fn-") ? { content: BODY } : null);

beforeEach(() => {
  __resetForTests();
  resetSidecarRefusals();
  clearUnsavedWork();
  failWrites = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("useFootnotes — a failed write is reported (task 1516)", () => {
  it("records a sidecar refusal, and the document holds unlanded work", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await settle();

    failWrites = true;
    act(() => { result.current.ensureRef("fn-1"); });
    await settle();

    expect(getSidecarRefusal(DOC)).toMatchObject({ what: "footnotes", reason: "failed" });
    expect(hasUnlandedWork(DOC)).toBe(true);
  });

  it("after a Reload clears the channel, the next failed write is unlanded work again", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await settle();

    failWrites = true;
    act(() => { result.current.ensureRef("fn-1"); });
    await settle();
    expect(hasUnlandedWork(DOC)).toBe(true);

    // The external-change Reload door: the doc stays open, the hook mounted.
    clearUnsavedWork(DOC);
    expect(hasUnlandedWork(DOC)).toBe(false);

    act(() => { result.current.ensureRef("fn-2"); });
    await settle();
    expect(hasUnlandedWork(DOC)).toBe(true);

    // And a landing settles it.
    failWrites = false;
    act(() => { result.current.ensureRef("fn-3"); });
    await settle();
    expect(hasUnlandedWork(DOC)).toBe(false);
  });
});
