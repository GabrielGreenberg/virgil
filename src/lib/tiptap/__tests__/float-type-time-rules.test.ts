// @vitest-environment jsdom
//
// Task 1288 — a popped-out paragraph types what the main pane types.
//
// A `surface: "float"` stack is not a card body: it is the popped-out
// TextObject (paragraph / list / example / caption / linked range …) and it
// writes the MAIN document's own prose back. The factory used to mount
// `SmartQuotes` + `Autocorrect` only under `isMain`, so the same paragraph typed
// `“word”` in the main pane and a straight `"word"` in its popout — and that
// straight `"` landed in the `.tex`, where LaTeX prints a closing quote on both
// sides. The census half (the float stack DECLARES both providers) is
// `input-rule-provider-census.test.ts`; this suite is the behavioural half.
//
// Typed one character at a time through the shipped `handleTextInput` prop
// (the `autocorrect-typing.test.ts` harness): `insertContent` fires no input
// rule, so every leg would pass vacuously on it.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeToLatex } from "@/lib/latex-serializer";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

function makePortRef(): SpellcheckPortRef {
  const port: SpellcheckPort = {
    enabled: () => false,
    autocorrect: () => true,
    version: () => 0,
    onInvalidate: () => () => {},
    isAccepted: () => false,
    knownSync: () => undefined,
    ensure: async () => {},
    suggest: async () => [],
    acceptInPaper: () => {},
    acceptGlobally: () => {},
  };
  return { current: port };
}

function floatCtx(editable: boolean): EditorExtensionsCtx {
  return {
    surface: "float",
    editableRef: { current: editable },
    cardContext: true,
    callbacks: {},
    docIdRef: { current: null },
    host: { getMainEditor: () => null },
    spellcheckPortRef: makePortRef(),
  } as unknown as EditorExtensionsCtx;
}

const live: Editor[] = [];
afterEach(() => {
  while (live.length) live.pop()?.destroy();
});

function mountFloat(editable = true): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable,
    extensions: buildEditorExtensions(floatCtx(editable)),
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [] }],
    },
  });
  live.push(ed);
  // Caret inside the (empty) paragraph.
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1)));
  return ed;
}

function typeText(ed: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp("handleTextInput", (f) =>
      f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
    );
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}

const para = (ed: Editor) => ed.state.doc.firstChild?.textContent ?? "";

describe("an editable float applies the main pane's type-time rules (task 1288)", () => {
  it('smart quotes: `"a"` becomes `“a”`, and the .tex gets LaTeX quotes', () => {
    const ed = mountFloat();
    typeText(ed, 'say "a"');
    expect(para(ed)).toBe("say “a”");
    expect(serializeToLatex(ed.getJSON() as JSONContent)).toContain("``a''");
  });

  it("autocorrect: `teh ` becomes `the `", () => {
    const ed = mountFloat();
    typeText(ed, "teh ");
    expect(para(ed)).toBe("the ");
  });

  it("dashes: `--` becomes `–`", () => {
    const ed = mountFloat();
    typeText(ed, "a--");
    expect(para(ed)).toBe("a–");
  });

  it("each rewrite is its own undo step there too (task 1098's door)", () => {
    const ed = mountFloat();
    typeText(ed, "teh ");
    ed.commands.undo();
    expect(para(ed)).toBe("teh ");
  });
});

describe("a read-only float stays inert", () => {
  it("its view is not editable, so the browser feeds it no text input to rewrite", () => {
    // Input rules run from ProseMirror's `handleTextInput`, which only text
    // input on an EDITABLE view reaches; a `contenteditable="false"` surface
    // (linked range, a no-pen float) receives none. Pin the precondition that
    // keeps the shared rules off a read-only float.
    const ed = mountFloat(false);
    expect(ed.view.editable).toBe(false);
    expect(ed.view.dom.getAttribute("contenteditable")).toBe("false");
    expect(para(ed)).toBe("");
  });
});
