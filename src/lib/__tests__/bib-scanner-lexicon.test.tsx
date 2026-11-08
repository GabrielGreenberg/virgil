// @vitest-environment jsdom
//
// Task 1519 — ONE lexical model of a `.bib` body.
//
// The parser masked `%` comment lines before locating blocks (task 1156), but
// the field scanner, the splice's own re-scan, the balance check and the
// `\vbid` binder read the text raw, and the field scanner read only the FIRST
// term of a `#`-joined value. Each member below is one consequence, reproduced
// from the audit (tick 457): a removal that spliced `# vol` into the citekey,
// a set that kept a stale macro term, a comment that hid a field (duplicate
// written, removal a no-op), a `\vbid` stolen by a commented-out head — and,
// when the splice did refuse, a SILENT rebuild of the block from the 16-field
// projection, deleting every field and note it omits. That last one is the
// write-path law's own case: what cannot be spliced is REFUSED.

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
import { scanBibSource, scanBibFields, spliceBibBlock, spliceBibBlockResult } from "@/lib/bib-source";
import { orderedVbidBindings } from "@/lib/bib-uid";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { getSidecarRefusal, resetSidecarRefusals } from "@/lib/sidecar-refusal";
import { namedBibEntry } from "@/lib/bib-test-entry";

const DOC = "doc-1519";

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


// ---------------------------------------------------------------------------
// Members 1-2 — a `#`-joined value is ONE value, spanning all its terms
// ---------------------------------------------------------------------------

const CONCAT = `@article{a,
  title = "A" # vol,
  year = 2020
}`;

describe("members 1-2 · `#` concatenation", () => {
  it("the field span runs to the LAST term", () => {
    const title = scanBibFields(CONCAT).find((f) => f.name === "title")!;
    expect(CONCAT.slice(title.start, title.end)).toBe('title = "A" # vol');
    expect(title.delimiter).toBe("concat");
    expect(scanBibFields(CONCAT).map((f) => f.name)).toEqual(["title", "year"]);
  });

  it("member 1 · removing a concatenated field keeps the citekey intact", () => {
    expect(spliceBibBlock(CONCAT, { remove: ["title"] })).toBe(`@article{a,
  year = 2020
}`);
  });

  it("member 1 · removing it as the LAST field takes the comma before it", () => {
    const block = `@article{a,\n  year = 2020,\n  title = "A" # vol\n}`;
    expect(spliceBibBlock(block, { remove: ["title"] })).toBe(`@article{a,\n  year = 2020\n}`);
  });

  it("member 2 · a SET on a concatenated value is REFUSED with a reason, never half-applied", () => {
    const r = spliceBibBlockResult(CONCAT, { set: { title: "NEW" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/joined with #/);
  });

  it("member 2 · the bare variant (`month = jan # \", 1\"`) is read whole, not cut at the quoted comma", () => {
    const block = `@misc{m,\n  month = jan # ", 1",\n  note = {N}\n}`;
    const fields = scanBibFields(block);
    expect(fields.map((f) => f.name)).toEqual(["month", "note"]);
    const month = fields[0];
    expect(block.slice(month.valueStart, month.valueEnd)).toBe('jan # ", 1"');
    expect(spliceBibBlockResult(block, { set: { month: "feb" } }).ok).toBe(false);
    expect(spliceBibBlock(block, { set: { note: "M" } })).toBe(`@misc{m,\n  month = jan # ", 1",\n  note = {M}\n}`);
  });

  it("an unquoted bare value that is not a macro (a URL) keeps its whole legacy reading", () => {
    const block = `@misc{u,\n  url = http://x.org/a?b=1,\n  year = 2020\n}`;
    const url = scanBibFields(block).find((f) => f.name === "url")!;
    expect(block.slice(url.valueStart, url.valueEnd)).toBe("http://x.org/a?b=1");
    expect(url.delimiter).toBe("bare");
  });
});

// ---------------------------------------------------------------------------
// Member 3 — a `%` line is blank to the field scanner
// ---------------------------------------------------------------------------

const COMMENTED = `@article{c,
  author = {Doe, Jane},
  % note, the title below is wrong
  title = {T},
  year = 2020
}`;

describe("member 3 · a comment line cannot hide the field after it", () => {
  it("the field after the comment is found", () => {
    expect(scanBibFields(COMMENTED).map((f) => f.name)).toEqual(["author", "title", "year"]);
  });

  it("a set replaces it IN PLACE (no duplicate appended), and the note survives", () => {
    const out = spliceBibBlock(COMMENTED, { set: { title: "New" } })!;
    expect(out).toBe(COMMENTED.replace("title = {T}", "title = {New}"));
    expect(out.match(/title =/g)).toHaveLength(1);
  });

  it("a remove removes it", () => {
    const out = spliceBibBlock(COMMENTED, { remove: ["title"] })!;
    expect(out).not.toContain("title =");
    expect(out).toContain("% note, the title below is wrong");
    expect(out).toContain("\n  year = 2020"); // no doubled indentation
    expect(scanBibFields(out).map((f) => f.name)).toEqual(["author", "year"]);
  });

  it("removing the LAST field across a trailing comment line takes the real comma", () => {
    const block = `@article{c,\n  title = {T},\n  % about the year\n  year = 2020\n}`;
    const out = spliceBibBlock(block, { remove: ["year"] })!;
    expect(out).toBe(`@article{c,\n  title = {T}\n  % about the year\n}`);
  });

  it("an ADDED field after a trailing comment line gets a real separator, not a commented-out one", () => {
    const block = `@article{c,\n  title = {T}\n  % end note\n}`;
    const out = spliceBibBlock(block, { set: { year: "2021" } })!;
    expect(out).toBe(`@article{c,\n  title = {T},\n  year = {2021}\n  % end note\n}`);
    expect(scanBibFields(out).map((f) => f.name)).toEqual(["title", "year"]);
  });
});

// ---------------------------------------------------------------------------
// Member 4 — a brace inside a comment does not unbalance the block, and a
// refused splice is a REFUSAL, never a rebuild from the projection
// ---------------------------------------------------------------------------

const BRACE_NOTE = `@book{b,
  title = {Old Title},
  % checked {against print
  isbn = {978-0},
  abstract = {An abstract.},
  keywords = {k1, k2}
}
`;

const CONCAT_FILE = `@string{vol = {Volume Two}}

@article{cc,
  title = "Essays" # vol,
  isbn = {978-9},
  abstract = {Kept.},
  year = 2020
}
`;

describe("member 4 · comment braces, and the refusal that replaces the silent rebuild", () => {
  it("a `%` line with an unbalanced brace leaves the block spliceable", () => {
    const head = scanBibSource(BRACE_NOTE)[0];
    expect(head.balanced).toBe(true);
    expect(spliceBibBlock(parseBibFile(BRACE_NOTE)[0].raw, { set: { title: "New" } })).not.toBeNull();
  });

  it("an edit to that entry lands as a splice: isbn / abstract / keywords / the note survive on disk", async () => {
    const result = await mountWith(BRACE_NOTE);
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "b"), { title: "New Title" });
    });
    await settle();
    expect(DISK).toContain("title = {New Title}");
    for (const kept of ["% checked {against print", "isbn = {978-0}", "abstract = {An abstract.}", "keywords = {k1, k2}"]) {
      expect(DISK).toContain(kept);
    }
  });

  it("a splice the door REFUSES is refused on the channel — the block is NOT rebuilt from the projection", async () => {
    const result = await mountWith(CONCAT_FILE);
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "cc"), { title: "Flattened" });
    });
    await settle();
    expect(DISK).toBe(CONCAT_FILE); // nothing reached disk — isbn / abstract with it
    expect(getSidecarRefusal(DOC)?.what).toBe("bibliography");
    expect(getSidecarRefusal(DOC)?.detail).toMatch(/joined with #/);
  });

  it("the Save door answers the refusal with a reason the composer can show", async () => {
    const result = await mountWith(CONCAT_FILE);
    let verdict: Awaited<ReturnType<typeof result.current.saveBibEntry>> | undefined;
    await act(async () => {
      const entry = namedBibEntry(result.current.bibEntries, "cc");
      const p = result.current.saveBibEntry(entry, { fields: { ...entry.fields, title: "Flattened" } });
      await settle();
      verdict = await p;
    });
    expect(verdict?.kind).toBe("failed");
    expect(DISK).toBe(CONCAT_FILE);
  });

  it("an edit to a DIFFERENT field of the concatenated entry still splices", async () => {
    const result = await mountWith(CONCAT_FILE);
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "cc"), { year: "2021" });
    });
    await settle();
    expect(DISK).toContain('title = "Essays" # vol');
    expect(DISK).toContain("year = {2021}");
    expect(DISK).toContain("isbn = {978-9}");
  });
});

// ---------------------------------------------------------------------------
// Member 5 — a commented-out head is not a block, so it cannot take a `\vbid`
// ---------------------------------------------------------------------------

describe("member 5 · a `%` line holding `@type{` steals no `\\vbid` binding", () => {
  const FILE = `\\vbid{a1b2}\n% @article{old2019, title = {Old}}\n@article{new2020,\n  title = {New}\n}\n`;

  it("the scanner reports no block at the comment", () => {
    expect(scanBibSource(FILE).map((b) => b.key)).toEqual(["new2020"]);
  });

  it("the marker binds to the REAL entry, and the parse carries its uid", () => {
    expect(orderedVbidBindings(FILE).map((b) => [b.citekey, b.uid])).toEqual([["new2020", "a1b2"]]);
    expect(parseBibFile(FILE).map((e) => [e.key, e.uid])).toEqual([["new2020", "a1b2"]]);
  });
});
