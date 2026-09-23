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
//   • ONE CORRECTION. A settlement's `revert` splices the pre-suggestion
//     original back over the applied text, and the original may be LONGER than
//     what replaced it. The F2 arithmetic only ever subtracted, so a growing
//     settle would have left `to` short and clipped the delete. The shared
//     `correctRangeForInnerDelta` handles both directions.

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
  correctRangeForInnerDelta,
  settleRangeCardObligations,
} from "../delete-range";
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

describe("correctRangeForInnerDelta — both directions", () => {
  it("SHRINKS `to` when the gesture removed content inside the range (the F2 case)", () => {
    expect(correctRangeForInnerDelta(4, 40, -3, 100)).toEqual({ from: 4, to: 37 });
  });

  it("GROWS `to` when a revert restored a LONGER original (task 636)", () => {
    // The pre-636 arithmetic clamped the delta at zero, so this case silently
    // left `to` short and the delete clipped the restored text's tail.
    expect(correctRangeForInnerDelta(4, 40, 7, 100)).toEqual({ from: 4, to: 47 });
  });

  it("never collapses past `from`, and never runs off the end of the doc", () => {
    expect(correctRangeForInnerDelta(4, 10, -99, 100)).toEqual({ from: 4, to: 4 });
    expect(correctRangeForInnerDelta(4, 40, 999, 50)).toEqual({ from: 4, to: 50 });
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
