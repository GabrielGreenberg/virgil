// Task 1008 — an error's highlight lives INSIDE its paragraph: the offending
// ref/cite ATOM, else the whole paragraph. Never a prose search across the doc
// (the retired version pinned "def" inside "defined" in an unrelated block).

import { describe, it, expect } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { resolveErrorHighlightRange } from "@/lib/error-highlight-range";
import type { DocStructure } from "@/lib/tiptap/doc-structure/types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", attrs: { uuid: { default: null } } },
    bulletList: { group: "block", content: "paragraph+", attrs: { uuid: { default: null } } },
    text: { group: "inline" },
    labelRef: { group: "inline", inline: true, atom: true, attrs: { label: { default: "" } } },
    citation: { group: "inline", inline: true, atom: true, attrs: { command: { default: "" } } },
  },
});

const p = (uuid: string, ...content: PMNode[]) => schema.node("paragraph", { uuid }, content);
const t = (s: string) => schema.text(s);
const ref = (label: string) => schema.node("labelRef", { label });
const cite = (command: string) => schema.node("citation", { command });

/** Range of the block with `uuid`, inner content bounds. */
function blockRange(doc: PMNode, uuid: string): { from: number; to: number } {
  let r: { from: number; to: number } | null = null;
  doc.descendants((n, pos) => {
    if (r) return false;
    if (n.attrs?.uuid === uuid) r = { from: pos + 1, to: pos + n.nodeSize - 1 };
    return true;
  });
  return r!;
}

describe("resolveErrorHighlightRange (task 1008)", () => {
  const doc = schema.node("doc", null, [
    p("aaaa", t("The term is defined here, see the introduction.")),
    p("bbbb", t("As shown in "), ref("def"), t(" and "), cite("\\citep[p.~3]{smith20,jones19}"), t(".")),
  ]);

  it("pins an undefined \\ref on the labelRef atom in ITS paragraph, never on prose elsewhere", () => {
    const r = resolveErrorHighlightRange(doc, null, "bbbb", "def")!;
    const p2 = blockRange(doc, "bbbb");
    expect(r.from).toBeGreaterThanOrEqual(p2.from);
    expect(r.to).toBeLessThanOrEqual(p2.to);
    expect(doc.nodeAt(r.from)?.type.name).toBe("labelRef");
    expect(r.to - r.from).toBe(1);
  });

  it("pins a missing cite key on the citation atom whose command lists it", () => {
    const r = resolveErrorHighlightRange(doc, null, "bbbb", "jones19")!;
    expect(doc.nodeAt(r.from)?.type.name).toBe("citation");
  });

  it("a key that is only a substring of a cite key does not match the atom", () => {
    const r = resolveErrorHighlightRange(doc, null, "bbbb", "smith")!;
    expect(r).toEqual(blockRange(doc, "bbbb"));
  });

  it("falls back to the whole paragraph when the atom is gone", () => {
    expect(resolveErrorHighlightRange(doc, null, "aaaa", "def")).toEqual(blockRange(doc, "aaaa"));
  });

  it("falls back to the whole paragraph when the error names no key", () => {
    expect(resolveErrorHighlightRange(doc, null, "bbbb", undefined)).toEqual(blockRange(doc, "bbbb"));
  });

  it("null when the paragraph is unknown or absent", () => {
    expect(resolveErrorHighlightRange(doc, null, undefined, "def")).toBeNull();
    expect(resolveErrorHighlightRange(doc, null, "zzzz", "def")).toBeNull();
  });

  it("resolves a NESTED paragraph (not in the top-level snapshot)", () => {
    const nested = schema.node("doc", null, [
      p("aaaa", t("defined")),
      schema.node("bulletList", { uuid: "list" }, [p("cccc", t("x "), ref("def"))]),
    ]);
    const r = resolveErrorHighlightRange(nested, null, "cccc", "def")!;
    expect(nested.nodeAt(r.from)?.type.name).toBe("labelRef");
  });

  it("uses the snapshot's uuid → pos, and survives a stale snapshot entry", () => {
    const bbbbPos = doc.child(0).nodeSize;
    const fresh = { blocks: new Map([["bbbb", { uuid: "bbbb", pos: bbbbPos, typeName: "paragraph", parTitled: false }]]) } as unknown as DocStructure;
    expect(doc.nodeAt(resolveErrorHighlightRange(doc, fresh, "bbbb", "def")!.from)?.type.name).toBe("labelRef");
    const stale = { blocks: new Map([["bbbb", { uuid: "bbbb", pos: 0, typeName: "paragraph", parTitled: false }]]) } as unknown as DocStructure;
    expect(doc.nodeAt(resolveErrorHighlightRange(doc, stale, "bbbb", "def")!.from)?.type.name).toBe("labelRef");
  });
});
