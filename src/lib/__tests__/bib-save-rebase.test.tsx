// @vitest-environment jsdom
//
// Task 1359 — the bib card's "Edit entry" Save is a DELTA against what the
// editor opened on, rebased onto the live entry inside the serialized write.
//
// The editor seeds its fields/type/key ONCE and nothing re-seeds it, so a
// set-all Save of that map reverted every change another writer made while it
// was open: a field an agent ADDED was absent from the map and so DELETED, a
// corrected `@type` went back, and the verdict was `written`. The legs:
//   - pure three-way merge (`rebaseBibEdit`): untouched ⇒ live, changed ⇒ mine,
//     both changed apart ⇒ conflict; removals still delete (BIB-A3-02);
//   - through the REAL write queue over a fake disk: the file moves under a
//     STALE view, the user edits a different field, and the file ends up
//     holding both; a same-field conflict lands nothing and says so;
//   - an absolute (base-less) save keeps set-all — "Replace with library".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { flushPrefix } from "@/lib/write-queue";

let DISK = "";
const tick = () => new Promise((r) => setTimeout(r, 0));
const mode: { value: "ok" | "throw" } = { value: "ok" };
const writeError = new Error("The requested file could not be written");

vi.mock("@/lib/storage", async () => {
  const { enqueueWrite } = await import("@/lib/write-queue");
  return (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
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
  });
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
import { rebaseBibEdit } from "@/lib/bib-edit-rebase";
import {
  didBibSaveLand,
  bibSaveRefusalReason,
  type BibSaveResult,
} from "@/lib/project-bib";
import type { BibEntry } from "@/lib/types";

const DOC = "doc-1359";

const SMITH =
  "@misc{smith2020,\n  author = {Smith, A.},\n  title = {Old Title},\n  year = {2020},\n}\n";
/** What an agent / the code view / a peer window wrote while the editor was
 *  open: two fields added and the type corrected. */
const SMITH_AGENT =
  "@article{smith2020,\n  author = {Smith, A.},\n  title = {Old Title},\n  year = {2020},\n  doi = {10.1/x},\n  pages = {1--9},\n}\n";

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


const seedOf = (e: BibEntry) => ({ key: e.key, type: e.type, fields: { ...e.fields } });

describe("rebaseBibEdit — the pure three-way merge", () => {
  const seed = { key: "k", type: "misc", fields: { title: "T", year: "2020" } };

  it("an untouched part takes the LIVE value, incl. fields added or removed since the seed", () => {
    const live = { key: "k", type: "article", fields: { title: "T", doi: "d" } };
    const r = rebaseBibEdit(seed, { ...seed, fields: { ...seed.fields } }, live);
    expect(r).toEqual({ ok: true, key: "k", type: "article", fields: { title: "T", doi: "d" } });
  });

  it("a changed part takes MINE; a field the user removed is deleted", () => {
    const live = { key: "k", type: "misc", fields: { title: "T", year: "2020", doi: "d" } };
    const mine = { key: "k2", type: "misc", fields: { title: "New" } };
    const r = rebaseBibEdit(seed, mine, live);
    expect(r).toEqual({ ok: true, key: "k2", type: "misc", fields: { title: "New", doi: "d" } });
  });

  it("both sides moving one part to different values is a CONFLICT naming it", () => {
    const live = { key: "k", type: "book", fields: { title: "Agent", year: "2020" } };
    const mine = { key: "k", type: "article", fields: { title: "Mine", year: "2020" } };
    const r = rebaseBibEdit(seed, mine, live);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.conflicts).toEqual(["@type", "title"]);
      expect(r.reason).toContain("“title”");
    }
  });

  it("both sides making the SAME change is not a conflict", () => {
    const live = { key: "k", type: "misc", fields: { title: "Same", year: "2020" } };
    const mine = { key: "k", type: "misc", fields: { title: "Same", year: "2020" } };
    expect(rebaseBibEdit(seed, mine, live).ok).toBe(true);
  });
});

describe("a delta Save through the real write door", () => {
  it("keeps what another writer did while the editor was open, and lands the user's edit", async () => {
    const { result } = await mountLoaded(DOC);
    const card = namedBibEntry(result.current.bibEntries, "smith2020");
    const seed = seedOf(card);
    // The editor is open; the FILE moves under the (stale) view.
    DISK = SMITH_AGENT;
    let verdict: BibSaveResult | undefined;
    act(() => {
      void result.current
        .saveBibEntry(card, {
          fields: { ...seed.fields, title: "New Title" },
          type: seed.type,
          key: seed.key,
          base: seed,
        })
        .then((v) => (verdict = v));
    });
    await settle();
    expect(verdict?.kind).toBe("written");
    const disk = entriesOnDisk()[0];
    expect(disk.type).toBe("article"); // not reverted to @misc
    expect(disk.fields).toMatchObject({
      title: "New Title",
      doi: "10.1/x", // not DELETED
      year: "2020",
    });
    expect(DISK).toContain("pages = {1--9}"); // untouched bytes, spliced around
  });

  it("a field the user removed is still deleted (BIB-A3-02), beside the other writer's additions", async () => {
    const { result } = await mountLoaded(DOC);
    const card = namedBibEntry(result.current.bibEntries, "smith2020");
    const seed = seedOf(card);
    DISK = SMITH_AGENT;
    const { year: _drop, ...withoutYear } = seed.fields;
    act(() => {
      void result.current.saveBibEntry(card, {
        fields: withoutYear,
        type: seed.type,
        key: seed.key,
        base: seed,
      });
    });
    await settle();
    const f = fieldsOnDisk("smith2020");
    expect(f.year).toBeUndefined();
    expect(f.doi).toBe("10.1/x");
  });

  it("a same-field conflict lands NOTHING and answers `conflict` (the editor stays open)", async () => {
    const { result, fanned } = await mountLoaded(DOC);
    const card = namedBibEntry(result.current.bibEntries, "smith2020");
    const seed = seedOf(card);
    DISK = SMITH_AGENT.replace("Old Title", "Agent Title");
    const before = DISK;
    let verdict: BibSaveResult | undefined;
    act(() => {
      void result.current
        .saveBibEntry(card, {
          fields: { ...seed.fields, title: "User Title" },
          type: seed.type,
          key: "smith2020b",
          base: seed,
        })
        .then((v) => (verdict = v));
    });
    await settle();
    expect(verdict?.kind).toBe("conflict");
    expect(didBibSaveLand(verdict!)).toBe(false);
    expect(bibSaveRefusalReason(verdict!)).toContain("“title”");
    expect(DISK).toBe(before);
    expect(fanned).toEqual([]); // no rename fan-out for a save that did not land
    // …and the view is reconciled to the file, not left holding the edit.
    await waitFor(() => {
      expect(namedBibEntry(result.current.bibEntries, "smith2020").fields.title).toBe("Agent Title");
    });
  });

  it("a part the user did NOT touch is never written back (no rename-back, no retype-back)", async () => {
    const { result, fanned } = await mountLoaded(DOC);
    const card = namedBibEntry(result.current.bibEntries, "smith2020");
    const seed = seedOf(card);
    // The VIEW has caught up with a retype the user did not make.
    DISK = SMITH_AGENT;
    act(() => {
      void result.current.saveBibEntry(card, {
        fields: { ...seed.fields, year: "2021" },
        type: seed.type,
        key: seed.key,
        base: seed,
      });
    });
    await settle();
    expect(keysOnDisk()).toEqual(["smith2020"]);
    expect(entriesOnDisk()[0].type).toBe("article");
    expect(fieldsOnDisk("smith2020").year).toBe("2021");
    expect(fanned).toEqual([]);
  });

  it("an ABSOLUTE save (no base — Replace with library) is still set-all", async () => {
    const { result } = await mountLoaded(DOC);
    const card = namedBibEntry(result.current.bibEntries, "smith2020");
    DISK = SMITH_AGENT;
    act(() => {
      void result.current.saveBibEntry(card, {
        fields: { author: "Smith, A.", title: "Library Title", year: "2020" },
        type: "book",
      });
    });
    await settle();
    const disk = entriesOnDisk()[0];
    expect(disk.type).toBe("book");
    expect(disk.fields.doi).toBeUndefined();
  });
});
