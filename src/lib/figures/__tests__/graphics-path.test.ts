// @vitest-environment jsdom
//
// **\graphicspath is read, by ONE rule** — task 1437.
//
// A paper that keeps its images in `figures/` and says so with
// `\graphicspath{{figures/}}` compiled fine, but the editor resolved
// `\includegraphics{plot}` only from the paper root and showed "not found".
// And each storage backend spelled its own probe-extension list — including
// `webp`, which pdfTeX's graphicx cannot include, so the editor could show an
// image the compile then fails on.
//
// The rule now lives in `src/lib/figures/graphics-path.ts`:
// `figureCandidatePaths(path, dirs)` names the ordered files graphicx would
// try, and both backends iterate it. The CENSUS is the leg with teeth: a
// backend that grows its own list again type-checks perfectly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import {
  FIGURE_PROBE_EXTS,
  figureCandidatePaths,
  parseGraphicsPath,
} from "@/lib/figures/graphics-path";
import {
  loadDocGraphicsPath,
  noteDocPreamble,
  peekDocGraphicsPath,
  subscribeDocGraphicsPath,
  __resetDocGraphicsPathForTests,
} from "@/lib/figures/doc-graphics-path";
import { dispatchTexDelimitersChanged } from "@/lib/tex-delimiters-event";
import { readFigureSource as readDev } from "@/lib/storage-dev";

const paths = (path: string, dirs: string[] = []) =>
  figureCandidatePaths(path, dirs).map((c) => c.path);

describe("parseGraphicsPath", () => {
  it("reads every {dir} group, in order", () => {
    expect(parseGraphicsPath("\\usepackage{graphicx}\n\\graphicspath{{figures/}{img/}}\n")).toEqual([
      "figures/",
      "img/",
    ]);
  });
  it("tolerates spaces and newlines between groups", () => {
    expect(parseGraphicsPath("\\graphicspath { {a/}\n  {b/} }")).toEqual(["a/", "b/"]);
  });
  it("the last declaration wins (TeX redefines)", () => {
    expect(parseGraphicsPath("\\graphicspath{{old/}}\n\\graphicspath{{new/}}")).toEqual(["new/"]);
  });
  it("ignores a commented-out declaration, and \\graphicspathx", () => {
    expect(parseGraphicsPath("% \\graphicspath{{figures/}}\n")).toEqual([]);
    expect(parseGraphicsPath("\\graphicspathx{{figures/}}")).toEqual([]);
    expect(parseGraphicsPath("100\\% \\graphicspath{{f/}}")).toEqual(["f/"]);
  });
  it("no preamble / no declaration → no dirs", () => {
    expect(parseGraphicsPath(undefined)).toEqual([]);
    expect(parseGraphicsPath("\\documentclass{article}")).toEqual([]);
  });
});

describe("figureCandidatePaths", () => {
  it("is pdfTeX's list — no webp", () => {
    expect([...FIGURE_PROBE_EXTS]).toEqual(["pdf", "png", "jpg", "jpeg"]);
    expect(paths("plot").some((p) => p.endsWith(".webp"))).toBe(false);
  });
  it("extension-less: extension-major, bare path before each dir", () => {
    expect(paths("plot", ["figures/", "img/"]).slice(0, 6)).toEqual([
      "plot.pdf",
      "figures/plot.pdf",
      "img/plot.pdf",
      "plot.png",
      "figures/plot.png",
      "img/plot.png",
    ]);
  });
  it("supplies a missing trailing slash and drops ./", () => {
    expect(paths("plot.png", ["figures", "./img/", "."])).toEqual([
      "plot.png",
      "figures/plot.png",
      "img/plot.png",
    ]);
  });
  it("an extension given is tried as written, with its ext", () => {
    expect(figureCandidatePaths("sub/plot.webp", ["f/"])).toEqual([
      { path: "sub/plot.webp", ext: "webp" },
      { path: "f/sub/plot.webp", ext: "webp" },
    ]);
  });
  it("an absolute path ignores the prefixes; ../ is left as written", () => {
    expect(paths("/abs/plot.png", ["figures/"])).toEqual(["/abs/plot.png"]);
    expect(paths("../shared/plot.png", ["figures/"])).toEqual([
      "../shared/plot.png",
      "figures/../shared/plot.png",
    ]);
  });
  it("no dirs → the root-only behaviour", () => {
    expect(paths("plot")).toEqual(["plot.pdf", "plot.png", "plot.jpg", "plot.jpeg"]);
    expect(paths("  ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The dev backend iterates the rule.
// ---------------------------------------------------------------------------

const DEV_DOC = "gpdoc";
const devUrl = (rel: string) => `/api/dev/doc/${DEV_DOC}/${rel}`;
let devFiles: Map<string, Uint8Array>;

function devFetch(input: RequestInfo | URL): Promise<unknown> {
  const bytes = devFiles.get(String(input));
  const headers = { get: () => null };
  if (!bytes) return Promise.resolve({ ok: false, status: 404, headers });
  return Promise.resolve({
    ok: true,
    status: 200,
    headers,
    arrayBuffer: async () => bytes.buffer.slice(0),
  });
}

describe("storage-dev readFigureSource · \\graphicspath", () => {
  beforeEach(() => {
    devFiles = new Map([[devUrl("figures/plot.png"), new Uint8Array([1, 2, 3])]]);
    vi.stubGlobal("fetch", vi.fn(devFetch));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("{figures/} + plot finds figures/plot.png", async () => {
    const got = await readDev(DEV_DOC, "plot", ["figures/"]);
    expect(got?.ext).toBe("png");
    expect(got && new Uint8Array(got.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("without the search path it is (still) not found", async () => {
    expect(await readDev(DEV_DOC, "plot")).toBeNull();
  });
  it("never probes webp", async () => {
    devFiles = new Map([[devUrl("plot.webp"), new Uint8Array([9])]]);
    expect(await readDev(DEV_DOC, "plot")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The per-doc registry the resolver hook reads.
// ---------------------------------------------------------------------------

describe("doc-graphics-path registry", () => {
  beforeEach(() => __resetDocGraphicsPathForTests());

  it("reads the .tex once per doc and keys by doc", async () => {
    const read = vi.fn(async (id: string) =>
      id === "a"
        ? "\\documentclass{article}\\graphicspath{{figs/}}\n\\begin{document}x\\end{document}"
        : "\\documentclass{article}\n\\begin{document}x\\end{document}",
    );
    expect(await loadDocGraphicsPath("a", read)).toEqual(["figs/"]);
    expect(await loadDocGraphicsPath("a", read)).toEqual(["figs/"]);
    expect(await loadDocGraphicsPath("b", read)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("a failed read resolves to the root-only search", async () => {
    expect(await loadDocGraphicsPath("x", async () => Promise.reject(new Error("no")))).toEqual([]);
  });

  it("a code-pane preamble commit notifies only on a real change", () => {
    const fn = vi.fn();
    subscribeDocGraphicsPath("a", fn);
    noteDocPreamble("a", "\\graphicspath{{f/}}");
    noteDocPreamble("a", "\\graphicspath{{f/}} % same dirs");
    noteDocPreamble("b", "\\graphicspath{{g/}}");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(peekDocGraphicsPath("a")).toEqual(["f/"]);
  });

  it("a style switch / reload (delimiters-changed) re-reads from disk", async () => {
    let tex = "\\graphicspath{{one/}}\n\\begin{document}\\end{document}";
    const read = vi.fn(async () => tex);
    await loadDocGraphicsPath("a", read);
    const fn = vi.fn();
    subscribeDocGraphicsPath("a", fn);
    tex = "\\graphicspath{{two/}}\n\\begin{document}\\end{document}";
    dispatchTexDelimitersChanged("a");
    await vi.waitFor(() => expect(peekDocGraphicsPath("a")).toEqual(["two/"]));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// CENSUS — no backend declares its own probe-extension list.
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "..", "..", "..");
const BACKENDS = ["lib/storage-fsa.ts", "lib/storage-dev.ts"] as const;

describe("census · ONE probe list, read by every backend", () => {
  for (const rel of BACKENDS) {
    it(`${rel}: readFigureSource iterates figureCandidatePaths, declares no list`, () => {
      const raw = readFileSync(path.join(SRC, rel), "utf8");
      expect(raw, `${rel} declares its own FIGURE_PROBE_EXTS`).not.toMatch(
        /\bconst\s+FIGURE_PROBE_EXTS\b/,
      );
      expect(
        raw,
        `${rel} spells an image-extension list — read figureCandidatePaths instead`,
      ).not.toMatch(/\[\s*"pdf"\s*,\s*"png"/);
      const at = raw.indexOf("export async function readFigureSource(");
      expect(at, `${rel}: readFigureSource not found`).toBeGreaterThan(0);
      const body = raw.slice(at, raw.indexOf("\n}\n", at));
      expect(body).toMatch(/\bfigureCandidatePaths\(/);
      expect(body, `${rel}: readFigureSource takes no \\graphicspath dirs`).toMatch(
        /graphicspaths/,
      );
    });
  }
});
