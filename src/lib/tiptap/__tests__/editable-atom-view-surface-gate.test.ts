// @vitest-environment jsdom
//
// Locks the R2 gate on the shared editable-atom NodeView (latexComment, and any
// future editable atom): an atom-only float doc rests a NodeSelection on its
// lone atom, firing selectNode() at rest, so the float embed would otherwise
// paint `.selected` chrome (outline + tinted bg) the page never shows. The view
// suppresses that chrome on `surface: "float"` only — the MAIN surface keeps it.
// Same surface gate as math.ts (memo L3h.1, generalized to the selection
// chrome).
//
// Import-light: `editable-atom-view` pulls only `@tiptap/pm/state` (NodeSelection)
// — no `@/lib/storage` chain — so no storage mock is needed. Calls the exported
// factory directly and checks the returned view's selectNode/deselectNode, so
// the test does not depend on layout, RAF, or a clone harness.
import { describe, it, expect } from "vitest";
import { editableAtomView } from "@/lib/tiptap/editable-atom-view";

function makeCommentView(surface?: "main" | "float") {
  return editableAtomView({
    node: { attrs: { text: "hi" } },
    getPos: () => 0,
    editor: {},
    tag: "div",
    className: "latex-comment",
    attrName: "text",
    prefix: "% ",
    handleBar: true,
    surface,
  });
}

describe("editableAtomView selection chrome gated on the MAIN surface (R2)", () => {
  it("MAIN surface paints `.selected` on selectNode and clears on deselectNode", () => {
    const view = makeCommentView("main");
    view.selectNode();
    expect(view.dom.classList.contains("selected")).toBe(true);
    view.deselectNode();
    expect(view.dom.classList.contains("selected")).toBe(false);
  });

  it("FLOAT surface suppresses `.selected` on selectNode (the R2 gate)", () => {
    const view = makeCommentView("float");
    view.selectNode();
    expect(view.dom.classList.contains("selected")).toBe(false);
  });

  it("defaults to the MAIN chrome when surface is unspecified", () => {
    const view = makeCommentView();
    view.selectNode();
    expect(view.dom.classList.contains("selected")).toBe(true);
  });
});
