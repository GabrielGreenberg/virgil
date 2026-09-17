// @vitest-environment node
/**
 * The relocate contract (task 619): a Library MOVE never destroys a file.
 *
 *  - App half: the legacy `pdfs/` → `papers/` migration used to move only
 *    `*.pdf|*.docx` (and `unsorted/`), swallow per-file failures, then
 *    `removeEntry("pdfs", { recursive: true })` — taking every file it did not
 *    recognise, and every file whose copy threw, with it. `moveDir` did the
 *    same. Legs below drive `migrateLayoutIfNeeded` over an in-memory FSA.
 *  - Guardrail: no `removeEntry(…, { recursive: true })` anywhere under
 *    `library/` outside the allowlist.
 *  - Python half: `library/scripts/tests/test_safe_move.py` (triage parks keep
 *    same-named drops), which nothing else in `npm test` runs. FAILS rather
 *    than skips without `python3`.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  RelocateCollisionError,
  migrateLayoutIfNeeded,
  moveFile,
  removeDirIfEmpty,
} from "../library-storage";

// ── a minimal in-memory FSA ─────────────────────────────────────────────

class MemFile {
  readonly kind = "file" as const;
  constructor(
    readonly name: string,
    public data: string,
    readonly fs: { failWrite: Set<string>; refuseRemove: Set<string> },
  ) {}
  async getFile() {
    return new Blob([this.data]);
  }
  async createWritable() {
    const self = this;
    let buf = "";
    return {
      async write(d: Blob | string) {
        if (self.fs.failWrite.has(self.name)) throw new Error(`disk full: ${self.name}`);
        buf += typeof d === "string" ? d : await d.text();
      },
      async close() {
        self.data = buf;
      },
    };
  }
}

type Entry = MemFile | MemDir;

class MemDir {
  readonly kind = "directory" as const;
  readonly children = new Map<string, Entry>();
  constructor(
    readonly name: string,
    readonly fs: { failWrite: Set<string>; refuseRemove: Set<string> },
  ) {}
  private notFound(n: string): never {
    const e = new Error(`${n} not found`);
    e.name = "NotFoundError";
    throw e;
  }
  async getDirectoryHandle(n: string, opts?: { create?: boolean }) {
    const c = this.children.get(n);
    if (c?.kind === "directory") return c;
    if (c) throw new TypeError(`${n} is a file`);
    if (!opts?.create) this.notFound(n);
    const d = new MemDir(n, this.fs);
    this.children.set(n, d);
    return d;
  }
  async getFileHandle(n: string, opts?: { create?: boolean }) {
    const c = this.children.get(n);
    if (c?.kind === "file") return c;
    if (c) throw new TypeError(`${n} is a directory`);
    if (!opts?.create) this.notFound(n);
    const f = new MemFile(n, "", this.fs);
    this.children.set(n, f);
    return f;
  }
  async removeEntry(n: string, opts?: { recursive?: boolean }) {
    const c = this.children.get(n);
    if (!c) this.notFound(n);
    if (this.fs.refuseRemove.has(n)) throw new Error(`refused: ${n}`);
    if (c.kind === "directory" && c.children.size > 0 && !opts?.recursive) {
      const e = new Error(`${n} not empty`);
      e.name = "InvalidModificationError";
      throw e;
    }
    this.children.delete(n);
  }
  async *entries(): AsyncIterable<[string, Entry]> {
    for (const kv of [...this.children.entries()]) yield kv;
  }
}

function makeRoot() {
  const flags = { failWrite: new Set<string>(), refuseRemove: new Set<string>() };
  return { root: new MemDir("lib", flags), flags };
}

function put(dir: MemDir, rel: string, data = rel): void {
  const parts = rel.split("/");
  let cur = dir;
  for (const p of parts.slice(0, -1)) {
    let next = cur.children.get(p);
    if (!next) {
      next = new MemDir(p, cur.fs);
      cur.children.set(p, next);
    }
    cur = next as MemDir;
  }
  const name = parts[parts.length - 1];
  cur.children.set(name, new MemFile(name, data, cur.fs));
}

function read(dir: MemDir, rel: string): string | undefined {
  let cur: Entry | undefined = dir;
  for (const p of rel.split("/")) {
    if (!cur || cur.kind !== "directory") return undefined;
    cur = cur.children.get(p);
  }
  return cur?.kind === "file" ? cur.data : undefined;
}

function has(dir: MemDir, rel: string): boolean {
  let cur: Entry | undefined = dir;
  for (const p of rel.split("/")) {
    if (!cur || cur.kind !== "directory") return false;
    cur = cur.children.get(p);
  }
  return cur !== undefined;
}

const asRoot = (d: MemDir) => d as unknown as FileSystemDirectoryHandle;

// ── the migration ───────────────────────────────────────────────────────

describe("legacy pdfs/ migration never deletes what it did not move", () => {
  it("moves the recognised files and removes an emptied pdfs/", async () => {
    const { root } = makeRoot();
    put(root, "pdfs/smith2020.pdf", "S");
    put(root, "pdfs/unsorted/drop.pdf", "D");
    put(root, "pdfs/unsorted/_pending/held.pdf", "H");
    put(root, "pdfs/.DS_Store", "litter");
    await migrateLayoutIfNeeded(asRoot(root));
    expect(read(root, "papers/smith2020/smith2020.pdf")).toBe("S");
    expect(read(root, "unsorted/drop.pdf")).toBe("D");
    expect(read(root, "unsorted/_pending/held.pdf")).toBe("H");
    expect(has(root, "pdfs")).toBe(false);
  });

  it("keeps pdfs/ with every stray file and subfolder it does not recognise", async () => {
    const { root } = makeRoot();
    put(root, "pdfs/smith2020.pdf", "S");
    put(root, "pdfs/notes.txt", "my notes");
    put(root, "pdfs/book.epub", "epub");
    put(root, "pdfs/drafts/ch1.tex", "draft");
    put(root, "pdfs/unsorted/sub/keep.pdf", "nested");
    await migrateLayoutIfNeeded(asRoot(root));
    expect(read(root, "papers/smith2020/smith2020.pdf")).toBe("S");
    expect(read(root, "pdfs/notes.txt")).toBe("my notes");
    expect(read(root, "pdfs/book.epub")).toBe("epub");
    expect(read(root, "pdfs/drafts/ch1.tex")).toBe("draft");
    expect(read(root, "pdfs/unsorted/sub/keep.pdf")).toBe("nested");
  });

  it("keeps a file whose copy failed, and cleans the partial copy", async () => {
    const { root, flags } = makeRoot();
    put(root, "pdfs/jones2019.pdf", "J");
    flags.failWrite.add("jones2019.pdf");
    await migrateLayoutIfNeeded(asRoot(root));
    expect(read(root, "pdfs/jones2019.pdf")).toBe("J");
    expect(has(root, "papers/jones2019/jones2019.pdf")).toBe(false);
  });

  it("never overwrites a file already at the destination", async () => {
    const { root } = makeRoot();
    put(root, "pdfs/smith2020.pdf", "legacy");
    put(root, "papers/smith2020/smith2020.pdf", "current");
    put(root, "pdfs/unsorted/drop.pdf", "legacy drop");
    put(root, "unsorted/drop.pdf", "current drop");
    await migrateLayoutIfNeeded(asRoot(root));
    expect(read(root, "papers/smith2020/smith2020.pdf")).toBe("current");
    expect(read(root, "pdfs/smith2020.pdf")).toBe("legacy");
    expect(read(root, "unsorted/drop.pdf")).toBe("current drop");
    expect(read(root, "pdfs/unsorted/drop.pdf")).toBe("legacy drop");
  });

  it("root tidy keeps a dir child it could not move", async () => {
    const { root } = makeRoot();
    put(root, "queue/a.json", "new-a");
    put(root, "queue/b.json", "b");
    put(root, ".virgil/queue/a.json", "existing-a");
    await migrateLayoutIfNeeded(asRoot(root));
    expect(read(root, ".virgil/queue/a.json")).toBe("existing-a");
    expect(read(root, ".virgil/queue/b.json")).toBe("b");
    expect(read(root, "queue/a.json")).toBe("new-a");
  });
});

describe("relocate primitives", () => {
  it("moveFile refuses an occupied name", async () => {
    const { root } = makeRoot();
    put(root, "a/x.pdf", "1");
    put(root, "b/x.pdf", "2");
    const a = await root.getDirectoryHandle("a");
    const b = await root.getDirectoryHandle("b");
    await expect(
      moveFile(asRoot(a), "x.pdf", asRoot(b), "x.pdf"),
    ).rejects.toBeInstanceOf(RelocateCollisionError);
    expect(read(root, "a/x.pdf")).toBe("1");
    expect(read(root, "b/x.pdf")).toBe("2");
  });

  it("moveFile reports a refused source delete without losing either copy", async () => {
    const { root, flags } = makeRoot();
    put(root, "a/x.pdf", "1");
    const a = await root.getDirectoryHandle("a");
    const b = await root.getDirectoryHandle("b", { create: true });
    flags.refuseRemove.add("x.pdf");
    await expect(moveFile(asRoot(a), "x.pdf", asRoot(b), "x.pdf")).resolves.toBe(false);
    expect(read(root, "a/x.pdf")).toBe("1");
    expect(read(root, "b/x.pdf")).toBe("1");
  });

  it("removeDirIfEmpty removes only litter-only directories", async () => {
    const { root } = makeRoot();
    put(root, "empty/.DS_Store");
    put(root, "full/keep.txt");
    expect(await removeDirIfEmpty(asRoot(root), "empty")).toBe(true);
    expect(await removeDirIfEmpty(asRoot(root), "full")).toBe(false);
    expect(await removeDirIfEmpty(asRoot(root), "absent")).toBe(true);
    expect(has(root, "empty")).toBe(false);
    expect(read(root, "full/keep.txt")).toBe("full/keep.txt");
  });
});

// ── guardrail ───────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIBRARY = path.join(REPO_ROOT, "library");
/** Files allowed a recursive remove, with the reason. None today. */
const RECURSIVE_REMOVE_ALLOWLIST: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("guardrail: no recursive removeEntry under library/", () => {
  it("finds none outside the allowlist", () => {
    const offenders: string[] = [];
    for (const f of walk(LIBRARY)) {
      const rel = path.relative(REPO_ROOT, f);
      if (rel in RECURSIVE_REMOVE_ALLOWLIST) continue;
      const src = fs.readFileSync(f, "utf8");
      if (/removeEntry\([^)]*recursive\s*:\s*true/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

// ── Python half ─────────────────────────────────────────────────────────

describe("triage parks never replace a same-named drop (Python)", () => {
  it("passes library/scripts/tests/test_safe_move.py", () => {
    let output: string;
    try {
      output = execFileSync(
        "python3",
        [path.join(LIBRARY, "scripts/tests/test_safe_move.py")],
        { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(`python3 failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`);
    }
    const both = output.match(/(\d+)\/(\d+) passed/);
    expect(both, `no pass tally in output:\n${output}`).not.toBeNull();
    expect(Number(both![2])).toBeGreaterThan(0);
    expect(both![1]).toBe(both![2]);
  });
});
