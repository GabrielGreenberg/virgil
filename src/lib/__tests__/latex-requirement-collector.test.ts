import { describe, expect, it } from "vitest";
import {
  createRequirementCollector,
  TIKZ_RE,
} from "@/lib/latex-requirement-collector";

describe("RequirementCollector", () => {
  it("collects ids idempotently", () => {
    const c = createRequirementCollector();
    c.need("expex");
    c.need("expex");
    c.need("graphicx");
    expect([...c.ids].sort()).toEqual(["expex", "graphicx"]);
  });

  it("records the first concrete bib family; null is ignored", () => {
    const c = createRequirementCollector();
    c.needBibFamily(null); // shared/kernel cite — ignored
    expect(c.bibFamily).toBeNull();
    c.needBibFamily("biblatex");
    expect(c.bibFamily).toBe("biblatex");
  });

  it("biases to natbib when two DIFFERENT concrete families appear (baseline precedence)", () => {
    const c = createRequirementCollector();
    c.needBibFamily("biblatex");
    c.needBibFamily("natbib");
    expect(c.bibFamily).toBe("natbib");
  });

  it("a single natbib family stays natbib", () => {
    const c = createRequirementCollector();
    c.needBibFamily("natbib");
    c.needBibFamily("natbib");
    expect(c.bibFamily).toBe("natbib");
  });
});

describe("TIKZ_RE — broadened shared vocabulary", () => {
  it("matches \\begin{tikzpicture}", () => {
    expect(TIKZ_RE.test("\\begin{tikzpicture}")).toBe(true);
  });
  it("matches \\begin{tikzcd}", () => {
    expect(TIKZ_RE.test("\\begin{tikzcd} A \\to B \\end{tikzcd}")).toBe(true);
  });
  it("matches inline \\tikz with a word boundary", () => {
    expect(TIKZ_RE.test("\\tikz \\draw (0,0) -- (1,1);")).toBe(true);
    expect(TIKZ_RE.test("\\tikz[baseline]{...}")).toBe(true);
  });
  it("matches pgfplots \\begin{axis}", () => {
    expect(TIKZ_RE.test("\\begin{axis}\\addplot {x};\\end{axis}")).toBe(true);
  });
  it("matches a pgfplots \\usepackage load", () => {
    expect(TIKZ_RE.test("\\usepackage{pgfplots}")).toBe(true);
    expect(TIKZ_RE.test("\\usepackage[compat=1.18]{pgfplots}")).toBe(true);
  });
  it("does not match plain prose", () => {
    expect(TIKZ_RE.test("Just some prose about tiling.")).toBe(false);
  });
});
