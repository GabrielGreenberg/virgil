// @vitest-environment jsdom
//
// Unit coverage for the bundled example-document seeder. The OPFS path is
// structurally unreachable in the Claude-preview iframe (dev backend) and
// can't run in jsdom, so these tests are the primary safety net: they drive
// `ensureExampleSeeded` / `resetExample` against an in-memory OPFS fake +
// a mocked manifest fetch, pinning the idempotency / heal / no-clobber /
// reset behaviors. A node-fs assertion also checks the bundle GENERATOR lists
// every sample file (the built public/ artifact is only advisory).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Shared mutable mock state (hoisted so the vi.mock factory sees it) ──────
const mockState = vi.hoisted(() => ({
  index: { docs: [] as Array<Record<string, unknown>> },
  handles: new Map<string, unknown>(),
  // The one origin IndexedDB kv store, in memory — so the REAL `purgeDoc`
  // (and the real mirror / local-sidecar modules) run against it.
  idb: new Map<string, unknown>(),
}));

vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (k: string) => mockState.idb.get(k),
  set: async (k: string, v: unknown) => void mockState.idb.set(k, v),
  del: async (k: string) => void mockState.idb.delete(k),
  keys: async () => [...mockState.idb.keys()],
  update: async (k: string, fn: (v: unknown) => unknown) =>
    void mockState.idb.set(k, fn(mockState.idb.get(k))),
}));

// Defuse the `@/lib/storage` barrel (top-level require of storage-fsa breaks
// vitest resolution; documented gotcha) and supply the one symbol the seeder
// uses from it.
vi.mock("@/lib/storage", () => ({
  isDevStorage: false,
  drainDoc: vi.fn(async () => {}),
}));
vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));
vi.mock("@/lib/doc-index", () => ({
  readIndex: vi.fn(async () => mockState.index),
  mutateIndex: vi.fn(
    async (fn: (idx: typeof mockState.index) => unknown) => fn(mockState.index),
  ),
  setDocHandle: vi.fn(async (id: string, h: unknown) => {
    mockState.handles.set(id, h);
  }),
  getDocHandle: vi.fn(async (id: string) => mockState.handles.get(id)),
  purgeDoc: vi.fn(async (id: string, mode?: "remove" | "reset") => {
    mockState.handles.delete(id);
    const actual =
      await vi.importActual<typeof import("@/lib/doc-index")>("@/lib/doc-index");
    await actual.purgeDoc(id, mode);
  }),
}));

import {
  ensureExampleSeeded,
  resetExample,
  EXAMPLE_DOC_ID,
  EXAMPLE_FOLDER_NAME,
  EXAMPLE_TEX_FILENAME,
} from "../example-seeder";
import {
  readMirror,
  writeMirror,
  type EmergencyMirrorEntry,
} from "@/lib/emergency-mirror";
import {
  getRecoveryOffer,
  offerMirrorRecovery,
} from "@/lib/mirror-recovery";
import { readLocalSidecar, writeLocalSidecar } from "@/lib/local-sidecar";
import {
  DOC_ID as BUNDLE_DOC_ID,
  FOLDER_NAME as BUNDLE_FOLDER_NAME,
  TEX_FILENAME as BUNDLE_TEX_FILENAME,
  SKIP_NAMES,
  listSampleFiles,
  outDir as bundleOutDir,
} from "../../../../scripts/build-example-bundle.mjs";
import { LOCAL_SIDECAR_FILENAMES } from "@/lib/sidecar-value";

// ── In-memory OPFS fake ─────────────────────────────────────────────────────
type Payload = string | Uint8Array;

class FakeWritable {
  private buf: Payload = "";
  constructor(private readonly onClose: (d: Payload) => void) {}
  async write(chunk: unknown): Promise<void> {
    if (typeof chunk === "string") this.buf = chunk;
    else if (chunk instanceof Uint8Array) this.buf = chunk;
    else if (chunk instanceof ArrayBuffer) this.buf = new Uint8Array(chunk);
    else this.buf = String(chunk);
  }
  async close(): Promise<void> {
    this.onClose(this.buf);
  }
}

class FakeDir {
  readonly kind = "directory" as const;
  files = new Map<string, { data: Payload }>();
  dirs = new Map<string, FakeDir>();
  constructor(public readonly name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDir(name);
      this.dirs.set(name, d);
    }
    return d;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new DOMException(`no file ${name}`, "NotFoundError");
      f = { data: "" };
      this.files.set(name, f);
    }
    const file = f;
    return {
      kind: "file" as const,
      name,
      getFile: async () => ({
        text: async () =>
          typeof file.data === "string"
            ? file.data
            : new TextDecoder().decode(file.data),
        arrayBuffer: async () =>
          typeof file.data === "string"
            ? new TextEncoder().encode(file.data).buffer
            : file.data.buffer,
      }),
      createWritable: async () =>
        new FakeWritable((d) => {
          file.data = d;
        }),
    };
  }
  async removeEntry(name: string, opts?: { recursive?: boolean }) {
    const d = this.dirs.get(name);
    if (d) {
      // Match the real FSA API: a non-empty directory needs { recursive: true }.
      if ((d.files.size > 0 || d.dirs.size > 0) && !opts?.recursive) {
        throw new DOMException(`${name} not empty`, "InvalidModificationError");
      }
      this.dirs.delete(name);
      return;
    }
    if (this.files.delete(name)) return;
    throw new DOMException(`no entry ${name}`, "NotFoundError");
  }
  async *values() {
    for (const [name] of this.files) yield { kind: "file", name };
    for (const [name] of this.dirs) yield { kind: "directory", name };
  }
}

let opfsRoot: FakeDir;

async function exampleDir(): Promise<FakeDir> {
  const docs = await opfsRoot.getDirectoryHandle("virgil-docs");
  return docs.getDirectoryHandle(EXAMPLE_FOLDER_NAME);
}

async function readFile(relPath: string): Promise<string | null> {
  try {
    let dir = await exampleDir();
    const segs = relPath.split("/");
    const fn = segs.pop()!;
    for (const s of segs) dir = await dir.getDirectoryHandle(s);
    const fh = await dir.getFileHandle(fn);
    return await (await fh.getFile()).text();
  } catch {
    return null;
  }
}

async function writeFile(relPath: string, text: string): Promise<void> {
  let dir = await exampleDir();
  const segs = relPath.split("/");
  const fn = segs.pop()!;
  for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
  const fh = await dir.getFileHandle(fn, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

async function readMarker(): Promise<string | null> {
  const raw = await readFile("virgil/.example-seed.json");
  return raw ? (JSON.parse(raw) as { seedVersion?: string }).seedVersion ?? null : null;
}

// ── Mocked manifest + asset fetch ───────────────────────────────────────────
const PRISTINE_TEX = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";
const bundle = new Map<string, { text?: string; bytes?: Uint8Array }>();

function setBundle(seedVersion: string) {
  bundle.clear();
  const files = [
    { path: "document.tex", encoding: "utf8" },
    { path: "figures/a.png", encoding: "binary" },
    { path: "virgil/notes.json", encoding: "utf8" },
  ];
  bundle.set("manifest.json", {
    text: JSON.stringify({
      seedVersion,
      docId: EXAMPLE_DOC_ID,
      folderName: EXAMPLE_FOLDER_NAME,
      texFilename: "document.tex",
      files,
    }),
  });
  bundle.set("document.tex", { text: PRISTINE_TEX });
  bundle.set("figures/a.png", { bytes: new Uint8Array([1, 2, 3, 4]) });
  bundle.set("virgil/notes.json", { text: '{"notes":[]}' });
}

const fetchMock = vi.fn(async (url: string) => {
  const m = url.match(/\/examples\/example0\/(.+)$/);
  const entry = m ? bundle.get(m[1]) : undefined;
  if (!entry) return { ok: false, status: 404 } as unknown as Response;
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(entry.text!),
    text: async () => entry.text!,
    arrayBuffer: async () =>
      entry.bytes ? entry.bytes.buffer : new TextEncoder().encode(entry.text!).buffer,
  } as unknown as Response;
});

beforeEach(() => {
  opfsRoot = new FakeDir("root");
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: { getDirectory: async () => opfsRoot },
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  setBundle("v1");
  mockState.index.docs = [];
  mockState.handles.clear();
  mockState.idb.clear();
});

function fetchedPaths(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

describe("ensureExampleSeeded", () => {
  it("cold start: writes the tree, marker, index row, and handle", async () => {
    const meta = await ensureExampleSeeded();
    expect(meta.id).toBe(EXAMPLE_DOC_ID);
    expect(meta.texFilename).toBe("document.tex");
    expect(await readFile("document.tex")).toBe(PRISTINE_TEX);
    expect(await readFile("virgil/notes.json")).toBe('{"notes":[]}');
    expect(await readMarker()).toBe("v1");
    expect(mockState.index.docs).toHaveLength(1);
    expect(mockState.handles.get(EXAMPLE_DOC_ID)).toBeTruthy();
  });

  it("warm no-op: re-seed is idempotent (no body re-fetch, no dup row)", async () => {
    await ensureExampleSeeded();
    fetchMock.mockClear();
    await ensureExampleSeeded();
    expect(fetchedPaths().some((u) => u.includes("manifest.json"))).toBe(true);
    expect(fetchedPaths().some((u) => u.includes("document.tex"))).toBe(false);
    expect(mockState.index.docs).toHaveLength(1);
  });

  it("IndexedDB cleared, OPFS intact: re-adds row + handle, never clobbers files", async () => {
    await ensureExampleSeeded();
    await writeFile("document.tex", "USER EDIT");
    mockState.index.docs = [];
    mockState.handles.clear();
    fetchMock.mockClear();

    await ensureExampleSeeded();
    expect(mockState.index.docs).toHaveLength(1);
    expect(mockState.handles.get(EXAMPLE_DOC_ID)).toBeTruthy();
    expect(await readFile("document.tex")).toBe("USER EDIT");
    expect(fetchedPaths().some((u) => u.includes("document.tex"))).toBe(false);
  });

  it("OPFS cleared, index intact: re-seeds files without duplicating the row", async () => {
    await ensureExampleSeeded();
    const docs = await opfsRoot.getDirectoryHandle("virgil-docs");
    await docs.removeEntry(EXAMPLE_FOLDER_NAME, { recursive: true });
    fetchMock.mockClear();

    await ensureExampleSeeded();
    expect(await readFile("document.tex")).toBe(PRISTINE_TEX);
    expect(await readMarker()).toBe("v1");
    expect(mockState.index.docs).toHaveLength(1);
  });

  it("stale seedVersion: adopts the new marker but preserves user edits", async () => {
    await ensureExampleSeeded();
    await writeFile("document.tex", "USER EDIT");
    setBundle("v2");
    fetchMock.mockClear();

    await ensureExampleSeeded();
    expect(await readMarker()).toBe("v2");
    expect(await readFile("document.tex")).toBe("USER EDIT");
    expect(fetchedPaths().some((u) => u.includes("document.tex"))).toBe(false);
  });
});

describe("resetExample", () => {
  it("wipes user edits and restores pristine content under the same id", async () => {
    await ensureExampleSeeded();
    await writeFile("document.tex", "USER EDIT");

    const meta = await resetExample();
    expect(meta.id).toBe(EXAMPLE_DOC_ID);
    expect(await readFile("document.tex")).toBe(PRISTINE_TEX);
    expect(await readMarker()).toBe("v1");
    expect(mockState.index.docs).toHaveLength(1);
  });

  // Task 604 — the example's id is FIXED, so docId-keyed state that survives
  // the reset is read back by the pristine re-seed as its own. A surviving
  // mirror differs from the pristine model and raises "restore unsaved work"
  // — offering to undo the reset the user just confirmed.
  it("retires the id's durable state: mirror, recovery offer, local sidecars", async () => {
    await ensureExampleSeeded();
    const entry: EmergencyMirrorEntry = {
      docId: EXAMPLE_DOC_ID,
      content: { type: "doc", content: [] },
      savedAt: Date.now(),
      lastLandedAt: null,
      reason: null,
      windowId: "w1",
      hash: "pre-reset-edits",
    };
    await writeMirror(entry);
    offerMirrorRecovery(entry);
    expect(LOCAL_SIDECAR_FILENAMES.length).toBeGreaterThan(0);
    for (const f of LOCAL_SIDECAR_FILENAMES) {
      await writeLocalSidecar(EXAMPLE_DOC_ID, f, { stale: true });
    }
    expect(await readMirror(EXAMPLE_DOC_ID)).not.toBeNull();

    await resetExample();

    expect(await readMirror(EXAMPLE_DOC_ID)).toBeNull();
    expect(getRecoveryOffer(EXAMPLE_DOC_ID)).toBeNull();
    for (const f of LOCAL_SIDECAR_FILENAMES) {
      expect(await readLocalSidecar(EXAMPLE_DOC_ID, f)).toBeNull();
    }
    // The re-seed still landed its handle (purge ran BEFORE the seed).
    expect(mockState.handles.get(EXAMPLE_DOC_ID)).toBeTruthy();
  });
});

// Task 1461 — the in-flight slot and the no-marker heal.
describe("seed/reset concurrency + unreadable marker", () => {
  /** Hold every asset fetch (not the manifest) until released. */
  function gateAssetFetches() {
    const baseImpl = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.includes("manifest.json")) await gate;
      const m = url.match(/\/examples\/example0\/(.+)$/);
      const entry = m ? bundle.get(m[1]) : undefined;
      if (!entry) return { ok: false, status: 404 } as unknown as Response;
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(entry.text!),
        text: async () => entry.text!,
        arrayBuffer: async () =>
          entry.bytes ? entry.bytes.buffer : new TextEncoder().encode(entry.text!).buffer,
      } as unknown as Response;
    });
    return () => {
      release();
      fetchMock.mockImplementation(baseImpl);
    };
  }

  it("reset during a slow seed: the seed settles BEFORE the wipe; one pristine tree after", async () => {
    const order: string[] = [];
    const { purgeDoc } = await import("@/lib/doc-index");
    const { setDocHandle } = await import("@/lib/doc-index");
    vi.mocked(setDocHandle).mockImplementation(async (id, h) => {
      order.push("setDocHandle");
      mockState.handles.set(id, h);
    });
    vi.mocked(purgeDoc).mockImplementationOnce(async (id) => {
      order.push("purge");
      mockState.handles.delete(id);
    });
    const release = gateAssetFetches();

    const seed = ensureExampleSeeded();
    await new Promise((r) => setTimeout(r, 0));
    const reset = resetExample();
    // An open during the reset joins the reset, not a parallel seed.
    const open = ensureExampleSeeded();
    release();
    const [a, b, c] = await Promise.all([seed, reset, open]);
    expect([a.id, b.id, c.id]).toEqual([EXAMPLE_DOC_ID, EXAMPLE_DOC_ID, EXAMPLE_DOC_ID]);
    // The orphan's handle push landed BEFORE the purge; only the reset's after.
    expect(order).toEqual(["setDocHandle", "purge", "setDocHandle"]);
    expect(mockState.handles.get(EXAMPLE_DOC_ID)).toBeTruthy();
    expect(mockState.index.docs).toHaveLength(1);
    expect(await readFile("document.tex")).toBe(PRISTINE_TEX);
    vi.mocked(setDocHandle).mockImplementation(async (id, h) => {
      mockState.handles.set(id, h);
    });
  });

  it("a superseded seed settling does not clear its successor's slot", async () => {
    const release = gateAssetFetches();
    const seed = ensureExampleSeeded();
    await new Promise((r) => setTimeout(r, 0));
    const reset = resetExample();
    release();
    await seed;
    // The reset is still in the slot: a fresh open joins it (no third seed
    // pass — the old identity-blind finally let this one start beside it).
    const open = ensureExampleSeeded();
    await Promise.all([reset, open]);
    const manifests = fetchedPaths().filter((u) => u.includes("manifest.json"));
    expect(manifests).toHaveLength(2);
  });

  it("unreadable marker over an edited sandbox: keeps the edits, fills only gaps", async () => {
    await ensureExampleSeeded();
    await writeFile("document.tex", "USER EDIT");
    await writeFile("virgil/.example-seed.json", "{not json");
    const dir = await exampleDir();
    dir.dirs.get("figures")!.files.delete("a.png");
    fetchMock.mockClear();

    await ensureExampleSeeded();
    expect(await readFile("document.tex")).toBe("USER EDIT");
    expect(await readFile("figures/a.png")).not.toBeNull();
    expect(fetchedPaths().some((u) => u.includes("document.tex"))).toBe(false);
    expect(await readMarker()).toBe("v1");
  });

  it("absent marker over existing files (failed marker write): no overwrite", async () => {
    await ensureExampleSeeded();
    await writeFile("document.tex", "USER EDIT");
    const dir = await exampleDir();
    dir.dirs.get("virgil")!.files.delete(".example-seed.json");

    await ensureExampleSeeded();
    expect(await readFile("document.tex")).toBe("USER EDIT");
    expect(await readMarker()).toBe("v1");
  });
});

// ── Bundle-generator fidelity (node fs) ─────────────────────────────────────
// The assertion is about the GENERATOR (scripts/build-example-bundle.mjs), not
// its gitignored public/ output: that artifact is stale between builds by
// design and every reader reaches it through predev/prebuild, which regenerate
// it — so a stale artifact is ADVISORY (a console note), never a failure
// (task 1384; the LOUD-vs-ADVISORY doctrine of skill-bundle-freshness.test.ts).
describe("example bundle generator", () => {
  const sampleDir = join(process.cwd(), "samples/annotation-history");

  /** Independent oracle: every file on disk, minus the generator's own
   *  SKIP_NAMES (one list — what ships is policy, the walk is the check). */
  function walk(dir: string, prefix: string, out: string[]) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_NAMES.has(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel, out);
      else if (e.isFile()) out.push(rel);
    }
  }

  it("lists every file in samples/annotation-history (and nothing else)", async () => {
    const listed = await listSampleFiles();
    const inSource: string[] = [];
    walk(sampleDir, "", inSource);
    expect([...listed].sort()).toEqual(inSource.sort());
    expect(listed).toContain(EXAMPLE_TEX_FILENAME);
  });

  it("uses the seeder's identity constants", () => {
    expect(BUNDLE_DOC_ID).toBe(EXAMPLE_DOC_ID);
    expect(BUNDLE_FOLDER_NAME).toBe(EXAMPLE_FOLDER_NAME);
    expect(BUNDLE_TEX_FILENAME).toBe(EXAMPLE_TEX_FILENAME);
  });

  // ADVISORY, surfaced as a named skip (the skill-bundle-freshness pattern):
  // a stale or absent artifact is not checked and did not fail.
  it("the built public/ artifact matches the generator (advisory)", async (ctx) => {
    const manifestPath = join(bundleOutDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      ctx.skip("[example-bundle] ADVISORY: public/examples not built in this checkout.");
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files: { path: string }[];
    };
    const built = manifest.files.map((f) => f.path).sort().join("\n");
    const fresh = [...(await listSampleFiles())].sort().join("\n");
    if (built !== fresh) {
      ctx.skip(
        "[example-bundle] ADVISORY: public/examples manifest is stale vs the sample; " +
          "predev/prebuild regenerate it (or run `npm run build:example-bundle`).",
      );
    }
  });
});
