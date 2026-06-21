// @vitest-environment jsdom
//
// CHIP V-a / V (big fix) — characterizes MarginaliaAnchorGuard's anchored-block
// re-insertion AND the LIFECYCLE_DELETE_META bypass that fixes the
// "anchored block won't archive/delete" data-loss defect
// (MEMO_ACTION_ALIGNMENT.md, Known defects).
//
// BACKGROUND (the defect): a `tr.delete` over a whole paragraph (the exact
// mutation the archive/delete dispatcher performs) silently leaves the
// paragraph behind — resurrected as an EMPTY paragraph carrying the same uuid —
// when that paragraph's uuid is ANCHORED (i.e. a card points at it, so its uuid
// is in the shared `anchoredUuidsRef` margin-marker set). It is NOT triggered by
// inline math. The CHIP-V reporter conflated the two because the sample's math
// paragraph (3311) ALSO has a cutter card anchored to it (cutter.json links
// textObjectIds:["3311"]), while the plain control (1102) has no card.
//
// MECHANISM: MarginaliaAnchorGuard (src/lib/tiptap/linked-anchor.ts) runs an
// `appendTransaction` that, when a uuid-bearing block vanishes AND its uuid is
// in `anchoredUuidsRef`, re-inserts an empty paragraph with the SAME uuid at the
// deletion site (so the card's Mode-A `textObjectIds` anchor stays valid). The
// block "survives" empty, so the lifecycle action looks like a no-op. The guard
// keys ONLY on the uuid being anchored — never on node content, so inline math
// (or any atom) is irrelevant.
//
// THE FIX: the archive/delete dispatcher tags its `tr.delete` with
// `LIFECYCLE_DELETE_META`; MarginaliaAnchorGuard early-returns on any
// transaction carrying that meta. A DELIBERATE lifecycle removal is the one case
// where the guard's "preserve the uuid" contract should NOT apply. An incidental
// `tr.delete` (no meta) MUST still resurrect — that's the guard's legitimate job.
//
// The matrix below drives the REAL buildEditorExtensions("main") stack and now
// toggles THREE independent variables — (has inline math?) × (uuid anchored?) ×
// (delete tagged with LIFECYCLE_DELETE_META?). Results:
//   - un-anchored                       → clean delete (math or plain).
//   - anchored, NO meta (incidental)    → resurrected-empty (math or plain) — the
//                                          guard's legitimate preserve behavior.
//   - anchored, WITH meta (lifecycle)   → clean delete — the fix; not over-broad.
// Math drops out as a factor entirely.
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
import { LIFECYCLE_DELETE_META } from "@/lib/tiptap/linked-anchor";

const TARGET_UUID = "t0001";

function mainCtx(anchored: Set<string>): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    // The margin-marker set MarginaliaAnchorGuard reads. Decided at mount time.
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
 *  - `hasMath`   : target paragraph carries an inlineMath atom (vs plain text).
 *  - `anchored`  : target uuid is in the margin-marker set (a card points at it).
 *  - `lifecycle` : tag the delete tr with LIFECYCLE_DELETE_META, exactly as the
 *                  archive/delete dispatcher does. When false the delete is an
 *                  "incidental" edit (an unrelated edit that happens to remove an
 *                  anchored block) and the guard SHOULD still resurrect.
 */
function deleteTarget(
  hasMath: boolean,
  anchored: boolean,
  lifecycle: boolean = false,
): {
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
  let tr = editor.state.tr.delete(pos, pos + size);
  if (lifecycle) tr = tr.setMeta(LIFECYCLE_DELETE_META, true);
  editor.view.dispatch(tr);
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

describe("anchored-block delete re-insertion + LIFECYCLE_DELETE_META bypass", () => {
  // ── Un-anchored controls: always a clean delete, meta irrelevant. ──
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

  // ── Anchored, NO meta (incidental edit): the guard's legitimate job —
  //    resurrect the empty placeholder so the card's anchor stays valid.
  //    This must NOT change after the fix (proves we didn't over-broaden). ──
  it("GUARD — ANCHORED math paragraph, incidental delete (no meta), is resurrected empty", () => {
    const r = deleteTarget(true, true, /* lifecycle */ false);
    // No net block removed — the guard re-inserted an empty placeholder.
    expect(r.childCountAfter).toBe(r.childCountBefore);
    expect(r.state).toBe("empty");
  });

  it("GUARD — math is irrelevant: ANCHORED PLAIN paragraph, incidental delete, is ALSO resurrected empty", () => {
    const r = deleteTarget(false, true, /* lifecycle */ false);
    expect(r.childCountAfter).toBe(r.childCountBefore);
    expect(r.state).toBe("empty");
  });

  // ── Anchored, WITH LIFECYCLE_DELETE_META (the archive/delete path): the FIX.
  //    A deliberate removal now deletes cleanly — no empty placeholder. ──
  it("FIX — ANCHORED math paragraph, lifecycle delete (meta tagged), deletes cleanly", () => {
    const r = deleteTarget(true, true, /* lifecycle */ true);
    expect(r.childCountAfter).toBe(r.childCountBefore - 1);
    expect(r.state).toBe("absent");
  });

  it("FIX — math is irrelevant: ANCHORED PLAIN paragraph, lifecycle delete, deletes cleanly", () => {
    const r = deleteTarget(false, true, /* lifecycle */ true);
    expect(r.childCountAfter).toBe(r.childCountBefore - 1);
    expect(r.state).toBe("absent");
  });
});
