// @vitest-environment jsdom
//
// **Host writability** — task 556.
//
// > A note written in the Library Reader is silently discarded: the chrome
// > PERMITS the write and the storage funnel refuses it unconditionally.
//
// `READER_CHROME.editableCardKinds: ["note"]` fed `isSidecarWriteAllowed`, the
// UI-layer permit `usePersistentState` asks before every disk write, and that
// permit said YES to `notes.json`. One layer below, BOTH storage backends asked
// a strictly stronger, blind question — `docId.startsWith("library-paper:")` —
// and refused EVERY write for such a doc. So the permit was dead in production
// (every write it granted was refused; every write it refused would have been
// refused anyway), `hasMutatedRef` was stamped for a write that never landed,
// and the prose on each side asserted its own answer.
//
// The fix is ONE derivation — `@/lib/host-writability` — read by both layers:
// the set of sidecars a `library-paper:` doc may write is derived from the
// Reader chrome's editable kinds through the card-kind → sidecar map, and the
// funnels ask THAT rather than the prefix. This suite pins:
//
//   1. the leaf's contract (derivation, the funnel's subkey question);
//   2. AGREEMENT — the UI permit and the storage predicate answer identically
//      for every sidecar filename the app knows, and `READER_CHROME` reads the
//      leaf's constant rather than a literal of its own;
//   3. the FSA backend, driven for REAL against a fake paper folder: a note
//      write LANDS in `virgil/notes.json`; the `.tex`, the bundle, the bib,
//      the PDF and a non-note sidecar are still REFUSED — with a normal doc as
//      the accepting control (it writes everything), so an implementation that
//      opened the funnel wide fails here;
//   4. the dev backend, the same story over a fetch spy;
//   5. the CENSUS — the leg with teeth. The derivation was never the part that
//      could misbehave; a second, blind blanket guard beneath it is, and so is
//      a hand-listed copy of the writable set, or a Reader component minting
//      the docId prefix by hand. None of those is visible to any behavioural
//      test of the derivation.
//
// Harness notes: the `@/lib/storage` barrel does a top-level `require()` vitest
// cannot alias (documented gotcha: vitest_extension_barrel_storage_mock), so
// it is stubbed and the backends are imported DIRECTLY. `@/lib/doc-index` is
// mocked so `getDocHandle` returns the fake paper dir for the Reader doc (the
// registered fast path PaperRender takes) and a fake folder for the normal doc.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

const LIBRARY_DOC = "library-paper:smith2020";
const NORMAL_DOC = "regular-doc-123";

// ---------------------------------------------------------------------------
// A minimal in-memory FSA fake (the shape `per-file-write-gate.test.ts` uses)
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
  /** Every `createWritable().close()` that landed, by relPath. */
  writes: string[] = [];
  constructor(
    public readonly name: string,
    private readonly path = "",
    private readonly root?: FakeDirHandle,
  ) {}
  private child(n: string): string {
    return this.path ? `${this.path}/${n}` : n;
  }
  private log(rel: string) {
    (this.root ?? this).writes.push(rel);
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDirHandle(name, this.child(name), this.root ?? this);
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
              typeof buf === "string"
                ? buf
                : new TextDecoder().decode(buf as ArrayBuffer);
            file.mtimeMs = ++clock;
            this.log(rel);
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

let paperDir: FakeDirHandle;
let normalDir: FakeDirHandle;

const NORMAL_META = {
  id: NORMAL_DOC,
  name: "Normal",
  texFilename: "main.tex",
  folderName: "normal",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
  lastAccessedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("@/lib/doc-index", () => ({
  OUTER_PAPER_PREFIX: "paper:",
  OUTER_LIBRARY_PREFIX: "library:",
  OUTER_LIBRARY_ROOT_ID: "library:__root__",
  getDocHandle: vi.fn(async (id: string) =>
    id === LIBRARY_DOC ? paperDir : id === NORMAL_DOC ? normalDir : null,
  ),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({ docs: [NORMAL_META] })),
  mutateIndex: vi.fn(async () => undefined),
}));

import {
  LIBRARY_PAPER_PREFIX,
  CARD_KIND_SIDECAR,
  READER_EDITABLE_CARD_KINDS,
  LIBRARY_PAPER_WRITABLE_SIDECARS,
  writableSidecarsFor,
  libraryPaperSidecarWritable,
  libraryPaperWriteAllowed,
  libraryPaperDocId,
  libraryPaperCitekey,
  isLibraryPaperDoc,
  sidecarWriteSubkey,
} from "@/lib/host-writability";
import {
  READER_CHROME,
  FULL_CHROME,
  isSidecarWriteAllowed,
} from "@/components/editor-layout/chrome-config";
import { ALL_VIRGIL_SIDECAR_FILENAMES } from "@/lib/sidecar-value";
import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { flushWrites } from "@/lib/write-queue";
import * as fsa from "@/lib/storage-fsa";
import * as dev from "@/lib/storage-dev";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
const NOTE = { cards: [{ kind: "note", id: "n1", title: "", content: {} }] };

// ---------------------------------------------------------------------------
// 1. The leaf
// ---------------------------------------------------------------------------

describe("host-writability — the derivation", () => {
  it("no whitelist (the main app) → unrestricted", () => {
    expect(writableSidecarsFor(undefined)).toBeNull();
  });

  it("a whitelist derives EXACTLY the sidecars its kinds live in", () => {
    expect([...writableSidecarsFor(["note"])!]).toEqual(["notes.json"]);
    // `highlight` shares the note sidecar — one file, not two.
    expect([...writableSidecarsFor(["note", "highlight"])!]).toEqual(["notes.json"]);
    expect([...writableSidecarsFor(["todo", "note"])!].sort()).toEqual([
      "notes.json",
      "todos.json",
    ]);
    // A kind with no card sidecar (an atom, a record kind) contributes nothing.
    expect([...writableSidecarsFor(["footnote", "citation", "example"])!]).toEqual([]);
  });

  it("the Reader's set is derived from its declared kinds (today: the note sidecar)", () => {
    expect([...LIBRARY_PAPER_WRITABLE_SIDECARS]).toEqual(
      [...writableSidecarsFor(READER_EDITABLE_CARD_KINDS)!],
    );
    expect(LIBRARY_PAPER_WRITABLE_SIDECARS.has("notes.json")).toBe(true);
  });

  it("libraryPaperSidecarWritable: a normal doc writes anything; a Reader doc only the derived set", () => {
    expect(libraryPaperSidecarWritable(NORMAL_DOC, "todos.json")).toBe(true);
    expect(libraryPaperSidecarWritable(LIBRARY_DOC, "notes.json")).toBe(true);
    for (const f of ["todos.json", "reports.json", "archive.json", "revisions.json",
      "cutter.json", "citations.json", "footnotes.json", "focus.json",
      "editor-state.json", "document-settings.json", "dictionary.json"]) {
      expect(libraryPaperSidecarWritable(LIBRARY_DOC, f), f).toBe(false);
    }
  });

  it("libraryPaperWriteAllowed: over the funnel's subkeys, only a derived sidecar write passes", () => {
    expect(libraryPaperWriteAllowed(LIBRARY_DOC, sidecarWriteSubkey("notes.json"))).toBe(true);
    for (const subkey of [
      sidecarWriteSubkey("todos.json"),
      "bundle",
      "pdf",
      "bib/references.bib",
      "figures/abc",
      "figures/index",
      "figures/import/figures",
      "virgil/figures-cache/abc.webp", // a deeper path is never a sidecar
      "virgil/_cleanup",
    ]) {
      expect(libraryPaperWriteAllowed(LIBRARY_DOC, subkey), subkey).toBe(false);
    }
    // A normal doc is never gated here.
    for (const subkey of ["bundle", "pdf", sidecarWriteSubkey("todos.json")]) {
      expect(libraryPaperWriteAllowed(NORMAL_DOC, subkey), subkey).toBe(true);
    }
  });

  it("the docId vocabulary round-trips through the leaf", () => {
    expect(libraryPaperDocId("smith2020")).toBe(LIBRARY_DOC);
    expect(isLibraryPaperDoc(LIBRARY_DOC)).toBe(true);
    expect(isLibraryPaperDoc(NORMAL_DOC)).toBe(false);
    expect(libraryPaperCitekey(LIBRARY_DOC)).toBe("smith2020");
    expect(LIBRARY_PAPER_PREFIX).toBe("library-paper:");
  });
});

// ---------------------------------------------------------------------------
// 2. AGREEMENT — the two layers answer from ONE table
// ---------------------------------------------------------------------------

describe("host-writability — the UI permit and the storage funnel agree", () => {
  it("READER_CHROME.editableCardKinds IS the leaf's constant (no literal of its own)", () => {
    expect(READER_CHROME.editableCardKinds).toBe(READER_EDITABLE_CARD_KINDS);
    expect(FULL_CHROME.editableCardKinds).toBeUndefined();
  });

  it("for EVERY sidecar the app knows, isSidecarWriteAllowed(READER) ≡ libraryPaperSidecarWritable", () => {
    const filenames = new Set<string>([
      ...ALL_VIRGIL_SIDECAR_FILENAMES,
      ...Object.values(CARD_KIND_SIDECAR).filter((f): f is string => !!f),
      "something-nobody-declared.json",
    ]);
    expect(filenames.size).toBeGreaterThan(10);
    let permitted = 0;
    for (const f of filenames) {
      const ui = isSidecarWriteAllowed(READER_CHROME, f);
      const funnel = libraryPaperSidecarWritable(LIBRARY_DOC, f);
      expect(ui, `${f}: ui=${ui} funnel=${funnel}`).toBe(funnel);
      if (ui) permitted++;
    }
    // …and the sweep crossed BOTH answers, so it cannot pass by refusing all.
    expect(permitted).toBeGreaterThan(0);
    expect(permitted).toBeLessThan(filenames.size);
  });

  it("FULL_CHROME permits everything the funnel permits for a normal doc", () => {
    for (const f of ALL_VIRGIL_SIDECAR_FILENAMES) {
      expect(isSidecarWriteAllowed(FULL_CHROME, f)).toBe(true);
      expect(libraryPaperSidecarWritable(NORMAL_DOC, f)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. FSA backend — driven for REAL against a fake paper folder
// ---------------------------------------------------------------------------

describe("storage-fsa — a Reader note LANDS, everything else is still refused", () => {
  beforeEach(() => {
    resetPipelines();
    paperDir = new FakeDirHandle("smith2020");
    normalDir = new FakeDirHandle("normal");
  });
  afterEach(() => {
    resetPipelines();
  });

  it("DEFECT: writeSidecar(notes.json) for a library-paper doc writes virgil/notes.json", async () => {
    const h = beginDocPipeline(LIBRARY_DOC);
    await fsa.writeSidecar(h, "notes.json", NOTE);
    await flushWrites(`${LIBRARY_DOC}/virgil/notes.json`);
    endDocPipeline(h);
    expect(paperDir.writes).toEqual(["virgil/notes.json"]);
    const virgil = await paperDir.getDirectoryHandle("virgil");
    expect(JSON.parse(virgil.files.get("notes.json")!.text)).toEqual(NOTE);
  });

  it("DEFECT: mutateSidecar(notes.json) for a library-paper doc lands too, and reports what it wrote", async () => {
    const h = beginDocPipeline(LIBRARY_DOC);
    const out = await fsa.mutateSidecar(h, "notes.json", { cards: [] }, () => NOTE);
    endDocPipeline(h);
    expect(out).toEqual(NOTE);
    expect(paperDir.writes).toEqual(["virgil/notes.json"]);
  });

  it("a non-note sidecar, the .tex, the bundle, the bib and the PDF are STILL refused for a library-paper doc", async () => {
    const h = beginDocPipeline(LIBRARY_DOC);
    await expect(fsa.writeSidecar(h, "todos.json", { todos: [] })).resolves.toBeUndefined();
    await expect(
      fsa.mutateSidecar(h, "todos.json", { todos: [] }, () => ({ todos: [1] })),
    ).resolves.toBeNull();
    await expect(fsa.writeTex(h, "\\documentclass{article}")).resolves.toBeUndefined();
    await expect(fsa.writeDocBundle(h, EMPTY_DOC)).resolves.toEqual({
      landed: false,
      reason: "read-only",
    });
    await expect(fsa.mutateBib(h, () => "@book{k, title={T}}")).resolves.toBeNull();
    await expect(fsa.writePdf(h, new Uint8Array([1]))).resolves.toEqual({
      status: "skipped",
    });
    endDocPipeline(h);
    expect(paperDir.writes).toEqual([]);
  });

  it("CONTROL: a normal doc still writes every one of those", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    await fsa.writeSidecar(h, "notes.json", NOTE);
    await fsa.writeSidecar(h, "todos.json", { todos: [] });
    await fsa.writeTex(h, "\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n");
    await flushWrites(`${NORMAL_DOC}/virgil/notes.json`);
    await flushWrites(`${NORMAL_DOC}/virgil/todos.json`);
    await flushWrites(`${NORMAL_DOC}/bundle`);
    endDocPipeline(h);
    // `writeTex` also takes an unconditional forensic snapshot of the prior
    // bundle into `virgil/.history/<ts>/` (task 357's accountability rule for
    // the style-swap writer) — correct behaviour, not a write this leg is
    // about, so it is filtered out of the compared set.
    const landed = normalDir.writes.filter((w) => !w.startsWith("virgil/.history/"));
    expect(new Set(landed)).toEqual(
      new Set(["virgil/notes.json", "virgil/todos.json", "main.tex"]),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Dev backend — the same story over a fetch spy (the twin rule)
// ---------------------------------------------------------------------------

describe("storage-dev — a Reader note LANDS, everything else is still refused", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const puts = () =>
    fetchSpy.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
      .map(([url]) => String(url));

  beforeEach(() => {
    resetPipelines();
    fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response("", { status: 200 })
        : new Response("", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    resetPipelines();
    vi.unstubAllGlobals();
  });

  it("DEFECT: writeSidecar(notes.json) PUTs to the paper's virgil/notes.json on the dev-library route", async () => {
    const h = beginDocPipeline(LIBRARY_DOC);
    await dev.writeSidecar(h, "notes.json", NOTE);
    endDocPipeline(h);
    expect(puts()).toEqual(["/api/dev-library/papers/smith2020/virgil/notes.json"]);
  });

  it("DEFECT: mutateSidecar(notes.json) lands too", async () => {
    const h = beginDocPipeline(LIBRARY_DOC);
    const out = await dev.mutateSidecar(h, "notes.json", { cards: [] }, () => NOTE);
    endDocPipeline(h);
    expect(out).toEqual(NOTE);
    expect(puts()).toEqual(["/api/dev-library/papers/smith2020/virgil/notes.json"]);
  });

  it("a non-note sidecar, the .tex, the bundle, the bib and the PDF are STILL refused (no PUT at all)", async () => {
    const h = beginDocPipeline(LIBRARY_DOC);
    await expect(dev.writeSidecar(h, "todos.json", { todos: [] })).resolves.toBeUndefined();
    await expect(
      dev.mutateSidecar(h, "todos.json", { todos: [] }, () => ({ todos: [1] })),
    ).resolves.toBeNull();
    await expect(dev.writeTex(h, "\\documentclass{article}")).resolves.toBeUndefined();
    await expect(dev.writeDocBundle(h, EMPTY_DOC)).resolves.toEqual({
      landed: false,
      reason: "read-only",
    });
    await expect(dev.mutateBib(h, () => "@book{k, title={T}}")).resolves.toBeNull();
    await expect(dev.writePdf(h, new Uint8Array([1]))).resolves.toEqual({
      status: "skipped",
    });
    endDocPipeline(h);
    expect(puts()).toEqual([]);
  });

  it("CONTROL: a normal doc still PUTs a non-note sidecar through the ordinary dev route", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    await dev.writeSidecar(h, "todos.json", { todos: [] });
    endDocPipeline(h);
    expect(puts()).toEqual([`/api/dev/doc/${NORMAL_DOC}/virgil/todos.json`]);
  });
});

// ---------------------------------------------------------------------------
// 5. CENSUS — the leg with teeth
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");

function listSources(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "__tests__" || ent.name === ".next")
        continue;
      listSources(p, out);
    } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

const PRODUCTION = [...listSources(path.join(ROOT, "src")), ...listSources(path.join(ROOT, "library"))];
const LEAF = path.join(ROOT, "src/lib/host-writability.ts");
const rel = (p: string) => path.relative(ROOT, p);
const read = (p: string) => fs.readFileSync(p, "utf8");
/** Comments blanked, string literals KEPT — the needles here are quoted text. */
function commentsStripped(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(
    /(^|[^:"'`])\/\/[^\n]*/g,
    (m, pre) => pre + " ".repeat(m.length - pre.length),
  );
}

describe("host-writability — census", () => {
  it("the `library-paper:` docId prefix is spelled in ONE production file (the leaf)", () => {
    const spellers = PRODUCTION.filter(
      (p) => p !== LEAF && /["'`]library-paper:/.test(commentsStripped(read(p))),
    ).map(rel);
    // A Reader component or a backend minting / testing the prefix by hand is
    // a second vocabulary — the docId the Reader mounts and the docId the
    // funnel gates must be one string, and they are one string because there
    // is one speller. Allowlist EMPTY: a hit is MIGRATE-it.
    expect(spellers).toEqual([]);
  });

  it("neither storage backend asks the docId PREFIX at a SIDECAR write door; both ask the derived predicate", () => {
    for (const file of ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"]) {
      const src = commentsStripped(read(path.join(ROOT, file)));
      // The pre-556 shape: a blanket prefix test standing in front of a
      // sidecar write. Neither backend may spell it any more.
      expect(src, `${file}: raw prefix test`).not.toMatch(/startsWith\(LIBRARY_PAPER_PREFIX\)/);
      expect(src, `${file}: a local prefix const`).not.toMatch(/const LIBRARY_PAPER_PREFIX\b/);
      expect(src, `${file}: imports the leaf`).toMatch(/from "@\/lib\/host-writability"/);
      // The two sidecar doors read the derived answer (disk + local-store
      // branches in FSA; the two entry points in dev).
      const sidecarAsks = src.match(/libraryPaperSidecarWritable\(/g)?.length ?? 0;
      expect(sidecarAsks, `${file}: sidecar doors asking the derivation`).toBe(2);
    }
    // …and the FSA funnel itself asks over its subkey, exactly once.
    const fsaSrc = commentsStripped(read(path.join(ROOT, "src/lib/storage-fsa.ts")));
    expect(fsaSrc.match(/libraryPaperWriteAllowed\(/g)?.length ?? 0).toBe(1);
    // Every sidecar subkey the FSA funnel sees is spelled through the door,
    // never as a bare template the funnel would have to parse on faith.
    expect(fsaSrc).not.toMatch(/enqueueDocWrite(<[^>]*>)?\(\s*h,\s*`virgil\/\$\{/);
  });

  it("no production file hand-lists the card-kind → sidecar map or the Reader's writable set outside the leaf", () => {
    const CARD_SIDECARS = [...new Set(Object.values(CARD_KIND_SIDECAR))] as string[];
    const offenders = PRODUCTION.filter((p) => {
      if (p === LEAF) return false;
      const src = commentsStripped(read(p));
      if (/\bCARD_KIND_SIDECAR\b\s*[:=]/.test(src)) return true;
      // A file that spells THREE or more card-sidecar filenames on one
      // statement is enumerating the set (the shape the pre-556 chrome held);
      // `sidecar-value.ts` is the sidecar SSOT and legitimately names them all.
      if (p.endsWith("src/lib/sidecar-value.ts")) return false;
      return src
        .split(/[;{}]/)
        .some((stmt) => CARD_SIDECARS.filter((f) => stmt.includes(`"${f}"`)).length >= 3);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("chrome-config reads the leaf for the Reader's kinds and the derivation, and holds no map of its own", () => {
    const src = commentsStripped(
      read(path.join(ROOT, "src/components/editor-layout/chrome-config.ts")),
    );
    expect(src).toMatch(/editableCardKinds:\s*READER_EDITABLE_CARD_KINDS/);
    expect(src).toMatch(/writableSidecarsFor\(chrome\.editableCardKinds\)/);
    expect(src).not.toMatch(/KNOWN_CARD_SIDECARS/);
  });

  it("usePersistentState still asks the UI permit (the two layers are two readers, not one)", () => {
    const src = commentsStripped(read(path.join(ROOT, "src/hooks/usePersistentState.ts")));
    expect(src).toMatch(/isSidecarWriteAllowed\(chrome, filename\)/);
  });

  it("canary: the stripper leaves a quoted needle standing", () => {
    expect(commentsStripped('const x = "library-paper:" // "library-paper:"')).toMatch(
      /"library-paper:"\s+$/,
    );
  });
});
