// @vitest-environment jsdom
//
// Task 1145 — the bib view's two adoption paths are ORDERED. A `readBib` that
// started before a write landed must not, by resolving after that write's
// publish, put the pre-write list back (the open-time library auto-add's entry
// vanished from the panel while `references.bib` held it). And of two reads,
// the later-STARTED one wins whatever order they resolve in.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const OLD = "@article{foo,\n  title = {Foo},\n  year = {2001}\n}\n";
const NEW = OLD + "@article{bar,\n  title = {Bar},\n  year = {2002}\n}\n";

type Read = { bibText: string; detectedPackage?: string };
const pending: Array<(r: Read) => void> = [];

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: vi.fn(async () => ({})),
    readSidecarIfExists: vi.fn(async () => ({})),
    writeSidecar: vi.fn(async () => undefined),
    readBib: vi.fn(() => new Promise<Read>((resolve) => pending.push(resolve))),
    mutateBib: vi.fn(async () => null),
  }),
);

import { useCitations } from "../useCitations";
import { DOC_BIB_CHANGED_EVENT } from "@/lib/project-bib";
import { parseBibFile } from "@/lib/bib-parser";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  __resetForTests();
  pending.length = 0;
});

const keys = (r: { current: ReturnType<typeof useCitations> }) =>
  r.current.bibEntries.map((e) => e.key).sort();

function publish(docId: string, bibText: string) {
  window.dispatchEvent(
    new CustomEvent(DOC_BIB_CHANGED_EVENT, {
      detail: { docId, bibText, entries: parseBibFile(bibText) },
    }),
  );
}

describe("useCitations — bib read vs publish ordering (task 1145)", () => {
  it("a read that resolves AFTER a publish does not overwrite it with older text", async () => {
    beginDocPipeline("doc-a");
    const { result } = renderHook(() => useCitations("doc-a"));
    await waitFor(() => expect(pending.length).toBe(1));

    act(() => publish("doc-a", NEW));
    expect(keys(result)).toEqual(["bar", "foo"]);

    // The open-time read, started before the write, resolves with pre-write text.
    await act(async () => {
      pending[0]({ bibText: OLD, detectedPackage: "biblatex" });
    });
    expect(keys(result)).toEqual(["bar", "foo"]);
    expect(result.current.bibRaw).toBe(NEW);
    // Detection (from the .tex) is still seeded by the superseded read.
    expect(result.current.bibPackage).toBe("biblatex");
  });

  it("a read STARTED after a publish is adopted", async () => {
    beginDocPipeline("doc-b");
    const { result } = renderHook(() => useCitations("doc-b"));
    await waitFor(() => expect(pending.length).toBe(1));
    await act(async () => pending[0]({ bibText: OLD }));
    expect(keys(result)).toEqual(["foo"]);

    act(() => publish("doc-b", OLD));
    // A payload-less detail is a re-hydrate request → a NEW read.
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DOC_BIB_CHANGED_EVENT, { detail: { docId: "doc-b" } }),
      );
    });
    expect(pending.length).toBe(2);
    await act(async () => pending[1]({ bibText: NEW }));
    expect(keys(result)).toEqual(["bar", "foo"]);
  });

  it("of two reads, the later-started one wins even if it resolves first", async () => {
    beginDocPipeline("doc-c");
    const { result } = renderHook(() => useCitations("doc-c"));
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DOC_BIB_CHANGED_EVENT, { detail: { docId: "doc-c" } }),
      );
    });
    expect(pending.length).toBe(2);
    await act(async () => pending[1]({ bibText: NEW }));
    await act(async () => pending[0]({ bibText: OLD }));
    expect(keys(result)).toEqual(["bar", "foo"]);
  });
});
