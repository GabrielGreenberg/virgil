/**
 * Task 1019 — a bib family is injected only when the BODY needs one, and never
 * over a package or class that already provides citations.
 *
 * The editor declares a family on EVERY save (`useCitations`: stored ??
 * detected ?? DEFAULT — never null). Before 1019 a non-null declaration alone
 * made the injector add the family, so a paper citing nothing gained
 * `\usepackage{natbib}`, a `\usepackage{cite}` paper gained natbib beside it,
 * and an `elsarticle` paper (whose class loads natbib) gained biblatex — the
 * fatal "Incompatible package". The census drives the REAL save loop
 * (`parseLatex` → `serializeToLatex` with the delimiters the file was read
 * with) for every declared family × preamble shape.
 */
import { describe, expect, it } from "vitest";
import { extractPreambleAndPostamble, parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import type { BibFamily } from "@/lib/bib-family";
import type { RequirementConflict } from "@/lib/latex-requirements";
import { rewriteBiblatexBackend } from "@/lib/compile/compile-service";

function save(
  tex: string,
  bibFamily: BibFamily | undefined,
): { out: string; conflicts: RequirementConflict[] } {
  const conflicts: RequirementConflict[] = [];
  const delimiters = extractPreambleAndPostamble(tex);
  const out = serializeToLatex(parseLatex(tex), {
    ...(delimiters ?? {}),
    bibFamily,
    onRequirementConflict: (c) => conflicts.push(c),
  });
  return { out, conflicts };
}

function preambleOf(tex: string): string {
  return tex.slice(0, tex.indexOf("\\begin{document}"));
}

const loads = (tex: string, pkg: string) =>
  new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${pkg}\\}`).test(preambleOf(tex));

const doc = (preamble: string, body: string) =>
  `${preamble}\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;

const FAMILIES: (BibFamily | undefined)[] = [undefined, "natbib", "biblatex"];

describe("task 1019 — a family is injected only on the body's need", () => {
  describe.each(FAMILIES)("declared family = %s", (family) => {
    it("a body that cites nothing gains no bib package", () => {
      const { out, conflicts } = save(
        doc("\\documentclass{article}", "No cites here."),
        family,
      );
      expect(loads(out, "natbib")).toBe(false);
      expect(loads(out, "biblatex")).toBe(false);
      expect(conflicts.filter((c) => c.family === "bib")).toEqual([]);
    });

    it("a kernel \\cite under \\usepackage{cite} gains no bib package", () => {
      const { out } = save(
        doc(
          "\\documentclass{article}\n\\usepackage{cite}",
          "As shown \\cite{k}.\n\n\\bibliographystyle{plain}\n\\bibliography{refs}",
        ),
        family,
      );
      expect(loads(out, "natbib")).toBe(false);
      expect(loads(out, "biblatex")).toBe(false);
    });

    it("a natbib cite under \\usepackage{cite} is never stacked with natbib", () => {
      const { out } = save(
        doc("\\documentclass{article}\n\\usepackage{cite}", "As \\citep{k} shows."),
        family,
      );
      expect(loads(out, "natbib")).toBe(false);
      expect(loads(out, "biblatex")).toBe(false);
    });

    it("an elsarticle paper (class loads natbib) gains neither family", () => {
      const { out, conflicts } = save(
        doc("\\documentclass{elsarticle}", "As \\citep{k} shows."),
        family,
      );
      expect(loads(out, "natbib")).toBe(false);
      expect(loads(out, "biblatex")).toBe(false);
      // Declaring biblatex over a natbib class is WARNED, never injected.
      const bib = conflicts.filter((c) => c.family === "bib");
      expect(bib.length > 0).toBe(family === "biblatex");
    });

    it("a langscibook paper (class loads biblatex) is never given a family", () => {
      const { out } = save(
        doc("\\documentclass{langscibook}", "As \\textcite{k} shows."),
        family,
      );
      expect(loads(out, "natbib")).toBe(false);
      expect(loads(out, "biblatex")).toBe(false);
    });
  });

  it("a body that DOES cite still gets the declared family (the which-question)", () => {
    expect(
      loads(save(doc("\\documentclass{article}", "See \\citeauthor{k}."), "biblatex").out, "biblatex"),
    ).toBe(true);
    expect(
      loads(save(doc("\\documentclass{article}", "See \\citep{k}."), "natbib").out, "natbib"),
    ).toBe(true);
  });

  it("a kernel \\cite printed with \\printbibliography still needs biblatex", () => {
    const { out } = save(
      doc("\\documentclass{article}", "See \\cite{k}.\n\n\\printbibliography"),
      "biblatex",
    );
    expect(loads(out, "biblatex")).toBe(true);
  });

  it("an uncited save is byte-stable through a second round trip", () => {
    const first = save(doc("\\documentclass{article}", "No cites here."), "natbib").out;
    expect(save(first, "natbib").out).toBe(first);
  });
});

describe("task 1019 member 2 — every biblatex load spelling compiles with bibtex", () => {
  it.each([
    ["\\usepackage{biblatex}", "\\usepackage[backend=bibtex]{biblatex}"],
    ["\\usepackage[style=apa]{biblatex}", "\\usepackage[style=apa,backend=bibtex]{biblatex}"],
    ["\\usepackage[backend=biber,style=apa]{biblatex}", "\\usepackage[backend=bibtex,style=apa]{biblatex}"],
    ["\\usepackage[backend=bibtex]{biblatex}", "\\usepackage[backend=bibtex]{biblatex}"],
    [
      "\\usepackage[authordate]{biblatex-chicago}",
      "\\usepackage[authordate,backend=bibtex]{biblatex-chicago}",
    ],
    ["\\RequirePackage{biblatex}", "\\RequirePackage[backend=bibtex]{biblatex}"],
    [
      "\\usepackage{csquotes,biblatex}",
      "\\PassOptionsToPackage{backend=bibtex}{biblatex}\\usepackage{csquotes,biblatex}",
    ],
  ])("%s", (load, expected) => {
    expect(rewriteBiblatexBackend(`\\documentclass{article}\n${load}\n`)).toBe(
      `\\documentclass{article}\n${expected}\n`,
    );
  });

  it("leaves non-biblatex loads alone", () => {
    const src = "\\usepackage{natbib}\n\\usepackage[backend=biber]{other}\n";
    expect(rewriteBiblatexBackend(src)).toBe(src);
  });
});
