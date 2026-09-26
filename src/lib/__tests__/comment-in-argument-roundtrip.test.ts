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
