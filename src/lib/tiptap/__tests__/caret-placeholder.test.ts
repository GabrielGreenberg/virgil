// @vitest-environment jsdom
/**
 * Task 1127 — `CaretPlaceholder` emits the stock Placeholder's decorations
 * (main-editor options: showOnlyCurrent, no children) without walking the doc.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { CaretPlaceholder } from "@/lib/tiptap/caret-placeholder";

let editor: Editor;
afterEach(() => editor?.destroy());

function mount(content: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, CaretPlaceholder.configure({ placeholder: "Start writing..." })],
    content,
  });
}

const paras = () => Array.from(editor.view.dom.querySelectorAll("p"));

describe("CaretPlaceholder", () => {
  it("an empty editor marks its paragraph is-editor-empty with the text", () => {
    editor = mount("<p></p>");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const [p] = paras();
    expect(p.classList.contains("is-editor-empty")).toBe(true);
    expect(p.classList.contains("is-empty")).toBe(true);
    expect(p.getAttribute("data-placeholder")).toBe("Start writing...");
  });

  it("the caret's empty paragraph in a non-empty doc is is-empty only", () => {
    editor = mount("<p>one</p><p></p><p>three</p>");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    const [a, b, c] = paras();
    expect(b.classList.contains("is-empty")).toBe(true);
    expect(b.classList.contains("is-editor-empty")).toBe(false);
    expect(a.classList.contains("is-empty")).toBe(false);
    expect(c.classList.contains("is-empty")).toBe(false);
  });

  it("no decoration when the caret is in a non-empty paragraph", () => {
    editor = mount("<p>one</p><p></p>");
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    expect(paras().some((p) => p.classList.contains("is-empty"))).toBe(false);
  });

  it("follows the caret into a newly-emptied paragraph", () => {
    editor = mount("<p>one</p><p>x</p>");
    editor.view.dispatch(editor.state.tr.delete(6, 7));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    expect(paras()[1].classList.contains("is-empty")).toBe(true);
  });
});
