// @vitest-environment jsdom
//
// Task 711: an Outline row for a titled texBlock / forestBlock jumped to the
// top of the paper. The jump handles guessed `offset + 1` as "inside the
// block" — for an atom leaf that is the gap AFTER it, whose domAtPos is the
// editor root. `landOnBlock` names the target by identity instead: the
// block's own DOM, and the selection its node admits.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { landOnBlock, selectionLandingOnBlock } from "@/lib/tiptap/block-landing";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(atomType: "texBlock" | "forestBlock"): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const source = atomType === "texBlock" ? "\\begin{tabular}{l}x\\end{tabular}" : "\\begin{forest}[a]\\end{forest}";
  editor = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
        { type: atomType, attrs: { source, uuid: "atom-1", title: "My block" } },
        { type: "paragraph", content: [{ type: "text", text: "After." }] },
      ],
    },
  });
  return editor;
}

function offsetOf(ed: Editor, index: number): number {
  let pos = -1;
  let i = 0;
  ed.state.doc.forEach((_n, off) => {
    if (i++ === index) pos = off;
  });
  return pos;
}

describe("landOnBlock (task 711)", () => {
  for (const atomType of ["texBlock", "forestBlock"] as const) {
    it(`${atomType}: scroll target is the block's own DOM, selection a NodeSelection on it`, () => {
      const ed = mount(atomType);
      const pos = offsetOf(ed, 1);
      expect(ed.state.doc.nodeAt(pos)?.type.name).toBe(atomType);
      const el = landOnBlock(ed.view, pos);
      expect(el).not.toBeNull();
      expect(el).not.toBe(ed.view.dom);
      expect(el).toBe(ed.view.nodeDOM(pos));
      const sel = ed.state.selection;
      expect(sel).toBeInstanceOf(NodeSelection);
      expect(sel.from).toBe(pos);
      expect((sel as NodeSelection).node.type.name).toBe(atomType);
    });
  }

  it("heading control: lands inside the heading text, scroll target unchanged (the heading line)", () => {
    const ed = mount("texBlock");
    const el = landOnBlock(ed.view, 0);
    expect(el).toBe(ed.view.domAtPos(1).node as HTMLElement);
    expect(el).not.toBe(ed.view.dom);
    const sel = ed.state.selection;
    expect(sel).toBeInstanceOf(TextSelection);
    expect(sel.from).toBe(1);
  });

  it("no block at the position → null, selection untouched", () => {
    const ed = mount("texBlock");
    const before = ed.state.selection;
    expect(selectionLandingOnBlock(ed.state.doc, ed.state.doc.content.size)).toBeNull();
    expect(landOnBlock(ed.view, ed.state.doc.content.size)).toBeNull();
    expect(ed.state.selection.eq(before)).toBe(true);
  });

  it("the Editor handle's jump doors route through landOnBlock (no `+1 to be inside` guess)", () => {
    const src = readFileSync(join(__dirname, "../../../components/Editor.tsx"), "utf8");
    const heading = src.slice(src.indexOf("scrollToHeading(blockIndex: number): void"), src.indexOf("restoreArchive(content"));
    const para = src.slice(src.indexOf("scrollToParagraphId(uuid: string): void"), src.indexOf("jumpToCard(card: CardWithLinks"));
    for (const body of [heading, para]) {
      expect(body).toContain("landOnBlock(editor.view");
      expect(body).not.toMatch(/\+ 1; \/\/ \+1 to be inside/);
      expect(body).not.toContain("setTextSelection(");
    }
  });
});
