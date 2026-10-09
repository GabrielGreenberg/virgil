// Task 777 — a `%` comment inside a braced ARGUMENT is still a comment.
//
// In TeX a `%` comments to end of line wherever it appears, braces included,
// and the closing brace is normally on a later line. Pre-777 Virgil honoured
// that only at paragraph level (task 347's carrier), so inside `\emph{…}`,
// `\section{…}`, `\caption{…}` or a footnote body the `%` fell into prose and
// was escaped to `\%` — the user's private note PRINTED in the PDF, rewritten
// on open by the load-writeback, and a fixed point, so nothing healed it.
//
// Same harness as `non-prose-bytes-roundtrip.test.ts`: the REAL save pipeline
// (`parseLatex` → `assignUuids` → `serializeToLatex` with the extracted
// delimiters, as `storage-fsa.writeDocBundle` does), TWO cycles, and every
// control through the identical harness.
import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { richLatexToJson, richJsonToLatex } from "@/lib/footnote-content";
import {
  extractFigureAttrs,
  extractFigureSources,
  withReplacedFigurePath,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";
import {
  extractBraced,
  findMatchingBrace,
  matchCommandArgumentRun,
  projectLiveLatex,
} from "@/lib/latex-lexer";
import { extractCaptionText } from "@/lib/word-count-core";
import { matchCiteCommandAt } from "@/lib/cite-commands";
import { rewriteCiteCommandString } from "@/lib/identity/bib-cite-rewrite";

const PRE = "\\documentclass{article}\n\\begin{document}\n";
const POST = "\n\\end{document}\n";

function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/\\vfid\{[0-9a-f]+\}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

function expectStable(bodyIn: string): void {
  const c1 = save(PRE + bodyIn + POST);
  const c2 = save(c1);
  expect(body(c2), "second save must not move the bytes").toBe(body(c1));
  expect(body(c1)).toBe(bodyIn.trim());
}

describe("task 777 — a comment inside an argument is carried, never escaped", () => {
  it.each([
    ["\\emph", "\\emph{a% note\n b} c"],
    ["\\textbf", "\\textbf{a% note\n b} c"],
    ["a whole-line comment inside \\emph", "\\emph{a\n% whole line\n b}"],
    ["\\section", "\\section{Title% note\n more}"],
    ["\\footnote", "x\\footnote{a% note\n b} c"],
    ["\\verb inside a footnote", "x\\footnote{\\verb|a  b|} y"],
    ["a brace inside the comment is not the close (M3)", "x\\footnote{First % old ending}\n rest.} y"],
    ["a bracket inside the comment is not the close (M3)", "\\begin{itemize}\n  \\item[a% old]\n b] text\n\\end{itemize}"],
  ])("%s", (_label, input) => {
    expectStable(input);
  });

  it("\\caption inside a figure", () => {
    const fig =
      "\\begin{figure}\n\\centering\n\\includegraphics{x.png}\n\\caption{Cap% note\n more}\n\\end{figure}";
    const out = body(save(PRE + fig + POST));
    expect(out).toContain("\\caption{Cap% note\n more}");
    expect(out).not.toContain("\\%");
  });

  it.each([
    ["a mid-line paragraph comment", "a b% note\nc d"],
    ["a genuine escaped percent", "\\emph{grew 5\\% fast}"],
    ["an \\href whose text holds a comment", "\\href{http://x.org}{link% c\n text}"],
    // Virgil's own quote spelling closes on the last line (pre-existing).
    ["a quote body", "\\begin{quote}\nq% c\nr\\end{quote}"],
  ])("control: %s stays byte-identical", (_label, input) => {
    expectStable(input);
  });
});

describe("task 777 M2 — the card/footnote fork", () => {
  it.each([
    ["a mid-line comment keeps its line end", "a% note\n b"],
    ["a whole-line comment keeps its line start", "a\n% whole\n b"],
    ["\\verb payload spaces are byte-literal", "\\verb|a  b| c"],
    ["an escaped percent stays escaped", "grew 5\\% fast"],
  ])("%s", (_label, input) => {
    const once = richJsonToLatex(richLatexToJson(input));
    expect(once).toBe(input);
    expect(richJsonToLatex(richLatexToJson(once))).toBe(once);
  });

  it("a tail that ends the body is closed by a newline, so the brace stays live", () => {
    expect(richJsonToLatex(richLatexToJson("x% end"))).toBe("x% end\n");
  });
});

describe("task 777 M3 — the group scanners read comments, and verbatim arguments stay blind", () => {
  it.each([
    ["\\url's %20 is a URL byte", "See \\url{http://ex.com/a%20b} and {y} more."],
    ["\\url inside a footnote", "x\\footnote{See \\url{http://ex.com/a%20b}.\n More.} y"],
    ["\\href's first argument", "\\href{http://ex.com/a%20b}{the link} c"],
    ["an escaped \\% is literal", "\\emph{grew 5\\% fast} c"],
  ])("%s", (_label, input) => {
    expectStable(input);
  });
});

describe("task 777 M3 — the scanner itself", () => {
  it("a } inside a comment is skipped; the close is on the next line", () => {
    const t = "{First % old ending}\n rest.} y";
    expect(findMatchingBrace(t, 0)).toBe(t.indexOf("rest.}") + 5);
  });

  it("an outer group skips a \\url argument whole — its % is not a comment", () => {
    const t = "{See \\url{a%20b} now}\nmore}} y";
    expect(findMatchingBrace(t, 0)).toBe(t.indexOf("now}") + 3);
  });

  it("\\url's own argument is read comment-blind", () => {
    const t = "\\url{a%20b}.\n More.} y";
    const run = matchCommandArgumentRun(t, "\\url".length, "url");
    expect(run.raw).toBe("{a%20b}");
    // the unnamed (generic) reading would take the comment and close late
    expect(extractBraced(t, 4)?.content).toBe("a%20b}.\n More.");
  });

  it("fails closed: no close in the same paragraph → the blind close", () => {
    const t = "{a% note}\n\nnext }";
    expect(findMatchingBrace(t, 0)).toBe(t.indexOf("}"));
  });

  it("an escaped \\% is literal", () => {
    expect(findMatchingBrace("{5\\% x} y", 0)).toBe(6);
  });
});

describe("task 777 M4 — the figure readers ignore a commented-out \\includegraphics", () => {
  const BODY =
    "\\centering\n% \\includegraphics[width=.3\\textwidth]{draft.png}\n\\includegraphics[width=0.5\\textwidth]{final.png}\n\\caption{C}";

  it("extractFigureSources sees only the live one", () => {
    expect(extractFigureSources(BODY).map((s) => s.path)).toEqual(["final.png"]);
  });

  it("the width editor edits the live line and leaves the comment alone", () => {
    const out = withUpdatedFigureWidth(BODY, 80);
    expect(out).toContain("% \\includegraphics[width=.3\\textwidth]{draft.png}");
    expect(out).toContain("\\includegraphics[width=0.8\\textwidth]{final.png}");
  });

  it("the path editor swaps the live path", () => {
    const out = withReplacedFigurePath(BODY, "new.png");
    expect(out).toContain("{draft.png}");
    expect(out).toContain("{new.png}");
    expect(out).not.toContain("{final.png}");
  });
});

// Task 1021 — the private group scanners 777 left behind. Every round-tripping
// group/bracket read now goes through THE scanner (`findGroupClose` via
// `extractBraced` / `extractBracketed`), so a `}`/`]` in a comment or inside a
// nested group is never the delimiter.
describe("task 1021 — the private scanners 777 left behind", () => {
  const FIG =
    "\\begin{figure}\n\\includegraphics{a.png}\n\\caption{Results % old ending}\n for X.}\n\\end{figure}";

  /** Canonical layout may re-space a construct, so the contract is: the
   *  load-bearing spelling survives the first save, and the second moves nothing. */
  function expectFixed(input: string, needle: string): void {
    const c1 = save(PRE + input + POST);
    expect(body(save(c1)), "second save must not move the bytes").toBe(body(c1));
    expect(body(c1)).toContain(needle);
  }

  it("a } inside a comment in a figure \\caption does not close it (two cycles)", () => {
    expectFixed(FIG, "\\caption{Results % old ending}\n for X.}\n\\end{figure}");
  });

  it("the figure reader keeps the rest of the caption inside it", () => {
    const env = FIG.slice("\\begin{figure}".length, FIG.indexOf("\\end{figure}"));
    expect(extractFigureAttrs(env).caption).toBe("Results % old ending}\n for X.");
  });

  it("a nested ] in the \\caption short title and \\includegraphics options", () => {
    const env = "\n\\includegraphics[trim={0 1]2 0}]{a.png}\n\\caption[Sh{o]r}t]{Long.}\n";
    const attrs = extractFigureAttrs(env);
    expect(attrs.sources[0]?.options).toBe("trim={0 1]2 0}");
    expect(attrs.sources[0]?.path).toBe("a.png");
    expect(attrs.caption).toBe("Long.");
  });

  it("an accent base holding a comment is refused, not closed inside the comment", () => {
    expectStable("x \\'{e % old}\n} y");
  });

  it.each([
    ["\\ex[exno={1]a}] header", "\\ex[exno={1]a}] Sentence.\n\\xe", "\\ex[exno={1]a}]\nSentence."],
    [
      "\\begingl[opts] with a nested ]",
      "\\ex\n\\begingl[glstyle={a]b}]\n\\gla foo bar //\n\\glft t //\n\\endgl\n\\xe",
      "\\begingl[glstyle={a]b}]\n\\gla foo bar //",
    ],
  ])("%s keeps the whole option group (two cycles)", (_label, input, needle) => {
    expectFixed(input, needle);
  });

  it("the word counter reads a caption past a commented brace", () => {
    expect(extractCaptionText("\\caption{Alpha % x}\n beta}")).toEqual(["Alpha % x\n beta"]);
  });

  it("a cite's optional argument closes at the LAST bracket", () => {
    const m = matchCiteCommandAt("\\cite[see {a]b}]{k} rest", 0);
    expect(m?.command).toBe("\\cite[see {a]b}]{k}");
    expect(rewriteCiteCommandString("\\cite[see {a]b}]{k}", "k", "j")).toBe(
      "\\cite[see {a]b}]{j}",
    );
  });

  it("projectLiveLatex: a % or \\begin{verbatim} INSIDE an inline verbatim run is payload", () => {
    const opts = { inlineVerb: true, preserveOffsets: true } as const;
    const a = "\\verb|a%b| live";
    expect(projectLiveLatex(a, opts)).toBe(" ".repeat("\\verb|a%b|".length) + " live");
    const b = "\\lstinline{\\begin{verbatim}} live\nnext";
    expect(projectLiveLatex(b, opts)).toBe(
      " ".repeat("\\lstinline{\\begin{verbatim}}".length) + " live\nnext",
    );
    // A real comment after the run is still a comment.
    expect(projectLiveLatex("\\verb|x| a % c", opts)).toBe("         a    ");
  });
});
