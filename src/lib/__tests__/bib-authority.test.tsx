// @vitest-environment jsdom
//
// `references.bib` has ONE serialized authority (task 558).
//
// The defect this pins is task 220's lost update, one file over: every in-app
// bib writer persisted a WHOLE-FILE snapshot computed from a base it had read
// earlier, OUTSIDE the lock — the Bibliography panel's React state (seeded once
// per doc, refreshed only by an in-app window event) or a `readBib` a few
// awaits before the write. Two writers racing off different bases dropped the
// earlier one's entry; an `/editor/*` skill's entry was destroyed by the user's
// next bib edit; and a peer window's addition was never learned about at all.
// Each writer was internally consistent and only ever wrong about what the
// OTHER had done, so nothing threw and no single-writer suite could see it.
//
// Three shapes of leg, none of which an isolated test of one writer can be:
//
//   1. CONCURRENCY — the REAL hook and the REAL `project-bib` writers
//      overlapping over a slow, serialized door, which is where a base read
//      outside the section (or a snapshot persist from stale React state)
//      loses the other's change.
//   2. CONVERGENCE — the hook adopts the AUTHORITATIVE post-write list, so its
//      view carries what a peer/skill landed, not merely what it typed.
//   3. CENSUS — the leg with teeth: the authority was never the part that could
//      misbehave; a call site that serializes the whole bib itself, or reaches
//      the door without asking it, is — and that type-checks perfectly.
//
// The door mock below is the `ai-requests-authority` harness verbatim, over a
// TEXT (the door is text-shaped; parse/serialize live in the authority):
// read → mutate → write inside ONE task on the REAL per-key write queue, with
// an await on each half. `bib-mutate-door.test.ts` proves the SHIPPED doors
// have that shape; this suite proves everything ABOVE them uses it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./_source-scan";
import { flushPrefix } from "@/lib/write-queue";

// ---------------------------------------------------------------------------
// The slow, serialized door + a pure reader, over one string.
// ---------------------------------------------------------------------------
let DISK = "";
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock("@/lib/storage", async () => {
  const { enqueueWrite } = await import("@/lib/write-queue");
  return {
    readSidecar: vi.fn(async () => ({})),
    readSidecarIfExists: vi.fn(async () => null),
    writeSidecar: vi.fn(async () => undefined),
    readBib: vi.fn(async () => ({
      bibText: DISK,
      bibFilename: "references.bib",
      detectedPackage: "natbib",
    })),
    mutateBib: vi.fn(
      async (h: { docId: string }, mutate: (current: string) => string | null) =>
        enqueueWrite(`${h.docId}/bib/references.bib`, async () => {
          await tick(); // the base read — INSIDE the critical section
          const next = mutate(DISK);
          if (next === null) return null;
          await tick(); // the write
          DISK = next;
          return next;
        }),
    ),
  };
});

import { useCitations } from "@/hooks/useCitations";
import {
  addEntriesToProjectBib,
  removeEntryFromProjectBib,
  mutateProjectBib,
  DOC_BIB_CHANGED_EVENT,
} from "@/lib/project-bib";
import { parseBibFile } from "@/lib/bib-parser";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import type { BibEntry } from "@/lib/types";
import { namedBibEntry } from "@/lib/bib-test-entry";

const DOC = "doc-558";

const block = (key: string, title = key.toUpperCase()) =>
  `@book{${key},\n  title = {${title}},\n}\n`;
const keysOnDisk = (): string[] => parseBibFile(DISK).map((e) => e.key);
const entry = (key: string): Omit<BibEntry, "uid"> & { uid?: string } => ({
  key,
  type: "book",
  fields: { title: key.toUpperCase() },
  raw: `@book{${key},\n  title = {${key.toUpperCase()}},\n}`,
});

/**
 * Wait for the doc's writes to LAND and for the hook to adopt the publish.
 *
 * A DRAIN of the real per-key queue, never a wall-clock wait (task 566). The
 * first version waited 40 ms; a timer is a guess about scheduler load, and
 * the deploy gate's runner is the one place the guess is wrong: there a
 * queued mutation — or the `DOC_BIB_CHANGED_EVENT` publish the still-mounted
 * hook adopts via `setState` — resolved AFTER the file had finished and
 * jsdom was gone, and React committed on a `window` that no longer existed.
 * Seven of them did, with all 11,663 tests passing, and vitest exited 1.
 *
 * Two rounds, and each round is a drain plus ONE tick: the queue's tracked
 * promise settles a microtask before `mutateProjectBib`'s own continuation
 * (the publish, then the hook's adopt) runs, so the tick after the drain is
 * what lets those land; and a continuation may enqueue again, which the
 * second drain catches. The door stays SLOW on purpose — its two awaits are
 * what make the concurrency legs falsifiable — the fix is to WAIT for it
 * correctly, not to speed it up.
 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 2; round++) {
      await flushPrefix(DOC);
      await tick();
    }
  });
}

async function mountWith(text: string) {
  DISK = text;
  beginDocPipeline(DOC);
  const { result } = renderHook(() => useCitations(DOC));
  await waitFor(() => expect(result.current.bibEntries.length).toBe(parseBibFile(text).length));
  return result;
}

beforeEach(() => {
  DISK = "";
  resetPipelines();
});

// No write may outlive the test that queued it, whatever a test asserted:
// drain the doc's queue before the next test (and before the FILE ends) so
// the slow door's timers cannot fire into a torn-down environment. The hook
// itself is unmounted by the repo-wide `afterEach(cleanup)` in
// `vitest.setup.ts`; this is the other half of the same lifetime.
afterEach(async () => {
  await flushPrefix(DOC);
  await tick();
});

// ---------------------------------------------------------------------------
// 1. CONCURRENCY + 2. CONVERGENCE — the hook
// ---------------------------------------------------------------------------

describe("useCitations: bib writes are merges over the DISK, not snapshots of the view", () => {
  it("DEFECT (M2): an entry a skill landed after this hook's read survives the hook's next edit", async () => {
    // The out-of-process writer, reduced to its mechanism: the file gains an
    // entry with NO in-process publish, so the hook's state is stale. Its next
    // mutation must merge over disk. The pre-558 whole-snapshot persist wrote
    // the stale list and the skill's entry vanished — along with the only
    // local copy of an entry the skill had fetched.
    const result = await mountWith(block("mine"));
    DISK = block("mine") + block("fromskill"); // no publish, no event

    act(() => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "mine"), { title: "Edited" });
    });
    await settle();

    expect(keysOnDisk()).toEqual(["mine", "fromskill"]);
    expect(DISK).toContain("title = {Edited}");
    // …and the view CONVERGED on the authoritative list rather than keeping
    // its stale snapshot.
    expect(result.current.bibEntries.map((e) => e.key)).toEqual(["mine", "fromskill"]);
    expect(result.current.bibRaw).toBe(DISK);
  });

  it("DEFECT (M1): two overlapping hook mutations both land", async () => {
    // A bib card's Save and a library auto-add in the same tick — the shape
    // `useAutoAddLibraryEntriesForCitations` warns about in its own header.
    const result = await mountWith(block("a"));
    act(() => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "a"), { title: "A2" });
      result.current.addBibEntry({ ...entry("b"), uid: "" });
    });
    await settle();

    expect(keysOnDisk()).toEqual(["a", "b"]);
    expect(DISK).toContain("title = {A2}");
    expect(result.current.bibEntries.map((e) => e.key)).toEqual(["a", "b"]);
  });

  it("editing an entry a peer already removed does NOT resurrect it", async () => {
    const result = await mountWith(block("gone") + block("stay"));
    DISK = block("stay"); // the peer removed it

    act(() => {
      result.current.replaceBibEntry(namedBibEntry(result.current.bibEntries, "gone"), { title: "back?" }, "article");
    });
    await settle();

    expect(keysOnDisk()).toEqual(["stay"]);
  });

  it("a citekey rename lands on the DISK base and keeps a peer's entry", async () => {
    const result = await mountWith(block("old"));
    DISK = block("old") + block("peer");
    act(() => {
      result.current.updateBibKeyAndType(namedBibEntry(result.current.bibEntries, "old"), "new", "book");
    });
    await settle();
    expect(keysOnDisk()).toEqual(["new", "peer"]);
  });

  it("a fresh entry's uid is minted ONCE, outside the mutator — the view and the disk agree", async () => {
    // The mutator runs twice (view, then disk). A uid minted INSIDE it would
    // differ per run, and the identity spine (annotations, the rename cascade)
    // would briefly anchor to an id the file never held.
    const result = await mountWith(block("a"));
    act(() => {
      result.current.addBibEntry({ ...entry("b"), uid: "" });
    });
    const viewUid = result.current.bibEntries.find((e) => e.key === "b")!.uid;
    expect(viewUid).toMatch(/^[0-9a-f]{4}$/);
    await settle();
    expect(DISK).toContain(`\\vbid{${viewUid}}`);
    expect(result.current.bibEntries.find((e) => e.key === "b")!.uid).toBe(viewUid);
  });

  it("the view adopts a publish from ANOTHER writer in this window (a Library drop)", async () => {
    const result = await mountWith(block("a"));
    await act(async () => {
      expect((await addEntriesToProjectBib(DOC, [entry("dropped")])).appended).toBe(1);
    });
    await settle();
    expect(result.current.bibEntries.map((e) => e.key)).toEqual(["a", "dropped"]);
    expect(result.current.bibRaw).toBe(DISK);
  });
});

// ---------------------------------------------------------------------------
// 1. CONCURRENCY — the project-bib writers
// ---------------------------------------------------------------------------

describe("project-bib: the Library drop and the panel save compose", () => {
  it("DEFECT (M1): a drop racing a card Save — both land", async () => {
    const result = await mountWith(block("a"));
    await act(async () => {
      const drop = addEntriesToProjectBib(DOC, [entry("dropped")]);
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "a"), { title: "Saved" });
      await drop;
    });
    await settle();
    expect(keysOnDisk()).toEqual(["a", "dropped"]);
    expect(DISK).toContain("title = {Saved}");
  });

  it("a duplicate key appends nothing and says WHY; a removal reports its own outcome", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    // "0 appended" is never a bare number: the door's own verdict rides with
    // it, so a duplicate and a failed write cannot arrive as the same answer
    // (task 685).
    expect(await addEntriesToProjectBib(DOC, [entry("a")])).toEqual({
      appended: 0,
      result: { kind: "declined" },
    });
    expect((await addEntriesToProjectBib(DOC, [entry("a"), entry("b"), entry("b")])).appended).toBe(1);
    expect(keysOnDisk()).toEqual(["a", "b"]);
    expect((await removeEntryFromProjectBib(DOC, "a")).kind).toBe("written");
    expect((await removeEntryFromProjectBib(DOC, "a")).kind).toBe("declined");
    expect(keysOnDisk()).toEqual(["b"]);
  });

  it("a drop mints its uid against the uids ON DISK, so it cannot collide with a peer's", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    await addEntriesToProjectBib(DOC, [entry("b")]);
    const uids = parseBibFile(DISK).map((e) => e.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("a declined / handle-less mutation publishes nothing", async () => {
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(DOC_BIB_CHANGED_EVENT, onEvent);
    try {
      DISK = block("a");
      // No pipeline for this doc ⇒ no active write handle ⇒ null.
      expect((await mutateProjectBib("no-such-doc", (es) => es)).kind).toBe("no-handle");
      beginDocPipeline(DOC);
      expect((await mutateProjectBib(DOC, () => null)).kind).toBe("declined");
      expect(seen).toEqual([]);
      const out = await mutateProjectBib(DOC, (es) => [...es]);
      expect(out.kind === "written" && out.bibText).toBe(DISK);
      expect(seen).toHaveLength(1);
    } finally {
      window.removeEventListener(DOC_BIB_CHANGED_EVENT, onEvent);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. CENSUS — the authority was never the part that could misbehave.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(REPO, p);
const isTest = (p: string) => /__tests__|\.test\.tsx?$/.test(p);
const PROD_FILES = [
  ...walk(path.join(REPO, "src")),
  ...walk(path.join(REPO, "library")),
].filter((f) => !isTest(f));
const prodCode = (f: string) => codeOnly(fs.readFileSync(f, "utf8"));

/** The files entitled to spell the door: its two definitions, the barrel that
 *  re-exports it, and the ONE authority that calls it. May only shrink. */
const PERMITTED_MUTATE_BIB_SPELLERS = new Set([
  "src/lib/storage-fsa.ts",
  "src/lib/storage-dev.ts",
  "src/lib/storage.ts",
  "src/lib/project-bib.ts",
]);

/** The files entitled to serialize a WHOLE `.bib`: the two parsers that
 *  define the serializer, and the authority. A writer that serializes the
 *  whole file itself is holding a snapshot — the shape this suite retires. */
const PERMITTED_WHOLE_BIB_SERIALIZERS = new Set([
  "src/lib/bib-parser.ts",
  "library/lib/bib-parser.ts",
  "src/lib/project-bib.ts",
]);

describe("census · references.bib has ONE write authority", () => {
  it("the whole-snapshot door `writeBib` is retired in both silos", () => {
    const hits = PROD_FILES.filter((f) => /\bwriteBib\b/.test(prodCode(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("`mutateBib` is spelled only by its definitions, the barrel, and the authority", () => {
    const hits = PROD_FILES.filter((f) => /\bmutateBib\b/.test(prodCode(f))).map(rel);
    expect(hits.sort()).toEqual([...PERMITTED_MUTATE_BIB_SPELLERS].sort());
  });

  it("no production file outside the authority serializes the whole bib", () => {
    // `Against` is the SPLICE form the authority writes through since task 688
    // (the whole-file rebuild it replaced deleted every byte the model cannot
    // represent). Both spellings are the same question — who writes the whole
    // file — so the census asks about both, and the answer is the same set.
    const hits = PROD_FILES.filter((f) => /\bserializeBibFile(?:Against)?\(/.test(prodCode(f))).map(rel);
    expect(hits.sort()).toEqual([...PERMITTED_WHOLE_BIB_SERIALIZERS].sort());
  });

  it("only the authority DISPATCHES the bib-changed event; the hook only listens", () => {
    const dispatchers = PROD_FILES.filter((f) => {
      const code = prodCode(f);
      return /\bDOC_BIB_CHANGED_EVENT\b/.test(code) && /\bdispatchEvent\(/.test(code);
    }).map(rel);
    expect(dispatchers).toEqual(["src/lib/project-bib.ts"]);
  });

  it("the hook enters the authority for every bib write and keeps no snapshot persist", () => {
    const code = prodCode(path.join(REPO, "src/hooks/useCitations.ts"));
    expect(code).toMatch(/\bmutateProjectBib\(/);
    expect(code).not.toMatch(/\bpersistBib\b/);
    expect(code).not.toMatch(/\bserializeBibFile\b/);
    // Every bib mutator routes through the ONE runner: updateBibEntry,
    // replaceBibEntry, applyBibKeyType (both rename paths) and addBibEntry —
    // an EXACT count, so a fifth mutator that grows its own persist is a
    // failure here rather than a silent sixth writer.
    expect((code.match(/\brunBibMutation\(/g) ?? []).length).toBe(4);
    expect(code).not.toMatch(/\bsetBibRaw\(\s*serialize/);
  });

  it("the census can SEE a rogue speller (canary)", () => {
    const fixture = 'import { mutateBib } from "@/lib/storage";\nawait mutateBib(h, (t) => t + block);\n';
    expect(/\bmutateBib\b/.test(codeOnly(fixture))).toBe(true);
    expect(/\bmutateBib\b/.test(codeOnly("// mutateBib is the door\n"))).toBe(false);
  });
});
