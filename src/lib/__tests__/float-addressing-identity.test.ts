/**
 * Task 1565 — a float's own write may not erase the identity its next write
 * and its undo are addressed by. Drives the REAL float extension stack, with
 * the `boundRoot` each multi-block float declares, into a real main editor.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type JSONContent } from "@tiptap/core";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import {
  anyContent,
  leadingBlock,
  rootContentSelection,
  type BoundRootPredicate,
} from "@/lib/tiptap/bound-root";
import {
  landFloatWrite,
  planSectionWrite,
  SECTION_LOST_HEADING_REASON,
} from "@/lib/float-write-back";
import { getSectionRangeByUuid } from "@/lib/section-range";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import {
  LINKED_RANGE_EMPTIED_REASON,
  linkedRangeAsDoc,
  planLinkedRangeWriteBack,
} from "@/lib/linked-range-writeback";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function mount(content: JSONContent, boundRoot: BoundRootPredicate | null = null) {
  const ed = new Editor({
    element: document.createElement("div"),
    extensions: buildEditorExtensions({
      spellcheckPortRef: null,
      surface: "float",
      editable: true,
      cardContext: true,
      callbacks: {},
      boundRoot,
    }),
    content,
  });
  editors.push(ed);
  return ed;
}

const para = (text: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text, ...(marks ? { marks } : {}) }] : [],
});
const heading = (uuid: string, text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 1, uuid },
  content: [{ type: "text", text }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const anchor = (anchorId: string) => ({
  type: "linkedAnchor",
  attrs: { anchorId, kind: "note" },
});

describe("section float — the heading addresses it", () => {
  const section = () => [heading("h1", "Title"), para("body one"), para("body two")];
  const paper = () => doc(para("before"), ...section(), heading("h2", "Next"), para("after"));

  function write(main: Editor, float: Editor) {
    return landFloatWrite(main, "hd:h1", (ed) => {
      const range = getSectionRangeByUuid(ed.state.doc, "h1");
      if (!range) return null;
      return planSectionWrite(ed.state.schema, range, float.getJSON().content ?? []);
    });
  }

  it("select-all spans every block's text, not the doc", () => {
    const float = mount(doc(...section()), leadingBlock("heading"));
    float.commands.selectAll();
    expect(float.state.selection).toBeInstanceOf(TextSelection);
    expect(float.state.selection.from).toBe(1);
    expect(float.state.selection.to).toBe(float.state.doc.content.size - 1);
  });

  it("Cmd-A then type keeps the heading and its uuid in main", () => {
    const main = mount(paper());
    const float = mount(doc(...section()), leadingBlock("heading"));
    float.commands.selectAll();
    float.view.dispatch(float.state.tr.insertText("x"));
    expect(write(main, float).status).toBe("landed");
    const range = getSectionRangeByUuid(main.state.doc, "h1");
    expect(range?.nodes[0].textContent).toBe("x");
    expect(main.getText()).toContain("after");
    expect(main.getText()).toContain("before");
  });

  it("Cmd-A, Backspace, Backspace leaves an empty heading, never a paragraph", () => {
    const main = mount(paper());
    const float = mount(doc(...section()), leadingBlock("heading"));
    float.commands.selectAll();
    float.commands.keyboardShortcut("Backspace");
    expect(float.state.doc.firstChild?.type.name).toBe("heading");
    // TipTap's clearNodes route: Backspace at the start of an empty heading.
    float.commands.keyboardShortcut("Backspace");
    expect(float.state.doc.firstChild?.type.name).toBe("heading");
    write(main, float);
    expect(getSectionRangeByUuid(main.state.doc, "h1")).not.toBeNull();
  });

  it("the door refuses a write with no leading heading, main byte-identical", () => {
    const main = mount(paper());
    const float = mount(doc(para("x")));
    const before = main.state.doc;
    expect(write(main, float)).toEqual({
      status: "refused",
      reason: SECTION_LOST_HEADING_REASON,
    });
    expect(main.state.doc.eq(before)).toBe(true);
  });
});

describe("linked-range float — the anchor addresses it", () => {
  const A = "A";
  const paper = () =>
    mount(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "pre " },
          { type: "text", text: "held", marks: [anchor(A)] },
          { type: "text", text: " post" },
        ],
      }),
    );
  const rangeOf = (main: Editor) => findLinkedAnchorRange(main.state.doc, A)!;
  const seed = (main: Editor) => linkedRangeAsDoc(main.state.doc, rangeOf(main))!;

  function plan(main: Editor, float: JSONContent, schema = main.schema) {
    return planLinkedRangeWriteBack(main.state, rangeOf(main), float, schema, A);
  }

  it("select-all is re-expressed as a text selection", () => {
    const float = mount(seed(paper()), anyContent);
    float.commands.selectAll();
    expect(float.state.selection).not.toBeInstanceOf(AllSelection);
  });

  it("Cmd-A then type keeps the anchor and its attrs in main", () => {
    const main = paper();
    const float = mount(seed(main), anyContent);
    float.commands.selectAll();
    float.view.dispatch(float.state.tr.insertText("new"));
    const planned = plan(main, float.getJSON());
    expect(planned.ok && planned.tr).toBeTruthy();
    if (planned.ok) main.view.dispatch(planned.tr!);
    expect(main.getText()).toBe("pre new post");
    const r = rangeOf(main);
    expect(main.state.doc.textBetween(r.from, r.to)).toBe("new");
    const marks = main.state.doc.nodeAt(r.from)!.marks;
    expect(marks.find((m) => m.type.name === "linkedAnchor")?.attrs.kind).toBe("note");
  });

  it("Cmd-A then Backspace is refused with the reason, main untouched", () => {
    const main = paper();
    const float = mount(seed(main), anyContent);
    float.commands.selectAll();
    float.commands.keyboardShortcut("Backspace");
    expect(plan(main, float.getJSON())).toEqual({
      ok: false,
      editRefused: LINKED_RANGE_EMPTIED_REASON,
    });
  });

  it("retyping into the emptied float lands, anchored", () => {
    const main = paper();
    const planned = plan(main, doc(para("again")));
    if (planned.ok) main.view.dispatch(planned.tr!);
    const r = rangeOf(main);
    expect(main.state.doc.textBetween(r.from, r.to)).toBe("again");
  });

  it("an unmarked float equal to main is an echo, not a write", () => {
    const main = paper();
    expect(plan(main, doc(para("held")))).toEqual({ ok: true, tr: null });
  });

  it("does not stamp over another card's anchor", () => {
    const main = paper();
    expect(plan(main, doc(para("other", [anchor("B")])))).toEqual({
      ok: false,
      editRefused: LINKED_RANGE_EMPTIED_REASON,
    });
  });

  it("fails open on a range that held no anchor", () => {
    const main = mount(doc(para("plain text")));
    const planned = planLinkedRangeWriteBack(
      main.state,
      { from: 1, to: 6 },
      doc(para("")),
      main.schema,
      A,
    );
    expect(planned.ok).toBe(true);
  });
});

describe("rootContentSelection across shapes", () => {
  it("a sole leaf root stays a node selection", () => {
    const ed = mount(doc({ type: "horizontalRule" }));
    expect(rootContentSelection(ed.state.doc)).toBeInstanceOf(NodeSelection);
  });

  it("a leading leaf in a multi-block doc starts at the first text", () => {
    const ed = mount(doc({ type: "horizontalRule" }, para("text")));
    const sel = rootContentSelection(ed.state.doc)!;
    expect(sel).toBeInstanceOf(TextSelection);
    expect(ed.state.doc.textBetween(sel.from, sel.to)).toBe("text");
  });
});
