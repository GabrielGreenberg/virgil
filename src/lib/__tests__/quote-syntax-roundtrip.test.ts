import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, trackedFiles } from "./_source-scan";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly, serializeToLatex } from "@/lib/latex-serializer";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import {
  isQuoteSyntaxAt,
  smartenQuotesOutsideSyntax,
  matchTexNumberAt,
  preambleActivatesQuoteShorthand,
} from "@/lib/latex-lexer";

/**
 * Task 1160 — a straight `"` that is LaTeX SYNTAX is not a quotation mark.
 *
 * The smart-quote rung canonicalises a prose `"` to ``` `` ```/`''`. Before
 * 1160 it did so inside `\url`/`\href`/`\path` arguments (the link target
 * changed), at a TeX hex radix (`\char"41` became a backtick char-code), and
 * in a babel-German paper (`Stra"se` lost its ß). Every row runs through the
 * BODY path and a `\footnote{…}` body, twice: the second save must equal the
 * first, and both must equal the input.
 */

const EN = "\\documentclass{article}\n";
const DE = "\\documentclass{article}\n\\usepackage[ngerman]{babel}\n";

function body(preamble: string, inner: string): string {
  return `${preamble}\\begin{document}\n${inner}\n\\end{document}`;
}

/** One body save, the body bytes only. */
function saveBody(preamble: string, inner: string): string {
  return serializeBodyOnly(parseLatex(body(preamble, inner)));
}

/** Two full save cycles through `serializeToLatex`. */
function twoCycles(preamble: string, inner: string): [string, string] {
  const opts = { preamble: `${preamble}\\begin{document}\n`, postamble: "\n\\end{document}\n" };
  const once = serializeToLatex(parseLatex(body(preamble, inner)), opts);
  const twice = serializeToLatex(parseLatex(once), opts);
  return [once, twice];
}

/** A standalone card/footnote body (no preamble in hand). */
function cardBody(src: string): string {
  return richJsonToLatex(richLatexToJson(src));
}

const SYNTAX_ROWS = [
  String.raw`\url{http://x.org/?q="a"}`,
  String.raw`\href{http://x.org/?q="a"}{the site}`,
  String.raw`\path{C:/"My Docs"/a}`,
  String.raw`\nolinkurl{a"b}`,
  String.raw`\char"41 x`,
  String.raw`\char "41 x`,
  String.raw`\symbol{"41}`,
  String.raw`\catcode"22=12 x`,
  // Task 1204 — a code span and a raw command's arguments are not prose.
  String.raw`Use \texttt{print("hi")} here.`,
  String.raw`Click \includegraphics[height=1em]{"my icon"} here.`,
  String.raw`\input{"chap 1"}`,
];

describe("a `\"` that is LaTeX syntax survives every save (task 1160)", () => {
  for (const row of SYNTAX_ROWS) {
    it(`body: ${row}`, () => {
      expect(saveBody(EN, row)).toBe(row);
      const [once, twice] = twoCycles(EN, row);
      expect(once).toContain(row);
      expect(twice).toBe(once);
    });

    it(`footnote: ${row}`, () => {
      const inner = `Text.\\footnote{See ${row} here.}`;
      const [once, twice] = twoCycles(EN, inner);
      expect(once).toContain(`\\footnote{See ${row} here.}`);
      expect(twice).toBe(once);
    });

    it(`card body: ${row}`, () => {
      expect(cardBody(row)).toBe(row);
      expect(cardBody(cardBody(row))).toBe(row);
    });
  }

  it("\\href keeps BOTH arguments byte-identical — a raw command run is never smartened (task 1204)", () => {
    const row = String.raw`\href{http://x.org/?q="a"}{"text"}`;
    expect(saveBody(EN, row)).toBe(row);
  });

  it("ordinary English prose quotes are still canonicalised", () => {
    expect(saveBody(EN, 'He said "dumb quotes" twice.')).toBe("He said ``dumb quotes'' twice.");
    expect(cardBody('a "b" c')).toBe("a ``b'' c");
  });

  it("a `\"` near — but not inside — a verbatim argument still smartens", () => {
    expect(saveBody(EN, String.raw`"see" \url{a"b}`)).toBe("``see'' " + String.raw`\url{a"b}`);
  });

  it("a lowercase or non-hex `\"` after \\char is not a radix", () => {
    expect(isQuoteSyntaxAt(String.raw`\char"41`, 5)).toBe(true);
    expect(isQuoteSyntaxAt(String.raw`\char"zz`, 5)).toBe(false);
    expect(isQuoteSyntaxAt(String.raw`\chars"41`, 6)).toBe(false);
    expect(isQuoteSyntaxAt(String.raw`\\char"41`, 6)).toBe(false);
  });

  it("matchTexNumberAt reads the three radixes and the `=` form", () => {
    expect(matchTexNumberAt('"41 x', 0)).toBe(3);
    expect(matchTexNumberAt(" = '101", 0)).toBe(7);
    expect(matchTexNumberAt("65", 0)).toBe(2);
    expect(matchTexNumberAt('"x', 0)).toBe(-1);
    expect(matchTexNumberAt(" word", 0)).toBe(-1);
  });
});

describe("a babel-active `\"` document keeps every shorthand (task 1160)", () => {
  const SHORTHANDS = String.raw`German "a and Stra"se, "o, "=, "-, "` + "`" + String.raw`x"' ok.`;

  it("detects babel `\"`-shorthand languages from the live preamble", () => {
    expect(preambleActivatesQuoteShorthand(DE)).toBe(true);
    expect(preambleActivatesQuoteShorthand("\\documentclass[ngerman]{article}\n\\usepackage{babel}\n")).toBe(true);
    expect(preambleActivatesQuoteShorthand("\\usepackage[english]{babel}\n")).toBe(false);
    expect(preambleActivatesQuoteShorthand("% \\usepackage[ngerman]{babel}\n")).toBe(false);
    expect(preambleActivatesQuoteShorthand(EN)).toBe(false);
    expect(preambleActivatesQuoteShorthand('\\usepackage{babel}\\useshorthands{"}\n')).toBe(true);
  });

  it("body: shorthands are byte-identical across two saves", () => {
    expect(saveBody(DE, SHORTHANDS)).toBe(SHORTHANDS);
    const [once, twice] = twoCycles(DE, SHORTHANDS);
    expect(once).toContain(SHORTHANDS);
    expect(twice).toBe(once);
  });

  it("footnote: shorthands are byte-identical across two saves", () => {
    const inner = `Text.\\footnote{${SHORTHANDS}}`;
    const [once, twice] = twoCycles(DE, inner);
    expect(once).toContain(`\\footnote{${SHORTHANDS}}`);
    expect(twice).toBe(once);
  });

  it("without babel the same prose still smartens", () => {
    expect(saveBody(EN, 'Say "hi".')).toBe("Say ``hi''.");
  });

  it("the gate is scoped to one parse — a later preamble-less parse smartens", () => {
    parseLatex(body(DE, 'Stra"se'));
    expect(cardBody('a "b" c')).toBe("a ``b'' c");
  });
});

describe("smartening is prose-only (task 1204)", () => {
  it("a curly glyph before a verbatim argument does not shift its span", () => {
    expect(smartenQuotesOutsideSyntax("“a” \\url{x?q=\"a\"}")).toBe(
      "``a'' \\url{x?q=\"a\"}",
    );
  });

  it("a code span keeps its straight quotes and still maps curly glyphs", () => {
    expect(smartenQuotesOutsideSyntax('"x" “y”', { codeSpan: true })).toBe(
      "\"x\" ``y''",
    );
  });

  it("\\texttt round-trips its `` / '' pairs", () => {
    const row = "\\texttt{``a''}";
    expect(saveBody(EN, row)).toBe(row);
  });

  it("the standalone ngerman / german packages activate the shorthand", () => {
    expect(preambleActivatesQuoteShorthand("\\usepackage{ngerman}\n")).toBe(true);
    expect(preambleActivatesQuoteShorthand("\\usepackage{german}\n")).toBe(true);
    expect(preambleActivatesQuoteShorthand("% \\usepackage{ngerman}\n")).toBe(false);
    const NG = "\\documentclass{article}\n\\usepackage{ngerman}\n";
    expect(saveBody(NG, 'Stra"se')).toBe('Stra"se');
  });
});

describe("CENSUS: smartening goes through the syntax-aware door (task 1160)", () => {
  it("only latex-lexer.ts calls smartenStraightQuotes", () => {
    const offenders = trackedFiles("src", /\.tsx?$/)
      .filter((abs) => !abs.includes("/__tests__/"))
      .filter((abs) =>
        /\bsmartenStraightQuotes\(/.test(
          readFileSync(abs, "utf8").replace(/^\s*(\/\/|\*).*$/gm, ""),
        ),
      )
      .map((abs) => path.relative(REPO_ROOT, abs));
    expect(offenders).toEqual(["src/lib/latex-lexer.ts", "src/lib/latex-typography.ts"]);
  });
});
