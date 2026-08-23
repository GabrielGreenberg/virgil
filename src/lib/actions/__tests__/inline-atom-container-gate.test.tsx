// @vitest-environment jsdom
//
// Task 396 — the INLINE-atom insert paths must honor the caret's CONTAINING
// block, exactly as the BLOCK-atom rows (task 147/229) and the card-atom rows
// (task 061/148) already do.
//
// THE BUG THIS PINS (silent structural corruption of the user's `.tex`, two
// clicks, no warning). Task 150 built the SSOT for one question — *can this
// textblock host an INLINE atom?* — because the MARKLESS verbatim blocks
// (`codeBlock`, `latexComment`) declare `content: "text*"`: literal text only,
// no inline nodes. ProseMirror's fitter, unable to place the atom, wraps it in a
// fresh paragraph and SPLITS the verbatim block around it. In a `latexComment`
// that means the tail of a line the user had COMMENTED OUT is promoted into the
// live document — it now compiles and prints. Nothing throws, the doc is
// schema-valid, and the save writes it straight through.
//
// Pre-396 `posHostsInlineAtom` had exactly ONE production caller (the typed
// `$…$` input rule, math.ts). Every other route in skipped it:
//   • the grid's `$x$` and `Cross-ref` cells rode the bare `blockApplies`, under
//     a task-147 comment asserting the premise task 150 had falsified ONE DAY
//     LATER ("inline atoms never split — valid inside a title/code block"): the
//     title half true, the code-block half false;
//   • `insertInlineAtom` — the ONE shared insert door, and the only layer the
//     deferred create-popover commit passes through — had no container gate at
//     all, so `\ref` landed wherever the captured `at` pointed;
//   • `mathRun("inline")` had no bail, though its display twin does.
// The repo's own recurring shape: a helper only SOME siblings call is not an SSOT.
//
// WHAT IS PROVEN (driving the REAL `buildEditorExtensions("main")` stack + REAL
// schema + REAL serializer — only `@/lib/storage` is stubbed, per the
// extension-barrel gotcha):
//   1. AFFORDANCE — a caret/selection inside `codeBlock` / `latexComment` greys
//      BOTH inline rows via `inlineAtomInsertApplies`; a `titleField` and a
//      paragraph keep them enabled (controls: an inline atom is legitimate in
//      `inline*`, which is why this canNOT reuse the block gate).
//   2. RUN defence-in-depth — `mathRun("inline")` invoked anyway leaves the doc
//      byte-identical, asserted on the SERIALIZED `.tex` as well as the node
//      shape, because the `% todo` -> live-line promotion is only visible in the
//      bytes.
//   3. THE DOOR — `insertInlineAtom` at a captured `at` inside a verbatim block
//      refuses (`{ refused: true }`) and touches nothing; and the REAL `\ref`
//      popover commit (`useRefActions.handleInsertRef`, whose captured position
//      no `applies()` can see) refuses through it. The door is also what covers
//      every future inline atom.
//   4. Non-regression: the door still inserts in prose / a `titleField`, and a
//      viewless ctx degrades to "ok" (the historic short-circuit) — the gate is
//      precisely the threaded live view.
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

import { renderHook, cleanup } from "@testing-library/react";
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
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";
import { useRefActions } from "@/components/editor-layout/card-actions/ref";
import type { EditorHandle } from "@/components/Editor";
import { serializeToLatex } from "@/lib/latex-serializer";

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
  } as unknown as EditorExtensionsCtx;
}

/**
 * A real main editor holding the four containers this class turns on: an
 * `inline*` title (must stay ALLOWED), ordinary prose (control), and the two
 * MARKLESS `text*` verbatim blocks. The `latexComment` carries a REAL commented
 * line (`% todo fix later`) so the promotion the fix prevents is visible in the
 * serialized bytes, not just in the node tree.
 */
function mountFixture(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "titleField",
          attrs: { field: "title", uuid: "title-A" },
          content: [{ type: "text", text: "My Paper Title" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text: "alpha beta gamma" }],
        },
        {
          type: "codeBlock",
          attrs: { uuid: "code-A" },
          content: [{ type: "text", text: "alpha beta gamma" }],
        },
        {
          type: "latexComment",
          attrs: { uuid: "cmt-A" },
          content: [{ type: "text", text: "% todo fix later" }],
        },
      ],
    },
  });
}

/** A prose-only editor. The shared fixture's LAST block is a `latexComment`, so
 *  `TextSelection.atEnd` lands inside a verbatim block there — correct, and the
 *  wrong shape for asking whether a stale past-the-end `at` CLAMPS. */
function mountProseOnly(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-only" },
          content: [{ type: "text", text: "alpha beta gamma" }],
        },
      ],
    },
  });
}

/** A doc whose FIRST block is a verbatim `codeBlock`, so `TextSelection.atStart`
 *  lands INSIDE it. (The shared fixture cannot show this from the other end: the
 *  trailing-node extension always appends an empty paragraph, so `atEnd` is
 *  always prose there.) */
function mountCodeFirst(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { uuid: "code-first" },
          content: [{ type: "text", text: "alpha beta gamma" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "para-B" },
          content: [{ type: "text", text: "prose after" }],
        },
      ],
    },
  });
}

/** The inner-text range of the first block named `nodeName`. */
function rangeInside(editor: Editor, nodeName: string): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node: PMNode, pos: number) => {
    if (range || node.type.name !== nodeName) return true;
    const from = pos + 1;
    range = { from, to: from + Math.max(1, node.content.size) };
    return false;
  });
  if (!range) throw new Error(`no ${nodeName} mounted`);
  return range;
}

/** A SELECTION ref spanning the inner text of the first `nodeName` block. */
function selectionRefInside(editor: Editor, nodeName: string): ActionRef {
  const r = rangeInside(editor, nodeName);
  return { kind: "selection", from: r.from, to: r.to, paragraphId: "" };
}

/** A CURSOR ref at a MID-content caret inside the first `nodeName` block. */
function cursorRefInside(editor: Editor, nodeName: string): ActionRef {
  const r = rangeInside(editor, nodeName);
  const mid = Math.floor((r.from + r.to) / 2);
  return { kind: "cursor", pos: mid, paragraphId: "" };
}

/** The registry row's decoration decision for `id`, given a ref + optional view. */
function decorate(
  id: ActionId,
  ref: ActionRef,
  editor: Editor | null,
): "ok" | "disabled" | "absent" {
  const row = VIRGIL_ACTION_REGISTRY[id];
  if (!row) throw new Error(`no registry row for ${id}`);
  return row.applies({ ref, view: editor?.view } as ActionContext);
}

/** Put a live TextSelection over `nodeName`'s inner text (the gesture the bolt
 *  makes), then run the row through the REAL registry `run()`. */
function selectInnerText(editor: Editor, nodeName: string): ActionRef {
  const r = rangeInside(editor, nodeName);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, r.from, r.to)),
  );
  return { kind: "selection", from: r.from, to: r.to, paragraphId: "" };
}

function runRow(editor: Editor, id: ActionId, ref: ActionRef): void {
  VIRGIL_ACTION_REGISTRY[id].run({
    ref,
    view: editor.view,
    editor,
    canEdit: true,
  } as unknown as ActionContext);
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

/**
 * Dispatch one harmless transaction so any append-on-first-tx plugin (the
 * trailing-node paragraph) has settled BEFORE a snapshot is taken. Without this
 * a "the doc did not move" assertion measures that plugin, not the fix.
 */
function settle(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
}

/** The serialized `.tex` BODY (the part a promotion is visible in). */
function bodyTex(editor: Editor): string {
  const tex = serializeToLatex(editor.state.doc.toJSON() as never);
  const at = tex.indexOf("\\begin{document}");
  return at >= 0 ? tex.slice(at) : tex;
}

// The two INLINE-atom rows, with the schema node each lands.
const INLINE_ATOM_ROWS: { id: ActionId; nodeName: string }[] = [
  { id: "inline-math", nodeName: "inlineMath" },
  { id: "ref", nodeName: "labelRef" },
];
/** `content: "text*"` — literal text only. An inline node here SPLITS the block. */
const VERBATIM_CONTAINERS = ["codeBlock", "latexComment"];
/** `inline*` (title) / prose. An inline atom is legitimate — must stay enabled. */
const INLINE_HOSTING_CONTAINERS = ["titleField", "paragraph"];

const REF_ATTRS = {
  label: "sec:intro",
  displayText: "1",
  refCommand: "ref",
  targetKind: "label",
};
const FOOTNOTE_ATTRS = {
  footnoteId: "fn-1",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  number: 0,
  title: "",
};

// jsdom has no layout engine; the run paths call `editor.chain().focus()`
// (-> `coordsAtPos` -> `getClientRects`), so shim the rect APIs. rAF is stubbed
// synchronous for the same reason the sibling 147 suite does.
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

// rAF is COLLECTED, not run synchronously — the sibling `insert-inline-atom`
// suite's pattern. TipTap's `focus()` schedules a deferred `scrollIntoView` in a
// rAF; firing it synchronously lands a dispatch in the middle of the insert
// chain ("Applying a mismatched transaction"). Nothing here needs a frame: the
// gate and both insert paths are synchronous.
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  installLayoutShims();
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

afterEach(() => {
  cleanup();
  rafQueue = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. AFFORDANCE - the container-aware grey-out
// ---------------------------------------------------------------------------

describe("inline-atom cells honor the containing block (task 396)", () => {
  for (const container of VERBATIM_CONTAINERS) {
    it(`${container} caret/selection greys both inline-atom cells`, () => {
      const editor = mountFixture();
      for (const refMaker of [selectionRefInside, cursorRefInside]) {
        const ref = refMaker(editor, container);
        for (const { id } of INLINE_ATOM_ROWS) {
          expect(decorate(id, ref, editor), `${container} x ${id}`).toBe("disabled");
        }
      }
      editor.destroy();
    });
  }

  for (const container of INLINE_HOSTING_CONTAINERS) {
    it(`CONTROL - ${container} keeps both inline-atom cells enabled`, () => {
      const editor = mountFixture();
      for (const refMaker of [selectionRefInside, cursorRefInside]) {
        const ref = refMaker(editor, container);
        for (const { id } of INLINE_ATOM_ROWS) {
          expect(decorate(id, ref, editor), `${container} x ${id}`).toBe("ok");
        }
      }
      editor.destroy();
    });
  }

  it("regression pin: a viewless ctx degrades to 'ok' - the gate IS the threaded view", () => {
    const editor = mountFixture();
    const ref = selectionRefInside(editor, "codeBlock");
    for (const { id } of INLINE_ATOM_ROWS) {
      expect(decorate(id, ref, null), `viewless ${id}`).toBe("ok");
    }
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. RUN defence-in-depth - invoked anyway, the document does not move
// ---------------------------------------------------------------------------

describe("mathRun('inline') bails inside a verbatim block (task 396)", () => {
  for (const container of VERBATIM_CONTAINERS) {
    it(`${container}: the block survives whole and the .tex is byte-identical`, () => {
      const editor = mountFixture();
      const ref = selectInnerText(editor, container);
      const before = bodyTex(editor);
      const beforeBlocks = editor.state.doc.childCount;

      runRow(editor, "inline-math", ref);

      expect(countOfType(editor, "inlineMath"), "no atom landed").toBe(0);
      expect(countOfType(editor, container), `${container} not split`).toBe(1);
      expect(editor.state.doc.childCount, "no block added").toBe(beforeBlocks);
      expect(bodyTex(editor), "the .tex did not move").toBe(before);
      editor.destroy();
    });
  }

  it("the `% todo fix later` line is NOT promoted into the typeset document", () => {
    const editor = mountFixture();
    // A MID-CONTENT sub-selection ("fix"), NOT the whole block. Selecting the
    // whole content makes the harvested `latex` the entire line, so pre-fix the
    // atom serialized as `$% todo fix later$` — which still CONTAINS the comment
    // text and never produces `$fix$`, i.e. two of the three assertions below
    // would have passed on the defect. The tear this task is named after needs a
    // selection with text on BOTH sides of it.
    const r = rangeInside(editor, "latexComment");
    const text = editor.state.doc.textBetween(r.from, r.to, " ");
    const at = r.from + text.indexOf("fix");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at, at + 3)),
    );
    runRow(editor, "inline-math", {
      kind: "selection",
      from: at,
      to: at + 3,
      paragraphId: "",
    });

    const tex = bodyTex(editor);
    // Pre-396 the comment was torn at the selection: `% todo ` stayed a comment
    // and `$fix$ later` became a LIVE line that compiles and prints.
    expect(tex).toContain("% todo fix later");
    expect(tex).not.toContain("$fix$");
    expect(tex).not.toMatch(/^\s*\$.*later/m);
    // The block survives WHOLE — the run path's own truncate-and-eject pin (the
    // whole-content selection EMPTIES the block instead, so `countOfType === 1`
    // held either way and could not fail).
    expect(countOfType(editor, "latexComment")).toBe(1);
    let inner = "";
    editor.state.doc.descendants((n) => {
      if (n.type.name === "latexComment") inner = n.textContent;
      return true;
    });
    expect(inner).toBe("% todo fix later");
    editor.destroy();
  });

  it("CONTROL - the same run in prose DOES insert the atom", () => {
    const editor = mountFixture();
    runRow(editor, "inline-math", selectInnerText(editor, "paragraph"));
    expect(countOfType(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. THE DOOR - the only layer the deferred popover commit passes through
// ---------------------------------------------------------------------------

describe("insertInlineAtom refuses at a container that can't host (task 396)", () => {
  for (const container of VERBATIM_CONTAINERS) {
    it(`${container}: a captured 'at' refuses and touches nothing`, () => {
      const editor = mountFixture();
      settle(editor);
      const before = bodyTex(editor);
      const r = rangeInside(editor, container);
      const mid = Math.floor((r.from + r.to) / 2);

      const result = insertInlineAtom({
        editor,
        type: "labelRef",
        attrs: REF_ATTRS,
        at: mid,
      });

      expect(result.refused, "reported as refused").toBe(true);
      expect(result.pos).toBe(-1);
      expect(countOfType(editor, "labelRef"), "no atom landed").toBe(0);
      expect(countOfType(editor, container), `${container} not split`).toBe(1);
      expect(bodyTex(editor), "the .tex did not move").toBe(before);
      editor.destroy();
    });
  }

  it("CONTROL - the door still inserts in prose and in a titleField", () => {
    for (const container of INLINE_HOSTING_CONTAINERS) {
      const editor = mountFixture();
      const r = rangeInside(editor, container);
      const result = insertInlineAtom({
        editor,
        type: "labelRef",
        attrs: REF_ATTRS,
        at: Math.floor((r.from + r.to) / 2),
      });
      expect(result.refused, `${container} refused`).toBe(false);
      expect(countOfType(editor, "labelRef"), `${container} atom count`).toBe(1);
      editor.destroy();
    }
  });

  it("CONTROL - a footnote still lands in prose (the door is atom-agnostic)", () => {
    const editor = mountFixture();
    const r = rangeInside(editor, "paragraph");
    const result = insertInlineAtom({
      editor,
      type: "footnote",
      attrs: FOOTNOTE_ATTRS,
      at: Math.floor((r.from + r.to) / 2),
    });
    expect(result.refused).toBe(false);
    expect(countOfType(editor, "footnote")).toBe(1);
    editor.destroy();
  });

  it("a footnote refuses inside a latexComment - every inline atom, not just the two rows", () => {
    const editor = mountFixture();
    settle(editor);
    const before = bodyTex(editor);
    const r = rangeInside(editor, "latexComment");
    const result = insertInlineAtom({
      editor,
      type: "footnote",
      attrs: FOOTNOTE_ATTRS,
      at: Math.floor((r.from + r.to) / 2),
    });
    expect(result.refused).toBe(true);
    expect(countOfType(editor, "footnote")).toBe(0);
    expect(bodyTex(editor)).toBe(before);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3b. What the gate must NOT refuse - the over-refusal legs
// ---------------------------------------------------------------------------

describe("the gate is scoped to the CORRUPTING case (task 396)", () => {
  it("a stale past-the-end `at` still lands - the clamp is TipTap's, not doc.content.size", () => {
    // `doc.content.size` resolves to the DOC node, not a textblock. A gate
    // reading the raw clamp refuses a stale captured `at` that the insert would
    // have landed in prose — and a stale `at` is exactly what the deferred
    // create popover carries. Neutering `clampToTextRange` back to
    // `Math.min(at, doc.content.size)` fails this leg.
    const editor = mountProseOnly();
    const result = insertInlineAtom({
      editor,
      type: "labelRef",
      attrs: REF_ATTRS,
      at: editor.state.doc.content.size + 500,
    });
    expect(result.refused, "a stale `at` must clamp, not refuse").toBe(false);
    expect(countOfType(editor, "labelRef")).toBe(1);
    editor.destroy();
  });

  it("an out-of-range `at` is judged at its REAL landing, not at the doc node", () => {
    // The leg with TEETH for `clampToTextRange`. `at: 0` is before the first
    // text position; the RAW clamp leaves it at 0, whose parent is the DOC — a
    // non-textblock the scope above waves through — while `setTextSelection`
    // then moves the caret into the first TEXTBLOCK, here a `codeBlock`, and the
    // atom lands in it. So the two clamps judge DIFFERENT positions, and only
    // TipTap's own answers about the one the insert uses.
    const editor = mountCodeFirst();
    settle(editor);
    const before = bodyTex(editor);
    const result = insertInlineAtom({
      editor,
      type: "labelRef",
      attrs: REF_ATTRS,
      at: 0,
    });
    expect(result.refused, "judged at the codeBlock, not the doc node").toBe(true);
    expect(countOfType(editor, "labelRef")).toBe(0);
    expect(countOfType(editor, "codeBlock"), "not split").toBe(1);
    expect(bodyTex(editor)).toBe(before);
    editor.destroy();
  });

  it("a NON-textblock gap position still lands - PM wraps there, nothing to tear", () => {
    // A `posAtCoords` that lands beside a block atom, or a GapCursor, resolves to
    // a position whose parent is the DOC. Measured: `tr.insert` there yields a
    // fresh paragraph holding the atom and destroys nothing, so refusing would be
    // a silent no-op the user cannot explain (a bib-entry drop beside a figure, a
    // footnote at a gap cursor).
    const editor = mountFixture();
    let gapPos = -1;
    editor.state.doc.descendants((n, pos) => {
      if (gapPos < 0 && n.type.name === "codeBlock") gapPos = pos; // the gap BEFORE it
      return true;
    });
    expect(gapPos).toBeGreaterThan(0);
    expect(editor.state.doc.resolve(gapPos).parent.isTextblock).toBe(false);

    const result = insertInlineAtom({
      editor,
      type: "labelRef",
      attrs: REF_ATTRS,
      at: gapPos,
    });
    expect(result.refused, "a block gap is not a corrupting position").toBe(false);
    expect(countOfType(editor, "labelRef")).toBe(1);
    expect(countOfType(editor, "codeBlock"), "the neighbour is untouched").toBe(1);
    editor.destroy();
  });

  it("a citation refuses in a verbatim block and lands in prose (the atom the drops carry)", () => {
    for (const [container, wantRefused] of [
      ["latexComment", true],
      ["paragraph", false],
    ] as const) {
      const editor = mountFixture();
      const r = rangeInside(editor, container);
      const result = insertInlineAtom({
        editor,
        type: "citation",
        attrs: { citationId: "cit-1", command: "\\cite{a}", displayText: "A" },
        at: Math.floor((r.from + r.to) / 2),
      });
      expect(result.refused, `${container} refused?`).toBe(wantRefused);
      expect(countOfType(editor, "citation"), `${container} atom count`).toBe(
        wantRefused ? 0 : 1,
      );
      editor.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The REAL \ref create-popover commit - the path no applies() can see
// ---------------------------------------------------------------------------

describe("the ref popover commit refuses at a captured verbatim position (task 396)", () => {
  /** Drive the REAL `useRefActions` over a real editor. `handleInsertRef` is
   *  what the LabelRefPopover calls on OK, with the position captured at TRIGGER
   *  time - the reason a menu-side gate alone cannot close this path. */
  function refActions(editor: Editor) {
    const handle = { getEditor: () => editor } as unknown as EditorHandle;
    return renderHook(() =>
      useRefActions({
        editorRef: { current: handle },
        setActiveRefLabel: () => {},
      }),
    ).result;
  }

  for (const container of VERBATIM_CONTAINERS) {
    it(`${container}: handleInsertRef lands nothing and splits nothing`, () => {
      const editor = mountFixture();
      settle(editor);
      const before = bodyTex(editor);
      const r = rangeInside(editor, container);
      const { current } = refActions(editor);

      current.handleInsertRef("sec:intro", "ref", Math.floor((r.from + r.to) / 2), editor);

      expect(countOfType(editor, "labelRef"), "no atom landed").toBe(0);
      expect(countOfType(editor, container), `${container} not split`).toBe(1);
      expect(bodyTex(editor), "the .tex did not move").toBe(before);
      editor.destroy();
    });
  }

  it("CONTROL - handleInsertRef still inserts at a prose position", () => {
    const editor = mountFixture();
    const r = rangeInside(editor, "paragraph");
    const { current } = refActions(editor);
    current.handleInsertRef("sec:intro", "ref", Math.floor((r.from + r.to) / 2), editor);
    expect(countOfType(editor, "labelRef")).toBe(1);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. THE RANGE HALF (task 428) — a selection is REPLACED, so the gate asks
//    about every textblock it reaches, not about `from` alone.
//
// Task 396's own recorded residual: `posHostsInlineAtom` is a SINGLE-position
// question where its block twin (`blockRangeAllowsAction`, task 148) requires
// EVERY reachable textblock. Measured on the pre-428 tree: select from
// mid-paragraph INTO the `codeBlock`, click `$x$` — the gate reads the paragraph
// ("ok"), `mathRun`'s data-loss guard passes (non-empty text), and
// `insertContent` replaces `[from, to]`: the code block's text is gone and the
// two blocks merge into one paragraph. Visible only in the bytes.
// ---------------------------------------------------------------------------

/** A live selection from the MIDDLE of the paragraph INTO the middle of the
 *  `codeBlock` that follows it (the fixture's block order: title, para, code,
 *  comment). */
function selectProseIntoCode(editor: Editor): ActionRef {
  const p = rangeInside(editor, "paragraph");
  const c = rangeInside(editor, "codeBlock");
  const from = Math.floor((p.from + p.to) / 2);
  const to = Math.floor((c.from + c.to) / 2);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
  return { kind: "selection", from, to, paragraphId: "" };
}

describe("a selection reaching INTO a verbatim block is refused whole (task 428)", () => {
  for (const { id } of INLINE_ATOM_ROWS) {
    it(`AFFORDANCE — ${id} greys for a prose→codeBlock selection`, () => {
      const editor = mountFixture();
      const ref = selectProseIntoCode(editor);
      expect(decorate(id, ref, editor)).toBe("disabled");
      editor.destroy();
    });
  }

  it("RUN — mathRun('inline') leaves the code block whole and the .tex byte-identical", () => {
    const editor = mountFixture();
    settle(editor);
    const ref = selectProseIntoCode(editor);
    const before = bodyTex(editor);
    const beforeBlocks = editor.state.doc.childCount;

    runRow(editor, "inline-math", ref);

    expect(countOfType(editor, "inlineMath"), "no atom landed").toBe(0);
    expect(countOfType(editor, "codeBlock"), "the code block survives").toBe(1);
    expect(editor.state.doc.childCount, "the blocks did not merge").toBe(beforeBlocks);
    // Pre-428 the merge produced a paragraph holding `alpha beta $gamma alpha$
    // beta gamma` and NO `\begin{verbatim}`-family block at all.
    expect(bodyTex(editor), "the .tex did not move").toBe(before);
    editor.destroy();
  });

  it("DOOR — insertInlineAtom over the live prose→codeBlock selection refuses and touches nothing", () => {
    const editor = mountFixture();
    settle(editor);
    selectProseIntoCode(editor);
    const before = editor.state.doc;
    const res = insertInlineAtom({ editor, type: "labelRef", attrs: REF_ATTRS });
    expect(res.refused).toBe(true);
    expect(res.pos).toBe(-1);
    expect(editor.state.doc.eq(before)).toBe(true);
    editor.destroy();
  });

  it("DOOR — the same selection with an explicit `at` in prose still lands (caret form — nothing is replaced)", () => {
    // With `at`, `setTextSelection` COLLAPSES the selection first, so the range
    // form would be the wrong question: the insert replaces nothing.
    const editor = mountFixture();
    settle(editor);
    selectProseIntoCode(editor);
    const p = rangeInside(editor, "paragraph");
    const res = insertInlineAtom({ editor, type: "labelRef", attrs: REF_ATTRS, at: p.from + 2 });
    expect(res.refused).toBe(false);
    expect(countOfType(editor, "labelRef")).toBe(1);
    expect(countOfType(editor, "codeBlock")).toBe(1);
    editor.destroy();
  });

  it("CONTROL — a selection wholly inside prose is unchanged: cells lit, atom lands", () => {
    const editor = mountFixture();
    const ref = selectInnerText(editor, "paragraph");
    for (const { id } of INLINE_ATOM_ROWS) expect(decorate(id, ref, editor)).toBe("ok");
    runRow(editor, "inline-math", ref);
    expect(countOfType(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });

  it("CONTROL — a selection from the title INTO prose stays allowed (both hosts host)", () => {
    const editor = mountFixture();
    const t = rangeInside(editor, "titleField");
    const p = rangeInside(editor, "paragraph");
    const from = Math.floor((t.from + t.to) / 2);
    const to = Math.floor((p.from + p.to) / 2);
    const ref: ActionRef = { kind: "selection", from, to, paragraphId: "" };
    for (const { id } of INLINE_ATOM_ROWS) expect(decorate(id, ref, editor)).toBe("ok");
    editor.destroy();
  });

  it("CONTROL — a caret in prose is unchanged", () => {
    const editor = mountFixture();
    const ref = cursorRefInside(editor, "paragraph");
    for (const { id } of INLINE_ATOM_ROWS) expect(decorate(id, ref, editor)).toBe("ok");
    editor.destroy();
  });
});
