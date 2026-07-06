import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  serializeToLatex,
  mergeTitlesIntoStylePreamble,
} from "@/lib/latex-serializer";

const ARTICLE_TEX = `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Untitled}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}

Start writing here...

\\end{document}
`;

describe("title-field round-trip", () => {
  it("preserves \\title / \\author / \\date through parse → serialize", () => {
    const doc = parseLatex(ARTICLE_TEX);
    const delimiters = extractPreambleAndPostamble(ARTICLE_TEX);
    const out = serializeToLatex(doc, delimiters ?? undefined);

    // All three preamble commands must be present and in the preamble
    // (before \begin{document}).
    const beginDoc = out.indexOf("\\begin{document}");
    expect(beginDoc).toBeGreaterThan(-1);
    const preambleSlice = out.slice(0, beginDoc);
    expect(preambleSlice).toMatch(/\\title\{Untitled\}/);
    expect(preambleSlice).toMatch(/\\author\{\}/);
    expect(preambleSlice).toMatch(/\\date\{\\today\}/);

    // \maketitle survives in the body (it's a separate node).
    const bodySlice = out.slice(beginDoc);
    expect(bodySlice).toMatch(/\\maketitle/);

    // The body must NOT redundantly emit \title / \author / \date.
    expect(bodySlice).not.toMatch(/\\title\{/);
    expect(bodySlice).not.toMatch(/\\author\{/);
    expect(bodySlice).not.toMatch(/\\date\{/);
  });

  it("hoists a body-positioned \\title{} into the preamble on serialize", () => {
    // User pastes / types \title in the body — common with old templates
    // that don't pre-strip them. The parser builds a titleField node,
    // the post-pass hoists it to the top of the doc tree, and the
    // serializer emits it to the preamble.
    const malformed = `\\documentclass{article}
\\usepackage{amsmath}

\\begin{document}

\\title{Body Title}
\\maketitle

Hello.

\\end{document}
`;
    const doc = parseLatex(malformed);
    const delimiters = extractPreambleAndPostamble(malformed);
    const out = serializeToLatex(doc, delimiters ?? undefined);

    const beginDoc = out.indexOf("\\begin{document}");
    expect(out.slice(0, beginDoc)).toMatch(/\\title\{Body Title\}/);
    expect(out.slice(beginDoc)).not.toMatch(/\\title\{/);
  });

  it("survives a full parse → serialize → parse cycle (identity for title block)", () => {
    const doc1 = parseLatex(ARTICLE_TEX);
    const delim1 = extractPreambleAndPostamble(ARTICLE_TEX);
    const out1 = serializeToLatex(doc1, delim1 ?? undefined);

    const doc2 = parseLatex(out1);
    const delim2 = extractPreambleAndPostamble(out1);
    const out2 = serializeToLatex(doc2, delim2 ?? undefined);

    // After two round-trips the title block bytes are stable
    // (modulo internal whitespace / virgil command injection).
    expect(out2).toMatch(/\\title\{Untitled\}/);
    expect(out2).toMatch(/\\author\{\}/);
    expect(out2).toMatch(/\\date\{\\today\}/);
  });

  it("dedups duplicate \\title{} entries — first occurrence wins", () => {
    const duplicated = `\\documentclass{article}

\\title{First}
\\title{Second}
\\author{Me}

\\begin{document}
\\maketitle
Hello.
\\end{document}
`;
    const doc = parseLatex(duplicated);
    const delimiters = extractPreambleAndPostamble(duplicated);
    const out = serializeToLatex(doc, delimiters ?? undefined);

    expect(out).toMatch(/\\title\{First\}/);
    expect(out).not.toMatch(/\\title\{Second\}/);
  });

  it("preserves a sizing prefix on the \\today path (\\date{\\small\\today})", () => {
    // The parser strips `\small` into rawPrefix AND sets isToday=true; the
    // serializer's isToday branch must re-emit the prefix or `\small` is lost.
    const withPrefix = `\\documentclass{article}

\\date{\\small\\today}

\\begin{document}
\\maketitle
\\end{document}
`;
    const doc = parseLatex(withPrefix);
    const delimiters = extractPreambleAndPostamble(withPrefix);
    const out = serializeToLatex(doc, delimiters ?? undefined);

    const beginDoc = out.indexOf("\\begin{document}");
    expect(out.slice(0, beginDoc)).toMatch(/\\date\{\\small\\today\}/);
  });

  it("leaves a prefix-free \\date{\\today} unchanged (no spurious rawPrefix)", () => {
    const doc = parseLatex(ARTICLE_TEX);
    const delimiters = extractPreambleAndPostamble(ARTICLE_TEX);
    const out = serializeToLatex(doc, delimiters ?? undefined);
    const beginDoc = out.indexOf("\\begin{document}");
    const preambleSlice = out.slice(0, beginDoc);
    expect(preambleSlice).toMatch(/\\date\{\\today\}/);
    // The bare form must NOT gain a phantom prefix.
    expect(preambleSlice).not.toMatch(/\\date\{\\[a-zA-Z]+\\today\}/);
  });

  it("orders title fields canonically: title → author → date", () => {
    // Source has them in reverse order; serializer must emit canonically.
    const reversed = `\\documentclass{article}

\\date{\\today}
\\author{Z}
\\title{A}

\\begin{document}
\\maketitle
\\end{document}
`;
    const doc = parseLatex(reversed);
    const delimiters = extractPreambleAndPostamble(reversed);
    const out = serializeToLatex(doc, delimiters ?? undefined);

    const titlePos = out.indexOf("\\title{A}");
    const authorPos = out.indexOf("\\author{Z}");
    const datePos = out.indexOf("\\date{\\today}");
    expect(titlePos).toBeGreaterThan(-1);
    expect(authorPos).toBeGreaterThan(titlePos);
    expect(datePos).toBeGreaterThan(authorPos);
  });
});

describe("mergeTitlesIntoStylePreamble", () => {
  it("carries existing title commands from old preamble into a new style preamble", () => {
    const oldLatex = `\\documentclass[11pt]{article}
\\usepackage{amsmath}

\\title{My Paper}
\\author{Gabriel}
\\date{\\today}

\\begin{document}
Hello.
\\end{document}
`;
    const newPreamble = `\\documentclass{article}
\\usepackage{xcolor}

\\begin{document}

`;
    const merged = mergeTitlesIntoStylePreamble(oldLatex, newPreamble);

    expect(merged).toMatch(/\\title\{My Paper\}/);
    expect(merged).toMatch(/\\author\{Gabriel\}/);
    expect(merged).toMatch(/\\date\{\\today\}/);
    // Must still end with \begin{document} (i.e. titles inserted BEFORE
    // \begin{document}, not after).
    const beginDoc = merged.indexOf("\\begin{document}");
    expect(beginDoc).toBeGreaterThan(-1);
    expect(merged.indexOf("\\title{My Paper}")).toBeLessThan(beginDoc);
  });

  it("returns the new preamble unchanged when the old preamble has no title fields", () => {
    const oldLatex = `\\documentclass{article}

\\begin{document}
Hello.
\\end{document}
`;
    const newPreamble = `\\documentclass{report}

\\begin{document}

`;
    const merged = mergeTitlesIntoStylePreamble(oldLatex, newPreamble);
    expect(merged).toBe(newPreamble);
  });

  it("preserves the trailing UUID anchor on harvested title lines", () => {
    const oldLatex = `\\documentclass{article}

\\title{Paper} %!v:abcd
\\author{Me} %!v:1234

\\begin{document}
\\end{document}
`;
    const newPreamble = `\\documentclass{book}

\\begin{document}

`;
    const merged = mergeTitlesIntoStylePreamble(oldLatex, newPreamble);
    expect(merged).toMatch(/\\title\{Paper\} %!v:abcd/);
    expect(merged).toMatch(/\\author\{Me\} %!v:1234/);
  });
});
