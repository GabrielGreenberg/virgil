// @vitest-environment jsdom
//
// Task 691 — ONE Save on a bibliography entry is ONE write to `references.bib`.
//
// A Save whose FIELDS and CITEKEY both changed used to fire two mutations
// back-to-back with nothing awaited between them: a set-all field write, then
// a head write. Both went to the `.bib`'s one serialized door, and a queue only
// orders what has reached it — neither call could reach it in its caller's tick,
// because the queue's key carried the `.bib` FILENAME and learning that name
// costs three-plus IO round trips. So the two raced. When the RENAME won, the
// field mutation ran against a list in which its target no longer had the key it
// had addressed, matched nothing, and was DECLINED — a silent outcome that
// triggers no re-read, so the card went on showing field edits the file never
// received. And even in the intended order they were two writes with two
// publishes: a throw on the second left the disk holding the new fields under
// the OLD key, which the failure path then re-read and adopted as the truth.
//
// The legs here drive the REAL write queue over a fake disk:
//   - a fields+key Save is ONE `mutateBib` call and the file holds BOTH halves;
//   - a Save that does not move the key still fans out to nothing;
//   - a write that THROWS does not fan the rename out to the document, and the
//     view is reconciled to the file rather than left standing as truth;
//   - an entry that is GONE from the file is reported (`not-found`), not
//     swallowed as `declined`.
//
// The door's own ordering half — that a bib write is enqueued in its caller's
// synchronous tick — is pinned one layer down, in `bib-mutate-door.test.ts`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { flushPrefix } from "@/lib/write-queue";

let DISK = "";
const tick = () => new Promise((r) => setTimeout(r, 0));
const mode: { value: "ok" | "throw" } = { value: "ok" };
const writeError = new Error("The requested file could not be written");

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
        enqueueWrite(`${h.docId}/bib`, async () => {
          await tick(); // the base read — INSIDE the critical section
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
import { mutateBib } from "@/lib/storage";
import { parseBibFile } from "@/lib/bib-parser";
import { isRenameCitekey } from "@/lib/identity/identity-cascade";
import { getSidecarRefusal, resetSidecarRefusals } from "@/lib/sidecar-refusal";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { namedBibEntry } from "@/lib/bib-test-entry";

const DOC = "doc-691";

const SMITH =
  "@article{smith2020,\n  author = {Smith, A.},\n  title = {Old Title},\n  year = {2020},\n}\n";

const entriesOnDisk = () => (DISK.trim() ? parseBibFile(DISK) : []);
const keysOnDisk = () => entriesOnDisk().map((e) => e.key);
const fieldsOnDisk = (key: string) =>
  entriesOnDisk().find((e) => e.key === key)?.fields ?? {};

/** Drain the REAL per-key queue and let the continuations (the publish, the
 *  hook's adopt, the fan-out) land — never a wall-clock wait. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 4; round++) {
      await flushPrefix(DOC);
      await tick();
    }
  });
}

/** Mount the hook on a loaded doc, with a recording rename migrator wired. */
async function mountLoaded(docId: string) {
  beginDocPipeline(docId);
  const { result } = renderHook(() => useCitations(docId));
  await waitFor(() => {
    expect(result.current.bibEntries.some((e) => e.key === "smith2020")).toBe(true);
  });
  const fanned: string[] = [];
  act(() => {
    result.current.identityCascade.registerMigrator("bibEntry", (c) => {
      if (isRenameCitekey(c)) {
        fanned.push(`${c.renameCitekey.oldKey}->${c.renameCitekey.newKey}`);
      }
    });
  });
  return { result, fanned };
}

beforeEach(() => {
  DISK = SMITH;
  mode.value = "ok";
  resetPipelines();
  resetSidecarRefusals();
  vi.mocked(mutateBib).mockClear();
});
afterEach(() => {
  mode.value = "ok";
});

describe("one Save is ONE write", () => {
  it("fields AND citekey land together, in a single mutation", async () => {
    const { result, fanned } = await mountLoaded(DOC);
    act(() => {
      result.current.saveBibEntry(namedBibEntry(result.current.bibEntries, "smith2020"), {
        fields: { author: "Smith, A.", title: "New Title", year: "2021" },
        type: "article",
        key: "smith2021",
      });
    });
    await settle();

    // ONE write. Two are what raced: pre-fix, when the rename reached the
    // queue first, the field mutation addressed a key that was no longer there
    // and was declined in silence.
    expect(vi.mocked(mutateBib)).toHaveBeenCalledTimes(1);
    // …and the file holds BOTH halves of the gesture.
    expect(keysOnDisk()).toEqual(["smith2021"]);
    expect(fieldsOnDisk("smith2021").title).toBe("New Title");
    expect(fieldsOnDisk("smith2021").year).toBe("2021");
    // The rename still fans out — after the write, not before it.
    expect(fanned).toEqual(["smith2020->smith2021"]);
  });

  it("a set-all field save DELETES a field the user cleared, in that same write", async () => {
    const { result, fanned } = await mountLoaded(DOC);
    act(() => {
      result.current.saveBibEntry(namedBibEntry(result.current.bibEntries, "smith2020"), {
        fields: { author: "Smith, A.", title: "Old Title" }, // `year` cleared
        type: "article",
        key: "smith2020", // unchanged
      });
    });
    await settle();

    expect(vi.mocked(mutateBib)).toHaveBeenCalledTimes(1);
    expect("year" in fieldsOnDisk("smith2020")).toBe(false);
    // A key that does not move is not an identity change: nothing fans out.
    expect(fanned).toEqual([]);
  });

  it("a retype is one write and no fan-out", async () => {
    const { result, fanned } = await mountLoaded(DOC);
    act(() => {
      result.current.saveBibEntry(namedBibEntry(result.current.bibEntries, "smith2020"), {
        type: "book",
      });
    });
    await settle();
    expect(vi.mocked(mutateBib)).toHaveBeenCalledTimes(1);
    expect(entriesOnDisk()[0].type).toBe("book");
    expect(fanned).toEqual([]);
  });
});

describe("a write that does not land is not adopted as truth", () => {
  it("a THROW leaves the paper's citations alone and reconciles the view to the file", async () => {
    const { result, fanned } = await mountLoaded(DOC);
    mode.value = "throw";
    act(() => {
      result.current.saveBibEntry(namedBibEntry(result.current.bibEntries, "smith2020"), {
        fields: { author: "Smith, A.", title: "New Title" },
        type: "article",
        key: "smith2021",
      });
    });
    await settle();

    // The rename did NOT reach disk, so the `\cite{}` fan-out must not run —
    // rewriting the paper's atoms for it is exactly the dangling reference the
    // rename door exists to prevent, arrived at from the other side.
    expect(fanned).toEqual([]);
    expect(keysOnDisk()).toEqual(["smith2020"]);
    // The user is told, and the optimistic view stops standing as truth.
    expect(getSidecarRefusal(DOC)?.reason).toBe("failed");
    await waitFor(() => {
      expect(result.current.bibEntries.map((e) => e.key)).toEqual(["smith2020"]);
    });
  });

  it("an entry the FILE no longer holds is reported, not swallowed as `declined`", async () => {
    const { result, fanned } = await mountLoaded(DOC);
    const stale = namedBibEntry(result.current.bibEntries, "smith2020");
    // Someone else — a skill, a peer window — removed the entry since this
    // view was published.
    DISK = "";
    act(() => {
      result.current.saveBibEntry(stale, {
        fields: { title: "New Title" },
        type: "article",
        key: "smith2021",
      });
    });
    await settle();

    expect(fanned).toEqual([]);
    expect(getSidecarRefusal(DOC)?.reason).toBe("failed");
    // The view converges on the file rather than showing a saved entry that
    // is not there.
    await waitFor(() => {
      expect(result.current.bibEntries).toHaveLength(0);
    });
  });
});

describe("the head door measures what the write CHANGES", () => {
  it("refuses an empty @type — the block the extractor cannot read back", async () => {
    const { result } = await mountLoaded(DOC);
    act(() => {
      result.current.saveBibEntry(namedBibEntry(result.current.bibEntries, "smith2020"), {
        type: "",
      });
    });
    await settle();
    expect(vi.mocked(mutateBib)).not.toHaveBeenCalled();
    expect(DISK).toBe(SMITH);
  });

  it("a duplicate citekey does not block an edit that leaves the key alone", async () => {
    // Two blocks under one citekey are representable, and task 690 stopped
    // HIDING the second precisely so the user could repair it. The absolute
    // head check called that a collision and refused to write the FIELDS of
    // either — an edit that touches no citekey, refused for a collision the
    // user did not create and could not clear without the edit.
    DISK = SMITH + "@article{smith2020,\n  title = {The Other One},\n}\n";
    const { result } = await mountLoaded(DOC);
    expect(result.current.bibEntries).toHaveLength(2);
    act(() => {
      result.current.saveBibEntry(result.current.bibEntries[0], {
        fields: { author: "Smith, A.", title: "Repaired" },
        type: "article",
        key: "smith2020",
      });
    });
    await settle();
    expect(vi.mocked(mutateBib)).toHaveBeenCalledTimes(1);
    expect(entriesOnDisk()[0].fields.title).toBe("Repaired");
    // …and ONLY that block: the hidden twin is untouched.
    expect(entriesOnDisk()[1].fields.title).toBe("The Other One");
  });

  it("still refuses a rename ONTO another entry's citekey", async () => {
    DISK = SMITH + "@article{jones1999,\n  title = {J},\n}\n";
    const { result } = await mountLoaded(DOC);
    act(() => {
      result.current.saveBibEntry(namedBibEntry(result.current.bibEntries, "smith2020"), {
        key: "jones1999",
        type: "article",
      });
    });
    await settle();
    expect(vi.mocked(mutateBib)).not.toHaveBeenCalled();
    expect(keysOnDisk()).toEqual(["smith2020", "jones1999"]);
  });
});
