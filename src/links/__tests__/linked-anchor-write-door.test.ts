// @vitest-environment jsdom
//
// Task 933 — every `linkedAnchor` write goes through ONE door
// (`writeLinkedAnchorMark`) that builds the mark step on a transaction over an
// explicit range and never touches the user's selection.
//
// The writers used to stamp/strip through the selection
// (`.setTextSelection(range).setMark|unsetMark(…).setTextSelection(range.from)`),
// so the load re-stamp, `reanchorByText`, the orphan reaper and the morph
// restamp each left the caret at the start of the anchored text. And the
// reaper's strip was on the undo stack: Cmd+Z brought the mark back with no
// card behind it, and nothing re-ran to catch it.
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  createLinkedAnchor,
  reanchorByText,
  removeLinkedAnchor,
  restampLinkedAnchorForKind,
  updateLinkedAnchorCard,
} from "@/links/links";
import { applyLinkedAnchorsImpl } from "@/links/_shared/apply-linked-anchors";

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

const ANCHOR = "a-933";

/** Paragraph 1 carries the anchor (parsed as the loader does: `kind:"note"`,
 *  no tint); paragraph 2 is where the user's caret sits. */
function mount(withMark = true): Editor {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p001" },
        content: [
          { type: "text", text: "before " },
          {
            type: "text",
            text: "the span",
            ...(withMark
              ? {
                  marks: [
                    {
                      type: "linkedAnchor",
                      attrs: {
                        anchorId: ANCHOR,
                        kind: "note",
                        linkId: ANCHOR,
                        linkKind: "anchor",
                        linkCard: "",
                        tintColor: null,
                      },
                    },
                  ],
                }
              : {}),
          },
          { type: "text", text: " after" },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: "p002" },
        content: [{ type: "text", text: "the user is typing here" }],
      },
    ],
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: doc,
  });
  // Put the caret deep in paragraph 2.
  const caret = editor.state.doc.content.size - 5;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)),
  );
  return editor;
}

function markFor(editor: Editor, anchorId: string): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (attrs || !node.isText) return !attrs;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId) {
        attrs = m.attrs as Record<string, unknown>;
      }
    }
    return true;
  });
  return attrs;
}

function selectionOf(editor: Editor) {
  return { from: editor.state.selection.from, to: editor.state.selection.to };
}

describe("linkedAnchor write door — no writer moves the caret (task 933)", () => {
  it("load re-stamp re-kinds a todo anchor and leaves the restored caret alone", () => {
    const editor = mount();
    const before = selectionOf(editor);
    applyLinkedAnchorsImpl(editor, [
      { anchorId: ANCHOR, kind: "todo", text: "the span", paragraphId: "p001" },
    ]);
    expect(markFor(editor, ANCHOR)?.kind).toBe("todo");
    expect(selectionOf(editor)).toEqual(before);
    editor.destroy();
  });

  it("reanchorByText (absent mark) stamps without moving the caret", () => {
    const editor = mount(false);
    const before = selectionOf(editor);
    const rec = reanchorByText(editor, "highlight", "the span", ANCHOR, undefined, null, "p001");
    expect(rec).not.toBeNull();
    expect(markFor(editor, ANCHOR)?.kind).toBe("highlight");
    expect(selectionOf(editor)).toEqual(before);
    editor.destroy();
  });

  it("morph restamp and linkCard update leave the caret alone", () => {
    const editor = mount();
    const before = selectionOf(editor);
    restampLinkedAnchorForKind(editor, ANCHOR, "highlight", "c1");
    expect(markFor(editor, ANCHOR)?.kind).toBe("highlight");
    updateLinkedAnchorCard(editor, ANCHOR, "highlight", "c1");
    expect(markFor(editor, ANCHOR)?.linkCard).toBe("highlight:c1");
    expect(selectionOf(editor)).toEqual(before);
    editor.destroy();
  });

  it("a re-stamp preserves attrs the caller did not name (setMark merge parity)", () => {
    const editor = mount(false);
    reanchorByText(editor, "revision", "the span", ANCHOR, "c1", null, "p001", {
      pendingDelete: true,
    });
    expect(markFor(editor, ANCHOR)?.pendingDelete).toBe(true);
    updateLinkedAnchorCard(editor, ANCHOR, "revision-suggestion", "c1");
    expect(markFor(editor, ANCHOR)?.pendingDelete).toBe(true);
    editor.destroy();
  });

  it("the reaper's strip leaves the caret alone and is NOT undoable", () => {
    const editor = mount();
    const before = selectionOf(editor);
    removeLinkedAnchor(editor, ANCHOR);
    expect(markFor(editor, ANCHOR)).toBeNull();
    expect(selectionOf(editor)).toEqual(before);
    editor.commands.undo();
    expect(markFor(editor, ANCHOR)).toBeNull();
    editor.destroy();
  });

  it("create over a NAMED range does not move the caret; over the selection it collapses as before", () => {
    const editor = mount(false);
    const before = selectionOf(editor);
    const rec = createLinkedAnchor(editor, "note", { from: 8, to: 16 }, "c1");
    expect(rec).not.toBeNull();
    expect(selectionOf(editor)).toEqual(before);

    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 6)),
    );
    const rec2 = createLinkedAnchor(editor, "todo", undefined, "c2");
    expect(rec2).not.toBeNull();
    expect(selectionOf(editor)).toEqual({ from: 2, to: 2 });
    // A user gesture stays on the undo stack.
    editor.commands.undo();
    expect(markFor(editor, rec2!.anchorId)).toBeNull();
    editor.destroy();
  });
});

describe("census: src/links writes linkedAnchor only through the door", () => {
  it("no code in src/links/** moves the selection with setTextSelection", () => {
    const root = join(process.cwd(), "src/links");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__") walk(p);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        readFileSync(p, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const t = line.trim();
            if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return;
            if (/setTextSelection\s*\(|\b(set|unset)Mark\(\s*["']linkedAnchor/.test(t)) {
              offenders.push(`${relative(process.cwd(), p)}:${i + 1}: ${t}`);
            }
          });
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
