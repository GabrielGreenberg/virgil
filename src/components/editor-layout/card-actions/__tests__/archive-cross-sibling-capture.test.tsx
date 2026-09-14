// @vitest-environment jsdom
//
// TASK 563 — a selection spanning two SIBLINGS is archived WITH the structure
// that gave it meaning, and comes back as that structure.
//
// THE BUG (found by audit tick 96, driven through the real doors): drag-select
// from the middle of one bullet item to the middle of the next and Archive.
// `doc.slice(from, to)` cut at the SHARED-DEPTH node, so the capture's
// top-level children were two `listItem`s open at both ends with no list
// around them; the capture leaf knew two shapes (wrap inline, pass blocks) and
// pushed them at DOC level; the mount check asked the VOCABULARY only, so
// `{doc: [listItem, listItem]}` answered "mountable"; the delete ran; the
// archive card mounted the invalid model (it RENDERED — and the first
// keystroke threw `contentMatchAt on a node with invalid content`); and a
// restore handed the fitter two orphan items to WRAP into a phantom list. Two
// `exampleItem`s became a fresh numbered example, two `glossCell`s an orphan
// `\begingl` at top level. Same root, second symptom: a partial selection
// inside a `codeBlock` / `latexComment` was captured as PROSE and restored as
// a paragraph — `% parked old prose` typeset.
//
// **No pre-563 suite could see any of this**: every archive fixture in the
// repo selects INSIDE one paragraph or WHOLE blocks, where the shared depth is
// the document and the two shapes the leaf knew are the only two that exist.
//
// These drive the REAL `useDragHandleActions` hook over the REAL main-editor
// stack, then MOUNT the capture in the REAL editable excerpt surface and TYPE
// in it, then RESTORE it into a fresh main document and read the `.tex`.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "mutateBib",
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

vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  TabIndent,
  starterKitConfigForScope,
  buildCardBodySchema,
} from "@/lib/tiptap-extensions";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import { restoreExcerptAtCaret } from "@/lib/tiptap/restore-excerpt";
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

function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

/** The EXPANDED archive card body, composed exactly as `RichTextField` does. */
function mountExcerptCard(content: unknown): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [
      StarterKit.configure({ ...starterKitConfigForScope("excerpt") }),
      Placeholder.configure({ placeholder: "" }),
      TabIndent,
      ...buildCardBodySchema("excerpt", { includeLabelRef: true }),
    ],
    content: content as never,
  });
  editors.push(editor);
  return editor;
}

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
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function makeHarness(editor: Editor) {
  const notify = vi.fn();
  const archiveCalls: { text: unknown; content: unknown; paragraphId: unknown }[] = [];
  let n = 0;
  const nextId = () => `card-${++n}`;
  const cardCreation = {
    createNote: () => ({ id: nextId() }),
    createTodo: () => ({ id: nextId() }),
    createHighlight: () => ({ id: nextId() }),
    createRevisionRequest: () => ({ id: nextId() }),
    createFootnote: () => ({ footnoteId: nextId() }),
    createCitation: () => ({ id: nextId() }),
    createCutterComment: () => ({ id: nextId() }),
    createReportRequest: () => ({ id: nextId() }),
    createArchiveSnippet: (opts: { text?: unknown; content?: unknown; paragraphId?: unknown }) => {
      archiveCalls.push({ text: opts.text, content: opts.content, paragraphId: opts.paragraphId });
      return { id: nextId() };
    },
  } as unknown as DragHandleActionsDeps["cardCreation"];
  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: { get: () => undefined } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: { retarget: () => 0 },
    confirm: async () => true,
    notify,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };
  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch as (a: DragHandleAction, r: DragHandleRef) => Promise<void>,
    notify,
    archiveCalls,
  };
}

/** Document position `offset` characters into the text node that starts with
 *  `prefix`. */
function posInText(editor: Editor, prefix: string, offset: number): number {
  let found = -1;
  editor.state.doc.descendants((n, pos) => {
    if (found === -1 && n.isText && n.text?.startsWith(prefix)) found = pos + offset;
    return found === -1;
  });
  expect(found, `no text starting with "${prefix}"`).toBeGreaterThan(-1);
  return found;
}

function selectionRef(editor: Editor, from: number, to: number): DragHandleRef {
  return { kind: "selection", from, to, paragraphId: "" } as DragHandleRef;
}

/** Mount the capture in the real card body and TYPE one character at the end —
 *  the gesture that threw on the pre-563 tree. */
function typesInCard(content: unknown): string {
  const card = mountExcerptCard(content);
  card.commands.setTextSelection(card.state.doc.content.size - 1);
  expect(() => card.commands.insertContent("Z")).not.toThrow();
  expect(() => card.commands.selectAll()).not.toThrow();
  return card.getText();
}

/** Restore the capture into a fresh main document at a caret in a plain
 *  paragraph, and hand back the `.tex` body it serializes to. */
function restoredTex(content: unknown): string {
  const target = mountDoc([
    { type: "paragraph", attrs: { uuid: "t-1" }, content: [{ type: "text", text: "landing" }] },
  ]);
  target.commands.setTextSelection(4);
  expect(restoreExcerptAtCaret(target, content)).toBe(true);
  return serializeBodyOnly(target.getJSON() as JSONContent);
}

function topTypes(content: unknown): string[] {
  return ((content as JSONContent).content ?? []).map((n) => n.type as string);
}

const LIST_DOC: JSONContent[] = [
  { type: "paragraph", attrs: { uuid: "p-0" }, content: [{ type: "text", text: "Before." }] },
  {
    type: "bulletList",
    attrs: { uuid: "L-1" },
    content: [
      { type: "listItem", attrs: { uuid: "i-1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "alpha one" }] }] },
      { type: "listItem", attrs: { uuid: "i-2" }, content: [{ type: "paragraph", content: [{ type: "text", text: "beta two" }] }] },
      { type: "listItem", attrs: { uuid: "i-3" }, content: [{ type: "paragraph", content: [{ type: "text", text: "gamma three" }] }] },
    ],
  },
  { type: "paragraph", attrs: { uuid: "p-9" }, content: [{ type: "text", text: "After." }] },
];

describe("task 563 — a cross-sibling selection is archived WITH its structure", () => {
  it("two bullet items: the capture is the LIST, cut — it mounts, takes a keystroke, restores as a list", async () => {
    const editor = mountDoc(LIST_DOC);
    const h = makeHarness(editor);
    await h.dispatch(
      "archive",
      selectionRef(editor, posInText(editor, "alpha", 3), posInText(editor, "beta", 4)),
    );
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.archiveCalls).toHaveLength(1);
    const captured = h.archiveCalls[0].content as JSONContent;

    // THE SHAPE: a list at doc level, never two orphan items.
    expect(topTypes(captured)).toEqual(["bulletList"]);
    const list = captured.content![0];
    expect(list.content!.map((n) => n.type)).toEqual(["listItem", "listItem"]);
    expect(JSON.stringify(captured)).toContain("ha one");
    expect(JSON.stringify(captured)).toContain("beta");

    // THE DOCUMENT: the two items merged into one, the list intact around it.
    const docList = editor.state.doc.child(1);
    expect(docList.type.name).toBe("bulletList");
    expect(docList.childCount).toBe(2);
    expect(docList.child(0).textContent).toBe("alp two");
    expect(docList.child(1).textContent).toBe("gamma three");
    expect(editor.state.doc.textContent).toContain("Before.");
    expect(editor.state.doc.textContent).toContain("After.");

    // THE CARD: the pre-563 capture rendered and threw on the first keystroke.
    expect(typesInCard(captured)).toContain("Z");

    // THE RESTORE: a two-item list, once.
    const tex = restoredTex(captured);
    expect(tex.match(/\\begin\{itemize\}/g)).toHaveLength(1);
    expect(tex.match(/\\item\b/g)).toHaveLength(2);
    expect(tex).toContain("ha one");
    expect(tex).toContain("beta");
  });

  it("an OPEN ancestor is captured identity-less; a CONTAINED sibling keeps its identity (task 320's law on a copy)", async () => {
    const editor = mountDoc(LIST_DOC);
    const h = makeHarness(editor);
    await h.dispatch(
      "archive",
      selectionRef(editor, posInText(editor, "alpha", 3), posInText(editor, "gamma", 3)),
    );
    const captured = h.archiveCalls[0].content as JSONContent;
    const list = captured.content![0];
    // The list SURVIVES in the document (with the merged item), so its copy is
    // a fresh presence — as are the two items the range only partly covers.
    expect(list.attrs?.uuid ?? null).toBeNull();
    const [first, middle, last] = list.content!;
    expect(first.attrs?.uuid ?? null).toBeNull();
    expect(last.attrs?.uuid ?? null).toBeNull();
    // The middle item left the document WHOLE: it keeps the identity a restore
    // re-establishes, exactly as a whole-block archive always has.
    expect(middle.attrs?.uuid).toBe("i-2");
    expect(editor.state.doc.child(1).childCount).toBe(1);
    expect(editor.state.doc.child(1).child(0).attrs.uuid).toBe("i-1");
  });

  it("two expex items: the capture is the EXAMPLE, cut — restored as one example, never a phantom", async () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "p-0" }, content: [{ type: "text", text: "Before." }] },
      {
        type: "exampleBlock",
        attrs: { uuid: "E-1", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              { type: "exampleItem", attrs: { uuid: "x-1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "first item" }] }] },
              { type: "exampleItem", attrs: { uuid: "x-2" }, content: [{ type: "paragraph", content: [{ type: "text", text: "second item" }] }] },
              { type: "exampleItem", attrs: { uuid: "x-3" }, content: [{ type: "paragraph", content: [{ type: "text", text: "third item" }] }] },
            ],
          },
        ],
      },
      { type: "paragraph", attrs: { uuid: "p-9" }, content: [{ type: "text", text: "After." }] },
    ]);
    const h = makeHarness(editor);
    await h.dispatch(
      "archive",
      selectionRef(editor, posInText(editor, "first", 3), posInText(editor, "second", 3)),
    );
    expect(h.notify).not.toHaveBeenCalled();
    const captured = h.archiveCalls[0].content as JSONContent;
    expect(topTypes(captured)).toEqual(["exampleBlock"]);
    expect(captured.content![0].content![0].type).toBe("exampleItemList");
    expect(captured.content![0].content![0].content).toHaveLength(2);
    expect(typesInCard(captured)).toContain("Z");
    const tex = restoredTex(captured);
    expect(tex).toMatch(/\\pex[\s\S]*\\xe/);
    expect(tex).toContain("st item");
    expect(tex).toContain("sec");
    // The source example survives with its merged and untouched items.
    expect(editor.state.doc.child(1).type.name).toBe("exampleBlock");
    expect(editor.state.doc.textContent).toContain("third item");
  });

  it("two gloss cells: the capture is the example holding the gloss — restored INSIDE an example, never an orphan \\begingl", async () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "p-0" }, content: [{ type: "text", text: "Before." }] },
      {
        type: "exampleBlock",
        attrs: { uuid: "E-1", kind: "single" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Sentence line" }] },
          {
            type: "exampleGloss",
            attrs: { colCount: 2 },
            content: [
              {
                type: "alignedGlossRow",
                attrs: { tier: "gla" },
                content: [
                  { type: "glossCell", content: [{ type: "text", text: "der" }] },
                  { type: "glossCell", content: [{ type: "text", text: "Hund" }] },
                ],
              },
              {
                type: "alignedGlossRow",
                attrs: { tier: "glb" },
                content: [
                  { type: "glossCell", content: [{ type: "text", text: "the" }] },
                  { type: "glossCell", content: [{ type: "text", text: "dog" }] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const h = makeHarness(editor);
    await h.dispatch(
      "archive",
      selectionRef(editor, posInText(editor, "der", 1), posInText(editor, "Hund", 2)),
    );
    expect(h.notify).not.toHaveBeenCalled();
    const captured = h.archiveCalls[0].content as JSONContent;
    expect(topTypes(captured)).toEqual(["exampleBlock"]);
    const glossTypes = JSON.stringify(captured);
    expect(glossTypes).toContain("exampleGloss");
    expect(glossTypes).toContain("alignedGlossRow");
    expect(typesInCard(captured)).toContain("Z");
    const tex = restoredTex(captured);
    // The gloss lands inside an example: `\ex` BEFORE `\begingl`, and `\xe`
    // after `\endgl`. A bare `\begingl` at top level is invalid expex.
    const ex = tex.search(/\\p?ex\b/);
    const gl = tex.indexOf("\\begingl");
    expect(ex).toBeGreaterThan(-1);
    expect(gl).toBeGreaterThan(ex);
    expect(tex.indexOf("\\xe")).toBeGreaterThan(tex.indexOf("\\endgl"));
  });

  it("a partial selection inside a COMMENT stays a comment: captured as the node, restored as a `%` line", async () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "p-0" }, content: [{ type: "text", text: "Before." }] },
      { type: "latexComment", attrs: { uuid: "c-1" }, content: [{ type: "text", text: "parked old prose" }] },
      { type: "paragraph", attrs: { uuid: "p-9" }, content: [{ type: "text", text: "After." }] },
    ]);
    const h = makeHarness(editor);
    await h.dispatch(
      "archive",
      selectionRef(editor, posInText(editor, "parked", 2), posInText(editor, "parked", 12)),
    );
    expect(h.notify).not.toHaveBeenCalled();
    const captured = h.archiveCalls[0].content as JSONContent;
    expect(topTypes(captured)).toEqual(["latexComment"]);
    // The comment SURVIVES in the document, shortened, with its identity.
    expect(editor.state.doc.child(1).type.name).toBe("latexComment");
    expect(editor.state.doc.child(1).attrs.uuid).toBe("c-1");
    expect(editor.state.doc.child(1).textContent).toBe("parose");
    expect(captured.content![0].attrs?.uuid ?? null).toBeNull();
    const tex = restoredTex(captured);
    const line = tex.split("\n").find((l) => l.includes("rked old p"));
    expect(line, "the restored bytes must still be a comment line").toMatch(/^\s*%/);
  });

  it("a partial selection inside a CODE BLOCK stays verbatim", async () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "p-0" }, content: [{ type: "text", text: "Before." }] },
      { type: "codeBlock", attrs: { uuid: "k-1" }, content: [{ type: "text", text: "raw {bytes} \\here" }] },
      { type: "paragraph", attrs: { uuid: "p-9" }, content: [{ type: "text", text: "After." }] },
    ]);
    const h = makeHarness(editor);
    await h.dispatch(
      "archive",
      selectionRef(editor, posInText(editor, "raw", 2), posInText(editor, "raw", 14)),
    );
    expect(h.notify).not.toHaveBeenCalled();
    const captured = h.archiveCalls[0].content as JSONContent;
    expect(topTypes(captured)).toEqual(["codeBlock"]);
    const tex = restoredTex(captured);
    expect(tex).toContain("\\begin{verbatim}");
    // Verbatim bytes are byte-preserving: the brace and the backslash are NOT
    // escaped into printed prose.
    expect(tex).toContain("w {bytes} \\h");
    expect(tex).not.toContain("\\{bytes\\}");
  });

  it("a WHOLE-block ref is byte-identical to the pre-563 capture (the control)", async () => {
    // A grab-handle ref resolves to the block's OUTER bounds, so the range's
    // parents are the document itself and `includeParents` changes nothing:
    // the block passes through WITH its identity, as it always has.
    const editor = mountDoc(LIST_DOC);
    const h = makeHarness(editor);
    await h.dispatch("archive", { kind: "paragraph", id: "p-0" } as DragHandleRef);
    const captured = h.archiveCalls[0].content as JSONContent;
    expect(topTypes(captured)).toEqual(["paragraph"]);
    expect(captured.content![0].attrs?.uuid).toBe("p-0");
    expect(editor.state.doc.textContent).not.toContain("Before.");
  });
});
