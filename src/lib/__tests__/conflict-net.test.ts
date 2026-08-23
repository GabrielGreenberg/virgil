// @vitest-environment jsdom
//
// **The conflict NET holds BOTH sides** — task 364, the content half.
//
// `conflict-resolution.test.ts` pins the ORDER (the net lands before either
// side is applied) against recording ports. That leg passes just as happily on
// a net that copies NOTHING — which is the failure this file exists for, and
// the one a user would only discover after they had already lost a version.
//
// So these legs drive the REAL `snapshotConflictSides` against a fake disk and
// read the slot back: the disk side must be there under its own names, and the
// editor's unsaved side — the half that exists nowhere else and that the
// storage backend cannot see on its own — must be there beside it, serialized
// the way a save would have written it.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage barrel does a top-level require() of a backend; stub it — we call
// the FSA backend directly. (Gotcha: vitest_extension_barrel_storage_mock.)
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

const DOC_ID = "testdoc";
const TEX = "main.tex";

interface FakeFile {
  text: string;
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
      f = { text: "" };
      this.files.set(name, f);
    }
    const file = f;
    return {
      kind: "file",
      name,
      getFile: async () =>
        ({
          text: async () => file.text,
          // The copier reads BYTES, not text — a fake that only answers `text()`
          // silently makes every copy fail into the warn-and-continue branch,
          // which would make this whole suite pass vacuously.
          arrayBuffer: async () => new TextEncoder().encode(file.text).buffer,
        }) as unknown as File,
      createWritable: async () => {
        let buf = "";
        return {
          write: async (c: unknown) => {
            buf =
              typeof c === "string"
                ? c
                : new TextDecoder().decode(c as ArrayBuffer);
          },
          close: async () => {
            file.text = buf;
          },
        } as unknown as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle;
  }

  async *values(): AsyncGenerator<{ kind: string; name: string }> {
    for (const [name] of this.files) yield { kind: "file", name };
    for (const [name] of this.dirs) yield { kind: "directory", name };
  }
}

let docHandle: FakeDirHandle;

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
  getDocHandle: vi.fn(async (id: string) => (id === DOC_ID ? docHandle : null)),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({
    docs: [{ id: DOC_ID, name: "Test", texFilename: TEX }],
  })),
  writeIndex: vi.fn(async () => {}),
}));

import { snapshotConflictSides } from "@/lib/storage-fsa";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

const DISK_TEX =
  "\\documentclass{article}\n\\begin{document}\nThe version that is on disk.\n\\end{document}\n";

/** A minimal editor model whose body text is distinguishable from the disk's. */
const MINE = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "aaaa" },
      content: [{ type: "text", text: "The version in the editor." }],
    },
  ],
};

function seed(): void {
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, { text: DISK_TEX });
  const virgil = new FakeDirHandle("virgil");
  virgil.files.set("virgil.json", { text: '{"paragraphs":{}}' });
  // A pre-417 build's leftover. RENEGOTIATED (task 417): `editor-state.json`
  // is a LOCAL-store sidecar now — per-machine scroll/caret/fold state that
  // never reaches the synced folder — so a forensic slot, which archives the
  // DISK bundle, must not copy it even when a stale one is still lying there.
  // The pre-417 leg pinned the copy as the contract.
  virgil.files.set("editor-state.json", { text: '{"folds":[]}' });
  docHandle.dirs.set("virgil", virgil);
}

function slotFiles(slotName: string): Map<string, FakeFile> {
  const history = docHandle.dirs.get("virgil")!.dirs.get(".history")!;
  return history.dirs.get(slotName)!.files;
}

beforeEach(() => {
  resetPipelines();
  seed();
});

describe("snapshotConflictSides — both sides, one slot", () => {
  it("copies the DISK side under its own names", async () => {
    const h = beginDocPipeline(DOC_ID);
    const receipt = await snapshotConflictSides(h, MINE);
    expect(receipt).not.toBeNull();
    const files = slotFiles(receipt!.slot);
    expect(files.get(TEX)?.text).toBe(DISK_TEX);
    expect(files.get("virgil.json")?.text).toBe('{"paragraphs":{}}');
    expect(files.has("editor-state.json")).toBe(false);
    // The receipt REPORTS what landed rather than claiming it.
    expect([...receipt!.disk].sort()).toEqual(["main.tex", "virgil.json"]);
  });

  it("archives the EDITOR's unsaved side beside it, as .tex", async () => {
    const h = beginDocPipeline(DOC_ID);
    const receipt = await snapshotConflictSides(h, MINE);
    expect(receipt!.mine).toBe(`unsaved-${TEX}`);
    const mine = slotFiles(receipt!.slot).get(`unsaved-${TEX}`)!.text;
    expect(mine).toContain("The version in the editor.");
    // Serialized through the save path's own door, so the archived copy is the
    // bytes a "keep mine" write would actually have produced — including the
    // user's verbatim preamble, taken off the file on disk.
    expect(mine).toContain("\\documentclass{article}");
    expect(mine).not.toContain("The version that is on disk.");
  });

  it("the two sides are DISTINGUISHABLE in the slot", async () => {
    // The whole value of the net is that a user can open the folder and tell
    // which file is which. A slot where both sides landed under one name would
    // satisfy every other leg here.
    const h = beginDocPipeline(DOC_ID);
    const receipt = await snapshotConflictSides(h, MINE);
    const files = slotFiles(receipt!.slot);
    expect(files.get(TEX)!.text).not.toBe(files.get(`unsaved-${TEX}`)!.text);
  });

  it("no editor model (nothing unsaved to keep) still nets the disk side", async () => {
    const h = beginDocPipeline(DOC_ID);
    const receipt = await snapshotConflictSides(h, null);
    expect(receipt!.mine).toBeNull();
    expect(slotFiles(receipt!.slot).get(TEX)?.text).toBe(DISK_TEX);
  });

  it("a model the SERIALIZER refuses is archived raw, never dropped", async () => {
    // Task 357: the serializer refuses a node this build cannot express. The
    // model is still the user's writing and it exists nowhere else, so the net
    // takes it as JSON rather than taking nothing.
    const h = beginDocPipeline(DOC_ID);
    const receipt = await snapshotConflictSides(h, {
      type: "doc",
      content: [{ type: "nodeThisBuildHasNever", attrs: {} }],
    });
    expect(receipt!.mine).toBe("unsaved-model.json");
    const raw = slotFiles(receipt!.slot).get("unsaved-model.json")!.text;
    expect(raw).toContain("nodeThisBuildHasNever");
  });

  it("an unreachable doc reports NO net rather than pretending", async () => {
    const h = beginDocPipeline("doc-that-is-not-in-the-index");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const receipt = await snapshotConflictSides(h, MINE);
    spy.mockRestore();
    expect(receipt).toBeNull();
  });
});
