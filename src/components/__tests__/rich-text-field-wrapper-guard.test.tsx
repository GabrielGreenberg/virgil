// @vitest-environment jsdom
//
// Task 2026-08-22-427 — the card-body toolbar's two list buttons are the
// third surface that reached `toggleBulletList` / `toggleOrderedList` without
// asking the wrapper gate. A card body at `"excerpt"` scope mounts `codeBlock`
// and the block atoms (task 308), so a non-listable block is reachable there:
// pre-427 the button was lit, and the click coerced the code block into a list
// item — MEASURED: the code block comes back as `bulletList > listItem >
// paragraph`, its verbatim bytes now prose.
//
// Drives the REAL `RichTextField` (not the mock every panel suite installs)
// and asks both halves: the button's native `disabled` (the affordance) AND
// the document after a click (the commit), so a fix to either alone fails.
import { describe, expect, it, vi, afterEach } from "vitest";

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

// Capture the card-body editor `useEditor` mints, so the leg can place the
// caret and read the document back — the component exposes no handle.
const captured: { editor: import("@tiptap/core").Editor | null } = { editor: null };
vi.mock("@tiptap/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...mod,
    useEditor: (...args: Parameters<typeof mod.useEditor>) => {
      const ed = mod.useEditor(...args);
      if (ed) captured.editor = ed;
      return ed;
    },
  };
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import RichTextField from "@/components/RichTextField";

afterEach(() => {
  cleanup();
  captured.editor = null;
});

const VALUE = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "prose line" }] },
    { type: "codeBlock", content: [{ type: "text", text: "verbatim $x$ bytes" }] },
  ],
};

function mountField() {
  const onChange = vi.fn();
  render(
    <RichTextField
      value={VALUE}
      instanceKey="wrapper-guard"
      onChange={onChange}
      schemaScope="excerpt"
    />,
  );
  const editor = captured.editor;
  if (!editor) throw new Error("RichTextField minted no editor");
  return { editor, onChange };
}

function caretIn(editor: import("@tiptap/core").Editor, type: "paragraph" | "codeBlock") {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === type) pos = p + 1;
    return pos < 0;
  });
  act(() => {
    editor.commands.setTextSelection(pos + 2);
  });
}

describe("RichTextField toolbar list buttons ask the wrapper gate (task 427)", () => {
  for (const label of ["Bullet list", "Numbered list"] as const) {
    it(`${label}: DISABLED with the caret in a codeBlock, and a click leaves the block intact`, () => {
      const { editor } = mountField();
      caretIn(editor, "codeBlock");
      const btn = screen.getByLabelText(label) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      const before = editor.state.doc.toJSON();
      act(() => {
        fireEvent.mouseDown(btn);
      });
      expect(editor.state.doc.toJSON()).toEqual(before);
      expect(editor.state.doc.child(1).type.name).toBe("codeBlock");
    });

    it(`${label}: CONTROL — enabled in prose, and a click wraps the paragraph`, () => {
      const { editor } = mountField();
      caretIn(editor, "paragraph");
      const btn = screen.getByLabelText(label) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      act(() => {
        fireEvent.mouseDown(btn);
      });
      expect(editor.state.doc.child(0).type.name).toBe(label === "Bullet list" ? "bulletList" : "orderedList");
      // the code block is untouched either way
      expect(editor.state.doc.child(1).type.name).toBe("codeBlock");
    });
  }
});
