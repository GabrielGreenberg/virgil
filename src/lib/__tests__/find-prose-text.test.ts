// @vitest-environment jsdom
//
// Task 2026-09-29-841 — the quote locator behind the text-based highlight band
// (revision / comment quotes) runs over the PROSE INDEX. The old
// `findTextRange` searched `getText()` ("\n\n" block separators + atom text)
// and mapped the hit with a text-node-only walk, so past the first block the
// band landed on the wrong words, or on none.
import { describe, expect, it, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { findProseTextRange } from "@/lib/find-prose-text";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(body: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions({
      surface: "main",
      editableRef: { current: true },
      cardContext: false,
      callbacks: {},
      docIdRef: { current: null },
      anchoredUuidsRef: { current: new Set<string>() },
      host: null,
    } as unknown as EditorExtensionsCtx),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
    ) as never,
  });
  return editor;
}

const FIVE = [
  "Alpha opens the paper here.",
  "Bravo cites a source \\cite{smith2020} in passing.",
  "Charlie says something plain.",
  "Delta continues the argument.",
  "Echo holds the quoted phrase at the end.",
].join("\n\n");

function hasAtom(ed: Editor, from: number, to: number): boolean {
  let found = false;
  ed.state.doc.nodesBetween(from, to, (n) => {
    if (n.isInline && n.isAtom) found = true;
  });
  return found;
}

describe("findProseTextRange", () => {
  it("fixture precondition: paragraph 2 carries an inline atom", () => {
    const ed = mount(FIVE);
    expect(hasAtom(ed, 0, ed.state.doc.content.size)).toBe(true);
  });

  it("locates a phrase in paragraph 5 exactly (the drift the old locator had)", () => {
    const ed = mount(FIVE);
    const r = findProseTextRange(ed.state.doc, "the quoted phrase");
    expect(r).not.toBeNull();
    expect(ed.state.doc.textBetween(r!.from, r!.to)).toBe("the quoted phrase");
  });

  it("still locates a phrase in paragraph 1", () => {
    const ed = mount(FIVE);
    const r = findProseTextRange(ed.state.doc, "opens the paper");
    expect(ed.state.doc.textBetween(r!.from, r!.to)).toBe("opens the paper");
  });

  it("a quote captured across an atom (atom contributes nothing) spans the atom", () => {
    const ed = mount(FIVE);
    // `textBetween(from, to, " ")` — the capture — drops the citation pill.
    const r = findProseTextRange(ed.state.doc, "a source  in passing");
    expect(r).not.toBeNull();
    expect(hasAtom(ed, r!.from, r!.to)).toBe(true);
    expect(ed.state.doc.textBetween(r!.from, r!.to, " ").replace(/\s+/g, " ")).toBe(
      "a source in passing",
    );
  });

  it("a quote with no whitespace never matches across a block boundary", () => {
    const ed = mount("Endword\n\nStartword");
    expect(findProseTextRange(ed.state.doc, "EndwordStartword")).toBeNull();
  });

  it("a quote captured across a paragraph break (joined by ' ') resolves", () => {
    const ed = mount(FIVE);
    const r = findProseTextRange(ed.state.doc, "something plain. Delta continues");
    expect(r).not.toBeNull();
    expect(ed.state.doc.textBetween(r!.from, r!.to, " ")).toBe(
      "something plain. Delta continues",
    );
  });

  it("absent / empty quotes return null", () => {
    const ed = mount(FIVE);
    expect(findProseTextRange(ed.state.doc, "not in the doc")).toBeNull();
    expect(findProseTextRange(ed.state.doc, "   ")).toBeNull();
  });

  it("Editor.tsx has no hand-rolled getText locator and no replaceText handle", () => {
    const src = readFileSync(resolve(__dirname, "../../components/Editor.tsx"), "utf8");
    expect(src).not.toMatch(/function findTextRange/);
    expect(src).not.toMatch(/replaceText/);
    expect(src).toMatch(/findProseTextRange\(/);
  });
});
