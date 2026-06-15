// @vitest-environment jsdom
//
// F2 (data-loss bug, docs/memos/action-alignment-matrix/FINDINGS.md): deleting
// or archiving a paragraph that is IMMEDIATELY FOLLOWED by a `graphicsBlock`
// silently removed the graphicsBlock TOO. A `figureBlock` survived — but only
// incidentally (the demo paragraph above it carried no atom to clean up).
//
// ROOT CAUSE (confirmed live): the Delete / Archive dispatcher computes the
// deletion range `[from, to)`, then runs `cleanupLinksInRange`, whose citation /
// footnote card-lifecycle `delete` SYNCHRONOUSLY dispatches a doc transaction
// that strips the inline atom from the range. That shrinks the targeted block,
// so the originally-computed `to` (== the block's end == the next sibling's
// start) goes stale and over-reaches by the removed size into the next sibling.
// A size-1 block atom (graphicsBlock / displayMath / texBlock) is swallowed
// whole. The fix (`cleanupAndComputeDeleteRange`) runs the cleanup and corrects
// `to` by the doc-size delta, so the delete lands on exactly the targeted block.
//
// This test drives the REAL buildEditorExtensions("main") stack plus the REAL
// `cleanupAndComputeDeleteRange`, with a stub CardLifecycle whose citation
// `delete` removes the `\cite` atom from the doc — exactly what the live
// citation lifecycle (`deleteCitation` → `deleteLink`) does. It then performs
// the dispatcher's `tr.delete(range).setMeta(LIFECYCLE_DELETE_META)` and asserts
// the trailing block SURVIVES.
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
import {
  cleanupAndComputeDeleteRange,
  cleanupLinksInRange,
} from "@/text-objects/delete-range";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";

const PARA_UUID = "para00";
const BLOCK_UUID = "blk000";
const CITE_ID = "cit001";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

type BlockKind = "graphicsBlock" | "figureBlock";

function blockJSON(kind: BlockKind) {
  if (kind === "graphicsBlock") {
    return {
      type: "graphicsBlock",
      attrs: {
        uuid: BLOCK_UUID,
        command: "\\includegraphics[width=0.5\\textwidth]{plot.png}",
        source: "plot.png",
        widthPercent: 50,
      },
    };
  }
  return {
    type: "figureBlock",
    attrs: {
      uuid: BLOCK_UUID,
      extras: "\\centering\n\\includegraphics[width=0.5\\textwidth]{plot.png}",
      label: "fig:plot",
    },
    content: [
      { type: "figureCaption", content: [{ type: "text", text: "A plot." }] },
    ],
  };
}

/**
 * A CardLifecycleApi whose citation `delete` mirrors the live
 * `deleteCitation` → `deleteLink`: it finds the `\cite` atom carrying this id
 * in the doc and dispatches a transaction that removes it. Every other kind is
 * a no-op. This is the synchronous mid-flight doc mutation that made the
 * pre-fix delete range go stale.
 */
function citationStrippingLifecycle(editor: Editor): CardLifecycleApi {
  return {
    get(kind) {
      if (kind !== "citation") return null;
      return {
        delete(id: string) {
          let atomPos = -1;
          let atomSize = 0;
          editor.state.doc.descendants((node, pos) => {
            if (
              node.type.name === "citation" &&
              node.attrs?.citationId === id
            ) {
              atomPos = pos;
              atomSize = node.nodeSize;
              return false;
            }
            return true;
          });
          if (atomPos >= 0) {
            editor.view.dispatch(
              editor.state.tr.delete(atomPos, atomPos + atomSize),
            );
          }
        },
        clone() {
          return null;
        },
        bindAnchor() {},
      };
    },
  } as CardLifecycleApi;
}

/**
 * Reproduce the dispatcher's Delete path on a doc that mirrors the live repro:
 *
 *   heading("When the address fails")
 *   paragraph(uuid PARA_UUID, text + a \cite citation atom)   ← deleted
 *   <block>(uuid BLOCK_UUID)                                  ← must survive
 *   heading("The Reader as Annotator")
 *   tail paragraph
 *
 * Runs `cleanupAndComputeDeleteRange` (which fires the citation lifecycle's
 * atom-stripping tx), then `tr.delete(range).setMeta(LIFECYCLE_DELETE_META)` —
 * the exact two steps the dispatcher performs — and reports whether the block
 * survives.
 */
function runDeletePath(
  kind: BlockKind,
  variant: "fixed" | "old-buggy" = "fixed",
): {
  childCountBefore: number;
  childCountAfter: number;
  blockSurvives: boolean;
} {
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
          type: "heading",
          attrs: { level: 2, uuid: "head00" },
          content: [{ type: "text", text: "When the address fails" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: PARA_UUID },
          content: [
            { type: "text", text: "Sometimes the address fails. A citation like " },
            {
              type: "citation",
              attrs: {
                command: "\\cite{nonexistent2026}",
                displayText: "[?]",
                citationId: CITE_ID,
              },
            },
            { type: "text", text: " that points to a missing key." },
          ],
        },
        blockJSON(kind),
        {
          type: "heading",
          attrs: { level: 1, uuid: "head01" },
          content: [{ type: "text", text: "The Reader as Annotator" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "tail00" },
          content: [{ type: "text", text: "tail." }],
        },
      ],
    },
  });

  // Locate the leading paragraph's outer node range (what `outerRangeFor` +
  // `expandCascadeRange` resolve to for a top-level paragraph).
  let pos = -1;
  let size = 0;
  editor.state.doc.descendants((node, p) => {
    if (node.attrs?.uuid === PARA_UUID) {
      pos = p;
      size = node.nodeSize;
      return false;
    }
    return true;
  });
  const outer = { from: pos, to: pos + size };

  const childCountBefore = editor.state.doc.childCount;

  const lifecycle = citationStrippingLifecycle(editor);
  let delRange: { from: number; to: number };
  if (variant === "fixed") {
    // The exact dispatcher sequence (post-fix): cleanup + range-correct, then
    // the lifecycle-tagged delete.
    delRange = cleanupAndComputeDeleteRange(
      editor,
      outer.from,
      outer.to,
      lifecycle,
    );
  } else {
    // The OLD buggy sequence: cleanup mutates the doc, but the delete reuses
    // the stale pre-cleanup range — over-reaching into the next sibling.
    cleanupLinksInRange(editor.state.doc, outer.from, outer.to, lifecycle);
    delRange = outer;
  }
  editor.view.dispatch(
    editor.state.tr.delete(delRange.from, delRange.to).setMeta(
      LIFECYCLE_DELETE_META,
      true,
    ),
  );

  const childCountAfter = editor.state.doc.childCount;
  let blockSurvives = false;
  editor.state.doc.descendants((node) => {
    if (node.attrs?.uuid === BLOCK_UUID && node.type.name === kind) {
      blockSurvives = true;
    }
    return true;
  });

  editor.destroy();
  element.remove();
  return { childCountBefore, childCountAfter, blockSurvives };
}

describe("F2 — deleting an atom-bearing paragraph must NOT take its trailing block with it", () => {
  it("graphicsBlock after the deleted paragraph SURVIVES (the reported bug)", () => {
    const r = runDeletePath("graphicsBlock");
    expect(r.blockSurvives).toBe(true);
    // exactly one block removed (the paragraph) — childCount drops by 1, not 2.
    expect(r.childCountAfter).toBe(r.childCountBefore - 1);
  });

  it("figureBlock after the deleted paragraph SURVIVES (same class, no longer incidental)", () => {
    const r = runDeletePath("figureBlock");
    expect(r.blockSurvives).toBe(true);
    expect(r.childCountAfter).toBe(r.childCountBefore - 1);
  });

  // Characterization: prove the test genuinely exercises the defect. The OLD
  // sequence (cleanup with the stale range) DOES swallow the graphicsBlock —
  // childCount drops by 2 and the block is gone. This is what the fix prevents.
  it("characterizes the OLD bug — stale-range delete swallowed the graphicsBlock", () => {
    const r = runDeletePath("graphicsBlock", "old-buggy");
    expect(r.blockSurvives).toBe(false);
    expect(r.childCountAfter).toBe(r.childCountBefore - 2);
  });
});
