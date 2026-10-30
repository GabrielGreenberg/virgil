// @vitest-environment jsdom
//
// Task 1374 — "is this text LIVE LaTeX that can declare a label?" has ONE
// answer (`isLabelDeclaringText` / `forEachLiveLabel`, `lib/labels.ts`), read by
// BOTH the label collector and the Duplicate re-mint walk. Before it, both
// scanned every text node: duplicating a passage that SHOWS a `\label{…}` in a
// verbatim listing or a `%` comment rewrote the copy's literal bytes to
// `\label{…-2}`, and the collector counted those inert labels as declared.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { duplicateSlice, createDuplicateDiagnostics } from "@/text-objects/duplicate-slice";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { collectLabelKeysIn, forEachLiveLabel, mapLiveLabels } from "@/lib/labels";
import { parseLatex } from "@/lib/latex-parser";
import { CARRIER_ROWS, isInertCarrierMark } from "@/lib/latex-lexer";

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

const mounted: Editor[] = [];
function mountDoc(content: JSONContent | JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: Array.isArray(content) ? { type: "doc", content } : content,
  });
  mounted.push(editor);
  return editor;
}

beforeEach(() => {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});
afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

const api: CardLifecycleApi = {
  get: () => ({ clone: (id: string) => `${id}-copy`, delete: () => {} }),
};

/** Duplicate the whole doc; return [source text, copy text] per block. */
function duplicateAll(editor: Editor): { before: string[]; copies: PMNode[] } {
  const doc = editor.state.doc;
  const n = doc.childCount;
  const before: string[] = [];
  doc.forEach((c) => before.push(c.textContent));
  const cloned = duplicateSlice(
    doc.slice(0, doc.content.size),
    api,
    createDuplicateDiagnostics(),
    { takenLabels: collectLabelKeysIn(doc) },
  );
  const tr = editor.state.tr.replace(doc.content.size, doc.content.size, cloned);
  tr.doc.check();
  editor.view.dispatch(tr);
  const copies: PMNode[] = [];
  for (let i = n; i < n * 2; i++) copies.push(editor.state.doc.child(i));
  return { before, copies };
}

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "",
  "Live text \\label{z} here.",
  "",
  "\\begin{verbatim}",
  "\\section{Intro}\\label{x}",
  "\\end{verbatim}",
  "",
  "% \\label{y}",
  "",
  "Tail text. % \\label{w}",
  "",
  "Show \\verb|\\label{v}| inline.",
  "",
  "\\begin{tabular}{l}",
  "a \\label{t} \\\\",
  "% \\label{c}",
  "\\end{tabular}",
  "",
  "\\end{document}",
].join("\n");

describe("inert text declares nothing and is never reminted (task 1374)", () => {
  it("the collector counts only the live declarations", () => {
    const editor = mountDoc(parseLatex(TEX));
    const keys = [...collectLabelKeysIn(editor.state.doc)].sort();
    expect(keys).toEqual(["t", "z"]);
  });

  it("Duplicate keeps verbatim / comment bytes and remints only live labels", () => {
    const editor = mountDoc(parseLatex(TEX));
    const { before, copies } = duplicateAll(editor);
    const after = copies.map((c) => c.textContent);
    const all = after.join("\n");
    // Live: reminted.
    expect(all).toContain("\\label{z-2}");
    expect(all).toContain("\\label{t-2}");
    // Inert: byte-identical to the source.
    for (const inert of ["x", "y", "w", "v", "c"]) {
      expect(all).toContain(`\\label{${inert}}`);
      expect(all).not.toContain(`\\label{${inert}-2}`);
    }
    // Every inert-only block copies its source text exactly.
    before.forEach((src, i) => {
      if (!/\\label\{[zt]\}/.test(src)) expect(after[i]).toBe(src);
    });
  });
});

describe("the shared raw-source scanner", () => {
  it("skips comment, \\verb and verbatim-family regions inside live source", () => {
    const src =
      "\\label{a} % \\label{b}\n\\verb|\\label{c}| \\begin{comment}\\label{d}\\end{comment} \\label{e}";
    const seen: string[] = [];
    forEachLiveLabel(src, (k) => seen.push(k));
    expect(seen).toEqual(["a", "e"]);
    expect(mapLiveLabels(src, (k) => `${k}!`)).toBe(
      "\\label{a!} % \\label{b}\n\\verb|\\label{c}| \\begin{comment}\\label{d}\\end{comment} \\label{e!}",
    );
    expect(mapLiveLabels("no labels", (k) => k)).toBe("no labels");
  });

  it("inertness is read off the carrier table's `live` declaration", () => {
    for (const row of CARRIER_ROWS) {
      const attrs = row.form ? { form: row.form } : undefined;
      expect(isInertCarrierMark(row.mark, attrs)).toBe(!row.live);
    }
    expect(isInertCarrierMark("latexCommand")).toBe(false);
    expect(isInertCarrierMark("bold")).toBe(false);
  });
});
