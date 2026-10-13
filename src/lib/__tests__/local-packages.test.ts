/**
 * Task 1090 — a package loaded by the paper's OWN `.sty` / `.cls` is in force.
 * The manifest + `withLocalLoads` resolver, and the doors that consult it:
 * requirement injection (the save path), bib-family detection (the seed) and
 * the compile copy's requirement pass.
 */
import { describe, expect, it } from "vitest";
import {
  buildLocalPackageManifest,
  localPackagesFor,
  publishLocalPackages,
  withLocalLoads,
} from "@/lib/local-packages";
import { ensurePreambleRequirements } from "@/lib/latex-requirements";
import { detectBibFamily } from "@/lib/bib-family";
import { applyRequirementsToFile } from "@/lib/compile/apply-requirements-to-file";
import { serializeToLatex } from "@/lib/latex-serializer";

const STY_BIBLATEX = "\\ProvidesPackage{mystyle}\n\\RequirePackage[style=apa]{biblatex}\n";
const STY_NATBIB = "\\ProvidesPackage{mystyle}\n\\RequirePackage{natbib}\n";
const local = (sty: string) =>
  buildLocalPackageManifest([{ path: "mystyle.sty", text: sty }]);

const PREAMBLE = "\\documentclass{article}\n\\usepackage{mystyle}\n\\begin{document}\n";

describe("buildLocalPackageManifest / withLocalLoads", () => {
  it("returns null for a folder with no .sty/.cls", () => {
    expect(buildLocalPackageManifest([{ path: "main.tex", text: "x" }])).toBeNull();
  });

  it("expands a local package the preamble loads", () => {
    const out = withLocalLoads("\\usepackage{mystyle}", local(STY_BIBLATEX));
    expect(out).toContain("\\RequirePackage{biblatex}");
  });

  it("ignores a local package the preamble does NOT load", () => {
    const pre = "\\usepackage{other}";
    expect(withLocalLoads(pre, local(STY_BIBLATEX))).toBe(pre);
  });

  it("ignores a commented load inside the style file", () => {
    const m = local("% \\RequirePackage{biblatex}\n");
    expect(withLocalLoads("\\usepackage{mystyle}", m)).toBe("\\usepackage{mystyle}");
  });

  it("walks local-to-local loads transitively, and survives a cycle", () => {
    const m = buildLocalPackageManifest([
      { path: "a.sty", text: "\\RequirePackage{b}" },
      { path: "b.sty", text: "\\RequirePackage{a}\\RequirePackage{natbib}" },
    ]);
    expect(withLocalLoads("\\usepackage{a}", m)).toContain("natbib");
  });

  it("reads a local CLASS named by \\documentclass, incl. a CTAN base class's loads", () => {
    const m = buildLocalPackageManifest([
      { path: "mythesis.cls", text: "\\LoadClass{elsarticle}\n" },
    ]);
    expect(withLocalLoads("\\documentclass{mythesis}", m)).toContain("natbib");
  });

  it("the per-doc registry is keyed by doc", () => {
    const m = local(STY_BIBLATEX);
    publishLocalPackages("doc-a", m);
    expect(localPackagesFor("doc-a")).toBe(m);
    expect(localPackagesFor("doc-b")).toBeNull();
  });
});

describe("ensurePreambleRequirements sees local loads (member 1)", () => {
  const body = new Set(["natbib"]);

  it("injects NO natbib over a style file's biblatex — preamble byte-identical", () => {
    const out = ensurePreambleRequirements(PREAMBLE, body, {
      declaredBibFamily: "natbib",
      localPackages: local(STY_BIBLATEX),
    });
    expect(out).not.toContain("\\usepackage{natbib}");
    expect(out).not.toContain("\\usepackage{biblatex}");
  });

  it("mirror: injects NO biblatex over a style file's natbib", () => {
    const out = ensurePreambleRequirements(PREAMBLE, new Set(["biblatex"]), {
      declaredBibFamily: "biblatex",
      localPackages: local(STY_NATBIB),
    });
    expect(out).not.toContain("\\usepackage{biblatex}");
    expect(out).not.toContain("\\usepackage{natbib}");
  });

  it("without the manifest the old (fatal) injection still happens — the control", () => {
    const out = ensurePreambleRequirements(PREAMBLE, body, { declaredBibFamily: "natbib" });
    expect(out).toContain("\\usepackage{natbib}");
  });

  it("the serializer threads it from its options", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "citation", attrs: { citationId: "abcd", command: "\\citep{x}" } },
          ],
        },
      ],
    };
    const opts = {
      preamble: PREAMBLE,
      postamble: "\n\\end{document}\n",
      bibFamily: "natbib" as const,
    };
    // Control: the folder-blind serialize writes the fatal line.
    expect(serializeToLatex(doc, opts)).toContain("\\usepackage{natbib}");
    const tex = serializeToLatex(doc, { ...opts, localPackages: local(STY_BIBLATEX) });
    expect(tex).not.toContain("\\usepackage{natbib}");
  });
});

describe("detectBibFamily sees local loads (the seed)", () => {
  const tex = `${PREAMBLE}\\cite{x}\n\\end{document}\n`;
  it("a style file's biblatex pins biblatex", () => {
    expect(detectBibFamily(tex, local(STY_BIBLATEX))).toBe("biblatex");
  });
  it("control: without it the default (natbib) is seeded", () => {
    expect(detectBibFamily(tex)).toBe("natbib");
  });
});

describe("compile copy requirement pass sees local loads", () => {
  it("never injects natbib over a style file's biblatex", () => {
    const tex = `${PREAMBLE}\\cite{x}\n\\printbibliography\n\\end{document}\n`;
    expect(applyRequirementsToFile(tex, local(STY_BIBLATEX))).not.toContain(
      "\\usepackage{natbib}",
    );
  });
});
