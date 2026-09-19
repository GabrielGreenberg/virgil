// @vitest-environment jsdom
//
// Task 605 — a block's identity follows its CONTENT, not document order.
//
// When one edit leaves two blocks holding the same uuid, `BlockUuidBackfill`
// keeps one and re-mints the other. "Keep the first in document order" is the
// wrong successor whenever the first holder is a blank line the edit just
// made and the text sits in the second:
//
//   1. Enter at the START of a paragraph. `splitBlock` copies the attrs onto
//      the after-half — the one holding the text — so the text was re-minted
//      and the new blank line above kept the id (and every card on it).
//   2. Undo after `MarginaliaAnchorGuard` resurrected a deleted anchored
//      paragraph. The empty stand-in sat outside history, so Undo restored the
//      original NEXT TO it and the net re-minted the restored text.
//
// Both drive the REAL `buildEditorExtensions("main")` stack.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { readDocStructure } from "@/lib/tiptap/doc-structure";

function mount(content: JSONContent[], anchored: string[] = []): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set(anchored) },
    host: null,
  };
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: { type: "doc", content },
  });
}

function para(text: string, uuid: string): JSONContent {
  return {
    type: "paragraph",
    attrs: uuid ? { uuid } : {},
    content: text ? [{ type: "text", text }] : undefined,
  };
}

/** Top-level `[text, uuid]` pairs. */
function blocks(editor: Editor): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = [];
  editor.state.doc.forEach((n) => {
    out.push([n.textContent, (n.attrs.uuid as string | null) ?? null]);
  });
  return out;
}

function posOf(editor: Editor, uuid: string): number {
  let found = -1;
  editor.state.doc.forEach((n, offset) => {
    if (found < 0 && n.attrs.uuid === uuid) found = offset;
  });
  return found;
}

function destroy(editor: Editor): void {
  const el = editor.options.element as HTMLElement | undefined;
  editor.destroy();
  el?.remove();
}

describe("block identity follows content (task 605)", () => {
  it("Member 1 — Enter at the start of a paragraph keeps its id on the TEXT", () => {
    const editor = mount([para("helloworld", "p0001"), para("second", "p0002")]);
    editor.chain().setTextSelection(1).splitBlock().run();

    const b = blocks(editor);
    expect(b.length).toBe(3);
    expect(b[0][0]).toBe("");
    expect(b[0][1]).not.toBe("p0001");
    expect(b[0][1]).toBeTruthy();
    expect(b[1]).toEqual(["helloworld", "p0001"]);
    expect(b[2]).toEqual(["second", "p0002"]);

    // The structure index agrees on every live id.
    const known = readDocStructure(editor.state).blocks;
    for (const [, u] of b) expect(known.has(u as string)).toBe(true);
    destroy(editor);
  });

  it("Member 1 — Undo of that Enter gives back the original paragraph and id", () => {
    const editor = mount([para("helloworld", "p0001"), para("second", "p0002")]);
    editor.chain().setTextSelection(1).splitBlock().run();
    editor.commands.undo();
    expect(blocks(editor)).toEqual([
      ["helloworld", "p0001"],
      ["second", "p0002"],
    ]);
    // …and Redo repeats the split with the id still on the text.
    editor.commands.redo();
    const b = blocks(editor);
    expect(b.length).toBe(3);
    expect(b[0][0]).toBe("");
    expect(b[0][1]).not.toBe("p0001");
    expect(b[1]).toEqual(["helloworld", "p0001"]);
    destroy(editor);
  });

  it("Member 1 sweep — Enter at the start of a list item keeps its id on the TEXT", () => {
    const editor = mount([
      {
        type: "bulletList",
        attrs: { uuid: "list01" },
        content: [
          { type: "listItem", attrs: { uuid: "item01" }, content: [para("first", "")] },
          { type: "listItem", attrs: { uuid: "item02" }, content: [para("second", "")] },
        ],
      },
    ]);
    // doc(0) bulletList(1) listItem(2) paragraph(3) → text starts at 3.
    const itemStart = 1;
    const textStart = itemStart + 2;
    editor.chain().setTextSelection(textStart).splitListItem("listItem").run();

    const items: Array<[string, string | null]> = [];
    editor.state.doc.firstChild!.forEach((n) => {
      items.push([n.textContent, (n.attrs.uuid as string | null) ?? null]);
    });
    expect(items.length).toBe(3);
    expect(items[0][0]).toBe("");
    expect(items[0][1]).not.toBe("item01");
    expect(items[1]).toEqual(["first", "item01"]);
    expect(items[2]).toEqual(["second", "item02"]);
    destroy(editor);
  });

  it("CONTROL — a mid-paragraph split still keeps the id on the head", () => {
    const editor = mount([para("helloworld", "p0001")]);
    editor.chain().setTextSelection(6).splitBlock().run();
    const b = blocks(editor);
    expect(b[0]).toEqual(["hello", "p0001"]);
    expect(b[1][0]).toBe("world");
    expect(b[1][1]).not.toBe("p0001");
    destroy(editor);
  });

  it("CONTROL — Enter at the start of an EMPTY anchored line keeps the id where it was", () => {
    const editor = mount([para("head.", "head01"), para("", "empt01"), para("tail.", "tail01")], [
      "empt01",
    ]);
    editor.chain().setTextSelection(posOf(editor, "empt01") + 1).splitBlock().run();
    const b = blocks(editor);
    expect(b.filter(([, u]) => u === "empt01").length).toBe(1);
    expect(b[1]).toEqual(["", "empt01"]);
    destroy(editor);
  });

  it("Member 2 — delete an anchored paragraph, guard stands in, Undo restores exactly", () => {
    const original: JSONContent[] = [
      para("head.", "head01"),
      para("anchored text", "tgt001"),
      para("tail.", "tail01"),
    ];
    const editor = mount(original, ["tgt001"]);
    const pos = posOf(editor, "tgt001");
    const size = editor.state.doc.nodeAt(pos)!.nodeSize;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + size));

    // The guard's legitimate job still happens: an empty stand-in holds the id.
    expect(blocks(editor)).toEqual([
      ["head.", "head01"],
      ["", "tgt001"],
      ["tail.", "tail01"],
    ]);

    editor.commands.undo();
    expect(blocks(editor)).toEqual([
      ["head.", "head01"],
      ["anchored text", "tgt001"],
      ["tail.", "tail01"],
    ]);

    // Redo re-deletes and the stand-in comes back with it — still one holder.
    editor.commands.redo();
    expect(blocks(editor)).toEqual([
      ["head.", "head01"],
      ["", "tgt001"],
      ["tail.", "tail01"],
    ]);
    destroy(editor);
  });
});
