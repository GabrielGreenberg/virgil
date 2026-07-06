import { describe, expect, it } from "vitest";
import {
  asBibFamily,
  classifyCiteFamily,
  detectCommandBibFamily,
  detectPreambleBibFamily,
  isSharedNonKernelCite,
  reconcileBibFamily,
} from "@/lib/bib-family";

describe("classifyCiteFamily", () => {
  it("pins natbib for natbib-only commands (bare name, full string, capitalized)", () => {
    expect(classifyCiteFamily("citep")).toBe("natbib");
    expect(classifyCiteFamily("\\citep{k}")).toBe("natbib");
    expect(classifyCiteFamily("\\Citet[see][]{k}")).toBe("natbib");
    expect(classifyCiteFamily("citeyearpar")).toBe("natbib");
  });

  it("pins biblatex for biblatex-only commands", () => {
    expect(classifyCiteFamily("\\autocite{k}")).toBe("biblatex");
    expect(classifyCiteFamily("parencite")).toBe("biblatex");
    expect(classifyCiteFamily("\\footfullcite{k}")).toBe("biblatex");
    expect(classifyCiteFamily("\\Textcites{a}{b}")).toBe("biblatex");
  });

  it("pins neither for SHARED / kernel-neutral commands", () => {
    expect(classifyCiteFamily("\\cite{k}")).toBeNull();
    expect(classifyCiteFamily("\\nocite{*}")).toBeNull();
    expect(classifyCiteFamily("\\citeauthor{k}")).toBeNull();
    expect(classifyCiteFamily("\\citeyear{k}")).toBeNull();
  });

  it("returns null for a non-command string", () => {
    expect(classifyCiteFamily("")).toBeNull();
    expect(classifyCiteFamily("{}")).toBeNull();
  });
});

describe("isSharedNonKernelCite", () => {
  it("true only for \\citeauthor / \\citeyear", () => {
    expect(isSharedNonKernelCite("\\citeauthor{k}")).toBe(true);
    expect(isSharedNonKernelCite("\\citeyear{k}")).toBe(true);
    expect(isSharedNonKernelCite("\\cite{k}")).toBe(false); // kernel-neutral
    expect(isSharedNonKernelCite("\\citep{k}")).toBe(false); // natbib-only
  });
});

describe("detectPreambleBibFamily — RequirePackage + wrappers", () => {
  it("recognizes \\usepackage{biblatex} and {natbib}", () => {
    expect(detectPreambleBibFamily("\\usepackage{biblatex}")).toBe("biblatex");
    expect(detectPreambleBibFamily("\\usepackage[round]{natbib}")).toBe(
      "natbib",
    );
  });

  it("recognizes \\RequirePackage{biblatex} (the previously-missed load form)", () => {
    expect(detectPreambleBibFamily("\\RequirePackage{biblatex}")).toBe(
      "biblatex",
    );
    expect(detectPreambleBibFamily("\\RequirePackage[opts]{natbib}")).toBe(
      "natbib",
    );
  });

  it("recognizes comma-lists and wrapper packages", () => {
    expect(detectPreambleBibFamily("\\usepackage{amsmath, natbib, xcolor}")).toBe(
      "natbib",
    );
    expect(
      detectPreambleBibFamily("\\usepackage[authordate]{biblatex-chicago}"),
    ).toBe("biblatex");
  });

  it("returns null when neither family is loaded", () => {
    expect(detectPreambleBibFamily("\\usepackage{amsmath}")).toBeNull();
  });
});

describe("detectCommandBibFamily", () => {
  it("natbib-only usage wins (baseline precedence)", () => {
    expect(detectCommandBibFamily("\\citep{a} and \\autocite{b}")).toBe(
      "natbib",
    );
  });
  it("biblatex-only when no natbib-only present", () => {
    expect(detectCommandBibFamily("\\autocite{b}")).toBe("biblatex");
  });
  it("null when only shared/kernel cites appear", () => {
    expect(detectCommandBibFamily("\\cite{a} \\citeauthor{b}")).toBeNull();
  });
});

describe("asBibFamily", () => {
  it("narrows valid strings, else null", () => {
    expect(asBibFamily("natbib")).toBe("natbib");
    expect(asBibFamily("biblatex")).toBe("biblatex");
    expect(asBibFamily("apa")).toBeNull();
    expect(asBibFamily(undefined)).toBeNull();
    expect(asBibFamily(null)).toBeNull();
  });
});

describe("reconcileBibFamily — warn, never rewrite", () => {
  it("no declared need → nothing to ensure, no conflict", () => {
    const r = reconcileBibFamily(null, "\\usepackage{natbib}");
    expect(r.effectiveFamily).toBeNull();
    expect(r.conflict).toBeUndefined();
  });

  it("preamble loads nothing → ensure the declared family", () => {
    const r = reconcileBibFamily("biblatex", "\\documentclass{article}");
    expect(r.effectiveFamily).toBe("biblatex");
    expect(r.conflict).toBeUndefined();
  });

  it("preamble already loads the SAME family → satisfied, no conflict", () => {
    const r = reconcileBibFamily("natbib", "\\usepackage{natbib}");
    expect(r.effectiveFamily).toBe("natbib");
    expect(r.conflict).toBeUndefined();
  });

  it("preamble loads the OTHER family → NO injection, surface a conflict (never delete a needed family)", () => {
    // The old fatal case: body needs biblatex, preamble is natbib baseline.
    const r = reconcileBibFamily("biblatex", "\\usepackage{natbib}");
    expect(r.effectiveFamily).toBeNull(); // never inject the wrong family
    expect(r.conflict).toEqual({ declared: "biblatex", preambleHas: "natbib" });
  });

  it("symmetric: natbib body under a biblatex preamble → conflict, no injection", () => {
    const r = reconcileBibFamily("natbib", "\\usepackage[style=apa]{biblatex}");
    expect(r.effectiveFamily).toBeNull();
    expect(r.conflict).toEqual({ declared: "natbib", preambleHas: "biblatex" });
  });
});
