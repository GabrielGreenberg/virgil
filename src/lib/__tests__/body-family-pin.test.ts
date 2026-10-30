// "Which bib family does the BODY pin?" — ONE rule, every reader (task 1371).
//
// The rule lives in bib-family.ts (`bodyPinnedFamily` + the tie `foldFamilies`).
// Before this task four sites spelled it by hand and had drifted: the
// requirements pass counted `\printbibliography` (task 1019) but the family
// reader `detectBibFamily` did not, so a `\cite` + `\printbibliography` paper
// read as natbib while save injected biblatex. The shared corpus is also read
// by the Python twin (editor/scripts/tests/test_body_family_pin_parity.py).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BIB_FAMILY,
  bodyPinnedFamily,
  detectBibFamily,
  foldFamilies,
  type BibFamily,
} from "@/lib/bib-family";
import { detectBodyRequirements } from "@/lib/latex-requirements";
import { createRequirementCollector } from "@/lib/latex-requirement-collector";

interface Case {
  name: string;
  body: string;
  family: BibFamily | null;
  seed: BibFamily;
}

const CORPUS: Case[] = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/body-family-pin-corpus.json"), "utf8"),
).cases;

const wrap = (body: string) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

function requirementsFamily(body: string): BibFamily | null {
  const req = detectBodyRequirements(body);
  if (req.bibFamilyDefaulted) return null; // a default, not a pin
  if (req.has("natbib")) return "natbib";
  if (req.has("biblatex")) return "biblatex";
  return null;
}

describe("body family pin — every reader answers the shared corpus", () => {
  it("the corpus is non-trivial", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10);
  });
  it.each(CORPUS)("$name", (c) => {
    expect(bodyPinnedFamily(c.body)).toBe(c.family);
    expect(requirementsFamily(c.body)).toBe(c.family);
    expect(detectBibFamily(wrap(c.body))).toBe(c.seed);
    expect(c.seed).toBe(c.family ?? DEFAULT_BIB_FAMILY);
  });
});

describe("body family pin — the tie rule is ONE fold", () => {
  it("foldFamilies: absent, equal, conflict → baseline (absorbing)", () => {
    expect(foldFamilies(null, null)).toBeNull();
    expect(foldFamilies(null, "biblatex")).toBe("biblatex");
    expect(foldFamilies("biblatex", null)).toBe("biblatex");
    expect(foldFamilies("biblatex", "biblatex")).toBe("biblatex");
    expect(foldFamilies("natbib", "biblatex")).toBe(DEFAULT_BIB_FAMILY);
    expect(foldFamilies("biblatex", "natbib")).toBe(DEFAULT_BIB_FAMILY);
    expect(foldFamilies(foldFamilies("natbib", "biblatex"), "biblatex")).toBe(
      DEFAULT_BIB_FAMILY,
    );
  });
  it("the requirement collector folds through it, order-independently", () => {
    for (const order of [
      ["natbib", "biblatex"],
      ["biblatex", "natbib"],
      ["biblatex", "natbib", "biblatex"],
    ] as BibFamily[][]) {
      const col = createRequirementCollector();
      for (const f of order) col.needBibFamily(f);
      expect(col.bibFamily).toBe(bodyPinnedFamily("\\citep{a} \\autocite{b}"));
    }
  });
});

describe("body family pin — CENSUS: no hand copy of the rule survives", () => {
  const read = (rel: string) =>
    readFileSync(path.join(__dirname, "../../..", rel), "utf8");

  it("latex-requirements.ts builds no private bucket regex and no family branch", () => {
    const src = read("src/lib/latex-requirements.ts");
    expect(src).not.toMatch(/function familyRe\b/);
    expect(src).not.toMatch(/NATBIB_ONLY_RE|BIBLATEX_ONLY_RE|BIBLATEX_BODY_RE/);
  });
  it("bib-family.ts's private `bucketRe` is gone (one builder: citeBucketRe)", () => {
    expect(read("src/lib/bib-family.ts")).not.toMatch(/function bucketRe\b/);
  });
  it.each([
    "src/lib/latex-requirement-collector.ts",
    "src/lib/latex-serializer.ts",
  ])("%s spells no natbib tie-break by hand", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/(?:bibFamily|fam)\s*=\s*"natbib"/);
    expect(src).toMatch(/foldFamilies\(/);
  });
  it("the Python twin carries the port, not the pre-1371 reader", () => {
    const src = read("editor/scripts/bib_family.py");
    expect(src).not.toMatch(/def detect_command_bib_family\b/);
    expect(src).toMatch(/def body_pinned_family\b/);
    expect(src).toMatch(/print\(\?:bibliography\|bibheading\)/);
  });
});
