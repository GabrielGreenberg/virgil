// @vitest-environment jsdom
//
// CHIP V-a — root-cause repro for the "math paragraph won't archive/delete"
// defect (MEMO_ACTION_ALIGNMENT.md, Known defects).
//
// CLAIM PROVEN: a `tr.delete` over a whole paragraph (the exact mutation the
// archive/delete dispatcher performs) silently leaves the paragraph behind —
// resurrected as an EMPTY paragraph carrying the same uuid — when that
// paragraph's uuid is ANCHORED (i.e. a card points at it, so its uuid is in the
// shared `anchoredUuidsRef` gutter-marker set). It is NOT triggered by inline
// math. The CHIP-V reporter conflated the two because the sample's math
// paragraph (3311) ALSO has a cutter card anchored to it (cutter.json links
// textObjectIds:["3311"]), while the plain control (1102) has no card.
//
// MECHANISM: MarginaliaAnchorGuard (src/lib/tiptap/linked-anchor.ts:205-299)
// runs an `appendTransaction` that, when a uuid-bearing block vanishes AND its
// uuid is in `anchoredUuidsRef`, re-inserts an empty paragraph with the SAME
// uuid at the deletion site (so the card's Mode-A `textObjectIds` anchor stays
// valid). The block "survives" empty, so the lifecycle action looks like a
// no-op. The guard keys ONLY on the uuid being anchored — never on node content,
// so inline math (or any atom) is irrelevant.
//
// The 2×2 matrix below drives the REAL buildEditorExtensions("main") stack and
// toggles the two independent variables — (has inline math?) × (uuid anchored?).
// Result: anchored → resurrected-empty for BOTH math and plain; un-anchored →
// clean delete for both. Math drops out as a factor entirely.
//
// (The storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

const TARGET_UUID = "t0001";

function mainCtx(anchored: Set<string>): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    // The gutter-marker set MarginaliaAnchorGuard reads. Decided at mount time.
    anchoredUuidsRef: { current: anchored },
    host: null,
  };
}

type BlockState = "absent" | "empty" | "has-content";

/**
 * Mount the real main stack, delete the whole TARGET paragraph with a
 * `tr.delete(pos, pos+nodeSize)` (the dispatcher's exact step), and report
 * whether the target uuid survives — and if so, whether empty.
 *
 *  - `hasMath`  : target paragraph carries an inlineMath atom (vs plain text).
 *  - `anchored` : target uuid is in the gutter-marker set (a card points at it).
 */
function deleteTarget(hasMath: boolean, anchored: boolean): {
  childCountBefore: number;
  childCountAfter: number;
  state: BlockState;
} {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const content = hasMath
    ? [
        { type: "text", text: "the surface is roughly " },
        { type: "inlineMath", attrs: { latex: "T + \\alpha A" } },
        { type: "text", text: " in practice." },
      ]
    : [{ type: "text", text: "a plain control paragraph." }];

  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(
      mainCtx(anchored ? new Set([TARGET_UUID]) : new Set()),
    ),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: TARGET_UUID }, content },
        // A tail block keeps the doc non-empty after the delete.
        {
          type: "paragraph",
          attrs: { uuid: "tail00" },
          content: [{ type: "text", text: "tail." }],
        },
      ],
    },
  });

  // Locate the target block and delete its whole node range.
  let pos = -1;
  let size = 0;
  editor.state.doc.descendants((node, p) => {
    if (node.attrs?.uuid === TARGET_UUID) {
      pos = p;
      size = node.nodeSize;
      return false;
    }
    return true;
  });
  const childCountBefore = editor.state.doc.childCount;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + size));
  const childCountAfter = editor.state.doc.childCount;

  let state: BlockState = "absent";
  editor.state.doc.descendants((node) => {
    if (node.attrs?.uuid === TARGET_UUID) {
      state = node.content.size === 0 ? "empty" : "has-content";
    }
    return true;
  });

  editor.destroy();
  element.remove();
  return { childCountBefore, childCountAfter, state };
}

describe("anchored-block delete re-insertion (CHIP V-a root cause)", () => {
  it("CONTROL — un-anchored MATH paragraph deletes cleanly", () => {
    const r = deleteTarget(/* hasMath */ true, /* anchored */ false);
    expect(r.childCountAfter).toBe(r.childCountBefore - 1);
    expect(r.state).toBe("absent");
  });

  it("CONTROL — un-anchored PLAIN paragraph deletes cleanly", () => {
    const r = deleteTarget(false, false);
    expect(r.childCountAfter).toBe(r.childCountBefore - 1);
    expect(r.state).toBe("absent");
  });

  it("DEFECT — ANCHORED math paragraph is resurrected as an empty paragraph (same uuid)", () => {
    const r = deleteTarget(true, true);
    // No net block removed — the guard re-inserted an empty placeholder.
    expect(r.childCountAfter).toBe(r.childCountBefore);
    expect(r.state).toBe("empty");
  });

  it("PROOF math is irrelevant — ANCHORED PLAIN paragraph is ALSO resurrected empty", () => {
    const r = deleteTarget(false, true);
    expect(r.childCountAfter).toBe(r.childCountBefore);
    expect(r.state).toBe("empty");
  });
});
