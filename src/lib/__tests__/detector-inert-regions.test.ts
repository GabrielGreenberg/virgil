/**
 * Task 1370 — the detector door (`projectDetectableLatex`) treats TeX's
 * block-disabling idioms as inert: the `comment` env and a top-level
 * `\iffalse` / `\if0 … \fi`. Every detector reader inherits it.
 */
import { describe, expect, it } from "vitest";
import {
  blankFalseConditionals,
  livePreamble,
  projectDetectableLatex,
  projectLiveLatex,
} from "../latex-lexer";
import { detectBodyRequirements } from "../latex-requirements";
import { detectBibFamily } from "../bib-family";

const req = (body: string) => [...detectBodyRequirements(body)].sort();

describe("task 1370: detectBodyRequirements ignores disabled blocks", () => {
  it("\\iffalse … \\fi", () => {
    expect(req("x \\cite{a}\n\\iffalse \\autocite{b} \\fi\n")).toEqual([]);
  });
  it("\\if0 … \\fi", () => {
    expect(req("x \\cite{a}\n\\if0 \\autocite{b} \\fi\n")).toEqual([]);
  });
  it("\\begin{comment} … \\end{comment}", () => {
    expect(
      req("x \\cite{a}\n\\begin{comment}\\autocite{b}\\end{comment}\n"),
    ).toEqual([]);
  });
  it("control: a %-comment was already inert", () => {
    expect(req("x \\cite{a}\n% \\autocite{b}\n")).toEqual([]);
  });
  it("a live \\autocite still requires biblatex", () => {
    expect(req("x \\autocite{b}\n")).toEqual(["biblatex"]);
  });
  it("nested conditionals close at the MATCHING \\fi", () => {
    expect(req("\\iffalse \\ifx\\a\\b x\\fi \\autocite{b} \\fi")).toEqual([]);
    // …and the bytes after the outer \fi are live again.
    expect(
      req("\\iffalse \\ifx\\a\\b x\\fi y \\fi \\autocite{b}"),
    ).toEqual(["biblatex"]);
  });
  it("the \\else branch is live", () => {
    expect(req("\\iffalse x \\else \\autocite{b} \\fi")).toEqual(["biblatex"]);
    expect(req("\\iffalse \\autocite{b} \\else x \\fi")).toEqual([]);
  });
  it("a %-commented \\fi closes nothing", () => {
    expect(req("\\iffalse x\n% \\fi\n\\autocite{b}\n\\fi")).toEqual([]);
  });
});

describe("task 1370: fail-OPEN cases stay live", () => {
  it("an unterminated \\iffalse is transparent", () => {
    expect(req("\\iffalse x \\autocite{b}")).toEqual(["biblatex"]);
  });
  it("\\newif\\iffoo and \\def\\x{\\iffalse} open no block", () => {
    expect(req("\\newif\\iffoo \\autocite{b} \\fi")).toEqual(["biblatex"]);
    expect(req("\\def\\x{\\iffalse} \\autocite{b} \\fi")).toEqual([
      "biblatex",
    ]);
    expect(req("\\let\\x\\iffalse \\autocite{b} \\fi")).toEqual(["biblatex"]);
  });
  it("macros spelled \\if… that take no \\fi do not count as nesting", () => {
    // \ifthenelse / \iff are not conditionals: the \fi closes the \iffalse.
    expect(
      req("\\iffalse \\ifthenelse{a}{b}{c} $p \\iff q$ \\fi \\autocite{b}"),
    ).toEqual(["biblatex"]);
  });
  it("a \\newif-declared name DOES count as nesting", () => {
    expect(
      req("\\newif\\iffoo\n\\iffalse \\iffoo x\\fi \\autocite{b} \\fi"),
    ).toEqual([]);
  });
  it("an unterminated \\begin{comment} swallows (consistent with verbatim)", () => {
    expect(req("x\n\\begin{comment}\n\\autocite{b}\n")).toEqual([]);
  });
});

describe("task 1370: detectBibFamily and the live preamble", () => {
  it("an \\iffalse'd \\usepackage{biblatex} does not outrank a live natbib", () => {
    const tex =
      "\\documentclass{article}\n\\iffalse\\usepackage{biblatex}\\fi\n" +
      "\\usepackage{natbib}\n\\begin{document}\n\\citep{a}\n\\end{document}\n";
    expect(detectBibFamily(tex)).toBe("natbib");
    expect(livePreamble(tex)).not.toContain("biblatex");
  });
});

describe("task 1370: projection mechanics", () => {
  it("offset-preserving mode keeps length and newlines", () => {
    const src = "a\n\\iffalse b\nc \\fi d";
    const out = blankFalseConditionals(src, (s) => " ".repeat(s.length));
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(3);
    expect(out.trim().startsWith("a")).toBe(true);
    expect(out).toContain(" d");
    expect(out).not.toContain("b");
  });
  it("the option is off by default for other projections", () => {
    expect(projectLiveLatex("\\iffalse x\\fi")).toBe("\\iffalse x\\fi");
    expect(projectDetectableLatex("\\iffalse x\\fi y")).toBe(" y");
  });
});
