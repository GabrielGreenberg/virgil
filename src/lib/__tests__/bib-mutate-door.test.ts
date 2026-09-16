// @vitest-environment jsdom
//
// `mutateBib` — the SHIPPED `.bib` write door, in BOTH backends (task 558).
//
// `references.bib` was the one multi-writer file with no serialized
// read-modify-write door: `writeBib` wrapped only the WRITE, and every app-side
// mutation was a read-modify-write whose READ ran outside the lock — a
// `readBib` a few awaits earlier, or the Bibliography panel's React state,
// seeded once per doc. Two writers racing off different bases lost the earlier
// entry; an `/editor/*` skill's entry was destroyed by the user's next bib edit.
// Nothing threw. `writeBib` is RETIRED; `mutateBib` is the door.
//
// These legs drive the REAL exports against a fake disk (the
// `mutate-sidecar-primitive` shape — that suite is the MODEL for this one, and
// stays green beside it). The FSA fake models mtime/size because the funnel's
// byte-equality gate re-confirms them (task 415). Two assertion shapes, as
// there: the CONTENT leg is what a user notices; the ORDERING leg — no base
// read of the `.bib` starts while another mutation's read→write pair is open —
// cannot pass by luck on a fast fake.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage barrel top-level-requires a backend; stub it (documented gotcha).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

type Entry = { op: "read" | "write"; file: string; phase: "start" | "end" };
let journal: Entry[] = [];
const note = (op: Entry["op"], file: string, phase: Entry["phase"]) =>
  journal.push({ op, file, phase });

/** A real await, so an implementation that reads outside the lock genuinely
 *  interleaves rather than winning on microtask ordering. */
const slow = () => new Promise((r) => setTimeout(r, 5));

/** Between any mutation's BASE read and its own write, no other base read of
 *  the same file may start. Only `text()` reads are journalled: the forensic
 *  copy that rides `beforeWrite` reads via `arrayBuffer()`, and the gate's
 *  stat reads no content — neither is a merge base. */
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

const DOC_ID = "bibdoc";
const TEX = "main.tex";
const BIB = "references.bib";

const A = "@book{a,\n  title = {A},\n}\n";
const B = "@book{b,\n  title = {B},\n}\n";
const X = "@book{x,\n  title = {X},\n}\n";

/** A TEXT mutator that appends a block — the shape the authority hands the
 *  door (parse/serialize live one layer up; the door is text-shaped). */
const append = (block: string) => (current: string) => current + block;

const keysIn = (text: string): string[] =>
  [...text.matchAll(/@book\{(\w+),/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// FSA harness — a fake disk with real mtime/size + a journalled `text()`.
// ---------------------------------------------------------------------------

interface FakeFile {
  text: string;
  mtimeMs: number;
}
let clock = 1_000;

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
      f = { text: "", mtimeMs: ++clock };
      this.files.set(name, f);
    }
    const file = f;
    return {
      kind: "file",
      name,
      getFile: async () =>
        ({
          size: new TextEncoder().encode(file.text).length,
          lastModified: file.mtimeMs,
          text: async () => {
            note("read", name, "start");
            await slow();
            note("read", name, "end");
            return file.text;
          },
          arrayBuffer: async () => new TextEncoder().encode(file.text).buffer,
        }) as unknown as File,
      createWritable: async () => {
        let buf: unknown = "";
        return {
          write: async (c: unknown) => {
            buf = c;
          },
          close: async () => {
            note("write", name, "start");
            await slow();
            file.text =
              typeof buf === "string"
                ? buf
                : new TextDecoder().decode(buf as ArrayBuffer);
            file.mtimeMs = ++clock;
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

const META = {
  id: DOC_ID,
  name: "Bib",
  texFilename: TEX,
  folderName: "bib",
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

import { mutateBib as fsaMutateBib, invalidateSidecarBundle } from "@/lib/storage-fsa";
import { mutateBib as devMutateBib } from "@/lib/storage-dev";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import {
  getDiskFingerprint,
  hashContent,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";

function seedFsa(bib: string | null): void {
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, {
    text: "\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n",
    mtimeMs: ++clock,
  });
  if (bib !== null) docHandle.files.set(BIB, { text: bib, mtimeMs: ++clock });
  docHandle.dirs.set("virgil", new FakeDirHandle("virgil"));
}

const fsaDisk = (): string => docHandle.files.get(BIB)?.text ?? "";
const fsaWrites = () => journal.filter((e) => e.file === BIB && e.op === "write" && e.phase === "end");
const fsaSlots = () =>
  [...(docHandle.dirs.get("virgil")?.dirs.get(".history")?.dirs.keys() ?? [])];

beforeEach(() => {
  journal = [];
  resetPipelines();
  __resetDiskLedgerForTests();
  invalidateSidecarBundle(DOC_ID);
});

describe("storage-fsa mutateBib: the base read is inside the critical section", () => {
  it("DEFECT: two overlapping mutations BOTH land (a base read outside the lock loses one)", async () => {
    // The shape of a Library drag-drop landing while a bib card's Save is in
    // flight. With the read outside the write queue both would read `A` and
    // the second whole-file write would drop the first's entry.
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    await Promise.all([fsaMutateBib(h, append(B)), fsaMutateBib(h, append(X))]);
    expect(keysIn(fsaDisk()).sort()).toEqual(["a", "b", "x"]);
  });

  it("no base read interleaves with another mutation's read→write pair", async () => {
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    await Promise.all([B, X, "@book{y,\n  title = {Y},\n}\n"].map((blk) => fsaMutateBib(h, append(blk))));
    assertSerialized(BIB);
    expect(keysIn(fsaDisk())).toHaveLength(4);
  });

  it("DEFECT: an entry written BEHIND THE APP'S BACK survives the next in-app mutation", async () => {
    // The out-of-process writer: an `/editor/*` skill rewrote the file after
    // this window last read it. The door reads the DISK as its base, so the
    // skill's entry is merged over rather than computed away.
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    await fsaMutateBib(h, append(B));
    // …then the skill lands `x` straight on disk, telling nobody.
    docHandle.files.set(BIB, { text: A + B + X, mtimeMs: ++clock });
    const out = await fsaMutateBib(h, append("@book{z,\n  title = {Z},\n}\n"));
    expect(keysIn(out!)).toEqual(["a", "b", "x", "z"]);
    expect(keysIn(fsaDisk())).toEqual(["a", "b", "x", "z"]);
  });

  it("reads the file DIRECTLY on every mutation — never a cached snapshot", async () => {
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    await fsaMutateBib(h, append(B));
    await fsaMutateBib(h, append(X));
    const reads = journal.filter((e) => e.file === BIB && e.op === "read" && e.phase === "start");
    expect(reads).toHaveLength(2);
  });

  it("a declined mutation writes nothing, mints no history slot, and resolves null", async () => {
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    expect(await fsaMutateBib(h, () => null)).toBeNull();
    expect(fsaWrites()).toHaveLength(0);
    expect(fsaSlots()).toHaveLength(0);
    expect(fsaDisk()).toBe(A);
  });

  it("an absent .bib is an EMPTY base, not a throw", async () => {
    seedFsa(null);
    const h = beginDocPipeline(DOC_ID);
    const out = await fsaMutateBib(h, (cur) => {
      expect(cur).toBe("");
      return A;
    });
    expect(out).toBe(A);
    expect(fsaDisk()).toBe(A);
  });

  it("the write half takes ONE forensic snapshot and stamps the ledger", async () => {
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    await fsaMutateBib(h, append(B));
    expect(fsaSlots()).toHaveLength(1);
    const fp = getDiskFingerprint(DOC_ID, BIB);
    expect(fp?.hash).toBe(hashContent(A + B));
  });

  it("a mutation that reproduces the on-disk bytes is the gate's no-op: no write, no slot", async () => {
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    await fsaMutateBib(h, append(B)); // establishes the ledger entry
    journal = [];
    await fsaMutateBib(h, (cur) => cur); // byte-identical
    expect(fsaWrites()).toHaveLength(0);
    expect(fsaSlots()).toHaveLength(1);
  });

  it("the base read is NON-stamping: a declined mutation over an external edit leaves the watcher's baseline alone", async () => {
    // `mutateSidecar` stamps on its in-lock read; this door deliberately does
    // NOT. The `.bib` fingerprint is the external-change watcher's baseline,
    // kept stale across a genuine external change so the badge stays lit —
    // stamping here on a mutation that then declines would silently absorb an
    // edit the watcher had not yet surfaced (anti-flicker, DESIGN.md §3).
    seedFsa(A);
    const h = beginDocPipeline(DOC_ID);
    await fsaMutateBib(h, append(B));
    const before = getDiskFingerprint(DOC_ID, BIB);
    docHandle.files.set(BIB, { text: A + B + X, mtimeMs: ++clock }); // external
    expect(await fsaMutateBib(h, () => null)).toBeNull();
    expect(getDiskFingerprint(DOC_ID, BIB)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Dev harness — the dev backend's only I/O is `fetch`.
// ---------------------------------------------------------------------------

const devDisk = new Map<string, string>();

interface FakeResponse {
  ok: boolean;
  headers?: { get: (k: string) => string | null };
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }): Promise<FakeResponse> => {
      const name = String(url).split("/").pop() ?? "";
      if (init?.method === "PUT") {
        note("write", name, "start");
        await slow();
        devDisk.set(String(url), init.body ?? "");
        note("write", name, "end");
        return { ok: true, text: async () => "", json: async () => ({}) };
      }
      if (init?.method === "HEAD") {
        const known = devDisk.has(String(url));
        return { ok: known, headers: { get: () => null }, text: async () => "", json: async () => ({}) };
      }
      // Only the `.bib` read is a merge base; the `.tex` read resolves a name.
      if (name.endsWith(".bib")) note("read", name, "start");
      await slow();
      if (name.endsWith(".bib")) note("read", name, "end");
      const body = devDisk.get(String(url));
      if (body === undefined) return { ok: false, text: async () => "", json: async () => ({}) };
      return { ok: true, text: async () => body, json: async () => JSON.parse(body) };
    }),
  );
}

const devBibKey = () => [...devDisk.keys()].find((k) => k.endsWith(".bib"));
const devDiskText = (): string => (devBibKey() ? devDisk.get(devBibKey()!)! : "");
const devBibName = () => devBibKey()?.split("/").pop() ?? BIB;

describe("storage-dev mutateBib: the same contract, the same place", () => {
  beforeEach(() => {
    devDisk.clear();
    journal = [];
    resetPipelines();
    __resetDiskLedgerForTests();
    installFetch();
    devDisk.set(`/api/dev/doc/${DOC_ID}/${BIB}`, A);
  });

  it("DEFECT: two overlapping mutations BOTH land", async () => {
    const h = beginDocPipeline(DOC_ID);
    await Promise.all([devMutateBib(h, append(B)), devMutateBib(h, append(X))]);
    expect(keysIn(devDiskText()).sort()).toEqual(["a", "b", "x"]);
  });

  it("no base read interleaves with another mutation's read→write pair", async () => {
    // The retired dev `writeBib` PUT straight through with no queue at all —
    // two bib writers raced here in a way they never could under FSA.
    const h = beginDocPipeline(DOC_ID);
    await Promise.all([B, X, "@book{y,\n  title = {Y},\n}\n"].map((blk) => devMutateBib(h, append(blk))));
    assertSerialized(devBibName());
    expect(keysIn(devDiskText())).toHaveLength(4);
  });

  it("DEFECT: an entry written behind the app's back survives the next mutation", async () => {
    const h = beginDocPipeline(DOC_ID);
    await devMutateBib(h, append(B));
    devDisk.set(devBibKey()!, A + B + X); // the skill
    const out = await devMutateBib(h, append("@book{z,\n  title = {Z},\n}\n"));
    expect(keysIn(out!)).toEqual(["a", "b", "x", "z"]);
    expect(keysIn(devDiskText())).toEqual(["a", "b", "x", "z"]);
  });

  it("a declined mutation writes nothing and resolves null", async () => {
    const h = beginDocPipeline(DOC_ID);
    expect(await devMutateBib(h, () => null)).toBeNull();
    expect(journal.some((e) => e.op === "write")).toBe(false);
    expect(devDiskText()).toBe(A);
  });
});
