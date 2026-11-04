// @vitest-environment jsdom
//
// Task 1462 — creating a paper is all-or-nothing.
//
// A create is several writes (folder → template files → virgil/ → handle slot →
// index row), and both create doors refuse a name that already exists. So a
// create that threw half-way used to strand its own leftovers and the retry
// refused on them. Each door now keeps a ledger of exactly what it made and
// removes exactly that on a throw, rethrowing the original error.
//
// Legs:
//   1. PICKER   — a template write that throws on the last file removes the new
//                 folder; the retry with the same name succeeds.
//   2. INDEX    — an index push that throws deletes the stored handle slot (and
//                 the folder), and the caller still sees the ORIGINAL error.
//   3. IN-FOLDER — only the files this call wrote go; the user's pre-existing
//                 files and a pre-existing virgil/ are untouched; the retry
//                 succeeds.
// Each fails on the pre-1462 doors (no rollback → the retry hits the check).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

/** A minimal FSA directory handle: files, subdirs, recursive removeEntry,
 *  and a per-name write-failure switch. */
class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, string>();
  dirs = new Map<string, FakeDirHandle>();
  /** File names whose write throws. */
  failWrite = new Set<string>();
  constructor(public readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create)
        throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDirHandle(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create)
        throw new DOMException(`no file ${name}`, "NotFoundError");
      this.files.set(name, "");
    }
    const self = this;
    return {
      kind: "file" as const,
      name,
      async createWritable() {
        let buf = "";
        return {
          async write(c: string) {
            if (self.failWrite.has(name))
              throw new Error(`disk full writing ${name}`);
            buf += c;
          },
          async close() {
            self.files.set(name, buf);
          },
        };
      },
    };
  }

  async removeEntry(
    name: string,
    opts?: { recursive?: boolean },
  ): Promise<void> {
    if (this.files.delete(name)) return;
    const d = this.dirs.get(name);
    if (!d) throw new DOMException(`no entry ${name}`, "NotFoundError");
    if (!opts?.recursive && (d.files.size || d.dirs.size)) {
      throw new DOMException("not empty", "InvalidModificationError");
    }
    this.dirs.delete(name);
  }

  async *values(): AsyncGenerator<{ kind: string; name: string }> {
    for (const [name] of this.files) yield { kind: "file", name };
    for (const [name] of this.dirs) yield { kind: "directory", name };
  }
}

const handles = new Map<string, unknown>();
const indexDocs: { id: string }[] = [];
const failIndex = { on: false };

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
  getDocHandle: vi.fn(async (id: string) => handles.get(id) ?? null),
  setDocHandle: vi.fn(async (id: string, h: unknown) => {
    handles.set(id, h);
  }),
  deleteDocHandle: vi.fn(async (id: string) => {
    handles.delete(id);
  }),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({ docs: indexDocs })),
  mutateIndex: vi.fn(
    async (fn: (idx: { docs: { id: string }[] }) => unknown) => {
      if (failIndex.on) throw new Error("index transaction aborted");
      return fn({ docs: indexDocs });
    },
  ),
}));

import { createDocFromPicker, createDocInFolder } from "@/lib/storage-fsa";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
} from "@/lib/document-templates";

const template =
  DOCUMENT_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) ??
  DOCUMENT_TEMPLATES[0]!;
const templateFiles = Object.keys(template.files);

let parent: FakeDirHandle;

beforeEach(() => {
  handles.clear();
  indexDocs.length = 0;
  failIndex.on = false;
  parent = new FakeDirHandle("Papers");
  vi.stubGlobal(
    "showDirectoryPicker",
    vi.fn(async () => parent),
  );
});

describe("create-doc rollback — the PICKER door", () => {
  it("removes its new folder when a template write throws; the retry succeeds", async () => {
    parent.dirs.set("Unrelated", new FakeDirHandle("Unrelated"));
    // Fail the LAST template file (so every earlier one was already written)
    // inside the folder the door creates.
    const orig = parent.getDirectoryHandle.bind(parent);
    parent.getDirectoryHandle = async (n, o) => {
      const d = await orig(n, o);
      if (n === "My Paper")
        d.failWrite.add(templateFiles[templateFiles.length - 1]!);
      return d;
    };
    await expect(createDocFromPicker("My Paper", template.id)).rejects.toThrow(
      /disk full/,
    );
    expect(parent.dirs.has("My Paper")).toBe(false);
    expect(parent.dirs.has("Unrelated")).toBe(true);
    expect(handles.size).toBe(0);
    expect(indexDocs).toHaveLength(0);

    parent.getDirectoryHandle = orig;
    const meta = await createDocFromPicker("My Paper", template.id);
    expect(parent.dirs.get("My Paper")!.files.size).toBe(templateFiles.length);
    expect(indexDocs.map((d) => d.id)).toEqual([meta.id]);
  });

  it("deletes the stored handle slot when the index push throws, rethrowing the original", async () => {
    failIndex.on = true;
    await expect(createDocFromPicker("My Paper", template.id)).rejects.toThrow(
      "index transaction aborted",
    );
    expect(handles.size).toBe(0);
    expect(parent.dirs.has("My Paper")).toBe(false);

    failIndex.on = false;
    await expect(
      createDocFromPicker("My Paper", template.id),
    ).resolves.toBeTruthy();
  });
});

describe("create-doc rollback — the IN-FOLDER door", () => {
  it("removes only the files it wrote; the user's files and virgil/ stay", async () => {
    const folder = new FakeDirHandle("Project");
    folder.files.set("notes.txt", "mine");
    const virgil = new FakeDirHandle("virgil");
    virgil.files.set("prefs.json", "{}");
    folder.dirs.set("virgil", virgil);
    folder.failWrite.add(templateFiles[templateFiles.length - 1]!);
    const h = folder as unknown as FileSystemDirectoryHandle;

    await expect(createDocInFolder(h, "My Paper", template.id)).rejects.toThrow(
      /disk full/,
    );
    expect([...folder.files.keys()]).toEqual(["notes.txt"]);
    expect(folder.files.get("notes.txt")).toBe("mine");
    expect(folder.dirs.get("virgil")?.files.get("prefs.json")).toBe("{}");
    expect(handles.size).toBe(0);

    folder.failWrite.clear();
    await createDocInFolder(h, "My Paper", template.id);
    for (const f of templateFiles) expect(folder.files.has(f)).toBe(true);
  });

  it("removes a virgil/ it created itself when the index push throws", async () => {
    const folder = new FakeDirHandle("Project");
    failIndex.on = true;
    await expect(
      createDocInFolder(
        folder as unknown as FileSystemDirectoryHandle,
        "P",
        template.id,
      ),
    ).rejects.toThrow("index transaction aborted");
    expect(folder.files.size).toBe(0);
    expect(folder.dirs.size).toBe(0);
    expect(handles.size).toBe(0);
  });
});
