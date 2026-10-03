// @vitest-environment jsdom
/**
 * The live anchor door is O(range), not O(doc) (task 926).
 *
 * `resolveLinkedAnchorRange(state, id)` resolves through the DocStructure
 * snapshot's anchor entry (deferred maps applied per entry, never a whole-
 * snapshot materialization) and walks only that span. Pinned here:
 *   1. the work is FLAT in document size — a 4-block and a 400-block doc cost
 *      the same container visits, mid-typing-burst (pending maps present);
 *   2. the answer equals the full walk's, before and after edits inside,
 *      before, and after the marked run;
 *   3. an absent id answers null without walking; an observer-less state
 *      falls back to the full walk;
 *   4. `getAnchorSummary`'s paragraph count (card render bodies) is flat too.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Fragment } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { getMaterializeCount } from "@/lib/tiptap/doc-structure/observer-plugin";
import { createParagraphWithTitle } from "@/lib/editor-extensions";
import { LinkedAnchor } from "@/lib/tiptap/linked-anchor";
import { findLinkedAnchorRange, resolveLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { getAnchorSummary } from "@/links/links";
import type { CardWithLinks } from "@/links/links";

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.restoreAllMocks();
});

/** `n` paragraphs; paragraph `n/2` carries a `linkedAnchor` "A1" over a
 *  middle run of its text. */
function mount(n: number) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const mid = Math.floor(n / 2);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
      }),
      DocStructureObserver,
      createParagraphWithTitle(),
      LinkedAnchor,
    ],
    content: {
      type: "doc",
      content: Array.from({ length: n }, (_, i) => ({
        type: "paragraph",
        attrs: { uuid: `p${i}` },
        content:
          i === mid
            ? [
                { type: "text", text: "lead " },
                {
                  type: "text",
                  text: "marked words here",
                  marks: [{ type: "linkedAnchor", attrs: { anchorId: "A1" } }],
                },
                { type: "text", text: " tail" },
              ]
            : [{ type: "text", text: `Paragraph number ${i} body text.` }],
      })),
    },
  });
  editors.push(editor);
  return editor;
}

/** Container visits — every `Fragment.nodesBetween` call is one node's
 *  children being walked, so a full-doc walk scales with block count. */
function visits<T>(fn: () => T): { result: T; count: number } {
  const spy = vi.spyOn(Fragment.prototype, "nodesBetween");
  const result = fn();
  const count = spy.mock.calls.length;
  spy.mockRestore();
  return { result, count };
}

/** Type a few characters inside the marked run so deferred maps pile up. */
function typeInsideMark(editor: Editor) {
  const r = findLinkedAnchorRange(editor.state.doc, "A1")!;
  for (let k = 0; k < 3; k++) {
    editor.view.dispatch(editor.state.tr.insertText("x", r.from + 2));
  }
}

describe("resolveLinkedAnchorRange — the live, snapshot-bounded door", () => {
  it("costs the same over a 4-block and a 400-block doc, mid-typing-burst", () => {
    const costs = [4, 400].map((n) => {
      const editor = mount(n);
      typeInsideMark(editor);
      const before = getMaterializeCount();
      const { result, count } = visits(() => resolveLinkedAnchorRange(editor.state, "A1"));
      expect(result).toEqual(findLinkedAnchorRange(editor.state.doc, "A1"));
      // Resolving one anchor never materializes the whole snapshot.
      expect(getMaterializeCount()).toBe(before);
      return count;
    });
    expect(costs[1]).toBe(costs[0]);
    expect(costs[1]).toBeLessThan(10);
  });

  it("agrees with the full walk after edits before, inside, and after the run", () => {
    const editor = mount(40);
    const check = () =>
      expect(resolveLinkedAnchorRange(editor.state, "A1")).toEqual(
        findLinkedAnchorRange(editor.state.doc, "A1"),
      );
    check();
    editor.view.dispatch(editor.state.tr.insertText("before ", 1));
    check();
    const r = findLinkedAnchorRange(editor.state.doc, "A1")!;
    editor.view.dispatch(editor.state.tr.insertText("IN", r.from + 1));
    check();
    editor.view.dispatch(editor.state.tr.insertText("AT-END", r.to + 2));
    check();
    editor.view.dispatch(editor.state.tr.insertText("AT-START", findLinkedAnchorRange(editor.state.doc, "A1")!.from));
    check();
    editor.view.dispatch(editor.state.tr.insertText("late", editor.state.doc.content.size - 1));
    check();
  });

  it("answers null for an absent id without walking; observer-less state walks", () => {
    const editor = mount(400);
    const { result, count } = visits(() => resolveLinkedAnchorRange(editor.state, "nope"));
    expect(result).toBeNull();
    expect(count).toBe(0);

    const bare = EditorState.create({ doc: editor.state.doc });
    const walked = visits(() => resolveLinkedAnchorRange(bare, "A1"));
    expect(walked.result).toEqual(findLinkedAnchorRange(editor.state.doc, "A1"));
    expect(walked.count).toBeGreaterThan(100);
  });

  it("removing the mark answers null (snapshot membership tracks the removal)", () => {
    const editor = mount(10);
    const r = findLinkedAnchorRange(editor.state.doc, "A1")!;
    editor.view.dispatch(
      editor.state.tr.removeMark(r.from, r.to, editor.schema.marks.linkedAnchor),
    );
    expect(resolveLinkedAnchorRange(editor.state, "A1")).toBeNull();
  });
});

describe("getAnchorSummary — paragraph words via the snapshot", () => {
  it("is flat in doc size and counts the linked paragraphs' words", () => {
    const card = {
      id: "c1",
      links: [
        { id: "l1", anchor: { type: "textObject", textObjectIds: ["p1"] } },
        { id: "l2", anchor: { type: "textObject", textObjectIds: ["p3"] } },
      ],
    } as unknown as CardWithLinks;
    const costs = [4, 400].map((n) => {
      const editor = mount(n);
      typeInsideMark(editor);
      const { result, count } = visits(() => getAnchorSummary(card, editor as never));
      expect(result).toEqual({ kind: "paragraph", words: 10 });
      return count;
    });
    expect(costs[1]).toBe(costs[0]);
  });
});
