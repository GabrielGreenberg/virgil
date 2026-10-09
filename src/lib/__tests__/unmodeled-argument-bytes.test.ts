import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import {
  INLINE_VERBATIM_COMMANDS,
  matchInlineVerbAt,
  projectLiveLatex,
} from "@/lib/latex-lexer";

/**
 * Task 1020 — a modeled arm must either MODEL an argument or CARRY its bytes;
 * it may never drop or prose-escape them.
 *
 * Two lanes broke that: the env dispatcher stripped an abutting `[…]` from
 * every environment while only the list and figure arms had somewhere to put
 * it (`\begin{quote}[Note]` lost "[Note]" on the first save), and the inline
 * verbatim matcher knew only `\verb`, so `\lstinline|a_b|` saved as
 * `\lstinline|a\_b|`.
 */

function parseBody(input: string) {
  return parseLatex(
    `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`,
  );
}

/** By default the whole block survives byte-for-byte. A modeling arm may
 *  re-indent (its own layout), so its callers pass the `keep` slice that must
 *  survive; either way the text must reach a fixed point. */
function expectStable(block: string, keep: string = block) {
  let text = serializeBody(parseBody(block));
  expect(text, "first save keeps every argument byte").toContain(keep);
  const first = text;
  for (let i = 0; i < 2; i++) text = serializeBody(parseBody(text));
  expect(text, "a fixed point, not drift per save").toBe(first);
}

describe("an env bracket the arm does not model is carried, not dropped", () => {
  const cases = [
    "\\begin{quote}[Note] Hello.\\end{quote}",
    "\\begin{verbatim}[1,2]\nx\n\\end{verbatim}",
  ];
  for (const block of cases) {
    it(`round-trips ${JSON.stringify(block)}`, () => expectStable(block));
  }

  // The arms that DO model it keep doing so (they own their layout).
  const modeled: [string, string][] = [
    ["\\begin{itemize}[noitemsep]\n\\item a\n\\end{itemize}", "\\begin{itemize}[noitemsep]"],
    ["\\begin{enumerate}[label=(\\roman*)]\n\\item a\n\\end{enumerate}", "\\begin{enumerate}[label=(\\roman*)]"],
    ["\\begin{figure}[htbp]\n\\centering\n\\caption{C}\n\\end{figure}", "\\begin{figure}[htbp]"],
  ];
  for (const [block, keep] of modeled) {
    it(`a modeling arm keeps ${JSON.stringify(keep)}`, () => {
      expectStable(block, keep);
      expect(JSON.stringify(parseBody(block))).not.toContain("latexVerbatim");
    });
  }

  it("still models a bracket-less quote as a blockquote", () => {
    const doc = parseBody("\\begin{quote}Hello.\\end{quote}");
    expect(JSON.stringify(doc)).toContain('"blockquote"');
  });
});

describe("every inline verbatim command's payload is literal", () => {
  const cases = [
    "Code \\lstinline|a_b&c#d| here.",
    "Code \\lstinline{a_b} here.",
    "Code \\lstinline[language=C]{x_y{z}} here.",
    "Code \\mintinline{py}{a_b % c} here.",
    "Code \\mintinline[fontsize=\\small]{py}|a_b#c| here.",
    "Code \\Verb|a_b \"q\"| here.",
    "Code \\Verb*[commandchars=\\\\]+a_b+ here.",
    "Code \\spverb|a_b| here.",
    "Code \\verb|a_b| and \\verb*!c&d! here.",
  ];
  for (const block of cases) {
    it(`round-trips ${JSON.stringify(block)} in the body`, () =>
      expectStable(block));
    it(`round-trips ${JSON.stringify(block)} in a footnote/card body`, () => {
      let tex = richJsonToLatex(richLatexToJson(block));
      expect(tex).toBe(block);
      tex = richJsonToLatex(richLatexToJson(tex));
      expect(tex).toBe(block);
    });
  }

  it("every table row is matched by the shared matcher", () => {
    for (const c of INLINE_VERBATIM_COMMANDS) {
      const run = `\\${c.name}${c.lang ? "{py}" : ""}|a_b|`;
      expect(matchInlineVerbAt(run, 0), c.name).toBe(run.length);
    }
  });

  it("word boundaries hold: longer control words are not family members", () => {
    expect(matchInlineVerbAt("\\verbatim{x}", 0)).toBe(-1);
    expect(matchInlineVerbAt("\\lstinputlisting{f.c}", 0)).toBe(-1);
    expect(matchInlineVerbAt("\\lstinlinex|a|", 0)).toBe(-1);
    expect(matchInlineVerbAt("\\mintinline|a|", 0)).toBe(-1); // no language
    expect(matchInlineVerbAt("\\lstinline{a\nb}", 0)).toBe(-1); // one line
  });

  it("the drop projection blanks the same runs the parsers claim", () => {
    const src = "a \\lstinline{x_{y}} b \\mintinline{py}{$x$} c";
    const out = projectLiveLatex(src, { inlineVerb: true });
    expect(out).toBe("a  b  c");
  });
});
