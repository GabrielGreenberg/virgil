// @vitest-environment node
/**
 * TASK 454 — THE CONVERGENCE + HONESTY CONTRACT.
 *
 * **No pre-454 suite could see any of this.** `compile-service.test.ts` drives
 * one attempt and asserts its RESULT; a timeout there is a terminal `status:
 * "timeout"` and the question "did the packages this attempt downloaded
 * survive?" is unrepresentable, because the fake engine has no download channel
 * at all. That is exactly how a compile that could never converge shipped with
 * every leg green.
 *
 * The defect, measured: a cold compile of a tikz/pgf paper pulls hundreds of
 * files over serial synchronous XHR. Every byte lived only in the worker's
 * in-memory kpse cache; `dumpNewCache` is a request/response round trip and
 * therefore CANNOT run while the worker is blocked inside a synchronous pass;
 * so on a timeout the service ran `recover()` → `closeWorker()` and destroyed
 * the lot. Each retry restarted from zero and timed out at the same point,
 * forever, with nothing on screen saying anything at all.
 *
 * Three legs with teeth here, each failing on its own pre-fix half:
 *   1. a timed-out attempt REPORTS what it downloaded (the durability signal),
 *   2. a PRODUCTIVE timeout is CONTINUED, an unproductive one is not,
 *   3. every terminal state reaches the progress channel a pixel reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PassBehavior =
  | { kind: "ok"; log?: string }
  | { kind: "hang"; fetches?: number };

let passQueue: PassBehavior[] = [];
let fetchSink: ((name: string) => void) | null = null;
const resetSpy = vi.fn();

function makeFakeEngine() {
  return {
    flushCache: vi.fn(),
    makeMemFSFolder: vi.fn(),
    writeMemFSFile: vi.fn(),
    setEngineMainFile: vi.fn(),
    closeWorker: vi.fn(),
    setOffline: vi.fn(),
    // The channel the whole fix rests on: the worker reports each package
    // download AS IT HAPPENS, because it cannot answer a round trip while it is
    // blocked inside a pass.
    onFetchProgress: (cb: (name: string) => void) => {
      fetchSink = cb;
    },
    onAsset: vi.fn(),
    dumpNewCache: vi.fn(async () => []),
    compileLaTeX: vi.fn(() => {
      const behavior = passQueue.shift() ?? { kind: "ok" as const };
      if (behavior.kind === "hang") {
        // Simulate a pass that downloads N packages and then never finishes —
        // the shape of a cold pgf compile against a generous budget.
        for (let i = 0; i < (behavior.fetches ?? 0); i++) {
          fetchSink?.(`pgfmodule${i}.code.tex`);
        }
        return new Promise(() => {});
      }
      return Promise.resolve({
        status: 0,
        log: behavior.log ?? "Output written on main.pdf",
        pdf: new Uint8Array([1, 2, 3]),
      });
    }),
  };
}

vi.mock("@/lib/swiftlatex", () => ({
  getPdfTeXEngine: vi.fn(async () => makeFakeEngine()),
  resetPdfTeXEngine: () => resetSpy(),
  writeEngineFile: () => {},
}));
vi.mock("@/lib/tex-assets", () => ({
  captureNewAssets: async () => {},
  attachAssetStream: () => {},
}));

import { CompileService } from "@/lib/compile/compile-service";
import {
  __resetAllCompileProgress,
  getCompileProgress,
  subscribeCompileProgress,
} from "@/lib/compile/compile-progress";
import type { PaperFile } from "@/lib/storage-fsa";

const enc = (s: string) => new TextEncoder().encode(s);
const DOC = "doc-convergence";

function texFile(): PaperFile[] {
  return [
    {
      path: "main.tex",
      bytes: enc("\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n"),
    },
  ];
}

/**
 * Drive the service with fake timers so a hung pass reaches its budget without
 * a real 3-minute wait. The service `await`s inside its attempt loop, so the
 * timers have to be advanced between microtask flushes.
 */
async function runToSettle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = promise.then((v) => {
    settled = true;
    return v;
  });
  for (let i = 0; i < 400 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
  }
  return tracked;
}

beforeEach(() => {
  passQueue = [];
  fetchSink = null;
  resetSpy.mockClear();
  __resetAllCompileProgress();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetAllCompileProgress();
});

describe("task 454 — a productive timeout converges", () => {
  it("reports the packages a timed-out attempt downloaded", async () => {
    // ONE attempt, which hangs after fetching 7 packages. With
    // MAX_COLD_ATTEMPTS exhausted by hangs, the final result must still name
    // what was fetched — that number is what tells the user (and the
    // continuation loop) the work was not wasted.
    passQueue = [
      { kind: "hang", fetches: 7 },
      { kind: "hang", fetches: 3 },
      { kind: "hang", fetches: 0 },
    ];
    const svc = new CompileService();
    const result = await runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: DOC }),
    );
    expect(result.status).toBe("timeout");
    // Pre-fix: no such field existed and every downloaded byte was discarded.
    expect(result.assetsFetched).toBe(10);
  });

  it("CONTINUES a timeout that downloaded packages, and lands the PDF", async () => {
    // Attempt 1 hangs after real download progress; attempt 2 (warmer cache)
    // succeeds. Pre-fix this was a dead end: the user got "Compile timed out",
    // and clicking again re-ran attempt 1 from an empty cache, forever.
    passQueue = [{ kind: "hang", fetches: 12 }, { kind: "ok" }];
    const svc = new CompileService();
    const result = await runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: DOC }),
    );
    expect(result.status).toBe("ok");
    expect(result.pdf).toBeDefined();
    expect(result.attempts).toBe(2);
    expect(result.assetsFetched).toBe(12);
  });

  it("does NOT continue a timeout that downloaded NOTHING", async () => {
    // A hang with no downloads is a real hang — a crashed worker, a stuck pass.
    // Continuing it would spend the whole budget re-hanging and say nothing for
    // ten minutes, which is the silence this task exists to end.
    passQueue = [{ kind: "hang", fetches: 0 }, { kind: "ok" }];
    const svc = new CompileService();
    const result = await runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: DOC }),
    );
    expect(result.status).toBe("timeout");
    expect(result.attempts).toBe(1);
  });

  it("bounds the continuation — it cannot loop forever", async () => {
    // Every attempt is productive AND every attempt hangs: the pathological
    // shape. The loop must stop at MAX_COLD_ATTEMPTS rather than grinding.
    passQueue = Array.from({ length: 12 }, () => ({
      kind: "hang" as const,
      fetches: 5,
    }));
    const svc = new CompileService();
    const result = await runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: DOC }),
    );
    expect(result.status).toBe("timeout");
    expect(result.attempts).toBeLessThanOrEqual(4);
    expect(result.attempts).toBeGreaterThan(1);
  });
});

describe("task 454 — the compile has a voice", () => {
  it("publishes live progress while a compile is downloading", async () => {
    passQueue = [{ kind: "hang", fetches: 4 }, { kind: "ok" }];
    const seen: string[] = [];
    const unsub = subscribeCompileProgress(() => {
      seen.push(getCompileProgress(DOC).phase);
    });
    const svc = new CompileService();
    const done = runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: DOC }),
    );
    await done;
    unsub();
    // The phase the user waits on for MINUTES must be observable — pre-fix,
    // nothing anywhere published it.
    expect(seen).toContain("fetching");
    expect(seen).toContain("typesetting");
  });

  it("reaches a terminal state with an outcome the pane can render", async () => {
    passQueue = [{ kind: "ok" }];
    const svc = new CompileService();
    await runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: DOC }),
    );
    const p = getCompileProgress(DOC);
    expect(p.phase).toBe("done");
    expect(p.outcome).toBe("ok");
  });

  it("a failing compile leaves a MESSAGE, not just an absent PDF", async () => {
    passQueue = [{ kind: "hang", fetches: 0 }];
    const svc = new CompileService();
    await runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: DOC }),
    );
    const p = getCompileProgress(DOC);
    expect(p.phase).toBe("done");
    expect(p.outcome).toBe("timeout");
    expect(p.message).toBeTruthy();
  });

  it("keeps each document's progress separate", async () => {
    // The service is a module singleton shared by every mounted EditorPane
    // (AGENTS.md, "Per-doc services under multi-pane keep-alive"). A progress
    // slot rather than a registry would render doc A's compile in doc B's pane.
    passQueue = [{ kind: "ok" }];
    const svc = new CompileService();
    await runToSettle(
      svc.compile({ files: texFile(), mainTexFilename: "main.tex", docId: "doc-A" }),
    );
    expect(getCompileProgress("doc-A").phase).toBe("done");
    expect(getCompileProgress("doc-B").phase).toBe("idle");
  });
});
