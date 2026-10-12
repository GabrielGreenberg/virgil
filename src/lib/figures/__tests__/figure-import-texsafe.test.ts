// @vitest-environment jsdom
//
// **A path Virgil writes into `\includegraphics{…}` holds no character TeX
// reads as syntax** — task 1081.
//
// The picked file's name went verbatim into the brace group: `fig 50%.png`
// wrote `\includegraphics{figures/fig 50%.png}`, whose `%` comments out the
// closing brace — the reload misparses the figure and pdfTeX fails, in the
// user's only copy. The rule (src/lib/figures/asset-import.ts): an asset Virgil
// COPIES in gets a TeX-safe minted name; a file already inside the paper folder
// (which cannot be renamed) is REFUSED before anything is dispatched; and the
// reuse rung answers with the name the disk actually holds.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import {
  isTexSafeGraphicsPath,
  resolveAssetImport,
  texSafeAssetName,
  texUnsafePathChars,
  TexUnsafeAssetPathError,
} from "@/lib/figures/asset-import";
import { withReplacedFigurePath } from "@/lib/figures/parse-attrs";

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7]);
const OTHER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 8]);

function fakeFile(name: string, bytes: Uint8Array): File {
  return {
    name,
    type: "image/png",
    size: bytes.byteLength,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

describe("the TeX-safe name rule, pure", () => {
  it.each([
    ["fig 50%.png", "fig 50.png"],
    ["a#b.png", "a-b.png"],
    ["{x}.png", "x.png"],
    ["back\\slash.png", "back-slash.png"],
    ["home~v2.png", "home-v2.png"],
    ["a^b$c&d.png", "a-b-c-d.png"],
    ['say "hi".png', "say -hi.png"],
    ["%%%.png", "figure.png"],
  ])("%j mints %j", (picked, minted) => {
    expect(texSafeAssetName(picked)).toBe(minted);
    expect(isTexSafeGraphicsPath(minted)).toBe(true);
  });

  it("an already-safe name is UNCHANGED — spaces, _, non-ASCII and dots stay", () => {
    for (const n of ["plot.png", "my plot_v2.final.png", "Abbildung ä.pdf", "x"]) {
      expect(texSafeAssetName(n)).toBe(n);
    }
  });

  it("texUnsafePathChars names each offending character once", () => {
    expect(texUnsafePathChars("a%b%c#.png")).toEqual(["%", "#"]);
    expect(texUnsafePathChars("figures/ok.png")).toEqual([]);
  });

  it("the resolver walks the collision ladder on the MINTED name", async () => {
    const disk: Record<string, Uint8Array> = { "fig 50.png": OTHER };
    const res = await resolveAssetImport("fig 50%.png", BYTES, async (n) => disk[n] ?? null);
    expect(res).toEqual({ name: "fig 50-2.png", action: "write" });
    expect(isTexSafeGraphicsPath(res.name)).toBe(true);
  });

  it("the reuse rung answers with the ON-DISK name a case-folding probe reports", async () => {
    // APFS: a probe for Plot.png finds plot.png. Returning `Plot.png` would
    // break on a case-sensitive TeX (Overleaf, Linux).
    const res = await resolveAssetImport("Plot.png", BYTES, async (n) =>
      n.toLowerCase() === "plot.png" ? { bytes: BYTES, name: "plot.png" } : null,
    );
    expect(res).toEqual({ name: "plot.png", action: "reuse" });
  });

  it("the minted path round-trips through parse → serialize byte-stable", () => {
    const name = texSafeAssetName("fig 50%.png");
    const tex =
      "\\documentclass{article}\n\\begin{document}\n" +
      "\\begin{figure}[h]\n  \\centering\n" +
      `  \\includegraphics[width=0.5\\textwidth]{figures/${name}}\n` +
      "  \\caption{A plot.}\n\\end{figure}\n" +
      "After.\n\\end{document}\n";
    const out = serializeToLatex(parseLatex(tex), extractPreambleAndPostamble(tex) ?? undefined);
    expect(out).toContain(`\\includegraphics[width=0.5\\textwidth]{figures/${name}}`);
    expect(out).toContain("After.");
    expect(serializeToLatex(parseLatex(out), extractPreambleAndPostamble(out) ?? undefined)).toBe(out);
  });

  it("withReplacedFigurePath refuses an unsafe path — the broken brace group is never built", () => {
    const src = "\\includegraphics[width=0.5\\textwidth]{old.png}";
    expect(withReplacedFigurePath(src, "figures/fig 50%.png")).toBeNull();
    expect(withReplacedFigurePath(src, "figures/fig 50-.png")).toBe(
      "\\includegraphics[width=0.5\\textwidth]{figures/fig 50-.png}",
    );
  });
});

// ---------------------------------------------------------------------------
// The FSA backend against a fake disk.
// ---------------------------------------------------------------------------

const DOC_ID = "texsafedoc";

class FakeDir {
  readonly kind = "directory" as const;
  files = new Map<string, Uint8Array>();
  dirs = new Map<string, FakeDir>();
  writes: string[] = [];
  /** What `resolve()` answers — a path inside the paper, or null (outside). */
  resolved: string[] | null = null;
  constructor(public readonly name: string, private readonly caseFold = false) {}

  private find(name: string): string | undefined {
    if (this.files.has(name)) return name;
    if (!this.caseFold) return undefined;
    return [...this.files.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDir(name, this.caseFold);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let key = this.find(name);
    if (key === undefined) {
      if (!opts?.create) throw new DOMException(`no file ${name}`, "NotFoundError");
      this.files.set(name, new Uint8Array(0));
      key = name;
    }
    const k = key;
    return {
      kind: "file",
      name, // like Chrome: the handle echoes the REQUESTED name
      getFile: async () => {
        const b = this.files.get(k)!;
        return { arrayBuffer: async () => b.buffer.slice(0) } as unknown as File;
      },
      createWritable: async () => {
        let buf = new Uint8Array(0);
        return {
          write: async (c: Uint8Array) => {
            buf = new Uint8Array(c);
          },
          close: async () => {
            this.files.set(k, buf);
            this.writes.push(k);
          },
        };
      },
    } as unknown as FileSystemFileHandle;
  }

  async *keys(): AsyncIterable<string> {
    yield* this.files.keys();
  }

  async resolve(): Promise<string[] | null> {
    return this.resolved;
  }
}

let docHandle: FakeDir;

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
  getDocHandle: vi.fn(async (id: string) => (id === DOC_ID ? docHandle : null)),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({
    docs: [
      {
        id: DOC_ID,
        name: "TeX safe",
        texFilename: "main.tex",
        folderName: DOC_ID,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastModifiedAt: "2026-01-01T00:00:00.000Z",
        lastAccessedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  })),
  mutateIndex: vi.fn(async () => undefined),
}));

import { importFigureFile as importFsa } from "@/lib/storage-fsa";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

describe("FSA importFigureFile · TeX-safe paths", () => {
  beforeEach(() => {
    resetPipelines();
  });

  function setup(caseFold = false) {
    docHandle = new FakeDir(DOC_ID, caseFold);
    return beginDocPipeline(DOC_ID);
  }

  it("a picked `fig 50%.png` lands under a minted safe name, and that is the path returned", async () => {
    const h = setup();
    const rel = await importFsa(h, { file: fakeFile("fig 50%.png", BYTES), handle: null });
    expect(rel).toBe("figures/fig 50.png");
    expect(docHandle.dirs.get("figures")!.writes).toEqual(["fig 50.png"]);
  });

  it("a same-folder file whose path is unsafe is REFUSED — nothing written, nothing returned", async () => {
    const h = setup();
    docHandle.resolved = ["img", "fig 50%.png"];
    const picked = {
      file: fakeFile("fig 50%.png", BYTES),
      handle: {} as FileSystemFileHandle,
    };
    const err = await importFsa(h, picked).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TexUnsafeAssetPathError);
    expect((err as TexUnsafeAssetPathError).path).toBe("img/fig 50%.png");
    expect((err as TexUnsafeAssetPathError).chars).toEqual(["%"]);
    expect(docHandle.dirs.size).toBe(0);
  });

  it("a same-folder file with a safe path is still recorded where it lives", async () => {
    const h = setup();
    docHandle.resolved = ["img", "my plot.png"];
    const rel = await importFsa(h, {
      file: fakeFile("my plot.png", BYTES),
      handle: {} as FileSystemFileHandle,
    });
    expect(rel).toBe("img/my plot.png");
  });

  it("case-insensitive disk: re-picking `Plot.png` over identical `plot.png` returns the ON-DISK name", async () => {
    const h = setup(true);
    const figs = new FakeDir("figures", true);
    figs.files.set("plot.png", BYTES);
    docHandle.dirs.set("figures", figs);
    const rel = await importFsa(h, { file: fakeFile("Plot.png", BYTES), handle: null });
    expect(rel).toBe("figures/plot.png");
    expect(figs.writes).toEqual([]);
  });
});
