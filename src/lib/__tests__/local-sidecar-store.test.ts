// @vitest-environment jsdom
//
// **The local sidecar store** — task 417 (decision 2).
//
// > **Per-MACHINE state does not live in the synced folder.** A sidecar whose
// > contents two machines legitimately disagree about (where THIS window is
// > scrolled to) is declared `store: "local"` on `sidecar-value.ts` and lives in
// > this browser's IndexedDB. The FOUR sidecar doors in BOTH backends route on
// > that declaration, so no writer anywhere can put such a file on disk — the
// > hook that owns it does not even know where its bytes went.
//
// Tasks 363 / 411 / 415 each lowered the RATE at which Virgil wrote the synced
// folder. This is the other lever: `editor-state.json` was the loudest fork
// base in the measured folder (102 of 197) and holds nothing a second machine
// wants, so its write rate is not the problem — its ADDRESS is. Post-417 its
// write rate into the folder is zero by construction.
//
// ── WHY THIS SUITE EXISTS ──────────────────────────────────────────────────
//
// Every pre-417 sidecar suite asserts what a write PUT ON DISK. A routing that
// silently kept a local-store file on disk would pass all of them. The legs
// here ask the complement — that the disk was NOT touched — plus the three
// things a relocation owes: a one-time migration from the file a pre-417 build
// wrote, a conflict scanner that still recognises that file's historical forks
// as debris, and a census that the backends stopped expecting it.
//
// The FSA fake is the one `per-file-write-gate` established (a real write
// journal); the IndexedDB fake is the one `tex-assets` established.

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./_source-scan";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

// ---------------------------------------------------------------------------
// In-memory idb-keyval.
// ---------------------------------------------------------------------------
const stores = new Map<symbol, Map<string, unknown>>();
function backing(token: symbol): Map<string, unknown> {
  let m = stores.get(token);
  if (!m) {
    m = new Map();
    stores.set(token, m);
  }
  return m;
}
vi.mock("idb-keyval", () => ({
  createStore: (_db: string, _name: string) => Symbol("store"),
  get: async (key: string, token: symbol) => backing(token).get(key),
  set: async (key: string, value: unknown, token: symbol) => {
    backing(token).set(key, value);
  },
  del: async (key: string, token: symbol) => {
    backing(token).delete(key);
  },
  keys: async (token: symbol) => [...backing(token).keys()],
}));
function idbEntries(): Map<string, unknown> {
  const all = new Map<string, unknown>();
  for (const m of stores.values()) for (const [k, v] of m) all.set(k, v);
  return all;
}

// ---------------------------------------------------------------------------
// A fake FSA disk with a write journal.
// ---------------------------------------------------------------------------
const DOC_ID = "localdoc";
const TEX = "main.tex";
let writes: string[] = [];
let clock = 1_000;

class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, { text: string; mtimeMs: number }>();
  dirs = new Map<string, FakeDirHandle>();
  constructor(
    public readonly name: string,
    private readonly path = "",
  ) {}
  private child(n: string): string {
    return this.path ? `${this.path}/${n}` : n;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDirHandle(name, this.child(name));
      this.dirs.set(name, d);
    }
    return d;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new DOMException(`no file ${name}`, "NotFoundError");
      f = { text: "", mtimeMs: ++clock };
      this.files.set(name, f);
    }
    const file = f;
    const rel = this.child(name);
    return {
      kind: "file",
      name,
      getFile: async () =>
        ({
          size: new TextEncoder().encode(file.text).length,
          lastModified: file.mtimeMs,
          text: async () => file.text,
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
              typeof buf === "string" ? buf : new TextDecoder().decode(buf as ArrayBuffer);
            file.mtimeMs = ++clock;
            writes.push(rel);
          },
        } as unknown as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle;
  }
  async removeEntry(name: string) {
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
  name: "Local",
  texFilename: TEX,
  folderName: "local",
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

import {
  SIDECAR_VALUE,
  ALL_VIRGIL_SIDECAR_FILENAMES,
  LOCAL_SIDECAR_FILENAMES,
  MOUNT_SIDECAR_FILENAMES,
  sidecarStore,
  sidecarTier,
} from "@/lib/sidecar-value";
import {
  isLocalSidecar,
  localSidecarKey,
  readLocalSidecar,
  writeLocalSidecar,
  mutateLocalSidecar,
} from "@/lib/local-sidecar";
import {
  readSidecar,
  readSidecarIfExists,
  writeSidecar,
  mutateSidecar,
  invalidateSidecarBundle,
} from "@/lib/storage-fsa";
import { __resetDiskLedgerForTests } from "@/lib/disk-ledger";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { scanSidecarSiblings } from "@/lib/sync-conflict";
import { planSidecarCleanup } from "@/lib/sync-conflict-cleanup";

const FILE = "editor-state.json";
const state = (scrollTop: number) => ({
  lastParagraphId: "p1",
  foldedSections: [],
  scrollTop,
  lastModified: "2026-08-22T00:00:00.000Z",
});

function seed(diskState?: unknown): void {
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, { text: "\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n", mtimeMs: ++clock });
  const virgil = new FakeDirHandle("virgil", "virgil");
  if (diskState !== undefined) {
    virgil.files.set(FILE, { text: JSON.stringify(diskState), mtimeMs: ++clock });
  }
  docHandle.dirs.set("virgil", virgil);
}

beforeEach(() => {
  writes = [];
  stores.clear();
  resetPipelines();
  __resetDiskLedgerForTests();
  invalidateSidecarBundle(DOC_ID);
  seed();
});

// ---------------------------------------------------------------------------
// 1. The DECLARATION.
// ---------------------------------------------------------------------------

describe("sidecar value SSOT — the store column", () => {
  it("is TOTAL: every declared file states where it lives", () => {
    for (const f of ALL_VIRGIL_SIDECAR_FILENAMES) {
      expect(["disk", "local"], f).toContain(SIDECAR_VALUE[f]!.store);
    }
  });

  it("a local-store file is NEVER mount-bundled — a directory read cannot see IndexedDB", () => {
    expect(LOCAL_SIDECAR_FILENAMES.length).toBeGreaterThan(0);
    for (const f of LOCAL_SIDECAR_FILENAMES) {
      expect(SIDECAR_VALUE[f]!.mount, f).toBe(false);
      expect(MOUNT_SIDECAR_FILENAMES).not.toContain(f);
    }
  });

  it("LOCAL_SIDECAR_FILENAMES is DERIVED from the column", () => {
    expect([...LOCAL_SIDECAR_FILENAMES]).toEqual(
      ALL_VIRGIL_SIDECAR_FILENAMES.filter((f) => SIDECAR_VALUE[f]!.store === "local"),
    );
  });

  it("DECIDED (Gabriel, 2026-08-22): editor-state local; focus + collab stay on disk", () => {
    // Per-machine scroll/caret/fold state → local.
    expect(sidecarStore("editor-state.json")).toBe("local");
    // A focus band is an AUTHORING choice he wants waiting on the other
    // machine — view tier, but disk.
    expect(sidecarTier("focus.json")).toBe("view");
    expect(sidecarStore("focus.json")).toBe("disk");
    // collab.json IS collaborator mode's cross-machine transport: a partner's
    // tab polls it THROUGH the synced folder. Local would delete the feature.
    expect(sidecarStore("collab.json")).toBe("disk");
  });

  it("local ⇒ view: nothing content-tier may leave the folder the skills read", () => {
    for (const f of LOCAL_SIDECAR_FILENAMES) expect(sidecarTier(f), f).toBe("view");
  });

  it("FAILS CLOSED to disk for an undeclared file", () => {
    expect(sidecarStore("not-a-sidecar.json")).toBe("disk");
    expect(isLocalSidecar("not-a-sidecar.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The LEAF.
// ---------------------------------------------------------------------------

describe("local-sidecar leaf", () => {
  it("round-trips a value keyed by (doc, filename)", async () => {
    await writeLocalSidecar("d1", FILE, state(10));
    expect(await readLocalSidecar("d1", FILE)).toEqual(state(10));
    expect(await readLocalSidecar("d2", FILE)).toBeNull();
    expect(idbEntries().has(localSidecarKey("d1", FILE))).toBe(true);
  });

  it("MIGRATES once: a local miss reads the disk source, copies it in, and never asks again", async () => {
    const migrate = vi.fn(async () => state(42));
    expect(await readLocalSidecar("d1", FILE, migrate)).toEqual(state(42));
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(await readLocalSidecar("d1", FILE, migrate)).toEqual(state(42));
    expect(migrate, "the disk was asked again after the copy landed").toHaveBeenCalledTimes(1);
  });

  it("a migration source with NOTHING leaves the slot empty (no tombstone, no throw)", async () => {
    expect(await readLocalSidecar("d1", FILE, async () => null)).toBeNull();
    expect(idbEntries().size).toBe(0);
  });

  it("a THROWING migration source fails open to null", async () => {
    expect(
      await readLocalSidecar("d1", FILE, async () => {
        throw new Error("permission");
      }),
    ).toBeNull();
  });

  it("a local write that lands DURING the disk read is never overwritten by the seed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const migrate = async () => {
      await gate;
      return state(1);
    };
    const read = readLocalSidecar("d1", FILE, migrate);
    await writeLocalSidecar("d1", FILE, state(99));
    release();
    expect(await read).toEqual(state(99));
    expect(await readLocalSidecar("d1", FILE)).toEqual(state(99));
  });

  it("mutate: null means nothing to change; otherwise the new value lands", async () => {
    await writeLocalSidecar("d1", FILE, state(1));
    expect(await mutateLocalSidecar("d1", FILE, state(0), () => null)).toBeNull();
    expect(await readLocalSidecar("d1", FILE)).toEqual(state(1));
    expect(
      await mutateLocalSidecar("d1", FILE, state(0), (c) => ({ ...c, scrollTop: 5 })),
    ).toEqual(state(5));
    expect(await readLocalSidecar("d1", FILE)).toEqual(state(5));
  });

  it("mutate on an EMPTY slot takes the migration seed, then the default", async () => {
    expect(
      await mutateLocalSidecar("d1", FILE, state(0), (c) => c, async () => state(7)),
    ).toEqual(state(7));
    expect(await mutateLocalSidecar("d2", FILE, state(0), (c) => c)).toEqual(state(0));
  });
});

// ---------------------------------------------------------------------------
// 3. The DOORS (FSA backend, real exports, fake disk).
// ---------------------------------------------------------------------------

describe("storage-fsa doors route a local-store file OFF the disk", () => {
  it("writeSidecar(editor-state.json) touches no file — zero createWritable", async () => {
    const h = beginDocPipeline(DOC_ID);
    for (let i = 0; i < 5; i++) await writeSidecar(h, FILE, state(i));
    expect(writes, "a local-store write reached the synced folder").toEqual([]);
    expect(docHandle.dirs.get("virgil")!.files.has(FILE)).toBe(false);
    expect(await readSidecarIfExists(DOC_ID, FILE)).toEqual(state(4));
  });

  it("…while a DISK-store file still writes through the funnel (control)", async () => {
    const h = beginDocPipeline(DOC_ID);
    await writeSidecar(h, "notes.json", { notes: [] });
    expect(writes).toEqual(["virgil/notes.json"]);
  });

  it("readSidecarIfExists MIGRATES the file a pre-417 build wrote, once, and does not delete it", async () => {
    seed(state(33));
    expect(await readSidecarIfExists(DOC_ID, FILE)).toEqual(state(33));
    // The local copy now exists; the disk original is left alone (a delete is
    // itself sync traffic, and the badge's cleanup already drains view forks).
    expect(idbEntries().has(localSidecarKey(DOC_ID, FILE))).toBe(true);
    expect(docHandle.dirs.get("virgil")!.files.has(FILE)).toBe(true);
    expect(writes).toEqual([]);
    // Mutate the disk file afterwards: the LOCAL copy is authoritative now.
    docHandle.dirs.get("virgil")!.files.get(FILE)!.text = JSON.stringify(state(1000));
    expect(await readSidecarIfExists(DOC_ID, FILE)).toEqual(state(33));
  });

  it("readSidecar takes the default on a doc with neither a local nor a disk copy", async () => {
    expect(await readSidecar(DOC_ID, FILE, state(0))).toEqual(state(0));
  });

  it("mutateSidecar serializes locally and writes nothing to disk", async () => {
    const h = beginDocPipeline(DOC_ID);
    await writeSidecar(h, FILE, state(1));
    const out = await mutateSidecar(h, FILE, state(0), (c) => ({ ...c, scrollTop: c.scrollTop! + 1 }));
    expect(out).toEqual(state(2));
    expect(await mutateSidecar(h, FILE, state(0), () => null)).toBeNull();
    expect(writes).toEqual([]);
  });

  it("a read-only library-paper doc persists nothing, locally or on disk (parity)", async () => {
    const h = beginDocPipeline("library-paper:smith2020");
    await writeSidecar(h, FILE, state(1));
    expect(await mutateSidecar(h, FILE, state(0), (c) => c)).toBeNull();
    expect(idbEntries().size).toBe(0);
    expect(writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. The scanner still recognises the historical forks.
// ---------------------------------------------------------------------------

describe("conflict scanner — a relocated file's old forks stay recognisable debris", () => {
  it("editor-state (conflicted copy) is a VIEW fork and the cleanup plan sanctions it", () => {
    const names = [
      "notes.json",
      "editor-state (Gabriel's conflicted copy 2026-08-18).json",
      "editor-state (conflicted copy 2026-08-19).json",
    ];
    const report = scanSidecarSiblings(names);
    const group = report.groups.find((g) => g.base === "editor-state.json");
    expect(group, "the scanner no longer knows the base").toBeDefined();
    expect(group!.tier).toBe("view");
    expect(group!.siblings.length).toBe(2);
    const plan = planSidecarCleanup(names);
    expect(plan.map((s) => s.name).sort()).toEqual(
      [names[1], names[2]].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. CENSUS — the doors were never the part that could misbehave; a backend
//    site that still expects the file on disk is.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../../..");
const read = (rel: string) => codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"));

describe("census", () => {
  it.each(["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"])(
    "%s spells no local-store filename in CODE — it must not read, copy or snapshot it",
    (rel) => {
      const src = read(rel);
      for (const f of LOCAL_SIDECAR_FILENAMES) {
        expect(src, `${rel} still addresses ${f} by name`).not.toContain(`"${f}"`);
      }
    },
  );

  it.each(["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"])(
    "%s routes all FOUR sidecar doors through the declaration",
    (rel) => {
      const src = read(rel);
      const doors = ["readSidecar", "readSidecarIfExists", "writeSidecar", "mutateSidecar"];
      for (const door of doors) {
        const start = src.indexOf(`export async function ${door}<`);
        expect(start, `${door} missing in ${rel}`).toBeGreaterThan(-1);
        const next = src.indexOf("\nexport ", start + 1);
        const body = src.slice(start, next === -1 ? undefined : next);
        expect(body, `${rel}: ${door} does not ask isLocalSidecar`).toContain("isLocalSidecar(");
      }
    },
  );

  it("the hook that owns the file does NOT decide where it lives", () => {
    const src = read("src/hooks/useEditorUIState.ts");
    expect(src).not.toContain("local-sidecar");
    expect(src).not.toContain("idb-keyval");
  });

  it("readDocBundle no longer carries an editorState nobody consumed", () => {
    for (const rel of ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts", "src/lib/types.ts"]) {
      expect(read(rel)).not.toMatch(/editorState\s*:/);
    }
  });

  it("CANARY — the census needle fires on the pre-417 shape", () => {
    expect('await safeReadJson(virgil, "editor-state.json", D)').toContain('"editor-state.json"');
  });
});
