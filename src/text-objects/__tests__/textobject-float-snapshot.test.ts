// @vitest-environment jsdom
//
// BUG #48 — the float-builder wiring. The droppable-contract test pins that the
// drop GESTURE resolves a spec for every poppable kind; THIS pins the other
// half the bug was about: `textObjectFloatable(ref, editorRef).snapshotForStack`
// must produce a NON-NULL stack snapshot (the old explicit `() => null` Stage-5
// stub is what broke parity with card floats).
//
// We build the real `Floatable` the popout renders from and call
// `snapshotForStack` with an `editorRef` whose `getEditor()` returns a live doc
// — exactly the EditorPane drop handler's path.

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

// Side-effect import: registers every poppable kind's `floatBodyComponent` so
// `textObjectFloatable` doesn't early-return null for lack of a body.
import "@/text-objects/floats";

import { getSchema, type Editor, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { textObjectFloatable } from "../text-object-floatable";
import type { EditorHandle } from "@/components/Editor";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editable: true,
    cardContext: false,
    callbacks: {},
    docIdRef: null,
    host: { getMainEditor: () => null },
  };
}

const schema = getSchema(buildEditorExtensions(mainCtx()));

/** An editorRef whose `getEditor()` returns a minimal live editor over a
 *  one-paragraph doc — the only thing `snapshotForStack` reaches through. */
function editorRefOver(docJson: JSONContent) {
  const doc = PMNode.fromJSON(schema, docJson);
  const editor = { state: { doc } } as unknown as Editor;
  const handle = { getEditor: () => editor } as unknown as EditorHandle;
  return { current: handle };
}

const SOURCE = { docId: "doc-1" };

describe("textObjectFloatable.snapshotForStack (BUG #48)", () => {
  it("a popped-out paragraph float produces a NON-NULL stack snapshot", () => {
    const ref = editorRefOver({
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "para1" }, content: [{ type: "text", text: "snap me" }] }],
    });
    const f = textObjectFloatable({ kind: "paragraph", id: "para1" }, ref);
    expect(f).not.toBeNull();
    const item = f!.snapshotForStack(SOURCE);
    expect(item).not.toBeNull();
    expect(item!.payload.kind).toBe("paragraph");
  });

  it("a heading float snapshots its whole section", () => {
    const ref = editorRefOver({
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "head1", level: 1 }, content: [{ type: "text", text: "T" }] },
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "body" }] },
      ],
    });
    const f = textObjectFloatable({ kind: "heading", id: "head1" }, ref);
    const item = f!.snapshotForStack(SOURCE);
    expect(item).not.toBeNull();
    expect(item!.payload.kind).toBe("heading");
  });

  it("returns null when the editor isn't available (closed doc)", () => {
    const ref = { current: { getEditor: () => null } as unknown as EditorHandle };
    const f = textObjectFloatable({ kind: "paragraph", id: "para1" }, ref);
    expect(f!.snapshotForStack(SOURCE)).toBeNull();
  });

  it("returns null when the source node was deleted (uuid no longer resolves)", () => {
    const ref = editorRefOver({
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "para1" }, content: [{ type: "text", text: "x" }] }],
    });
    const f = textObjectFloatable({ kind: "paragraph", id: "ghost" }, ref);
    expect(f!.snapshotForStack(SOURCE)).toBeNull();
  });
});
