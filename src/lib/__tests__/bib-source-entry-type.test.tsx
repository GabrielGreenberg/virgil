// @vitest-environment jsdom
//
// `BibEntry.type` is the SOURCE head's `@type`, never the CSL round trip
// (task 1518).
//
// citation-js reads a `.bib` into CSL, and CSL knows eight entry types. The
// projection back to BibTeX folded the rest — `@mastersthesis` → `phdthesis`,
// `@inbook` → `incollection`, `@online`/`@booklet`/`@manual` → `misc` — and the
// paper-bib save door then spliced that projected type over the REAL head on
// an edit to any field. So editing a title rewrote what kind of work the entry
// is, in the user's only copy. The legs drive the real hook through the real
// serialized door, because the defect is in what reaches DISK.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { flushPrefix } from "@/lib/write-queue";

let DISK = "";
const tick = () => new Promise((r) => setTimeout(r, 0));

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
        enqueueWrite(`${h.docId}/bib/references.bib`, async () => {
          await tick();
          const next = mutate(DISK);
          if (next === null) return null;
          await tick();
          DISK = next;
          return next;
        }),
    ),
  });
});

import { useCitations } from "@/hooks/useCitations";
import { parseBibFile } from "@/lib/bib-parser";
import { spliceBibBlock } from "@/lib/bib-source";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { resetSidecarRefusals } from "@/lib/sidecar-refusal";
import { namedBibEntry } from "@/lib/bib-test-entry";

const DOC = "doc-1518";

const FOLDED = `@mastersthesis{thesis1,
  title = {A Thesis},
  school = {UCLA},
  year = {2001}
}

@inbook{chap1,
  title = {A Chapter},
  publisher = {Pub},
  year = {2002}
}

@online{web1,
  title = {A Page},
  url = {https://example.org},
  year = {2003}
}

@Article{art1,
  title = {An Article},
  journal = {J},
  year = {2004}
}
`;

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
  await flushPrefix(DOC);
  await tick();
});

describe("task 1518 · the entry type is the source head's, not the CSL projection", () => {
  it("parse reads each entry's type from its own block head", () => {
    expect(parseBibFile(FOLDED).map((e) => [e.key, e.type])).toEqual([
      ["thesis1", "mastersthesis"],
      ["chap1", "inbook"],
      ["web1", "online"],
      ["art1", "article"],
    ]);
  });

  it.each(["thesis1", "chap1", "web1", "art1"])(
    "editing only the title of %s leaves its head byte-unchanged on disk",
    async (key) => {
      const result = await mountWith(FOLDED);
      const before = FOLDED;
      await act(async () => {
        result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, key), {
          title: "Retitled",
        });
      });
      await settle();
      expect(DISK).toContain("title = {Retitled}");
      // Every head in the file is exactly what it was — including the
      // capitalised `@Article`, which a case-only "change" must not touch.
      const heads = (t: string) => t.match(/^@\w+\{[^,]+,/gm);
      expect(heads(DISK)).toEqual(heads(before));
    },
  );

  it("an explicit retype still lands", async () => {
    const result = await mountWith(FOLDED);
    await act(async () => {
      result.current.updateBibKeyAndType(namedBibEntry(result.current.bibEntries, "art1"), "art1", "book");
    });
    await settle();
    expect(DISK).toContain("@book{art1,");
    expect(DISK).not.toContain("@Article{art1,");
  });

  it("the block splice treats a case-only type difference as no change", () => {
    const block = "@Article{a,\n  title = {T}\n}";
    expect(spliceBibBlock(block, { type: "article" })).toBe(block);
    expect(spliceBibBlock(block, { type: "book" })).toBe("@book{a,\n  title = {T}\n}");
  });
});
