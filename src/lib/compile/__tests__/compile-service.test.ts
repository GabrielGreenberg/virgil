// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock the swiftlatex module so the service drives a fake engine. --------
//
// We control a queue of per-pass behaviors: each `compileLaTeX()` call shifts
// the next behavior and either resolves a CompileResult, rejects (worker
// error), or hangs forever (to exercise the timeout).

type PassBehavior =
  | { kind: "ok"; log: string; pdf: Uint8Array; offlineMisses?: string[] }
  | { kind: "fail"; log: string; offlineMisses?: string[] }
  | { kind: "reject"; error: Error }
  | { kind: "hang" };

let passQueue: PassBehavior[] = [];
const engineCalls: { compileLaTeX: number } = { compileLaTeX: 0 };
const writtenFiles: Array<{ path: string; data: string | Uint8Array }> = [];
let bootShouldFail = false;
const resetSpy = vi.fn();
const closeWorkerSpy = vi.fn();
const setOfflineSpy = vi.fn();

function makeFakeEngine() {
  return {
    flushCache: vi.fn(),
    makeMemFSFolder: vi.fn(),
    writeMemFSFile: vi.fn((path: string, data: string | Uint8Array) => {
      writtenFiles.push({ path, data });
    }),
    setEngineMainFile: vi.fn(),
    closeWorker: closeWorkerSpy,
    setOffline: (v: boolean) => setOfflineSpy(v),
    compileLaTeX: vi.fn(() => {
      engineCalls.compileLaTeX++;
      const behavior = passQueue.shift() ?? { kind: "ok" as const, log: "", pdf: new Uint8Array([1]) };
      if (behavior.kind === "hang") return new Promise(() => {});
      if (behavior.kind === "reject") return Promise.reject(behavior.error);
      if (behavior.kind === "fail") {
        return Promise.resolve({ status: 1, log: behavior.log, offlineMisses: behavior.offlineMisses });
      }
      return Promise.resolve({
        status: 0,
        log: behavior.log,
        pdf: behavior.pdf,
        offlineMisses: behavior.offlineMisses,
      });
    }),
  };
}

vi.mock("@/lib/swiftlatex", () => ({
  getPdfTeXEngine: vi.fn(async () => {
    if (bootShouldFail) throw new Error("boot boom");
    return makeFakeEngine();
  }),
  resetPdfTeXEngine: () => resetSpy(),
  // Real writeEngineFile behavior: creates dirs then writes the file.
  writeEngineFile: (
    engine: { makeMemFSFolder: (d: string) => void; writeMemFSFile: (p: string, d: string | Uint8Array) => void },
    relPath: string,
    data: string | Uint8Array,
    createdDirs: Set<string>,
  ) => {
    const parts = relPath.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!createdDirs.has(dir)) {
        engine.makeMemFSFolder(dir);
        createdDirs.add(dir);
      }
    }
    engine.writeMemFSFile(relPath, data);
  },
}));

// Mock the P1 tex-assets layer so the service's write-through call is a no-op
// in tests (its real body touches idb-keyval, undefined in the node env). We
// spy so we can assert the service DOES drain new assets after a good pass.
const captureNewAssetsSpy = vi.fn(async (_engine: unknown) => {});
vi.mock("@/lib/tex-assets", () => ({
  captureNewAssets: (engine: unknown) => captureNewAssetsSpy(engine),
}));

// Import AFTER the mock is registered.
import { CompileService } from "@/lib/compile/compile-service";
import type { PaperFile } from "@/lib/storage-fsa";

const enc = (s: string) => new TextEncoder().encode(s);

function texFile(body: string): PaperFile[] {
  return [
    {
      path: "main.tex",
      bytes: enc(
        `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
      ),
    },
  ];
}

beforeEach(() => {
  passQueue = [];
  engineCalls.compileLaTeX = 0;
  writtenFiles.length = 0;
  bootShouldFail = false;
  resetSpy.mockClear();
  closeWorkerSpy.mockClear();
  captureNewAssetsSpy.mockClear();
  setOfflineSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CompileService — happy path", () => {
  it("returns status ok with the PDF for a clean single-pass doc", async () => {
    passQueue = [{ kind: "ok", log: "Output written on main.pdf", pdf: enc("PDF") }];
    const svc = new CompileService();
    const result = await svc.compile({ files: texFile("Hello."), mainTexFilename: "main.tex" });
    expect(result.status).toBe("ok");
    expect(result.pdf).toBeDefined();
    expect(result.ranPasses).toBe(1);
  });

  it("runs 2 passes for a doc with \\ref", async () => {
    passQueue = [
      { kind: "ok", log: "pass1", pdf: enc("P1") },
      { kind: "ok", log: "pass2", pdf: enc("P2") },
    ];
    const svc = new CompileService();
    const result = await svc.compile({
      files: texFile("See \\ref{x}. \\label{x}"),
      mainTexFilename: "main.tex",
    });
    expect(result.status).toBe("ok");
    expect(result.ranPasses).toBe(2);
    // The FINAL pass's PDF is retained.
    expect(new TextDecoder().decode(result.pdf!)).toBe("P2");
  });
});

describe("CompileService — P1 offline-asset wiring", () => {
  it("pushes connectivity into the worker (setOffline) before compiling", async () => {
    passQueue = [{ kind: "ok", log: "", pdf: enc("PDF") }];
    const svc = new CompileService();
    await svc.compile({ files: texFile("Hi."), mainTexFilename: "main.tex" });
    expect(setOfflineSpy).toHaveBeenCalledTimes(1);
    // navigator is undefined in the node test env → treated as online.
    expect(setOfflineSpy).toHaveBeenCalledWith(false);
  });

  it("drains new assets (captureNewAssets) after a successful pass", async () => {
    passQueue = [{ kind: "ok", log: "", pdf: enc("PDF") }];
    const svc = new CompileService();
    await svc.compile({ files: texFile("Hi."), mainTexFilename: "main.tex" });
    expect(captureNewAssetsSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces offlineMisses on the result and marks the compile degraded", async () => {
    passQueue = [
      { kind: "ok", log: "", pdf: enc("PDF"), offlineMisses: ["tikz.sty", "tikz.sty", "pgf.sty"] },
    ];
    const svc = new CompileService();
    const result = await svc.compile({ files: texFile("Hi."), mainTexFilename: "main.tex" });
    expect(result.pdf).toBeDefined();
    expect(result.status).toBe("degraded");
    expect(result.offlineMisses).toBeDefined();
    // Deduped across passes (Set-backed).
    expect([...result.offlineMisses!].sort()).toEqual(["pgf.sty", "tikz.sty"]);
  });

  it("leaves offlineMisses undefined on a clean online compile", async () => {
    passQueue = [{ kind: "ok", log: "", pdf: enc("PDF") }];
    const svc = new CompileService();
    const result = await svc.compile({ files: texFile("Hi."), mainTexFilename: "main.tex" });
    expect(result.status).toBe("ok");
    expect(result.offlineMisses).toBeUndefined();
  });
});

describe("CompileService — self-sufficiency (in-memory requirement injection)", () => {
  it("injects expex/xlist for an unedited on-disk doc using \\begin{xlist}", async () => {
    passQueue = [{ kind: "ok", log: "", pdf: enc("PDF") }];
    const svc = new CompileService();
    await svc.compile({
      files: texFile("\\begin{xlist}\n\\a x\n\\end{xlist}"),
      mainTexFilename: "main.tex",
    });
    const main = writtenFiles.find((f) => f.path === "main.tex");
    expect(main).toBeDefined();
    const text = typeof main!.data === "string" ? main!.data : new TextDecoder().decode(main!.data);
    // The in-memory copy fed to the engine carries the injected requirements.
    expect(text).toContain("\\usepackage{expex}");
    expect(text).toContain("\\newenvironment{xlist}{\\pex}{\\xe}");
  });

  it("does NOT mutate the on-disk bytes (input PaperFile untouched)", async () => {
    passQueue = [{ kind: "ok", log: "", pdf: enc("PDF") }];
    const svc = new CompileService();
    const files = texFile("\\begin{xlist}\n\\a x\n\\end{xlist}");
    const before = new TextDecoder().decode(files[0].bytes);
    await svc.compile({ files, mainTexFilename: "main.tex" });
    expect(new TextDecoder().decode(files[0].bytes)).toBe(before);
    expect(before).not.toContain("\\usepackage{expex}");
  });
});

describe("CompileService — degraded (last-good retention)", () => {
  it("returns degraded with the earlier good PDF when a later pass fails", async () => {
    passQueue = [
      { kind: "ok", log: "pass1", pdf: enc("GOOD") },
      { kind: "fail", log: "! LaTeX Error: later pass broke" },
    ];
    const svc = new CompileService();
    const result = await svc.compile({
      files: texFile("See \\ref{x}."),
      mainTexFilename: "main.tex",
    });
    expect(result.status).toBe("degraded");
    expect(new TextDecoder().decode(result.pdf!)).toBe("GOOD");
  });

  it("returns failed when the FIRST pass fails with no prior PDF", async () => {
    passQueue = [{ kind: "fail", log: "! Undefined control sequence" }];
    const svc = new CompileService();
    const result = await svc.compile({ files: texFile("\\bogus"), mainTexFilename: "main.tex" });
    expect(result.status).toBe("failed");
    expect(result.pdf).toBeUndefined();
    expect(result.diagnostics?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("CompileService — bibtex status", () => {
  it("flags a broken bibliography as degraded with bibtexStatus failed", async () => {
    // 3-pass bib doc: all pdfTeX passes exit 0, but the log carries a bibtex
    // failure signature.
    const brokenBibLog = "This is BibTeX\nI couldn't open database file refs.bib";
    passQueue = [
      { kind: "ok", log: "pass1", pdf: enc("P1") },
      { kind: "ok", log: "pass2", pdf: enc("P2") },
      { kind: "ok", log: brokenBibLog, pdf: enc("P3") },
    ];
    const svc = new CompileService();
    const result = await svc.compile({
      files: texFile("\\usepackage{natbib}\n\\citep{x}\n\\bibliography{refs}"),
      mainTexFilename: "main.tex",
    });
    expect(result.bibtexStatus).toBe("failed");
    expect(result.status).toBe("degraded");
    expect(result.pdf).toBeDefined();
  });
});

describe("CompileService — timeout + recovery", () => {
  it("returns timeout and calls reset when a pass hangs", async () => {
    vi.useFakeTimers();
    passQueue = [{ kind: "hang" }];
    const svc = new CompileService();
    const promise = svc.compile({ files: texFile("Hello."), mainTexFilename: "main.tex" });
    // Advance past the COLD timeout budget.
    await vi.advanceTimersByTimeAsync(200_000);
    const result = await promise;
    expect(result.status).toBe("timeout");
    expect(resetSpy).toHaveBeenCalled();
  });

  it("recovers after a timeout: the NEXT compile boots fresh and succeeds", async () => {
    vi.useFakeTimers();
    passQueue = [{ kind: "hang" }];
    const svc = new CompileService();
    const first = svc.compile({ files: texFile("Hello."), mainTexFilename: "main.tex" });
    await vi.advanceTimersByTimeAsync(200_000);
    expect((await first).status).toBe("timeout");

    vi.useRealTimers();
    passQueue = [{ kind: "ok", log: "", pdf: enc("OK") }];
    const second = await svc.compile({ files: texFile("Hello."), mainTexFilename: "main.tex" });
    expect(second.status).toBe("ok");
    expect(second.pdf).toBeDefined();
  });
});

describe("CompileService — worker-error rejection", () => {
  it("recovers (not stuck) when the compile promise rejects", async () => {
    passQueue = [{ kind: "reject", error: new Error("worker died") }];
    const svc = new CompileService();
    const result = await svc.compile({ files: texFile("Hello."), mainTexFilename: "main.tex" });
    expect(result.status).toBe("timeout");
    expect(resetSpy).toHaveBeenCalled();
  });
});

describe("CompileService — boot failure", () => {
  it("returns boot-failed and resets when the engine can't boot", async () => {
    bootShouldFail = true;
    const svc = new CompileService();
    const result = await svc.compile({ files: texFile("Hello."), mainTexFilename: "main.tex" });
    expect(result.status).toBe("boot-failed");
    expect(resetSpy).toHaveBeenCalled();
    expect(result.log).toContain("boot boom");
  });
});
