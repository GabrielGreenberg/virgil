/**
 * Task 895 — every entry the Library parses carries its VERBATIM raw block,
 * whatever precedes it. The hand-rolled `/@\w+\s*\{([^,]+),/g` head regex ran
 * through a comma-less `@string` / `@preamble` / `@comment` into the next
 * entry's head, so that entry got `raw: ""` and its Edit-modal diff silently
 * dropped `baseRaw` (the apply side's concurrent-edit guard).
 */
import { describe, expect, it } from "vitest";
import { parseBibFile } from "../bib-parser";
import { buildBibEditDiff } from "../bib-edit";

const SMITH = `@article{smith2020,\n  author = {Smith, Jane},\n  title = {On Things},\n  journal = jphil,\n  year = {2020}\n}`;
const DOE = `@book{doe2019,\n  author = {Doe, John},\n  title = {A Book},\n  publisher = {Pub},\n  year = {2019}\n}`;

const PRELUDES: Array<[string, string]> = [
  ["@string", `@string{jphil = "Journal of Philosophy"}`],
  ["@preamble", `@preamble{"\\newcommand{\\noop}[1]{}"}`],
  ["comma-less @comment", `@comment{jabref-meta: databaseType:bibtex;}`],
];

describe("library parseBibFile raw blocks (task 895)", () => {
  for (const [name, prelude] of PRELUDES) {
    it(`an entry after ${name} keeps its exact source block`, () => {
      const text = `${prelude}\n\n${SMITH}\n\n${DOE}\n`;
      const entries = parseBibFile(text);
      const smith = entries.find((e) => e.key === "smith2020");
      const doe = entries.find((e) => e.key === "doe2019");
      expect(smith?.raw).toBe(SMITH);
      expect(doe?.raw).toBe(DOE);
      const diff = buildBibEditDiff(smith!, "article", { ...smith!.fields, title: "On Other Things" });
      expect(diff.baseRaw).toBe(SMITH);
    });
  }

  it("a % note inside an entry survives into raw (sliced from the original)", () => {
    const withNote = `@article{noted2021,\n  title = {Noted},\n% checked against print\n  year = {2021}\n}`;
    const entries = parseBibFile(`% header\n${withNote}\n`);
    expect(entries.find((e) => e.key === "noted2021")?.raw).toBe(withNote);
  });

  it("duplicate citekeys each keep their own raw", () => {
    const a = `@misc{dup,\n  title = {First}\n}`;
    const b = `@misc{dup,\n  title = {Second}\n}`;
    const raws = parseBibFile(`${a}\n\n${b}\n`).filter((e) => e.key === "dup").map((e) => e.raw);
    expect(raws).toEqual([a, b]);
  });
});
