// @vitest-environment jsdom
//
// Task 411 — the CLEANUP half of the sync-conflict surface.
//
// Task 363 shipped detection and stopped at a stated boundary: *Virgil does not
// merge or delete a fork; it REPORTS.* Gabriel's decision (2026-08-21) crosses
// exactly one half of it — a one-click delete of the debris the app's own
// DECLARATIONS prove carries nothing, and never a content sidecar, whatever a
// comparison of its bytes might say.
//
// The plan was never the part that could misbehave. What could is a CALL SITE
// that decides for itself which files to remove, and that type-checks perfectly:
// `deleteSidecarSiblings(h, notice.groups.flatMap(…))` compiles, runs, and
// deletes the user's unmerged writing. So the door re-derives the sanctioned set
// from a FRESH listing and treats its argument as a filter — and the legs with
// teeth are the ones that hand it a content fork and watch it refuse.
//
// Legs:
//   1. PLAN     — swept over the REAL `SIDECAR_VALUE`, so a sidecar declared
//                 later is covered by declaration alone: a `.crswap` is always
//                 in, a fork is in IFF its base's tier is `view`, and counters
//                 prove the sweep crossed BOTH tiers (a plan that returned
//                 nothing would otherwise pass every "never a content base" leg).
//   2. CLOSED   — an undeclared base, a user's own file and a declared sidecar
//                 are never in the plan. `sidecarTier` fails closed to content,
//                 so an unknown base cannot reach the view branch.
//   3. DOOR     — the REAL exports in BOTH backends against a fake disk: asked
//                 to delete everything in the folder, each removes only the
//                 view-tier fork and the swap debris, REFUSES the content fork
//                 and the live sidecars, and leaves every refused byte on disk.
//                 Each of these fails on a door that trusts its argument.
//   4. RECEIPT  — a name already gone is in NO bucket (nothing deleted, nothing
//                 kept); an IO failure lands in `failed` rather than being
//                 reported as a delete.
//   5. CENSUS   — the leg with teeth. Every backend door spells
//                 `planSidecarCleanup` and never removes straight from `names`;
//                 nothing outside the ONE runner calls the door; the badge
//                 derives its set through the plan; and the in-app rule stays
//                 DECLARATIONS-only (no byte comparison — that is the offline
//                 tool's job, and a second copy of it in app code is the third
//                 speller this cluster keeps having to retire).
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./_source-scan";

// The storage barrel does a top-level require() of a backend; stub it — we call
// the backends directly. (Gotcha: vitest_extension_barrel_storage_mock.)
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import {
  planSidecarCleanup,
  isEmptyCleanupReceipt,
  type SidecarCleanupEntry,
} from "@/lib/sync-conflict-cleanup";
import { SIDECAR_VALUE, sidecarTier } from "@/lib/sidecar-value";

const REPO = path.resolve(__dirname, "../../..");
const DOC_ID = "cleanupdoc";

// ---------------------------------------------------------------------------
// Leg 1 + 2 — the PLAN
// ---------------------------------------------------------------------------

/** The four decoration grammars `sync-conflict.ts` recognizes, over one base. */
function forksOf(base: string): string[] {
  const stem = base.replace(/\.json$/, "");
  return [
    `${stem} (Gabriel Greenberg's conflicted copy 2026-08-18).json`,
    `${stem}.sync-conflict-20260818-120000-ABCDEFG.json`,
    `${stem} (1).json`,
    `${stem} 2.json`,
  ];
}

describe("sync-conflict cleanup — the PLAN", () => {
  it("is total over the declared vocabulary: swap always, a fork iff VIEW", () => {
    let viewBases = 0;
    let contentBases = 0;
    for (const base of Object.keys(SIDECAR_VALUE)) {
      const tier = sidecarTier(base);
      if (tier === "view") viewBases++;
      else contentBases++;

      const swapName = `${base}.3.crswap`;
      const names = [base, swapName, ...forksOf(base)];
      const plan = planSidecarCleanup(names);
      const planned = new Set(plan.map((e) => e.name));

      // The live sidecar itself is never a sibling of anything.
      expect(planned.has(base)).toBe(false);
      // Browser debris is prunable whatever the base is worth — it is either a
      // partial copy of a write that never landed or a complete one that did.
      expect(planned.has(swapName)).toBe(true);
      for (const f of forksOf(base)) {
        expect(
          planned.has(f),
          `${f} (base tier ${tier}) planned=${planned.has(f)}`,
        ).toBe(tier === "view");
      }
    }
    // …and the sweep crossed BOTH tiers, or "never a content base" is vacuous.
    expect(viewBases).toBeGreaterThan(0);
    expect(contentBases).toBeGreaterThan(0);
  });

  it("NEVER plans a fork of a content sidecar — whatever its bytes say", () => {
    const names = Object.keys(SIDECAR_VALUE).flatMap((b) => forksOf(b));
    const plan = planSidecarCleanup(names);
    expect(plan.length).toBeGreaterThan(0);
    for (const e of plan) {
      expect(e.reason).toBe("view-tier");
      expect(sidecarTier(e.base)).toBe("view");
    }
  });

  it("fails CLOSED: an undeclared base, a user's own file, a real sidecar", () => {
    const plan = planSidecarCleanup([
      // Not a file Virgil writes — the closed-base short-circuit is the whole
      // safety argument for the loose decoration grammars, applied on the side
      // that DELETES.
      "my-notes (Gabriel Greenberg's conflicted copy 2026-08-18).json",
      "my-notes 2.json",
      "scratch.json",
      "notes.json",
      "editor-state.json",
      "README.md",
    ]);
    expect(plan).toEqual([]);
  });

  it("is idempotent over its own output", () => {
    const names = ["editor-state (X's conflicted copy 2026-08-18).json", "notes.json.crswap"];
    const once = planSidecarCleanup(names).map((e) => e.name);
    const twice = planSidecarCleanup(once).map((e) => e.name);
    expect(twice).toEqual(once);
  });

  it("reports an empty receipt as empty", () => {
    expect(isEmptyCleanupReceipt({ deleted: [], refused: [], failed: [] })).toBe(true);
    expect(isEmptyCleanupReceipt({ deleted: ["a"], refused: [], failed: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Leg 3 + 4 — the DOOR, in both backends, against a fake disk
// ---------------------------------------------------------------------------

const CONTENT_FORK = "notes (Gabriel Greenberg's conflicted copy 2026-08-18).json";
const VIEW_FORK = "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json";
const SWAP = "archive.json.1.crswap";
const SEEDED = ["notes.json", "editor-state.json", CONTENT_FORK, VIEW_FORK, SWAP];

/** A minimal FSA directory handle with a real `removeEntry` (the FakeDirHandle
 *  from `sidecar-bundle.test.ts`, narrowed to what this door touches). */
class FakeDirHandle {
  readonly kind = "directory" as const;
  files = new Map<string, string>();
  dirs = new Map<string, FakeDirHandle>();
  /** Names whose removal throws — the IO-failure leg. */
  failOn = new Set<string>();
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

  async removeEntry(name: string): Promise<void> {
    if (this.failOn.has(name)) throw new Error("EPERM");
    if (!this.files.has(name)) throw new DOMException(`no file ${name}`, "NotFoundError");
    this.files.delete(name);
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

import { deleteSidecarSiblings as fsaDelete } from "@/lib/storage-fsa";
import { deleteSidecarSiblings as devDelete } from "@/lib/storage-dev";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";

function seedFsa(): FakeDirHandle {
  docHandle = new FakeDirHandle(DOC_ID);
  const virgil = new FakeDirHandle("virgil");
  for (const n of SEEDED) virgil.files.set(n, "{}");
  docHandle.dirs.set("virgil", virgil);
  return virgil;
}

/** The dev backend's only I/O is `fetch`. */
function seedDev(): { names: Set<string>; deletes: string[] } {
  const names = new Set(SEEDED);
  const deletes: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string }) => {
      if (String(url).endsWith("_sidecar-names")) {
        return { ok: true, json: async () => ({ names: [...names] }) } as Response;
      }
      if (init?.method === "DELETE") {
        const name = decodeURIComponent(String(url).split("/virgil/")[1]!);
        deletes.push(name);
        names.delete(name);
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, json: async () => ({}) } as Response;
    }),
  );
  return { names, deletes };
}

beforeEach(() => {
  resetPipelines();
  vi.unstubAllGlobals();
});

describe.each([
  ["storage-fsa", "fsa"],
  ["storage-dev", "dev"],
] as const)("sync-conflict cleanup — the DOOR (%s)", (_label, which) => {
  async function run(names: readonly string[]) {
    const h = beginDocPipeline(DOC_ID);
    if (which === "fsa") {
      const virgil = seedFsa();
      const receipt = await fsaDelete(h, names);
      return { receipt, onDisk: new Set(virgil.files.keys()), virgil };
    }
    const { names: live } = seedDev();
    const receipt = await devDelete(h, names);
    return { receipt, onDisk: live, virgil: null };
  }

  it("asked to delete EVERYTHING, removes only what the plan sanctions", async () => {
    // The defect leg: a door that trusted its argument would delete the
    // content fork — the user's unmerged writing — and both live sidecars.
    const { receipt, onDisk } = await run(SEEDED);
    expect(receipt.deleted.sort()).toEqual([SWAP, VIEW_FORK].sort());
    expect(receipt.refused.sort()).toEqual(
      [CONTENT_FORK, "notes.json", "editor-state.json"].sort(),
    );
    expect(receipt.failed).toEqual([]);
    // …and every refused byte is still there.
    expect(onDisk.has(CONTENT_FORK)).toBe(true);
    expect(onDisk.has("notes.json")).toBe(true);
    expect(onDisk.has("editor-state.json")).toBe(true);
    expect(onDisk.has(VIEW_FORK)).toBe(false);
    expect(onDisk.has(SWAP)).toBe(false);
  });

  it("a name already gone is in NO bucket — nothing deleted, nothing kept", async () => {
    const { receipt } = await run(["notes (Gabriel Greenberg's conflicted copy 2020-01-01).json"]);
    expect(receipt).toEqual({ deleted: [], refused: [], failed: [] });
  });

  it("removes nothing when asked for nothing", async () => {
    const { receipt, onDisk } = await run([]);
    expect(isEmptyCleanupReceipt(receipt)).toBe(true);
    expect(onDisk.size).toBe(SEEDED.length);
  });
});

describe("sync-conflict cleanup — an IO failure is REPORTED, not counted as a delete", () => {
  it("(storage-fsa)", async () => {
    const h = beginDocPipeline(DOC_ID);
    const virgil = seedFsa();
    virgil.failOn.add(VIEW_FORK);
    const receipt = await fsaDelete(h, [VIEW_FORK, SWAP]);
    expect(receipt.deleted).toEqual([SWAP]);
    expect(receipt.failed).toEqual([VIEW_FORK]);
    expect(virgil.files.has(VIEW_FORK)).toBe(true);
  });

  it("(storage-dev)", async () => {
    const h = beginDocPipeline(DOC_ID);
    const names = new Set(SEEDED);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (String(url).endsWith("_sidecar-names")) {
          return { ok: true, json: async () => ({ names: [...names] }) } as Response;
        }
        if (init?.method === "DELETE") {
          const name = decodeURIComponent(String(url).split("/virgil/")[1]!);
          if (name === VIEW_FORK) return { ok: false, json: async () => ({}) } as Response;
          names.delete(name);
          return { ok: true, json: async () => ({ ok: true }) } as Response;
        }
        return { ok: false, json: async () => ({}) } as Response;
      }),
    );
    const receipt = await devDelete(h, [VIEW_FORK, SWAP]);
    expect(receipt.deleted).toEqual([SWAP]);
    expect(receipt.failed).toEqual([VIEW_FORK]);
    expect(names.has(VIEW_FORK)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Leg 5 — the CENSUS
// ---------------------------------------------------------------------------

function read(rel: string): string {
  return codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"));
}

/** The declaration body of `deleteSidecarSiblings` in one backend source. */
function doorRegion(src: string): string {
  const i = src.indexOf("export async function deleteSidecarSiblings");
  expect(i, "the backend must export the door").toBeGreaterThan(-1);
  const rest = src.slice(i);
  const end = rest.indexOf("\nexport ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}

describe("sync-conflict cleanup — CENSUS", () => {
  const BACKENDS = ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"];

  it("every backend door re-derives the set through planSidecarCleanup", () => {
    for (const rel of BACKENDS) {
      const region = doorRegion(read(rel));
      expect(region, `${rel}: the door must ask the plan`).toContain(
        "planSidecarCleanup(",
      );
      // …from a listing it read ITSELF, inside the critical section — a plan
      // computed over the caller's `names` would re-derive nothing.
      expect(region, `${rel}: the plan must be fed the FRESH listing`).toMatch(
        /planSidecarCleanup\(onDisk\)/,
      );
    }
  });

  it("no production file outside the ONE runner calls the door", () => {
    // A second cleanup site would skip the handle guard and the re-scan that
    // makes the notice converge — the `snapshotForStack` shape (task 332).
    const ALLOWED = new Set([
      "src/lib/storage.ts", // the barrel re-export
      "src/lib/storage-fsa.ts",
      "src/lib/storage-dev.ts",
      "src/lib/sync-conflict-scan.ts", // runSyncConflictCleanup — the one runner
    ]);
    const hits: string[] = [];
    for (const file of walk(path.join(REPO, "src"))) {
      const rel = path.relative(REPO, file);
      if (ALLOWED.has(rel)) continue;
      if (/\bdeleteSidecarSiblings\b/.test(codeOnly(fs.readFileSync(file, "utf8")))) {
        hits.push(rel);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the badge derives its set through the plan and names no file itself", () => {
    const badge = read("src/components/SyncConflictBadge.tsx");
    expect(badge).toContain("planSidecarCleanup(");
    expect(badge).toContain("runSyncConflictCleanup(");
    // It must not re-derive the verdict: no tier read, no grammar of its own.
    // (The menu's PROSE may still name `.crswap` — describing debris is not
    // deciding it.)
    expect(badge).not.toMatch(/\bsidecarTier\b/);
    expect(badge).not.toMatch(/\bclassifySidecarSibling\b/);
    expect(badge).not.toMatch(/conflicted copy/);
  });

  it("the in-app rule stays DECLARATIONS-only — no byte comparison", () => {
    // The offline tool prunes a CONTENT fork whose parsed JSON matches the live
    // file, and it is right to: it runs with the app closed, on an operator's
    // decision. In-app that is a verdict the user cannot see, and a second copy
    // of the inert test is the third speller this cluster keeps retiring.
    const plan = read("src/lib/sync-conflict-cleanup.ts");
    expect(plan).not.toMatch(/deepEqual|JSON\.parse|readSidecar/);
    // …and the module stays a leaf on the two SSOTs. Read RAW: `codeOnly`
    // blanks string literals, which is exactly where a module specifier lives.
    const raw = fs.readFileSync(
      path.join(REPO, "src/lib/sync-conflict-cleanup.ts"),
      "utf8",
    );
    const imports = [...raw.matchAll(/^import .*? from "([^"]+)";/gm)].map(
      (m) => m[1]!,
    );
    expect(imports.sort()).toEqual(["@/lib/sidecar-value", "@/lib/sync-conflict"]);
  });

  it("CANARY — the door census can see a violation", () => {
    // Synthetic, not standing on a drained production line: a fake door body
    // that removes straight from its argument must fail the plan needle.
    const fake = `export async function deleteSidecarSiblings(h, names) {
      for (const n of names) await virgil.removeEntry(n);
    }`;
    expect(doorRegion(fake)).not.toContain("planSidecarCleanup(");
  });
});

// A type-only pin: the plan entry's reason union is what the confirm copy
// branches on, so a third reason must be a deliberate change rather than a
// silent widening of what Virgil will delete.
const _reasons: SidecarCleanupEntry["reason"][] = ["view-tier", "swap"];
void _reasons;
