// @vitest-environment jsdom
//
// Task 247 — end-to-end pin: a mid-paragraph Enter split must leave the KEPT
// half present in `structure.blocks`.
//
// THE BUG: TipTap's `splitBlock` copies the paragraph's attrs to the new
// (after) half — `uuid` has no `keepOnSplit: false`, so both halves transiently
// share one uuid. `BlockUuidBackfill` then re-mints the CLONE via
// `tr.setNodeMarkup(pos, undefined, { …, uuid: fresh })`. A paragraph is a
// non-leaf node, so setNodeMarkup emits a ReplaceAroundStep (NOT an AttrStep),
// whose range-walk swept the clone's OLD (duplicate) uuid into `removed.blocks`.
// The Replace* reconciler pushed it to `removedBlocks` with no survivor check,
// so `applyDiff` did `blocks.delete(keptUuid)` — dropping the still-live kept
// half from the canonical `structure.blocks` index and firing a spurious
// `onBlocksRemoved`. Every position-keyed consumer (cards anchored to the kept
// paragraph, in-text positions, marginalia) then rides a stale/orphaned anchor.
//
// THE FIX (step-inspector.ts): the block-survivor guard `oldUuidSurvivesInNewDoc`
// — previously stranded in the unreachable AttrStep branch — now also gates the
// reachable Replace* block reconciler, so a uuid that still lives in `newDoc` is
// never reported removed.
//
// This drives the REAL `buildEditorExtensions("main")` stack (DocStructureObserver
// first, then BlockUuidBackfill) — the exact assertion the scratch repro failed:
// after the split, EVERY live anchorable uuid must be in
// `readDocStructure(editor.state).blocks`.
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

/** Every paragraph/heading uuid live in the doc, in document order. */
function liveBlockUuids(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === "paragraph" || n.type.name === "heading") {
      const u = (n.attrs.uuid as string | null) ?? null;
      if (u) out.push(u);
    }
    return true;
  });
  return out;
}

describe("mid-paragraph split keeps the kept-half block in structure.blocks (task 247)", () => {
  it("splitBlock leaves EVERY live anchorable uuid present in readDocStructure().blocks", () => {
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
            type: "paragraph",
            attrs: { uuid: "p0001" },
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

    // Pre-condition: both blocks are indexed before the split.
    const before = readDocStructure(editor.state).blocks;
    expect(before.has("p0001")).toBe(true);
    expect(before.has("p0002")).toBe(true);

    // Caret mid first paragraph ("hello|world" → pos 6: +1 opening token, +5
    // chars) then split. BlockUuidBackfill re-mints the cloned (after) half.
    editor.chain().setTextSelection(6).splitBlock().run();

    // The doc now holds THREE anchorable blocks: p0001 (kept), a fresh uuid
    // (the re-minted after-half), and p0002.
    const live = liveBlockUuids(editor);
    expect(live).toContain("p0001");
    expect(live).toContain("p0002");
    expect(live.length).toBe(3);

    // THE ASSERTION the bug failed: the canonical structure index must contain
    // EVERY live anchorable uuid — the kept half p0001 above all.
    const after = readDocStructure(editor.state).blocks;
    for (const uuid of live) {
      expect(after.has(uuid), `structure.blocks is missing live uuid ${uuid}`).toBe(true);
    }

    editor.destroy();
    element.remove();
  });
});
