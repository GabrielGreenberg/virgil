// @vitest-environment jsdom
//
// Task 236 — `titleFieldRun`'s canonical-insert offset must count ALL preceding
// top-level children, not just the matching title-fields.
//
// The `\title`/`\author`/`\date` slash commands route through `titleFieldRun`
// (`action-registry.ts`). When no field of the requested kind exists yet, the run
// inserts a new `titleField` at its canonical position (title=0/author=1/date=2).
// The parser's `hoistTitleFieldsToTop` keeps title-fields contiguous at doc top,
// but only AT PARSE TIME — it is not a live PM plugin, so during editing a body
// block can precede a title-field (e.g. drag a paragraph above the title lozenge).
//
// The old walk summed the `nodeSize` of ONLY the matching preceding title-fields,
// so any preceding non-title block made `insertPos` undercount and land inside the
// previous title's `inline*` content → a `ReplaceError` (silent no-op) or a
// dup-uuid title split with silent data-loss on serialize→reload. The fix walks a
// cumulative offset across ALL children.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha as the sibling action tests.)
import { describe, it, expect, vi, afterEach } from "vitest";

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
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";

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

type DocChild = Record<string, unknown>;

/** Mount a real main editor from an explicit top-level child list, caret at end. */
function mountEditorWith(children: DocChild[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content: children },
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(
        editor.state.doc,
        Math.max(1, editor.state.doc.content.size - 1),
      ),
    ),
  );
  return editor;
}

function para(uuid: string, text: string): DocChild {
  return {
    type: "paragraph",
    attrs: { uuid },
    content: text ? [{ type: "text", text }] : [],
  };
}

function titleField(uuid: string, field: string, text: string): DocChild {
  return {
    type: "titleField",
    attrs: { field, uuid },
    content: text ? [{ type: "text", text }] : [],
  };
}

/** Every top-level titleField, in doc order. */
function titleFields(editor: Editor): PMNode[] {
  const out: PMNode[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === "titleField") out.push(n);
  });
  return out;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("titleFieldRun canonical-insert offset (task 236)", () => {
  it("inserts a valid sibling AFTER a title even when a body block precedes it (non-canonical arrangement)", () => {
    // Top-level order: [paragraph("body"), titleField(title)] — a body block
    // above the title, reachable by dragging a paragraph above the title lozenge.
    const editor = mountEditorWith([
      para("para-A", "body"),
      titleField("tf-title", "title", "My Title"),
    ]);

    // Fire \author. On `main` this lands inside the title's inline content →
    // throw (ReplaceError) or a dup-uuid title split.
    expect(() =>
      COMMAND_MAP.get("author")!.action(editor.view, "\\author"),
    ).not.toThrow();

    const fields = titleFields(editor);
    // Exactly one title + one author — the title was NOT split into two nodes.
    expect(fields.map((f) => f.attrs.field).sort()).toEqual(["author", "title"]);

    const title = fields.find((f) => f.attrs.field === "title")!;
    const author = fields.find((f) => f.attrs.field === "author")!;

    // The title survived intact (its inline content is whole, not sliced).
    expect(title.textContent).toBe("My Title");
    // Distinct top-level nodes with distinct uuids (no dup-uuid corruption).
    expect(title.attrs.uuid).not.toBe(author.attrs.uuid);
    expect(title.attrs.uuid).toBeTruthy();
    expect(author.attrs.uuid).toBeTruthy();

    // Author is placed AFTER the title (canonical order title=0 < author=1) and
    // both are top-level siblings — the body paragraph is untouched.
    const order = fields.map((f) => f.attrs.field);
    expect(order.indexOf("title")).toBeLessThan(order.indexOf("author"));
    let bodies = 0;
    editor.state.doc.forEach((n) => {
      if (n.type.name === "paragraph" && n.textContent === "body") bodies++;
    });
    expect(bodies).toBe(1);
  });

  it("canonical arrangement is unchanged — \\author lands between title and date at doc top", () => {
    // Title-fields already contiguous at doc top, then a body block.
    const editor = mountEditorWith([
      titleField("tf-title", "title", "My Title"),
      titleField("tf-date", "date", "January 1, 2026"),
      para("para-A", "body"),
    ]);

    COMMAND_MAP.get("author")!.action(editor.view, "\\author");

    const fields = titleFields(editor);
    // Canonical order title=0 / author=1 / date=2, all before the body.
    expect(fields.map((f) => f.attrs.field)).toEqual(["title", "author", "date"]);
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.lastChild?.textContent).toBe("body");
  });
});
