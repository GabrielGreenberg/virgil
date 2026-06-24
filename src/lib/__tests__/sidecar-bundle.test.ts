// @vitest-environment jsdom
//
// L1 — sidecar-read coalescing. A doc mount fires ~17 readSidecarIfExists
// calls; the bundle collapses them into ONE virgil/ directory acquire + a
// parallel batch read, cached per docId. These tests pin: coalescing (one dir
// walk), correct values, write-then-read coherence, invalidation, and the
// loadError data-loss guard (a malformed file must NOT be coerced to null).

import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage barrel does require() at module top — stub it; we call storage-fsa
// directly. (Documented gotcha: vitest_extension_barrel_storage_mock.)
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

interface FakeFile { text: string }

class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, FakeFile>();
  dirs = new Map<string, FakeDirHandle>();
  virgilAcquires = 0;
  constructor(public readonly name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDirHandle> {
    if (name === "virgil") this.virgilAcquires++;
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDirHandle(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle> {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new DOMException(`no file ${name}`, "NotFoundError");
      f = { text: "" };
      this.files.set(name, f);
    }
    const file = f;
    return {
      kind: "file", name,
      getFile: async () => ({ text: async () => file.text }) as unknown as File,
      createWritable: async () => {
        let buf = "";
        return {
          write: async (c: unknown) => { buf = String(c); },
          close: async () => { file.text = buf; },
        } as unknown as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle;
  }

  async *values(): AsyncGenerator<{ kind: string; name: string }> {
    for (const [name] of this.files) yield { kind: "file", name };
    for (const [name] of this.dirs) yield { kind: "directory", name };
  }
}

const DOC_ID = "testdoc";
let docHandle: FakeDirHandle;

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
  getDocHandle: vi.fn(async (id: string) => (id === DOC_ID ? docHandle : null)),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({ docs: [] })),
  writeIndex: vi.fn(async () => {}),
}));

import {
  readSidecarIfExists,
  readSidecarBundle,
  invalidateSidecarBundle,
  writeSidecar,
} from "@/lib/storage-fsa";
import { beginDocPipeline, __resetForTests as resetPipelines } from "@/lib/multi-window/doc-pipeline";

/** Seed a fresh doc dir with a virgil/ subdir holding the given sidecar files. */
function seed(sidecars: Record<string, string>): FakeDirHandle {
  docHandle = new FakeDirHandle(DOC_ID);
  const virgil = new FakeDirHandle("virgil");
  for (const [name, text] of Object.entries(sidecars)) virgil.files.set(name, { text });
  docHandle.dirs.set("virgil", virgil);
  return docHandle;
}

beforeEach(() => {
  resetPipelines();
  invalidateSidecarBundle(DOC_ID);
});

describe("sidecar bundle — coalescing", () => {
  it("reads the virgil/ dir ONCE for many sidecar reads", async () => {
    seed({ "notes.json": '{"notes":[1]}', "todos.json": '{"todos":[]}' });
    await readSidecarBundle(DOC_ID);
    // 17 concurrent reads after the prime — all from cache.
    await Promise.all([
      readSidecarIfExists(DOC_ID, "notes.json"),
      readSidecarIfExists(DOC_ID, "todos.json"),
      readSidecarIfExists(DOC_ID, "citations.json"),
      readSidecarIfExists(DOC_ID, "reports.json"),
    ]);
    expect(docHandle.virgilAcquires).toBe(1);
  });

  it("coalesces even when the hooks (not the prime) trigger the bundle", async () => {
    seed({ "notes.json": "{}" });
    // No explicit prime — first readSidecarIfExists self-primes; concurrent
    // callers share the one in-flight bundle read.
    await Promise.all(
      ["notes.json", "todos.json", "citations.json", "cutter.json", "focus.json"].map((f) =>
        readSidecarIfExists(DOC_ID, f),
      ),
    );
    expect(docHandle.virgilAcquires).toBe(1);
  });
});

describe("sidecar bundle — values", () => {
  it("returns parsed JSON for a present file and null for an absent one", async () => {
    seed({ "notes.json": '{"notes":["a"]}' });
    expect(await readSidecarIfExists(DOC_ID, "notes.json")).toEqual({ notes: ["a"] });
    expect(await readSidecarIfExists(DOC_ID, "todos.json")).toBeNull();
  });
});

describe("sidecar bundle — write-then-read coherence", () => {
  it("a read after writeSidecar sees the new value (no stale cache)", async () => {
    seed({ "notes.json": '{"notes":[]}' });
    await readSidecarIfExists(DOC_ID, "notes.json"); // warm the bundle
    const handle = beginDocPipeline(DOC_ID);
    // awaiting writeSidecar awaits the queued write task, which updates the
    // bundle in place — so the read below sees the fresh value with no flush.
    await writeSidecar(handle, "notes.json", { notes: ["fresh"] });
    expect(await readSidecarIfExists(DOC_ID, "notes.json")).toEqual({ notes: ["fresh"] });
  });
});

describe("sidecar bundle — invalidation", () => {
  it("re-reads the dir after invalidateSidecarBundle (picks up out-of-band change)", async () => {
    const dir = seed({ "notes.json": '{"v":1}' });
    expect(await readSidecarIfExists(DOC_ID, "notes.json")).toEqual({ v: 1 });
    expect(dir.virgilAcquires).toBe(1);
    // A skill rewrites the file out of band, then the doc's pipeline ends.
    dir.dirs.get("virgil")!.files.set("notes.json", { text: '{"v":2}' });
    invalidateSidecarBundle(DOC_ID);
    expect(await readSidecarIfExists(DOC_ID, "notes.json")).toEqual({ v: 2 });
    expect(dir.virgilAcquires).toBe(2);
  });
});

describe("sidecar bundle — loadError data-loss guard", () => {
  it("a MALFORMED sidecar is NOT coerced to null — the read re-throws", async () => {
    seed({ "notes.json": "{ this is not valid json " });
    // Must throw (not return null) so usePersistentState flips loadError and the
    // destructive orphan reaper stands down. Bundle leaves the key UNSET on a
    // non-NotFound (parse) error → readSidecarIfExists falls through + re-throws.
    await expect(readSidecarIfExists(DOC_ID, "notes.json")).rejects.toBeTruthy();
    // …while a sibling absent file still resolves to null.
    expect(await readSidecarIfExists(DOC_ID, "todos.json")).toBeNull();
  });
});
