// @vitest-environment jsdom
//
// Task 285 — the DEFECT leg. The Outline's two remaining position-addressed
// mutators (reorder, scroll) now name their target by durable block identity,
// so a concurrent write landing between the outline's snapshot and the user's
// gesture can no longer make the drop rearrange the wrong section.
//
// These drive the REAL `useEditorOps` handlers against a REAL ProseMirror
// document, and the shape of every leg is the same: capture the addresses the
// outline would have captured, apply a concurrent structural write, THEN fire
// the handler. The pre-fix handlers took `(fromIndex, count, toIndex)` /
// `(blockIndex)`, so on this doc they are re-expressible as the raw integers
// the addresses carry — which the canary legs assert would have moved the
// wrong blocks. A test against an UNCHANGED document proves nothing here: the
// two addressing models agree there by construction.

import { describe, it, expect, vi } from "vitest";

// `editor-ops` transitively imports `@/lib/storage`, whose `require("@/...")`
// backend select vitest's aliaser can't resolve (the storage-mock gotcha).
// Nothing here touches disk, so empty stubs are sufficient.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({ bibText: "", detectedPackage: undefined })),
  writeBib: vi.fn(async () => undefined),
}));

import { renderHook } from "@testing-library/react";
import { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { RefObject } from "react";
import { useEditorOps } from "../editor-ops";
import type { EditorHandle } from "@/components/Editor";
import { doc, heading, paragraph, testSchema } from "@/lib/tiptap/doc-structure/__tests__/fixtures";

/**
 * A minimal live editor over a real `EditorState`: `state` is a GETTER, so the
 * handler re-reads the document the same way the real one does, and `dispatch`
 * really applies the transaction. Enough for the transaction math — a full
 * TipTap Editor adds nothing these legs can observe.
 */
function makeEditor(initial: PMNode) {
  let state = EditorState.create({ doc: initial, schema: testSchema });
  const editor = {
    get state() {
      return state;
    },
    view: {
      dispatch: (tr: { doc: PMNode } & object) => {
        state = state.apply(tr as never);
      },
    },
  };
  return {
    editor,
    /** Top-level block uuids, in document order — the assertion surface. */
    order: () => {
      const out: (string | null)[] = [];
      state.doc.forEach((n) => out.push((n.attrs?.uuid as string | null) ?? null));
      return out;
    },
  };
}

function makeOps(initial: PMNode) {
  const live = makeEditor(initial);
  const scrollToHeading = vi.fn();
  const handleRef = {
    current: {
      getEditor: () => live.editor,
      scrollToHeading,
    } as unknown as EditorHandle,
  } as RefObject<EditorHandle | null>;
  const { result } = renderHook(() =>
    useEditorOps({
      editorRef: handleRef,
      setLatestDoc: () => {},
      isLabelTaken: () => false,
    }),
  );
  return { ...live, ops: result.current, scrollToHeading };
}

/**
 * Alpha [0..2] · Beta [3..4] · Gamma [5..6] — three sibling level-1 sections,
 * each a heading plus its body.
 */
function threeSections() {
  return doc(
    heading("h-alpha", 1, "Alpha"),
    paragraph("p-a1", "a1"),
    paragraph("p-a2", "a2"),
    heading("h-beta", 1, "Beta"),
    paragraph("p-b1", "b1"),
    heading("h-gamma", 1, "Gamma"),
    paragraph("p-c1", "c1"),
  );
}

/** The addresses the outline's pods carry for that snapshot. */
const ALPHA = { uuid: "h-alpha", index: 0, section: true };
const BETA = { uuid: "h-beta", index: 3, section: true };
const GAMMA = { uuid: "h-gamma", index: 5, section: true };

/** A concurrent write: two blocks land at the very top of the document. */
function insertTwoBlocksAtTop(live: ReturnType<typeof makeEditor>) {
  const tr = live.editor.state.tr;
  tr.insert(0, [
    testSchema.nodes.paragraph.create({ uuid: "x-1" }, testSchema.text("intruder 1")),
    testSchema.nodes.paragraph.create({ uuid: "x-2" }, testSchema.text("intruder 2")),
  ]);
  live.editor.view.dispatch(tr as never);
}

describe("reorder — the dragged section survives a concurrent insert above it", () => {
  it("moves the section the user grabbed, not the blocks that slid into its index", () => {
    const t = makeOps(threeSections());
    insertTwoBlocksAtTop(t);

    // Drag Gamma above Beta, with the addresses captured BEFORE the insert.
    t.ops.handleReorderBlocks(GAMMA, BETA, "above");

    expect(t.order()).toEqual([
      "x-1",
      "x-2",
      "h-alpha",
      "p-a1",
      "p-a2",
      "h-gamma",
      "p-c1",
      "h-beta",
      "p-b1",
    ]);
  });

  it("CANARY: the pre-285 integer call moves the wrong blocks on the same doc", () => {
    // The old signature was (fromIndex, count, toIndex) = (5, 2, 3) here — the
    // exact integers the addresses carry. Re-expressed against the shifted doc
    // it lifts Alpha's tail and drops it inside Alpha, which is the defect.
    const t = makeOps(threeSections());
    insertTwoBlocksAtTop(t);

    t.ops.handleReorderBlocks(
      { uuid: null, index: 5, section: false },
      { uuid: null, index: 3, section: false },
      "above",
    );

    expect(t.order()).not.toEqual([
      "x-1",
      "x-2",
      "h-alpha",
      "p-a1",
      "p-a2",
      "h-gamma",
      "p-c1",
      "h-beta",
      "p-b1",
    ]);
  });

  it("moves the section as it stands NOW when a block was inserted INSIDE it", () => {
    // The pod's `blockCount` said Alpha was 3 blocks. A concurrent write added
    // a fourth. The user dragged "Alpha", so all four travel — a stale count
    // would have left the newcomer stranded behind.
    const t = makeOps(threeSections());
    const tr = t.editor.state.tr;
    const at = tr.doc.child(0).nodeSize + tr.doc.child(1).nodeSize;
    tr.insert(at, testSchema.nodes.paragraph.create({ uuid: "p-mid" }, testSchema.text("mid")));
    t.editor.view.dispatch(tr as never);

    t.ops.handleReorderBlocks(ALPHA, GAMMA, "below");

    expect(t.order()).toEqual([
      "h-beta",
      "p-b1",
      "h-gamma",
      "p-c1",
      "h-alpha",
      "p-a1",
      "p-mid",
      "p-a2",
    ]);
  });

  it("lands BELOW the target's live section, not its stale extent", () => {
    // Beta grew by one block. "Below Beta" means after the whole section as it
    // stands now; the pre-fix landing index folded in the pod's stale count and
    // would have dropped Alpha in the middle of Beta.
    const t = makeOps(threeSections());
    const tr = t.editor.state.tr;
    let at = 0;
    for (let i = 0; i <= 4; i++) at += tr.doc.child(i).nodeSize;
    tr.insert(at, testSchema.nodes.paragraph.create({ uuid: "p-b2" }, testSchema.text("b2")));
    t.editor.view.dispatch(tr as never);

    t.ops.handleReorderBlocks(ALPHA, BETA, "below");

    expect(t.order()).toEqual([
      "h-beta",
      "p-b1",
      "p-b2",
      "h-alpha",
      "p-a1",
      "p-a2",
      "h-gamma",
      "p-c1",
    ]);
  });

  it("REFUSES when either end was deleted under the drag", () => {
    const t = makeOps(threeSections());
    const tr = t.editor.state.tr;
    // Delete the whole Gamma section.
    let from = 0;
    for (let i = 0; i < 5; i++) from += t.editor.state.doc.child(i).nodeSize;
    tr.delete(from, t.editor.state.doc.content.size);
    t.editor.view.dispatch(tr as never);
    const before = t.order();

    t.ops.handleReorderBlocks(GAMMA, ALPHA, "above");
    expect(t.order()).toEqual(before);

    t.ops.handleReorderBlocks(BETA, GAMMA, "above");
    expect(t.order()).toEqual(before);
  });

  it("still rejects a drop inside the dragged section's own range", () => {
    const t = makeOps(threeSections());
    const before = t.order();
    // "Below" Alpha's own first body paragraph lands at index 2 — inside Alpha.
    t.ops.handleReorderBlocks(ALPHA, { uuid: "p-a1", index: 1, section: false }, "below");
    expect(t.order()).toEqual(before);
  });

  it("moves a single parTitle block without dragging its section along", () => {
    const t = makeOps(threeSections());
    insertTwoBlocksAtTop(t);
    t.ops.handleReorderBlocks({ uuid: "p-c1", index: 6, section: false }, ALPHA, "above");
    expect(t.order()).toEqual([
      "x-1",
      "x-2",
      "p-c1",
      "h-alpha",
      "p-a1",
      "p-a2",
      "h-beta",
      "p-b1",
      "h-gamma",
    ]);
  });
});

describe("scroll — the click lands on the block that was clicked", () => {
  it("resolves the durable address against the shifted document", () => {
    const t = makeOps(threeSections());
    insertTwoBlocksAtTop(t);
    t.ops.handleScrollToHeading({ uuid: "h-gamma", index: 5 });
    // The captured index was 5; the live one is 7.
    expect(t.scrollToHeading).toHaveBeenCalledWith(7);
  });

  it("passes the doc-start sentinel through for the Document-start row", () => {
    const t = makeOps(threeSections());
    t.ops.handleScrollToHeading(null);
    expect(t.scrollToHeading).toHaveBeenCalledWith(-1);
  });

  it("does nothing when the addressed block is gone", () => {
    const t = makeOps(threeSections());
    t.ops.handleScrollToHeading({ uuid: "deleted", index: 5 });
    expect(t.scrollToHeading).not.toHaveBeenCalled();
  });
});
