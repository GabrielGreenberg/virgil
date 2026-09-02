// @vitest-environment jsdom
//
// **A picked figure never overwrites a same-named asset** — task 533.
//
// `importFigureFile` copied the picked file to `figures/<basename>` through a
// truncating write with no existence check, no byte compare and no
// de-duplicating name, in BOTH backends. Figure 1 uses `figures/plot.png`;
// the user picks a different `plot.png` from Downloads for Figure 5; Figure
// 1's image is replaced, silently — the `.tex` still names `figures/plot.png`
// in both places and renders the wrong picture twice. FSA has no trash and
// nothing snapshots `figures/`, so the old bytes are gone from the machine.
//
// The rule (src/lib/figures/asset-import.ts): a binary asset landing in the
// paper folder claims a FREE name or reuses an IDENTICAL one, and never
// replaces a byte already there. Identical bytes ⇒ zero writes (task 415's own
// rule, asked of bytes); differing bytes ⇒ `plot-2.png`, `plot-3.png`, …
//
// ── WHY THIS SUITE EXISTS ──────────────────────────────────────────────────
//
// No pre-533 suite drove `importFigureFile` at all — it appears in the repo
// only as a NAME in `vi.mock` lists. And the defect is a COLLISION: a suite
// that imports one file into an empty `figures/` passes on the pre-fix code
// perfectly. So every backend leg here seeds the destination FIRST and then
// asks what the import did to what was already there.
//
// The leg with teeth is the CENSUS: the resolver was never the part that could
// misbehave — a backend that stops asking it is, and a caller that derives the
// landing path from the picked name instead of reading the returned one is.
// Both type-check perfectly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnlyLines, trackedFiles } from "@/lib/__tests__/_source-scan";

// The storage barrel top-level-requires a backend; stub it (documented gotcha).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import {
  resolveAssetImport,
  nthCandidateName,
  splitBasename,
  bytesEqual,
  MAX_ASSET_NAME_CANDIDATES,
} from "@/lib/figures/asset-import";

// ---------------------------------------------------------------------------
// Fixtures: two DIFFERENT images that share a name, plus a fake `File`.
// ---------------------------------------------------------------------------

const PLOT_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 1, 1, 1]);
const PLOT_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2, 2, 2, 2, 2]);
const PLOT_C = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3, 3, 3]);

/** A minimal `File` stand-in — jsdom's `Blob` does not reliably implement
 *  `arrayBuffer()`, and the backends read nothing else off the picked file. */
function fakeFile(name: string, bytes: Uint8Array, type = "image/png"): File {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

// ---------------------------------------------------------------------------
// The resolver, pure.
// ---------------------------------------------------------------------------

describe("resolveAssetImport · the rule, pure", () => {
  const dir = (entries: Record<string, Uint8Array>) => async (name: string) =>
    entries[name] ?? null;

  it("a free name is WRITTEN under the picked basename", async () => {
    const r = await resolveAssetImport("plot.png", PLOT_A, dir({}));
    expect(r).toEqual({ name: "plot.png", action: "write" });
  });

  it("identical bytes REUSE the existing name and write nothing", async () => {
    const r = await resolveAssetImport("plot.png", PLOT_A, dir({ "plot.png": PLOT_A }));
    expect(r).toEqual({ name: "plot.png", action: "reuse" });
  });

  it("differing bytes take the next FREE name — the prior file is never the target", async () => {
    const r = await resolveAssetImport("plot.png", PLOT_B, dir({ "plot.png": PLOT_A }));
    expect(r).toEqual({ name: "plot-2.png", action: "write" });
  });

  it("…and the walk keeps going past every taken name", async () => {
    const r = await resolveAssetImport(
      "plot.png",
      PLOT_C,
      dir({ "plot.png": PLOT_A, "plot-2.png": PLOT_B }),
    );
    expect(r).toEqual({ name: "plot-3.png", action: "write" });
  });

  it("an asset once minted as plot-2 is FOUND there on a later re-pick", async () => {
    // Rung 2 runs on every candidate, not only the first — otherwise the
    // same asset picked a third time would become `plot-3.png`, filling
    // `figures/` with copies of one file (the 363/415 write-traffic class).
    const r = await resolveAssetImport(
      "plot.png",
      PLOT_B,
      dir({ "plot.png": PLOT_A, "plot-2.png": PLOT_B }),
    );
    expect(r).toEqual({ name: "plot-2.png", action: "reuse" });
  });

  it("a probe that THROWS aborts the import rather than treating the name as free", async () => {
    const boom = async () => {
      throw new Error("NotAllowedError");
    };
    await expect(resolveAssetImport("plot.png", PLOT_A, boom)).rejects.toThrow();
  });

  it("refuses, never overwrites, when every candidate is taken", async () => {
    const everythingTaken = async () => PLOT_A;
    await expect(
      resolveAssetImport("plot.png", PLOT_B, everythingTaken),
    ).rejects.toThrow(/refusing rather than overwriting/);
    expect(MAX_ASSET_NAME_CANDIDATES).toBeGreaterThan(100);
  });

  it("mints the suffix BEFORE the extension, and handles the no-extension shapes", () => {
    expect(nthCandidateName("plot.png", 1)).toBe("plot.png");
    expect(nthCandidateName("plot.png", 2)).toBe("plot-2.png");
    expect(nthCandidateName("fig.v2.png", 2)).toBe("fig.v2-2.png");
    expect(nthCandidateName("Screenshot 2026-09-01 at 10.12.03.png", 3)).toBe(
      "Screenshot 2026-09-01 at 10.12.03-3.png",
    );
    expect(nthCandidateName("README", 2)).toBe("README-2");
    expect(nthCandidateName(".hidden", 2)).toBe(".hidden-2");
    expect(splitBasename(".hidden")).toEqual({ stem: ".hidden", ext: "" });
  });

  it("bytesEqual is exact — a size match with one differing byte is NOT equal", () => {
    expect(bytesEqual(PLOT_A, new Uint8Array(PLOT_A))).toBe(true);
    const off = new Uint8Array(PLOT_A);
    off[off.length - 1] ^= 1;
    expect(bytesEqual(PLOT_A, off)).toBe(false);
    expect(bytesEqual(PLOT_A, PLOT_B)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The FSA backend against a fake disk.
// ---------------------------------------------------------------------------

const DOC_ID = "figdoc";

/** Every `createWritable().close()` that landed, by relPath, in order. */
let fsaWrites: string[] = [];

class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, Uint8Array>();
  dirs = new Map<string, FakeDirHandle>();
  constructor(
    public readonly name: string,
    private readonly path = "",
  ) {}

  private child(n: string): string {
    return this.path ? `${this.path}/${n}` : n;
  }

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDirHandle(name, this.child(name));
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FileSystemFileHandle> {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException(`no file ${name}`, "NotFoundError");
      this.files.set(name, new Uint8Array(0));
    }
    const rel = this.child(name);
    const files = this.files;
    return {
      kind: "file",
      name,
      getFile: async () => {
        const bytes = files.get(name)!;
        return {
          size: bytes.byteLength,
          lastModified: 1,
          arrayBuffer: async () => bytes.buffer.slice(0),
        } as unknown as File;
      },
      createWritable: async () => {
        let buf: Uint8Array = new Uint8Array(0);
        return {
          write: async (c: unknown) => {
            buf =
              c instanceof Uint8Array
                ? new Uint8Array(c)
                : new Uint8Array(c as ArrayBuffer);
          },
          close: async () => {
            files.set(name, buf);
            fsaWrites.push(rel);
          },
        } as unknown as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle;
  }

  async resolve(): Promise<string[] | null> {
    return null;
  }
}

let docHandle: FakeDirHandle;

const META = {
  id: DOC_ID,
  name: "Figures",
  texFilename: "main.tex",
  folderName: "figdoc",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
  lastAccessedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
  getDocHandle: vi.fn(async (id: string) => (id === DOC_ID ? docHandle : null)),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({ docs: [META] })),
  writeIndex: vi.fn(async () => {}),
}));

import { importFigureFile as importFsa } from "@/lib/storage-fsa";
import { importFigureFile as importDev } from "@/lib/storage-dev";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

const figuresDir = () => docHandle.dirs.get("figures")!;

describe("FSA importFigureFile · the prior asset survives", () => {
  beforeEach(() => {
    resetPipelines();
    fsaWrites = [];
    docHandle = new FakeDirHandle(DOC_ID);
    const figs = new FakeDirHandle("figures", "figures");
    figs.files.set("plot.png", PLOT_A);
    docHandle.dirs.set("figures", figs);
  });

  it("re-picking the IDENTICAL asset writes NOTHING and returns the existing path", async () => {
    // The commonest collision there is: the same asset used for a second
    // figure. Pre-533 this was a truncating rewrite of identical bytes — a
    // `.crswap` + rename a sync daemon watches (the 363/415 class).
    const h = beginDocPipeline(DOC_ID);
    const rel = await importFsa(h, { file: fakeFile("plot.png", PLOT_A), handle: null });
    expect(rel).toBe("figures/plot.png");
    expect(fsaWrites, "identical bytes were rewritten").toEqual([]);
    expect(figuresDir().files.get("plot.png")).toEqual(PLOT_A);
  });

  it("a DIFFERENT file with the same name lands as plot-2.png; plot.png is intact", async () => {
    const h = beginDocPipeline(DOC_ID);
    const rel = await importFsa(h, { file: fakeFile("plot.png", PLOT_B), handle: null });
    expect(rel).toBe("figures/plot-2.png");
    expect(figuresDir().files.get("plot.png"), "Figure 1's image was destroyed").toEqual(PLOT_A);
    expect(figuresDir().files.get("plot-2.png")).toEqual(PLOT_B);
    expect(fsaWrites).toEqual(["figures/plot-2.png"]);
  });

  it("a third distinct plot.png lands as plot-3.png with both predecessors intact", async () => {
    const h = beginDocPipeline(DOC_ID);
    await importFsa(h, { file: fakeFile("plot.png", PLOT_B), handle: null });
    const rel = await importFsa(h, { file: fakeFile("plot.png", PLOT_C), handle: null });
    expect(rel).toBe("figures/plot-3.png");
    expect(figuresDir().files.get("plot.png")).toEqual(PLOT_A);
    expect(figuresDir().files.get("plot-2.png")).toEqual(PLOT_B);
    expect(figuresDir().files.get("plot-3.png")).toEqual(PLOT_C);
  });

  it("re-picking an asset that was minted as plot-2 REUSES plot-2 (no plot-3)", async () => {
    const h = beginDocPipeline(DOC_ID);
    await importFsa(h, { file: fakeFile("plot.png", PLOT_B), handle: null });
    fsaWrites = [];
    const rel = await importFsa(h, { file: fakeFile("plot.png", PLOT_B), handle: null });
    expect(rel).toBe("figures/plot-2.png");
    expect(fsaWrites).toEqual([]);
    expect(figuresDir().files.has("plot-3.png")).toBe(false);
  });

  it("control: a fresh name into a missing figures/ folder is created and written", async () => {
    docHandle.dirs.delete("figures");
    const h = beginDocPipeline(DOC_ID);
    const rel = await importFsa(h, { file: fakeFile("chart.png", PLOT_C), handle: null });
    expect(rel).toBe("figures/chart.png");
    expect(fsaWrites).toEqual(["figures/chart.png"]);
    expect(figuresDir().files.get("chart.png")).toEqual(PLOT_C);
  });

  it("two concurrent imports of different bytes serialize: both land, neither clobbers", async () => {
    // The probe/decide/write runs inside ONE queued task keyed on the
    // directory, so the second import sees the first's minted name.
    const h = beginDocPipeline(DOC_ID);
    const [r1, r2] = await Promise.all([
      importFsa(h, { file: fakeFile("plot.png", PLOT_B), handle: null }),
      importFsa(h, { file: fakeFile("plot.png", PLOT_C), handle: null }),
    ]);
    expect(new Set([r1, r2])).toEqual(new Set(["figures/plot-2.png", "figures/plot-3.png"]));
    expect(figuresDir().files.get("plot.png")).toEqual(PLOT_A);
    expect(fsaWrites).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The dev backend against a fake fetch — the twin rule, measured not assumed.
// ---------------------------------------------------------------------------

const DEV_DOC = "devfig";
const devUrl = (rel: string) => `/api/dev/doc/${DEV_DOC}/${rel}`;
let devFiles: Map<string, Uint8Array>;
let devPuts: string[];

function devFetch(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const url = String(input);
  const method = init?.method ?? "GET";
  const headers = { get: () => null };
  if (method === "PUT") {
    const body = init?.body as Uint8Array | ArrayBuffer;
    devFiles.set(
      url,
      body instanceof Uint8Array ? new Uint8Array(body) : new Uint8Array(body),
    );
    devPuts.push(url);
    return Promise.resolve({ ok: true, status: 200, headers, text: async () => "" });
  }
  if (url === "/api/dev/index.json") {
    return Promise.resolve({
      ok: true,
      status: 200,
      headers,
      json: async () => ({ docs: [] }),
      text: async () => '{"docs":[]}',
    });
  }
  const bytes = devFiles.get(url);
  if (!bytes) {
    return Promise.resolve({ ok: false, status: 404, headers, text: async () => "" });
  }
  return Promise.resolve({
    ok: true,
    status: 200,
    headers,
    arrayBuffer: async () => bytes.buffer.slice(0),
    text: async () => new TextDecoder().decode(bytes),
  });
}

describe("dev importFigureFile · the same answer through the PUT route", () => {
  beforeEach(() => {
    resetPipelines();
    devFiles = new Map([[devUrl("figures/plot.png"), PLOT_A]]);
    devPuts = [];
    vi.stubGlobal("fetch", vi.fn(devFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("identical bytes PUT nothing and return the existing path", async () => {
    const h = beginDocPipeline(DEV_DOC);
    const rel = await importDev(h, { file: fakeFile("plot.png", PLOT_A), handle: null });
    expect(rel).toBe("figures/plot.png");
    expect(devPuts, "identical bytes were re-PUT").toEqual([]);
  });

  it("differing bytes land as plot-2.png; the prior bytes are intact", async () => {
    const h = beginDocPipeline(DEV_DOC);
    const rel = await importDev(h, { file: fakeFile("plot.png", PLOT_B), handle: null });
    expect(rel).toBe("figures/plot-2.png");
    expect(devFiles.get(devUrl("figures/plot.png")), "the prior asset was overwritten").toEqual(
      PLOT_A,
    );
    expect(devFiles.get(devUrl("figures/plot-2.png"))).toEqual(PLOT_B);
    expect(devPuts).toEqual([devUrl("figures/plot-2.png")]);
  });

  it("re-picking the minted asset reuses plot-2.png", async () => {
    const h = beginDocPipeline(DEV_DOC);
    await importDev(h, { file: fakeFile("plot.png", PLOT_B), handle: null });
    devPuts = [];
    const rel = await importDev(h, { file: fakeFile("plot.png", PLOT_B), handle: null });
    expect(rel).toBe("figures/plot-2.png");
    expect(devPuts).toEqual([]);
  });

  it("a probe that fails for a reason other than 404 refuses rather than overwriting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET" && String(input).includes("figures/")) {
          return { ok: false, status: 500, headers: { get: () => null }, text: async () => "" };
        }
        return devFetch(input, init);
      }),
    );
    const h = beginDocPipeline(DEV_DOC);
    await expect(
      importDev(h, { file: fakeFile("plot.png", PLOT_B), handle: null }),
    ).rejects.toThrow(/probe/);
    expect(devPuts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CENSUS — the leg with teeth.
// ---------------------------------------------------------------------------

const SRC = path.resolve(__dirname, "..", "..");
const BACKENDS = ["lib/storage-fsa.ts", "lib/storage-dev.ts"] as const;

/** The `importFigureFile` declaration plus the doc comment above it: walk back
 *  from the signature to the line after the previous column-0 `}`, forward to
 *  the next column-0 `}` — the region shape `tex-write-accountability` reads. */
function importRegion(rel: string): { raw: string[]; code: string[] } {
  const raw = readFileSync(path.join(SRC, rel), "utf8");
  const rawLines = raw.split("\n");
  const codeLines = codeOnlyLines(raw).split("\n");
  const sig = codeLines.findIndex((l) => /^export async function importFigureFile\(/.test(l));
  expect(sig, `${rel}: importFigureFile not found`).toBeGreaterThan(0);
  let start = sig;
  while (start > 0 && !/^\}/.test(rawLines[start - 1])) start--;
  let end = sig;
  while (end < rawLines.length - 1 && !/^\}/.test(rawLines[end])) end++;
  return { raw: rawLines.slice(start, end + 1), code: codeLines.slice(start, end + 1) };
}

describe("census · both backends read ONE resolver and state their gate posture", () => {
  for (const rel of BACKENDS) {
    it(`${rel}: importFigureFile enters resolveAssetImport and writes only on "write"`, () => {
      const { code, raw } = importRegion(rel);
      expect(
        code.some((l) => /\bresolveAssetImport\(/.test(l)),
        `${rel} decides the landing name itself — the twin fork (task 341)`,
      ).toBe(true);
      // The next two needles live INSIDE string/template literals, which
      // `codeOnlyLines` blanks (the `_source-scan` trap), so they read RAW.
      expect(
        raw.some((l) => /action === "write"/.test(l)),
        `${rel} writes unconditionally — the resolver's verdict is not read`,
      ).toBe(true);
      // The pre-533 shape: the destination derived from the picked name alone.
      expect(
        raw.some((l) => /const destPath = `\$\{subdir\}\/\$\{basename\}`/.test(l)),
        `${rel} still derives the destination from the picked basename`,
      ).toBe(false);
    });

    it(`${rel}: the figures/ write states its write-gate posture in place, with a reason`, () => {
      // The 415 census (`tex-write-accountability` → `per-file-write-gate`)
      // deliberately scopes itself to TEXT writes, so a binary writer is
      // invisible to it. This is the sibling question asked of the one binary
      // writer that lands USER content: it must carry the same marker the text
      // writers do, and the marker must be a sentence someone can read back.
      const { raw } = importRegion(rel);
      const marker = raw.map((l) => l.match(/write-gate-exempt:\s*(\S.*)$/)).find(Boolean);
      expect(marker, `${rel}: importFigureFile carries no write-gate-exempt marker`).toBeTruthy();
      expect((marker![1] ?? "").trim().length).toBeGreaterThanOrEqual(24);
    });
  }

  it("the resolver is an import-free LEAF both backends can reach", () => {
    const src = codeOnlyLines(
      readFileSync(path.join(SRC, "lib/figures/asset-import.ts"), "utf8"),
    );
    expect(src.split("\n").filter((l) => /^\s*import\b/.test(l))).toEqual([]);
  });

  it("every production caller READS the returned path — never re-derives it from the picked name", () => {
    // A caller that spelled `figures/${picked.file.name}` itself would ignore
    // the mint and point the `\includegraphics` at the file it did NOT write.
    const files = [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
      .filter((f) => !/__tests__|\.test\.|\.spec\./.test(f))
      .filter((f) => !/lib\/storage(-fsa|-dev)?\.ts$/.test(f));
    const callers: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const code = codeOnlyLines(readFileSync(f, "utf8")).split("\n");
      code.forEach((l, i) => {
        if (!/\bimportFigureFile\(/.test(l)) return;
        callers.push(`${f}:${i + 1}`);
        if (!/=\s*await\s+importFigureFile\(/.test(l)) bad.push(`${f}:${i + 1}  ${l.trim()}`);
      });
    }
    expect(callers.length, "the census found no caller — the needle has gone stale").toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
