// @vitest-environment jsdom
//
// Task 1534 — footnote and citation Search hits navigate to the atom's LIVE
// position, never the position baked into the rev-gated item arrays.
//
// The bug: the footnote/citation scopes took `pos` from props memoed on
// `rev.footnotes` / `rev.citations`, which a plain edit ABOVE the atom never
// bumps — so after typing (or deleting a paragraph) the click moved the caret
// and scroll to unrelated text. The fix stamps every anchored atom hit with an
// `atomRef` and routes every click through ONE door (`resolveHitRange`), which
// reads the DocStructure snapshot (re-mapped every transaction).
//
// Built on the real main-editor extension stack so the observer actually
// re-maps positions.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  compileQuery,
  searchCitations,
  searchFootnotes,
  type EditorCitationItem,
  type FootnoteSearchItem,
} from "@/lib/search-sources";
import { resolveHitRange } from "@/panels/Search/SearchPanel";
import {
  liveAtomPositions,
  resolveLiveAtomPos,
} from "@/hooks/useLivePosResolver";

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

const CITE = "\\cite{smith2020}";

// A plain paragraph (the edit site) ABOVE a paragraph holding a citation and a
// footnote whose body matches the query.
function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p-edit" },
        content: [{ type: "text", text: "A long opening paragraph with no atoms." }],
      },
      {
        type: "paragraph",
        attrs: { uuid: "p-atoms" },
        content: [
          { type: "text", text: "As shown " },
          {
            type: "citation",
            attrs: { citationId: "cit-1", command: CITE, displayText: "Smith 2020" },
          },
          { type: "text", text: " and noted" },
          {
            type: "footnote",
            attrs: {
              footnoteId: "fn-1",
              number: 1,
              content: {
                type: "doc",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "see smith too" }] },
                ],
              },
            },
          },
          { type: "text", text: " here." },
        ],
      },
    ],
  };
}

function atomPos(editor: Editor, type: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found == null && node.type.name === type) found = pos;
  });
  return found;
}

/** The item arrays as the pane last built them — BAKED, like the rev-gated
 *  `footnoteInfos` / `allEditorCitations` props. */
function bakeItems(editor: Editor): {
  footnotes: FootnoteSearchItem[];
  citations: EditorCitationItem[];
} {
  const fn = atomPos(editor, "footnote")!;
  const cit = atomPos(editor, "citation")!;
  return {
    footnotes: [
      {
        footnoteId: "fn-1",
        pos: fn,
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "see smith too" }] }],
        },
      },
    ],
    citations: [{ citationId: "cit-1", command: CITE, keys: ["smith2020"], pos: cit }],
  };
}

function hits(editor: Editor, live: boolean) {
  const re = compileQuery("smith", { caseSensitive: false, wholeWord: false })!;
  const items = bakeItems(editor);
  const lookup = live ? liveAtomPositions(editor) : null;
  return {
    items,
    fn: searchFootnotes(items.footnotes, [], re, lookup),
    cit: searchCitations([], items.citations, () => "", re, lookup),
  };
}

let editor: Editor;
let element: HTMLElement;

beforeEach(() => {
  element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
});

afterEach(() => {
  editor.destroy();
  element.remove();
});

describe("task 1534 — atom Search hits resolve to the LIVE atom", () => {
  it("anchored footnote/citation hits carry an atom identity", () => {
    const { fn, cit } = hits(editor, false);
    expect(fn.length).toBeGreaterThan(0);
    expect(cit.length).toBeGreaterThan(0);
    for (const h of fn) expect(h.atomRef).toEqual({ kind: "footnote", id: "fn-1" });
    for (const h of cit) expect(h.atomRef).toEqual({ kind: "citation", id: "cit-1" });
  });

  it("a click after typing ABOVE the atom lands on its live position, not the baked one", () => {
    const { fn, cit, items } = hits(editor, false); // produced BEFORE the edit
    editor.commands.insertContentAt(2, "Inserted words. ");
    const liveFn = atomPos(editor, "footnote")!;
    const liveCit = atomPos(editor, "citation")!;
    // The edit really did strand the baked positions.
    expect(liveFn).not.toBe(items.footnotes[0].pos);
    expect(liveCit).not.toBe(items.citations[0].pos);

    for (const h of fn) expect(resolveHitRange(editor, h)).toEqual({ from: liveFn, to: liveFn });
    for (const h of cit) expect(resolveHitRange(editor, h)).toEqual({ from: liveCit, to: liveCit });
  });

  it("a click after DELETING text above the atom still tracks it", () => {
    const { fn, cit } = hits(editor, false);
    editor.commands.deleteRange({ from: 2, to: 20 });
    const liveFn = atomPos(editor, "footnote")!;
    const liveCit = atomPos(editor, "citation")!;
    for (const h of fn) expect(resolveHitRange(editor, h)).toEqual({ from: liveFn, to: liveFn });
    for (const h of cit) expect(resolveHitRange(editor, h)).toEqual({ from: liveCit, to: liveCit });
  });

  it("a deleted atom resolves to null (no-op), never the baked position", () => {
    const { cit } = hits(editor, false);
    const at = atomPos(editor, "citation")!;
    editor.commands.deleteRange({ from: at, to: at + 1 });
    expect(atomPos(editor, "citation")).toBeNull();
    expect(resolveLiveAtomPos(editor, { kind: "citation", id: "cit-1" })).toBeNull();
    for (const h of cit) expect(resolveHitRange(editor, h)).toBeNull();
  });

  it("a search run reads positions from the live snapshot over stale item arrays", () => {
    const baked = bakeItems(editor);
    editor.commands.insertContentAt(2, "Shift it. ");
    const re = compileQuery("smith", { caseSensitive: false, wholeWord: false })!;
    const live = liveAtomPositions(editor);
    const fn = searchFootnotes(baked.footnotes, [], re, live);
    const cit = searchCitations([], baked.citations, () => "", re, live);
    for (const h of fn) expect(h.from).toBe(atomPos(editor, "footnote"));
    for (const h of cit) expect(h.from).toBe(atomPos(editor, "citation"));
  });

  it("an unanchored hit resolves to null; a hit with no identity keeps its baked range", () => {
    expect(resolveHitRange(editor, { from: 5, to: 5, unanchored: true })).toBeNull();
    expect(resolveHitRange(editor, { from: 5, to: 7 })).toEqual({ from: 5, to: 7 });
  });
});
