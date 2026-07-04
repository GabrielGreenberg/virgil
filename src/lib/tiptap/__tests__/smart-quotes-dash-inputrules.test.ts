// @vitest-environment jsdom
//
// Task 2026-07-03-005 — typing `--` / `---` converts to en/em dash glyphs at
// type time, EXCEPT inside code / verbatim contexts, and the glyphs serialize
// back to `--` / `---` so the `.tex` round-trips byte-for-byte.
//
// Input rules are exercised the way ProseMirror actually processes typed text:
// each character is fed through the `handleTextInput` prop (which the TipTap
// `inputRulesPlugin` registers), falling back to a plain insert when no rule
// fires. That faithfully reproduces the incremental `-`,`-`,`-` sequence — the
// crux of the em-dash case, since `--` becomes `–` before the third hyphen is
// ever typed.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import { SmartQuotes } from "../smart-quotes";
import { serializeBodyOnly } from "@/lib/latex-serializer";

const EN_DASH = "–";
const EM_DASH = "—";

function makeEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, Code, CodeBlock, SmartQuotes],
    content: "<p></p>",
  });
}

/** Type one character the way the browser feeds it to ProseMirror. */
function typeChar(editor: Editor, ch: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", (f) =>
    f(editor.view, from, to, ch, () =>
      editor.state.tr.insertText(ch, from, to),
    ),
  );
  if (!handled) {
    editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

/** Type a whole string one character at a time. */
function typeText(editor: Editor, text: string) {
  for (const ch of text) typeChar(editor, ch);
}

describe("SmartQuotes dash input rules", () => {
  let editor: Editor;
  beforeEach(() => {
    editor = makeEditor();
  });
  afterEach(() => {
    editor.destroy();
  });

  it("converts `--` to an en dash in prose", () => {
    typeText(editor, "a--b");
    expect(editor.getText()).toBe(`a${EN_DASH}b`);
  });

  it("converts `---` to an em dash in prose (incremental third hyphen)", () => {
    typeText(editor, "a---b");
    expect(editor.getText()).toBe(`a${EM_DASH}b`);
  });

  it("leaves a lone hyphen alone", () => {
    typeText(editor, "well-known");
    expect(editor.getText()).toBe("well-known");
  });

  it("does not convert inside an inline code mark", () => {
    // Seed a code-marked run and drop the cursor inside it, then type.
    editor.commands.setContent("<p><code>ab</code></p>");
    // Position 2 sits between `a` and `b`, inside the code mark.
    editor.commands.setTextSelection(2);
    typeText(editor, "--");
    expect(editor.getText()).toBe("a--b");
  });

  it("does not convert inside a code block", () => {
    editor.commands.setContent("<pre><code>ab</code></pre>");
    editor.commands.setTextSelection(2);
    typeText(editor, "--");
    expect(editor.getText()).toBe("a--b");
  });

  it("glyphs round-trip back to `--` / `---` on serialize", () => {
    // A prose paragraph carrying both glyphs serializes to literal LaTeX
    // hyphens — byte-for-byte the source you'd have typed.
    const tex = serializeBodyOnly({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `foo ${EN_DASH} bar ${EM_DASH} baz` }],
        },
      ],
    });
    expect(tex).toContain("foo -- bar --- baz");
    expect(tex).not.toContain(EN_DASH);
    expect(tex).not.toContain(EM_DASH);
  });
});
