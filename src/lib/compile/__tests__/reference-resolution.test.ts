import { describe, expect, it } from "vitest";
import { detectPassPlan } from "@/lib/compile/reference-resolution";

const DOC = (body: string) =>
  `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}`;

describe("detectPassPlan — reference-resolution constructs drive >1 pass", () => {
  it("plain prose needs one pass", () => {
    const plan = detectPassPlan(DOC("Hello world."));
    expect(plan.passes).toBe(1);
  });

  it.each([
    ["\\ref", "See \\ref{sec:intro}."],
    ["\\pageref", "On page \\pageref{sec:intro}."],
    ["\\eqref", "Equation \\eqref{eq:1}."],
    ["\\autoref", "See \\autoref{fig:1}."],
    ["\\cref", "See \\cref{sec:intro}."],
    ["\\Cref", "\\Cref{sec:intro} shows."],
    ["\\nameref", "See \\nameref{sec:intro}."],
  ])("%s drives at least 2 passes", (_label, body) => {
    const plan = detectPassPlan(DOC(body));
    expect(plan.passes).toBeGreaterThan(1);
  });

  it.each([
    ["\\tableofcontents", "\\tableofcontents"],
    ["\\listoffigures", "\\listoffigures"],
    ["\\listoftables", "\\listoftables"],
  ])("%s drives at least 2 passes", (_label, body) => {
    const plan = detectPassPlan(DOC(body));
    expect(plan.passes).toBeGreaterThan(1);
  });

  it("manual \\begin{thebibliography} drives at least 2 passes", () => {
    const plan = detectPassPlan(
      DOC("\\begin{thebibliography}{9}\n\\bibitem{a} A.\n\\end{thebibliography}"),
    );
    expect(plan.passes).toBeGreaterThan(1);
  });
});

describe("detectPassPlan — bib backend gets 3 passes", () => {
  it.each([
    ["natbib package", "\\usepackage{natbib}\n\\begin{document}\n\\bibliographystyle{plain}\n\\bibliography{refs}"],
    ["\\bibliography", "\\begin{document}\n\\bibliography{refs}"],
    ["\\addbibresource", "\\addbibresource{refs.bib}\n\\begin{document}\nHi."],
    ["biblatex package", "\\usepackage{biblatex}\n\\begin{document}\nHi."],
    ["\\RequirePackage{natbib}", "\\RequirePackage{natbib}\n\\begin{document}\nHi."],
  ])("%s → 3 passes", (_label, src) => {
    const plan = detectPassPlan(`\\documentclass{article}\n${src}\n\\end{document}`);
    expect(plan.passes).toBe(3);
  });

  it("bib backend outranks a plain \\ref (3, not 2)", () => {
    const plan = detectPassPlan(
      DOC("\\usepackage{natbib}\nSee \\ref{x}.\n\\bibliography{refs}"),
    );
    expect(plan.passes).toBe(3);
  });
});

describe("detectPassPlan — inert occurrences do NOT drive extra passes", () => {
  it("a commented \\ref does not drive a second pass", () => {
    const plan = detectPassPlan(DOC("% See \\ref{sec:intro}.\nPlain text."));
    expect(plan.passes).toBe(1);
  });

  it("a commented \\bibliography does not drive three passes", () => {
    const plan = detectPassPlan(DOC("% \\bibliography{refs}\nPlain text."));
    expect(plan.passes).toBe(1);
  });

  it("a \\ref inside verbatim does not drive a second pass", () => {
    const plan = detectPassPlan(
      DOC("\\begin{verbatim}\n\\ref{sec:intro}\n\\end{verbatim}\nPlain text."),
    );
    expect(plan.passes).toBe(1);
  });

  it("a \\bibliography inside lstlisting does not drive three passes", () => {
    const plan = detectPassPlan(
      DOC("\\begin{lstlisting}\n\\bibliography{refs}\n\\end{lstlisting}\nPlain."),
    );
    expect(plan.passes).toBe(1);
  });

  it("inline \\verb|\\ref{x}| does not drive a second pass", () => {
    const plan = detectPassPlan(DOC("Code: \\verb|\\ref{x}| here."));
    expect(plan.passes).toBe(1);
  });

  it("a LIVE \\ref after a commented one still counts", () => {
    const plan = detectPassPlan(DOC("% \\bibliography{refs}\nSee \\ref{x}."));
    expect(plan.passes).toBe(2);
  });
});

describe("detectPassPlan — command-boundary correctness", () => {
  it("\\reflectbox is NOT a \\ref", () => {
    const plan = detectPassPlan(DOC("\\reflectbox{x}"));
    expect(plan.passes).toBe(1);
  });

  it("\\crefname is NOT a \\cref reference", () => {
    const plan = detectPassPlan(DOC("\\crefname{eq}{eq.}{eqs.}"));
    expect(plan.passes).toBe(1);
  });
});
