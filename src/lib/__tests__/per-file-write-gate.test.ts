// @vitest-environment jsdom
//
// **The per-file write gate** — task 415.
//
// > **No FSA write of a file whose bytes are already on disk.**
//
// Chrome's FSA has no in-place write mode: `createWritable()` mints a
// `<name>.crswap` sibling and renames it over the target, so every write is two
// filesystem events a sync daemon watches — and every one of them is a fresh
// chance to mint a conflicted copy. Measured in Gabriel's Overleaf/Dropbox
// folder on 2026-08-21, `virgil.json` was the LOUDEST fork base of the sixteen
// post-363 forks, and it is a file whose bytes barely move while you write.
//
// The cause was two sites with one disease. `writeDocBundle`'s byte-equality
// skip was ALL-OR-NOTHING — it returned only when BOTH outputs matched what
// this session last put on disk, so the moment the `.tex` moved by one
// character the byte-identical `virgil.json` was rewritten beside it — and
// `persistSidecarInLock` had no equality gate at all, while
// `usePersistentState.update` bails only on REFERENTIAL equality, so any hook
// that rebuilds a structurally-equal array re-writes the identical bytes.
//
// ── WHY THIS SUITE EXISTS ──────────────────────────────────────────────────
//
// The defect is a RATE, and **every pre-415 suite asserts a single write's
// PAYLOAD** — which the pre-fix code satisfies perfectly. `write-tex-forensic-
// snapshot`, `mutate-sidecar-primitive`, `sidecar-bundle`, `conflict-net` and
// `storage-fsa-load-writeback` all drive one write and read the resulting
// bytes; not one of them counts writes, so "wrote the same bytes again" is
// unrepresentable in all of them. The shape here is the one
// `editor-state-write-cadence.test.ts` established for task 363: drive a
// simulated session and COUNT.
//
// ── The fake disk models mtime and size, because the gate reads them ───────
//
// The gate's skip is a PROOF, not a belief about a memory cache: it takes the
// ledger fingerprint's hash AND re-confirms the live `{mtimeMs, size}` off the
// same handle it would have written through. So every other FSA fake in this
// repo (which reports a constant `lastModified: 1`, or none at all) would make
// these legs pass or fail for reasons unrelated to what they assert.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The storage barrel top-level-requires a backend; stub it (documented gotcha).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

const DOC_ID = "gatedoc";
const TEX = "main.tex";

// ---------------------------------------------------------------------------
// A fake FSA disk with real mtime/size semantics + a per-path write journal.
// ---------------------------------------------------------------------------

interface FakeFile {
  text: string;
  mtimeMs: number;
}

/** Every `createWritable().close()` that landed, in order, by relPath. */
let writes: string[] = [];
/** Monotonic clock for the fake filesystem's mtimes. */
let clock = 1_000;

class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, FakeFile>();
  dirs = new Map<string, FakeDirHandle>();
  constructor(
    public readonly name: string,
    private readonly path = "",
  ) {}

  private child(n: string): string {
    return this.path ? `${this.path}/${n}` : n;
  }

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException(`no dir ${name}`, "NotFoundError");
      d = new FakeDirHandle(name, this.child(name));
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FileSystemFileHandle> {
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
          // BYTE length, matching what an FSA `File.size` reports and what
          // `fingerprintOf` records.
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
            // A real rename-over always moves the mtime.
            file.mtimeMs = ++clock;
            writes.push(rel);
          },
        } as unknown as FileSystemWritableFileStream;
      },
    } as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string): Promise<void> {
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
  name: "Gated",
  texFilename: TEX,
  folderName: "gated",
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
  writeDocBundle,
  writeSidecar,
  mutateSidecar,
  readSidecar,
  writeBib,
  writeTex,
  invalidateSidecarBundle,
} from "@/lib/storage-fsa";
import {
  getDiskFingerprint,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { clearRetained } from "@/lib/write-preservation";
import type { JSONContent } from "@tiptap/core";

// ---------------------------------------------------------------------------
// Fixture. The paragraph is deliberately LONGER than the sidecar's 80-char
// fingerprint window — see the cost leg for why that is the honest model of a
// real writing session rather than a convenience.
// ---------------------------------------------------------------------------

const LEAD =
  "Annotation has a long history, and the marginal apparatus around a text " +
  "has always been part of how the text is read by later hands. ";

function docWithTail(tail: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p001" },
        content: [{ type: "text", text: LEAD + tail }],
      },
    ],
  };
}

const BASE_TEX =
  "\\documentclass{article}\n\n\\begin{document}\n\n" +
  LEAD +
  "\n\n\\end{document}\n";

function seed(): void {
  docHandle = new FakeDirHandle(DOC_ID);
  docHandle.files.set(TEX, { text: BASE_TEX, mtimeMs: ++clock });
  docHandle.dirs.set("virgil", new FakeDirHandle("virgil", "virgil"));
}

const wrotePath = (p: string): number => writes.filter((w) => w === p).length;
const SIDECAR = "virgil/virgil.json";

beforeEach(() => {
  writes = [];
  resetPipelines();
  clearRetained();
  __resetDiskLedgerForTests();
  invalidateSidecarBundle(DOC_ID);
  seed();
});

// ---------------------------------------------------------------------------
// The COST leg — the one no existing suite can fail.
// ---------------------------------------------------------------------------

describe("writeDocBundle · per-FILE, not all-or-nothing", () => {
  it("a typing session writes the .tex N times and virgil.json ZERO times", async () => {
    // The shape of the defect: the `.tex` moves on every autosave and the
    // sidecar's bytes do not, because the user is typing PAST the 80-character
    // fingerprint window — which is where essentially all typing in a real
    // paragraph happens. Pre-415 the all-or-nothing gate rewrote the sidecar
    // once per autosave, each rewrite a `.crswap` + rename the daemon watches.
    const h = beginDocPipeline(DOC_ID);
    await writeDocBundle(h, docWithTail("Consider"));
    expect(wrotePath(TEX)).toBe(1);
    expect(wrotePath(SIDECAR)).toBe(1); // the session's first write, correctly

    writes = [];
    const N = 8;
    for (let i = 1; i <= N; i++) {
      await writeDocBundle(h, docWithTail("Consider" + " x".repeat(i)));
    }
    expect(wrotePath(TEX)).toBe(N);
    expect(
      wrotePath(SIDECAR),
      "virgil.json was rewritten with byte-identical content during a typing session",
    ).toBe(0);
  });

  it("…and the sidecar IS written when its bytes genuinely move", async () => {
    // The control. The gate is byte-equality, never "the sidecar is boring":
    // an edit inside the fingerprint window, a title or a fold all move it.
    const h = beginDocPipeline(DOC_ID);
    await writeDocBundle(h, docWithTail("a"));
    writes = [];

    const titled = docWithTail("a");
    (titled.content![0].attrs as Record<string, unknown>).parTitle = "Opening";
    await writeDocBundle(h, titled);
    expect(wrotePath(SIDECAR)).toBe(1);
  });

  it("a repeat save of an unchanged document writes NEITHER file", async () => {
    // Non-regression: the pre-415 all-or-nothing early return did this too.
    const h = beginDocPipeline(DOC_ID);
    const doc = docWithTail("settled");
    await writeDocBundle(h, doc);
    writes = [];
    await writeDocBundle(h, doc);
    await writeDocBundle(h, doc);
    expect(writes).toEqual([]);
  });

  it("stamps `virgil/virgil.json` into the ledger, like every other sidecar", async () => {
    // The pre-415 bundle kept the sidecar hash in a module Map that nothing
    // could invalidate. The ledger is keyed on the relPath the watchers stat.
    const h = beginDocPipeline(DOC_ID);
    await writeDocBundle(h, docWithTail("x"));
    const fp = getDiskFingerprint(DOC_ID, SIDECAR);
    expect(fp, "virgil.json is unledgered — the gate has nothing to read").toBeTruthy();
    expect(fp!.size).toBe(
      new TextEncoder().encode(
        docHandle.dirs.get("virgil")!.files.get("virgil.json")!.text,
      ).length,
    );
  });
});

// ---------------------------------------------------------------------------
// The gate is at the FUNNEL, so every writer inherits it.
// ---------------------------------------------------------------------------

describe("every ledgered writer inherits the gate", () => {
  it("writeSidecar: the same snapshot twice writes ONCE", async () => {
    const h = beginDocPipeline(DOC_ID);
    const data = { notes: [{ id: "n1", text: "hello" }] };
    await writeSidecar(h, "notes.json", data);
    // A DIFFERENT object with identical structure — the shape
    // `usePersistentState.update`'s referential-equality bail waves through.
    await writeSidecar(h, "notes.json", { notes: [{ id: "n1", text: "hello" }] });
    expect(wrotePath("virgil/notes.json")).toBe(1);
  });

  it("mutateSidecar: a structurally-equal mutation writes NOTHING", async () => {
    const h = beginDocPipeline(DOC_ID);
    await writeSidecar(h, "todos.json", { todos: [{ id: "t1", done: false }] });
    writes = [];
    // `null` already means "nothing to change"; this is the OTHER shape — a
    // mutator that rebuilds an equal object, which pre-415 wrote every time.
    type Todos = { todos: { id: string; done: boolean }[] };
    await mutateSidecar<Todos>(h, "todos.json", { todos: [] }, (cur) => ({
      todos: cur.todos.map((t) => ({ ...t })),
    }));
    expect(writes).toEqual([]);
  });

  it("readSidecar stamps, so the FIRST write of a session can be declined", async () => {
    // The ledger's contract has always been "what Virgil last put on OR READ
    // FROM disk". Only the `.tex` load path was read-stamping, so every
    // sidecar's first write of a session landed however unchanged its bytes.
    const virgil = docHandle.dirs.get("virgil")!;
    const onDisk = JSON.stringify({ notes: [{ id: "n1" }] }, null, 2);
    virgil.files.set("notes.json", { text: onDisk, mtimeMs: ++clock });

    await readSidecar(DOC_ID, "notes.json", { notes: [] });
    const h = beginDocPipeline(DOC_ID);
    await writeSidecar(h, "notes.json", { notes: [{ id: "n1" }] });
    expect(wrotePath("virgil/notes.json")).toBe(0);
  });

  it("writeBib: identical bytes write nothing AND mint no history slot", async () => {
    // The forensic snapshot rides `beforeWrite`, so a declined write cannot
    // fill `virgil/.history/` with copies of bytes nothing replaced — history
    // slots are themselves sync traffic.
    const h = beginDocPipeline(DOC_ID);
    docHandle.files.set("references.bib", {
      text: "@book{a,\n  title={T},\n}\n",
      mtimeMs: ++clock,
    });
    await writeBib(h, "@book{a,\n  title={T2},\n}\n");
    expect(wrotePath("references.bib")).toBe(1);

    writes = [];
    await writeBib(h, "@book{a,\n  title={T2},\n}\n");
    expect(writes).toEqual([]);
    const slots = docHandle.dirs.get("virgil")?.dirs.get(".history");
    expect([...(slots?.dirs.keys() ?? [])]).toHaveLength(1);
  });

  it("writeTex: a REPEATED style swap writes nothing and mints no second slot", async () => {
    // The first swap establishes the ledger entry (and takes its unconditional
    // forensic snapshot); the second is a no-op the user cannot distinguish
    // from the first, and must cost nothing on disk.
    const h = beginDocPipeline(DOC_ID);
    const swapped = BASE_TEX.replace("article", "amsart");
    await writeTex(h, swapped);
    expect(wrotePath(TEX)).toBe(1);

    writes = [];
    await writeTex(h, swapped);
    expect(writes, "a redundant style swap rewrote the .tex").toEqual([]);
    expect([
      ...(docHandle.dirs.get("virgil")?.dirs.get(".history")?.dirs.keys() ?? []),
    ]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The gate is a PROOF: anything it cannot prove, it writes.
// ---------------------------------------------------------------------------

describe("the gate never masks a write it cannot prove is redundant", () => {
  it("an EXTERNALLY modified file is written again on the next save", async () => {
    // The ledger records what Virgil last put on disk; nothing re-baselines it
    // on a genuine external change (the DiskWatcher deliberately KEEPS the
    // stale fingerprint and flags, so the badge stays lit across polls, and the
    // SidecarWatcher is not mounted at all today). So the hash alone cannot
    // decide: the gate re-confirms the live {mtimeMs, size} off the same handle
    // it would write through — the DiskWatcher's own cheap-path predicate.
    const h = beginDocPipeline(DOC_ID);
    const data = { notes: [{ id: "n1", text: "ours" }] };
    await writeSidecar(h, "notes.json", data);
    writes = [];

    // Another app (a skill, a sync daemon) replaces the bytes.
    const f = docHandle.dirs.get("virgil")!.files.get("notes.json")!;
    f.text = '{"notes":[{"id":"n1","text":"theirs"}]}';
    f.mtimeMs = ++clock;

    // Virgil writes exactly what it last wrote. The hash matches the ledger and
    // the file has MOVED, so the write must land rather than be skipped.
    await writeSidecar(h, "notes.json", { notes: [{ id: "n1", text: "ours" }] });
    expect(
      wrotePath("virgil/notes.json"),
      "an external write was masked by the byte-equality gate",
    ).toBe(1);
  });

  it("with no ledger entry the write lands — the gate FAILS OPEN", async () => {
    const h = beginDocPipeline(DOC_ID);
    const data = { notes: [{ id: "n1" }] };
    await writeSidecar(h, "notes.json", data);
    writes = [];
    // A page reload starts with an empty ledger; the gate then has no claim to
    // make and must write rather than assume.
    __resetDiskLedgerForTests();
    await writeSidecar(h, "notes.json", data);
    expect(wrotePath("virgil/notes.json")).toBe(1);
  });

  it("userResolvedConflict FORCES both files past the gate", async () => {
    // Task 364's keep-mine door: the user has been shown a conflict and has
    // chosen their version. Silently declining to write it — because the bytes
    // look like what we last wrote — would leave the badge's promise unkept
    // with nothing on screen to say so.
    const h = beginDocPipeline(DOC_ID);
    const doc = docWithTail("mine");
    await writeDocBundle(h, doc);
    writes = [];

    await writeDocBundle(h, doc, { userResolvedConflict: true });
    expect(wrotePath(TEX)).toBe(1);
    expect(wrotePath(SIDECAR)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The CENSUS — the leg with teeth.
//
// The funnel was never the part that could misbehave. A WRITER that reaches the
// raw primitive beside it is, and such a writer type-checks perfectly, throws
// nothing, and is invisible to every behavioural leg above — which is exactly
// how `persistSidecarInLock` came to write unconditionally for a year while the
// bundle beside it had a (half-)gate.
//
// It shares ONE extraction with `tex-write-accountability`, which asks a
// DIFFERENT question of the same population (did this write measure or snapshot
// what it is replacing?). Two censuses over one `writeSites()` is what keeps
// them from coming to disagree about who the writers are.
// ---------------------------------------------------------------------------

import { writeSites } from "@/lib/__tests__/tex-write-accountability.test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnlyLines } from "@/lib/__tests__/_source-scan";

const SRC = path.join(__dirname, "../..");
const BACKENDS = ["lib/storage-fsa.ts", "lib/storage-dev.ts"] as const;

describe("census · every backend write enters the gated funnel", () => {
  it("finds both kinds of site in both backends", () => {
    // A census that matched nothing would pass every leg below.
    const sites = writeSites();
    for (const rel of BACKENDS) {
      const mine = sites.filter((s) => s.file === rel);
      expect(mine.filter((s) => s.raw).length, `no raw writes in ${rel}`)
        .toBeGreaterThanOrEqual(2);
      expect(mine.filter((s) => !s.raw).length, `no gated writes in ${rel}`)
        .toBeGreaterThanOrEqual(4);
    }
  });

  it("no RAW primitive call escapes the gate without a stated reason", () => {
    const escapees = writeSites().filter(
      (s) => s.raw && s.gateExemptReason === null,
    );
    expect(
      escapees.map((s) => `${s.file}:${s.line}  ${s.text}`),
      "a text write that bypasses the byte-equality funnel — route it through " +
        "writeTrackedText/putTrackedText, or state why these bytes cannot " +
        "already be on disk",
    ).toEqual([]);
  });

  it("every gate exemption states a REASON, not just a marker", () => {
    const thin = writeSites()
      .filter((s) => s.gateExemptReason !== null)
      .filter((s) => (s.gateExemptReason ?? "").length < 24);
    expect(thin.map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });

  it("the gate predicate has exactly ONE caller per backend — the funnel", () => {
    // A second call site is a partial gate: a writer that asks the question and
    // then writes anyway, or asks it about a different relPath than it writes.
    for (const rel of BACKENDS) {
      const code = codeOnlyLines(readFileSync(path.join(SRC, rel), "utf8"));
      const calls = code
        .split("\n")
        .filter((l) => /\bdiskAlreadyHas\(/.test(l))
        .filter((l) => !/\bfunction\s+diskAlreadyHas\b/.test(l));
      expect(calls.length, `${rel}: ${JSON.stringify(calls)}`).toBe(1);
    }
  });

  it("the retired per-doc sidecar hash cache stays retired", () => {
    // `lastSidecarHashByDoc` was the other half of the pre-415 all-or-nothing
    // skip: a module Map holding the same fact the ledger holds, keyed on the
    // doc rather than the relPath, and invalidated by nothing. Re-adding it
    // would give the gate a second, un-invalidatable source of truth.
    for (const rel of BACKENDS) {
      const code = codeOnlyLines(readFileSync(path.join(SRC, rel), "utf8"));
      expect(code, `${rel} re-declares lastSidecarHashByDoc`).not.toContain(
        "lastSidecarHashByDoc",
      );
    }
  });

  it("the census can SEE an ungated raw write (canary)", () => {
    // Synthetic, not a live line — a canary standing on the defect evaporates
    // the moment the defect is drained (task 220's rule).
    const fixture = [
      "async function roguePersist(fh: FileSystemFileHandle, text: string) {",
      "  await writeTextToHandle(fh, text);",
      "}",
    ];
    expect(/\b(?:writeTextToHandle|putText)\(/.test(fixture[1])).toBe(true);
    expect(fixture.some((l) => /write-gate-exempt:\s*(\S.*)$/.test(l))).toBe(false);
  });
});
