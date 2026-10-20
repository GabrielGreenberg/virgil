/**
 * Task 2026-10-11-1070 — the inline-math DELIMITER is the user's bytes.
 *
 * The lexer reads four delimiter pairs (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) but
 * before 1070 the `inlineMath` node kept no record of which one, and every
 * emitter wrote `$…$`. So the first autosave after OPEN turned a `$$x$$`
 * display equation into INLINE math in the PDF — even as its own paragraph —
 * and rewrote `\(y\)` as `$y$`. A mid-line `\[…\]` was worse: the paragraph
 * reader ended the paragraph at it, so the save put blank lines around the
 * equation and the text after `\]` became a new, indented paragraph.
 *
 * The contract: every delimiter × {mid-paragraph, own paragraph} serializes
 * byte-identical (modulo Virgil's `%!v:` anchors) on BOTH inline surfaces — the
 * main body and the footnote/card fork — and a second cycle is a fixed point.
 * The display forms paint in KaTeX display mode, so the editor shows what the
 * PDF shows.
 */
import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids, serializeBodyOnly } from "@/lib/latex-serializer";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import {
  emitDisplayMath,
  emitInlineMath,
  inlineMathDelim,
  isDisplayInlineMathDelim,
  matchInlineMathAt,
} from "@/lib/latex-lexer";
import type { JSONContent } from "@tiptap/core";

const stripAnchors = (s: string) => s.replace(/%!v:[^\n]*/g, "").trim();
const body = (src: string) => stripAnchors(serializeBodyOnly(parseLatex(src)));

const DELIMS = [
  { open: "$", close: "$", display: false },
  { open: "$$", close: "$$", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "\\[", close: "\\]", display: true },
] as const;

function findMath(doc: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "inlineMath") out.push(n);
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

describe("task 1070 — inline math keeps its delimiter", () => {
  for (const d of DELIMS) {
    const math = `${d.open}x^2${d.close}`;

    it(`${d.open}…${d.close} mid-paragraph round-trips byte-identical`, () => {
      const src = `Let a ${math} b.`;
      expect(body(src)).toBe(src);
      expect(body(body(src))).toBe(src);
      // ONE paragraph, ONE atom carrying the delimiter — never a split.
      const doc = parseLatex(src);
      expect(doc.content?.filter((n) => n.type === "paragraph")).toHaveLength(1);
      const [atom] = findMath(doc);
      expect(atom.attrs?.latex).toBe("x^2");
      expect(inlineMathDelim(atom.attrs?.delim)).toBe(d.open);
    });

    it(`${d.open}…${d.close} round-trips through the footnote/card fork`, () => {
      const src = `Let a ${math} b.`;
      expect(richJsonToLatex(richLatexToJson(src))).toBe(src);
    });

    it(`${d.open}…${d.close} display mode is ${d.display}`, () => {
      expect(isDisplayInlineMathDelim(d.open)).toBe(d.display);
      expect(emitInlineMath("y", d.open)).toBe(`${d.open}y${d.close}`);
    });
  }

  it("a `$$…$$` paragraph of its own stays display math (never `$…$`)", () => {
    const src = "Para.\n\n$$x^2$$\n\nNext.";
    expect(body(src)).toBe(src);
  });

  it("an own-line `\\[…\\]` between blank lines is still the displayMath block", () => {
    const src = "Para.\n\n\\[\nx^2\n\\]\n\nNext.";
    expect(body(src)).toBe(src);
    expect(parseLatex(src).content?.some((n) => n.type === "displayMath")).toBe(true);
  });

  it("a multi-line display run inside a paragraph is read WHOLE — its `\\begin{aligned}` line does not end the paragraph", () => {
    for (const src of [
      "Let a $$\n\\begin{aligned}\nx &= 1\n\\end{aligned}\n$$ b.",
      "Let a \\[ \\begin{aligned}\nx &= 1\n\\end{aligned}\n\\] b.",
    ]) {
      expect(body(src)).toBe(src);
      expect(parseLatex(src).content?.filter((n) => n.type === "paragraph")).toHaveLength(1);
    }
  });

  it("a `\\[` that ENDS its line opens the displayMath block (the expex item shape)", () => {
    const doc = parseLatex("Some text. \\[\ny = 2\n\\]");
    expect(doc.content?.map((n) => n.type)).toEqual(["paragraph", "displayMath"]);
  });

  it("the payload is verbatim — the backslash forms no longer trim", () => {
    expect(matchInlineMathAt("\\( y \\)", 0)).toEqual({ latex: " y ", delim: "\\(", end: 7 });
    expect(body("Let \\( y \\) c.")).toBe("Let \\( y \\) c.");
  });

  it("controls: `\\\\[2pt]` is a line break, not display math; an unknown delim reads as `$`", () => {
    expect(body("Line one\\\\[2pt] two.")).toBe("Line one\\\\[2pt] two.");
    expect(emitInlineMath("z", "bogus")).toBe("$z$");
    expect(emitInlineMath("z", undefined)).toBe("$z$");
  });

  it("a `$…$` atom's JSON carries no `delim` (pre-1070 shape unchanged)", () => {
    const [atom] = findMath(parseLatex("Let $x$ b."));
    expect(atom.attrs).toEqual({ latex: "x" });
  });
});

/**
 * Task 2026-10-20-1207 — a LINE-START display equation inside a paragraph, and
 * a `$` nested in a `\text{…}` group.
 *
 * 1070 fixed the mid-LINE `\[`. The commonest shape of all — the equation on
 * its own lines between two halves of a sentence — still opened a `displayMath`
 * BLOCK whose serializer always wrote blank lines around it, so every save put
 * two `\par`s into the paragraph ("where…" became a new indented paragraph).
 * The block now records its source adjacency (`joinPrev`/`joinNext`) and its
 * delimiter layout (`padOpen`/`padClose`), and the serializer re-emits exactly
 * that. Separately, the math closer is found brace-aware (`findMathClose`), so
 * `$\text{for all $x_i$}$` is one formula, not two halves and an escaped `_`.
 */
describe("task 1207 — display math keeps its paragraph; nested `$` is not a closer", () => {
  const ROWS = [
    "Lead in.\n\\[x^2\\]\nwhere x is real.",
    "Lead in.\n\\[\nx^2\n\\]\nwhere x is real.",
    "Lead in.\n\\[ x^2 \\]\n\nNext paragraph.",
    "Lead in.\n\n\\[\nx^2\n\\]\nwhere x is real.",
    "Let $\\text{for all $x_i$}$ hold.",
    "Let \\(\\mbox{if $a$ then $b$}\\) hold.",
  ];
  for (const src of ROWS) {
    it(`round-trips byte-identical and is a fixed point: ${JSON.stringify(src)}`, () => {
      expect(body(src)).toBe(src);
      expect(body(body(src))).toBe(src);
    });

    it(`survives the anchored pipeline (assignUuids + serializeToLatex): ${JSON.stringify(src)}`, () => {
      const doc = parseLatex(src);
      assignUuids(doc);
      const once = serializeBodyOnly(doc);
      expect(once.replace(/ ?%!v:[^\n]*/g, "").trim()).toBe(src);
      const again = parseLatex(once);
      expect(serializeBodyOnly(again)).toBe(once);
    });
  }

  it("blank-line-separated display math still round-trips as before (no join attrs)", () => {
    const src = "Lead in.\n\n\\[\nx^2\n\\]\n\nNext.";
    expect(body(src)).toBe(src);
    const dm = parseLatex(src).content?.find((n) => n.type === "displayMath");
    expect(dm?.attrs).toEqual({ latex: "x^2" });
  });

  it("the in-paragraph display stays a BLOCK (editor UX unchanged) carrying its adjacency", () => {
    const doc = parseLatex("Lead in.\n\\[x^2\\]\nwhere x is real.");
    expect(doc.content?.map((n) => n.type)).toEqual(["paragraph", "displayMath", "paragraph"]);
    expect(doc.content?.[1].attrs).toEqual({
      latex: "x^2",
      padOpen: "",
      padClose: "",
      joinPrev: true,
      joinNext: true,
    });
  });

  it("the nested formula is ONE inline atom whose payload holds the inner `$`", () => {
    const [atom] = findMath(parseLatex("Let $\\text{for all $x_i$}$ hold."));
    expect(atom.attrs?.latex).toBe("\\text{for all $x_i$}");
    expect(matchInlineMathAt("$\\text{a $b$}$", 0)?.end).toBe(14);
  });

  it("the nested formula round-trips through the footnote/card fork", () => {
    const src = "Let $\\text{for all $x_i$}$ hold.";
    expect(richJsonToLatex(richLatexToJson(src))).toBe(src);
  });

  it("unbalanced braces fall back to the flat closer (malformed input reads as before)", () => {
    expect(matchInlineMathAt("$a{b$ c", 0)).toEqual({ latex: "a{b", delim: "$", end: 5 });
  });

  it("a one-line pad is refused where the payload ends in a comment (the `\\]` stays live)", () => {
    expect(emitDisplayMath({ latex: "x % note", padOpen: "", padClose: "" })).toBe(
      "\\[x % note\n\\]",
    );
    expect(emitDisplayMath({ latex: "x \\% y", padClose: "" })).toBe("\\[\nx \\% y\\]");
  });

  it("an edited-away neighbour leaves no sentinel in the file", () => {
    const doc = parseLatex("Lead in.\n\\[x^2\\]\nwhere x is real.");
    doc.content = [doc.content![1]];
    expect(serializeBodyOnly(doc)).toBe("\\[x^2\\]");
    expect(serializeBodyOnly(doc)).not.toMatch(/\u0000/);
  });
});
