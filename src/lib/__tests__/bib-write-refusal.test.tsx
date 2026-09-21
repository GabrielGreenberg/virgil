// @vitest-environment jsdom
//
// **A `references.bib` write that did not land is SAID, and the view stops
// standing as truth** — task 685.
//
// Editing a bibliography entry is optimistic: the panel's React state moves
// first and the disk write is fire-and-forget. That is fine while the write
// lands. It was never reported when it did NOT — `mutateProjectBib` answered a
// single `null` for five different outcomes, and the one that mattered (a
// genuine IO throw) was `console.error`'d. No publish meant no convergence
// pass, so nothing ever corrected the in-memory list: the card read saved, the
// file never changed, and for the rest of the session every later read, every
// citation display and the user's own eyes agreed on a bibliography that does
// not exist on disk.
//
// `references.bib` is CONTENT — the user's bibliography, cited by the `.tex` —
// and it was the LAST content file on the old silent swallow. Task 637 gave
// exactly this treatment to every `virgil/` sidecar over task 630's ONE
// channel; this suite is that channel's bib half, and its legs are the ones
// the defect turns on:
//
//   1. FAILED (the write threw) → the user is told, in the file's own noun and
//      the error's own words, AND the phantom list is reconciled off the
//      screen against the disk.
//   2. NOT APPLICABLE (no doc / no handle / a library paper the door refuses)
//      → distinguishable at the door, and SILENT: the bib's writers include
//      window-event listeners that fire in every mounted library tab for a
//      `docId` that need not be this pane's, so a band there would be noise
//      about a paper the user is not editing.
//   3. DECLINED / STALE → silent, and not reconciled.
//   4. The appender stops conflating "every key was already there" with "the
//      write failed" in one number.
//
// The door mock is `bib-authority`'s verbatim (read → mutate → write inside
// ONE task on the REAL per-key write queue), with a `mode` switch for the
// failure shapes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { codeOnly, strip } from "./_source-scan";
import { flushPrefix } from "@/lib/write-queue";

// ---------------------------------------------------------------------------
// The slow, serialized door + a pure reader, over one string.
// ---------------------------------------------------------------------------
let DISK = "";
const tick = () => new Promise((r) => setTimeout(r, 0));

/** How the next bib write behaves. `"library-paper"` is the shape the door has
 *  when it refuses the file — it resolves `null` WITHOUT ever running the text
 *  mutator; `"throw"` is a real write failure; `"stale"` is the doc switching
 *  under the write. */
const mode: { value: "ok" | "throw" | "library-paper" | "stale" } = { value: "ok" };
const writeError = new Error("The requested file could not be written");
const staleError = Object.assign(new Error("pipeline superseded"), {
  name: "StalePipelineError",
});

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
          if (mode.value === "library-paper") return null; // mutator never runs
          if (mode.value === "stale") throw staleError;
          const next = mutate(DISK);
          if (next === null) return null;
          await tick(); // the write
          if (mode.value === "throw") throw writeError;
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
  isBibWriteRefused,
} from "@/lib/project-bib";
import { parseBibFile } from "@/lib/bib-parser";
import {
  getSidecarRefusal,
  resetSidecarRefusals,
} from "@/lib/sidecar-refusal";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import type { BibEntry } from "@/lib/types";

const DOC = "doc-685";

const block = (key: string, title = key.toUpperCase()) =>
  `@book{${key},\n  title = {${title}},\n}\n`;
const keysOnDisk = (): string[] => parseBibFile(DISK).map((e) => e.key);
const entry = (key: string): Omit<BibEntry, "uid"> & { uid?: string } => ({
  key,
  type: "book",
  fields: { title: key.toUpperCase() },
  raw: `@book{${key},\n  title = {${key.toUpperCase()}},\n}`,
});

/** Drain the REAL per-key queue and let the continuations (the publish, the
 *  hook's adopt, the reconcile re-read) land — never a wall-clock wait. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round++) {
      await flushPrefix(DOC);
      await tick();
    }
  });
}

async function mountWith(text: string) {
  DISK = text;
  beginDocPipeline(DOC);
  const { result } = renderHook(() => useCitations(DOC));
  await waitFor(() =>
    expect(result.current.bibEntries.length).toBe(parseBibFile(text).length),
  );
  return result;
}

beforeEach(() => {
  DISK = "";
  mode.value = "ok";
  resetPipelines();
  resetSidecarRefusals();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSidecarRefusals();
  resetPipelines();
});

// ---------------------------------------------------------------------------
// 1. The door REPORTS which outcome — the sentinel is gone.
// ---------------------------------------------------------------------------

describe("mutateProjectBib reports WHICH outcome", () => {
  it("tells a declined mutator apart from a door that refused the file", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    // The mutator ran and said "nothing to change".
    expect((await mutateProjectBib(DOC, () => null)).kind).toBe("declined");
    // The door short-circuited (a library paper) — the mutator never ran. The
    // old `null` could not tell these apart, which is why nothing could act on
    // either.
    mode.value = "library-paper";
    expect((await mutateProjectBib(DOC, (es) => [...es])).kind).toBe("read-only");
  });

  it("reports no-handle, stale and failed as different things", async () => {
    DISK = block("a");
    expect((await mutateProjectBib(null, (es) => es)).kind).toBe("no-handle");
    expect((await mutateProjectBib("never-opened", (es) => es)).kind).toBe("no-handle");
    beginDocPipeline(DOC);
    mode.value = "stale";
    expect((await mutateProjectBib(DOC, (es) => [...es])).kind).toBe("stale");
    mode.value = "throw";
    const failed = await mutateProjectBib(DOC, (es) => [...es, ...parseBibFile(block("b"))]);
    expect(failed.kind).toBe("failed");
    expect(failed.kind === "failed" && failed.error).toBe(writeError);
    expect(keysOnDisk()).toEqual(["a"]); // the file really did not change
  });

  it("the refusal predicate covers exactly the three kinds that mean 'not on disk, ever'", () => {
    expect(isBibWriteRefused({ kind: "no-handle" })).toBe(true);
    expect(isBibWriteRefused({ kind: "read-only" })).toBe(true);
    expect(isBibWriteRefused({ kind: "failed", error: writeError })).toBe(true);
    expect(isBibWriteRefused({ kind: "declined" })).toBe(false);
    expect(isBibWriteRefused({ kind: "stale" })).toBe(false);
    expect(
      isBibWriteRefused({ kind: "written", entries: [], bibText: "" }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. A FAILED write reaches the user — on the ONE channel.
// ---------------------------------------------------------------------------

describe("a failed references.bib write is published to the user", () => {
  it("FAILED: the refusal carries the file's noun and the error's own words", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    mode.value = "throw";
    await mutateProjectBib(DOC, (es) => [...es, ...parseBibFile(block("b"))]);
    const refusal = getSidecarRefusal(DOC);
    expect(refusal).not.toBeNull();
    expect(refusal?.reason).toBe("failed");
    expect(refusal?.what).toBe("bibliography");
    expect(refusal?.detail).toBe(writeError.message);
  });

  it("every door voices it — the appender and the remover, not just the raw mutator", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    mode.value = "throw";
    const added = await addEntriesToProjectBib(DOC, [entry("b")]);
    expect(added).toEqual({ appended: 0, result: { kind: "failed", error: writeError } });
    expect(getSidecarRefusal(DOC)?.reason).toBe("failed");
    resetSidecarRefusals();
    expect((await removeEntryFromProjectBib(DOC, "a")).kind).toBe("failed");
    expect(getSidecarRefusal(DOC)?.reason).toBe("failed");
  });

  it("NOT APPLICABLE stays silent: no doc, no handle, and a library paper say nothing", async () => {
    DISK = block("a");
    await mutateProjectBib(null, (es) => es);
    await mutateProjectBib("never-opened", (es) => es);
    beginDocPipeline(DOC);
    mode.value = "library-paper";
    await mutateProjectBib(DOC, (es) => [...es]);
    expect(getSidecarRefusal(DOC)).toBeNull();
    expect(getSidecarRefusal("never-opened")).toBeNull();
  });

  it("a DECLINED mutator, a STALE pipeline and a LANDED write say nothing", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    await mutateProjectBib(DOC, () => null);
    mode.value = "stale";
    await mutateProjectBib(DOC, (es) => [...es]);
    mode.value = "ok";
    await addEntriesToProjectBib(DOC, [entry("b")]);
    expect(keysOnDisk()).toEqual(["a", "b"]);
    expect(getSidecarRefusal(DOC)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The optimistic view does not keep un-persisted content.
// ---------------------------------------------------------------------------

describe("the panel's view is reconciled against the disk on a failed write", () => {
  it("DEFECT: a failed edit does not survive in the view as if it were saved", async () => {
    const result = await mountWith(block("a", "Original"));
    mode.value = "throw";
    await act(async () => {
      result.current.updateBibEntry("a", { title: "Never landed" });
    });
    await settle();
    // The file is untouched …
    expect(DISK).toContain("title = {Original}");
    // … and so, now, is the view: it re-read rather than standing as truth for
    // the rest of the session.
    expect(result.current.bibEntries[0]?.fields.title).toBe("Original");
    expect(result.current.bibRaw).toBe(DISK);
    // … and the user was told.
    expect(getSidecarRefusal(DOC)?.reason).toBe("failed");
  });

  it("a write that LANDS is adopted, not re-read away", async () => {
    const result = await mountWith(block("a", "Original"));
    await act(async () => {
      result.current.updateBibEntry("a", { title: "Saved" });
    });
    await settle();
    expect(DISK).toContain("title = {Saved}");
    expect(result.current.bibEntries[0]?.fields.title).toBe("Saved");
    expect(getSidecarRefusal(DOC)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. The appender's count stops conflating duplicate with failed.
// ---------------------------------------------------------------------------

describe("addEntriesToProjectBib: 0 appended is never a bare number", () => {
  it("a duplicate and a failed write are different answers", async () => {
    DISK = block("a");
    beginDocPipeline(DOC);
    const duplicate = await addEntriesToProjectBib(DOC, [entry("a")]);
    expect(duplicate).toEqual({ appended: 0, result: { kind: "declined" } });
    mode.value = "throw";
    const failed = await addEntriesToProjectBib(DOC, [entry("b")]);
    expect(failed.appended).toBe(0);
    expect(failed.result.kind).toBe("failed");
    // The count alone — the whole of the old return value — says the same
    // thing for both, which is the conflation this leg pins.
    expect(duplicate.appended).toBe(failed.appended);
  });

  it("an empty / key-less call declines without asking the door", async () => {
    beginDocPipeline(DOC);
    expect(await addEntriesToProjectBib(DOC, [])).toEqual({
      appended: 0,
      result: { kind: "declined" },
    });
    expect(await addEntriesToProjectBib("", [entry("a")])).toEqual({
      appended: 0,
      result: { kind: "no-handle" },
    });
  });
});

// ---------------------------------------------------------------------------
// 5. CENSUS — one publisher, and no door left on the sentinel.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../../..");
const prodCode = (f: string) => codeOnly(fs.readFileSync(path.join(REPO, f), "utf8"));

describe("census · the bib's failure report has ONE publisher", () => {
  it("the authority is the only file that voices a bib refusal", () => {
    const bib = prodCode("src/lib/project-bib.ts");
    expect(bib).toMatch(/\brecordSidecarRefusal\(/);
    // Nowhere else: not the hook, not the library tab that drops entries in.
    expect(prodCode("src/hooks/useCitations.ts")).not.toMatch(/\brecordSidecarRefusal\b/);
    expect(prodCode("src/components/library/LibraryTabView.tsx")).not.toMatch(
      /\brecordSidecarRefusal\b/,
    );
  });

  it("no bib door still answers the old undistinguishable sentinel", () => {
    const bib = prodCode("src/lib/project-bib.ts");
    // Every exported door resolves the discriminated result …
    expect(bib).toMatch(/Promise<BibWriteResult>/);
    expect(bib).toMatch(/Promise<BibAppendResult>/);
    // … and none of them resolves `| null` any more.
    expect(bib).not.toMatch(/Promise<BibMutationResult \| null>/);
    expect(bib).not.toMatch(/Promise<number>/);
    expect(bib).not.toMatch(/Promise<boolean>/);
  });

  it("the hook RECONCILES rather than trusting its own preview", () => {
    // `keepStrings` — the needle is a comparison against a QUOTED kind, which
    // `codeOnly` would blank out, making the leg unfalsifiable.
    const hook = strip(
      fs.readFileSync(path.join(REPO, "src/hooks/useCitations.ts"), "utf8"),
      true,
    );
    // The optimistic apply is still there (the UI must not wait on the disk),
    // but it is no longer the last word: a `failed` result re-reads the file.
    expect(hook).toMatch(/mutateProjectBib\(docId, mutate\)/);
    expect(hook).toMatch(/result\.kind === "failed"/);
    expect(hook).toMatch(/refreshBib\(docId\)/);
  });
});
