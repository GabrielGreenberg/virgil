// Task 781 — "does this preamble load package X?" has ONE reader.
//
// Before 781 three readers answered it: bib-family's `familyLoadRe`, the
// requirements registry's `packageReq().satisfiedRe` (the two "kept in sync"
// by hand), and the lexer's `preambleListLoadsPackage`. Only the lexer's
// allowed whitespace between `\usepackage`, `[opts]` and `{list}`, so a legal
// `\usepackage {biblatex}` read as "no family loaded" and a body using the
// shared `\citeauthor` got `\usepackage{natbib}` injected beside a live
// biblatex — which refuses to co-load, so the compile failed. And a preamble
// on apacite (which defines `\citeauthor` itself) got natbib too.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { preambleListLoadsPackage } from "@/lib/latex-lexer";
import {
  detectBibFamily,
  detectPreambleBibFamily,
  FOREIGN_CITE_PACKAGES,
  reconcileBibFamily,
} from "@/lib/bib-family";
import {
  detectBodyRequirements,
  ensurePreambleRequirements,
  type RequirementConflict,
} from "@/lib/latex-requirements";
import { detectPassPlan } from "@/lib/compile/reference-resolution";

const BODY = "See \\citeauthor{k}.";

function save(preambleLoads: string): {
  out: string;
  conflicts: RequirementConflict[];
} {
  const preamble = `\\documentclass{article}\n${preambleLoads}\n\\begin{document}\n`;
  const conflicts: RequirementConflict[] = [];
  const out = ensurePreambleRequirements(
    preamble,
    detectBodyRequirements(BODY),
    { onRequirementConflict: (c) => conflicts.push(c) },
  );
  return { out, conflicts };
}

const injectsNatbib = (out: string) => out.includes("\\usepackage{natbib}");

describe("preambleListLoadsPackage — the one reader", () => {
  it.each([
    ["\\usepackage{biblatex}"],
    ["\\usepackage {biblatex}"],
    ["\\usepackage[style=apa]\n  {biblatex}"],
    ["\\usepackage [style=apa] {biblatex}"],
    ["\\RequirePackage {biblatex}"],
    ["\\usepackage{amsmath, biblatex ,xcolor}"],
    ["\\usepackage[authordate]{biblatex-chicago}"],
  ])("%j loads biblatex", (src) => {
    expect(preambleListLoadsPackage(src, "biblatex")).toBe(true);
  });

  it("a wrapper counts only as a PREFIX: biblatex-chicago is not `chicago`", () => {
    expect(
      preambleListLoadsPackage("\\usepackage{biblatex-chicago}", "chicago"),
    ).toBe(false);
    expect(preambleListLoadsPackage("\\usepackage{mybiblatex}", "biblatex")).toBe(
      false,
    );
  });
});

describe("bib family — spaced loads are loads", () => {
  it.each([
    ["\\usepackage {biblatex}"],
    ["\\usepackage[style=apa]\n  {biblatex}"],
  ])("%j is detected as biblatex", (load) => {
    expect(detectPreambleBibFamily(load)).toBe("biblatex");
    expect(
      detectBibFamily(`\\documentclass{article}\n${load}\n\\begin{document}\nx\n\\end{document}\n`),
    ).toBe("biblatex");
  });

  it.each([
    ["\\usepackage {biblatex}"],
    ["\\usepackage[style=apa]\n  {biblatex}"],
  ])("%j + \\citeauthor → no natbib injected, no conflict", (load) => {
    const { out, conflicts } = save(load);
    expect(injectsNatbib(out)).toBe(false);
    expect(conflicts).toEqual([]);
  });

  it("a spaced natbib load is satisfied, not re-injected", () => {
    const { out } = save("\\usepackage [round] {natbib}");
    expect(injectsNatbib(out)).toBe(false);
  });
});

describe("foreign citation packages own their cite machinery", () => {
  it.each(FOREIGN_CITE_PACKAGES.map((p) => [p]))(
    "\\usepackage{%s} + \\citeauthor → nothing injected, nothing surfaced",
    (pkg) => {
      const { out, conflicts } = save(`\\usepackage[natbibapa]{${pkg}}`);
      expect(injectsNatbib(out)).toBe(false);
      expect(out).not.toContain("\\usepackage{biblatex}");
      expect(conflicts).toEqual([]);
    },
  );

  it("reconcileBibFamily ensures no family beside apacite", () => {
    expect(reconcileBibFamily("natbib", "\\usepackage {apacite}")).toEqual({
      effectiveFamily: null,
    });
  });

  it("(control) a bare preamble still gets natbib for \\citeauthor", () => {
    expect(injectsNatbib(save("\\usepackage{amsmath}").out)).toBe(true);
  });

  it("(control) biblatex-chicago is biblatex, not the foreign `chicago`", () => {
    const { out, conflicts } = save("\\usepackage{biblatex-chicago}");
    expect(injectsNatbib(out)).toBe(false);
    expect(conflicts).toEqual([]);
  });
});

describe("the compile side asks the same reader", () => {
  it("a spaced biblatex load plans the bib-backend third pass", () => {
    const plan = detectPassPlan(
      "\\documentclass{article}\n\\usepackage [style=apa] {biblatex}\n\\begin{document}\nx\n\\end{document}\n",
    );
    expect(plan.passes).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Census — no hand-rolled load regex outside the lexer
// ---------------------------------------------------------------------------

/** A hand-rolled "is it loaded?" reader: the `usepackage|RequirePackage`
 *  alternation, or a regex naming a bib family inside `\{…\}`. Every one of
 *  the four pre-781 readers matched it (verified against the pre-fix tree).
 *  compile-service's backend REWRITE is a splice, not a reader, and spells
 *  `\{\s*biblatex\s*\}` — it does not match, by design. */
const HAND_ROLLED_READER =
  /usepackage\|RequirePackage|\\\{(?:natbib|biblatex)\\\}/;

const ROOT = join(__dirname, "..", "..", "..");

describe("census — one load reader", () => {
  it("only latex-lexer.ts spells a package-load regex", () => {
    const files = execSync(
      "git ls-files src library",
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));
    expect(files.length).toBeGreaterThan(300);
    const offenders = files.filter(
      (f) =>
        f !== "src/lib/latex-lexer.ts" &&
        HAND_ROLLED_READER.test(readFileSync(join(ROOT, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the census can see (canary)", () => {
    expect(
      HAND_ROLLED_READER.test(
        "`\\\\\\\\(?:usepackage|RequirePackage)(?:\\\\[[^\\\\]]*\\\\])?`",
      ),
    ).toBe(true);
    expect(
      HAND_ROLLED_READER.test("/\\\\usepackage(?:\\[[^\\]]*\\])?\\{natbib\\}/"),
    ).toBe(true);
  });
});
