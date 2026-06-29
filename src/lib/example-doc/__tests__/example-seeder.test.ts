// @vitest-environment jsdom
//
// Unit coverage for the bundled example-document seeder. The OPFS path is
// structurally unreachable in the Claude-preview iframe (dev backend) and
// can't run in jsdom, so these tests are the primary safety net: they drive
// `ensureExampleSeeded` / `resetExample` against an in-memory OPFS fake +
// a mocked manifest fetch, pinning the idempotency / heal / no-clobber /
// reset behaviors. A node-fs assertion also checks the GENERATED bundle
// manifest lists every sample file (skipped when the artifact isn't built).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ── Shared mutable mock state (hoisted so the vi.mock factory sees it) ──────
const mockState = vi.hoisted(() => ({
  index: { docs: [] as Array<Record<string, unknown>> },
  handles: new Map<string, unknown>(),
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
  writeIndex: vi.fn(async (idx: typeof mockState.index) => {
    mockState.index.docs = idx.docs;
  }),
  setDocHandle: vi.fn(async (id: string, h: unknown) => {
    mockState.handles.set(id, h);
  }),
  getDocHandle: vi.fn(async (id: string) => mockState.handles.get(id)),
  purgeDoc: vi.fn(async (id: string) => {
    mockState.handles.delete(id);
  }),
}));

import {
  ensureExampleSeeded,
  resetExample,
  EXAMPLE_DOC_ID,
  EXAMPLE_FOLDER_NAME,
} from "../example-seeder";

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
});

// ── Generated-bundle fidelity (node fs; skipped when not built) ─────────────
describe("example bundle manifest", () => {
  const manifestPath = join(process.cwd(), "public/examples/example0/manifest.json");
  const sampleDir = join(process.cwd(), "samples/annotation-history");
  const SKIP = new Set([".DS_Store", ".example-seed.json", ".history"]);

  function walk(dir: string, prefix: string, out: string[]) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel, out);
      else if (e.isFile()) out.push(rel);
    }
  }

  it.skipIf(!existsSync(manifestPath))(
    "lists every file in samples/annotation-history",
    () => {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        files: { path: string }[];
      };
      const inManifest = new Set(manifest.files.map((f) => f.path));
      const inSource: string[] = [];
      walk(sampleDir, "", inSource);
      for (const rel of inSource) expect(inManifest.has(rel)).toBe(true);
      expect(inManifest.size).toBe(inSource.length);
    },
  );
});
