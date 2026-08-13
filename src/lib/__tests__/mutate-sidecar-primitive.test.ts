// @vitest-environment jsdom
//
// `mutateSidecar` — the SHIPPED primitive, in BOTH backends (task 220).
//
// WHY THIS FILE EXISTS. The task-220 suites all `vi.mock("@/lib/storage", …)`
// and hand-write a `mutateSidecar` that puts the read inside the queue. That is
// the harness's own construction, so what they prove is that the STORE and the
// two WRITERS behave correctly *given* a correct primitive — never that either
// shipped primitive IS correct. The defining property of the whole fix (the read
// running INSIDE the queued critical section) therefore had zero coverage: you
// could hoist `const current = await readSidecar(…)` above the `enqueueDocWrite(`
// call in both backends — verbatim the pre-220 bridge defect, reinstated one
// layer down — and every one of the 6180 tests stayed green.
//
// So these legs drive the REAL exports against a fake disk, and each one fails
// on that hoist. The FSA harness is the `sidecar-bundle.test.ts` FakeDirHandle
// (real write queue, real doc pipeline); the dev harness stubs `fetch`, which is
// the dev backend's only I/O.
//
// The assertions come in two shapes deliberately. The CONTENT leg ("both rows
// land") is what a user would notice. The ORDERING leg is the one that cannot
// pass by luck: it records every read and write against the file and asserts no
// read is interleaved between another mutation's read and its write — which is
// what "serialized read-modify-write" MEANS, and which a content assertion can
// satisfy accidentally on a fast enough fake.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage barrel does a top-level require() of a backend; stub it — we call
// the backends directly. (Documented gotcha: vitest_extension_barrel_storage_mock.)
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

// ---------------------------------------------------------------------------
// An I/O JOURNAL shared by both harnesses: one entry per real disk touch.
// ---------------------------------------------------------------------------

type Entry = { op: "read" | "write"; file: string; phase: "start" | "end" };
let journal: Entry[] = [];
const note = (op: Entry["op"], file: string, phase: Entry["phase"]) =>
  journal.push({ op, file, phase });

/** A real await, so an implementation that reads outside the lock genuinely
 *  interleaves rather than winning on microtask ordering. */
const slow = () => new Promise((r) => setTimeout(r, 5));

/**
 * The serialization invariant, read off the journal: between any mutation's
 * read and its own write, no OTHER read of the same file may start.
 *
 * Pairs are matched positionally — under a correct implementation the journal is
 * strictly `read/read/write/write` per mutation and never interleaved, so a
 * violation shows up as a read starting while a read→write pair is open.
 */
function assertSerialized(file: string): void {
  const seq = journal.filter((e) => e.file === file);
  let openRead = false;
  for (const e of seq) {
    if (e.op === "read" && e.phase === "start") {
      expect(openRead, `a read started while another RMW was mid-flight: ${JSON.stringify(seq)}`)
        .toBe(false);
      openRead = true;
    }
    if (e.op === "write" && e.phase === "end") openRead = false;
  }
}

const FILE = "ai-requests.json";
const DOC_ID = "testdoc";

// ---------------------------------------------------------------------------
// FSA harness — the FakeDirHandle from sidecar-bundle.test.ts, journalled.
// ---------------------------------------------------------------------------

interface FakeFile { text: string }

class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, FakeFile>();
  dirs = new Map<string, FakeDirHandle>();
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
      getFile: async () => ({
        text: async () => {
          note("read", name, "start");
          await slow();
          note("read", name, "end");
          return file.text;
        },
      }) as unknown as File,
      createWritable: async () => {
        let buf = "";
        return {
          write: async (c: unknown) => { buf = String(c); },
          close: async () => {
            note("write", name, "start");
            await slow();
            file.text = buf;
            note("write", name, "end");
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
  readIndex: vi.fn(async () => ({ docs: [] })),
  writeIndex: vi.fn(async () => {}),
}));

import {
  mutateSidecar as fsaMutateSidecar,
  invalidateSidecarBundle,
} from "@/lib/storage-fsa";
import { mutateSidecar as devMutateSidecar } from "@/lib/storage-dev";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

interface Row { id: string }
const EMPTY = { requests: [] as Row[] };

function seedFsa(text: string | null): void {
  docHandle = new FakeDirHandle(DOC_ID);
  const virgil = new FakeDirHandle("virgil");
  if (text !== null) virgil.files.set(FILE, { text });
  docHandle.dirs.set("virgil", virgil);
}

const fsaDisk = (): Row[] => {
  const t = docHandle.dirs.get("virgil")?.files.get(FILE)?.text;
  return t ? (JSON.parse(t) as typeof EMPTY).requests : [];
};

beforeEach(() => {
  journal = [];
  resetPipelines();
  invalidateSidecarBundle(DOC_ID);
});

describe("storage-fsa mutateSidecar: the read is inside the critical section", () => {
  it("two overlapping mutations BOTH land (a hoisted read loses one)", async () => {
    seedFsa(JSON.stringify(EMPTY));
    const h = beginDocPipeline(DOC_ID);

    // Fired without awaiting the first — the shape two panel checkboxes make.
    await Promise.all([
      fsaMutateSidecar(h, FILE, EMPTY, (c) => ({
        requests: [...(c as typeof EMPTY).requests, { id: "a" }],
      })),
      fsaMutateSidecar(h, FILE, EMPTY, (c) => ({
        requests: [...(c as typeof EMPTY).requests, { id: "b" }],
      })),
    ]);

    expect(fsaDisk().map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("no read interleaves with another mutation's read→write pair", async () => {
    seedFsa(JSON.stringify(EMPTY));
    const h = beginDocPipeline(DOC_ID);
    await Promise.all(
      ["a", "b", "c"].map((id) =>
        fsaMutateSidecar(h, FILE, EMPTY, (c) => ({
          requests: [...(c as typeof EMPTY).requests, { id }],
        })),
      ),
    );
    assertSerialized(FILE);
    expect(fsaDisk()).toHaveLength(3);
  });

  it("reads the file DIRECTLY, never a cached bundle snapshot", async () => {
    // A cached snapshot is exactly the stale base the primitive exists to
    // eliminate, so the in-lock read must hit disk every time. Two sequential
    // mutations ⇒ two real reads.
    seedFsa(JSON.stringify(EMPTY));
    const h = beginDocPipeline(DOC_ID);
    await fsaMutateSidecar(h, FILE, EMPTY, (c) => ({
      requests: [...(c as typeof EMPTY).requests, { id: "a" }],
    }));
    await fsaMutateSidecar(h, FILE, EMPTY, (c) => ({
      requests: [...(c as typeof EMPTY).requests, { id: "b" }],
    }));
    const reads = journal.filter((e) => e.file === FILE && e.op === "read" && e.phase === "start");
    expect(reads).toHaveLength(2);
  });

  it("a declined mutation writes nothing and resolves null", async () => {
    seedFsa(JSON.stringify({ requests: [{ id: "keep" }] }));
    const h = beginDocPipeline(DOC_ID);
    expect(await fsaMutateSidecar(h, FILE, EMPTY, () => null)).toBeNull();
    expect(journal.some((e) => e.op === "write")).toBe(false);
    expect(fsaDisk().map((r) => r.id)).toEqual(["keep"]);
  });

  it("an absent file resolves to the default rather than throwing", async () => {
    seedFsa(null);
    const h = beginDocPipeline(DOC_ID);
    const out = await fsaMutateSidecar(h, FILE, EMPTY, (c) => ({
      requests: [...(c as typeof EMPTY).requests, { id: "first" }],
    }));
    expect((out as typeof EMPTY).requests.map((r) => r.id)).toEqual(["first"]);
  });
});

// ---------------------------------------------------------------------------
// Dev harness — the dev backend's only I/O is `fetch`.
// ---------------------------------------------------------------------------

const devDisk = new Map<string, string>();

/** The shape the dev backend actually consumes off a `fetch` result. Stated
 *  explicitly because the union of the four returns below is otherwise
 *  self-referential through `text`, which tsc cannot infer (TS7023). */
interface FakeResponse {
  ok: boolean;
  headers?: { get: (k: string) => string | null };
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (
      url: string,
      init?: { method?: string; body?: string },
    ): Promise<FakeResponse> => {
      const name = String(url).split("/").pop() ?? "";
      if (init?.method === "PUT") {
        note("write", name, "start");
        await slow();
        devDisk.set(String(url), init.body ?? "");
        note("write", name, "end");
        return { ok: true, text: async () => "", json: async () => ({}) };
      }
      // The post-write disk-ledger stamp re-stats the file over HEAD. That is
      // NOT a merge-base read — it happens after the write, reads no content,
      // and is best-effort — so it must not count toward the serialization
      // invariant below, which is about where a mutation takes its BASE.
      if (init?.method === "HEAD") {
        const known = devDisk.has(String(url));
        return {
          ok: known,
          headers: { get: () => null },
          text: async () => "",
          json: async () => ({}),
        };
      }
      note("read", name, "start");
      await slow();
      note("read", name, "end");
      const body = devDisk.get(String(url));
      if (body === undefined) return { ok: false, text: async () => "", json: async () => ({}) };
      return { ok: true, text: async () => body, json: async () => JSON.parse(body) };
    }),
  );
}

const devRows = (): Row[] => {
  const key = [...devDisk.keys()].find((k) => k.endsWith(FILE));
  return key ? (JSON.parse(devDisk.get(key)!) as typeof EMPTY).requests : [];
};

describe("storage-dev mutateSidecar: the same contract, the same place", () => {
  beforeEach(() => {
    devDisk.clear();
    journal = [];
    resetPipelines();
    installFetch();
  });

  it("two overlapping mutations BOTH land", async () => {
    devDisk.set(`/api/dev/doc/${DOC_ID}/virgil/${FILE}`, JSON.stringify(EMPTY));
    const h = beginDocPipeline(DOC_ID);
    await Promise.all([
      devMutateSidecar(h, FILE, EMPTY, (c) => ({
        requests: [...(c as typeof EMPTY).requests, { id: "a" }],
      })),
      devMutateSidecar(h, FILE, EMPTY, (c) => ({
        requests: [...(c as typeof EMPTY).requests, { id: "b" }],
      })),
    ]);
    expect(devRows().map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("no read interleaves with another mutation's read→write pair", async () => {
    devDisk.set(`/api/dev/doc/${DOC_ID}/virgil/${FILE}`, JSON.stringify(EMPTY));
    const h = beginDocPipeline(DOC_ID);
    await Promise.all(
      ["a", "b", "c"].map((id) =>
        devMutateSidecar(h, FILE, EMPTY, (c) => ({
          requests: [...(c as typeof EMPTY).requests, { id }],
        })),
      ),
    );
    assertSerialized(FILE);
    expect(devRows()).toHaveLength(3);
  });

  it("a declined mutation writes nothing and resolves null", async () => {
    devDisk.set(`/api/dev/doc/${DOC_ID}/virgil/${FILE}`, JSON.stringify({ requests: [{ id: "keep" }] }));
    const h = beginDocPipeline(DOC_ID);
    expect(await devMutateSidecar(h, FILE, EMPTY, () => null)).toBeNull();
    expect(journal.some((e) => e.op === "write" && e.file === FILE)).toBe(false);
    expect(devRows().map((r) => r.id)).toEqual(["keep"]);
  });

  it("a snapshot write and an RMW share ONE queue key, so they cannot interleave", async () => {
    // The dev backend PUT straight through before task 220, so its two write
    // doors raced in a way they never could under FSA. Both now enqueue on the
    // same per-file key — which is only true while they compose that key the
    // same way, and nothing but this leg says so.
    const { writeSidecar: devWriteSidecar } = await import("@/lib/storage-dev");
    devDisk.set(`/api/dev/doc/${DOC_ID}/virgil/${FILE}`, JSON.stringify(EMPTY));
    const h = beginDocPipeline(DOC_ID);
    await Promise.all([
      devMutateSidecar(h, FILE, EMPTY, (c) => ({
        requests: [...(c as typeof EMPTY).requests, { id: "rmw" }],
      })),
      devWriteSidecar(h, FILE, { requests: [{ id: "snapshot" }] }),
    ]);
    assertSerialized(FILE);
  });
});
