// @vitest-environment jsdom
//
// Task 340, the leg the JSON-level suite structurally CANNOT carry.
//
// `item-optional-label-roundtrip.test.ts` drives `parseLatex` →
// `serializeBodyOnly` over plain JSON, so it proves the parser captures the
// label and the serializer re-emits it — and it would stay green with the
// `itemLabel` attr never registered on the TipTap `listItem` extension. That
// omission is the whole difference between "survives a parse/serialize pair"
// and "survives the editor", because ProseMirror DROPS an attribute the node
// spec does not declare: the label would live exactly until the document was
// loaded into the editor, i.e. always, silently, in the real app.
//
// So this suite mounts the REAL main extension list, loads a labelled list
// through it, edits the item's text the way a user would, and serializes what
// the editor holds. Measured: deleting the `itemLabel` line from
// `createListItemWithUuid` leaves the sibling suite fully green and fails
// every leg here.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
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
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";

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

const editors: Editor[] = [];

function mount(tex: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: parseLatex(
      `\\documentclass{article}\\begin{document}\n${tex}\n\\end{document}`,
    ),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

/** Serialize what the LIVE editor holds — the save path, not the fixture. */
function saveFrom(editor: Editor): string {
  return serializeBodyOnly(editor.getJSON()).trim();
}

const LETTERED = `\\begin{enumerate}
  \\item[(a)] alpha
  \\item[(b)] beta
\\end{enumerate}`;

describe("task 340 — the label survives the EDITOR, not just a re-parse", () => {
  it("declares itemLabel on the live listItem node spec", () => {
    // The direct statement of what the sibling suite cannot see: an attr the
    // spec does not declare is an attr ProseMirror silently discards on load.
    const editor = mount(LETTERED);
    const spec = editor.schema.nodes.listItem.spec.attrs;
    expect(spec).toBeDefined();
    expect(Object.keys(spec ?? {})).toContain("itemLabel");
  });

  it("carries the label through a load with no edit at all", () => {
    // The reported symptom verbatim: open, save, nothing else.
    expect(saveFrom(mount(LETTERED))).toBe(LETTERED);
  });

  it("keeps the label when the user retypes the item's TEXT", () => {
    const editor = mount(LETTERED);
    // Find the first item's paragraph and replace its text, the way typing does.
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from !== -1) return false;
      if (node.type.name === "listItem") {
        const para = node.child(0);
        from = pos + 2; // inside listItem, inside its first paragraph
        to = from + para.content.size;
        return false;
      }
      return true;
    });
    expect(from).toBeGreaterThan(-1);
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, from, to))
        .insertText("alpha rewritten"),
    );
    const out = saveFrom(editor);
    expect(out).toContain("\\item[(a)] alpha rewritten");
    expect(out).toContain("\\item[(b)] beta");
  });

  it("gives a NEW item typed by the user a bare \\item, never an empty []", () => {
    // A label is source provenance the user never typed, so the attr default
    // must be absent-not-empty for every item the editor itself creates.
    const editor = mount(LETTERED);
    // Put the caret at the end of the last item and split it into a new one.
    const end = editor.state.doc.content.size - 2;
    editor.chain().focus().setTextSelection(end).splitListItem("listItem").run();
    editor.commands.insertContent("gamma");
    const out = saveFrom(editor);
    expect(out).toContain("\\item gamma");
    expect(out).not.toContain("[]");
    // …and the pre-existing labels are untouched by the insertion.
    expect(out).toContain("\\item[(a)] alpha");
    expect(out).toContain("\\item[(b)] beta");
  });
});
