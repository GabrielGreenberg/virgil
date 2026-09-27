// TASK 795: a Library bib edit is a diff against the DISK entry, never against
// the CSL projection the full-entry fetch carries for display. Each member of
// the task is pinned here against `buildBibEditDiff` fed a real projected
// entry (from `parseBibFile`, i.e. what `getFullLibraryBibEntry` returns).

import { describe, expect, it } from "vitest";
import { parseBibFile } from "../bib-parser";
import { buildBibEditDiff, isEmptyBibEditDiff } from "../bib-edit";
import {
  bibEditBase,
  locateMasterEntryBlock,
  parseBibEntryBlock,
} from "../bib-raw-entry";

/** What the modal is handed: the projected entry, as the fetch returns it. */
function shown(raw: string) {
  const [e] = parseBibFile(raw);
  expect(e).toBeTruthy();
  return e;
}

const INBOOK = `@inbook{doe2001,
  author = {Doe, Jane},
  title = {A Chapter},
  booktitle = {The Big Book},
  publisher = {Press},
  year = {2001}
}
`;

const LATEX = `@incollection{roe1999,
  author = {Roe, Richard and M{\\"u}ller, Hans},
  title = {The {GB} Theory of \\emph{Binding}},
  booktitle = {Studies in {LaTeX}},
  year = {1999}
}
`;

describe("parseBibEntryBlock — faithful single-entry parse", () => {
  it("keeps the type as written and every value verbatim under its own key", () => {
    const p = parseBibEntryBlock(LATEX)!;
    expect(p.type).toBe("incollection");
    expect(p.fields.title).toBe("The {GB} Theory of \\emph{Binding}");
    expect(p.fields.author).toBe('Roe, Richard and M{\\"u}ller, Hans');
    expect(p.fields.booktitle).toBe("Studies in {LaTeX}");
    expect(p.fields.journal).toBeUndefined();
  });

  it("reads quoted, bare and concatenated values", () => {
    const p = parseBibEntryBlock(
      `@Misc{k,\n  title = "A {"}quoted{"} title",\n  year = 2001,\n  month = jan,\n  note = "a" # b\n}`,
    )!;
    expect(p.type).toBe("misc");
    expect(p.fields.title).toBe('A {"}quoted{"} title');
    expect(p.fields.year).toBe("2001");
    expect(p.fields.month).toBe("jan");
    expect(p.fields.note).toBe('"a" # b');
  });

  it("returns null on a malformed block", () => {
    expect(parseBibEntryBlock("@article{k, title = {open")).toBeNull();
    expect(parseBibEntryBlock("not bibtex")).toBeNull();
  });
});

describe("buildBibEditDiff over a projected entry (task 795 members)", () => {
  it("member 1: baseType is the DISK type, so a type change is not falsely held", () => {
    for (const [raw, disk] of [
      [INBOOK, "inbook"],
      [INBOOK.replace("@inbook", "@mastersthesis"), "mastersthesis"],
      [INBOOK.replace("@inbook", "@online"), "online"],
      [INBOOK.replace("@inbook", "@booklet"), "booklet"],
    ] as const) {
      const e = shown(raw);
      const base = bibEditBase(e);
      const d = buildBibEditDiff(e, "book", base.fields);
      expect(d.baseType).toBe(disk);
      expect(d.set).toEqual({});
      expect(d.remove).toEqual([]);
    }
  });

  it("member 1: opening and saving unchanged is an empty diff on any type", () => {
    const e = shown(INBOOK);
    const base = bibEditBase(e);
    expect(isEmptyBibEditDiff(buildBibEditDiff(e, base.type, { ...base.fields }))).toBe(true);
  });

  it("member 2: an edited field keeps its untouched LaTeX", () => {
    const e = shown(LATEX);
    const base = bibEditBase(e);
    const d = buildBibEditDiff(e, base.type, {
      ...base.fields,
      title: `${base.fields.title}: Revisited`,
    });
    expect(d.set).toEqual({ title: "The {GB} Theory of \\emph{Binding}: Revisited" });
    expect(d.remove).toEqual([]);
  });

  it("member 3: booktitle stays booktitle — no `journal` row, no re-key", () => {
    const e = shown(LATEX);
    const base = bibEditBase(e);
    expect(base.fields.booktitle).toBe("Studies in {LaTeX}");
    expect(base.fields.journal).toBeUndefined();
    const { booktitle: _drop, ...rest } = base.fields;
    void _drop;
    const cleared = buildBibEditDiff(e, base.type, rest);
    expect(cleared.remove).toEqual(["booktitle"]);
    const edited = buildBibEditDiff(e, base.type, { ...base.fields, booktitle: "Other" });
    expect(edited.set).toEqual({ booktitle: "Other" });
  });

  it("an entry with no raw is left as the caller gave it", () => {
    const e = { key: "x", type: "article", fields: { title: "T" }, raw: "" };
    expect(bibEditBase(e)).toBe(e);
  });
});

describe("locateMasterEntryBlock — the Python locator's rule", () => {
  it("member 4: a duplicate key resolves to the LAST copy", () => {
    const text = `@article{dup,\n  title = {First}\n}\n\n@article{dup,\n  title = {Second}\n}\n`;
    expect(locateMasterEntryBlock(text, "dup")).toBe("@article{dup,\n  title = {Second}\n}");
  });

  it("skips an opener inside a prior balanced entry's value", () => {
    const text = `@misc{host,\n  note = {\n@article{inner,\n  title = {Fake}}\n}\n}\n\n@article{inner,\n  title = {Real}\n}\n`;
    expect(locateMasterEntryBlock(text, "inner")).toContain("{Real}");
    expect(locateMasterEntryBlock(`@misc{host,\n  note = {\n@article{only,\n  t = {x}}\n}\n}\n`, "only")).toBeNull();
  });

  it("caps an unbalanced entry at the next opener and still finds later entries", () => {
    const text = `@article{bad,\n  title = {Bad {x},\n}\n\n@book{good,\n  title = {G}\n}\n`;
    expect(locateMasterEntryBlock(text, "good")).toBe("@book{good,\n  title = {G}\n}");
    expect(locateMasterEntryBlock(text, "bad")).toBe("@article{bad,\n  title = {Bad {x},\n}\n\n");
  });

  it("still finds an indented opener and one with a newline before its comma", () => {
    expect(locateMasterEntryBlock(`  @article{ind,\n  t = {x}\n}\n`, "ind")).toContain("@article{ind");
    expect(locateMasterEntryBlock(`@article{nl\n,\n  t = {x}\n}\n`, "nl")).toContain("@article{nl");
  });
});
