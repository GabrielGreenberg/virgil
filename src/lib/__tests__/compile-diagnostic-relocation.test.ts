// Task 1549 — a compile diagnostic's `line` indexes the text pdfTeX RAN; the
// live document moves on. `relocateCompileDiagnostics` re-addresses it by the
// stamped line text before any consumer maps it into the live source.
import { describe, it, expect } from "vitest";
import {
  buildLiveLineIndex,
  diagnosticLocationLabel,
  liveMainFileLine,
  mergeLatexErrors,
  relocateCompileDiagnostics,
  stampSourceLines,
  type LatexError,
} from "@/lib/latex-errors";

const COMPILED = ["\\documentclass{article}", "\\begin{document}", "Intro.", "\\bogus here", "\\end{document}"].join("\n");

function compileErr(line: number, extra: Partial<LatexError> = {}): LatexError {
  return { id: `c${line}`, source: "compile", severity: "error", line, message: "Undefined control sequence", ...extra };
}
function lintErr(line: number): LatexError {
  return { id: `l${line}`, source: "lint", severity: "warning", line, message: "lint" };
}

describe("stampSourceLines", () => {
  it("stamps main-file lines only", () => {
    const [main, cross, none] = stampSourceLines(
      [compileErr(4), compileErr(2, { file: "ch.tex" }), compileErr(0)],
      COMPILED,
    );
    expect(main.lineText).toBe("\\bogus here");
    expect(cross.lineText).toBeUndefined();
    expect(none.lineText).toBeUndefined();
  });
});

describe("liveMainFileLine / relocateCompileDiagnostics", () => {
  const [stamped] = stampSourceLines([compileErr(4)], COMPILED);

  it("unchanged text → the same array (identity) and the same line", () => {
    const errs = [stamped];
    expect(relocateCompileDiagnostics(errs, COMPILED)).toBe(errs);
  });

  it("a line inserted above → the error follows its text to N+1", () => {
    const live = COMPILED.replace("Intro.", "Intro.\nA new paragraph.");
    expect(liveMainFileLine(stamped, buildLiveLineIndex(live))).toBe(5);
    const [moved] = relocateCompileDiagnostics([stamped], live);
    expect(moved.line).toBe(5);
    expect(moved.id).toBe(stamped.id);
  });

  it("the nearest duplicate wins", () => {
    const live = ["\\bogus here", "a", "b", "c", "\\bogus here", "d"].join("\n");
    // recorded at 4 — live 4 is "c"; candidates 1 and 5 → 5 is nearer.
    expect(liveMainFileLine(stamped, buildLiveLineIndex(live))).toBe(5);
  });

  it("the stamped line edited away → unlocated: line 0, compiledLine kept, label says so", () => {
    const live = COMPILED.replace("\\bogus here", "\\emph{fixed}");
    const [gone] = relocateCompileDiagnostics([stamped], live);
    expect(gone.line).toBe(0);
    expect(gone.compiledLine).toBe(4);
    expect(diagnosticLocationLabel(gone)).toBe("line 4 (at last compile)");
  });

  it("unstamped records (lint, cross-file, line-less) pass through", () => {
    const errs = [lintErr(4), compileErr(2, { file: "ch.tex" }), compileErr(0)];
    expect(relocateCompileDiagnostics(errs, "x")).toBe(errs);
  });

  it("an edit above no longer lets a stale compile line hide a live lint error", () => {
    // Compile error was on line 4. A line inserted above moves it to 5; a NEW
    // lint error on live line 4 must survive the merge.
    const live = COMPILED.replace("Intro.", "Intro.\n\\undefinedthing");
    const merged = mergeLatexErrors([lintErr(4)], relocateCompileDiagnostics([stamped], live) as LatexError[]);
    expect(merged.map((e) => [e.id, e.line])).toEqual([["l4", 4], ["c4", 5]]);
  });

  it("an unlocated compile error suppresses no lint and keeps its last-compile order", () => {
    const live = COMPILED.replace("\\bogus here", "changed");
    const merged = mergeLatexErrors(
      [lintErr(1), lintErr(4), lintErr(5)],
      relocateCompileDiagnostics([stamped], live) as LatexError[],
    );
    expect(merged.map((e) => e.id)).toEqual(["l1", "l4", "c4", "l5"]);
  });
});
