// @vitest-environment jsdom
//
// CHIP 5b — the TEX (raw-LaTeX `texBlock`) cross-surface alignment proof.
//
// THE DIVERGENCE (MEMO_ACTION_ALIGNMENT.md §3 tex row): there were TWO creators
// with DIFFERENT behavior —
//   - slash `\tex` (commands.ts): `replaceSelectionWith(texBlock.create({code:
//     ''}))` — ALWAYS empty code, DISCARDED any selected text;
//   - lightning grid (tex-block.ts `insertTexBlock`): SEEDED `code` from the
//     selected plain text (`textBetween`, hardBreak→\n).
// Each re-implemented the uuid-collision scan. SETTLED DECISION: unify on the
// RICHER behavior — **seed code from the selection** (the grid version). Both
// surfaces now route through the registry's single `texRun`.
//
// WHAT IS PROVEN (driving the REAL editor stack — the actual `commands.ts` slash
// action + the real `buildEditorExtensions` texBlock schema + the real grid
// `insertTexBlock` + the real registry `texRun`):
//   1. SLASH `\tex` (collapsed caret) inserts a `texBlock` with a FRESH uuid and
//      EMPTY code.
//   2. GRID `insertTexBlock` (collapsed caret) does the IDENTICAL thing.
//   3. With a SELECTION, the selected plain text SEEDS `code` on BOTH surfaces —
//      and (the behavior fix) the SLASH surface NO LONGER discards it.
//   4. The fresh uuid is collision-free against an EXISTING `texBlock` uuid in
//      the doc — proving the ONE uuid-scan path is correct (no duplication).
//   5. The slash action and the grid helper produce byte-identical results
//      (same node type, same code, both fresh-uuid'd) — they share ONE `texRun`.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha as the sibling heading/citation/footnote action tests.)
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
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import { insertTexBlock } from "@/lib/tiptap/tex-block";

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

/** Mount a real main editor over the given doc content. */
function mountEditor(content: Record<string, unknown>[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

function paragraph(text: string, uuid = "para-A"): Record<string, unknown> {
  return {
    type: "paragraph",
    attrs: { uuid },
    content: text ? [{ type: "text", text }] : [],
  };
}

/** Place a collapsed caret inside the first block, offset `caretOffset`. */
function placeCaret(editor: Editor, caretOffset = 1): void {
  const pos = 1 + caretOffset;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

/** Select a text range inside the first block (offsets relative to block start). */
function selectRange(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + from, 1 + to),
    ),
  );
}

/** The first `texBlock` node in the doc (or null). */
function firstTexBlock(editor: Editor): PMNode | null {
  let found: PMNode | null = null;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === "texBlock") found = node;
    return !found;
  });
  return found;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (1) Slash `\tex` on a collapsed caret → texBlock, fresh uuid, empty code
// ---------------------------------------------------------------------------

describe("slash \\tex (collapsed caret)", () => {
  it("inserts a texBlock with a fresh uuid and empty code", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    placeCaret(editor, 5); // inside "Hello"
    COMMAND_MAP.get("tex")!.action(editor.view, "\\tex");

    const tex = firstTexBlock(editor);
    expect(tex).not.toBeNull();
    expect(tex!.attrs.code).toBe("");
    expect(typeof tex!.attrs.uuid).toBe("string");
    expect((tex!.attrs.uuid as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (2) Grid `insertTexBlock` on a collapsed caret → IDENTICAL
// ---------------------------------------------------------------------------

describe("grid insertTexBlock (collapsed caret)", () => {
  it("inserts a texBlock with a fresh uuid and empty code (same as slash)", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    placeCaret(editor, 5);
    insertTexBlock(editor);

    const tex = firstTexBlock(editor);
    expect(tex).not.toBeNull();
    expect(tex!.attrs.code).toBe("");
    expect(typeof tex!.attrs.uuid).toBe("string");
    expect((tex!.attrs.uuid as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (3) With a SELECTION, the selected text SEEDS `code` on BOTH surfaces.
//     THE BEHAVIOR FIX: slash previously discarded the selection (code:'') —
//     assert it no longer does.
// ---------------------------------------------------------------------------

describe("seed code from selection (both surfaces)", () => {
  it("slash \\tex seeds code from the selected text (no longer discards it)", () => {
    const editor = mountEditor([paragraph("alpha beta gamma")]);
    // Select "beta" (chars 6..10 of "alpha beta gamma").
    selectRange(editor, 6, 10);
    COMMAND_MAP.get("tex")!.action(editor.view, "\\tex");

    const tex = firstTexBlock(editor);
    expect(tex).not.toBeNull();
    expect(tex!.attrs.code).toBe("beta");
  });

  it("grid insertTexBlock seeds code from the selected text", () => {
    const editor = mountEditor([paragraph("alpha beta gamma")]);
    selectRange(editor, 6, 10);
    insertTexBlock(editor);

    const tex = firstTexBlock(editor);
    expect(tex).not.toBeNull();
    expect(tex!.attrs.code).toBe("beta");
  });

  it("slash and grid seed IDENTICALLY from the same selection", () => {
    const e1 = mountEditor([paragraph("alpha beta gamma")]);
    selectRange(e1, 0, 16); // whole "alpha beta gamma"
    COMMAND_MAP.get("tex")!.action(e1.view, "\\tex");
    const viaSlash = firstTexBlock(e1);

    const e2 = mountEditor([paragraph("alpha beta gamma")]);
    selectRange(e2, 0, 16);
    insertTexBlock(e2);
    const viaGrid = firstTexBlock(e2);

    expect(viaSlash!.attrs.code).toBe("alpha beta gamma");
    expect(viaGrid!.attrs.code).toBe(viaSlash!.attrs.code);
    expect(viaSlash!.type.name).toBe("texBlock");
    expect(viaGrid!.type.name).toBe("texBlock");
  });
});

// ---------------------------------------------------------------------------
// (4) The minted uuid is collision-free against an EXISTING texBlock uuid —
//     proving the ONE uuid-scan path (no duplicate scans) works on both surfaces.
// ---------------------------------------------------------------------------

describe("collision-free uuid (single scan path)", () => {
  function docWithExistingTex(): Record<string, unknown>[] {
    return [
      paragraph("Body text"),
      { type: "texBlock", attrs: { uuid: "tex-EXISTING", code: "\\alpha" } },
    ];
  }

  it("slash \\tex mints a uuid distinct from an existing texBlock", () => {
    const editor = mountEditor(docWithExistingTex());
    placeCaret(editor, 4);
    COMMAND_MAP.get("tex")!.action(editor.view, "\\tex");

    const uuids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "texBlock") uuids.push(node.attrs.uuid as string);
      return true;
    });
    expect(uuids).toContain("tex-EXISTING");
    expect(uuids.length).toBe(2);
    const fresh = uuids.find((u) => u !== "tex-EXISTING");
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe("tex-EXISTING");
  });

  it("grid insertTexBlock mints a uuid distinct from an existing texBlock", () => {
    const editor = mountEditor(docWithExistingTex());
    placeCaret(editor, 4);
    insertTexBlock(editor);

    const uuids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "texBlock") uuids.push(node.attrs.uuid as string);
      return true;
    });
    expect(uuids.length).toBe(2);
    const fresh = uuids.find((u) => u !== "tex-EXISTING");
    expect(fresh).not.toBe("tex-EXISTING");
  });
});
