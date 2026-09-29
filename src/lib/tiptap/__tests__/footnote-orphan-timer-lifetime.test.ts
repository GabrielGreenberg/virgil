// @vitest-environment jsdom
//
// Task 844 — the footnote orphan detector's deferred `virgil-footnote-orphaned`
// dispatch is bounded by its EDITOR, not the wall clock. Deleting a footnote
// with content arms a one-tick timer; destroying the editor inside that tick
// must cancel it (the task-548 "fires against a torn-down environment" shape),
// while a live editor still announces the orphan.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: "doc-a" },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const mounted: Editor[] = [];
function mountWithFootnote(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Claim" },
            { type: "footnote", attrs: { footnoteId: "fn1", content: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "A body worth keeping." }] }],
            } } },
          ],
        },
      ],
    },
  });
  mounted.push(editor);
  return editor;
}

function deleteFootnote(editor: Editor): void {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote") at = pos;
    return at < 0;
  });
  expect(at).toBeGreaterThan(-1);
  editor.view.dispatch(editor.state.tr.delete(at, at + 1));
}

function listen(): { ids: string[]; stop: () => void } {
  const ids: string[] = [];
  const handler = (e: Event) => ids.push((e as CustomEvent).detail.footnoteId);
  window.addEventListener("virgil-footnote-orphaned", handler);
  return { ids, stop: () => window.removeEventListener("virgil-footnote-orphaned", handler) };
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("footnote orphan dispatch is bounded by its editor (task 844)", () => {
  it("a live editor announces the orphan on the next tick", () => {
    vi.useFakeTimers();
    const editor = mountWithFootnote();
    const l = listen();
    deleteFootnote(editor);
    expect(l.ids).toEqual([]); // deferred, not synchronous
    vi.runAllTimers();
    expect(l.ids).toEqual(["fn1"]);
    l.stop();
  });

  it("destroying the editor inside the tick cancels the pending dispatch", () => {
    vi.useFakeTimers();
    const editor = mountWithFootnote();
    const l = listen();
    deleteFootnote(editor);
    editor.destroy();
    vi.runAllTimers();
    expect(l.ids).toEqual([]);
    l.stop();
  });
});
