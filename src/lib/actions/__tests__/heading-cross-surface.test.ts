// @vitest-environment jsdom
//
// CHIP 5a — the HEADING cross-surface alignment proof.
//
// THE DIVERGENCE (MEMO_ACTION_ALIGNMENT.md §3 heading row): the slash
// `\chapter/\section/\subsection/\subsubsection` commands always SET
// (`setBlockType` + `numbered:true`), while the BlockType dropdown TOGGLED
// (`toggleHeading` → clicking 'Section' on an existing level-2 heading reverted
// it to a paragraph). SETTLED DECISION: the canonical heading verb is **always
// SET + numbered:true**. Both surfaces now route through the registry's single
// `headingRun`.
//
// WHAT IS PROVEN (driving the REAL editor stack — the actual `commands.ts` slash
// action + the real `buildEditorExtensions` heading schema + the real registry
// `headingRun`):
//   1. SLASH `\section` turns a paragraph into a heading level-2, numbered:true.
//   2. DROPDOWN 'Section' (the registry row's `run()`, same path the dropdown's
//      onClick calls) does the IDENTICAL thing.
//   3. ALL 4 LEVELS map correctly (chapter→1 … subsubsection→4).
//   4. SET semantics — applying 'Section' to an EXISTING level-2 heading leaves
//      it a numbered section (does NOT toggle to a paragraph).
//   5. The slash command routes through the SAME registry `run()` as the
//      dropdown — no duplicated `setBlockType` (we assert the slash action and a
//      direct `run()` produce byte-identical results).
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha as the sibling citation/footnote action tests.)
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
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type CursorRef,
} from "@/lib/actions/action-registry";
import { paragraphUuidAt } from "@/links/links";

// ---------------------------------------------------------------------------
// Real editor stack
// ---------------------------------------------------------------------------

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

/** Mount a real main editor over the given doc content, caret placed inside the
 *  FIRST block at offset `caretOffset`. */
function mountEditor(
  content: Record<string, unknown>[],
  caretOffset = 1,
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  const pos = 1 + caretOffset;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
  return editor;
}

function paragraph(text: string, uuid = "para-A"): Record<string, unknown> {
  return {
    type: "paragraph",
    attrs: { uuid },
    content: text ? [{ type: "text", text }] : [],
  };
}

/** The first block's {type, level, numbered}. */
function firstBlock(editor: Editor): {
  type: string;
  level: number | undefined;
  numbered: boolean | undefined;
} {
  const node = editor.state.doc.firstChild!;
  return {
    type: node.type.name,
    level: node.attrs.level as number | undefined,
    numbered: node.attrs.numbered as boolean | undefined,
  };
}

/** Invoke a heading registry row's run() the way the BlockType dropdown does —
 *  a view-only ActionContext built from the live editor + a CursorRef. */
function runDropdown(editor: Editor, id: ActionId): void {
  const spec = VIRGIL_ACTION_REGISTRY[id];
  if (!spec) throw new Error(`no row for ${id}`);
  const pos = editor.state.selection.head;
  const ref: CursorRef = {
    kind: "cursor",
    pos,
    paragraphId: paragraphUuidAt(editor.state.doc, pos) ?? "",
  };
  const ctx: ActionContext = {
    editor,
    view: editor.view,
    ref,
    surface: "lightning",
  };
  void spec.run(ctx);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (1) Slash `\section` SETs a numbered level-2 heading
// ---------------------------------------------------------------------------

describe("slash \\section", () => {
  it("turns a paragraph into a heading level-2, numbered:true", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    COMMAND_MAP.get("section")!.action(editor.view, "\\section");

    const b = firstBlock(editor);
    expect(b.type).toBe("heading");
    expect(b.level).toBe(2);
    expect(b.numbered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) Dropdown 'Section' (registry run) does the IDENTICAL thing
// ---------------------------------------------------------------------------

describe("dropdown 'Section' (registry headingRun)", () => {
  it("turns a paragraph into a heading level-2, numbered:true (same as slash)", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    runDropdown(editor, "heading-section");

    const b = firstBlock(editor);
    expect(b.type).toBe("heading");
    expect(b.level).toBe(2);
    expect(b.numbered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (3) All 4 levels map correctly (chapter→1 … subsubsection→4), both surfaces
// ---------------------------------------------------------------------------

describe("all 4 heading levels map correctly", () => {
  const CASES: Array<{ slash: string; id: ActionId; level: number }> = [
    { slash: "chapter", id: "heading-chapter", level: 1 },
    { slash: "section", id: "heading-section", level: 2 },
    { slash: "subsection", id: "heading-subsection", level: 3 },
    { slash: "subsubsection", id: "heading-subsubsection", level: 4 },
  ];

  for (const { slash, id, level } of CASES) {
    it(`slash \\${slash} → level ${level}`, () => {
      const editor = mountEditor([paragraph("Body")]);
      COMMAND_MAP.get(slash)!.action(editor.view, "\\" + slash);
      const b = firstBlock(editor);
      expect(b.type).toBe("heading");
      expect(b.level).toBe(level);
      expect(b.numbered).toBe(true);
    });

    it(`dropdown '${id}' → level ${level}`, () => {
      const editor = mountEditor([paragraph("Body")]);
      runDropdown(editor, id);
      const b = firstBlock(editor);
      expect(b.type).toBe("heading");
      expect(b.level).toBe(level);
      expect(b.numbered).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// (4) SET semantics — applying 'Section' to an EXISTING level-2 heading leaves
//     it a numbered section (does NOT toggle to a paragraph). This is the
//     behavior change: the dropdown used to toggle-off.
// ---------------------------------------------------------------------------

describe("SET semantics (no toggle-off)", () => {
  it("dropdown 'Section' on an existing level-2 heading STAYS a numbered section", () => {
    const editor = mountEditor([
      { type: "heading", attrs: { uuid: "h-A", level: 2, numbered: true }, content: [{ type: "text", text: "Intro" }] },
    ]);
    runDropdown(editor, "heading-section");

    const b = firstBlock(editor);
    // Did NOT revert to a paragraph (the old toggle behavior).
    expect(b.type).toBe("heading");
    expect(b.level).toBe(2);
    expect(b.numbered).toBe(true);
  });

  it("slash \\section on an existing level-2 heading STAYS a numbered section", () => {
    const editor = mountEditor([
      { type: "heading", attrs: { uuid: "h-A", level: 2, numbered: true }, content: [{ type: "text", text: "Intro" }] },
    ]);
    COMMAND_MAP.get("section")!.action(editor.view, "\\section");

    const b = firstBlock(editor);
    expect(b.type).toBe("heading");
    expect(b.level).toBe(2);
    expect(b.numbered).toBe(true);
  });

  it("re-leveling: 'Subsection' on an existing level-2 heading SETs it to level 3", () => {
    const editor = mountEditor([
      { type: "heading", attrs: { uuid: "h-A", level: 2, numbered: true }, content: [{ type: "text", text: "Intro" }] },
    ]);
    runDropdown(editor, "heading-subsection");
    const b = firstBlock(editor);
    expect(b.type).toBe("heading");
    expect(b.level).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// (5) Slash routes through the SAME registry run() as the dropdown — the slash
//     action and a direct registry run() produce a byte-identical result.
// ---------------------------------------------------------------------------

describe("slash and dropdown share ONE headingRun", () => {
  it("the slash \\subsection action and the registry run() yield the same heading", () => {
    const e1 = mountEditor([paragraph("Same text")]);
    COMMAND_MAP.get("subsection")!.action(e1.view, "\\subsection");
    const viaSlash = firstBlock(e1);

    const e2 = mountEditor([paragraph("Same text")]);
    runDropdown(e2, "heading-subsection");
    const viaDropdown = firstBlock(e2);

    expect(viaSlash).toEqual(viaDropdown);
    expect(viaSlash).toEqual({ type: "heading", level: 3, numbered: true });
  });
});
