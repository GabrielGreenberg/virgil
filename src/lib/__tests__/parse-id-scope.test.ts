// Task 1205 — a DECLARED id is authoritative over a freshly minted one.
//
// The defect: an unmarked `\cite` / `\footnote` / example parsed EARLIER in a
// file was minted with a bare `generateShortId()`, blind to the ids the file's
// own markers declare. When the draw landed on a later marker's id, the
// serializer's dedup kept the first occurrence in document order, so the
// declared id MOVED to the unmarked atom and every card/sidecar keyed by it
// re-attached there, silently.
//
// Each leg forces that exact draw: `Math.random` is stubbed ONCE (a constant
// stub would loop the collision-avoidance refill forever) so the first mint is
// `ab12` — the id a later marker declares.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseInlineContent, parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { richLatexToJson } from "@/lib/footnote-content";
import { VIRGIL_MARKERS, emitMarker } from "@/lib/latex-markers";
import { declaredIdsIn, mintParseId, withDeclaredIds } from "@/lib/parse-id-scope";

/** Makes the NEXT `generateShortId()` draw exactly `ab12`. */
function forceNextDraw() {
  vi.spyOn(Math, "random").mockImplementationOnce(() => 0xab12 / 0x10000);
}

afterEach(() => vi.restoreAllMocks());

function parseBody(input: string): JSONContent {
  return parseLatex(`\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`);
}

/** Every node of `type`, in document order, descending into atom bodies. */
function nodesOf(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
    const body = n.attrs?.content;
    if (Array.isArray(body)) (body as JSONContent[]).forEach(walk);
    else if (body && typeof body === "object") walk(body as JSONContent);
  };
  walk(doc);
  return out;
}

const vcid = (id: string) => emitMarker(VIRGIL_MARKERS.citation, id);
const vfid = (id: string) => emitMarker(VIRGIL_MARKERS.footnote, id);
const vexid = (id: string) => emitMarker(VIRGIL_MARKERS.exampleBlock, id);
const vxid = (id: string) => emitMarker(VIRGIL_MARKERS.exampleItem, id);

describe("declared ids win over fresh mints (task 1205)", () => {
  it("citation: the marked \\citet keeps its declared id; the unmarked one is minted around it", () => {
    forceNextDraw();
    const doc = parseBody(`First \\citet{alpha}.\n\nSecond ${vcid("ab12")}\\citet{beta}.`);
    const [alpha, beta] = nodesOf(doc, "citation");
    expect(beta.attrs?.citationId).toBe("ab12");
    expect(alpha.attrs?.citationId).not.toBe("ab12");
    const out = serializeBodyOnly(doc);
    expect(out).toContain(`${vcid("ab12")}\\citet{beta}`);
    expect(out).not.toContain(`${vcid("ab12")}\\citet{alpha}`);
  });

  it("footnote: same rule for \\vfid", () => {
    forceNextDraw();
    const doc = parseBody(`One\\footnote{A}.\n\nTwo${vfid("ab12")}\\footnote{B}.`);
    const [a, b] = nodesOf(doc, "footnote");
    expect(b.attrs?.footnoteId).toBe("ab12");
    expect(a.attrs?.footnoteId).not.toBe("ab12");
    expect(serializeBodyOnly(doc)).toContain(`${vfid("ab12")}\\footnote{B}`);
  });

  it("example block: same rule for \\vexid", () => {
    forceNextDraw();
    const doc = parseBody(`\\ex\nFirst.\n\\xe\n\n${vexid("ab12")}\\ex\nSecond.\n\\xe`);
    const [first, second] = nodesOf(doc, "exampleBlock");
    expect(second.attrs?.uuid).toBe("ab12");
    expect(first.attrs?.uuid).not.toBe("ab12");
  });

  it("example item: same rule for \\vxid", () => {
    const doc0 = `${vexid("aa11")}\\pex\n\\a First.\n${vxid("ab12")}\\a Second.\n\\xe`;
    forceNextDraw();
    const doc = parseBody(doc0);
    const [first, second] = nodesOf(doc, "exampleItem");
    expect(second.attrs?.uuid).toBe("ab12");
    expect(first.attrs?.uuid).not.toBe("ab12");
  });

  it("a citation inside a footnote body avoids an id declared ELSEWHERE in the file (nested scope)", () => {
    forceNextDraw();
    const doc = parseBody(
      `One${vfid("cc33")}\\footnote{See \\citet{alpha}.}.\n\nTwo ${vcid("ab12")}\\citet{beta}.`,
    );
    const ids = nodesOf(doc, "citation").map((c) => c.attrs?.citationId);
    expect(ids.filter((id) => id === "ab12")).toHaveLength(1);
    const beta = nodesOf(doc, "citation").find((c) => c.attrs?.citationId === "ab12");
    expect(beta).toBeDefined();
  });

  it("the standalone entry points open their own scope", () => {
    forceNextDraw();
    const inline = parseInlineContent(`\\citet{alpha} and ${vcid("ab12")}\\citet{beta}`);
    const [a, b] = inline.filter((n) => n.type === "citation");
    expect(b.attrs?.citationId).toBe("ab12");
    expect(a.attrs?.citationId).not.toBe("ab12");

    forceNextDraw();
    const body = richLatexToJson(`\\citet{alpha} and ${vcid("ab12")}\\citet{beta}`);
    const [c, d] = nodesOf(body, "citation");
    expect(d.attrs?.citationId).toBe("ab12");
    expect(c.attrs?.citationId).not.toBe("ab12");
  });
});

describe("parse-id-scope primitives", () => {
  it("declaredIdsIn reads every marker form", () => {
    const src = [
      vcid("a1a1"),
      vfid("b2b2"),
      vexid("c3c3"),
      vxid("d4d4"),
      emitMarker(VIRGIL_MARKERS.linkedRangeOpen, "e5e5"),
      emitMarker(VIRGIL_MARKERS.linkedRangeClose, "e5e5"),
      "Para. %!v:f6f6",
      "%!vtex:begin 0707",
    ].join("\n");
    expect([...declaredIdsIn(src)].sort()).toEqual(
      ["0707", "a1a1", "b2b2", "c3c3", "d4d4", "e5e5", "f6f6"].sort(),
    );
  });

  it("mintParseId never draws a reserved id inside a scope, and the scope closes", () => {
    forceNextDraw();
    const minted = withDeclaredIds(vcid("ab12"), () => mintParseId());
    expect(minted).not.toBe("ab12");
    forceNextDraw();
    expect(mintParseId()).toBe("ab12"); // outside any scope: nothing reserved
  });
});

// CENSUS — no parser module mints with a bare `generateShortId`: every
// parse-time mint goes through `mintParseId`, the one door that knows what
// the file declares.
describe("CENSUS: parse-time mints go through mintParseId", () => {
  const PARSER_MODULES = ["latex-parser.ts", "footnote-content.ts"];
  for (const file of PARSER_MODULES) {
    it(`${file} never calls generateShortId`, () => {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/\bgenerateShortId\s*\(/);
      expect(code).not.toMatch(/\bgenerateShortId\b/);
    });
  }
});
