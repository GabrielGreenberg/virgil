// @vitest-environment jsdom
//
// Task 1277: a compile's RESULT is owned by the DOCUMENT, not by the pane
// instance that started it. Under multi-doc keep-alive the LRU can unmount the
// starting pane mid-compile (a cold tikz compile takes minutes); the run must
// still persist its PDF on the doc's CURRENT pipeline, and a pane mounted
// afterwards must report the live run, then its log / diagnostics / PDF. A
// remounted pane's Compile press during the live run is a no-op.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const alertSpy = vi.fn(async () => {});
vi.mock("@/components/system-dialog-host", () => ({
  useSystemDialog: () => ({ alert: alertSpy, confirm: vi.fn() }),
}));

let resolveCompile: ((r: unknown) => void) | null = null;
const compileSpy = vi.fn(
  () =>
    new Promise((resolve) => {
      resolveCompile = resolve;
    }),
);
vi.mock("@/lib/compile/compile-service", () => ({
  compileService: { compile: () => compileSpy() },
}));

const writePdfSpy = vi.fn(async () => ({ status: "written" }));
vi.mock("@/lib/storage", () => ({
  drainDoc: vi.fn(async () => {}),
  flushDoc: vi.fn(async () => {}),
  getTexFilename: vi.fn(async () => "main.tex"),
  readPaperFolder: vi.fn(async () => [{ path: "main.tex", bytes: new Uint8Array([1]) }]),
  writeTex: vi.fn(async () => {}),
  writePdf: (...args: unknown[]) => (writePdfSpy as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/lib/document-class", () => ({
  detectDocumentClassMismatch: () => null,
  rewriteDocumentClass: (s: string) => s,
}));
vi.mock("@/lib/tex-delimiters-event", () => ({ dispatchTexDelimitersChanged: vi.fn() }));

import { useLatexCompile } from "../useLatexCompile";
import {
  __resetForTests as resetPipelines,
  beginDocPipeline,
  endDocPipeline,
  getActiveHandle,
} from "@/lib/multi-window/doc-pipeline";
import { __resetAllCompileRecords } from "@/lib/compile/compile-record";
import { __resetAllCompileProgress, getCompileProgress } from "@/lib/compile/compile-progress";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const OK = {
  status: "ok" as const,
  pdf: PDF,
  log: "the log",
  ranPasses: 1,
  bibtexStatus: "absent" as const,
  diagnostics: [
    { id: "x", source: "compile", severity: "warning", line: 3, message: "Overfull \\hbox" },
  ],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useLatexCompile — the compile record outlives the pane (task 1277)", () => {
  beforeEach(() => {
    resetPipelines();
    __resetAllCompileRecords();
    __resetAllCompileProgress();
    compileSpy.mockClear();
    writePdfSpy.mockClear();
    alertSpy.mockClear();
    resolveCompile = null;
  });

  it("evicted mid-compile: the remount sees the live run, then the result + PDF, persisted on the NEW pipeline", async () => {
    const DOC = "doc-a";
    beginDocPipeline(DOC);
    const first = renderHook(() => useLatexCompile(DOC));
    let run!: Promise<void>;
    act(() => {
      run = first.result.current.compile();
    });
    await act(flush);
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(first.result.current.isCompiling).toBe(true);

    // LRU eviction: the pane unmounts and its pipeline ends; a reopen begins a
    // fresh one and mounts a fresh pane.
    const oldHandle = getActiveHandle(DOC);
    first.unmount();
    endDocPipeline(oldHandle!);
    await act(flush); // the deferred end lands
    beginDocPipeline(DOC);
    const newHandle = getActiveHandle(DOC);
    expect(newHandle).not.toEqual(oldHandle);

    const onCompileSuccess = vi.fn();
    const second = renderHook(() => useLatexCompile(DOC, { onCompileSuccess }));
    expect(second.result.current.isCompiling).toBe(true);

    // A press from the remounted pane during the live run is a no-op — and does
    // not reset the live progress record.
    const startedAt = getCompileProgress(DOC).startedAt;
    await act(async () => {
      await second.result.current.compile();
    });
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(getCompileProgress(DOC).startedAt).toBe(startedAt);

    await act(async () => {
      resolveCompile!(OK);
      await run;
    });

    expect(writePdfSpy).toHaveBeenCalledTimes(1);
    expect((writePdfSpy.mock.calls[0] as unknown[])[0]).toEqual(newHandle);
    expect(second.result.current.isCompiling).toBe(false);
    expect(second.result.current.lastLog).toBe("the log");
    expect(second.result.current.lastStatus).toBe(0);
    expect(second.result.current.compileErrors.map((e) => e.message)).toEqual([
      "Overfull \\hbox",
    ]);
    expect(onCompileSuccess).toHaveBeenCalledTimes(1);
    expect(onCompileSuccess.mock.calls[0][0]).toBe(PDF);
  });

  it("a pane mounted AFTER the run finished (no pipeline open) still receives the PDF once", async () => {
    const DOC = "doc-b";
    const first = renderHook(() => useLatexCompile(DOC));
    let run!: Promise<void>;
    act(() => {
      run = first.result.current.compile();
    });
    await act(flush);
    first.unmount();
    await act(async () => {
      resolveCompile!(OK);
      await run;
    });
    // No pipeline was open: nothing to persist on, but the bytes are kept.
    expect(writePdfSpy).not.toHaveBeenCalled();

    const onCompileSuccess = vi.fn();
    const second = renderHook(() => useLatexCompile(DOC, { onCompileSuccess }));
    expect(onCompileSuccess).toHaveBeenCalledTimes(1);
    expect(onCompileSuccess.mock.calls[0][0]).toBe(PDF);
    second.rerender();
    expect(onCompileSuccess).toHaveBeenCalledTimes(1);
  });
});
