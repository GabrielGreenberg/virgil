// @vitest-environment jsdom
//
// Task 1004 — ONE snippet producer (`snippetAround`) for every search scope.
//
//   • Main-text context is cut from the hit's OWN block: the prose index joins
//     every block with "\n", so an unbounded slice borrowed the previous block
//     (often a heading) as "before" and the next paragraph's opening as "after".
//   • The result card's "…" is a REPORTED fact (`clippedBefore`/`clippedAfter`),
//     not a guess from `before.length === CTX` — a match exactly CTX chars into
//     its text used to get a false leading ellipsis.

import { describe, it, expect, vi, afterEach } from "vitest";

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
  snippetAround,
  SNIPPET_CTX,
  searchNotes,
} from "@/lib/search-sources";
import { searchMainText } from "@/panels/Search/SearchPanel";

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

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function mount(content: Content): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
  cleanups.push(() => {
    editor.destroy();
    element.remove();
  });
  return editor;
}

const Q = { caseSensitive: true, wholeWord: false };

const PARA = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda omega.";

function doc(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, uuid: "h1" },
        content: [{ type: "text", text: "Methods" }],
      },
      { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: PARA }] },
      {
        type: "paragraph",
        attrs: { uuid: "p2" },
        content: [{ type: "text", text: "Nextblock opening words here." }],
      },
    ],
  };
}

describe("task 1004 — main-text snippets stay inside their hit's block", () => {
  it("a hit at a paragraph's start borrows nothing from the heading above", () => {
    const editor = mount(doc());
    const hits = searchMainText(editor as never, compileQuery("Alpha", Q)!);
    const hit = hits.find((h) => h.match === "Alpha")!;
    expect(hit).toBeDefined();
    expect(hit.before).toBe("");
    expect(hit.clippedBefore).toBeFalsy();
  });

  it("a hit near a paragraph's end shows no text from the next block", () => {
    const editor = mount(doc());
    const hits = searchMainText(editor as never, compileQuery("omega", Q)!);
    const hit = hits.find((h) => h.match === "omega")!;
    expect(hit.after).toBe(".");
    expect(hit.after).not.toContain("Nextblock");
    expect(hit.clippedAfter).toBeFalsy();
  });

  it("a hit deep in a long paragraph reports clipping on the cut side", () => {
    const long = "x".repeat(100) + " needle " + "y".repeat(100);
    const editor = mount({
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "p" }, content: [{ type: "text", text: long }] }],
    });
    const hit = searchMainText(editor as never, compileQuery("needle", Q)!)[0];
    expect(hit.before.length).toBe(SNIPPET_CTX);
    expect(hit.after.length).toBe(SNIPPET_CTX);
    expect(hit.clippedBefore).toBe(true);
    expect(hit.clippedAfter).toBe(true);
  });
});

describe("task 1004 — snippetAround reports truncation instead of inferring it", () => {
  it("a match exactly SNIPPET_CTX chars into its text is NOT clipped", () => {
    const text = "a".repeat(SNIPPET_CTX) + "HIT" + "b".repeat(SNIPPET_CTX);
    const s = snippetAround(text, SNIPPET_CTX, SNIPPET_CTX + 3);
    expect(s.before.length).toBe(SNIPPET_CTX);
    expect(s.clippedBefore).toBe(false);
    expect(s.clippedAfter).toBe(false);
  });

  it("one char more on either side IS clipped", () => {
    const text = "a".repeat(SNIPPET_CTX + 1) + "HIT" + "b".repeat(SNIPPET_CTX + 1);
    const s = snippetAround(text, SNIPPET_CTX + 1, SNIPPET_CTX + 4);
    expect(s.clippedBefore).toBe(true);
    expect(s.clippedAfter).toBe(true);
  });

  it("clamps to [lo, hi) bounds and reports against them", () => {
    const text = "HEAD\nbody HIT tail\nNEXT";
    const lo = 5;
    const hi = text.indexOf("\nNEXT");
    const start = text.indexOf("HIT");
    const s = snippetAround(text, start, start + 3, lo, hi);
    expect(s.before).toBe("body ");
    expect(s.after).toBe(" tail");
    expect(s.clippedBefore).toBe(false);
    expect(s.clippedAfter).toBe(false);
  });

  it("card-scope hits carry the same reported flags", () => {
    const title = "z".repeat(SNIPPET_CTX) + "needle";
    const hits = searchNotes(
      [{ id: "n1", title } as never],
      (() => ({ rows: [], anchored: false })) as never,
      compileQuery("needle", Q)!,
    );
    expect(hits[0].before.length).toBe(SNIPPET_CTX);
    expect(hits[0].clippedBefore).toBeUndefined();
  });
});
