// @vitest-environment jsdom
//
// Task 1074 — "which atom ids are live?" must see inside a footnote body.
//
// `collectAtomIds` walked `doc.descendants`, which never enters a footnote's
// `attrs.content` blob, while `remintNestedAtomIds` DOES descend there. So for
// a `\cite` nested in a footnote the remint asked "is this id live?", heard
// "no", and KEPT it: copy → paste of `x\footnote{see \cite{k}}` left the nested
// citationId in the document twice. And a float (whose doc is one node of
// MAIN's) re-minted every pasted id unconditionally, so a cut → paste inside a
// float orphaned the card the cut was meant to carry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { parseLatex } from "@/lib/latex-parser";
import { inlineAtoms } from "@/lib/inline-content";
import { collectAtomIds } from "@/lib/tiptap/node-identity";

function ctx(
  surface: "main" | "float",
  host: EditorExtensionsCtx["host"] = null,
): EditorExtensionsCtx {
  return {
    surface,
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host,
  } as EditorExtensionsCtx;
}

const mounted: Editor[] = [];
function mount(
  content: JSONContent,
  surface: "main" | "float" = "main",
  host: EditorExtensionsCtx["host"] = null,
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx(surface, host)),
    content,
  });
  mounted.push(editor);
  return editor;
}

beforeEach(() => {
  if (typeof globalThis.ClipboardEvent === "undefined") {
    (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = class extends Event {
      clipboardData = null;
    };
  }
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const zero = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => zero;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.destroy();
  document.body.innerHTML = "";
});

function copyFirstParagraph(editor: Editor): string {
  const para = editor.state.doc.child(0);
  return editor.view.serializeForClipboard(editor.state.doc.slice(1, 1 + para.content.size)).dom.innerHTML;
}

function pasteAt(editor: Editor, pos: number, html: string) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  editor.view.pasteHTML(html);
}

/** Every card-bearing atom id in reading order — nested ones included. */
function allIds(editor: Editor, kind: string): string[] {
  const out: string[] = [];
  for (const hit of inlineAtoms(editor.state.doc)) if (hit.kind === kind) out.push(hit.id);
  return out;
}

const NESTED = "A\\footnote{see \\cite{knuth}} B.\n\nSecond.";

describe("collectAtomIds — one notion of where atoms hide", () => {
  it("includes a \\cite nested inside a footnote body", () => {
    const editor = mount(parseLatex(NESTED));
    const [cite] = allIds(editor, "citation");
    const [fn] = allIds(editor, "footnote");
    expect(cite).toBeTruthy();
    const live = collectAtomIds(editor.state.doc);
    expect(live.has(fn)).toBe(true);
    expect(live.has(cite)).toBe(true);
  });
});

describe("paste — no duplicate nested atom id", () => {
  it("COPY → paste ABOVE the source: every id unique; the original keeps its ids", () => {
    const editor = mount(parseLatex(NESTED));
    const [origFn] = allIds(editor, "footnote");
    const [origCite] = allIds(editor, "citation");
    const html = copyFirstParagraph(editor);
    pasteAt(editor, 1, html); // above the source, in reading order
    const fns = allIds(editor, "footnote");
    const cites = allIds(editor, "citation");
    expect(fns).toHaveLength(2);
    expect(cites).toHaveLength(2);
    expect(new Set(fns).size).toBe(2);
    expect(new Set(cites).size).toBe(2);
    expect(fns).toContain(origFn);
    expect(cites).toContain(origCite);
    // The source atom is the SECOND in reading order and kept its identity.
    expect(fns[1]).toBe(origFn);
    expect(cites[1]).toBe(origCite);
  });
});

describe("float paste — asks MAIN which ids are live", () => {
  it("a pasted id MAIN still holds is re-minted (nested ones too)", () => {
    const main = mount(parseLatex(NESTED));
    const float = mount({ type: "doc", content: [{ type: "paragraph" }] }, "float", {
      getMainEditor: () => main as never,
    });
    const html = copyFirstParagraph(main);
    pasteAt(float, 1, html);
    const mainIds = collectAtomIds(main.state.doc);
    for (const id of [...allIds(float, "footnote"), ...allIds(float, "citation")]) {
      expect(mainIds.has(id)).toBe(false);
    }
  });

  it("CUT → paste: an id MAIN no longer holds is KEPT — the card follows its text", () => {
    const main = mount(parseLatex(NESTED));
    const [fn] = allIds(main, "footnote");
    const [cite] = allIds(main, "citation");
    const html = copyFirstParagraph(main);
    const para = main.state.doc.child(0);
    main.view.dispatch(main.state.tr.delete(1, 1 + para.content.size));
    expect(allIds(main, "footnote")).toHaveLength(0);
    const float = mount({ type: "doc", content: [{ type: "paragraph" }] }, "float", {
      getMainEditor: () => main as never,
    });
    pasteAt(float, 1, html);
    expect(allIds(float, "footnote")).toEqual([fn]);
    expect(allIds(float, "citation")).toEqual([cite]);
  });

  it("an unreachable MAIN falls back to re-minting every id", () => {
    const source = mount(parseLatex(NESTED));
    const [fn] = allIds(source, "footnote");
    const float = mount({ type: "doc", content: [{ type: "paragraph" }] }, "float", {
      getMainEditor: () => null,
    });
    pasteAt(float, 1, copyFirstParagraph(source));
    expect(allIds(float, "footnote")).toHaveLength(1);
    expect(allIds(float, "footnote")[0]).not.toBe(fn);
  });
});
