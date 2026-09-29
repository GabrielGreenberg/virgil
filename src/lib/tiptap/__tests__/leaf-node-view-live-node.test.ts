// @vitest-environment jsdom
//
// Task 840 — a leaf NodeView reads the node it IS, not the node it was MOUNTED
// with. The four inline atoms (math, `\ref`, footnote, citation) keep their
// view across an attr change (`update()` returns true), so a click handler
// closed over the mount-time node sent stale attrs; math "fixed" that with
// `Object.assign(node, updated)`, mutating the node the history's inverted
// step holds — so undo of a math edit restored the EDITED formula.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { InlineMath, DisplayMath } from "@/lib/tiptap/math";
import { LabelRef, REF_CLICK_EVENT } from "@/lib/tiptap/label";
import { Footnote } from "@/lib/tiptap/footnote";
import { Citation } from "@/lib/tiptap/citation";

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function mount(inline: Record<string, unknown>, block?: Record<string, unknown>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, InlineMath, DisplayMath, LabelRef, Footnote, Citation],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a " }, inline] },
        ...(block ? [block] : []),
      ],
    },
  });
  editors.push(editor);
  return editor;
}

/** Position + node of the first node of `typeName`. */
function find(editor: Editor, typeName: string): { pos: number; node: PMNode } {
  let hit: { pos: number; node: PMNode } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!hit && node.type.name === typeName) hit = { pos, node };
    return !hit;
  });
  if (!hit) throw new Error(`no ${typeName}`);
  return hit;
}

function setAttrs(editor: Editor, typeName: string, attrs: Record<string, unknown>) {
  const { pos, node } = find(editor, typeName);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

function domOf(editor: Editor, typeName: string): HTMLElement {
  return editor.view.nodeDOM(find(editor, typeName).pos) as HTMLElement;
}

function clickDetail(editor: Editor, typeName: string, event: string): Record<string, unknown> | null {
  let detail: Record<string, unknown> | null = null;
  const on = (e: Event) => {
    detail = (e as CustomEvent<Record<string, unknown>>).detail;
  };
  window.addEventListener(event, on);
  try {
    domOf(editor, typeName).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  } finally {
    window.removeEventListener(event, on);
  }
  return detail;
}

describe("task 840 — math undo restores the prior formula", () => {
  it("setNodeMarkup latex x→y, then undo → latex is x (and the view repaints it)", () => {
    const editor = mount({ type: "inlineMath", attrs: { latex: "x" } });
    const dom = domOf(editor, "inlineMath");
    setAttrs(editor, "inlineMath", { latex: "y" });
    expect(find(editor, "inlineMath").node.attrs.latex).toBe("y");
    // The view was KEPT (update() returned true) — the case the old
    // `Object.assign(node, …)` was dodging.
    expect(domOf(editor, "inlineMath")).toBe(dom);
    editor.commands.undo();
    expect(find(editor, "inlineMath").node.attrs.latex).toBe("x");
    expect(clickDetail(editor, "inlineMath", "virgil-math-click")?.latex).toBe("x");
  });

  it("the prior document snapshot is not rewritten by the edit", () => {
    const editor = mount({ type: "inlineMath", attrs: { latex: "x" } });
    const before = editor.state.doc;
    setAttrs(editor, "inlineMath", { latex: "y" });
    let latex: unknown = null;
    before.descendants((n) => {
      if (n.type.name === "inlineMath") latex = n.attrs.latex;
    });
    expect(latex).toBe("x");
  });
});

describe("task 840 — a click carries the LIVE node's attrs", () => {
  it("math: edited latex", () => {
    const editor = mount({ type: "inlineMath", attrs: { latex: "x" } });
    setAttrs(editor, "inlineMath", { latex: "y^2" });
    const d = clickDetail(editor, "inlineMath", "virgil-math-click")!;
    expect(d.latex).toBe("y^2");
    expect(d.pos).toBe(find(editor, "inlineMath").pos);
  });

  it("\\ref: a label renamed in place sends the NEW label / command / kind", () => {
    const editor = mount({
      type: "labelRef",
      attrs: { label: "sec:old", displayText: "1", refCommand: "ref", targetKind: null },
    });
    setAttrs(editor, "labelRef", { label: "sec:new", refCommand: "getref", targetKind: "heading" });
    const d = clickDetail(editor, "labelRef", REF_CLICK_EVENT)!;
    expect(d.label).toBe("sec:new");
    expect(d.refCommand).toBe("getref");
    expect(d.targetKind).toBe("heading");
  });

  it("footnote: an id re-minted in place opens ITS card", () => {
    const editor = mount({ type: "footnote", attrs: { footnoteId: "fn-old", number: 1 } });
    setAttrs(editor, "footnote", { footnoteId: "fn-new" });
    expect(clickDetail(editor, "footnote", "virgil-footnote-click")?.footnoteId).toBe("fn-new");
  });

  it("citation: an id re-minted in place opens ITS card", () => {
    const editor = mount({
      type: "citation",
      attrs: { citationId: "c-old", command: "\\cite{a}", displayText: "A 2000" },
    });
    setAttrs(editor, "citation", { citationId: "c-new" });
    const d = clickDetail(editor, "citation", "virgil-citation-click")!;
    expect(d.citationId).toBe("c-new");
    expect(d.clickedPos).toBe(find(editor, "citation").pos);
  });
});

describe("task 840 — an update with unchanged render inputs writes nothing", () => {
  it("math: a uuid-only change does not re-run KaTeX; a latex change does", () => {
    // displayMath carries a uuid, so an attr change that leaves the latex
    // alone genuinely reaches update() (an identical node never would).
    const editor = mount(
      { type: "text", text: "b" },
      { type: "displayMath", attrs: { latex: "x", uuid: "u1" } },
    );
    const dom = domOf(editor, "displayMath");
    const first = dom.firstChild;
    const spy = vi.spyOn(dom, "innerHTML", "set");
    setAttrs(editor, "displayMath", { uuid: "u2" });
    expect(domOf(editor, "displayMath")).toBe(dom);
    expect(spy).not.toHaveBeenCalled();
    expect(dom.firstChild).toBe(first);
    setAttrs(editor, "displayMath", { latex: "z" });
    expect(spy).toHaveBeenCalled();
  });

  it("citation: an id-only change does not rebuild the display children", () => {
    const editor = mount({
      type: "citation",
      attrs: { citationId: "c1", command: "\\cite{a}", displayText: "A 2000" },
    });
    const dom = domOf(editor, "citation");
    const spy = vi.spyOn(dom, "replaceChildren");
    setAttrs(editor, "citation", { citationId: "c2" });
    expect(spy).not.toHaveBeenCalled();
    expect(dom.getAttribute("data-citation-id")).toBe("c2");
    setAttrs(editor, "citation", { displayText: "B 2001" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
