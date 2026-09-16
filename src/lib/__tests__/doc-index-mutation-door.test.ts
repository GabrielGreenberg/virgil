// @vitest-environment jsdom
//
// Task 601 — the paper index has ONE mutation door (`mutateIndex`).
//
// The index is a single IndexedDB value. It used to be edited by nine
// hand-written `readIndex()` … `await` … `writeIndex()` sequences, so two
// edits could interleave and the later write erased the earlier one: a
// background save's timestamp bump read the list, a folder registration
// added paper B, and the bump then wrote the OLD list back — B's row gone,
// every later read/write of B throwing "Doc B not in index".
//
// `mutateIndex` runs the read and the write inside ONE readwrite IndexedDB
// transaction (idb-keyval `update`). The fake below models exactly the
// property that matters: a transaction reads the value WHEN IT RUNS, and a
// plain `get` … `set` pair can be split by other work. A gate holds the
// FIRST index write (from whichever writer started first) until the racing
// registration has finished — the ordering that lost the row.
//
// Neutered against the pre-601 doc-index.ts + storage-fsa.ts: the
// interleaving leg loses paper B.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const idb = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  let hold: Promise<void> | null = null;
  let heldOnce = false;
  // Handles stand in as plain objects with methods (not cloneable), so only
  // plain-data values are copied — the index is what the race is about.
  const clone = <T>(v: T): T => {
    try {
      return v === undefined ? v : (structuredClone(v) as T);
    } catch {
      return v;
    }
  };
  const pause = () => new Promise<void>((r) => setTimeout(r, 0));
  /** Latency before a write op on the index reaches the database. */
  async function beforeIndexWrite(key: string) {
    if (key !== "index" || !hold || heldOnce) return;
    heldOnce = true;
    await hold;
  }
  return {
    data,
    arm(p: Promise<void>) {
      hold = p;
      heldOnce = false;
    },
    reset() {
      data.clear();
      hold = null;
      heldOnce = false;
    },
    api: {
      createStore: () => ({}),
      get: async (key: string) => {
        await pause();
        return clone(data.get(key));
      },
      set: async (key: string, value: unknown) => {
        await beforeIndexWrite(key);
        await pause();
        data.set(key, clone(value));
      },
      del: async (key: string) => {
        await pause();
        data.delete(key);
      },
      keys: async () => [...data.keys()],
      // One transaction: the read happens when the transaction runs, and
      // nothing else can land between that read and the put.
      update: async (key: string, updater: (old: unknown) => unknown) => {
        await beforeIndexWrite(key);
        await pause();
        data.set(key, clone(updater(clone(data.get(key)))));
      },
    },
  };
});

vi.mock("idb-keyval", () => idb.api);
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));

import { readIndex, touchDocAccessed, type FsaDocMeta } from "@/lib/doc-index";
import {
  registerDocInFolder,
  renameDoc,
  deleteDocFromIndex,
} from "@/lib/storage-fsa";

const A: FsaDocMeta = {
  id: "aaaaaaaa",
  name: "Paper A",
  texFilename: "main.tex",
  folderName: "paper-a",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
  lastAccessedAt: "2026-01-01T00:00:00.000Z",
};

function fakeFolder(name: string): FileSystemDirectoryHandle {
  return {
    name,
    kind: "directory",
    getDirectoryHandle: async () => ({}),
  } as unknown as FileSystemDirectoryHandle;
}

beforeEach(() => {
  idb.reset();
  idb.data.set("index", { docs: [A] });
});

describe("the index mutation door — interleaved writers both survive", () => {
  it("a registration racing an access-time bump keeps the new row AND the bump", async () => {
    let release!: () => void;
    idb.arm(new Promise<void>((r) => (release = r)));

    const touch = touchDocAccessed(A.id); // its index write is held
    const meta = await registerDocInFolder(fakeFolder("paper-b"), "main.tex");
    release();
    await touch;

    const idx = await readIndex();
    expect(idx.docs.map((d) => d.id).sort()).toEqual([A.id, meta.id].sort());
    const a = idx.docs.find((d) => d.id === A.id)!;
    expect(a.lastAccessedAt).not.toBe(A.lastAccessedAt);
    // The new row's folder handle is stored.
    expect(idb.data.get(`doc-handle/${meta.id}`)).toBeDefined();
  });

  it("a rename racing a removal of another paper keeps both effects", async () => {
    const B = { ...A, id: "bbbbbbbb", folderName: "paper-b" };
    idb.data.set("index", { docs: [A, B] });
    let release!: () => void;
    idb.arm(new Promise<void>((r) => (release = r)));

    const rename = renameDoc(A.id, "Renamed"); // held
    await deleteDocFromIndex(B.id);
    release();
    await rename;

    const idx = await readIndex();
    expect(idx.docs.map((d) => d.id)).toEqual([A.id]);
    expect(idx.docs[0].name).toBe("Renamed");
  });

  it("two registrations of the same file converge on ONE row", async () => {
    const [m1, m2] = await Promise.all([
      registerDocInFolder(fakeFolder("paper-c"), "main.tex"),
      registerDocInFolder(fakeFolder("paper-c"), "main.tex"),
    ]);
    expect(m1.id).toBe(m2.id);
    const idx = await readIndex();
    expect(idx.docs.filter((d) => d.folderName === "paper-c")).toHaveLength(1);
    // The loser's orphan handle is cleaned up; the winner's is stored.
    const handles = [...idb.data.keys()].filter((k) =>
      k.startsWith("doc-handle/"),
    );
    expect(handles).toEqual([`doc-handle/${m1.id}`]);
  });
});

describe("readIndex hands out fresh objects", () => {
  it("mutating one empty-index snapshot does not leak into the next", async () => {
    idb.data.delete("index");
    const first = await readIndex();
    first.docs.push(A);
    const second = await readIndex();
    expect(second).not.toBe(first);
    expect(second.docs).toEqual([]);
  });
});

// ── Census ───────────────────────────────────────────────────────────────
const ROOT = join(__dirname, "..", "..", "..");
const SCAN = ["src", "editor", "library"].map((d) => join(ROOT, d));

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}

describe("census — the index has one write door", () => {
  const files = SCAN.flatMap((d) => walk(d));
  const SELF = relative(ROOT, __filename);

  it("no source (shipped or test) names the retired `writeIndex`", () => {
    const hits = files
      .filter((f) => relative(ROOT, f) !== SELF)
      .filter((f) => /\bwriteIndex\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    // doc-index.ts names it only in the door's own doc comment.
    expect(hits).toEqual(["src/lib/doc-index.ts"]);
    const docIndex = readFileSync(join(ROOT, "src/lib/doc-index.ts"), "utf8");
    expect(docIndex).not.toMatch(/function\s+writeIndex\b/);
  });

  it("doc-index.ts writes INDEX_KEY exactly once, through `update`", () => {
    const src = readFileSync(join(ROOT, "src/lib/doc-index.ts"), "utf8");
    const writes = src.match(/\b(set|update|del)(<[^>]*>)?\(\s*INDEX_KEY\b/g);
    expect(writes).toEqual(["update<FsaDocIndex>(\n    INDEX_KEY"]);
  });
});
