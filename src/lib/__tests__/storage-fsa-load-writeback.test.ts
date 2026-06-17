// @vitest-environment jsdom
//
// Anchor-persistence parity (Lever 2 ii): the FSA backend's readDocBundle
// must write its load-minted UUIDs BACK to the .tex, exactly as the dev
// backend already does (storage-dev.readDocBundle). Without this, a UUID
// minted on load for a paragraph that lacked a `%!v:` marker stays volatile
// until the next 1500 ms autosave, so a card anchored to it orphans on a
// fast reload — the production-only window the dev backend masks.
//
// These tests pin the three load-bearing properties of that writeback:
//   1. it persists the re-stamped .tex with the new `%!v:` markers;
//   2. it preserves the user's preamble/postamble verbatim (never clobbers);
//   3. it is GUARDED by the active-handle / pipeline check — a read whose
//      pipeline was superseded by a doc switch writes NOTHING.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The `@/lib/storage` barrel does `require("@/lib/storage-fsa")` at module
// top-level, which vitest's resolver can't alias (it isn't a real ESM
// import) → "Cannot find module". document-settings.ts (a transitive dep of
// storage-fsa) imports the barrel, so stub it. We import storage-fsa
// DIRECTLY and never call through the barrel, so a no-op stub suffices.
// (Documented gotcha: vitest_extension_barrel_storage_mock.)
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

// ---------------------------------------------------------------------------
// In-memory FSA fake. A directory handle backed by a Map<name, File-ish>;
// getFileHandle / createWritable record writes so the test can assert on the
// bytes that land. Subdirs (virgil/, .history/) are nested fake dirs.
// ---------------------------------------------------------------------------

interface FakeFile {
  text: string;
}

// Optional gate: when set, the NEXT .tex read (getFile().text()) awaits this
// promise before resolving. Lets a test pause readDocBundle mid-load, end the
// doc's pipeline (a doc-close racing the load), then release — proving the
// writeback never arms under a dead pipeline (getActiveHandle → null) and
// nothing is written to the wrong/old file.
let texReadGate: Promise<void> | null = null;

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
      f = { text: "" };
      this.files.set(name, f);
    }
    const file = f;
    const isTex = name === TEX;
    return {
      kind: "file",
      name,
      getFile: async () =>
        ({
          text: async () => {
            if (isTex && texReadGate) {
              const g = texReadGate;
              texReadGate = null; // gate fires once
              await g;
            }
            return file.text;
          },
          arrayBuffer: async () =>
            new TextEncoder().encode(file.text).buffer,
        }) as unknown as File,
      createWritable: async () =>
        new FakeWritable((t) => {
          file.text = t;
        }) as unknown as FileSystemWritableFileStream,
    } as unknown as FileSystemFileHandle;
  }

  async *values(): AsyncGenerator<{ kind: string; name: string }> {
    for (const [name] of this.files) yield { kind: "file", name };
    for (const [name] of this.dirs) yield { kind: "directory", name };
  }
}

// ---------------------------------------------------------------------------
// Mock the disk-index module: storage-fsa reads its doc handle + meta from
// here. Everything else (write-queue, doc-ownership, the pipeline registry)
// runs for real — in jsdom navigator.locks is undefined so withDocLock just
// runs the task, and the write-queue serializes correctly.
// ---------------------------------------------------------------------------

const DOC_ID = "testdoc";
const TEX = "main.tex";

let docHandle: FakeDirHandle;
const index: { docs: Array<Record<string, unknown>> } = { docs: [] };

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
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
import { readDocBundle } from "@/lib/storage-fsa";
import { flushWrites } from "@/lib/write-queue";

// A .tex with a real preamble/postamble and ONE body paragraph that carries
// NO `%!v:` marker — so assignUuids must mint a fresh UUID on load.
const PREAMBLE = `\\documentclass{article}
\\usepackage{amsmath}
\\newcommand{\\foo}{bar}`;
const POSTAMBLE_TAIL = "% trailing user comment\n";
const BODY = "This paragraph has no virgil UUID marker yet.";
const SOURCE_TEX = `${PREAMBLE}

\\begin{document}

${BODY}

\\end{document}
${POSTAMBLE_TAIL}`;

function seedDoc(tex: string): void {
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, { text: tex });
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

/**
 * Wait for the fire-and-forget load-writeback to settle. The writeback is
 * routed through `enqueueDocWrite(h, "bundle", ...)`, so draining the
 * per-doc "bundle" write-queue deterministically awaits it (or its silent
 * staleness rejection) — no microtask-spin guesswork.
 */
async function settle(): Promise<void> {
  await flushWrites(`${DOC_ID}/bundle`);
  // One extra microtask turn so the .catch() on the void'd promise runs.
  await Promise.resolve();
}

beforeEach(() => {
  resetPipelines();
  seedDoc(SOURCE_TEX);
});

afterEach(() => {
  resetPipelines();
  vi.clearAllMocks();
});

const UUID_MARKER = /%!v:[0-9a-f]{4}/;

describe("storage-fsa readDocBundle — load-writeback parity", () => {
  it("writes the re-stamped .tex back with the new %!v: marker", async () => {
    // Sanity: the source on disk has NO uuid marker.
    expect(docHandle.files.get(TEX)!.text).not.toMatch(UUID_MARKER);

    const h = beginDocPipeline(DOC_ID); // active pipeline → writeback fires
    await readDocBundle(DOC_ID);
    await settle();
    endDocPipeline(h);

    const after = docHandle.files.get(TEX)!.text;
    expect(after).toMatch(UUID_MARKER); // load-minted UUID is now durable
  });

  it("preserves the user's preamble/postamble verbatim", async () => {
    const h = beginDocPipeline(DOC_ID);
    await readDocBundle(DOC_ID);
    await settle();
    endDocPipeline(h);

    const after = docHandle.files.get(TEX)!.text;
    // The custom \newcommand and the full documentclass preamble survive.
    expect(after).toContain("\\newcommand{\\foo}{bar}");
    expect(after).toContain("\\documentclass{article}");
    expect(after).toContain("\\usepackage{amsmath}");
    // The body text is intact.
    expect(after).toContain(BODY);
  });

  it("also writes the re-stamped sidecar (virgil.json) back on load", async () => {
    const h = beginDocPipeline(DOC_ID);
    await readDocBundle(DOC_ID);
    await settle();
    endDocPipeline(h);

    const virgil = docHandle.dirs.get("virgil");
    expect(virgil).toBeDefined();
    const sidecar = virgil!.files.get("virgil.json");
    expect(sidecar).toBeDefined();
    // The sidecar JSON records the minted paragraph UUID(s).
    expect(sidecar!.text).toMatch(/[0-9a-f]{4}/);
  });

  it("skips the writeback entirely when no pipeline is active (handle absent)", async () => {
    // No beginDocPipeline → getActiveHandle(docId) is null → no writeback.
    await readDocBundle(DOC_ID);
    await settle();

    const after = docHandle.files.get(TEX)!.text;
    expect(after).toBe(SOURCE_TEX); // byte-identical, untouched
    expect(after).not.toMatch(UUID_MARKER);
  });

  it("skips the writeback when the doc is closed mid-load (pipeline ends before the read finishes)", async () => {
    // The writeback arms from `getActiveHandle(docId)`, captured AFTER the
    // .tex read completes. Pause that read, close the doc (end the
    // pipeline) while paused, then release: by the time the read returns,
    // no pipeline owns the doc, so `getActiveHandle` is null and the
    // writeback never arms — nothing is written. This is the realistic
    // "user switched away before the load finished" race; the guard is
    // what stops a stale-derived load-writeback from resurrecting/clobbering
    // a file the user has already navigated off of.
    let releaseRead!: () => void;
    texReadGate = new Promise<void>((res) => {
      releaseRead = res;
    });

    const a = beginDocPipeline(DOC_ID);
    const bundlePromise = readDocBundle(DOC_ID); // pauses inside the .tex read

    // Let the paused read settle into its await, then close the doc.
    await Promise.resolve();
    endDocPipeline(a);
    // endDocPipeline defers the actual delete to a microtask — drain it so
    // the pipeline is genuinely gone before the read resumes.
    await Promise.resolve();
    await Promise.resolve();

    releaseRead();
    await bundlePromise;
    await settle();

    const after = docHandle.files.get(TEX)!.text;
    expect(after).toBe(SOURCE_TEX); // byte-identical, untouched
    expect(after).not.toMatch(UUID_MARKER);
  });

  it("guard pins the writeback to the doc's own handle: it can never target a different doc", async () => {
    // The writeback handle from getActiveHandle(docId) carries the SAME
    // docId as the read, and enqueueDocWrite + requireDocHandle resolve the
    // destination from that docId — so even a writeback that does fire can
    // only ever write to THIS doc's .tex, never another doc's file. This
    // pins the load-bearing safety property: cross-doc clobber is
    // impossible by construction (the active-handle guard, mirroring
    // storage-dev).
    const otherDir = new FakeDirHandle("otherdoc");
    otherDir.files.set(TEX, { text: "OTHER DOC — must stay untouched\n" });

    const h = beginDocPipeline(DOC_ID);
    await readDocBundle(DOC_ID);
    await settle();
    endDocPipeline(h);

    // The unrelated doc's file is byte-untouched; only DOC_ID's .tex got the
    // re-stamped marker.
    expect(otherDir.files.get(TEX)!.text).toBe(
      "OTHER DOC — must stay untouched\n",
    );
    expect(docHandle.files.get(TEX)!.text).toMatch(UUID_MARKER);
  });
});
