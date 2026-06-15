// Pins the parser-correctness fix (action-alignment CHIP 8, finding #5):
// `parseCiteCommand` of an EMPTY cite body (`\cite{}`, `\cite{ }`) must yield
// an EMPTY `keys` array `[]`, NOT a one-element `[""]`. The `[""]` shape (length
// 1) silently defeated `useCitations.addCitation`'s `keys.length === 0` pristine
// check, leaving a dead branch and a wrong parser result. Real keys, multi-key
// commands, and stray-comma collapsing are pinned alongside as regression guards.

import { describe, it, expect } from "vitest";
import { parseCiteCommand } from "../bib-parser";

describe("parseCiteCommand: empty / whitespace-only cite body → []", () => {
  it("\\cite{} parses to an EMPTY keys array (was the [\"\"] bug)", () => {
    const parsed = parseCiteCommand("\\cite{}");
    expect(parsed).not.toBeNull();
    expect(parsed?.keys).toEqual([]);
    // The pristine signal addCitation reads: an empty cite IS key-less.
    expect(parsed?.keys.length === 0).toBe(true);
    // The command's type metadata is still recovered (not lost to a null parse).
    expect(parsed?.type).toBe("cite");
  });

  it("\\cite{ } (whitespace-only body) also parses to []", () => {
    const parsed = parseCiteCommand("\\cite{ }");
    expect(parsed).not.toBeNull();
    expect(parsed?.keys).toEqual([]);
  });

  it("\\parencite{} (biblatex single command) parses to [] and keeps its type", () => {
    // A biblatex command present in BIBLATEX_HEAD_RE reaches the brace-walk and
    // matches the empty `{}` group, so it parses to a valid key-less citation.
    const parsed = parseCiteCommand("\\parencite{}");
    expect(parsed).not.toBeNull();
    expect(parsed?.keys).toEqual([]);
    expect(parsed?.type).toBe("parencite");
  });

  it("a bare head with NO brace group (\\cite) is still unparseable → null", () => {
    expect(parseCiteCommand("\\cite")).toBeNull();
  });
});

describe("parseCiteCommand: real keys are unaffected by the empty-key filter", () => {
  it("\\cite{smith2020} → [\"smith2020\"]", () => {
    expect(parseCiteCommand("\\cite{smith2020}")?.keys).toEqual(["smith2020"]);
  });

  it("multi-key \\cite{a,b} → [\"a\", \"b\"]", () => {
    expect(parseCiteCommand("\\cite{a,b}")?.keys).toEqual(["a", "b"]);
  });

  it("\\citep{a,b} → [\"a\", \"b\"]", () => {
    expect(parseCiteCommand("\\citep{a,b}")?.keys).toEqual(["a", "b"]);
  });

  it("stray commas collapse: \\cite{a,,b} → [\"a\", \"b\"]", () => {
    expect(parseCiteCommand("\\cite{a,,b}")?.keys).toEqual(["a", "b"]);
  });

  it("trailing comma collapses: \\cite{a,b,} → [\"a\", \"b\"]", () => {
    expect(parseCiteCommand("\\cite{a,b,}")?.keys).toEqual(["a", "b"]);
  });

  it("whitespace around keys is trimmed: \\cite{ a , b } → [\"a\", \"b\"]", () => {
    expect(parseCiteCommand("\\cite{ a , b }")?.keys).toEqual(["a", "b"]);
  });

  it("biblatex multi-cite \\cites{a}{b} → [\"a\", \"b\"]", () => {
    expect(parseCiteCommand("\\cites{a}{b}")?.keys).toEqual(["a", "b"]);
  });
});
