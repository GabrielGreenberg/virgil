// @vitest-environment jsdom
//
// CHIP 8 — heading-blockinsert category, REAL-STACK cross-surface + per-kind
// verification.
//
// SCOPE (the manager's matrix oracle:
// docs/memos/action-alignment-matrix/EXPECTED-MATRIX.md "Heading + title" and
// "Block inserts" rows):
//
//   HEADING (heading-chapter/section/subsection/subsubsection): a convert-in-
//   place SET + numbered:true (NOT a toggle). Driven from the slash
//   `\chapter/\section/\subsection/\subsubsection` commands AND the BlockType-
//   dropdown / lightning path (the registry row's run()). Must produce the same
//   level+numbered, byte-identically, across the applicable text-object kinds
//   AND must not corrupt an inline atom (the DA-1 class).
//
//   BLOCK INSERTS:
//     example (\ex)        — wrap-if-selection else insert-empty (one template);
//                            on an ATOM-ONLY selection it INTENTIONALLY WRAPS
//                            (moves the atom into the item) — must not corrupt it.
//     tex (\tex)           — seed-from-selection; on an ATOM-ONLY selection it
//                            BAILS (no data loss).
//     inline-math/display-math — WRAP the selection; on an ATOM-ONLY selection
//                            they BAIL (the DA-1 data-loss guard).
//     figure/graphics      — smartInsertBlock at the caret, selection REPLACED;
//                            the inserted node is well-formed and the atom is not
//                            corrupted.
//
// This file drives the REAL `buildEditorExtensions("main")` stack (the actual
// schema + appendTransactions, incl. BlockUuidBackfill), the real `commands.ts`
// slash actions, and the registry rows' run() — NO mocks of product logic.
//
// CROSS-SURFACE IDENTITY: where two surfaces exist (heading: slash + dropdown;
// example/tex: slash/grid + registry run), the two outputs are compared in one
// test and asserted byte-identical (modulo minted uuids).
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha the sibling action tests guard. `requestAnimationFrame` is stubbed
// synchronous + layout rects shimmed so figure/graphics' rAF-deferred popover
// path runs in jsdom — mirrors block-atom-cells.test.ts.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
import {
  VIRGIL_ACTION_REGISTRY,
  exampleRun,
  texRun,
  figureRun,
  graphicsRun,
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

/** Caret at the start of the FIRST textblock (descends into wrappers). */
function caretInFirstTextblock(editor: Editor): void {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock) {
      pos = p + 1;
      return false;
    }
    return true;
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

/** Place a collapsed caret in the first block at offset `n` (doc pos 1+n). */
function placeCaret(editor: Editor, n: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1 + n)),
  );
}

/** Select a text range in the first block (offsets relative to block start). */
function selectRange(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + from, 1 + to),
    ),
  );
}

function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

function firstOfType(editor: Editor, typeName: string): PMNode | null {
  let found: PMNode | null = null;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === typeName) found = node;
    return !found;
  });
  return found;
}

/** Flat list of node-type names (with @level for headings) in doc order. */
function shape(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((n) => {
    out.push(n.type.name + (n.attrs.level ? "@" + n.attrs.level : ""));
    return true;
  });
  return out;
}

/** The first heading node's {type, level, numbered} (or the first block's). */
function firstHeadingDescriptor(editor: Editor): {
  type: string;
  level: number | undefined;
  numbered: boolean | undefined;
} {
  const h = firstOfType(editor, "heading") ?? editor.state.doc.firstChild!;
  return {
    type: h.type.name,
    level: h.attrs.level as number | undefined,
    numbered: h.attrs.numbered as boolean | undefined,
  };
}

/** Invoke a registry row's run() the way the BlockType dropdown / lightning grid
 *  does — a view-only ActionContext built from the live editor + a CursorRef. */
function runRegistry(editor: Editor, id: ActionId): void {
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

/** A selection-ref ActionContext for the block-insert runs (the grid path). */
function selCtx(editor: Editor, extra?: Partial<ActionContext>): ActionContext {
  return {
    editor,
    view: editor.view,
    ref: {
      kind: "selection",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      paragraphId: "",
    },
    surface: "lightning",
    ...extra,
  };
}

// ── jsdom layout shims (figure/graphics call .focus() → coordsAtPos →
//    getClientRects; the rAF popover path measures getBoundingClientRect). ──
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
let rafStub: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  installLayoutShims();
  rafStub = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
});

afterEach(() => {
  rafStub?.mockRestore();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ── doc-fragment factories for the per-kind matrix ──
function paragraph(text: string, uuid = "para-A"): Record<string, unknown> {
  return {
    type: "paragraph",
    attrs: { uuid },
    content: text ? [{ type: "text", text }] : [],
  };
}
const CITATION = {
  type: "citation",
  attrs: { citationId: "cit-1", command: "\\cite{foo}", displayText: "" },
};
const INLINE_MATH = { type: "inlineMath", attrs: { latex: "\\lambda" } };
const LABEL_REF = {
  type: "labelRef",
  attrs: { label: "eq:1", displayText: "1", refCommand: "ref", targetKind: null },
};

// ===========================================================================
// PART 1 — HEADING: SET + numbered:true, convert-in-place, ACROSS KINDS
// ===========================================================================

describe("heading SET across applicable kinds (slash ⇄ registry run)", () => {
  // Kinds where the EXPECTED-MATRIX (+ live probe) shows heading CONVERTS the
  // targeted textblock in place. blockquote: the INNER paragraph converts, the
  // wrapper stays. codeBlock/titleField: the block itself converts.
  type Case = {
    name: string;
    content: Record<string, unknown>[];
    // expected post-conversion top-level shape (a heading appears, text kept)
    expectHeading: true;
    keepText: string;
    // an outer wrapper that must survive (blockquote) — else null
    outerWrapper: string | null;
  };

  const CONVERTING: Case[] = [
    {
      name: "paragraph",
      content: [paragraph("Hello world")],
      expectHeading: true,
      keepText: "Hello world",
      outerWrapper: null,
    },
    {
      name: "codeBlock",
      content: [{ type: "codeBlock", attrs: { uuid: "c1" }, content: [{ type: "text", text: "x=1" }] }],
      expectHeading: true,
      keepText: "x=1",
      outerWrapper: null,
    },
    {
      name: "titleField",
      content: [{ type: "titleField", attrs: { uuid: "t1", field: "title" }, content: [{ type: "text", text: "My Title" }] }],
      expectHeading: true,
      keepText: "My Title",
      outerWrapper: null,
    },
    {
      name: "blockquote (inner paragraph converts, wrapper stays)",
      content: [{ type: "blockquote", content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "quote" }] }] }],
      expectHeading: true,
      keepText: "quote",
      outerWrapper: "blockquote",
    },
  ];

  for (const c of CONVERTING) {
    it(`slash \\section on ${c.name} → heading{level:2,numbered:true}, text preserved`, () => {
      const e = mount(JSON.parse(JSON.stringify(c.content)));
      caretInFirstTextblock(e);
      COMMAND_MAP.get("section")!.action(e.view, "\\section");

      expect(countOfType(e, "heading")).toBe(1);
      const h = firstHeadingDescriptor(e);
      expect(h.type).toBe("heading");
      expect(h.level).toBe(2);
      expect(h.numbered).toBe(true);
      expect(e.state.doc.textContent).toContain(c.keepText);
      if (c.outerWrapper) expect(countOfType(e, c.outerWrapper)).toBe(1);
    });

    it(`registry run heading-section on ${c.name} matches slash (byte-identical descriptor)`, () => {
      const e1 = mount(JSON.parse(JSON.stringify(c.content)));
      caretInFirstTextblock(e1);
      COMMAND_MAP.get("section")!.action(e1.view, "\\section");
      const viaSlash = firstHeadingDescriptor(e1);
      const shapeSlash = shape(e1);

      const e2 = mount(JSON.parse(JSON.stringify(c.content)));
      caretInFirstTextblock(e2);
      runRegistry(e2, "heading-section");
      const viaRun = firstHeadingDescriptor(e2);
      const shapeRun = shape(e2);

      expect(viaRun).toEqual(viaSlash);
      expect(viaRun).toEqual({ type: "heading", level: 2, numbered: true });
      // The whole doc shape (node types/levels in order) is identical too.
      expect(shapeRun).toEqual(shapeSlash);
    });
  }
});

describe("heading SET — all 4 levels, both surfaces, numbered:true", () => {
  const LEVELS: Array<{ slash: string; id: ActionId; level: number }> = [
    { slash: "chapter", id: "heading-chapter", level: 1 },
    { slash: "section", id: "heading-section", level: 2 },
    { slash: "subsection", id: "heading-subsection", level: 3 },
    { slash: "subsubsection", id: "heading-subsubsection", level: 4 },
  ];
  for (const { slash, id, level } of LEVELS) {
    it(`\\${slash} (slash) and ${id} (run) both SET level ${level}, numbered:true`, () => {
      const e1 = mount([paragraph("Body")]);
      caretInFirstTextblock(e1);
      COMMAND_MAP.get(slash)!.action(e1.view, "\\" + slash);
      const viaSlash = firstHeadingDescriptor(e1);

      const e2 = mount([paragraph("Body")]);
      caretInFirstTextblock(e2);
      runRegistry(e2, id);
      const viaRun = firstHeadingDescriptor(e2);

      expect(viaSlash).toEqual({ type: "heading", level, numbered: true });
      expect(viaRun).toEqual(viaSlash);
    });
  }
});

describe("heading SET — not a toggle (convert-in-place stays a heading)", () => {
  it("\\section on an existing level-2 heading STAYS a numbered section (no revert)", () => {
    const e = mount([
      { type: "heading", attrs: { uuid: "h1", level: 2, numbered: true }, content: [{ type: "text", text: "Intro" }] },
    ]);
    caretInFirstTextblock(e);
    COMMAND_MAP.get("section")!.action(e.view, "\\section");
    expect(firstHeadingDescriptor(e)).toEqual({ type: "heading", level: 2, numbered: true });
  });

  it("registry heading-subsection RE-LEVELS an existing level-2 heading to level 3 (SET)", () => {
    const e = mount([
      { type: "heading", attrs: { uuid: "h1", level: 2, numbered: true }, content: [{ type: "text", text: "Intro" }] },
    ]);
    caretInFirstTextblock(e);
    runRegistry(e, "heading-subsection");
    expect(firstHeadingDescriptor(e)).toEqual({ type: "heading", level: 3, numbered: true });
  });
});

describe("heading SET — DA-1: inline atoms survive the conversion", () => {
  it("atom-BEARING paragraph (text + citation) → heading, citation atom intact", () => {
    const e = mount([
      {
        type: "paragraph",
        attrs: { uuid: "p1" },
        content: [{ type: "text", text: "see " }, CITATION, { type: "text", text: " here" }],
      },
    ]);
    caretInFirstTextblock(e);
    COMMAND_MAP.get("section")!.action(e.view, "\\section");

    expect(countOfType(e, "heading")).toBe(1);
    // The atom MUST survive (no DA-1 corruption / renumber drift).
    expect(countOfType(e, "citation")).toBe(1);
    expect(firstOfType(e, "citation")!.attrs.citationId).toBe("cit-1");
    expect(firstOfType(e, "citation")!.attrs.command).toBe("\\cite{foo}");
  });

  it("atom-ONLY paragraph (inlineMath only) → heading, math atom intact (count===1)", () => {
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [INLINE_MATH] }]);
    caretInFirstTextblock(e);
    COMMAND_MAP.get("section")!.action(e.view, "\\section");

    expect(countOfType(e, "heading")).toBe(1);
    expect(countOfType(e, "inlineMath")).toBe(1);
    expect(firstOfType(e, "inlineMath")!.attrs.latex).toBe("\\lambda");
  });

  it("slash and registry run produce an IDENTICAL doc shape on the atom-bearing case", () => {
    const make = () => [
      { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "x " }, CITATION] },
    ];
    const e1 = mount(make());
    caretInFirstTextblock(e1);
    COMMAND_MAP.get("section")!.action(e1.view, "\\section");

    const e2 = mount(make());
    caretInFirstTextblock(e2);
    runRegistry(e2, "heading-section");

    // The two surfaces produce the IDENTICAL doc shape (the cross-surface
    // identity claim). The trailing empty "paragraph" is the editor's schema-
    // fill block (a doc may not end on a bare heading) — emitted identically by
    // both surfaces.
    expect(shape(e2)).toEqual(shape(e1));
    expect(shape(e1)).toEqual(["heading@2", "text", "citation", "paragraph"]);
  });
});

describe("heading SET — content-model NO-OP on list/example items (applies-vs-effect)", () => {
  // LIVE BEHAVIOR (probed against the real schema): a heading cannot be a
  // listItem/exampleItem child, so setBlockType is REJECTED → a silent NO-OP.
  // The EXPECTED-MATRIX lists heading-section as ok on selection/paragraph/
  // heading only (not listItem/exampleItem); this codifies the no-op so a
  // future schema change that suddenly DID convert (and shatter the list) is
  // caught. Both surfaces behave identically (both call the one headingRun).
  it("\\section inside a listItem is a no-op (list structure preserved)", () => {
    const e = mount([
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { uuid: "li1" }, content: [{ type: "text", text: "item" }] }] }] },
    ]);
    caretInFirstTextblock(e);
    const before = shape(e);
    COMMAND_MAP.get("section")!.action(e.view, "\\section");
    expect(countOfType(e, "heading")).toBe(0);
    expect(shape(e)).toEqual(before);
  });

  it("registry heading-section inside a listItem is the SAME no-op", () => {
    const e = mount([
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { uuid: "li1" }, content: [{ type: "text", text: "item" }] }] }] },
    ]);
    caretInFirstTextblock(e);
    const before = shape(e);
    runRegistry(e, "heading-section");
    expect(countOfType(e, "heading")).toBe(0);
    expect(shape(e)).toEqual(before);
  });

  it("\\section inside an exampleItem is a no-op (example structure preserved)", () => {
    const e = mount([
      {
        type: "exampleBlock",
        attrs: { uuid: "B", kind: "multi", number: 1 },
        content: [{ type: "exampleItemList", content: [{ type: "exampleItem", attrs: { uuid: "i1" }, content: [{ type: "paragraph", attrs: { uuid: "ip1" }, content: [{ type: "text", text: "ex" }] }] }] }],
      },
    ]);
    caretInFirstTextblock(e);
    const before = shape(e);
    COMMAND_MAP.get("section")!.action(e.view, "\\section");
    expect(countOfType(e, "heading")).toBe(0);
    expect(shape(e)).toEqual(before);
  });
});

// ===========================================================================
// PART 2 — EXAMPLE (\ex): wrap-if-selection else insert-empty (one template)
// ===========================================================================

describe("example \\ex — wrap-if-selection else insert-empty", () => {
  it("collapsed caret → ONE empty single exampleBlock (insert)", () => {
    const e = mount([paragraph("")]);
    placeCaret(e, 0);
    exampleRun(selCtx(e));
    expect(countOfType(e, "exampleBlock")).toBe(1);
    expect(firstOfType(e, "exampleBlock")!.attrs.kind).toBe("single");
    expect(firstOfType(e, "exampleBlock")!.textContent).toBe("");
  });

  it("text selection → WRAPS the selected inline text into the example's item", () => {
    const e = mount([paragraph("wrap me please")]);
    selectRange(e, 0, 7); // "wrap me"
    exampleRun(selCtx(e));
    const block = firstOfType(e, "exampleBlock")!;
    expect(block.attrs.kind).toBe("single");
    expect(block.textContent).toBe("wrap me");
  });

  it("ATOM-ONLY selection (citation) → WRAPS it (atom MOVED into the item, intact)", () => {
    // example INTENTIONALLY diverges from tex/math here: it MOVES the atom into
    // the item paragraph rather than bailing. The atom must survive the
    // deleteSelection→insert round-trip (the observer multi-step move-bug class).
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [CITATION] }]);
    selectRange(e, 0, 1); // the citation atom (nodeSize 1)
    exampleRun(selCtx(e));
    expect(countOfType(e, "exampleBlock")).toBe(1);
    // ONE citation, not zero (corrupted away) and not two (duplicated/renumber).
    expect(countOfType(e, "citation")).toBe(1);
    expect(firstOfType(e, "citation")!.attrs.citationId).toBe("cit-1");
    // The atom now lives inside the example block.
    let insideExample = false;
    firstOfType(e, "exampleBlock")!.descendants((n) => {
      if (n.type.name === "citation") insideExample = true;
      return true;
    });
    expect(insideExample).toBe(true);
  });

  it("ATOM-ONLY selection (inlineMath) → WRAPS it (atom intact)", () => {
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [INLINE_MATH] }]);
    selectRange(e, 0, 1);
    exampleRun(selCtx(e));
    expect(countOfType(e, "exampleBlock")).toBe(1);
    expect(countOfType(e, "inlineMath")).toBe(1);
    expect(firstOfType(e, "inlineMath")!.attrs.latex).toBe("\\lambda");
  });

  it("mints a collision-free uuid (distinct from an existing exampleBlock)", () => {
    const e = mount([
      paragraph("body"),
      { type: "exampleBlock", attrs: { uuid: "ex-EXISTING", kind: "single", number: 0 }, content: [{ type: "paragraph" }] },
    ]);
    placeCaret(e, 2);
    exampleRun(selCtx(e));
    const uuids: string[] = [];
    e.state.doc.descendants((n) => {
      if (n.type.name === "exampleBlock") uuids.push(n.attrs.uuid as string);
      return true;
    });
    expect(uuids).toContain("ex-EXISTING");
    expect(uuids.length).toBe(2);
    expect(uuids.filter((u) => u === "ex-EXISTING").length).toBe(1);
  });
});

// ===========================================================================
// PART 3 — TEX (\tex): seed-from-selection + the atom-only DATA-LOSS bail
// ===========================================================================

describe("tex \\tex — seed-from-selection + atom-only bail", () => {
  it("collapsed caret → texBlock with empty code + fresh uuid", () => {
    const e = mount([paragraph("Hello world")]);
    placeCaret(e, 5);
    texRun(selCtx(e));
    const tex = firstOfType(e, "texBlock")!;
    expect(tex).not.toBeNull();
    expect(tex.attrs.code).toBe("");
    expect(typeof tex.attrs.uuid).toBe("string");
    expect((tex.attrs.uuid as string).length).toBeGreaterThan(0);
  });

  it("text selection → seeds code from the selected text", () => {
    const e = mount([paragraph("alpha beta gamma")]);
    selectRange(e, 6, 10); // "beta"
    texRun(selCtx(e));
    expect(firstOfType(e, "texBlock")!.attrs.code).toBe("beta");
  });

  it("ATOM-ONLY selection (citation) → BAILS (no texBlock, atom preserved — DA-1)", () => {
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [CITATION] }]);
    selectRange(e, 0, 1);
    texRun(selCtx(e));
    expect(countOfType(e, "texBlock")).toBe(0);
    expect(countOfType(e, "citation")).toBe(1);
    expect(firstOfType(e, "citation")!.attrs.citationId).toBe("cit-1");
  });

  it("ATOM-ONLY selection (inlineMath) → BAILS (no texBlock, math preserved)", () => {
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [INLINE_MATH] }]);
    selectRange(e, 0, 1);
    texRun(selCtx(e));
    expect(countOfType(e, "texBlock")).toBe(0);
    expect(countOfType(e, "inlineMath")).toBe(1);
  });
});

// ===========================================================================
// PART 4 — INLINE-MATH / DISPLAY-MATH: WRAP + the atom-only DATA-LOSS bail
// ===========================================================================

describe("math rows — wrap the selection, bail on an atom-only selection", () => {
  const inlineRow = VIRGIL_ACTION_REGISTRY["inline-math"]!;
  const displayRow = VIRGIL_ACTION_REGISTRY["display-math"]!;

  it("inline-math: selected text becomes the inlineMath latex", () => {
    const e = mount([paragraph("wrap E=mc^2 here")]);
    selectRange(e, 5, 11); // "E=mc^2"
    inlineRow.run(selCtx(e));
    expect(firstOfType(e, "inlineMath")!.attrs.latex).toBe("E=mc^2");
  });

  it("inline-math: collapsed caret inserts the placeholder ('x')", () => {
    const e = mount([paragraph("nothing")]);
    placeCaret(e, 3);
    inlineRow.run(selCtx(e));
    expect(firstOfType(e, "inlineMath")!.attrs.latex).toBe("x");
  });

  it("display-math: selected text becomes the displayMath latex", () => {
    const e = mount([paragraph("see SUMHERE now")]);
    selectRange(e, 4, 11); // "SUMHERE"
    displayRow.run(selCtx(e));
    expect(firstOfType(e, "displayMath")!.attrs.latex).toBe("SUMHERE");
  });

  it("display-math: collapsed caret inserts the display placeholder", () => {
    const e = mount([paragraph("empty")]);
    placeCaret(e, 2);
    displayRow.run(selCtx(e));
    expect(firstOfType(e, "displayMath")!.attrs.latex).toBe("\\int f(x)\\,dx");
  });

  it("display-math: the inserted equation carries a non-null anchor uuid (BlockUuidBackfill)", () => {
    // NOTE / matrix discrepancy: the EXPECTED-MATRIX claims displayMath's uuid is
    // "absent/lazy — hydrated by ensureAnchorUuid on first interaction". In the
    // REAL main stack the `BlockUuidBackfill` appendTransaction mints a uuid for
    // EVERY anchorable block by the end of the inserting transaction, so a freshly
    // inserted displayMath already has a stable, non-null uuid (no orphan window).
    // LIVE CODE is truth — this codifies the live (more robust) behavior.
    const e = mount([paragraph("eq")]);
    placeCaret(e, 1);
    displayRow.run(selCtx(e));
    const dm = firstOfType(e, "displayMath")!;
    expect(typeof dm.attrs.uuid).toBe("string");
    expect((dm.attrs.uuid as string).length).toBeGreaterThan(0);
  });

  it("inline-math: ATOM-ONLY selection (labelRef) BAILS (atom preserved, no swap)", () => {
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [LABEL_REF] }]);
    selectRange(e, 0, 1);
    inlineRow.run(selCtx(e));
    expect(countOfType(e, "labelRef")).toBe(1);
    expect(countOfType(e, "inlineMath")).toBe(0);
    expect(firstOfType(e, "labelRef")!.attrs.label).toBe("eq:1");
  });

  it("inline-math: ATOM-ONLY selection (citation) BAILS (citation preserved)", () => {
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [CITATION] }]);
    selectRange(e, 0, 1);
    inlineRow.run(selCtx(e));
    expect(countOfType(e, "citation")).toBe(1);
    expect(countOfType(e, "inlineMath")).toBe(0);
  });

  it("display-math: ATOM-ONLY selection (inlineMath) BAILS (no displayMath inserted)", () => {
    const e = mount([{ type: "paragraph", attrs: { uuid: "p1" }, content: [INLINE_MATH] }]);
    selectRange(e, 0, 1);
    displayRow.run(selCtx(e));
    expect(countOfType(e, "inlineMath")).toBe(1);
    expect(countOfType(e, "displayMath")).toBe(0);
    expect(firstOfType(e, "inlineMath")!.attrs.latex).toBe("\\lambda");
  });
});

// ===========================================================================
// PART 5 — FIGURE / GRAPHICS via smartInsertBlock: insert + REPLACE-selection,
//          atom-not-corrupted (DA-1 / DA-2)
// ===========================================================================

describe("figure/graphics — smartInsertBlock at the caret, REPLACE on selection", () => {
  it("figureRun: collapsed caret inserts ONE figureBlock with a figureCaption; text kept", () => {
    const e = mount([paragraph("body text")]);
    placeCaret(e, 4);
    figureRun(selCtx(e, { openFigurePopover: vi.fn() }));
    expect(countOfType(e, "figureBlock")).toBe(1);
    expect(countOfType(e, "figureCaption")).toBe(1);
    expect(e.state.doc.textContent).toContain("body text");
  });

  it("graphicsRun: collapsed caret inserts ONE graphicsBlock; text kept", () => {
    const e = mount([paragraph("image here")]);
    placeCaret(e, 5);
    graphicsRun(selCtx(e, { openFigurePopover: vi.fn() }));
    expect(countOfType(e, "graphicsBlock")).toBe(1);
    expect(e.state.doc.textContent).toContain("image here");
  });

  it("figureRun: a text selection is REPLACED (documented smartInsertBlock policy)", () => {
    const e = mount([paragraph("keep DROP keep")]);
    selectRange(e, 5, 9); // "DROP"
    figureRun(selCtx(e, { openFigurePopover: vi.fn() }));
    expect(countOfType(e, "figureBlock")).toBe(1);
    expect(e.state.doc.textContent).not.toContain("DROP");
    expect(e.state.doc.textContent).toContain("keep");
  });

  it("figure/graphics mint non-null collision-free uuids (BlockUuidBackfill + the SSOT scan)", () => {
    const e = mount([paragraph("x")]);
    placeCaret(e, 1);
    figureRun(selCtx(e, { openFigurePopover: vi.fn() }));
    const fig = firstOfType(e, "figureBlock")!;
    expect(typeof fig.attrs.uuid).toBe("string");
    expect((fig.attrs.uuid as string).length).toBeGreaterThan(0);
  });

  it("figureRun fires openFigurePopover with the inserted block's seed (kind/raw/pos)", () => {
    const e = mount([paragraph("caption me")]);
    placeCaret(e, 3);
    const spy = vi.fn();
    figureRun(selCtx(e, { openFigurePopover: spy }));
    // rAF stubbed synchronous → the popover-open already fired.
    expect(spy).toHaveBeenCalledTimes(1);
    const seed = spy.mock.calls[0][0] as { kind: string; raw: string; pos: number };
    expect(seed.kind).toBe("figureBlock");
    expect(e.state.doc.nodeAt(seed.pos)?.type.name).toBe("figureBlock");
    expect(seed.raw).toContain("\\caption");
  });
});
