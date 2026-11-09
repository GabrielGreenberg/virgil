// @vitest-environment jsdom
//
// Task 1517 — `\footnote[n]{…}` does not step the counter, and every surface
// prints the SAME label for it.
//
// LaTeX prints `\footnote{a}\footnote[7]{b}\footnote{c}` as 1, 7, 2: the
// optional mark replaces the counter for that one footnote and does not
// advance it. Before this task Virgil's numberer stepped anyway (1, 2, 3), the
// atom and card badge printed the counter (1, 2, 3) and the tool gutter printed
// the override (1, 7, 3) — every footnote after an override one too high, and
// the overridden one reading differently on different surfaces.
//
// Legs: (a) the parser at load, (b) the live numberer + the atom's rendered
// text after an edit, (c) the downstream readers — the gutter rows and the
// Citations panel's nested "in footnote N" label — through `footnoteLabel`.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import { footnoteLabel, footnoteNumbersFor } from "@/lib/footnote-numbering";
import { footnoteRows } from "@/components/editor-layout/tool-gutter/gutter-rows";
import type { FootnoteInfo } from "@/components/Editor";

const TEX = `\\documentclass{article}
\\begin{document}
One\\footnote{a} two\\footnote[7]{b} three\\footnote{c}
\\end{document}`;

function jsonFootnotes(node: JSONContent): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "footnote") out.push(n.attrs ?? {});
    (n.content ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

function mount(content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: [StarterKit, Footnote, DocStructureObserver], content });
}

describe("the rule", () => {
  it("an override takes 0 and does not step the counter; the label is the mark", () => {
    expect(footnoteNumbersFor([{}, { numberOverride: "7" }, {}])).toEqual([1, 0, 2]);
    expect(footnoteNumbersFor([{ thanks: true }, { numberOverride: "*" }, {}])).toEqual([0, 0, 1]);
    // An empty mark is not an override (the record spelling treats "" as absent).
    expect(footnoteNumbersFor([{ numberOverride: "" }, {}])).toEqual([1, 2]);
    expect(footnoteNumbersFor([{ numberOverride: null }, {}])).toEqual([1, 2]);
  });

  it("one label door: A for thanks, the mark for an override, else the number", () => {
    expect(footnoteLabel({ thanks: true, number: 0 })).toBe("A");
    expect(footnoteLabel({ numberOverride: "7", number: 0 })).toBe("7");
    expect(footnoteLabel({ number: 3 })).toBe("3");
    expect(footnoteLabel({ number: 0 })).toBe("1"); // the not-yet-numbered fallback
    expect(footnoteLabel({ thanks: true, numberOverride: "7" })).toBe("A");
  });
});

describe("(a) load — the parser", () => {
  it("numbers 1, –, 2 and keeps the mark byte-for-byte", () => {
    const doc = parseLatex(TEX);
    const found = jsonFootnotes(doc);
    expect(found.map((a) => a.number)).toEqual([1, 0, 2]);
    expect(found.map((a) => footnoteLabel(a))).toEqual(["1", "7", "2"]);
    expect(serializeToLatex(doc)).toContain("\\footnote[7]{b}");
  });
});

describe("(b) live — the numberer and the atom's text", () => {
  it("an inserted footnote keeps the override out of the count", () => {
    const editor = mount(parseLatex(TEX));
    const text = () => {
      const out: string[] = [];
      editor.view.dom.querySelectorAll("[data-footnote-id]").forEach((el) => out.push(el.textContent ?? ""));
      return out;
    };
    expect(text()).toEqual(["1", "7", "2"]);

    // Insert a new footnote at the very end of the first paragraph.
    let end = 0;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "paragraph" && end === 0) end = pos + n.nodeSize - 1;
      return true;
    });
    editor.view.dispatch(
      editor.state.tr.insert(end, editor.schema.nodes.footnote.create({ footnoteId: "fresh", number: 0 })),
    );
    const numbers: unknown[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "footnote") numbers.push(n.attrs.number);
      return true;
    });
    expect(numbers).toEqual([1, 0, 2, 3]);
    expect(text()).toEqual(["1", "7", "2", "3"]);
    editor.destroy();
  });
});

describe("(c) readers — gutter and nested label", () => {
  it("the gutter prints the same labels, in document order", () => {
    const fns = [
      { footnoteId: "c", number: 2, pos: 30, content: { type: "doc", content: [] } },
      { footnoteId: "b", number: 0, pos: 20, content: { type: "doc", content: [] }, numberOverride: "7" },
      { footnoteId: "a", number: 1, pos: 10, content: { type: "doc", content: [] } },
      { footnoteId: "t", number: 0, pos: 5, content: { type: "doc", content: [] }, thanks: true },
    ] as unknown as FootnoteInfo[];
    expect(footnoteRows(fns).map((r) => r.marker)).toEqual(["A", "1", "7", "2"]);
  });
});
