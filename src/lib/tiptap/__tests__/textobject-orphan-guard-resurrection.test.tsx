// @vitest-environment jsdom
//
// Regression guard for the data-loss bug behind the orphan-sweep: when an
// ANCHORED block is incidentally removed, MarginaliaAnchorGuard resurrects it
// (re-inserts a same-uuid placeholder in the same dispatch). TextObjectOrphanGuard
// used to fire `virgil-textobject-orphaned` for that uuid anyway (it read
// `diff.removedBlocks` before the resurrection ran), and the Mode-A sweep
// (useTodos / useArchive) then PERMANENTLY stripped a still-valid link. The fix
// re-checks liveness against the SETTLED doc in the deferred dispatch, so a
// resurrected uuid emits no event; a genuinely-removed uuid still does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

function mainCtx(anchored: Set<string>): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: anchored },
    host: null,
  };
}

function mountThreeDoc(anchored: Set<string>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(anchored)),
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

function deleteParagraphByUuid(editor: Editor, uuid: string) {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs?.uuid === uuid) {
      from = pos;
      to = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  if (from < 0) throw new Error(`uuid ${uuid} not found`);
  editor.view.dispatch(editor.state.tr.delete(from, to));
}

function liveUuids(editor: Editor): Set<string> {
  const s = new Set<string>();
  editor.state.doc.descendants((n) => {
    if (n.attrs?.uuid) s.add(n.attrs.uuid as string);
    return true;
  });
  return s;
}

const flushMacrotask = () => new Promise((r) => setTimeout(r, 5));

describe("TextObjectOrphanGuard — resurrection awareness", () => {
  let received: string[];
  let handler: (e: Event) => void;
  beforeEach(() => {
    received = [];
    handler = (e: Event) => {
      const uuid = (e as CustomEvent).detail?.uuid;
      if (typeof uuid === "string") received.push(uuid);
    };
    window.addEventListener("virgil-textobject-orphaned", handler);
  });
  afterEach(() => {
    window.removeEventListener("virgil-textobject-orphaned", handler);
  });

  it("does NOT fire the orphan event for an ANCHORED block that MarginaliaAnchorGuard resurrects", async () => {
    const editor = mountThreeDoc(new Set(["P2"])); // P2 is gutter-anchored
    deleteParagraphByUuid(editor, "P2");
    // MarginaliaAnchorGuard re-inserts a same-uuid placeholder in the same dispatch.
    expect(liveUuids(editor).has("P2")).toBe(true);
    await flushMacrotask();
    // The deferred orphan dispatch must skip the resurrected uuid → no strip.
    expect(received).not.toContain("P2");
    editor.destroy();
  });

  it("STILL fires the orphan event for a genuinely-removed (non-resurrected) block", async () => {
    const editor = mountThreeDoc(new Set(["P2"])); // P3 is NOT anchored
    deleteParagraphByUuid(editor, "P3");
    expect(liveUuids(editor).has("P3")).toBe(false);
    await flushMacrotask();
    expect(received).toContain("P3");
    editor.destroy();
  });
});
