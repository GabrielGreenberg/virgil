/**
 * Feature A2 — block-level LaTeX round-trip for a SINGLE `\ex` example body.
 *
 * A2 widens `exampleBlock` content to accept `graphicsBlock | displayMath`
 * directly (paragraph was already valid) so a dropped picture / equation joins
 * a single example's body. The schema widen is only half the feature: those new
 * direct children must survive the LaTeX round-trip (serialize → re-parse), the
 * real risk the plan flagged — exactly mirroring A1's `\a`-item-level locks, but
 * at the `exampleBlock` body level.
 *
 * Before A2 every shape below silently lost data on save→reload:
 *   • `serializeExampleBlock` had NO graphicsBlock / displayMath branch → a
 *     dropped picture / equation was dropped on save.
 *   • the single `\ex` parse path called `parseExampleBodyAsBlocks` WITHOUT
 *     `allowDisplayMath` → a serialized `\[…\]` was discarded on reload.
 *   • the block body joined pieces with a lone `"\n"` (a soft break) → two
 *     consecutive paragraphs re-merged into one on reload.
 *   • `readParagraph` did not break at `\includegraphics` → a picture after a
 *     paragraph was absorbed into the paragraph text (the picture-side twin of
 *     A1's `\[` break fix).
 *
 * These locks prove the single body survives for [para, math] / [para, picture]
 * / [para, para] / [para, math, para], with kind, count, order, latex, command
 * and uuid intact — while the contexts A2 does NOT widen (the `\pex` preamble)
 * stay byte-unchanged.
 */

import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/react";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findAll(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  function walk(n: JSONContent) {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  }
  walk(doc);
  return out;
}

const P = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const DM = (latex: string, uuid?: string): JSONContent => ({
  type: "displayMath",
  attrs: { latex, ...(uuid ? { uuid } : {}) },
});
const GFX = (command: string, uuid?: string): JSONContent => ({
  type: "graphicsBlock",
  attrs: { command, ...(uuid ? { uuid } : {}) },
});

/** A `\documentclass`-free doc holding ONE single `\ex` example whose body is
 *  `children` — the exact PM shape an A2 drop into a single example produces. */
function singleExampleDoc(children: JSONContent[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: {
          uuid: "exA2",
          kind: "single",
          tag: "",
          label: "",
          exnoOverride: null,
          suppressSpace: false,
          number: 0,
        },
        content: children,
      },
    ],
  };
}

/** Serialize → re-parse a single-example doc; return the reparsed exampleBlock. */
function roundTrip(children: JSONContent[]): JSONContent {
  const tex = serializeBody(singleExampleDoc(children));
  return findAll(parseBody(tex), "exampleBlock")[0];
}

describe("Feature A2 — single `\\ex` body block-level round-trip", () => {
  it("[paragraph, displayMath]: the equation survives in order with latex + uuid", () => {
    const block = roundTrip([P("Some text."), DM("x = 1", "ab12")]);
    expect(block.attrs?.kind).toBe("single");
    expect((block.content ?? []).map((c) => c.type)).toEqual([
      "paragraph",
      "displayMath",
    ]);
    expect((block.content ?? [])[0].content?.[0].text).toContain("Some text.");
    expect((block.content ?? [])[1].attrs?.latex).toBe("x = 1");
    expect((block.content ?? [])[1].attrs?.uuid).toBe("ab12");
  });

  it("[paragraph, graphicsBlock]: the picture survives (NOT absorbed into the paragraph)", () => {
    const cmd = "\\includegraphics[width=0.5\\textwidth]{figures/fig}";
    const block = roundTrip([P("A caption line."), GFX(cmd, "g123")]);
    expect((block.content ?? []).map((c) => c.type)).toEqual([
      "paragraph",
      "graphicsBlock",
    ]);
    expect((block.content ?? [])[0].content?.[0].text).toContain("A caption line.");
    expect((block.content ?? [])[1].attrs?.command).toContain("includegraphics");
  });

  it("[paragraph, paragraph]: stays TWO paragraphs (the blank-line separator)", () => {
    const block = roundTrip([P("First paragraph."), P("Second paragraph.")]);
    const paras = (block.content ?? []).filter((c) => c.type === "paragraph");
    expect(paras).toHaveLength(2);
    expect(paras[0].content?.[0].text).toContain("First paragraph.");
    expect(paras[1].content?.[0].text).toContain("Second paragraph.");
  });

  it("[paragraph, displayMath, paragraph]: order preserved across the round-trip", () => {
    const block = roundTrip([P("Before."), DM("y = 2", "cd34"), P("After.")]);
    expect((block.content ?? []).map((c) => c.type)).toEqual([
      "paragraph",
      "displayMath",
      "paragraph",
    ]);
    expect((block.content ?? [])[1].attrs?.latex).toBe("y = 2");
    expect((block.content ?? [])[0].content?.[0].text).toContain("Before.");
    expect((block.content ?? [])[2].content?.[0].text).toContain("After.");
  });

  it("preserves a body displayMath's uuid anchor across the round-trip", () => {
    const block = roundTrip([P("Lead."), DM("z = 0", "ef56")]);
    const math = findAll(block, "displayMath");
    expect(math).toHaveLength(1);
    expect(math[0].attrs?.uuid).toBe("ef56");
    expect(math[0].attrs?.latex).toBe("z = 0");
  });

  it("a lone displayMath body (no paragraph) survives as the only child", () => {
    const block = roundTrip([DM("p = q", "aa11")]);
    const kinds = (block.content ?? []).map((c) => c.type);
    expect(kinds).toEqual(["displayMath"]);
    expect((block.content ?? [])[0].attrs?.latex).toBe("p = q");
  });

  // ── Negatives — the contexts A2 does NOT widen stay un-widened ──────────────

  it("a \\pex preamble does NOT gain a displayMath (out of scope, un-widened)", () => {
    // The `\pex` preamble parses through `parseExampleBodyAsBlocks` WITHOUT the
    // allowDisplayMath flag (Non-goals §5) — a stray equation there is dropped,
    // exactly as before A2 (no schema-invalid block-level math child).
    const tex = `\\pex A preamble line. \\[\nq = 9\n\\]\n\\a An item.\n\\xe`;
    const block = findAll(parseBody(tex), "exampleBlock")[0];
    expect(block.attrs?.kind).toBe("multi");
    const directMath = (block.content ?? []).filter(
      (c) => c.type === "displayMath",
    );
    expect(directMath).toHaveLength(0);
  });

  it("a gloss-only single example round-trips with no spurious displayMath", () => {
    // ee03's shape: a single `\ex` whose only body is a `\begingl…\endgl` gloss.
    const tex = `\\ex\n\\begingl\n\\gla in principio erat verbum //\n\\glft \`\`In the beginning was the word.'' //\n\\endgl\n\\xe`;
    const reparsed = parseBody(serializeBody(parseBody(tex)));
    const block = findAll(reparsed, "exampleBlock")[0];
    expect(block.attrs?.kind).toBe("single");
    expect(findAll(block, "displayMath")).toHaveLength(0);
    expect(findAll(block, "exampleGloss")).toHaveLength(1);
  });
});

describe("Task 038 — aligned gloss cell brace-awareness", () => {
  const glossCells = (tex: string): JSONContent[] => {
    const row = findAll(parseBody(tex), "alignedGlossRow")[0];
    return (row?.content || []).filter((c) => c.type === "glossCell");
  };

  it("parses a braced command with an internal space as ONE cell", () => {
    // `\textbf{a b}` must stay one cell — the space is inside the command's
    // braces, at brace depth 1. The old brace-unaware else-branch split it
    // into three garbage cells (`\textbf{a`, `b}`, `foo`).
    const tex = `\\ex\n\\begingl\n\\gla \\textbf{a b} foo //\n\\endgl\n\\xe`;
    expect(glossCells(tex)).toHaveLength(2);
  });

  it("parses a braced \\textsc command with an internal space as ONE cell", () => {
    const tex = `\\ex\n\\begingl\n\\glb \\textsc{Foo Bar} x //\n\\endgl\n\\xe`;
    expect(glossCells(tex)).toHaveLength(2);
  });

  it("round-trips `\\textbf{a b}` as one cell with no redundant outer braces", () => {
    // Both members at once: the parser keeps `\textbf{a b}` intact (member 1)
    // and the serializer does NOT re-wrap it to `{\textbf{a b}}` (member 2),
    // because the only whitespace is inside the command's own braces.
    const tex = `\\ex\n\\begingl\n\\gla \\textbf{a b} foo //\n\\endgl\n\\xe`;
    const back = serializeBody(parseBody(tex));
    expect(back).toContain("\\gla \\textbf{a b} foo //");
    expect(back).not.toContain("{\\textbf{a b}}");
  });

  it("still braces a plain multi-word cell (top-level space) on round-trip", () => {
    // Regression guard: a genuine brace-depth-0 space (`{a b}` → cell text
    // `a b`) must be re-braced so expex doesn't split it into two columns.
    const tex = `\\ex\n\\begingl\n\\gla {a b} c //\n\\endgl\n\\xe`;
    const doc = parseBody(tex);
    expect(findAll(doc, "alignedGlossRow")[0].content!.filter(
      (c) => c.type === "glossCell",
    )).toHaveLength(2);
    expect(serializeBody(doc)).toContain("\\gla {a b} c //");
  });
});

describe("Task 262 — `\\begingl[opts]` optional argument round-trip", () => {
  it("captures the gloss-option bracket onto the exampleGloss node", () => {
    const tex = `\\ex\n\\begingl[aboveglftskip=2pt, glhangstyle=indent]\n\\gla foo bar //\n\\glft translation //\n\\endgl\n\\xe`;
    const gloss = findAll(parseBody(tex), "exampleGloss")[0];
    expect(gloss).toBeTruthy();
    expect(gloss.attrs?.glossOptions).toBe("aboveglftskip=2pt, glhangstyle=indent");
  });

  it("re-emits the `[opts]` bracket byte-for-byte on serialize (FAILS on main)", () => {
    const tex = `\\ex\n\\begingl[aboveglftskip=2pt, glhangstyle=indent]\n\\gla foo bar //\n\\glft translation //\n\\endgl\n\\xe`;
    const back = serializeBody(parseBody(tex));
    expect(back).toContain(
      "\\begingl[aboveglftskip=2pt, glhangstyle=indent]",
    );
    // The options-bearing form must be a fixed point across a second round-trip.
    const back2 = serializeBody(parseBody(back));
    expect(back2).toContain(
      "\\begingl[aboveglftskip=2pt, glhangstyle=indent]",
    );
  });

  it("a bare `\\begingl` (no opts) stays byte-identical — no spurious `[]`", () => {
    const tex = `\\ex\n\\begingl\n\\gla foo bar //\n\\glft translation //\n\\endgl\n\\xe`;
    const back = serializeBody(parseBody(tex));
    expect(back).toContain("\\begingl\n");
    expect(back).not.toContain("\\begingl[");
    const gloss = findAll(parseBody(tex), "exampleGloss")[0];
    expect(gloss.attrs?.glossOptions).toBeNull();
  });

  it("preserves a literal empty `\\begingl[]` bracket as a true fixed point", () => {
    const tex = `\\ex\n\\begingl[]\n\\gla foo bar //\n\\endgl\n\\xe`;
    const gloss = findAll(parseBody(tex), "exampleGloss")[0];
    expect(gloss.attrs?.glossOptions).toBe("");
    const back = serializeBody(parseBody(tex));
    expect(back).toContain("\\begingl[]");
  });
});
