// @vitest-environment jsdom
//
// Task 725 — the behavioural half: a paper with a `\thanks` author note
// numbers its real footnotes 1..N, at LOAD and after an edit.
//
// `\thanks` is reachable only by IMPORT (no UI creates one), but it is ordinary
// in real academic `.tex` — which is exactly the class of file Virgil opens.
// The acknowledgement renders `A`, never its own number, which is why a wrong
// number on IT was invisible; what the reader saw was every footnote AFTER it
// displaying one too high, because the thanks had silently eaten slot 1.
//
// Two legs, because the number the reader sees comes from two surfaces:
//
//  (a) LOAD. The editor is constructed with `content: initialContent` — not a
//      transaction — so the extension's `appendTransaction` numberer does NOT
//      run at mount. Whatever the parser wrote is what the reader sees, and the
//      parser's private counter was thanks-blind. This leg fails on HEAD.
//  (b) EDIT. Inserting another footnote must keep the sequence right, through
//      the live numberer, with no renumber transaction when nothing changed.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { parseLatex } from "@/lib/latex-parser";
import { writeFootnoteNumbers } from "@/lib/footnote-numbering";

const TEX = `\\documentclass{article}
\\title{A paper}
\\author{An author\\thanks{Thanks to the reading group.}}
\\begin{document}
One\\footnote{The first real footnote.} and two\\footnote{The second.} and
three\\footnote{The third.}
\\end{document}`;

/** Every footnote in the parsed JSON, document order. */
function jsonFootnotes(node: JSONContent): { thanks: boolean; number: unknown }[] {
  const out: { thanks: boolean; number: unknown }[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "footnote") out.push({ thanks: !!n.attrs?.thanks, number: n.attrs?.number });
    (n.content ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

function docFootnotes(editor: Editor): { thanks: boolean; number: unknown }[] {
  const out: { thanks: boolean; number: unknown }[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === "footnote") out.push({ thanks: !!n.attrs.thanks, number: n.attrs.number });
    return true;
  });
  return out;
}

function mount(content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: [StarterKit, Footnote, DocStructureObserver], content });
}

describe("(a) load-time numbering — the parser", () => {
  it("a `\\thanks` takes 0 and does not consume a footnote's number", () => {
    const found = jsonFootnotes(parseLatex(TEX));
    // The thanks is parsed from `\author{}`, so it comes first in doc order.
    expect(found.map((f) => f.thanks)).toEqual([true, false, false, false]);
    // BEFORE task 725 this read [1, 2, 3, 4]: the reader opened the paper and
    // saw the first real footnote marked "2".
    expect(found.map((f) => f.number)).toEqual([0, 1, 2, 3]);
  });
});

describe("(b) live numbering — the extension", () => {
  /** Three footnotes in one paragraph, the first a `\thanks`, all unnumbered. */
  function seedDoc(): JSONContent {
    const fn = (id: string, thanks = false) => ({
      type: "footnote",
      attrs: {
        footnoteId: id,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        number: 0,
        thanks,
      },
    });
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            fn("f-thanks", true),
            { type: "text", text: "b" },
            fn("f-one"),
            { type: "text", text: "c" },
            fn("f-two"),
          ],
        },
      ],
    };
  }

  it("numbers 1..N around a `\\thanks`, and keeps doing so after an insert", () => {
    const editor = mount(seedDoc());
    // A doc-changing transaction that adds a footnote runs the numberer.
    const type = editor.schema.nodes.footnote;
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(
      editor.state.tr.insert(
        end,
        type.create({
          footnoteId: "f-three",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          number: 0,
        }),
      ),
    );
    expect(docFootnotes(editor)).toEqual([
      { thanks: true, number: 0 },
      { thanks: false, number: 1 },
      { thanks: false, number: 2 },
      { thanks: false, number: 3 },
    ]);
    editor.destroy();
  });

  it("a renumber that changes nothing costs zero transaction steps", () => {
    const editor = mount(seedDoc());
    const type = editor.schema.nodes.footnote;
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(
      editor.state.tr.insert(
        end,
        type.create({
          footnoteId: "f-three",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          number: 0,
        }),
      ),
    );
    // Re-running the write over an already-correct document must be a no-op:
    // the equality bail is what lets the numberer return null instead of
    // dispatching N steps and fanning a full observer diff out over the app.
    const positions: number[] = [];
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "footnote") positions.push(pos);
      return true;
    });
    expect(positions).toHaveLength(4);
    expect(writeFootnoteNumbers(editor.state.tr, positions).steps).toHaveLength(0);
    editor.destroy();
  });
});
