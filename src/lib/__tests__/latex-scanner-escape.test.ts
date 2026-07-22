import { describe, expect, it } from "vitest";
import {
  isEscaped,
  findMatchingBrace,
  extractBraced,
} from "@/lib/latex-lexer";
import { isEscaped as isEscapedLeaf } from "@/lib/latex-typography";
import { parseLatex } from "@/lib/latex-parser";
import { mergeTitlesIntoStylePreamble } from "@/lib/latex-serializer";
import { richLatexToJson } from "@/lib/footnote-content";
import type { JSONContent } from "@tiptap/react";

/**
 * Task 206 — delimiter escaping is BACKSLASH-RUN PARITY, decided in ONE place.
 *
 * The nine former copies of the naive `text[i - 1] !== "\\"` test all read an
 * EVEN backslash run (`\\{`, `\\}`, `\\$` — a `\\` line break immediately
 * followed by a real delimiter) as "escaped", so groups never balanced and
 * math never toggled. These cover the even-run fix plus the odd-run regression
 * guard (`\{` must STILL be literal — don't over-correct).
 */

/** Flatten a parsed doc to the list of node types present, depth-first. */
function nodeTypes(json: JSONContent): string[] {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type) out.push(n.type);
    (n.content ?? []).forEach(walk);
  };
  walk(json);
  return out;
}

describe("isEscaped — the shared parity rule", () => {
  it("is the same function the lexer re-exports and the leaf defines", () => {
    expect(isEscaped).toBe(isEscapedLeaf);
  });

  it("odd runs escape, even runs do not", () => {
    //           0123
    const text = "\\\\{"; // `\\{` — run of 2 before `{`
    expect(isEscaped(text, 2)).toBe(false);

    const odd = "\\{"; // `\{` — run of 1
    expect(isEscaped(odd, 1)).toBe(true);

    const three = "\\\\\\{"; // run of 3
    expect(isEscaped(three, 3)).toBe(true);

    const four = "\\\\\\\\{"; // run of 4
    expect(isEscaped(four, 4)).toBe(false);
  });

  it("index 0 and a run-free delimiter are never escaped", () => {
    expect(isEscaped("{a}", 0)).toBe(false);
    expect(isEscaped("a{b}", 1)).toBe(false);
  });
});

describe("brace scanners — even backslash runs are real delimiters", () => {
  it("extractBraced spans a group containing a \\\\-preceded brace", () => {
    // `\textbf{a\\{b}c}` — the `{` after `\\` opens a REAL nested group, so
    // the outer group closes at the LAST `}`, not the one after `b`.
    const src = "\\textbf{a\\\\{b}c}";
    const open = src.indexOf("{");
    expect(extractBraced(src, open)).toEqual({
      content: "a\\\\{b}c",
      end: src.length,
    });
  });

  it("findMatchingBrace agrees with extractBraced on the same input", () => {
    const src = "\\textbf{a\\\\{b}c}";
    const open = src.indexOf("{");
    expect(findMatchingBrace(src, open)).toBe(src.length - 1);
  });

  it("regression guard: an ODD run still makes the brace literal", () => {
    // `\{` / `\}` are literal braces — depth must not change.
    const src = "{a\\{b\\}c}";
    expect(extractBraced(src, 0)).toEqual({
      content: "a\\{b\\}c",
      end: src.length,
    });
  });

  it("a group ending in \\\\ is balanced, not unterminated", () => {
    // `{text\\}` — the naive test read the `}` as escaped → null.
    const src = "{text\\\\}";
    expect(extractBraced(src, 0)).toEqual({ content: "text\\\\", end: src.length });
  });
});

describe("commands whose argument ends in a line break", () => {
  it("\\emph{text\\\\} parses as an emph mark, not literal text", () => {
    const doc = parseLatex(
      "\\begin{document}\n\\emph{text\\\\}\n\\end{document}\n",
    );
    const marks: string[] = [];
    const walk = (n: JSONContent) => {
      (n.marks ?? []).forEach((m) => marks.push(m.type as string));
      (n.content ?? []).forEach(walk);
    };
    walk(doc);
    expect(marks).toContain("italic");
  });
});

describe("math-delimiter toggles", () => {
  it("end\\\\$x^2$more parses the math as inlineMath (parser)", () => {
    const doc = parseLatex(
      "\\begin{document}\nend\\\\$x^2$more\n\\end{document}\n",
    );
    expect(nodeTypes(doc)).toContain("inlineMath");
  });

  it("the same holds in footnote content (richLatexToJson)", () => {
    expect(nodeTypes(richLatexToJson("end\\\\$x^2$more"))).toContain(
      "inlineMath",
    );
  });

  it("regression guard: an escaped \\$ is still a literal dollar", () => {
    expect(nodeTypes(richLatexToJson("costs \\$5 and \\$6"))).not.toContain(
      "inlineMath",
    );
  });
});

/**
 * Task 210 — the CLOSING delimiter search is escape-aware too (the
 * closing-side twin of the task-206 opening rule). A legitimately escaped
 * `\$` INSIDE a math run must not terminate the node early; the search finds
 * the first UNESCAPED delimiter via the shared `findUnescaped` SSOT.
 */

/** Collect the `latex` attr of every inlineMath node, depth-first. */
function mathLatex(json: JSONContent): string[] {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "inlineMath") out.push((n.attrs?.latex as string) ?? "");
    (n.content ?? []).forEach(walk);
  };
  walk(json);
  return out;
}

/** Concatenate every text node's text, depth-first. */
function allText(json: JSONContent): string {
  let out = "";
  const walk = (n: JSONContent) => {
    if (typeof n.text === "string") out += n.text;
    (n.content ?? []).forEach(walk);
  };
  walk(json);
  return out;
}

describe("math CLOSING delimiter is escape-aware (task 210)", () => {
  it("$a \\$ b$ tail → ONE inlineMath 'a \\$ b', then literal ' tail' (parser)", () => {
    const doc = parseLatex(
      "\\begin{document}\n$a \\$ b$ tail\n\\end{document}\n",
    );
    expect(mathLatex(doc)).toEqual(["a \\$ b"]);
    expect(allText(doc)).toContain("tail");
  });

  it("same input through the footnote path (richLatexToJson)", () => {
    const json = richLatexToJson("$a \\$ b$ tail");
    expect(mathLatex(json)).toEqual(["a \\$ b"]);
    expect(allText(json)).toContain("tail");
  });

  it("$$a \\$ b$$ display-math twin closes at the real $$", () => {
    const doc = parseLatex(
      "\\begin{document}\n$$a \\$ b$$ tail\n\\end{document}\n",
    );
    expect(mathLatex(doc)).toEqual(["a \\$ b"]);
    expect(allText(doc)).toContain("tail");
  });

  it("regression: $x\\\\$ (even run — a \\\\ line break) STILL closes at that $", () => {
    // The `\\` before the close is an EVEN run → non-escaping, so the close is
    // real. `indexOf` was already correct here; parity keeps it correct.
    const doc = parseLatex("\\begin{document}\n$x\\\\$\n\\end{document}\n");
    expect(mathLatex(doc)).toEqual(["x\\\\"]);
  });

  it("regression: an unterminated $ still falls through to literal text", () => {
    const doc = parseLatex("\\begin{document}\n$abc no close\n\\end{document}\n");
    expect(nodeTypes(doc)).not.toContain("inlineMath");
    expect(allText(doc)).toContain("$abc no close");
  });
});

describe("title harvest survives a \\\\-terminated field (style merge)", () => {
  it("keeps \\title{Foo\\\\} and its %!v: UUID through a style switch", () => {
    const oldLatex =
      "\\documentclass{article}\n" +
      "\\title{Foo\\\\} %!v:abc123\n" +
      "\\author{Someone}\n" +
      "\\begin{document}\nBody\n\\end{document}\n";
    const newPreamble =
      "\\documentclass{amsart}\n\\usepackage{amsmath}\n\\begin{document}\n";

    const merged = mergeTitlesIntoStylePreamble(oldLatex, newPreamble);

    expect(merged).toContain("\\title{Foo\\\\}");
    expect(merged).toContain("%!v:abc123");
    expect(merged).toContain("\\author{Someone}");
  });

  it("harvests a nested-group author whose field ends in a line break", () => {
    const oldLatex =
      "\\documentclass{article}\n" +
      "\\author{A\\\\{\\small B}}\n" +
      "\\begin{document}\nBody\n\\end{document}\n";
    const newPreamble = "\\documentclass{amsart}\n\\begin{document}\n";

    const merged = mergeTitlesIntoStylePreamble(oldLatex, newPreamble);
    expect(merged).toContain("\\author{A\\\\{\\small B}}");
  });
});
