// @vitest-environment jsdom
//
// Task 690 — a bib mutation ADDRESSES its entry, and the Save door VALIDATES
// the head it is about to write.
//
// Two halves of one door, and each leg below fails on the pre-fix code.
//
// **Half 1 — addressing by a non-unique citekey.** Every mutator matched
// `e.key === key` and then `prev.map`'d, which rewrites EVERY entry the
// predicate accepts. Duplicate citekeys are explicitly representable
// (`parseBibFile`: two blocks sharing a citekey are two ordered entries — "the
// basis for distinct-uid-per-block"), the panel HID the duplicate, and so a
// user editing the one card they could see overwrote a second block's fields
// invisibly, in the file the `.tex` cites.
//
// The fix is a ladder, not a field (`bib-address.ts`): uid → source offset →
// key+ordinal → key. Matching on `uid` alone would NOT work, and that is the
// point of the second leg here — a bib mutation runs twice, once over the
// hook's view and once over a fresh parse inside the write section, and a
// markerless block is minted a brand-new uid by every parse. That is the
// defect task 689 found sitting unreached behind a default-off flag.
//
// **Half 2 — a Save door that validated nothing.** An empty `@type` was passed
// straight through and emitted `@{key,…}`: a block Virgil's own head scan
// cannot read, skipped on the next parse with a `console.warn` only. A citekey
// holding a space, a comma or a brace fails the same scan. And a rename ONTO
// an existing citekey was accepted in full — after which the panel showed one
// card for two blocks and every later edit reached both.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { renderHook, act, waitFor, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { flushPrefix } from "@/lib/write-queue";

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
          await tick();
          const next = mutate(DISK);
          if (next === null) return null;
          await tick();
          DISK = next;
          return next;
        }),
    ),
  };
});

import { useCitations } from "@/hooks/useCitations";
import { parseBibFile } from "@/lib/bib-parser";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { resetSidecarRefusals } from "@/lib/sidecar-refusal";
import { bibAddressOf, resolveBibEntryIndex } from "@/lib/bib-address";
import { validateBibEntryHead } from "@/lib/bib-entry-head";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";

const DOC = "doc-690";

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
  await waitFor(() =>
    expect(result.current.bibEntries.length).toBe(parseBibFile(text).length),
  );
  return result;
}

beforeEach(() => {
  DISK = "";
  resetPipelines();
  resetSidecarRefusals();
});

afterEach(async () => {
  cleanup();
  await flushPrefix(DOC);
  await tick();
});

// ---------------------------------------------------------------------------
// Half 1 — the addressed mutation
// ---------------------------------------------------------------------------

/** A hand-merged `references.bib`: two DIFFERENT works filed under one key. */
const DUPLICATE_KEY = `@article{smith2020,
  title = {The First Paper},
  author = {A. Smith}
}

@article{smith2020,
  title = {The Second Paper},
  author = {B. Smith}
}
`;

describe("half 1 · a mutation reaches exactly the block the user edited", () => {
  it("parses two entries for two blocks that share a citekey", () => {
    const entries = parseBibFile(DUPLICATE_KEY);
    expect(entries.map((e) => e.key)).toEqual(["smith2020", "smith2020"]);
    expect(entries[0].uid).not.toBe(entries[1].uid);
  });

  it("editing the FIRST duplicate leaves the second byte-unchanged", async () => {
    const result = await mountWith(DUPLICATE_KEY);
    await act(async () => {
      result.current.updateBibEntry(result.current.bibEntries[0], {
        title: "The First Paper, Revised",
      });
    });
    await settle();

    const after = parseBibFile(DISK);
    expect(after).toHaveLength(2);
    expect(after[0].fields.title).toBe("The First Paper, Revised");
    // The pre-fix `prev.map((e) => e.key === key ? … : e)` rewrote BOTH.
    expect(after[1].fields.title).toBe("The Second Paper");
    // The second block's own bytes, untouched.
    expect(DISK).toContain("The Second Paper");
    expect(DISK).toContain("author = {B. Smith}");
  });

  it("editing the SECOND duplicate leaves the first byte-unchanged", async () => {
    const result = await mountWith(DUPLICATE_KEY);
    await act(async () => {
      result.current.replaceBibEntry(result.current.bibEntries[1], {
        title: "The Second Paper, Revised",
        author: "B. Smith",
      });
    });
    await settle();

    const after = parseBibFile(DISK);
    expect(after[0].fields.title).toBe("The First Paper");
    expect(after[1].fields.title).toBe("The Second Paper, Revised");
  });

  it("a markerless block's uid is REMINTED per parse — so the ladder, not the uid alone, is what lands the write", async () => {
    // The exact fact task 689 recorded: match on uid alone and the disk run
    // (a fresh parse) matches nothing, so the edit silently does not land.
    const a = parseBibFile(DUPLICATE_KEY);
    const b = parseBibFile(`${DUPLICATE_KEY}\n`); // same blocks, different bytes
    expect(b.map((e) => e.uid)).not.toEqual(a.map((e) => e.uid));
    // The address taken from `a` still resolves against `b`, via the offset /
    // key+ordinal rungs.
    expect(resolveBibEntryIndex(b, bibAddressOf(a, a[1]))).toBe(1);
  });

  it("an address whose block is gone resolves to nothing (and the mutation declines)", async () => {
    const entries = parseBibFile(DUPLICATE_KEY);
    const ghost: BibEntry = { uid: "zzzz", key: "absent", type: "article", fields: {}, raw: "" };
    expect(resolveBibEntryIndex(entries, bibAddressOf(entries, ghost))).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Half 2 — the validation door
// ---------------------------------------------------------------------------

const TWO_ENTRIES = `@article{smith2020,
  title = {A Paper}
}

@book{jones1999,
  title = {A Book}
}
`;

describe("half 2 · the head door", () => {
  it("refuses an empty @type, a malformed @type and an empty key", () => {
    const entries = parseBibFile(TWO_ENTRIES);
    const self = bibAddressOf(entries, entries[0]);
    expect(validateBibEntryHead({ key: "smith2020", type: "" }, { entries, self }).ok).toBe(false);
    expect(validateBibEntryHead({ key: "smith2020", type: "@!" }, { entries, self }).ok).toBe(false);
    expect(validateBibEntryHead({ key: "", type: "article" }, { entries, self }).ok).toBe(false);
  });

  it("refuses a citekey carrying whitespace, a comma, a brace or an @", () => {
    const entries = parseBibFile(TWO_ENTRIES);
    const self = bibAddressOf(entries, entries[0]);
    for (const key of ["smith 2020", "smith,2020", "smith{2020", "smith}2020", "smith@2020"]) {
      expect(validateBibEntryHead({ key, type: "article" }, { entries, self }).ok).toBe(false);
    }
    // Punctuation a citekey legitimately carries is NOT refused.
    for (const key of ["smith:2020", "smith-2020", "smith_2020", "smith.2020", "smith+2020"]) {
      expect(validateBibEntryHead({ key, type: "article" }, { entries, self }).ok).toBe(true);
    }
  });

  it("refuses a rename ONTO another entry's citekey, but not onto the entry's own", () => {
    const entries = parseBibFile(TWO_ENTRIES);
    const self = bibAddressOf(entries, entries[0]);
    expect(validateBibEntryHead({ key: "jones1999", type: "article" }, { entries, self }).ok).toBe(false);
    expect(validateBibEntryHead({ key: "smith2020", type: "book" }, { entries, self }).ok).toBe(true);
  });

  it("the hook's rename door refuses a collision — the file is unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await mountWith(TWO_ENTRIES);
    const before = DISK;
    await act(async () => {
      result.current.updateBibKeyAndType(result.current.bibEntries[0], "jones1999", "article");
    });
    await settle();
    expect(DISK).toBe(before);
    expect(parseBibFile(DISK).map((e) => e.key)).toEqual(["smith2020", "jones1999"]);
    warn.mockRestore();
  });

  it("the hook's rename door refuses an empty @type — no `@{key,…}` reaches disk", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await mountWith(TWO_ENTRIES);
    const before = DISK;
    await act(async () => {
      result.current.updateBibKeyAndType(result.current.bibEntries[0], "smith2020", "");
    });
    await settle();
    expect(DISK).toBe(before);
    expect(DISK).not.toContain("@{");
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The card — the control the user is looking at reflects the same answer
// ---------------------------------------------------------------------------

function renderCard(entries: BibEntry[], index: number, handlers: Record<string, unknown> = {}) {
  return render(
    <BibEntryCard
      entry={entries[index]}
      bibEntries={entries}
      isSelected
      onClick={() => {}}
      getAnnotation={() => ""}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onUpdateBibEntry={() => {}}
      onUpdateBibKeyAndType={() => {}}
      {...handlers}
    />,
  );
}

describe("the card · Save is disabled and says why", () => {
  const entries = parseBibFile(TWO_ENTRIES);

  const openEditor = () => {
    fireEvent.click(screen.getByText("BibTeX Fields"));
    fireEvent.click(screen.getByText("Edit entry"));
  };

  it("clearing the @type disables Save", () => {
    renderCard(entries, 0);
    openEditor();
    fireEvent.change(screen.getByDisplayValue("article"), { target: { value: "" } });
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/entry type is required/i);
  });

  it("a citekey with a space disables Save", () => {
    renderCard(entries, 0);
    openEditor();
    fireEvent.change(screen.getByDisplayValue("smith2020"), { target: { value: "smith 2020" } });
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot contain a space/i);
  });

  it("renaming onto an existing citekey disables Save, and nothing is dispatched", () => {
    const onReplaceBibEntry = vi.fn();
    const onUpdateBibKeyAndType = vi.fn();
    renderCard(entries, 0, { onReplaceBibEntry, onUpdateBibKeyAndType });
    openEditor();
    fireEvent.change(screen.getByDisplayValue("smith2020"), { target: { value: "jones1999" } });
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Save"));
    expect(onReplaceBibEntry).not.toHaveBeenCalled();
    expect(onUpdateBibKeyAndType).not.toHaveBeenCalled();
  });

  it("a legal head keeps Save live and dispatches the ENTRY, not the citekey", () => {
    const onReplaceBibEntry = vi.fn();
    const onUpdateBibKeyAndType = vi.fn();
    renderCard(entries, 0, { onReplaceBibEntry, onUpdateBibKeyAndType });
    openEditor();
    fireEvent.change(screen.getByDisplayValue("smith2020"), { target: { value: "smith2021" } });
    expect((screen.getByText("Save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("Save"));
    expect(onUpdateBibKeyAndType).toHaveBeenCalledTimes(1);
    expect(onUpdateBibKeyAndType.mock.calls[0][0]).toBe(entries[0]);
    expect(onUpdateBibKeyAndType.mock.calls[0][1]).toBe("smith2021");
  });
});
