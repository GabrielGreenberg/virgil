// @vitest-environment jsdom
//
// Float write TARGET — task 1399's contract: two consecutive writes from a
// multi-block float never duplicate content in main.
//
// THE BUG: every float body re-derived its write target from its source's
// IDENTITY on each write (a list item's own node range; a heading's section
// range). After the float's own write, main can hold MORE of the float's
// content than that identity spans — an Enter-split wrote the item plus a new
// sibling; a pasted `<h1>` at the end of a section float now ENDS the section.
// The own write is skipped as an echo, so the float never re-read to shrink,
// and the NEXT keystroke wrote every float block into the shrunken span:
// main kept the stale tail and gained a fresh copy of it.
//
// THE FIX: `useFloatMainSync` tracks the span the float's own last write
// occupies (`writtenRangeRef`), and `landFloatWrite` targets it while it still
// begins at the identity the plan resolved. A re-read clears it.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { useFloatMainSync, type SourceRange } from "@/lib/float-sync";
import { landFloatWrite, type FloatWriteOutcome } from "@/lib/float-write-back";
import { getSectionRangeByUuid } from "@/lib/section-range";
import { findSourceNodeByUuid } from "@/lib/float-source-range";
import { resolveInnerWriteback } from "@/text-objects/floats/list-item-body";

function ctx(surface: "main" | "float"): EditorExtensionsCtx {
  return {
    surface,
    editableRef: { current: true },
    editable: true,
    cardContext: surface === "float",
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const editors: Editor[] = [];

function mount(content: JSONContent, surface: "main" | "float" = "main"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx(surface)),
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

const text = (t: string) => (t ? [{ type: "text", text: t }] : []);
const para = (uuid: string, t: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  content: text(t),
});
const heading = (uuid: string, t: string, level = 1): JSONContent => ({
  type: "heading",
  attrs: { uuid, level },
  content: text(t),
});
const item = (uuid: string, t: string): JSONContent => ({
  type: "listItem",
  attrs: { uuid },
  content: [para(`${uuid}-p`, t)],
});

/** Top-level block texts of `doc`, or list-item texts when `listItems`. */
function texts(editor: Editor, listItems = false): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((n) => {
    if (listItems ? n.type.name === "listItem" : n.isBlock && n.isTextblock) {
      out.push(n.textContent);
      return false;
    }
    return true;
  });
  return out;
}

/** Mount the REAL `useFloatMainSync`, and return a `write(floatDoc)` that does
 *  exactly what a body's `onUpdate` does: set the float's content, then land
 *  it through the one door with the tracked written span. */
function mountFloat(
  main: Editor,
  floatId: string,
  seed: JSONContent,
  readSource: (doc: PMNode, hint: SourceRange | null) => {
    doc: JSONContent;
    missing: boolean;
    range?: SourceRange | null;
  },
  plan: (
    main: Editor,
    floatDoc: JSONContent,
    hint: SourceRange | null,
  ) => { from: number; to: number; content: PMNode[] } | null,
) {
  const float = mount(seed, "float");
  const view = renderHook(() =>
    useFloatMainSync({
      mainEditor: main as unknown as ReactEditor,
      floatEditor: float as unknown as ReactEditor,
      floatId,
      readSource,
    }),
  );
  const write = (floatDoc: JSONContent): FloatWriteOutcome => {
    let outcome!: FloatWriteOutcome;
    act(() => {
      float.commands.setContent(floatDoc, { emitUpdate: false });
      const r = view.result.current;
      outcome = landFloatWrite(
        main as unknown as ReactEditor,
        floatId,
        (ed) => plan(ed as unknown as Editor, floatDoc, r.sourceRangeRef.current),
        r.writtenRangeRef.current,
      );
    });
    return outcome;
  };
  return { float, view, write };
}

// ── List item: an Enter-split, then one more keystroke ─────────────────────

function listItemFloat(main: Editor, uuid: string) {
  const wrap = (items: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [{ type: "bulletList", attrs: { uuid: "wrap" }, content: items }],
  });
  return {
    wrap,
    ...mountFloat(
      main,
      `listItem:${uuid}`,
      wrap([item(uuid, "alpha")]),
      (doc, hint) => {
        const src = findSourceNodeByUuid(doc, uuid, "listItem", hint);
        if (!src) return { doc: wrap([]), missing: true };
        return {
          doc: wrap([src.node.toJSON() as JSONContent]),
          missing: false,
          range: src.parentRange ?? { from: src.start, to: src.end },
        };
      },
      (ed, floatDoc, hint) => {
        const wb = resolveInnerWriteback(ed.state.doc, uuid, floatDoc, hint);
        return wb ? { from: wb.from, to: wb.to, content: wb.items } : null;
      },
    ),
  };
}

describe("float write target — a list-item float that split", () => {
  const mainList = (): JSONContent => ({
    type: "doc",
    content: [
      para("p0", "before"),
      {
        type: "bulletList",
        attrs: { uuid: "L" },
        content: [item("A", "alpha"), item("Z", "zulu")],
      },
      para("p9", "after"),
    ],
  });

  it("the second write overwrites the split-off sibling, never copies it", () => {
    const main = mount(mainList());
    const { wrap, write, float } = listItemFloat(main, "A");

    // Enter mid-item in the float: A' + a new sibling B.
    expect(write(wrap([item("A", "al"), item("B", "pha")])).status).toBe("landed");
    expect(texts(main, true)).toEqual(["al", "pha", "zulu"]);
    // The own write is an echo — the float was not re-read and still holds both.
    expect(texts(float, true)).toEqual(["al", "pha"]);

    // The next keystroke — in the split-off half.
    expect(write(wrap([item("A", "al"), item("B", "phaX")])).status).toBe("landed");
    expect(texts(main, true)).toEqual(["al", "phaX", "zulu"]);

    // And a third, merging back: the float now holds one item again.
    expect(write(wrap([item("A", "alphaX")])).status).toBe("landed");
    expect(texts(main, true)).toEqual(["alphaX", "zulu"]);
    expect(texts(main)).toEqual(["before", "alphaX", "zulu", "after"]);
  });

  it("a foreign edit to the split-off half re-reads, and the target resets to the identity", () => {
    const main = mount(mainList());
    const { wrap, write, float, view } = listItemFloat(main, "A");
    write(wrap([item("A", "al"), item("B", "pha")]));
    expect(view.result.current.writtenRangeRef.current).not.toBeNull();

    // Type into B in MAIN.
    const b = findSourceNodeByUuid(main.state.doc, "B", "listItem");
    if (!b) throw new Error("no B");
    act(() => {
      main.view.dispatch(main.state.tr.insertText("Q", b.start + 2));
    });
    // The re-read re-seeded the float from A's own extent and cleared the span.
    expect(view.result.current.writtenRangeRef.current).toBeNull();
    expect(float.state.doc.textContent).toBe("al");

    // A float write now targets only A.
    write(wrap([item("A", "alY")]));
    expect(texts(main, true)).toEqual(["alY", "Qpha", "zulu"]);
  });
});

// ── Section float: a pasted terminating heading, then one more keystroke ───

describe("float write target — a section float that gained an ending heading", () => {
  // Section numbers pre-settled, so the numbering plugin appends nothing to a
  // write that adds an UNNUMBERED heading — the case where no appended
  // transaction re-reads the float, and its next write must target the span
  // it wrote (a numbered paste is re-read by the renumber; see the next test).
  const h = (uuid: string, t: string, n: string | null): JSONContent => ({
    type: "heading",
    attrs: { uuid, level: 1, numbered: n !== null, sectionNumber: n },
    content: text(t),
  });
  const mainSections = (): JSONContent => ({
    type: "doc",
    content: [h("h1", "Intro", "1"), para("p1", "body"), h("h2", "Next", "2"), para("p2", "rest")],
  });

  function sectionFloat(main: Editor, uuid: string) {
    return mountFloat(
      main,
      `section:${uuid}`,
      { type: "doc", content: [h(uuid, "Intro", "1"), para("p1", "body")] },
      (doc, hint) => {
        const range = getSectionRangeByUuid(doc, uuid, hint);
        if (!range) return { doc: { type: "doc", content: [] }, missing: true };
        return {
          doc: {
            type: "doc",
            content: range.nodes.map((n) => n.toJSON() as JSONContent),
          },
          missing: false,
          range: { from: range.start, to: range.end },
        };
      },
      (ed, floatDoc, hint) => {
        const range = getSectionRangeByUuid(ed.state.doc, uuid, hint);
        if (!range) return null;
        return {
          from: range.start,
          to: range.end,
          content: (floatDoc.content ?? []).map((j) => ed.state.schema.nodeFromJSON(j)),
        };
      },
    );
  }

  /** The float's current doc with `suffix` typed at the end of its last block. */
  function typedAtEnd(float: Editor, suffix: string): JSONContent {
    const json = float.getJSON();
    const blocks = json.content ?? [];
    const last = blocks[blocks.length - 1];
    const runs = last.content ?? [];
    const tail = runs[runs.length - 1];
    if (tail?.type === "text") tail.text = `${tail.text}${suffix}`;
    else last.content = [...runs, { type: "text", text: suffix }];
    return json;
  }

  it("the second write overwrites the pasted heading + paragraph, never copies them", () => {
    const main = mount(mainSections());
    const { write, float, view } = sectionFloat(main, "h1");

    const pasted = (y: string): JSONContent => ({
      type: "doc",
      content: [h("h1", "Intro", "1"), para("p1", "body"), h("hx", "X", null), para("py", y)],
    });
    expect(write(pasted("Y")).status).toBe("landed");
    expect(texts(main)).toEqual(["Intro", "body", "X", "Y", "Next", "rest"]);
    // No re-read: the float still holds all four blocks, and knows where it wrote them.
    expect(texts(float)).toEqual(["Intro", "body", "X", "Y"]);
    expect(view.result.current.writtenRangeRef.current).not.toBeNull();

    expect(write(typedAtEnd(float, "2")).status).toBe("landed");
    expect(texts(main)).toEqual(["Intro", "body", "X", "Y2", "Next", "rest"]);
  });

  it("a numbered paste is re-read by the renumber, and the next keystroke still duplicates nothing", () => {
    const main = mount(mainSections());
    const { write, float } = sectionFloat(main, "h1");
    write({
      type: "doc",
      content: [h("h1", "Intro", "1"), para("p1", "body"), h("hx", "X", "2"), para("py", "Y")],
    });
    expect(write(typedAtEnd(float, "2")).status).toBe("landed");
    const t = texts(main);
    expect(t.filter((x) => x.startsWith("X"))).toHaveLength(1);
    expect(t.filter((x) => x.startsWith("Y"))).toHaveLength(1);
    expect(t).toHaveLength(6);
  });
});
