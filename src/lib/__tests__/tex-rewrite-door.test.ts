// @vitest-environment jsdom
//
// Task 1501: the out-of-band `.tex` rewrite has ONE door, `rewriteTexOutOfBand`
// (`src/lib/tex-rewrite.ts`). Two halves:
//
//  - BEHAVIOUR. The compile path's documentclass prompt stays open as long as
//    the user likes. Whatever lands in the `.tex` meanwhile (a cowork skill's
//    commit, another window, a sync client) must SURVIVE the class swap — the
//    swap is applied to a fresh read taken after the prompt, never to the text
//    read before it. On HEAD before 1501 the compile path wrote
//    `rewriteDocumentClass(<pre-prompt text>)` and the concurrent edit vanished.
//  - CENSUS. No production file but the door calls the raw `rewriteTex`
//    primitive, and nothing re-grows the retired pre-write "will-change" event
//    (the door's drain already runs the code pane's settle flusher).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly, trackedFiles, REPO_ROOT } from "./_source-scan";

// An in-memory `.tex` standing in for the disk. `rewriteTex` mirrors the
// backends' contract: the transform runs on the file AS IT STANDS at write time.
let disk = "";
const rewriteTexSpy = vi.fn(async (_h: unknown, fn: (t: string) => string | null) => {
  const next = fn(disk);
  if (next === null || next === disk) return "unchanged";
  disk = next;
  return "written";
});
vi.mock("@/lib/storage", () => ({
  drainDoc: vi.fn(async () => {}),
  getTexFilename: vi.fn(async () => "main.tex"),
  readPaperFolder: vi.fn(async () => [
    { path: "main.tex", bytes: new TextEncoder().encode(disk) },
  ]),
  rewriteTex: (h: unknown, fn: (t: string) => string | null) => rewriteTexSpy(h, fn),
  writePdf: vi.fn(async () => ({ status: "written" })),
}));

const compiledTex: string[] = [];
vi.mock("@/lib/compile/compile-service", () => ({
  compileService: {
    compile: async ({ files }: { files: { path: string; bytes: Uint8Array }[] }) => {
      compiledTex.push(new TextDecoder().decode(files[0].bytes));
      return { status: "ok", pdf: new Uint8Array([1]), log: "", ranPasses: 1, bibtexStatus: "absent", diagnostics: [] };
    },
  },
}));

const delimitersChanged = vi.fn();
vi.mock("@/lib/tex-delimiters-event", () => ({
  dispatchTexDelimitersChanged: (id: string) => delimitersChanged(id),
}));

import { runCompileForDoc } from "@/lib/compile/run-compile-for-doc";
import { rewriteTexOutOfBand } from "@/lib/tex-rewrite";
import {
  __resetForTests as resetPipelines,
  beginDocPipeline,
} from "@/lib/multi-window/doc-pipeline";
import { __resetAllCompileRecords } from "@/lib/compile/compile-record";
import { __resetAllCompileProgress } from "@/lib/compile/compile-progress";

const DOC = "doc-1501";
const BEFORE = [
  "\\documentclass[12pt]{article}",
  "\\begin{document}",
  "\\chapter{One}",
  "Original body.",
  "\\end{document}",
  "",
].join("\n");

beforeEach(() => {
  resetPipelines();
  __resetAllCompileRecords();
  __resetAllCompileProgress();
  rewriteTexSpy.mockClear();
  delimitersChanged.mockClear();
  compiledTex.length = 0;
  disk = BEFORE;
});

describe("the compile class prompt rewrites a FRESH read (task 1501)", () => {
  it("a .tex edit landed WHILE the prompt was open survives the class swap", async () => {
    beginDocPipeline(DOC);
    await runCompileForDoc(DOC, {
      alert: vi.fn(async () => {}),
      onDocumentClassMismatch: async () => {
        // A cowork skill commits to the paper while the user deliberates.
        disk = disk.replace("Original body.", "Original body.\nA cowork addition.");
        return { kind: "switch", newClass: "report" };
      },
    });

    expect(disk).toContain("\\documentclass[12pt]{report}");
    expect(disk).toContain("A cowork addition.");
    // The engine compiled the rewritten file, and the code pane was told.
    expect(compiledTex.at(-1)).toBe(disk);
    expect(delimitersChanged).toHaveBeenCalledWith(DOC);
  });

  it("no live pipeline → nothing written", async () => {
    await runCompileForDoc(DOC, {
      alert: vi.fn(async () => {}),
      onDocumentClassMismatch: async () => ({ kind: "switch", newClass: "report" }),
    });
    expect(rewriteTexSpy).not.toHaveBeenCalled();
    expect(disk).toBe(BEFORE);
  });
});

describe("rewriteTexOutOfBand — the door", () => {
  it("a declining transform writes nothing and tells no code pane", async () => {
    beginDocPipeline(DOC);
    expect(await rewriteTexOutOfBand(DOC, () => null)).toBe("unchanged");
    expect(await rewriteTexOutOfBand(DOC, (t) => t)).toBe("unchanged");
    expect(delimitersChanged).not.toHaveBeenCalled();
    expect(disk).toBe(BEFORE);
  });

  it("a write tells the code pane once", async () => {
    beginDocPipeline(DOC);
    expect(await rewriteTexOutOfBand(DOC, (t) => t + "% x\n")).toBe("written");
    expect(delimitersChanged).toHaveBeenCalledTimes(1);
  });
});

describe("CENSUS — the out-of-band .tex rewrite has one door", () => {
  const production = () =>
    [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
      .filter((p) => !/\/__tests__\//.test(p))
      .map((p) => ({ rel: p.slice(REPO_ROOT.length + 1), code: codeOnly(readFileSync(p, "utf8")) }));

  // The raw primitive is DEFINED in the two backends, re-exported by the
  // facade, and CALLED only by the door.
  const RAW_CALL = /\brewriteTex\s*\(/;
  const ALLOWED = new Set([
    "src/lib/tex-rewrite.ts", // the door
    "src/lib/storage-fsa.ts", // definition
    "src/lib/storage-dev.ts", // definition
  ]);

  it("no production file but the door calls rewriteTex", () => {
    const offenders = production()
      .filter(({ rel, code }) => !ALLOWED.has(rel) && RAW_CALL.test(code))
      .map(({ rel }) => rel);
    expect(offenders, "route the rewrite through rewriteTexOutOfBand (@/lib/tex-rewrite)").toEqual([]);
  });

  it("the retired whole-text writeTex and the pre-write will-change event stay gone", () => {
    const RETIRED = /\bwriteTex\b|\bTEX_DELIMITERS_WILL_CHANGE_EVENT\b|\bdispatchTexDelimitersWillChange\b/;
    const offenders = production().filter(({ code }) => RETIRED.test(code)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("anti-vacuity: the detectors match the idioms they police", () => {
    expect(RAW_CALL.test("await rewriteTex(handle, fn)")).toBe(true);
    expect(RAW_CALL.test("await rewriteTexOutOfBand(docId, fn)")).toBe(false);
    expect(production().some(({ rel }) => rel === "src/lib/tex-rewrite.ts")).toBe(true);
  });
});
