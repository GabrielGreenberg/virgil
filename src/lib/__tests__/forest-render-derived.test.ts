/**
 * Task 384 — the render verdict is DERIVED, and the bytes never learn about it.
 *
 * The whole "render a subset, badge the rest" posture rests on one claim: a
 * refusal costs the user a picture and never a byte. That claim is cheap to
 * make and easy to break silently — a `renderable` attr cached on the node "so
 * the badge does not flicker", a sidecar note about which trees failed, a
 * normalization the parser performs on the way past. Any of those turns a VIEW
 * into a second model of the document, at which point a grammar change rewrites
 * the user's `.tex`.
 *
 * So every leg drives the REAL save pipeline over TWO cycles (cycle 1 is where a
 * loss lands, cycle 2 is where an oscillation shows) over sources the renderer
 * ACCEPTS and sources it REFUSES, and asserts the two are indistinguishable
 * downstream: same bytes, same attrs, same sidecar.
 */
import { describe, it, expect } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import {
  serializeBodyOnly,
  assignUuids,
  extractSidecarData,
} from "@/lib/latex-serializer";
import { parseForestSource } from "@/lib/forest/grammar";
import type { JSONContent } from "@tiptap/core";

function cycle(body: string): { body: string; doc: JSONContent } {
  const doc = parseLatex(`\\begin{document}\n\n${body}\n\n\\end{document}\n`);
  assignUuids(doc);
  return { body: serializeBodyOnly(doc), doc };
}

function findForest(node: JSONContent): JSONContent | null {
  if (node.type === "forestBlock") return node;
  for (const child of node.content ?? []) {
    const hit = findForest(child);
    if (hit) return hit;
  }
  return null;
}

const RENDERS = "\\begin{forest}\n[S [NP [Det [the]] [N [dog]]] [VP [V [barks]]]]\n\\end{forest}";
const REFUSES =
  "\\begin{forest}\nfor tree={s sep=2cm, l sep=1cm}\n[S [NP,plural] [VP]]\n\\end{forest}";
const REFUSES_HARDER =
  "\\begin{forest}\n\\forestset{default preamble={for tree={}}}\n[S [\\textsc{np}]]\n\\end{forest}";

const SHAPES: { name: string; body: string; renders: boolean }[] = [
  { name: "a tree the subset renders", body: RENDERS, renders: true },
  { name: "a tree with a global preamble", body: REFUSES, renders: false },
  { name: "a tree with a preamble AND a command label", body: REFUSES_HARDER, renders: false },
];

describe("the render verdict never reaches the document", () => {
  for (const shape of SHAPES) {
    it(`${shape.name}: the grammar agrees with the fixture`, () => {
      expect(parseForestSource(shape.body).ok).toBe(shape.renders);
    });

    it(`${shape.name}: survives two save cycles byte-for-byte`, () => {
      const one = cycle(shape.body);
      const two = cycle(one.body);
      expect(one.body).toContain(shape.body);
      expect(two.body).toBe(one.body);
    });

    it(`${shape.name}: the node carries SOURCE and nothing about the render`, () => {
      const forest = findForest(cycle(shape.body).doc);
      expect(forest).not.toBeNull();
      const attrs = forest!.attrs ?? {};
      expect(attrs.source).toBe(shape.body);
      // The attr set is a SUBSET of what `forest-block.ts` declares (the parser
      // materializes only the non-default ones) — so no `renderable`, no
      // `refusal`, no cached parse. Asserted as a closed set rather than as
      // "does not contain X": a future "just cache it on the node" must be a
      // failing test, not a name someone forgot to add to a denylist.
      const DECLARED = ["collapsed", "parTitle", "source", "uuid"];
      expect(Object.keys(attrs).filter((k) => !DECLARED.includes(k))).toEqual([]);
      expect(Object.keys(attrs)).toContain("uuid");
    });

    it(`${shape.name}: the sidecar learns nothing about it either`, () => {
      const doc = cycle(shape.body).doc;
      const forest = findForest(doc)!;
      const sidecar = extractSidecarData(doc);
      const entry = sidecar.paragraphs?.[forest.attrs!.uuid as string];
      // A block with no title and no fold state has no sidecar entry at all;
      // whatever it has, it must not mention the render.
      expect(JSON.stringify(entry ?? {})).not.toMatch(/render|refus|forest/i);
    });
  }

  it("a refused tree and a rendered one are indistinguishable to the serializer", () => {
    const a = cycle(RENDERS);
    const b = cycle(REFUSES);
    const fa = findForest(a.doc)!;
    const fb = findForest(b.doc)!;
    expect(Object.keys(fa.attrs!).sort()).toEqual(Object.keys(fb.attrs!).sort());
    expect(fa.type).toBe(fb.type);
  });

  it("editing a refused tree into a supported one changes nothing but `source`", () => {
    const before = findForest(cycle(REFUSES).doc)!;
    const after = findForest(cycle(RENDERS).doc)!;
    const diff = Object.keys({ ...before.attrs, ...after.attrs }).filter(
      (k) => k !== "uuid" && before.attrs![k] !== after.attrs![k],
    );
    expect(diff).toEqual(["source"]);
  });
});
