// @vitest-environment jsdom
//
// TASK 636 — the two halves of a destructive range gesture, at unit scale.
//
// The dispatcher-level proof lives in
// `card-actions/__tests__/range-delete-settle-first.test.tsx`. This suite pins
// the two pieces that make the ordering SAFE rather than merely earlier:
//
//   • ONE ENUMERATION. The ask phase and the delete phase must see the same
//     population, or the gesture asks about one set of cards and destroys
//     another. Both read `collectRangeCardTargets`.
//   • ONE MAPPING. A settlement's `revert` splices the pre-suggestion
//     original back over the applied text, and the original may be LONGER than
//     what replaced it. The range is carried across it by
//     `mapRangeThroughSettlement` (task 897) — a step mapping, not a scalar
//     shift, because a selection that only CLIPS the span has an end INSIDE
//     the rewrite.
//   • CONTAINMENT, NOT OVERLAP (task 897). The delete destroys only the cards
//     whose anchors the range wholly contains; the ask settles every card it
//     touches.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  collectRangeCardTargets,
  mapRangeThroughSettlement,
  settleRangeCardObligations,
  commitRangeDelete,
} from "../delete-range";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { linkCardKey } from "@/links/link-dom-contract";
import type { AppliedSpliceOps } from "@/cards/lifecycle/applied-splice";

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

function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

/** One paragraph whose text is split across TWO text nodes carrying the SAME
 *  `linkedAnchor` (one bold, one not) — the shape the walker's seen-set exists
 *  for. */
function splitMarkDoc(): JSONContent[] {
  const anchor = {
    type: "linkedAnchor",
    attrs: {
      anchorId: "anchor-1",
      linkCard: linkCardKey("revision-suggestion", "sugg-1"),
    },
  };
  return [
    {
      type: "paragraph",
      attrs: { uuid: "p-target" },
      content: [
        { type: "text", text: "First half ", marks: [anchor] },
        { type: "text", text: "second half.", marks: [anchor, { type: "bold" }] },
      ],
    },
  ];
}

describe("collectRangeCardTargets — one enumeration for both phases", () => {
  it("yields ONE target for a mark spanning several text nodes", () => {
    const editor = mountDoc(splitMarkDoc());
    const targets = collectRangeCardTargets(
      editor.state.doc,
      0,
      editor.state.doc.content.size,
    );
    expect(targets).toEqual([{ kind: "revision-suggestion", id: "sugg-1" }]);
  });

  it("is read-only — it dispatches nothing and the doc is untouched", () => {
    const editor = mountDoc(splitMarkDoc());
    const before = JSON.stringify(editor.state.doc.toJSON());
    collectRangeCardTargets(editor.state.doc, 0, editor.state.doc.content.size);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
  });

  it("an empty or inverted range yields nothing", () => {
    const editor = mountDoc(splitMarkDoc());
    expect(collectRangeCardTargets(editor.state.doc, 5, 5)).toEqual([]);
    expect(collectRangeCardTargets(editor.state.doc, 9, 4)).toEqual([]);
  });
});

describe("mapRangeThroughSettlement — carrying a range across a revert", () => {
  // One paragraph; `[10, 19)` stands in for an applied span the revert
  // rewrites. Both documents come from ONE editor (one schema), as in the app.
  //                      0         1         2         3
  //                      0123456789012345678901234567890123456
  const editor = mountDoc([
    { type: "paragraph", attrs: { uuid: "p" }, content: [{ type: "text", text: "aaaaaaaaaSUGGESTEDzzzzzzzzzzzzzzzzzz" }] },
  ]);
  const before = editor.state.doc;
  // Revert restores a LONGER original over "SUGGESTED" (doc pos 10..19).
  const after = editor.state.apply(editor.state.tr.insertText("ORIGINAL-TEXT", 10, 19)).doc;
  const keptMarkOnly = editor.state.apply(editor.state.tr.addMark(10, 19, editor.schema.marks.bold.create())).doc;
  const extent = { from: 10, to: 19 };

  it("a range CONTAINING the span maps to the whole restored original + its own tail", () => {
    expect(mapRangeThroughSettlement(before, after, { from: 5, to: 25 }, extent)).toEqual({
      from: 5,
      to: 25 + 4,
    });
  });

  it("an end exactly at the span's edge still takes the span", () => {
    expect(mapRangeThroughSettlement(before, after, { from: 10, to: 19 }, extent)).toEqual({
      from: 10,
      to: 23,
    });
  });

  it("an end strictly INSIDE the rewrite is pushed OUT of it — never into text the user did not select", () => {
    // Clips the TAIL: from inside, to outside.
    expect(mapRangeThroughSettlement(before, after, { from: 14, to: 25 }, extent)).toEqual({
      from: 23,
      to: 29,
    });
    // Clips the HEAD: from outside, to inside.
    expect(mapRangeThroughSettlement(before, after, { from: 5, to: 14 }, extent)).toEqual({
      from: 5,
      to: 10,
    });
    // Wholly inside: nothing of the user's selection survives.
    const inner = mapRangeThroughSettlement(before, after, { from: 12, to: 15 }, extent);
    expect(inner.to).toBe(inner.from);
  });

  it("a settlement that changed no text (a Keep) leaves the range exactly as it was", () => {
    expect(mapRangeThroughSettlement(before, keptMarkOnly, { from: 14, to: 25 }, extent)).toEqual({
      from: 14,
      to: 25,
    });
  });
});

describe("settleRangeCardObligations — the ask phase", () => {
  const spliceOps = (
    answer: "keep" | "revert" | null,
    onSettle?: (editor: Editor) => void,
    editorRef?: { current: Editor | null },
  ): AppliedSpliceOps => {
    let live = true;
    return {
      get: () => (live ? { anchorId: "anchor-1", mode: "replace" } : null),
      ask: async () => answer,
      settle: () => {
        live = false;
        if (onSettle && editorRef?.current) onSettle(editorRef.current);
        return true;
      },
    };
  };

  it("returns null — abort — when the user cancels", async () => {
    const editor = mountDoc(splitMarkDoc());
    const settlement = await settleRangeCardObligations(
      editor,
      0,
      editor.state.doc.content.size,
      spliceOps(null),
    );
    expect(settlement).toBeNull();
  });

  it("with no ops bag it is a pure no-op that still reports the targets", async () => {
    const editor = mountDoc(splitMarkDoc());
    const to = editor.state.doc.content.size;
    const settlement = await settleRangeCardObligations(editor, 0, to, undefined);
    expect(settlement).toEqual({
      targets: [{ kind: "revision-suggestion", id: "sugg-1" }],
      from: 0,
      to,
      docMoved: false,
    });
  });

  it("CORRECTS the range by whatever the settlement moved, in either direction", async () => {
    const editor = mountDoc(splitMarkDoc());
    const ref = { current: editor as Editor | null };
    const to = editor.state.doc.content.size;
    // The settlement grows the paragraph by 6 characters, exactly as a revert to
    // a longer original does.
    const settlement = await settleRangeCardObligations(
      editor,
      0,
      to,
      spliceOps(
        "revert",
        (ed) => {
          ed.view.dispatch(ed.state.tr.insertText("LONGER", 1));
        },
        ref,
      ),
    );
    expect(settlement).not.toBeNull();
    expect(settlement!.docMoved).toBe(true);
    expect(settlement!.to).toBe(to + 6);
    expect(settlement!.to).toBeLessThanOrEqual(editor.state.doc.content.size);
  });

  it("reports docMoved=false when nothing was owed, so the caller re-derives nothing", async () => {
    const editor = mountDoc(splitMarkDoc());
    const to = editor.state.doc.content.size;
    const inert: AppliedSpliceOps = {
      get: () => null,
      ask: async () => null,
      settle: () => true,
    };
    const settlement = await settleRangeCardObligations(editor, 0, to, inert);
    expect(settlement).toEqual({
      targets: [{ kind: "revision-suggestion", id: "sugg-1" }],
      from: 0,
      to,
      docMoved: false,
    });
  });
});

// ---------------------------------------------------------------------------
// TASK 897 — a range that merely OVERLAPS an anchor does not CONTAIN it.
// ---------------------------------------------------------------------------

/** "Keep this. " + an applied suggestion span + " Tail words here." */
function appliedSpanDoc(): JSONContent[] {
  return [
    {
      type: "paragraph",
      attrs: { uuid: "p-applied" },
      content: [
        { type: "text", text: "Keep this. " },
        {
          type: "text",
          text: "NEW WORDING",
          marks: [
            {
              type: "linkedAnchor",
              attrs: {
                anchorId: "anchor-applied",
                linkCard: linkCardKey("revision-suggestion", "sugg-a"),
              },
            },
          ],
        },
        { type: "text", text: " tail words here." },
      ],
    },
  ];
}

/** Settle ops whose REVERT really splices `original` over the anchored span. */
function revertingOps(editorRef: { current: Editor | null }, original: string): AppliedSpliceOps {
  let live = true;
  return {
    get: () => (live ? { anchorId: "anchor-applied", mode: "replace" } : null),
    ask: async () => "revert",
    settle: () => {
      live = false;
      const ed = editorRef.current!;
      let from = -1;
      let to = -1;
      ed.state.doc.descendants((node, pos) => {
        if (node.isText && node.marks.some((m) => m.attrs.anchorId === "anchor-applied")) {
          if (from < 0) from = pos;
          to = pos + node.nodeSize;
        }
      });
      ed.view.dispatch(ed.state.tr.insertText(original, from, to));
      return true;
    },
  };
}

function recordingLifecycle(deleted: string[]): CardLifecycleApi {
  return {
    get: () => ({
      delete(id: string) {
        deleted.push(id);
      },
      clone() {
        return null;
      },
      bindAnchor() {},
    }),
  } as unknown as CardLifecycleApi;
}

function textOf(editor: Editor): string {
  return editor.state.doc.textContent;
}

describe("task 897 — clipping an applied span, then Revert", () => {
  // Doc positions: paragraph content starts at 1. "Keep this. " = 11 chars →
  // the span "NEW WORDING" is [12, 23); " tail words here." follows.
  it("clipping the TAIL: Revert restores the whole original, the delete takes only the selected text outside it", async () => {
    const editor = mountDoc(appliedSpanDoc());
    const ref = { current: editor as Editor | null };
    // Select "WORDING tail" → [16, 28).
    expect(editor.state.doc.textBetween(16, 28)).toBe("WORDING tail");
    const settlement = await settleRangeCardObligations(
      editor,
      16,
      28,
      revertingOps(ref, "the old longer phrasing"),
    );
    expect(settlement).not.toBeNull();
    expect(settlement!.docMoved).toBe(true);
    expect(editor.state.doc.textBetween(settlement!.from, settlement!.to)).toBe(" tail");
    const deleted: string[] = [];
    expect(
      commitRangeDelete(editor, settlement!.from, settlement!.to, recordingLifecycle(deleted)),
    ).toBe(true);
    expect(textOf(editor)).toBe("Keep this. the old longer phrasing words here.");
    // The suggestion record is not destroyed by a delete that never contained it.
    expect(deleted).toEqual([]);
  });

  it("clipping the HEAD: `from` stays put, `to` is pulled back to the restored original's start", async () => {
    const editor = mountDoc(appliedSpanDoc());
    const ref = { current: editor as Editor | null };
    // Select "this. NEW" → [6, 15).
    expect(editor.state.doc.textBetween(6, 15)).toBe("this. NEW");
    const settlement = await settleRangeCardObligations(
      editor,
      6,
      15,
      revertingOps(ref, "OLD"),
    );
    expect(settlement).not.toBeNull();
    expect(editor.state.doc.textBetween(settlement!.from, settlement!.to)).toBe("this. ");
    commitRangeDelete(editor, settlement!.from, settlement!.to, recordingLifecycle([]));
    expect(textOf(editor)).toBe("Keep OLD tail words here.");
  });

  it("a range CONTAINING the span still deletes the whole restored original (unchanged)", async () => {
    const editor = mountDoc(appliedSpanDoc());
    const ref = { current: editor as Editor | null };
    const settlement = await settleRangeCardObligations(
      editor,
      6,
      28,
      revertingOps(ref, "the old longer phrasing"),
    );
    commitRangeDelete(editor, settlement!.from, settlement!.to, recordingLifecycle([]));
    expect(textOf(editor)).toBe("Keep  words here.");
  });
});

describe("task 897 — clipping a note's anchor does not delete the note", () => {
  function noteDoc(): JSONContent[] {
    return [
      {
        type: "paragraph",
        attrs: { uuid: "p-note" },
        content: [
          { type: "text", text: "Plain lead. " },
          {
            type: "text",
            text: "noted passage here",
            marks: [
              {
                type: "linkedAnchor",
                attrs: { anchorId: "anchor-note", linkCard: linkCardKey("note", "note-1") },
              },
            ],
          },
          { type: "text", text: " after." },
        ],
      },
    ];
  }
  // "Plain lead. " = 12 chars → the noted span is [13, 31).

  it("a selection CLIPPING the anchor keeps the card; the mark simply shrinks", async () => {
    const editor = mountDoc(noteDoc());
    expect(editor.state.doc.textBetween(27, 38)).toBe("here after.");
    expect(collectRangeCardTargets(editor.state.doc, 27, 38)).toEqual([]);
    expect(collectRangeCardTargets(editor.state.doc, 27, 38, "touched")).toEqual([
      { kind: "note", id: "note-1" },
    ]);
    const deleted: string[] = [];
    expect(commitRangeDelete(editor, 27, 38, recordingLifecycle(deleted))).toBe(true);
    expect(deleted).toEqual([]);
    const marked: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.attrs.anchorId === "anchor-note")) {
        marked.push(node.text ?? "");
      }
    });
    expect(marked.join("")).toBe("noted passage ");
  });

  it("a selection wholly CONTAINING the anchor still deletes the card", () => {
    const editor = mountDoc(noteDoc());
    const deleted: string[] = [];
    expect(commitRangeDelete(editor, 10, 35, recordingLifecycle(deleted))).toBe(true);
    expect(deleted).toEqual(["note-1"]);
  });
});
