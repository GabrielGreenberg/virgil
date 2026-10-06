// @vitest-environment jsdom
//
// Task 979 — `mutateSidecar` is a COMPARE-AND-SWAP against an out-of-process
// writer.
//
// The queue + doc lock serialize every writer inside the app, but the cowork
// skills commit from Python (`_common.commit_under_pen`: temp + `os.replace`)
// and never take that lock. So a skill commit landing between the in-lock read
// and the write used to be overwritten by `mutate(old)` — an agent-drafted card
// silently gone. These legs drive the REAL storage-fsa export against a fake
// disk that carries a stat (`lastModified`, `size`), and land the "skill"
// write from inside `mutate` — i.e. exactly in the window.

import { describe, it, expect, vi, beforeEach } from "vitest";

// `writeSidecarMerged` reaches the backend through the barrel. Forward to the
// REAL storage-fsa export, bound lazily (an import inside the factory would
// cycle back through the barrel being mocked).
const fwd = vi.hoisted(() => ({
  mutate: null as null | ((...a: unknown[]) => Promise<unknown>),
}));
vi.mock("@/lib/storage", () => ({
  isDevStorage: false,
  mutateSidecar: (...a: unknown[]) => fwd.mutate!(...a),
}));

const FILE = "reports.json";
const DOC_ID = "casdoc";

interface FakeFile {
  text: string;
  mtime: number;
}
let clock = 1_000;

class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, FakeFile>();
  dirs = new Map<string, FakeDirHandle>();
  writes = 0;
  constructor(public readonly name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDirHandle(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle> {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException(`no file ${name}`, "NotFoundError");
      this.files.set(name, { text: "", mtime: ++clock });
    }
    return {
      kind: "file",
      name,
      getFile: async () => {
        // A File is a SNAPSHOT of one revision, as in the browser.
        const f = this.files.get(name)!;
        const text = f.text;
        return {
          lastModified: f.mtime,
          size: new TextEncoder().encode(text).length,
          text: async () => text,
        } as unknown as File;
      },
      createWritable: async () => {
        let buf = "";
        return {
          write: async (c: unknown) => {
            buf = String(c);
          },
          close: async () => {
            this.writes++;
            this.files.set(name, { text: buf, mtime: ++clock });
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
const virgilDir = () => docHandle.dirs.get("virgil")!;

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
  getDocHandle: vi.fn(async (id: string) => (id === DOC_ID ? docHandle : null)),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({ docs: [] })),
  mutateIndex: vi.fn(async () => undefined),
}));

import { mutateSidecar, invalidateSidecarBundle } from "@/lib/storage-fsa";
fwd.mutate = mutateSidecar as unknown as (...a: unknown[]) => Promise<unknown>;
import { newMergeBase, writeSidecarMerged } from "@/lib/sidecar-merged-write";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

interface Card {
  id: string;
}
interface Reports {
  cards: Card[];
}
const EMPTY: Reports = { cards: [] };

function seed(value: Reports | null): void {
  docHandle = new FakeDirHandle(DOC_ID);
  const virgil = new FakeDirHandle("virgil");
  if (value !== null) {
    virgil.files.set(FILE, { text: JSON.stringify(value, null, 2), mtime: ++clock });
  }
  docHandle.dirs.set("virgil", virgil);
}

/** What a skill's `os.replace` does: new bytes, new mtime, no app lock. */
function foreignReplace(value: Reports, pythonStyle = true): void {
  const text = pythonStyle ? JSON.stringify(value) + "\n" : JSON.stringify(value, null, 2);
  virgilDir().files.set(FILE, { text, mtime: ++clock });
}

const ids = (): string[] =>
  (JSON.parse(virgilDir().files.get(FILE)!.text) as Reports).cards.map((c) => c.id);

const append = (id: string) => (cur: Reports): Reports => ({ cards: [...cur.cards, { id }] });

beforeEach(() => {
  resetPipelines();
  invalidateSidecarBundle(DOC_ID);
});

describe("mutateSidecar: a write never overwrites bytes it did not read", () => {
  it("a skill commit landing between the in-lock read and the write SURVIVES", async () => {
    seed({ cards: [{ id: "a" }] });
    const h = beginDocPipeline(DOC_ID);
    let runs = 0;
    const out = await mutateSidecar<Reports>(h, FILE, EMPTY, (cur) => {
      runs++;
      if (runs === 1) foreignReplace({ cards: [{ id: "a" }, { id: "agent" }] });
      return append("mine")(cur);
    });
    expect(ids()).toEqual(["a", "agent", "mine"]);
    expect(out?.cards.map((c) => c.id)).toEqual(["a", "agent", "mine"]);
    // Re-run exactly once, on the fresh base.
    expect(runs).toBe(2);
  });

  it("a file that APPEARS after an absent base read is not clobbered", async () => {
    seed(null);
    const h = beginDocPipeline(DOC_ID);
    let runs = 0;
    await mutateSidecar<Reports>(h, FILE, EMPTY, (cur) => {
      runs++;
      if (runs === 1) foreignReplace({ cards: [{ id: "agent" }] });
      return append("mine")(cur);
    });
    expect(ids()).toEqual(["agent", "mine"]);
  });

  it("an unmoved file writes on the first run (no needless re-run)", async () => {
    seed({ cards: [{ id: "a" }] });
    const h = beginDocPipeline(DOC_ID);
    let runs = 0;
    await mutateSidecar<Reports>(h, FILE, EMPTY, (cur) => {
      runs++;
      return append("b")(cur);
    });
    expect(runs).toBe(1);
    expect(ids()).toEqual(["a", "b"]);
  });

  it("a TOUCH (stat moved, bytes identical) is not a change", async () => {
    seed({ cards: [{ id: "a" }] });
    const h = beginDocPipeline(DOC_ID);
    let runs = 0;
    await mutateSidecar<Reports>(h, FILE, EMPTY, (cur) => {
      runs++;
      if (runs === 1) foreignReplace({ cards: [{ id: "a" }] }, false);
      return append("b")(cur);
    });
    expect(runs).toBe(1);
    expect(ids()).toEqual(["a", "b"]);
  });

  it("a file that never stops moving is REFUSED, and the foreign bytes stay", async () => {
    seed({ cards: [{ id: "a" }] });
    const h = beginDocPipeline(DOC_ID);
    let runs = 0;
    const writesBefore = virgilDir().writes;
    await expect(
      mutateSidecar<Reports>(h, FILE, EMPTY, (cur) => {
        runs++;
        foreignReplace({ cards: [{ id: "a" }, { id: `agent${runs}` }] });
        return append("mine")(cur);
      }),
    ).rejects.toMatchObject({ name: "SidecarContentionError" });
    expect(virgilDir().writes).toBe(writesBefore);
    expect(ids()).toEqual(["a", `agent${runs}`]);
  });
});

describe("writeSidecarMerged across a CAS re-run", () => {
  it("keeps the local DELETE and the agent's APPEND (the base is captured once)", async () => {
    seed({ cards: [{ id: "x" }, { id: "y" }] });
    const h = beginDocPipeline(DOC_ID);
    const base = newMergeBase<Reports>();
    base.value = { cards: [{ id: "x" }, { id: "y" }] };
    // The skill's commit lands inside the first in-lock read→write window. We
    // trigger it from the first stat check by wrapping getFileHandle once.
    const virgil = virgilDir();
    const real = virgil.getFileHandle.bind(virgil);
    let calls = 0;
    virgil.getFileHandle = async (name: string, opts?: { create?: boolean }) => {
      calls++;
      // 1st = in-lock base read; 2nd = the CAS stat. Land the skill write
      // between them.
      if (name === FILE && calls === 2) {
        foreignReplace({ cards: [{ id: "x" }, { id: "y" }, { id: "z" }] });
      }
      return real(name, opts);
    };
    await writeSidecarMerged<Reports>(h, FILE, base, { cards: [{ id: "x" }] });
    expect(ids()).toEqual(["x", "z"]);
    expect(base.value).toEqual({ cards: [{ id: "x" }] });
  });
});
