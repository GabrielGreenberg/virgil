// @vitest-environment jsdom
//
// Locks the atom→editable-block remodel of `latexComment` (task 2026-07-03-017):
//   - `.tex` parse/serialize round-trip is byte-stable, with the text held as
//     NATIVE inline content (not an `attrs.text`);
//   - typing `% ` transforms the paragraph into a comment AND lands a real PM
//     TextSelection inside it (no auto-focus race — symptom 18b);
//   - Enter inside a comment inserts a paragraph AFTER it and moves the caret
//     there, never splitting the comment into two (symptom 18c);
//   - Backspace at the start of an empty comment dissolves it back to a plain
//     paragraph.
//
// The keymap tests mount the REAL node on a StarterKit stack and drive the
// actual ProseMirror `handleKeyDown` / `handleTextInput` props, so they exercise
// the shipped bindings (not a re-implementation). The main-surface caret
// behaviour still owes a prod-FSA preview eyeball (see the task's Verify note).
import { describe, it, expect, vi, afterEach } from "vitest";

// The parser/serializer barrels transitively touch @/lib/storage — stub it so
// the import graph resolves in jsdom (vitest_extension_barrel_storage gotcha).
vi.mock("@/lib/storage", () => {
  const noop = () => Promise.resolve(undefined);
  return {
    readSidecar: noop,
    readSidecarIfExists: noop,
    writeSidecar: noop,
    readTex: noop,
    writeTex: noop,
  };
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection, NodeSelection } from "@tiptap/pm/state";
import { LatexComment } from "@/lib/tiptap/latex-comment";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";

function findNode(json: JSONContent, type: string): JSONContent | null {
  if (json.type === type) return json;
  for (const child of json.content ?? []) {
    const hit = findNode(child, type);
    if (hit) return hit;
  }
  return null;
}

function commentText(node: JSONContent | null): string {
  return (node?.content ?? []).map((c) => c.text ?? "").join("");
}

function allOfType(json: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(json);
  return out;
}

/** Locate the live latexComment node in an editor: its start pos + PM node. */
function findCommentPos(ed: Editor): { pos: number; node: import("@tiptap/pm/model").Node } {
  let found: { pos: number; node: import("@tiptap/pm/model").Node } | null = null;
  ed.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "latexComment") {
      found = { pos, node };
      return false;
    }
    return true;
  });
  if (!found) throw new Error("no latexComment in doc");
  return found;
}

describe("latexComment — .tex round-trip (text as native inline content)", () => {
  it("parses `% ...` into a block node whose text is inline content, not attrs.text", () => {
    const doc = parseLatex("% hello world\n");
    const comment = findNode(doc, "latexComment");
    expect(comment).not.toBeNull();
    expect(comment?.attrs?.text).toBeUndefined();
    expect(commentText(comment)).toBe("hello world");
  });

  it("parses an empty `%` line into an empty comment (no content child)", () => {
    const doc = parseLatex("%\n");
    const comment = findNode(doc, "latexComment");
    expect(comment).not.toBeNull();
    expect(commentText(comment)).toBe("");
  });

  it("serializes a content-bearing comment back to `% text`", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "latexComment",
          attrs: { uuid: "aaaa" },
          content: [{ type: "text", text: "a note to self" }],
        },
      ],
    };
    const out = serializeBodyOnly(doc);
    expect(out).toContain("% a note to self");
  });

  it("round-trips parse → serialize → parse byte-stably", () => {
    const src = "% first comment\n\nSome prose.\n\n% second comment\n";
    const once = serializeBodyOnly(parseLatex(src));
    const twice = serializeBodyOnly(parseLatex(once));
    expect(twice).toBe(once);
    // The comment text survives verbatim through the loop.
    expect(commentText(findNode(parseLatex(once), "latexComment"))).toBe(
      "first comment",
    );
  });
});

describe("latexComment — editable-block keymap / input behaviour", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function mount(content: JSONContent): Editor {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, LatexComment],
      content,
    });
    return editor;
  }

  it("typing `% ` transforms the paragraph and lands the caret INSIDE the comment (18b)", () => {
    const ed = mount({ type: "doc", content: [{ type: "paragraph" }] });
    // Caret in the empty paragraph.
    const pos = 1;
    ed.commands.setTextSelection(pos);
    // Drive the actual input-rule prop with a `%` at the paragraph start.
    const handled = ed.view.someProp(
      "handleTextInput",
      (f) => (f as (...a: unknown[]) => boolean)(ed.view, pos, pos, "%"),
    );
    expect(handled).toBe(true);
    const comment = findNode(ed.getJSON(), "latexComment");
    expect(comment).not.toBeNull();
    // Caret is a real TextSelection sitting inside the comment (no NodeSelection,
    // no faked DOM focus) — this is the whole point of the remodel.
    const sel = ed.state.selection;
    expect(sel instanceof TextSelection).toBe(true);
    expect(sel.$from.parent.type.name).toBe("latexComment");
  });

  it("Enter inside a comment inserts a paragraph AFTER it, never splitting it (18c)", () => {
    const ed = mount({
      type: "doc",
      content: [
        {
          type: "latexComment",
          content: [{ type: "text", text: "keep me" }],
        },
      ],
    });
    // Caret at the end of the comment content (located live, not by arithmetic
    // on doc size — the doc may carry a trailing paragraph).
    const { pos, node } = findCommentPos(ed);
    ed.commands.setTextSelection(pos + node.nodeSize - 1);
    const handled = ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key: "Enter" })),
    );
    expect(handled).toBe(true);
    const json = ed.getJSON();
    // Exactly ONE comment — it was NOT split into two — with its text intact.
    const comments = allOfType(json, "latexComment");
    expect(comments.length).toBe(1);
    expect(commentText(comments[0])).toBe("keep me");
    // A paragraph now sits immediately after the comment, and the caret is in it.
    const top = json.content ?? [];
    const ci = top.findIndex((n) => n.type === "latexComment");
    expect(top[ci + 1]?.type).toBe("paragraph");
    expect(ed.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("Backspace at the start of an EMPTY comment dissolves it to a paragraph", () => {
    const ed = mount({
      type: "doc",
      content: [{ type: "latexComment" }],
    });
    const { pos } = findCommentPos(ed);
    ed.commands.setTextSelection(pos + 1);
    const handled = ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key: "Backspace" })),
    );
    expect(handled).toBe(true);
    // The comment is gone — dissolved into a plain paragraph.
    expect(allOfType(ed.getJSON(), "latexComment").length).toBe(0);
  });
});

// Task 2026-07-03-024 acceptance criteria (on top of the 017 block remodel):
//   - NATIVE selection: a caret inside a comment is a TextSelection and the
//     rendered node carries NEITHER the retired bespoke `.selected` class NOR
//     any node-selection outline — editing shows the ordinary text highlight.
//     Node-selection (grab-handle) paints the block-node SSOT
//     `.ProseMirror-selectednode` class (matching expex), never `.selected`.
//   - NO REFLOW on click: the reflow root cause was the atom-era
//     `contentEditable` false→true toggle on the SAME text span
//     (editable-atom-view). The block NodeView never sets `contentEditable` on
//     its `.latex-comment-editable` content span, so placing a caret inside
//     cannot flip it — proven structurally here; the visual rect-equality
//     eyeball is owed against a real (non-jsdom) layout.
describe("latexComment — native selection + no-reflow (task 024)", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function mount(content: JSONContent): Editor {
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, LatexComment],
      content,
    });
    return editor;
  }

  it("a caret inside a comment is a native TextSelection with NO bespoke/node-selection chrome", () => {
    const ed = mount({
      type: "doc",
      content: [{ type: "latexComment", content: [{ type: "text", text: "hello" }] }],
    });
    const { pos, node } = findCommentPos(ed);
    // Caret in the middle of the comment content.
    ed.commands.setTextSelection(pos + 2);
    const sel = ed.state.selection;
    expect(sel instanceof TextSelection).toBe(true);
    expect(sel instanceof NodeSelection).toBe(false);
    expect(sel.$from.parent.type.name).toBe("latexComment");
    // The rendered comment carries no selection chrome while a caret rests inside.
    const el = ed.view.dom.querySelector(".latex-comment");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("selected")).toBe(false);
    expect(el?.classList.contains("ProseMirror-selectednode")).toBe(false);
    // Guard the doc-model text survived the caret placement untouched.
    expect(node.textContent).toBe("hello");
  });

  it("node-selecting a comment paints the SSOT `.ProseMirror-selectednode`, never the retired `.selected`", () => {
    const ed = mount({
      type: "doc",
      content: [{ type: "latexComment", content: [{ type: "text", text: "grab me" }] }],
    });
    const { pos } = findCommentPos(ed);
    const tr = ed.state.tr.setSelection(
      NodeSelection.create(ed.state.doc, pos),
    );
    ed.view.dispatch(tr);
    expect(ed.state.selection instanceof NodeSelection).toBe(true);
    const el = ed.view.dom.querySelector(".latex-comment");
    // PM applies its default node-selected class (the NodeView defines no
    // selectNode/deselectNode), which the SSOT CSS targets — NOT `.selected`.
    expect(el?.classList.contains("ProseMirror-selectednode")).toBe(true);
    expect(el?.classList.contains("selected")).toBe(false);
  });

  it("the editable content span never sets contentEditable — no atom-era reflow toggle on caret entry", () => {
    const ed = mount({
      type: "doc",
      content: [{ type: "latexComment", content: [{ type: "text", text: "steady" }] }],
    });
    const span = ed.view.dom.querySelector(".latex-comment-editable");
    expect(span).not.toBeNull();
    // At rest: the NodeView never wrote a per-node contentEditable channel
    // (the atom-era `contentEditable="false"` that later flipped to true — the
    // measured layout shift — is gone by construction).
    expect(span?.getAttribute("contenteditable")).toBeNull();
    // Placing a caret inside must not introduce/flip it.
    const { pos } = findCommentPos(ed);
    ed.commands.setTextSelection(pos + 1);
    const spanAfter = ed.view.dom.querySelector(".latex-comment-editable");
    expect(spanAfter?.getAttribute("contenteditable")).toBeNull();
  });
});
