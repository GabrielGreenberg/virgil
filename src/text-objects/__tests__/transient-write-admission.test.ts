// @vitest-environment jsdom
//
// Task 1375 — a transient-anchor write in the grab lifecycle is real only once
// it is ADMITTED.
//
// `readOnlyEnforcer` silently drops a doc-changing transaction while the main
// surface's `editableRef` is false (the Library Reader pins `view.editable`
// true so its grab handle still shows). The plain-grab hydrate dispatched its
// `addMark` through it and returned the fresh id unconditionally — a `missing`
// float in the Reader — and the close-time strip was dropped and forgotten, a
// cardless `\vlid…\vlidend` left in the .tex.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const TEXT = "The quick brown fox";

/** A MAIN surface whose `editableRef` the test controls — `{current:false}`
 *  with `view.editable` true is exactly the Library Reader's shape. */
function mount(editableRef: { current: boolean }): Editor {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p001" },
        content: [{ type: "text", text: TEXT }],
      },
    ],
  };
  return new Editor({ extensions: buildEditorExtensions(ctx), content: doc });
}

/** Doc position of the paragraph's character offset `i`. */
const at = (i: number) => 1 + i;

describe("hydrate: never an id for a mark that did not land (task 1375)", () => {
  it("Reader shape: a transient grab is admitted past the read-only surface", () => {
    const editor = mount({ current: false });
    const ref = hydrateSelectionToTextObject(editor.view, at(4), at(9), {
      transient: true,
    });
    expect(ref).not.toBeNull();
    expect(resolveTextRangeByAnchorId(editor, ref!.id)).toEqual({
      from: at(4),
      to: at(9),
    });
    editor.destroy();
  });

  it("Reader shape: a real (non-transient) anchor is filtered → null, no id", () => {
    const editor = mount({ current: false });
    const before = editor.state.doc;
    const ref = hydrateSelectionToTextObject(editor.view, at(4), at(9));
    expect(ref).toBeNull();
    expect(editor.state.doc).toBe(before);
    editor.destroy();
  });

  it("pen axis: a non-editable view writes nothing, transient or not", () => {
    const editor = mount({ current: true });
    editor.setEditable(false);
    const before = editor.state.doc;
    expect(
      hydrateSelectionToTextObject(editor.view, at(4), at(9), { transient: true }),
    ).toBeNull();
    expect(editor.state.doc).toBe(before);
    editor.destroy();
  });
});

describe("strip: a transient handle cannot survive read-only (task 1375)", () => {
  it("the close-time strip lands while the surface is read-only", () => {
    const editableRef = { current: true };
    const editor = mount(editableRef);
    const ref = hydrateSelectionToTextObject(editor.view, at(4), at(9), {
      transient: true,
    });
    expect(ref).not.toBeNull();
    // The pen passes / the surface goes read-only while the popout is open.
    editableRef.current = false;
    expect(removeTransientAnchor(editor, ref!.id)).toBe(true);
    expect(resolveTextRangeByAnchorId(editor, ref!.id)).toBeNull();
    editor.destroy();
  });
});

describe("gesture gate (task 1375)", () => {
  it("beginGesture re-asks the pen axis before any lift", () => {
    const src = readFileSync(
      join(__dirname, "..", "TextObjectGrabHandle.tsx"),
      "utf8",
    );
    const body = src.slice(src.indexOf("const beginGesture = useCallback("));
    const head = body.slice(0, body.indexOf("handleEl.classList.add"));
    expect(head).toMatch(/!editor\.isEditable\)\s*return;/);
  });
});
