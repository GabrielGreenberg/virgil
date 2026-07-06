import { describe, expect, it } from "vitest";
import { detectBibtexFailure } from "@/lib/compile/bibtex-log";

// A trimmed but realistic bibtex-run tail as it lands in the pdfTeX log.
const BIBTEX_OK = `
This is BibTeX, Version 0.99d (TeX Live 2023)
The top-level auxiliary file: main.aux
The style file: plainnat.bst
Database file #1: refs.bib
`;

const BIBTEX_MISSING_DB = `
This is BibTeX, Version 0.99d
The top-level auxiliary file: main.aux
The style file: plainnat.bst
I couldn't open database file refs.bib
---line 5 of file main.aux
`;

const BIBTEX_NO_BIBDATA = `
This is BibTeX, Version 0.99d
The top-level auxiliary file: main.aux
I found no \\bibdata command---while reading file main.aux
`;

const BIBTEX_NO_CITATION = `
This is BibTeX, Version 0.99d
The top-level auxiliary file: main.aux
I found no \\citation commands---while reading file main.aux
`;

const BIBTEX_MISSING_ENTRY = `
This is BibTeX, Version 0.99d
Database file #1: refs.bib
Warning--I didn't find a database entry for "smith2020"
`;

const BIBTEX_MISSING_STYLE = `
This is BibTeX, Version 0.99d
The top-level auxiliary file: main.aux
I couldn't open style file plainnat.bst
`;

const NO_BIBTEX = `
This is pdfTeX, Version 3.141592653
Output written on main.pdf (3 pages).
Transcript written on main.log.
`;

describe("detectBibtexFailure — pass/fail/absent", () => {
  it("recognizes a clean bibtex run as ok", () => {
    expect(detectBibtexFailure(BIBTEX_OK)).toBe("ok");
  });

  it("recognizes a doc with no bibtex stage as absent", () => {
    expect(detectBibtexFailure(NO_BIBTEX)).toBe("absent");
  });

  it("recognizes an empty log as absent", () => {
    expect(detectBibtexFailure("")).toBe("absent");
  });

  it.each([
    ["missing database file", BIBTEX_MISSING_DB],
    ["no \\bibdata command", BIBTEX_NO_BIBDATA],
    ["no \\citation commands", BIBTEX_NO_CITATION],
    ["missing database entry", BIBTEX_MISSING_ENTRY],
    ["missing style file", BIBTEX_MISSING_STYLE],
  ])("recognizes %s as failed", (_label, log) => {
    expect(detectBibtexFailure(log)).toBe("failed");
  });

  it("a failure signature wins even alongside a ran signature", () => {
    // BIBTEX_MISSING_DB contains both "This is BibTeX" and the failure line.
    expect(detectBibtexFailure(BIBTEX_MISSING_DB)).toBe("failed");
  });
});
