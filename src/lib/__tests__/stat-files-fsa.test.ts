// @vitest-environment jsdom
//
// Chip 1 (statFiles) + Chip 2 (disk-ledger stamping) — FSA backend.
//
// Covers:
//   1. statFiles resolves nested paths, returns {mtimeMs,size}, null on miss.
//   2. statFiles re-throws NotAllowedError (permission loss) — never null.
//   3. The false-positive GUARANTEE: after Virgil writes the .tex, the ledger
//      holds a fingerprint whose {size,hash} match the bytes written, so a
//      subsequent statFiles + hash of the SAME bytes equals the ledger
//      (no spurious change). An EXTERNAL edit (different bytes) differs.
//   4. The load-writeback stamps the ledger (the #1 false-positive source).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same barrel-stub gotcha as storage-fsa-load-writeback.test.ts: the
// `@/lib/storage` barrel does a top-level require() vitest can't alias. We
// import storage-fsa DIRECTLY, so a no-op stub suffices.
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

// ---------------------------------------------------------------------------
// In-memory FSA fake. Files carry text + a mutable mtimeMs so a test can
// simulate an external edit bumping the modification time. getFile() exposes
// lastModified + size (what statFiles reads) plus text()/arrayBuffer().
// ---------------------------------------------------------------------------

interface FakeFile {
  text: string;
  mtimeMs: number;
}

let clock = 1000;
function nextMtime(): number {
  clock += 10;
  return clock;
}

class FakeWritable {
  constructor(private readonly onClose: (text: string) => void) {}
  private buf = "";
  async write(chunk: unknown): Promise<void> {
    this.buf = typeof chunk === "string" ? chunk : String(chunk);
  }
  async close(): Promise<void> {
    this.onClose(this.buf);
  }
}

class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, FakeFile>();
  dirs = new Map<string, FakeDirHandle>();
  /** When set on a filename, getFile() for it throws NotAllowedError. */
  denied = new Set<string>();
  constructor(public readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) {
        throw new DOMException(`no dir ${name}`, "NotFoundError");
      }
      d = new FakeDirHandle(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FileSystemFileHandle> {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) {
        throw new DOMException(`no file ${name}`, "NotFoundError");
      }
      f = { text: "", mtimeMs: nextMtime() };
      this.files.set(name, f);
    }
    const file = f;
    const deny = this.denied.has(name);
    return {
      kind: "file",
      name,
      getFile: async () => {
        if (deny) throw new DOMException("permission lost", "NotAllowedError");
        const bytes = new TextEncoder().encode(file.text);
        return {
          lastModified: file.mtimeMs,
          size: bytes.byteLength,
          text: async () => file.text,
          arrayBuffer: async () => bytes.buffer,
        } as unknown as File;
      },
      createWritable: async () =>
        new FakeWritable((t) => {
          file.text = t;
          file.mtimeMs = nextMtime(); // a write bumps mtime, like the OS
        }) as unknown as FileSystemWritableFileStream,
    } as unknown as FileSystemFileHandle;
  }

  async *values(): AsyncGenerator<{ kind: string; name: string }> {
    for (const [name] of this.files) yield { kind: "file", name };
    for (const [name] of this.dirs) yield { kind: "directory", name };
  }
}

// ---------------------------------------------------------------------------
// doc-index mock — storage-fsa reads its handle + meta from here.
// ---------------------------------------------------------------------------

const DOC_ID = "testdoc";
const TEX = "main.tex";

let docHandle: FakeDirHandle;
const index: { docs: Array<Record<string, unknown>> } = { docs: [] };

vi.mock("@/lib/doc-index", () => ({
  getDocHandle: vi.fn(async (id: string) => (id === DOC_ID ? docHandle : null)),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => index),
  writeIndex: vi.fn(async (idx: typeof index) => {
    index.docs = idx.docs;
  }),
}));

import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import {
  statFiles,
  readDocBundle,
  writeTex,
  readBib,
  writeBib,
  getBibFilename,
} from "@/lib/storage-fsa";
import { flushWrites } from "@/lib/write-queue";
import {
  getDiskFingerprint,
  hashContent,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";

const PREAMBLE = `\\documentclass{article}
\\usepackage{amsmath}`;
const BODY = "This paragraph has no virgil UUID marker yet.";
const SOURCE_TEX = `${PREAMBLE}

\\begin{document}

${BODY}

\\end{document}
`;

function seedDoc(tex: string): void {
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, { text: tex, mtimeMs: nextMtime() });
  index.docs = [
    {
      id: DOC_ID,
      name: DOC_ID,
      texFilename: TEX,
      folderName: DOC_ID,
      createdAt: "2026-01-01T00:00:00Z",
      lastModifiedAt: "2026-01-01T00:00:00Z",
      lastAccessedAt: "2026-01-01T00:00:00Z",
    },
  ];
}

async function settle(): Promise<void> {
  await flushWrites(`${DOC_ID}/bundle`);
  await flushWrites(`${DOC_ID}/tex`);
  await Promise.resolve();
}

beforeEach(() => {
  resetPipelines();
  __resetDiskLedgerForTests();
  seedDoc(SOURCE_TEX);
});

afterEach(() => {
  resetPipelines();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// statFiles
// ---------------------------------------------------------------------------

describe("storage-fsa statFiles", () => {
  it("returns {mtimeMs,size} for an existing file", async () => {
    const res = await statFiles(DOC_ID, [TEX]);
    expect(res[TEX]).not.toBeNull();
    expect(res[TEX]!.size).toBe(
      new TextEncoder().encode(SOURCE_TEX).byteLength,
    );
    expect(typeof res[TEX]!.mtimeMs).toBe("number");
  });

  it("returns null for an absent file", async () => {
    const res = await statFiles(DOC_ID, ["does-not-exist.tex"]);
    expect(res["does-not-exist.tex"]).toBeNull();
  });

  it("resolves a nested path (virgil/foo.json)", async () => {
    const virgil = await docHandle.getDirectoryHandle("virgil", { create: true });
    virgil.files.set("citations.json", { text: "{}", mtimeMs: nextMtime() });
    const res = await statFiles(DOC_ID, ["virgil/citations.json"]);
    expect(res["virgil/citations.json"]).not.toBeNull();
    expect(res["virgil/citations.json"]!.size).toBe(2); // "{}"
  });

  it("returns null when a nested path's intermediate dir is missing", async () => {
    const res = await statFiles(DOC_ID, ["nope/citations.json"]);
    expect(res["nope/citations.json"]).toBeNull();
  });

  it("stats multiple files in one call, keyed by the same relPaths", async () => {
    const res = await statFiles(DOC_ID, [TEX, "absent.bib"]);
    expect(Object.keys(res).sort()).toEqual([TEX, "absent.bib"].sort());
    expect(res[TEX]).not.toBeNull();
    expect(res["absent.bib"]).toBeNull();
  });

  it("re-throws NotAllowedError (permission loss) instead of returning null", async () => {
    docHandle.denied.add(TEX);
    await expect(statFiles(DOC_ID, [TEX])).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });
});

// ---------------------------------------------------------------------------
// The false-positive guarantee — the key test.
// ---------------------------------------------------------------------------

describe("disk-ledger false-positive guarantee (FSA)", () => {
  it("a Virgil writeTex stamps the ledger so a re-stat of the SAME bytes matches", async () => {
    const h = beginDocPipeline(DOC_ID);
    const WRITTEN = `${PREAMBLE}\n\n\\begin{document}\n\nVirgil wrote this.\n\n\\end{document}\n`;
    await writeTex(h, WRITTEN);
    await settle();
    endDocPipeline(h);

    const ledger = getDiskFingerprint(DOC_ID, TEX);
    expect(ledger).toBeDefined();

    // The watcher's check: live stat + hash of the on-disk bytes vs the ledger.
    const live = await statFiles(DOC_ID, [TEX]);
    expect(live[TEX]).not.toBeNull();
    expect(live[TEX]!.size).toBe(ledger!.size); // size matches
    expect(hashContent(docHandle.files.get(TEX)!.text)).toBe(ledger!.hash); // hash matches → NO false positive
  });

  it("an EXTERNAL edit (different bytes) differs from the ledger → real change", async () => {
    const h = beginDocPipeline(DOC_ID);
    const WRITTEN = `${PREAMBLE}\n\n\\begin{document}\n\nVirgil wrote this.\n\n\\end{document}\n`;
    await writeTex(h, WRITTEN);
    await settle();
    endDocPipeline(h);
    const ledger = getDiskFingerprint(DOC_ID, TEX)!;

    // Simulate Overleaf-via-sync landing a different .tex on disk.
    const EXTERNAL = WRITTEN.replace("Virgil wrote this.", "Overleaf edited this externally.");
    docHandle.files.set(TEX, { text: EXTERNAL, mtimeMs: nextMtime() });

    const live = await statFiles(DOC_ID, [TEX]);
    const liveHash = hashContent(docHandle.files.get(TEX)!.text);
    // The bytes (and hash) differ from the ledger → the watcher would flag.
    expect(liveHash).not.toBe(ledger.hash);
    expect(live[TEX]!.size).not.toBe(ledger.size);
  });

  it("the load-writeback stamps the ledger (the #1 false-positive source)", async () => {
    // readDocBundle mints a UUID and writes the re-stamped .tex back. That
    // write must leave the ledger matching the on-disk bytes, so the watcher
    // does NOT flag Virgil's own load-writeback as an external change.
    const h = beginDocPipeline(DOC_ID);
    await readDocBundle(DOC_ID);
    await settle();
    endDocPipeline(h);

    const onDisk = docHandle.files.get(TEX)!.text;
    expect(onDisk).toMatch(/%!v:[0-9a-f]{4}/); // writeback fired (minted marker)

    const ledger = getDiskFingerprint(DOC_ID, TEX);
    expect(ledger).toBeDefined();
    // The ledger hash equals the post-writeback on-disk bytes → no false flag.
    expect(ledger!.hash).toBe(hashContent(onDisk));
  });
});

// ---------------------------------------------------------------------------
// Bib stamping
// ---------------------------------------------------------------------------

describe("disk-ledger bib stamping (FSA)", () => {
  it("writeBib stamps the resolved .bib so a re-stat matches", async () => {
    const h = beginDocPipeline(DOC_ID);
    const BIB = "@article{x2026, title={X}}\n";
    await writeBib(h, BIB);
    await flushWrites(`${DOC_ID}/bib/references.bib`);
    await Promise.resolve();
    endDocPipeline(h);

    const ledger = getDiskFingerprint(DOC_ID, "references.bib");
    expect(ledger).toBeDefined();
    expect(ledger!.hash).toBe(hashContent(BIB));
    expect(ledger!.hash).toBe(hashContent(docHandle.files.get("references.bib")!.text));
  });

  it("readBib is a PURE reader — it does NOT stamp the ledger (anti-flicker)", async () => {
    // readBib must NOT baseline the .bib: the watcher's own confirm-read goes
    // through readBib, and baselining there would erase the very external edit
    // it is trying to surface. The .bib baseline is the watcher's PRIME pass +
    // writeBib only.
    const BIB = "@book{y2026, title={Y}}\n";
    docHandle.files.set("references.bib", { text: BIB, mtimeMs: nextMtime() });
    const res = await readBib(DOC_ID);
    expect(res.bibText).toBe(BIB); // content still read
    expect(getDiskFingerprint(DOC_ID, "references.bib")).toBeUndefined(); // but NOT stamped
  });

  it("readBib does NOT stamp when the .bib is absent either", async () => {
    await readBib(DOC_ID);
    expect(getDiskFingerprint(DOC_ID, "references.bib")).toBeUndefined();
  });

  it("getBibFilename resolves the name WITHOUT stamping the .tex or .bib", async () => {
    const BIB = "@book{z2026, title={Z}}\n";
    docHandle.files.set("references.bib", { text: BIB, mtimeMs: nextMtime() });
    const name = await getBibFilename(DOC_ID);
    expect(name).toBe("references.bib");
    // Pure name resolution: neither the .bib nor the .tex gets a ledger stamp.
    expect(getDiskFingerprint(DOC_ID, "references.bib")).toBeUndefined();
    expect(getDiskFingerprint(DOC_ID, TEX)).toBeUndefined();
  });
});
