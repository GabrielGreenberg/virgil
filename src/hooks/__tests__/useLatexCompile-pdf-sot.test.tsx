// @vitest-environment jsdom
//
// P6 hook contract: onCompileSuccess fires for EVERY successful compile —
// including library papers (writePdf skipped) and after a persistence failure —
// so the in-memory viewer never shows "No compiled PDF" for a compile that
// produced one. A `failed` persistence surfaces a NON-BLOCKING soft notice
// without suppressing onCompileSuccess.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

type AlertArg = { title: string; message: string; tone?: string };
const alertSpy = vi.fn(async (_arg: AlertArg) => {});
vi.mock("@/components/system-dialog-host", () => ({
  useSystemDialog: () => ({ alert: alertSpy, confirm: vi.fn(), prompt: vi.fn() }),
}));

const compileSpy = vi.fn();
vi.mock("@/lib/compile/compile-service", () => ({
  compileService: {
    compile: (...args: unknown[]) => compileSpy(...args),
  },
}));

// Storage facade — drainDoc/readPaperFolder/getTexFilename are trivial; writePdf
// is the P6 surface we vary per test.
const writePdfSpy = vi.fn();
vi.mock("@/lib/storage", () => ({
  drainDoc: vi.fn(async () => {}),
  flushDoc: vi.fn(async () => {}),
  getTexFilename: vi.fn(async () => "main.tex"),
  readPaperFolder: vi.fn(async () => [
    { path: "main.tex", bytes: new Uint8Array([1]) },
  ]),
  writeTex: vi.fn(async () => {}),
  writePdf: (...args: unknown[]) => writePdfSpy(...args),
}));

vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: (docId: string) => ({ docId, pipelineId: "pipe" }),
  isStalePipelineError: () => false,
}));

vi.mock("@/lib/document-class", () => ({
  detectDocumentClassMismatch: () => null,
  rewriteDocumentClass: (s: string) => s,
}));
vi.mock("@/lib/tex-delimiters-event", () => ({
  dispatchTexDelimitersChanged: vi.fn(),
}));

import { useLatexCompile } from "../useLatexCompile";

const OK_RESULT = {
  status: "ok" as const,
  pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  log: "",
  ranPasses: 1,
  bibtexStatus: "absent" as const,
  diagnostics: [],
};

describe("useLatexCompile — P6 PDF source of truth", () => {
  beforeEach(() => {
    alertSpy.mockClear();
    compileSpy.mockClear();
    writePdfSpy.mockClear();
  });

  it("library paper: writePdf skipped, yet onCompileSuccess STILL fires with the pdf", async () => {
    compileSpy.mockResolvedValue(OK_RESULT);
    writePdfSpy.mockResolvedValue({ status: "skipped" });
    const onCompileSuccess = vi.fn();

    const { result } = renderHook(() =>
      useLatexCompile("library-paper:smith2020", { onCompileSuccess }),
    );
    await act(async () => {
      await result.current.compile();
    });

    expect(onCompileSuccess).toHaveBeenCalledTimes(1);
    expect(onCompileSuccess.mock.calls[0][0]).toBe(OK_RESULT.pdf);
    // A skip is not a failure — no warning surfaced.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("failed persistence: surfaces a non-blocking notice WITHOUT suppressing onCompileSuccess", async () => {
    compileSpy.mockResolvedValue(OK_RESULT);
    writePdfSpy.mockResolvedValue({ status: "failed", error: new Error("boom") });
    const onCompileSuccess = vi.fn();

    const { result } = renderHook(() =>
      useLatexCompile("regular-doc", { onCompileSuccess }),
    );
    await act(async () => {
      await result.current.compile();
    });

    // onCompileSuccess still fires — the in-memory PDF is usable.
    expect(onCompileSuccess).toHaveBeenCalledTimes(1);
    // A soft (non-danger) notice was surfaced.
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const arg = alertSpy.mock.calls[0]![0];
    expect(arg.tone).toBe("default");
    expect(arg.title).toMatch(/not saved/i);
  });

  it("written persistence: no notice, onCompileSuccess fires", async () => {
    compileSpy.mockResolvedValue(OK_RESULT);
    writePdfSpy.mockResolvedValue({ status: "written" });
    const onCompileSuccess = vi.fn();

    const { result } = renderHook(() =>
      useLatexCompile("regular-doc", { onCompileSuccess }),
    );
    await act(async () => {
      await result.current.compile();
    });

    expect(onCompileSuccess).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
