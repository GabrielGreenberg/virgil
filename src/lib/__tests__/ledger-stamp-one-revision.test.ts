// @vitest-environment jsdom
//
// Task 1155 — **a ledger stamp's hash and its `{mtime,size}` describe the SAME
// file revision.**
//
// The disk watcher trusts the stamp on its cheap path: `live == stamp` → NO
// read. So a stamp that pairs Virgil's hash with a FOREIGN revision's stat
// blinds the watcher to that revision forever, and the next autosave silently
// overwrites it. Two stamp sites used to build the fingerprint from two reads:
//
//   • LOAD — `readDocBundle` read the `.tex`, then RE-STATTED it to stamp. A
//     foreign write in between stamped the new revision's stat under the old
//     bytes' hash. Fixed by construction: the load reads through the tracked
//     read, so ONE `getFile()` serves bytes and stamp.
//   • SAVE — the write door wrote, then re-statted. A foreign write in between
//     stamped ITS stat under Virgil's hash. Fixed: the post-write stamp takes
//     `size` from the bytes Virgil wrote (`ownWriteFingerprint`), so a foreign
//     revision of a different size can never match it. (A same-size foreign
//     write inside the window is the stated residual.)
//
// Each leg drives the REAL storage-fsa door against a fake FSA disk with real
// mtime/size semantics, then the REAL watcher poll, and asserts the foreign
// edit is flagged `modified`.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage barrel top-level-requires a backend; stub it (documented gotcha).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

const DOC_ID = "stampdoc";
const TEX = "main.tex";

interface FakeFile {
  text: string;
  mtimeMs: number;
}

let clock = 1_000;
/** Runs once, right after the NEXT `.tex` read's bytes are taken. */
let afterTexRead: (() => void) | null = null;
/** Runs once, right after the NEXT `.tex` write lands (before the stamp). */
let afterTexWrite: (() => void) | null = null;

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
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
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
      if (!opts?.create) throw new DOMException(`no file ${name}`, "NotFoundError");
      f = { text: "", mtimeMs: ++clock };
      this.files.set(name, f);
    }
    const file = f;
    // Only the paper's own `.tex` — a `.history/<slot>/main.tex` forensic copy
    // shares the name but is not the file the race is about.
    const isTex = name === TEX && this === docHandle;
    return {
      kind: "file",
      name,
      // A real `File` is a SNAPSHOT of one revision: size, mtime and bytes
      // all describe the revision current at `getFile()`.
      getFile: async () => {
        const snap = { ...file };
        return {
          size: new TextEncoder().encode(snap.text).length,
          lastModified: snap.mtimeMs,
          text: async () => {
            const hook = isTex ? afterTexRead : null;
            if (hook) {
              afterTexRead = null;
              hook();
            }
            return snap.text;
          },
          arrayBuffer: async () => new TextEncoder().encode(snap.text).buffer,
        } as unknown as File;
      },
      createWritable: async () => {
        let buf: unknown = "";
        return {
          write: async (c: unknown) => {
            buf = c;
          },
          close: async () => {
            file.text =
              typeof buf === "string"
                ? buf
                : new TextDecoder().decode(buf as ArrayBuffer);
            file.mtimeMs = ++clock;
            const hook = isTex ? afterTexWrite : null;
            if (hook) {
              afterTexWrite = null;
              hook();
            }
          },
        } as unknown as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
    this.dirs.delete(name);
  }

  async *values(): AsyncGenerator<{ kind: string; name: string }> {
    for (const [name] of this.files) yield { kind: "file", name };
    for (const [name] of this.dirs) yield { kind: "directory", name };
  }
}

let docHandle: FakeDirHandle;

const META = {
  id: DOC_ID,
  name: "Stamped",
  texFilename: TEX,
  folderName: "stamped",
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
  mutateIndex: vi.fn(async () => undefined),
}));

import {
  readDocBundle,
  writeTex,
  statFiles,
  readTextFile,
  invalidateSidecarBundle,
} from "@/lib/storage-fsa";
import {
  getDiskFingerprint,
  hashContent,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";
import { createDiskWatcher } from "@/lib/disk-watcher";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { clearRetained } from "@/lib/write-preservation";

const BASE_TEX =
  "\\documentclass{article}\n\n\\begin{document}\n\nOriginal paragraph.\n\n\\end{document}\n";
const FOREIGN_TEX =
  "\\documentclass{article}\n\n\\begin{document}\n\nA collaborator's longer rewrite of the paragraph.\n\n\\end{document}\n";

function foreignWrite(text: string): void {
  const f = docHandle.files.get(TEX)!;
  f.text = text;
  f.mtimeMs = ++clock;
}

/**
 * The REAL watcher, already PRIMED — as in a live session, where the watcher
 * primed long before the race. (A watcher's first poll re-baselines every
 * present file by design, so it must not be the poll that classifies.)
 */
async function primedWatcher() {
  const w = createDiskWatcher({
    docId: DOC_ID,
    statFiles,
    readTextFile,
    getBibFilename: async () => "",
    getTexFilename: () => TEX,
    hasUnsavedEdits: () => false,
    now: () => 0,
    pollMs: 3000,
    isHidden: () => false,
  });
  await w.pollNow();
  return w;
}

async function texFlagged(
  w: Awaited<ReturnType<typeof primedWatcher>>,
): Promise<boolean> {
  await w.pollNow();
  const snap = w.store.getSnapshot();
  w.stop();
  return snap.changes.some((c) => c.relPath === TEX && c.kind === "modified");
}

beforeEach(() => {
  clock = 1_000;
  afterTexRead = null;
  afterTexWrite = null;
  resetPipelines();
  clearRetained();
  __resetDiskLedgerForTests();
  invalidateSidecarBundle(DOC_ID);
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, { text: BASE_TEX, mtimeMs: ++clock });
  docHandle.dirs.set("virgil", new FakeDirHandle("virgil"));
});

describe("load · the stamp comes from the ONE read", () => {
  it("a foreign write between the load read and the stamp is not stamped as the loaded bytes", async () => {
    afterTexRead = () => foreignWrite(FOREIGN_TEX);
    await readDocBundle(DOC_ID);

    const fp = getDiskFingerprint(DOC_ID, TEX)!;
    expect(fp.hash).toBe(hashContent(BASE_TEX));
    // The stamp describes the revision that was READ — not the foreign one.
    expect(fp.size).toBe(new TextEncoder().encode(BASE_TEX).length);
  });

  it("…so the watcher's next poll flags the foreign edit `modified`", async () => {
    // A RE-load (the reload door) while the watcher runs.
    await readDocBundle(DOC_ID);
    const w = await primedWatcher();
    afterTexRead = () => foreignWrite(FOREIGN_TEX);
    await readDocBundle(DOC_ID);
    expect(await texFlagged(w)).toBe(true);
  });

  it("an undisturbed load stamps exactly the revision it read", async () => {
    await readDocBundle(DOC_ID);
    const fp = getDiskFingerprint(DOC_ID, TEX)!;
    const live = docHandle.files.get(TEX)!;
    expect(fp).toEqual({
      hash: hashContent(live.text),
      size: new TextEncoder().encode(live.text).length,
      mtimeMs: live.mtimeMs,
    });
  });
});

describe("save · a post-write stamp cannot adopt a foreign revision's stat", () => {
  it("a different-size foreign write between the write and the stamp is flagged `modified`", async () => {
    await readDocBundle(DOC_ID);
    const w = await primedWatcher();
    const edited = BASE_TEX.replace("Original", "Edited");
    afterTexWrite = () => foreignWrite(FOREIGN_TEX);
    await writeTex(beginDocPipeline(DOC_ID), edited);

    const fp = getDiskFingerprint(DOC_ID, TEX)!;
    expect(fp.hash).toBe(hashContent(edited));
    // Size is the size of the bytes Virgil WROTE, so it cannot match the
    // foreign revision now on disk.
    expect(fp.size).toBe(new TextEncoder().encode(edited).length);
    expect(await texFlagged(w)).toBe(true);
  });

  it("Virgil's own write, undisturbed, is NOT flagged (no false positive)", async () => {
    await readDocBundle(DOC_ID);
    const w = await primedWatcher();
    const edited = BASE_TEX.replace("Original", "Edited");
    await writeTex(beginDocPipeline(DOC_ID), edited);
    const live = docHandle.files.get(TEX)!;
    expect(getDiskFingerprint(DOC_ID, TEX)).toEqual({
      hash: hashContent(edited),
      size: new TextEncoder().encode(edited).length,
      mtimeMs: live.mtimeMs,
    });
    expect(await texFlagged(w)).toBe(false);
  });
});

describe("census · no post-write re-stat stamp pairs a stat's size with written bytes", () => {
  it("both backends stamp a write through `ownWriteFingerprint`", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const rel of ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"]) {
      const src = fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
      expect(src, `${rel}: the retired re-stat stamper is back`).not.toMatch(
        /\bstampLedger\(/,
      );
      const at = src.indexOf("async function stampOwnWrite(");
      expect(at, `${rel}: no stampOwnWrite`).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf("\n}\n", at));
      expect(body).toMatch(/ownWriteFingerprint\(/);
      expect(body).not.toMatch(/fingerprintOf\(/);
    }
  });
});
