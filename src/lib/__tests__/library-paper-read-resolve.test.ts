// @vitest-environment jsdom
//
// Read-resolution invariant: a `library-paper:<citekey>` doc's directory
// handle must be resolvable for READS even when no per-doc handle is
// registered in the doc-index. In production FSA the handle is registered
// only one-shot (and racily) by PaperRender; when that registration is
// absent — a Reader teardown/remount race, or a non-Reader read (view-session
// auto-open, façade reads) — every read bottoms out at `requireDocHandle`,
// which historically threw "No folder handle stored for doc library-paper:…".
//
// The fix teaches `requireDocHandle` ONE on-demand fallback: for a
// `library-paper:` docId whose `getDocHandle` returns null, resolve
// `<library>/papers/<citekey>/` from the mounted library folder
// (`getLibraryHandle`), mirroring PaperRender's own registration path. This
// pins both the fix AND the invariants it must not break:
//   1. READS resolve via the library handle (the regression guard).
//   2. Library unmounted → still throws the unchanged /No folder handle/.
//   3. A normal docId is UNAFFECTED — the prefix gate means the fallback
//      never engages, so it still throws /No folder handle/.
//   4. WRITES still no-op — teaching reads to resolve a handle did NOT
//      re-enable writes (the enqueueDocWrite guard short-circuits BEFORE
//      requireDocHandle, so the fake handle's create/write methods are never
//      touched). This is the critical "the read fix didn't corrupt the source"
//      assertion.
//
// Harness mirrors library-paper-write-guard.test.ts:
//   - `@/lib/storage` barrel is stubbed (its top-level require() can't be
//     vitest-aliased; document-settings.ts pulls it transitively).
//   - `@/lib/doc-index` getDocHandle is mocked → null (the production race).
//   - `@library/lib/library-folder` getLibraryHandle is mocked per-test.
// (Documented gotcha: vitest_extension_barrel_storage_mock.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

// No per-doc handle is ever registered — getDocHandle → null is the
// production race the fix targets. The rest of the read path runs for real.
vi.mock("@/lib/doc-index", () => ({
  getDocHandle: vi.fn(async () => null),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({ docs: [] })),
  writeIndex: vi.fn(async () => {}),
}));

// getLibraryHandle is the on-demand fallback source. Default: unmounted
// (undefined). Individual tests override via the mocked fn.
const getLibraryHandleMock = vi.fn(
  async (): Promise<FileSystemDirectoryHandle | undefined> => undefined,
);
vi.mock("@library/lib/library-folder", () => ({
  getLibraryHandle: () => getLibraryHandleMock(),
}));

import {
  readDocBundle,
  readSidecar,
  readTex,
  writeSidecar,
  writeTex,
  writeDocBundle,
} from "@/lib/storage-fsa";
import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests as resetPipelines,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";
import { flushWrites } from "@/lib/write-queue";

const CITEKEY = "smith2020";
const LIBRARY_DOC = `library-paper:${CITEKEY}`;
const NORMAL_DOC = "regular-doc-123";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

// ---------------------------------------------------------------------------
// Minimal in-memory FSA fakes — just the subset the read path touches.
// ---------------------------------------------------------------------------

// A NotFoundError DOMException, as the real FSA throws for a missing entry —
// storage-fsa's isNotFound() keys on `e.name === "NotFoundError"`.
function notFound(): never {
  throw new DOMException("not found", "NotFoundError");
}

/** A read-only file handle. createWritable/getFileHandle-create are tracked
 *  on the owning dir so a stray write is observable. */
function makeFileHandle(name: string, text: string): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    async getFile() {
      return { text: async () => text } as unknown as File;
    },
    async createWritable() {
      throw new Error("createWritable should never be called on a read");
    },
  } as unknown as FileSystemFileHandle;
}

type FileHandleSpy = ReturnType<
  typeof vi.fn<(name: string, o?: { create?: boolean }) => void>
>;

interface FakeDirOpts {
  files?: Record<string, string>;
  subdirs?: Record<string, FileSystemDirectoryHandle>;
  /** Spies, so the write-guard test can assert ZERO create/write attempts. */
  getFileHandleSpy?: FileHandleSpy;
}

function makeDirHandle(name: string, opts: FakeDirOpts = {}): FileSystemDirectoryHandle {
  const files = opts.files ?? {};
  const subdirs = opts.subdirs ?? {};
  const getFileHandleSpy: FileHandleSpy =
    opts.getFileHandleSpy ??
    vi.fn<(name: string, o?: { create?: boolean }) => void>();
  return {
    kind: "directory",
    name,
    async getDirectoryHandle(childName: string, dirOpts?: { create?: boolean }) {
      if (subdirs[childName]) return subdirs[childName];
      if (dirOpts?.create) {
        // A read should never create a subdir; surface it loudly if it does.
        const created = makeDirHandle(childName, {});
        subdirs[childName] = created;
        return created;
      }
      return notFound();
    },
    async getFileHandle(fileName: string, fileOpts?: { create?: boolean }) {
      getFileHandleSpy(fileName, fileOpts);
      if (files[fileName] !== undefined) return makeFileHandle(fileName, files[fileName]);
      if (fileOpts?.create) {
        throw new Error(`getFileHandle create on read-only fake: ${fileName}`);
      }
      return notFound();
    },
    async *values() {
      for (const f of Object.keys(files)) yield makeFileHandle(f, files[f]);
      for (const d of Object.keys(subdirs)) yield subdirs[d];
    },
  } as unknown as FileSystemDirectoryHandle;
}

/** Build a fake library root whose papers/<citekey>/ contains main.tex +
 *  virgil/ (with virgil.json + editor-state.json), mirroring a real paper
 *  folder. `paperFileSpy` (if passed) is wired onto the paper dir so writes
 *  can be detected. */
function makeLibraryRoot(citekey: string, paperFileSpy?: FileHandleSpy) {
  const virgilDir = makeDirHandle("virgil", {
    files: {
      "virgil.json": JSON.stringify({ paragraphs: {} }),
      "editor-state.json": JSON.stringify({
        lastParagraphId: null,
        foldedSections: [],
        lastModified: "1970-01-01T00:00:00.000Z",
      }),
    },
  });
  const paperDir = makeDirHandle(citekey, {
    files: {
      "main.tex": "\\documentclass{article}\n\\begin{document}\nHello library.\n\\end{document}\n",
    },
    subdirs: { virgil: virgilDir },
    getFileHandleSpy: paperFileSpy,
  });
  const papersDir = makeDirHandle("papers", { subdirs: { [citekey]: paperDir } });
  const root = makeDirHandle("Virgil-Library", { subdirs: { papers: papersDir } });
  return { root, paperDir };
}

// ---------------------------------------------------------------------------

describe("storage-fsa — library-paper read-handle on-demand resolution", () => {
  beforeEach(() => {
    resetPipelines();
    getLibraryHandleMock.mockReset();
    getLibraryHandleMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    resetPipelines();
    vi.clearAllMocks();
  });

  // 1. The regression guard: getDocHandle → null (the production race) +
  //    getLibraryHandle → a mounted root → readDocBundle RESOLVES with content.
  it("readDocBundle resolves via the library handle when no per-doc handle is registered", async () => {
    const { root } = makeLibraryRoot(CITEKEY);
    getLibraryHandleMock.mockResolvedValue(root);

    const bundle = await readDocBundle(LIBRARY_DOC);
    expect(bundle).toBeTruthy();
    expect(bundle.content).toBeTruthy();
    expect(bundle.content.type).toBe("doc");
    // The fake main.tex parsed into at least one block — proves we read the
    // real (fake) file, not a default-latex fallback from a missing dir.
    expect(JSON.stringify(bundle.content)).toContain("Hello library");
  });

  it("readTex resolves the paper's main.tex via the library handle", async () => {
    const { root } = makeLibraryRoot(CITEKEY);
    getLibraryHandleMock.mockResolvedValue(root);

    const tex = await readTex(LIBRARY_DOC);
    expect(tex).toContain("Hello library");
  });

  it("readSidecar resolves a virgil/ sidecar via the library handle", async () => {
    const { root } = makeLibraryRoot(CITEKEY);
    getLibraryHandleMock.mockResolvedValue(root);

    const sidecar = await readSidecar(LIBRARY_DOC, "virgil.json", { paragraphs: {} });
    expect(sidecar).toEqual({ paragraphs: {} });
  });

  // 2. Graceful when the library is unmounted: getLibraryHandle → undefined +
  //    getDocHandle → null → the unchanged diagnostic throw.
  it("throws the unchanged /No folder handle/ when the library is unmounted", async () => {
    getLibraryHandleMock.mockResolvedValue(undefined);
    await expect(readDocBundle(LIBRARY_DOC)).rejects.toThrow(/No folder handle stored/);
  });

  it("throws the unchanged /No folder handle/ when the paper dir is missing mid-index", async () => {
    // Mounted library, but papers/<citekey> doesn't exist → getDirectoryHandle
    // throws NotFound → resolveLibraryPaperDir returns null → same throw.
    const papersDir = makeDirHandle("papers", { subdirs: {} });
    const root = makeDirHandle("Virgil-Library", { subdirs: { papers: papersDir } });
    getLibraryHandleMock.mockResolvedValue(root);
    await expect(readDocBundle(LIBRARY_DOC)).rejects.toThrow(/No folder handle stored/);
  });

  // 3. Zero blast radius — a normal doc with no registered handle still throws
  //    the same error (the prefix gate means the fallback never engages, and
  //    getLibraryHandle is never even consulted).
  it("normal doc is UNAFFECTED — still throws /No folder handle/, never consults the library", async () => {
    const { root } = makeLibraryRoot(CITEKEY);
    getLibraryHandleMock.mockResolvedValue(root);
    await expect(readDocBundle(NORMAL_DOC)).rejects.toThrow(/No folder handle stored/);
    expect(getLibraryHandleMock).not.toHaveBeenCalled();
  });

  // 4. CRITICAL: teaching reads to resolve a handle did NOT re-enable writes.
  //    With a fully-resolvable library handle, writes must STILL no-op — the
  //    enqueueDocWrite library-paper guard short-circuits BEFORE requireDocHandle
  //    in the task body, so the paper dir's getFileHandle/createWritable are
  //    never touched.
  describe("writes still no-op even though the handle is now resolvable", () => {
    let paperFileSpy: FileHandleSpy;

    beforeEach(() => {
      paperFileSpy = vi.fn<(name: string, o?: { create?: boolean }) => void>();
      const { root } = makeLibraryRoot(CITEKEY, paperFileSpy);
      getLibraryHandleMock.mockResolvedValue(root);
    });

    it("writeSidecar → no-op, never opens a file on the resolved paper dir", async () => {
      const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
      await expect(
        writeSidecar(h, "citations.json", { citations: [] }),
      ).resolves.toBeUndefined();
      expect(paperFileSpy).not.toHaveBeenCalled();
    });

    it("writeTex → no-op, never opens a file on the resolved paper dir", async () => {
      const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
      await expect(writeTex(h, "\\documentclass{article}")).resolves.toBeUndefined();
      expect(paperFileSpy).not.toHaveBeenCalled();
    });

    it("writeDocBundle → no-op, never opens a file on the resolved paper dir", async () => {
      const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
      await expect(writeDocBundle(h, EMPTY_DOC)).resolves.toBeUndefined();
      expect(paperFileSpy).not.toHaveBeenCalled();
    });
  });

  // Load-writeback no-op: readDocBundle's re-stamp writeback routes through
  // enqueueDocWrite → guard no-ops before its inner requireDocHandle. So a
  // successful read must NOT cause a write to the source paper file. We assert
  // the paper dir's getFileHandle was only ever called for READS (no `create`
  // flag), proving the load-writeback didn't open main.tex for writing.
  it("a successful read triggers NO source write (load-writeback stays no-op)", async () => {
    const paperFileSpy: FileHandleSpy = vi.fn<
      (name: string, o?: { create?: boolean }) => void
    >();
    const { root } = makeLibraryRoot(CITEKEY, paperFileSpy);
    getLibraryHandleMock.mockResolvedValue(root);

    // Register an active pipeline so the load-writeback branch is *attempted*
    // (getActiveHandle returns a live handle). The enqueueDocWrite guard must
    // still no-op it before any file is opened with create:true.
    const h = beginDocPipeline(LIBRARY_DOC);
    await readDocBundle(LIBRARY_DOC);
    // Let any fire-and-forget writeback microtasks settle.
    await flushWrites(`${LIBRARY_DOC}/bundle`);
    endDocPipeline(h);

    // No getFileHandle call on the paper dir carried { create: true }.
    const createCalls = paperFileSpy.mock.calls.filter(
      ([, fileOpts]) => (fileOpts as { create?: boolean } | undefined)?.create,
    );
    expect(createCalls).toHaveLength(0);
  });
});
