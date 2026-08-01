// @vitest-environment jsdom
//
// Task 265 — end-to-end pin (the sub-view twin of task 247's
// `split-block-survivor-structure.test.ts`): a mid-HEADING Enter split must
// leave the KEPT heading present in `structure.headings`.
//
// THE BUG: `splitBlock` on a heading empirically yields TWO heading nodes that
// transiently share one uuid (`uuid` has no `keepOnSplit: false`).
// `BlockUuidBackfill` then re-mints the CLONE via `tr.setNodeMarkup(pos,
// undefined, { …, uuid: fresh })` — a heading is a non-leaf node, so that emits
// a ReplaceAroundStep, whose range walk swept the clone's OLD (duplicate) uuid
// into `removed.headings`. Task 247 guarded the generic `removedBlocks`
// reconciler but NOT the anchorable-block SUB-VIEWS: the heading reconciler had
// only a `!added.headings.has(uuid)` short-circuit, which never fires for a
// re-mint (added = newUuid, removed = oldUuid — different keys). So the surviving
// heading uuid was pushed to `removedHeadings` and `applyDiff` spliced it out of
// the canonical `structure.headings` index, firing a spurious `onHeadingsRemoved`
// (which desyncs Focus-mode section boundaries + the omni fold-mirror until a
// full reload).
//
// THE FIX (step-inspector.ts): the shared `uuidSurvivesRemoval` guard now gates
// all three anchorable-block sub-view removed-reconcilers (headings/figures/
// examples), exactly as the block path does — a uuid still live in `newDoc` is
// never reported removed.
//
// This drives the REAL `buildEditorExtensions("main")` stack (DocStructureObserver
// first, then BlockUuidBackfill) — the exact assertion the audit probe failed:
// before = [h0001]; buggy after = [<re-minted clone only>]; fixed after must
// contain h0001.
//
// (The storage stub guards the extension-barrel/@/lib/storage gotcha — the
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
import { readDocStructure } from "@/lib/tiptap/doc-structure";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

/** Every live heading uuid in the doc, in document order. */
function liveHeadingUuids(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === "heading") {
      const u = (n.attrs.uuid as string | null) ?? null;
      if (u) out.push(u);
    }
    return true;
  });
  return out;
}

describe("mid-heading split keeps the kept heading in structure.headings (task 265)", () => {
  it("splitBlock on a heading leaves the kept heading uuid present in readDocStructure().headings", () => {
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
            attrs: { uuid: "h0001", level: 1 },
            content: [{ type: "text", text: "helloworld" }],
          },
          {
            type: "paragraph",
            attrs: { uuid: "p0002" },
            content: [{ type: "text", text: "second" }],
          },
        ],
      },
    });

    // Pre-condition: the heading is indexed before the split.
    const before = readDocStructure(editor.state).headings.map((h) => h.uuid);
    expect(before).toContain("h0001");

    // Caret mid heading ("hello|world" → pos 6: +1 opening token, +5 chars),
    // then split. BlockUuidBackfill re-mints the cloned (after) half.
    editor.chain().setTextSelection(6).splitBlock().run();

    // The kept heading h0001 must still be live in the document.
    const live = liveHeadingUuids(editor);
    expect(live).toContain("h0001");

    // THE ASSERTION the bug failed: the canonical heading index must still
    // contain the kept heading uuid h0001 (before the fix it held only the
    // re-minted clone).
    const after = readDocStructure(editor.state).headings.map((h) => h.uuid);
    expect(after, "structure.headings dropped the kept heading h0001").toContain("h0001");
    // And every live heading uuid must be indexed — no live heading left out.
    for (const uuid of live) {
      expect(after, `structure.headings is missing live heading ${uuid}`).toContain(uuid);
    }

    editor.destroy();
    element.remove();
  });
});
