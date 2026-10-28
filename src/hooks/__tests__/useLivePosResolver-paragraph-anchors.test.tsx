// @vitest-environment jsdom
//
// Core regression guard for the "note cards drift/stack at the top of the right
// gutter while typing" bug. The cause: PARAGRAPH-anchored Omni cards
// (note/todo/cutter/revision/report/archive) were positioned by a BAKED
// `findParagraphPos` value that only refreshed on a STRUCTURAL items rebuild, so
// it went stale under plain typing — and the cascade clamps a stale (above-pod)
// result to the top. Footnotes/citations/examples never had this bug because
// they resolve a LIVE pos from the DocStructureObserver snapshot.
//
// The fix extends that same live engine to paragraph-anchored cards via
// `anchorUuid` → `structure.blocks.get(uuid).pos`. This test proves the live
// resolver returns the block's CURRENT position and TRACKS an upstream edit
// (exactly the divergence demonstrated live on the running app: a 40-char
// upstream insert shifted the anchor 739 → 779 while the baked pos stayed 739).
//
// The storage stub guards the extension-barrel/@/lib/storage resolver gotcha.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { renderHook, act } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import {
  useLivePosResolver,
  buildParagraphAnchorMap,
} from "@/hooks/useLivePosResolver";
import { cardPopKey } from "@/panels/panel-registry";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function mountThreeDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: "The first paragraph." }] },
        { type: "paragraph", attrs: { uuid: "P2" }, content: [{ type: "text", text: "The second paragraph." }] },
        { type: "paragraph", attrs: { uuid: "P3" }, content: [{ type: "text", text: "The third paragraph." }] },
      ],
    },
  });
}

describe("buildParagraphAnchorMap", () => {
  it("maps only items that carry an anchorUuid (skips free/entity-anchored)", () => {
    const m = buildParagraphAnchorMap([
      { id: "note:a", anchorUuid: "P1" },
      { id: "note:b" }, // free → excluded
      { id: "todo:c", anchorUuid: "P3" },
    ]);
    expect([...m.entries()]).toEqual([
      ["note:a", { uuid: "P1" }],
      ["todo:c", { uuid: "P3" }],
    ]);
  });

  it("carries a span item's anchorId (task 1334)", () => {
    const m = buildParagraphAnchorMap([{ id: "note:s", anchorUuid: "P2", anchorId: "A1" }]);
    expect(m.get("note:s")).toEqual({ uuid: "P2", anchorId: "A1" });
  });
});

describe("useLivePosResolver — paragraph-anchored cards track live", () => {
  it("resolves a paragraph-anchored omni id to its block's LIVE pos and tracks an upstream edit", () => {
    const editor = mountThreeDoc();
    const bus = getBus(editor)!;
    expect(bus).toBeTruthy();

    // Prime the bus structure snapshot with one transaction that does NOT shift
    // P3's start position (append a char at the very end, inside P3).
    act(() => {
      editor.view.dispatch(
        editor.state.tr.insertText(".", editor.state.doc.content.size - 1),
      );
    });

    const noteId = cardPopKey("note", "n1");
    const anchors = new Map([[noteId, { uuid: "P3" }]]);
    const { result } = renderHook(() =>
      useLivePosResolver(editor, cardPopKey, anchors),
    );

    const liveBlockPos = () => bus.structure.blocks.get("P3")?.pos;

    // Baseline: the resolver returns P3's live block position (a real number).
    const before = result.current(noteId);
    expect(typeof before).toBe("number");
    expect(before).toBe(liveBlockPos());

    // An entity id NOT in the snapshot (no footnote, no anchor) → undefined, so
    // the caller falls back to the baked pos / orphan binning.
    expect(result.current(cardPopKey("note", "does-not-exist"))).toBeUndefined();

    // Upstream edit: insert 30 chars inside P1 → P3 shifts DOWN by 30.
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("x".repeat(30), 1));
    });

    const after = result.current(noteId);
    // The live resolver TRACKS the shift (this is the whole fix); the baked pos
    // would have stayed at `before` and clamped the card to the top.
    expect(after).toBe(liveBlockPos());
    expect(after).toBe((before as number) + 30);

    editor.destroy();
  });

  it("returns undefined for an anchor uuid no longer in the doc (deleted paragraph)", () => {
    const editor = mountThreeDoc();
    const bus = getBus(editor)!;
    act(() => {
      editor.view.dispatch(
        editor.state.tr.insertText(".", editor.state.doc.content.size - 1),
      );
    });
    // Anchor a card to a uuid that isn't in the doc.
    const ghostId = cardPopKey("todo", "ghost");
    const anchors = new Map([[ghostId, { uuid: "P-DEAD" }]]);
    const { result } = renderHook(() =>
      useLivePosResolver(editor, cardPopKey, anchors),
    );
    expect(bus.structure.blocks.has("P-DEAD")).toBe(false);
    expect(result.current(ghostId)).toBeUndefined();
    editor.destroy();
  });
});

// Task 1334 — a SPAN-anchored (Mode-B) card resolves to its words, not to its
// paragraph's top; a whole-paragraph card is unchanged; a dead mark falls back.
describe("useLivePosResolver — span-anchored cards sit at their span", () => {
  function mountSpanDoc(): Editor {
    const element = document.createElement("div");
    document.body.appendChild(element);
    return new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: "First." }] },
          {
            type: "paragraph",
            attrs: { uuid: "P2" },
            content: [
              { type: "text", text: "The start of it, then " },
              {
                type: "text",
                text: "the marked words",
                marks: [{ type: "linkedAnchor", attrs: { anchorId: "A1", linkCard: "note" } }],
              },
              { type: "text", text: " and the rest." },
            ],
          },
        ],
      },
    });
  }

  it("resolves a Mode-B row to the span's live from, a Mode-A row to the block, and tracks an upstream edit", () => {
    const editor = mountSpanDoc();
    const bus = getBus(editor)!;
    const spanId = cardPopKey("note", "span");
    const blockId = cardPopKey("note", "block");
    const anchors = new Map([
      [spanId, { uuid: "P2", anchorId: "A1" }],
      [blockId, { uuid: "P2" }],
    ]);
    const { result } = renderHook(() => useLivePosResolver(editor, cardPopKey, anchors));

    const block = bus.structure.blocks.get("P2")!.pos;
    const from = bus.structure.anchors.get("A1")!.from;
    expect(from).toBeGreaterThan(block + 1);
    expect(result.current(blockId)).toBe(block);
    expect(result.current(spanId)).toBe(from);

    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("xxxxx", 1));
    });
    expect(result.current(spanId)).toBe(from + 5);
    expect(result.current(blockId)).toBe(block + 5);
    editor.destroy();
  });

  it("falls back to the block top when the span's mark has died", () => {
    const editor = mountSpanDoc();
    const bus = getBus(editor)!;
    const spanId = cardPopKey("note", "span");
    const anchors = new Map([[spanId, { uuid: "P2", anchorId: "A1" }]]);
    const { result } = renderHook(() => useLivePosResolver(editor, cardPopKey, anchors));
    act(() => {
      const { doc, schema } = editor.state;
      editor.view.dispatch(editor.state.tr.removeMark(0, doc.content.size, schema.marks.linkedAnchor));
    });
    expect(bus.structure.anchors.has("A1")).toBe(false);
    expect(result.current(spanId)).toBe(bus.structure.blocks.get("P2")!.pos);
    editor.destroy();
  });
});
