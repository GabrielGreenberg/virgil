import { describe, it, expect } from "vitest";
import { runSyntaxChecks } from "../syntax-check";

/**
 * Task 1550: the syntax checker skipped verbatim ENVIRONMENTS but read inline
 * verbatim payloads as live LaTeX — a `{` raised a false unmatched-brace, a
 * `%` swallowed the rest of the line (hiding real errors), a `$` opened
 * "inline math". It now jumps each run whole through the lexer's one inline
 * door (`matchInlineVerbAt`).
 */
describe("runSyntaxChecks — inline verbatim payloads are literal", () => {
  const ruleIds = (text: string) => runSyntaxChecks(text).map((e) => e.ruleId);

  it.each([
    "Type \\verb|{| to open a group.",
    "\\lstinline|a}b|",
    "A \\verb|$| sign.",
    "Starred \\verb*|{| too.",
    "\\lstinline|%| then \\lstinline|}|.",
    "\\Verb[x]|$|, \\spverb|{|, \\mintinline{py}{x % {2}}",
  ])("raises no diagnostic for %s", (line) => {
    expect(ruleIds(line)).toEqual([]);
  });

  it("a `%` inside \\verb does not swallow a real error later on the line", () => {
    const errs = runSyntaxChecks("A \\verb|%| sign. Then \\ref{nolabel}.");
    expect(errs.map((e) => e.ruleId)).toEqual(["ref-undefined"]);
  });

  it("brace-form \\lstinline closes at its MATCHING brace — a trailing `}` is real", () => {
    // `\lstinline{a}` is the whole run; the `b}` after it is genuinely unmatched.
    expect(ruleIds("\\lstinline{a}b}")).toEqual(["brace-unmatched-close"]);
  });

  it("a `%` inside \\lstinline does not swallow a real unmatched brace", () => {
    expect(ruleIds("\\lstinline|%| {")).toEqual(["brace-unmatched-open"]);
  });

  it("an UNTERMINATED run falls back to the ordinary scan (does not eat the doc)", () => {
    // `\verb|abc` never closes on its line: the run is not claimed, so the
    // brace on the next line is still checked like any other.
    const errs = runSyntaxChecks("\\verb|abc\n}");
    expect(errs.map((e) => e.ruleId)).toContain("brace-unmatched-close");
  });
});
