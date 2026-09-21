// @vitest-environment jsdom
//
// A bib write is a SPLICE, never a rebuild (task 688).
//
// `references.bib` is the user's only copy of their bibliography, and
// `BibEntry` is a PROJECTION of it — a 16-name CSL field whitelist over a
// citation-js read. Until this task every panel write re-emitted the WHOLE
// file from that projection, so everything the projection cannot represent did
// not exist at write time and was deleted: a `@string`/`@preamble` macro, the
// file's header comment, a sibling block citation-js could not read, a `%` note
// inside an entry, and every field outside the whitelist (`isbn`, `keywords`,
// `abstract`, `annote`, `month`, `booktitle`, any custom field). Editing ONE
// field of ONE entry destroyed all of it, silently, in the file the `.tex`
// cites — and on a file carrying a `@string`, a real, cited `@article` block
// was REPLACED by the macro's text because the head regex's `[^,]+` ran through
// the comma-less macro and into the next entry's head.
//
// The legs below drive the REAL hook through the REAL serialized door, because
// the defect is in what reaches DISK — a test of the mutator's return value
// cannot see a whole-file re-emit at all. Pure legs sit beside them for the
// scanner and the block splice, which are the two halves the door composes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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
import { parseBibFile, serializeBibFileAgainst } from "@/lib/bib-parser";
import { scanBibSource, scanBibFields, spliceBibBlock } from "@/lib/bib-source";
import { removeEntryFromProjectBib } from "@/lib/project-bib";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { getSidecarRefusal, resetSidecarRefusals } from "@/lib/sidecar-refusal";
import type { BibEntry } from "@/lib/types";
import { namedBibEntry } from "@/lib/bib-test-entry";

const DOC = "doc-688";

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
// Member 1 — a `@string` macro no longer swallows the entry after it
// ---------------------------------------------------------------------------

const WITH_MACRO = `% My bibliography — last checked 2026-09-21
@string{jphil = {Journal of Philosophy}}

@article{smith2020,
  title = {A Paper},
  journal = jphil,
  isbn = {978-0},
  keywords = {epistemology, testimony}
}

@book{jones1999,
  title = {A Book}
}
`;

describe("member 1 · a macro block is its own kind, and never eats the entry after it", () => {
  it("the scanner reports the macro AND both entries (the old head regex found two blocks for three forms)", () => {
    const blocks = scanBibSource(WITH_MACRO);
    expect(blocks.map((b) => [b.kind, b.type, b.key])).toEqual([
      ["macro", "string", ""],
      ["entry", "article", "smith2020"],
      ["entry", "book", "jones1999"],
    ]);
  });

  it("each entry's `raw` is its OWN block — never the macro's text", () => {
    const entries = parseBibFile(WITH_MACRO);
    expect(entries.map((e) => e.key)).toEqual(["smith2020", "jones1999"]);
    expect(entries[0].raw.startsWith("@article{smith2020,")).toBe(true);
    expect(entries[0].raw).not.toContain("@string");
  });

  it("editing an UNRELATED entry leaves the cited @article, the macro and the header intact", async () => {
    const result = await mountWith(WITH_MACRO);
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "jones1999"), { title: "A Better Book" });
    });
    await settle();

    // The whole point: the entry nobody touched is still there, byte-for-byte.
    expect(DISK).toContain("@article{smith2020,");
    expect(DISK).toContain("title = {A Paper}");
    expect(DISK).toContain("@string{jphil = {Journal of Philosophy}}");
    expect(DISK).toContain("% My bibliography — last checked 2026-09-21");
    // …and the edit landed.
    expect(DISK).toContain("A Better Book");
    expect(parseBibFile(DISK).map((e) => e.key)).toEqual(["smith2020", "jones1999"]);
  });

  it("the macro REFERENCE in an untouched field is not expanded into a literal", async () => {
    const result = await mountWith(WITH_MACRO);
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "smith2020"), { title: "A Better Paper" });
    });
    await settle();
    expect(DISK).toContain("journal = jphil");
    expect(DISK).not.toContain("journal = {Journal of Philosophy}");
  });
});

// ---------------------------------------------------------------------------
// Member 3 — a field the projection does not model survives an edit
// ---------------------------------------------------------------------------

const CHAPTER = `@incollection{chapter1,
  author = {Doe, Jane},
  title = {A Chapter},
  booktitle = {The Big Book},
  isbn = {978-1-234},
  keywords = {mereology},
  abstract = {A short abstract.},
  annote = {My own note to self.},
  month = {jan}
}
`;

describe("member 3 · the fields the model does not carry survive an edit to one that it does", () => {
  it("an edit to `title` keeps isbn / keywords / abstract / annote / month", async () => {
    const result = await mountWith(CHAPTER);
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "chapter1"), { title: "A Better Chapter" });
    });
    await settle();
    expect(DISK).toContain("A Better Chapter");
    for (const kept of [
      "isbn = {978-1-234}",
      "keywords = {mereology}",
      "abstract = {A short abstract.}",
      "annote = {My own note to self.}",
      "month = {jan}",
    ]) {
      expect(DISK).toContain(kept);
    }
  });

  it("`booktitle` is not renamed to `journal` — on the read OR on the write", async () => {
    expect(Object.keys(parseBibFile(CHAPTER)[0].fields)).toContain("booktitle");
    expect(Object.keys(parseBibFile(CHAPTER)[0].fields)).not.toContain("journal");
    const result = await mountWith(CHAPTER);
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "chapter1"), { title: "A Better Chapter" });
    });
    await settle();
    expect(DISK).toContain("booktitle = {The Big Book}");
    expect(DISK).not.toContain("journal =");
  });

  it("SET-ALL deletes only the fields the editor could SEE, never the ones it never showed", async () => {
    const result = await mountWith(CHAPTER);
    // The bib editor is populated from `entry.fields`; clearing `author` there
    // is a real deletion, and `isbn` was never on the form at all.
    await act(async () => {
      result.current.replaceBibEntry(namedBibEntry(result.current.bibEntries, "chapter1"), {
        title: "A Chapter",
        booktitle: "The Big Book",
      });
    });
    await settle();
    expect(DISK).not.toContain("author =");
    expect(DISK).toContain("isbn = {978-1-234}");
    expect(DISK).toContain("annote = {My own note to self.}");
  });

  it("a rename rewrites the key and NOTHING else in the block", async () => {
    const result = await mountWith(CHAPTER);
    await act(async () => {
      result.current.updateBibKeyAndType(namedBibEntry(result.current.bibEntries, "chapter1"), "chapter2", "incollection");
    });
    await settle();
    expect(DISK).toContain("@incollection{chapter2,");
    expect(DISK).toContain("isbn = {978-1-234}");
    expect(DISK).toContain("month = {jan}");
  });
});

// ---------------------------------------------------------------------------
// Member 2 — quote parity in the entry-span walk
// ---------------------------------------------------------------------------

describe("member 2 · a quoted `}` does not truncate the entry's span", () => {
  const QUOTED = `@article{quoted1,
  note = "a } b",
  doi = {10.1000/xyz}
}

@book{plain1,
  title = {Plain}
}
`;

  it("the entry's span runs to its real closing brace, so the field AFTER the quote is still in it", () => {
    const blocks = scanBibSource(QUOTED);
    expect(blocks.map((b) => b.key)).toEqual(["quoted1", "plain1"]);
    expect(QUOTED.slice(blocks[0].start, blocks[0].end)).toContain("doi = {10.1000/xyz}");
  });

  it("the field scan reads the quoted value whole and still finds the field after it", () => {
    const block = QUOTED.slice(0, QUOTED.indexOf("\n\n"));
    expect(scanBibFields(block).map((f) => [f.name, f.delimiter])).toEqual([
      ["note", "quote"],
      ["doi", "brace"],
    ]);
  });

  it("a block with a genuinely unbalanced brace is contained — the rest of the file still parses", () => {
    const UNBALANCED = `@article{bad1,
  note = {a } b},
  doi = {10.1/x}
}

@book{good1, title = {Good} }
`;
    expect(parseBibFile(UNBALANCED).map((e) => e.key)).toContain("good1");
  });
});

// ---------------------------------------------------------------------------
// Member 4 — an unparseable sibling, the header, and `%` notes
// ---------------------------------------------------------------------------

describe("member 4 · bytes Virgil cannot model are never re-emitted, so they cannot be lost", () => {
  const WITH_BROKEN = `% Header comment block.
% Two lines of it.

@book{good1,
  title = {Good One}
}

@article{broken1,
  title = {Never closed
}

@book{good2,
  title = {Good Two}
}
`;

  it("a block Virgil cannot parse survives an edit that never touched it", async () => {
    const result = await mountWith(WITH_BROKEN);
    const before = DISK;
    expect(parseBibFile(before).map((e) => e.key)).not.toContain("broken1");
    await act(async () => {
      result.current.updateBibEntry(namedBibEntry(result.current.bibEntries, "good2"), { title: "Good Two Revised" });
    });
    await settle();
    expect(DISK).toContain("@article{broken1,");
    expect(DISK).toContain("title = {Never closed");
    expect(DISK).toContain("% Header comment block.");
    expect(DISK).toContain("Good Two Revised");
  });

  it("a `%` note INSIDE an entry stays in that entry's block", () => {
    const withNote = `@book{noted1,
  title = {A Book},
% checked against print
  year = {1999}
}
`;
    const entry = parseBibFile(withNote)[0];
    expect(entry.raw).toContain("% checked against print");
  });

  it("a removal takes its own block and leaves the macro and header behind", async () => {
    DISK = WITH_MACRO;
    beginDocPipeline(DOC);
    await removeEntryFromProjectBib(DOC, "jones1999");
    await settle();
    expect(DISK).not.toContain("@book{jones1999");
    expect(DISK).toContain("@article{smith2020,");
    expect(DISK).toContain("@string{jphil");
    expect(DISK).toContain("% My bibliography");
  });
});

// ---------------------------------------------------------------------------
// The refusal — what cannot be guaranteed is SAID, not written
// ---------------------------------------------------------------------------

describe("the refusal · an unspliceable span is refused on the channel, not guessed at", () => {
  // These are CONTRACT legs on the splice, not user paths — citation-js reads
  // only well-formed blocks, so a span that reaches `serializeBibFileAgainst`
  // straight from `parseBibFile` is always balanced and always contains exactly
  // one opener. A `BibMutator` may return whatever it likes, though (that is
  // its whole type), and the library silo's entries come from a different
  // parser. The Python door's three refusals exist because splicing a span
  // that is wrong in either direction DELETES A NEIGHBOUR; so the answer is
  // `null` — the caller then refuses out loud — rather than a best guess.
  const TWO = `@book{ok1,\n  title = {OK}\n}\n\n@book{ok2,\n  title = {OK2}\n}\n`;

  const edited = (e: BibEntry, raw: string): BibEntry => ({ ...e, raw });

  it("refusal 1 · a block whose braces did not balance is not written THROUGH", () => {
    const entries = parseBibFile(TWO).map((e, i) =>
      i === 0
        ? { ...e, raw: "@book{ok1, title = {Edited} }", source: { ...e.source!, balanced: false } }
        : e,
    );
    expect(serializeBibFileAgainst(TWO, entries)).toBeNull();
  });

  it("refusal 2 · a span that contains an opener other than its own is not written THROUGH", () => {
    // Hazard 5(b): a value carrying a column-0 `@type{` is INDISTINGUISHABLE
    // from the late-balance corruption where a `{` surplus in one value pairs
    // with a `}` surplus in a later one and the span runs straight through a
    // real entry. The two want opposite handling, so both are refused — the
    // cost is that this one entry needs a human, which is the right side of
    // the trade when the alternative is deleting a neighbour.
    const HAZARD = `@book{haz1,\n  note = {see\n@article{inner, x = {y}}\n},\n  title = {H}\n}\n`;
    const blocks = scanBibSource(HAZARD);
    expect(blocks.map((b) => b.key)).toEqual(["haz1"]); // containment is structural
    const src = {
      start: blocks[0].start,
      end: blocks[0].end,
      text: HAZARD.slice(blocks[0].start, blocks[0].end),
      balanced: true,
    };
    const entry = {
      uid: "aaaa",
      key: "haz1",
      type: "book",
      fields: {},
      raw: "@book{haz1, title = {Edited} }",
      source: src,
    };
    // The splice refuses even though the span itself balances, because the
    // opener inside it could be a real entry this write would delete.
    expect(serializeBibFileAgainst(HAZARD, [entry])).toBeNull();
  });

  it("an anchor into ANOTHER file is an addition, not a stale reference to refuse over", () => {
    // A library row, or an entry hand-parsed from a block string, carries an
    // anchor whose offsets mean nothing in THIS file — often offset 0, exactly
    // where this file's first entry lives. It has no block here, so it appends.
    const incoming = parseBibFile(`@book{newcomer,\n  title = {New}\n}\n`)[0];
    expect(incoming.source?.start).toBe(0);
    const out = serializeBibFileAgainst(TWO, [...parseBibFile(TWO), incoming]);
    expect(out).not.toBeNull();
    expect(parseBibFile(out!).map((e) => e.key)).toEqual(["ok1", "ok2", "newcomer"]);
  });

  it("an anchor that disagrees with the file about the block's extent is REFUSED, not appended", () => {
    // Appending it would also DELETE the block it claims to be — a duplicate
    // and a deletion from one inconsistent ref.
    const entries = parseBibFile(TWO).map((e, i) =>
      i === 0
        ? {
            ...e,
            raw: "@book{ok1, title = {Edited} }",
            source: { ...e.source!, end: TWO.length, text: TWO.slice(e.source!.start) },
          }
        : e,
    );
    expect(serializeBibFileAgainst(TWO, entries)).toBeNull();
  });

  it("refusal 3 · a replacement block that is itself unbalanced is not written", () => {
    const entries = parseBibFile(TWO).map((e, i) =>
      i === 0 ? edited(e, "@book{ok1, title = {Never closed }") : e,
    );
    expect(serializeBibFileAgainst(TWO, entries)).toBeNull();
    expect(spliceBibBlock("@book{b1, title = {B} }", { set: { title: "a } b" } })).toBeNull();
  });

  it("two entries claiming ONE span would overlap, so the write is refused", () => {
    const base = parseBibFile(TWO);
    const clone = { ...base[0], uid: "zzzz", raw: "@book{ok1, title = {Clone} }" };
    expect(serializeBibFileAgainst(TWO, [...base, clone])).toBeNull();
  });

  it("the door turns a null splice into a `failed` result the user is told about", async () => {
    DISK = TWO;
    beginDocPipeline(DOC);
    const { mutateProjectBib } = await import("@/lib/project-bib");
    const result = await mutateProjectBib(DOC, (prev) =>
      prev.map((e, i) =>
        i === 0
          ? { ...e, raw: "@book{ok1, title = {Edited} }", source: { ...e.source!, balanced: false } }
          : e,
      ),
    );
    expect(result.kind).toBe("failed");
    expect(DISK).toBe(TWO); // nothing reached disk
    expect(getSidecarRefusal(DOC)?.what).toBe("bibliography");
    expect(getSidecarRefusal(DOC)?.reason).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// The block splice, on its own
// ---------------------------------------------------------------------------

describe("the block splice · every byte the edit does not name survives", () => {
  const BLOCK = `@incollection{ch1,
  author = {Doe, Jane},
  title = {A Chapter},
  booktitle = {The Big Book},
  isbn = {978-1},
  month = {jan}
}`;

  it("setting one field rewrites one value and nothing else", () => {
    expect(spliceBibBlock(BLOCK, { set: { title: "A Better Chapter" } })).toBe(
      BLOCK.replace("A Chapter", "A Better Chapter"),
    );
  });

  it("setting a field to its current value is a byte-identical no-op", () => {
    expect(spliceBibBlock(BLOCK, { set: { title: "A Chapter" } })).toBe(BLOCK);
  });

  it("a modelled name is written into the ALIAS the source already uses", () => {
    const out = spliceBibBlock(BLOCK, { set: { journal: "Another Big Book" } })!;
    expect(out).toContain("booktitle = {Another Big Book}");
    expect(out).not.toContain("journal =");
  });

  it("a new field is inserted at the block's own indentation", () => {
    expect(spliceBibBlock(BLOCK, { set: { doi: "10.1/z" } })).toContain("\n  doi = {10.1/z}\n}");
  });

  it("removing a field takes its separator with it and leaves the rest untouched", () => {
    const out = spliceBibBlock(BLOCK, { remove: ["isbn"] })!;
    expect(out).not.toContain("isbn");
    expect(out).toContain("booktitle = {The Big Book},");
    expect(out).toContain("month = {jan}");
    expect(scanBibSource(out)[0].balanced).toBe(true);
  });

  it("an empty bare value does not spin the scanner — progress is the scanner's property", () => {
    // `title = ,` leaves the value walk exactly where the name started; before
    // the guard the loop never advanced and the whole app hung on the file.
    expect(scanBibFields("@book{b1, title = , year = {1} }").map((f) => f.name)).toEqual([
      "title",
      "year",
    ]);
  });

  it("a key + type change leaves every field byte-identical", () => {
    const out = spliceBibBlock(BLOCK, { key: "ch2", type: "inbook" })!;
    expect(out.startsWith("@inbook{ch2,")).toBe(true);
    expect(out).toContain("isbn = {978-1}");
  });
});
