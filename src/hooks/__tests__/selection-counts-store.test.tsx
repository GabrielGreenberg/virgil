// @vitest-environment jsdom
//
// Task 1395 — the Word Count panel's Selection tally is a per-editor LAZY
// store, read only by the panel:
//   1. an edit INSIDE a held selection that leaves its endpoints put (a
//      footnote body changed in place) recounts — `selectionUpdate` alone never
//      fires for it, so the old hook left the Selection stat stale;
//   2. with no subscriber (panel closed) nothing is counted and no editor
//      listener is attached;
//   3. a recount that equals the previous tally notifies no one;
//   4. EditorPane no longer owns a selection leg (`wordCountHook` is counts-only).
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { render, cleanup, act } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import * as core from "@/lib/word-count-core";
import {
  getSelectionCountsStore,
  SELECTION_RECOUNT_MS,
} from "@/hooks/useSelectionCounts";
import WordCountPanel from "@/panels/WordCount/WordCountPanel";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

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

const editors: Editor[] = [];

/** doc: paragraph("one two " · footnote("alpha beta") · " three") ·
 *  paragraph("four five") */
function mountEditor(): ReactEditor {
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
            { type: "text", text: "one two " },
            { type: "footnote", attrs: { id: "fn-1", content: "alpha beta" } },
            { type: "text", text: " three" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "four five" }] },
      ],
    },
  });
  editors.push(editor);
  return editor as unknown as ReactEditor;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

const wait = (ms = SELECTION_RECOUNT_MS + 30) =>
  new Promise((r) => setTimeout(r, ms));

function selectFirstParagraph(editor: ReactEditor) {
  const para = editor.state.doc.child(0);
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1, 1 + para.content.size),
    ),
  );
}

function footnotePos(editor: ReactEditor): number {
  let at = -1;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "footnote") at = pos;
    return at < 0;
  });
  if (at < 0) throw new Error("no footnote");
  return at;
}

describe("selection-counts store (task 1395)", () => {
  it("recounts when content changes INSIDE a held selection (endpoints unmoved)", async () => {
    const editor = mountEditor();
    selectFirstParagraph(editor);
    const store = getSelectionCountsStore(editor);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    expect(store.getSnapshot()?.words.footnotes).toBe(2);

    const { from, to } = editor.state.selection;
    const pos = footnotePos(editor);
    const node = editor.state.doc.nodeAt(pos)!;
    const onSel = vi.fn();
    editor.on("selectionUpdate", onSel);
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        content: "alpha beta gamma delta",
      }),
    );
    // The premise: positions did not move, so TipTap emitted no selectionUpdate.
    expect(editor.state.selection.from).toBe(from);
    expect(editor.state.selection.to).toBe(to);
    expect(onSel).not.toHaveBeenCalled();

    await wait();
    expect(store.getSnapshot()?.words.footnotes).toBe(4);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("counts nothing and attaches no listener while nobody subscribes (panel closed)", async () => {
    const editor = mountEditor();
    const spy = vi.spyOn(core, "computeCategoryCounts");
    const onSpy = vi.spyOn(editor, "on");
    getSelectionCountsStore(editor); // created but unsubscribed
    selectFirstParagraph(editor);
    await wait();
    expect(spy).not.toHaveBeenCalled();
    expect(onSpy).not.toHaveBeenCalled();
  });

  it("detaches on the last unsubscribe — later selections count nothing", async () => {
    const editor = mountEditor();
    const store = getSelectionCountsStore(editor);
    const off = store.subscribe(() => {});
    off();
    const spy = vi.spyOn(core, "computeCategoryCounts");
    selectFirstParagraph(editor);
    await wait();
    expect(spy).not.toHaveBeenCalled();
  });

  it("an equal-tally selection change notifies no one", async () => {
    const editor = mountEditor();
    // "four five" selected two ways with the same words/chars
    const p2 = 1 + editor.state.doc.child(0).nodeSize; // start of para 2 content
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, p2, p2 + 4)),
    );
    const store = getSelectionCountsStore(editor);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const before = store.getSnapshot();
    expect(before?.words.mainText).toBe(1);
    // "five" — same one word, same four characters
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, p2 + 5, p2 + 9),
      ),
    );
    await wait();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    off();
  });

  it("the mounted panel shows the live tally after an in-selection edit", async () => {
    const editor = mountEditor();
    selectFirstParagraph(editor);
    const { container } = render(
      <WordCountPanel counts={core.EMPTY_CATEGORY_COUNTS} editor={editor} />,
    );
    const selectionWords = () =>
      container.querySelector(".tabular-nums.text-base.font-medium:not(.leading-none)")
        ?.textContent;
    // one two three + alpha beta
    expect(selectionWords()).toBe("5");
    const pos = footnotePos(editor);
    const node = editor.state.doc.nodeAt(pos)!;
    await act(async () => {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          content: "alpha beta gamma",
        }),
      );
      await wait();
    });
    expect(selectionWords()).toBe("6");
  });
});

describe("EditorPane owns no selection leg (task 1395)", () => {
  it("wordCountHook carries counts only; the selection hook is read by the panel alone", () => {
    const root = resolve(__dirname, "..", "..");
    const pane = readFileSync(resolve(root, "components/EditorPane.tsx"), "utf8");
    expect(pane).not.toMatch(/useSelectionCounts\(/);
    expect(pane).not.toMatch(/wordCountHook\.selection/);
    const legacy = readFileSync(resolve(root, "hooks/useWordCount.ts"), "utf8");
    expect(legacy).not.toMatch(/selectionUpdate/);
  });
});
