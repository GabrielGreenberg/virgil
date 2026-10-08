// @vitest-environment jsdom
//
// Task 1001 — a selection grab never removes or shrinks an existing
// `linkedAnchor`.
//
// `hydrateSelectionToTextObject` read coverage from `doc.resolve(from).marks()`;
// the mark is `inclusive: false`, so at an anchor's START boundary that reports
// the text BEFORE `from` and a note covering exactly the selection went unseen.
// It then `addMark`-ed a transient anchor, which (one anchor per character)
// REPLACED the note's mark — and closing the popout stripped the transient,
// leaving the note's card orphaned. Same damage for any partial overlap.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { removeTransientAnchor, resolveTextRangeByAnchorId } from "@/links/links";
import { hydrateSelectionToTextObject } from "../hydrate-selection";

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

const NOTE = "note-1001";
const TEXT = "The quick brown fox";

/** "quick brown" carries a real note anchor. */
function mount(): Editor {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p001" },
        content: [
          { type: "text", text: "The " },
          {
            type: "text",
            text: "quick brown",
            marks: [
              {
                type: "linkedAnchor",
                attrs: { anchorId: NOTE, kind: "note", linkCard: "note:n1" },
              },
            ],
          },
          { type: "text", text: " fox" },
        ],
      },
    ],
  };
  return new Editor({ extensions: buildEditorExtensions(mainCtx()), content: doc });
}

/** Doc position of character `i` of the paragraph's text. */
const at = (i: number) => 1 + i;
const QUICK = TEXT.indexOf("quick");
const BROWN_END = TEXT.indexOf(" fox");

function noteRange(editor: Editor) {
  return resolveTextRangeByAnchorId(editor, NOTE);
}

describe("selection grab over an existing anchor (task 1001)", () => {
  it("a selection exactly covering the note reuses its id and leaves the doc unchanged", () => {
    const editor = mount();
    const before = editor.state.doc;
    const ref = hydrateSelectionToTextObject(
      editor.view,
      at(QUICK),
      at(BROWN_END),
      { transient: true },
    );
    expect(ref).toEqual({ kind: "linkedRange", id: NOTE });
    expect(editor.state.doc).toBe(before);
    // Closing the popout must not strip the real note.
    removeTransientAnchor(editor, NOTE);
    expect(noteRange(editor)).toEqual({ from: at(QUICK), to: at(BROWN_END) });
    editor.destroy();
  });

  it("a selection strictly inside the note reuses its id", () => {
    const editor = mount();
    const ref = hydrateSelectionToTextObject(
      editor.view,
      at(QUICK + 1),
      at(BROWN_END - 1),
      { transient: true },
    );
    expect(ref).toEqual({ kind: "linkedRange", id: NOTE });
    editor.destroy();
  });

  it("a partial overlap is refused and the note keeps its full range", () => {
    const editor = mount();
    const before = editor.state.doc;
    // "The quick" — starts outside the note, ends inside it.
    const ref = hydrateSelectionToTextObject(
      editor.view,
      at(0),
      at(QUICK + 5),
      { transient: true },
    );
    expect(ref).toBeNull();
    expect(editor.state.doc).toBe(before);
    expect(noteRange(editor)).toEqual({ from: at(QUICK), to: at(BROWN_END) });
    editor.destroy();
  });

  it("a selection containing the whole note plus more is refused", () => {
    const editor = mount();
    const ref = hydrateSelectionToTextObject(
      editor.view,
      at(0),
      at(TEXT.length),
      { transient: true },
    );
    expect(ref).toBeNull();
    expect(noteRange(editor)).toEqual({ from: at(QUICK), to: at(BROWN_END) });
    editor.destroy();
  });

  it("positive control: a selection clear of every anchor mints a transient handle", () => {
    const editor = mount();
    const ref = hydrateSelectionToTextObject(
      editor.view,
      at(BROWN_END + 1),
      at(TEXT.length),
      { transient: true },
    );
    expect(ref?.kind).toBe("linkedRange");
    expect(ref?.id).not.toBe(NOTE);
    expect(resolveTextRangeByAnchorId(editor, ref!.id)).toEqual({
      from: at(BROWN_END + 1),
      to: at(TEXT.length),
    });
    removeTransientAnchor(editor, ref!.id);
    expect(resolveTextRangeByAnchorId(editor, ref!.id)).toBeNull();
    expect(noteRange(editor)).toEqual({ from: at(QUICK), to: at(BROWN_END) });
    editor.destroy();
  });
});
