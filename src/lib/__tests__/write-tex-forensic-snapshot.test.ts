// @vitest-environment jsdom
//
// `writeTex` takes a forensic snapshot before it overwrites (task 357).
//
// The style switch and the compile-path documentclass swap both replace the
// document's preamble wholesale, and both are USER-INTENT — so a preservation
// GATE would be wrong there: refusing them would refuse exactly what the user
// asked for. What was missing was the other half. Every other `.tex` writer in
// this backend calls `snapshotPriorBundle` before it writes; `writeTex` called
// nothing, so the single most destructive write Virgil makes was the one with
// no way back.
//
// The census in `tex-write-accountability.test.ts` is what catches a writer
// that never asks. This is the behavioural half: the snapshot has to hold the
// bytes as they were BEFORE the write, which no source grep can establish.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage barrel top-level-requires a backend; stub it (documented gotcha).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

const DOC_ID = "styledoc";
const TEX = "document.tex";

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
          size: file.text.length,
          lastModified: 1,
          text: async () => file.text,
          // `copyFileIfPresent` copies BYTES, not text — the snapshot must
          // survive that path, so the fake has to serve it.
          arrayBuffer: async () => new TextEncoder().encode(file.text).buffer,
        }) as unknown as File,
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
  name: "Styled",
  texFilename: TEX,
  folderName: "styled",
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

import { writeTex } from "@/lib/storage-fsa";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

const ORIGINAL =
  "\\documentclass{article}\n\\usepackage{expex}\n\n" +
  "\\begin{document}\n\nThe body the user wrote.\n\n\\end{document}\n";
const SWAPPED =
  "\\documentclass{amsart}\n\\usepackage{amsmath}\n\n" +
  "\\begin{document}\n\nThe body the user wrote.\n\n\\end{document}\n";

function seed(): void {
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, { text: ORIGINAL });
  docHandle.dirs.set("virgil", new FakeDirHandle("virgil"));
}

/** The one history slot's copy of the `.tex`, or null if nothing was kept. */
function snapshottedTex(): string | null {
  const history = docHandle.dirs.get("virgil")?.dirs.get(".history");
  if (!history) return null;
  const slots = [...history.dirs.values()];
  if (slots.length !== 1) return null;
  return slots[0].files.get(TEX)?.text ?? null;
}

beforeEach(() => {
  resetPipelines();
  seed();
});

describe("writeTex · the style swap keeps a way back", () => {
  it("snapshots the PRE-write .tex, then writes the new bytes", async () => {
    const h = beginDocPipeline(DOC_ID);
    await writeTex(h, SWAPPED);

    // The user's intent lands…
    expect(docHandle.files.get(TEX)?.text).toBe(SWAPPED);
    // …and the preamble it replaced is recoverable from `virgil/.history/`.
    expect(
      snapshottedTex(),
      "writeTex overwrote the .tex with no forensic snapshot",
    ).toBe(ORIGINAL);
  });

  it("does NOT gate the write — a user-intent preamble swap is allowed to shrink", async () => {
    // The swap above is roughly word-neutral; this one deletes most of the
    // preamble, which the write gate would refuse for an AUTOMATIC write. It is
    // the user's own request, so it must land — and still be recoverable.
    const h = beginDocPipeline(DOC_ID);
    const stripped =
      "\\documentclass{article}\n\n\\begin{document}\n\nThe body the user wrote.\n\n\\end{document}\n";
    await writeTex(h, stripped);
    expect(docHandle.files.get(TEX)?.text).toBe(stripped);
    expect(snapshottedTex()).toBe(ORIGINAL);
  });
});
