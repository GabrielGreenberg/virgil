// @vitest-environment jsdom
//
// Task 149 — the four heading slash commands (`\chapter` / `\section` /
// `\subsection` / `\subsubsection`) and the BlockType dropdown must honor the
// caret's CONTAINING block, exactly as the block-atom INSERT cells (task 147)
// and the card rows (061/145) already do. Heading is a `setBlockType` CONVERSION
// (not a block-child INSERT), so 147's insert-host guard never ran on it — this
// is the conversion twin of that bug.
//
// THE BUG THIS PINS (data-loss / corruption): a `titleField` (`\title` / `\author`
// / `\date` lozenge) IS a top-level textblock whose parent is `doc`, and `doc`
// hosts headings anywhere — so `setBlockType`'s internal `canChangeType` returns
// true and the structural node is CONVERTED IN PLACE into a heading, dropping its
// identity attrs. On the next save `collectPreambleTitleFields` finds no
// `titleField` for that field → the preamble loses the title; the text re-emits
// as a body `\section{}`. Silent data-loss on reload. `codeBlock` / `latexComment`
// are corrupted the same way (verbatim / comment role destroyed).
//
// WHAT IS PROVEN (driving the REAL editor stack + REAL schema + REAL serializer +
// the REAL slash COMMAND_MAP — only `@/lib/storage` is stubbed, per the
// extension-barrel gotcha):
//   1. Applicability: a caret inside titleField/codeBlock/latexComment greys
//      `heading-*` via the now-convert-aware `selectionCanHostHeading`; a
//      paragraph / heading caret stays "ok" (the menu-surface parity).
//   2. Slash-surface no-op: each `\chapter`/`\section`/`\subsection`/
//      `\subsubsection` at a caret inside a protected block is a NO-OP — the
//      structural node is preserved and NO heading is created (the
//      `runViewOnlyAction` applies() gate, Layer 2).
//   3. End-to-end serializer proof: after the bailed conversion the doc still
//      serializes the full `\title{...}` — the data-loss can no longer occur.
//   4. Prose still converts: a `\section` at a paragraph caret produces a
//      heading@2 (no over-gating); a heading re-level still works.
//   5. The existing listItem / exampleItem no-op cases stay no-ops.
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
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionRef,
  type ActionId,
} from "@/lib/actions/action-registry";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import { serializeToLatex } from "@/lib/latex-serializer";

// ───────────────────────────────────────────────────────────────────────────
// Real editor stack
// ───────────────────────────────────────────────────────────────────────────

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

/** Mount a real main editor with the given top-level content. */
function mount(content: Record<string, unknown>[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

/** The default fixture: titleField + paragraph + codeBlock + latexComment. */
function mountFixture(): Editor {
  return mount([
    {
      type: "titleField",
      attrs: { field: "title", uuid: "title-A" },
      content: [{ type: "text", text: "My Paper Title" }],
    },
    {
      type: "paragraph",
      attrs: { uuid: "para-A" },
      content: [{ type: "text", text: "Ordinary prose here." }],
    },
    {
      type: "codeBlock",
      attrs: { uuid: "code-A" },
      content: [{ type: "text", text: "x = 1" }],
    },
    {
      type: "latexComment",
      attrs: { uuid: "cmt-A" },
      content: [{ type: "text", text: "a comment" }],
    },
  ]);
}

/** The inner-text mid position of the first block named `nodeName`. */
function midInside(editor: Editor, nodeName: string): number {
  let mid: number | null = null;
  editor.state.doc.descendants((node: PMNode, pos: number) => {
    if (mid !== null || node.type.name !== nodeName) return true;
    const from = pos + 1;
    const to = from + Math.max(1, node.content.size);
    mid = Math.floor((from + to) / 2);
    return false;
  });
  if (mid === null) throw new Error(`no ${nodeName} mounted`);
  return mid;
}

/** Set a collapsed caret at doc position `pos`. */
function placeCaretAt(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

/** Place a caret inside `nodeName`, then read the heading row's applies verdict. */
function appliesAtCaretIn(
  editor: Editor,
  nodeName: string,
  id: ActionId = "heading-section",
): "ok" | "disabled" | "absent" {
  placeCaretAt(editor, midInside(editor, nodeName));
  const row = VIRGIL_ACTION_REGISTRY[id];
  if (!row) throw new Error(`no registry row for ${id}`);
  const ref: ActionRef = {
    kind: "cursor",
    pos: editor.state.selection.head,
    paragraphId: "",
  };
  return row.applies({ ref, view: editor.view } as ActionContext);
}

/** How many `typeName` nodes are in the doc. */
function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

const HEADING_SLASH = ["chapter", "section", "subsection", "subsubsection"] as const;
const PROTECTED = ["titleField", "codeBlock", "latexComment"] as const;

// jsdom has no layout engine; shim the rect APIs a mount might touch.
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

beforeEach(() => {
  installLayoutShims();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Applicability — the convert-aware grey-out (menu-surface parity)
// ───────────────────────────────────────────────────────────────────────────

describe("heading conversion honors the containing block — applies() (task 149)", () => {
  for (const container of PROTECTED) {
    it(`${container} caret greys heading-section (currently "ok" — the gap)`, () => {
      const editor = mountFixture();
      expect(appliesAtCaretIn(editor, container)).toBe("disabled");
      editor.destroy();
    });
  }

  it("a paragraph caret keeps heading-section 'ok' (no over-gating)", () => {
    const editor = mountFixture();
    expect(appliesAtCaretIn(editor, "paragraph")).toBe("ok");
    editor.destroy();
  });

  it("a heading caret keeps heading-section 'ok' (re-level stays available)", () => {
    const editor = mount([
      { type: "heading", attrs: { uuid: "h-A", level: 2, numbered: true }, content: [{ type: "text", text: "A Section" }] },
    ]);
    expect(appliesAtCaretIn(editor, "heading")).toBe("ok");
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 + 3. Slash-surface no-op + the serializer data-loss proof
// ───────────────────────────────────────────────────────────────────────────

describe("heading slash commands are a no-op inside a protected block (task 149)", () => {
  for (const container of PROTECTED) {
    for (const slash of HEADING_SLASH) {
      it(`\\${slash} at a mid-${container} caret preserves it and creates no heading`, () => {
        const editor = mountFixture();
        placeCaretAt(editor, midInside(editor, container));
        const before = countOfType(editor, container);

        COMMAND_MAP.get(slash)!.action(editor.view, "\\" + slash);

        expect(countOfType(editor, container), `${container} count`).toBe(before);
        expect(countOfType(editor, "heading"), `heading count`).toBe(0);
        editor.destroy();
      });
    }
  }

  it("serializer proof: after every heading command the full \\title{...} survives", () => {
    const editor = mountFixture();
    for (const slash of HEADING_SLASH) {
      placeCaretAt(editor, midInside(editor, "titleField"));
      COMMAND_MAP.get(slash)!.action(editor.view, "\\" + slash);
    }
    // Exactly one titleField remains; no heading was minted.
    expect(countOfType(editor, "titleField")).toBe(1);
    expect(countOfType(editor, "heading")).toBe(0);
    // The serialized preamble carries the WHOLE title — the dedup-drop can't fire.
    const tex = serializeToLatex(editor.getJSON());
    expect(tex).toContain("\\title{My Paper Title}");
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Prose still converts (the fix does not over-gate ordinary headings)
// ───────────────────────────────────────────────────────────────────────────

describe("heading slash commands still convert ordinary prose (task 149)", () => {
  it("\\section at a paragraph caret produces a heading@2", () => {
    const editor = mountFixture();
    placeCaretAt(editor, midInside(editor, "paragraph"));
    COMMAND_MAP.get("section")!.action(editor.view, "\\section");

    expect(countOfType(editor, "heading")).toBe(1);
    let level: number | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading" && level === null) level = node.attrs.level as number;
      return true;
    });
    expect(level).toBe(2);
    editor.destroy();
  });

  it("\\subsection re-levels an existing heading (SET stays available)", () => {
    const editor = mount([
      { type: "heading", attrs: { uuid: "h-A", level: 2, numbered: true }, content: [{ type: "text", text: "A Section" }] },
    ]);
    placeCaretAt(editor, midInside(editor, "heading"));
    COMMAND_MAP.get("subsection")!.action(editor.view, "\\subsection");

    expect(countOfType(editor, "heading")).toBe(1);
    let level: number | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading" && level === null) level = node.attrs.level as number;
      return true;
    });
    expect(level).toBe(3); // subsection = level 3
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Existing listItem / exampleItem no-op cases stay no-ops
// ───────────────────────────────────────────────────────────────────────────

describe("heading slash commands stay no-ops in list/example items (task 149 keeps 147-era pins)", () => {
  it("\\section inside a listItem is a no-op (list structure preserved)", () => {
    const editor = mount([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", attrs: { uuid: "li1" }, content: [{ type: "text", text: "item" }] }] },
        ],
      },
    ]);
    placeCaretAt(editor, midInside(editor, "paragraph"));
    COMMAND_MAP.get("section")!.action(editor.view, "\\section");
    expect(countOfType(editor, "heading")).toBe(0);
    expect(countOfType(editor, "listItem")).toBe(1);
    editor.destroy();
  });

  it("\\section inside an exampleItem is a no-op (example structure preserved)", () => {
    const editor = mount([
      {
        type: "exampleBlock",
        attrs: { uuid: "ex-A" },
        content: [
          {
            type: "exampleItemList",
            content: [
              { type: "exampleItem", attrs: { uuid: "i1" }, content: [{ type: "paragraph", attrs: { uuid: "ip1" }, content: [{ type: "text", text: "ex" }] }] },
            ],
          },
        ],
      },
    ]);
    placeCaretAt(editor, midInside(editor, "paragraph"));
    COMMAND_MAP.get("section")!.action(editor.view, "\\section");
    expect(countOfType(editor, "heading")).toBe(0);
    expect(countOfType(editor, "exampleItem")).toBe(1);
    editor.destroy();
  });
});
