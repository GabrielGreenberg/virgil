import { describe, it, expect } from "vitest";
import {
  mergeLatexErrors,
  type LatexError,
} from "@/lib/latex-errors";

function lint(line: number, message: string, column?: number): LatexError {
  return {
    id: `lint:${line}:${column ?? 0}:${message}`,
    source: "lint",
    severity: "warning",
    line,
    column,
    message,
  };
}

function compile(
  line: number,
  message: string,
  column?: number,
  file?: string,
): LatexError {
  return {
    id: `compile:${line}:${column ?? 0}:${message}`,
    source: "compile",
    severity: "error",
    line,
    column,
    message,
    file,
  };
}

describe("mergeLatexErrors", () => {
  it("drops a lint diagnostic that sits on the same line as a compile error", () => {
    const result = mergeLatexErrors(
      [lint(10, "lint says X")],
      [compile(10, "compile says Y")],
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("compile");
    expect(result[0].message).toBe("compile says Y");
  });

  it("keeps lint and compile diagnostics that are on different lines", () => {
    const result = mergeLatexErrors(
      [lint(5, "lint on 5")],
      [compile(10, "compile on 10")],
    );
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.line)).toEqual([5, 10]);
    expect(result.map((e) => e.source)).toEqual(["lint", "compile"]);
  });

  it("always keeps lint diagnostics with line <= 0 even if a compile error exists on a real line", () => {
    const result = mergeLatexErrors(
      [lint(0, "no-line lint"), lint(-1, "negative-line lint")],
      [compile(10, "compile on 10")],
    );
    expect(result).toHaveLength(3);
    // The line<=0 lints survive; the compile error is also present.
    expect(result.filter((e) => e.source === "lint")).toHaveLength(2);
    expect(result.filter((e) => e.source === "compile")).toHaveLength(1);
  });

  it("does NOT drop a line<=0 lint just because a compile error happens to be line 0-ish (only real lines dedup)", () => {
    // A compile error with line 0 must not poison the line<=0 lint keep-rule.
    const result = mergeLatexErrors(
      [lint(0, "no-line lint")],
      [compile(0, "no-line compile")],
    );
    expect(result).toHaveLength(2);
  });

  it("sorts the merged list by line then column", () => {
    const result = mergeLatexErrors(
      [lint(20, "lint 20"), lint(5, "lint 5", 3), lint(5, "lint 5 earlier col", 1)],
      [compile(12, "compile 12")],
    );
    expect(result.map((e) => e.line)).toEqual([5, 5, 12, 20]);
    // Within line 5, the column-1 entry comes before column-3.
    expect(result[0].column).toBe(1);
    expect(result[1].column).toBe(3);
  });

  it("always keeps every compile diagnostic", () => {
    const result = mergeLatexErrors(
      [lint(10, "lint on 10")],
      [compile(10, "compile A on 10"), compile(10, "compile B on 10")],
    );
    // Both compile errors on line 10 stay; the lint on line 10 is dropped.
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.source === "compile")).toBe(true);
  });

  it("does NOT drop a main-file lint when a CROSS-FILE compile error shares its line", () => {
    // A compile error in chapters/intro.tex:12 must not suppress a legitimate
    // main-file lint on line 12 — the compiler is not authoritative on the
    // main file's line 12 in that case.
    const result = mergeLatexErrors(
      [lint(12, "main-file lint on 12")],
      [compile(12, "cross-file compile on intro.tex:12", undefined, "chapters/intro.tex")],
    );
    expect(result).toHaveLength(2);
    expect(result.filter((e) => e.source === "lint")).toHaveLength(1);
    expect(result.filter((e) => e.source === "compile")).toHaveLength(1);
  });

  it("DOES drop a main-file lint when a MAIN-FILE compile error shares its line (file === undefined)", () => {
    const result = mergeLatexErrors(
      [lint(12, "main-file lint on 12")],
      [compile(12, "main-file compile on 12")], // file undefined ⇒ main file
    );
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("compile");
  });

  it("handles empty inputs", () => {
    expect(mergeLatexErrors([], [])).toEqual([]);
    expect(mergeLatexErrors([lint(3, "only lint")], [])).toHaveLength(1);
    expect(mergeLatexErrors([], [compile(3, "only compile")])).toHaveLength(1);
  });
});
