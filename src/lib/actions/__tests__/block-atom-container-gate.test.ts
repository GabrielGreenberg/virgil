// @vitest-environment jsdom
//
// Task 147 — the lightning GRID's block-atom INSERT cells (example / display-
// math / `\tex` / figure / graphics) must honor the caret's CONTAINING block,
// exactly as the card rows (task 061/145) and the wrapper cells already do.
//
// THE BUG THIS PINS (data-loss / corruption): a `titleField` is anchorable and
// its content is `inline*`, so a focused mid-text caret inside the Title shows
// the lightning bolt. A block atom can't be an `inline*` child, so at a
// mid-content caret ProseMirror's fitter SPLITS the non-defining `titleField` to
// place the block — leaving TWO `field:"title"` nodes with the SAME uuid. On
// save `collectPreambleTitleFields` dedups first-occurrence-wins, so the second
// title's text is written NOWHERE → silent data-loss on reload. The same gesture
// in a `codeBlock` / `latexComment` splits the verbatim block in two → structural
// corruption. INLINE inserts (`$x$`, `\ref`) never split an `inline*` textblock
// → valid in a TITLE, which is why they cannot reuse the block gate. RENEGOTIATED
// (task 396): the CODE-BLOCK half of that sentence was FALSE. The markless
// verbatim blocks declare `content: "text*"`, so an inline atom there truncates
// the block and ejects its tail as live prose — task 150 falsified this premise
// one day after 147 recorded it and fixed only `math.ts`. The inline rows now
// take `inlineAtomInsertApplies` and are GREY in the two verbatim blocks; their
// own contract lives in `inline-atom-container-gate.test.tsx`. Here they survive
// only as the TITLE control: the one container where the two gates must differ.
//
// WHAT IS PROVEN (driving the REAL editor stack + REAL schema + REAL serializer —
// only `@/lib/storage` is stubbed, per the extension-barrel gotcha):
//   1. Applicability: a caret/selection inside titleField/codeBlock/latexComment
//      greys the five block-atom INSERT rows via the container-aware
//      `blockInsertApplies`; inline-math / `\ref` stay enabled in a TITLE (an
//      inline atom is legitimate in `inline*` — the whole reason the two gates
//      are separate predicates); prose keeps all block atoms enabled.
//   2. Run-helper defense-in-depth: `texRun` / `exampleRun` / `figureRun` /
//      `graphicsRun` / display-`mathRun` at a mid-title (or mid-code) caret BAIL —
//      the container stays a SINGLE node, no atom is inserted (covers the slash
//      `\tex`/`\ex` twins, which route through the same runs).
//   3. End-to-end serializer proof: after the bailed insert the doc still
//      serializes the full `\title{...}` — the data-loss can no longer occur.
//   4. Regression pin: a viewless ctx degrades to "ok" (the historic
//      short-circuit) — the gate is precisely the threaded live view.
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

/** Mount a real main editor holding a titleField + paragraph + codeBlock +
 *  latexComment, each seeded with text so a caret / selection lands inside. */
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

/** Set a collapsed caret at doc position `pos`. */
function placeCaretAt(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
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

// The five block-atom INSERT rows that SPLIT (gated by task 147) + the two
// INLINE inserts, which are legitimate in a `titleField` (`inline*`) and are
// separately gated by task 396 in the `text*` verbatim blocks — see that task's
// own suite. Named for the container in which they must stay ENABLED, because
// "ungated" is what task 396 retired.
const GATED_BLOCK_ATOMS: ActionId[] = ["example", "tex", "figure", "graphics", "display-math"];
const INLINE_IN_TITLE: ActionId[] = ["inline-math", "ref"];
// The block node each gated row would insert (for the run-bail count assertions).
const INSERTED_NODE: Record<string, string> = {
  example: "exampleBlock",
  tex: "texBlock",
  figure: "figureBlock",
  graphics: "graphicsBlock",
  "display-math": "displayMath",
};

// jsdom has no layout engine; figure/graphics call `editor.chain().focus()`
// (which hits `coordsAtPos` → `getClientRects`) BEFORE the container guard bails,
// so shim the rect APIs. rAF is stubbed synchronous (unreached on a bail, but the
// figure/graphics popover schedules on it — kept for safety).
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
let rafStub: ReturnType<typeof vi.spyOn> | undefined;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

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

// ───────────────────────────────────────────────────────────────────────────
// 1. Applicability — the container-aware grey-out (parity with 145/146 pins)
// ───────────────────────────────────────────────────────────────────────────

describe("block-atom INSERT cells honor the containing block (task 147)", () => {
  for (const container of ["titleField", "codeBlock", "latexComment"]) {
    it(`${container} caret greys every block-atom insert`, () => {
      const editor = mountFixture();
      for (const refMaker of [selectionRefInside, cursorRefInside]) {
        const ref = refMaker(editor, container);
        for (const id of GATED_BLOCK_ATOMS) {
          expect(decorate(id, ref, editor), `${container} × ${id}`).toBe("disabled");
        }
        // The inline rows' verdict here is task 396's, and it DIFFERS per
        // container — "ok" in the title, "disabled" in the two verbatim blocks —
        // so it is asserted in that task's suite rather than restated as one
        // value across all three (which is how the false half shipped).
        if (container === "titleField") {
          for (const id of INLINE_IN_TITLE) {
            expect(decorate(id, ref, editor), `${container} × ${id}`).toBe("ok");
          }
        }
      }
      editor.destroy();
    });
  }

  it("a prose (paragraph) caret leaves every block atom enabled", () => {
    const editor = mountFixture();
    for (const refMaker of [selectionRefInside, cursorRefInside]) {
      const ref = refMaker(editor, "paragraph");
      for (const id of [...GATED_BLOCK_ATOMS, ...INLINE_IN_TITLE]) {
        expect(decorate(id, ref, editor), `paragraph × ${id}`).toBe("ok");
      }
    }
    editor.destroy();
  });

  it("regression pin: a viewless ctx degrades to 'ok' — the gate IS the threaded view", () => {
    const editor = mountFixture();
    const ref = selectionRefInside(editor, "titleField");
    // With a view, gated (asserted above); without one, `blockInsertApplies`
    // hits its allow-all fallback (the minimal menu-decoration ctx). This
    // isolates the fix to the live view being threaded.
    for (const id of GATED_BLOCK_ATOMS) {
      expect(decorate(id, ref, null), `viewless ${id}`).toBe("ok");
    }
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 + 3. Run-helper defense-in-depth + the serializer data-loss proof
// ───────────────────────────────────────────────────────────────────────────

describe("block-atom run helpers BAIL inside a titleField/codeBlock (task 147)", () => {
  function ctxAtCaret(editor: Editor): ActionContext {
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
      openFigurePopover: vi.fn(),
    };
  }

  for (const container of ["titleField", "codeBlock"]) {
    for (const id of GATED_BLOCK_ATOMS) {
      it(`${id} at a mid-${container} caret does not split it or insert an atom`, () => {
        const editor = mountFixture();
        const r = rangeInside(editor, container);
        placeCaretAt(editor, Math.floor((r.from + r.to) / 2)); // MID-content
        const before = countOfType(editor, container);

        VIRGIL_ACTION_REGISTRY[id]!.run(ctxAtCaret(editor));

        // The container was NOT split — still exactly one node.
        expect(countOfType(editor, container), `${container} count`).toBe(before);
        // No atom block leaked into the doc.
        expect(countOfType(editor, INSERTED_NODE[id]), `${INSERTED_NODE[id]} count`).toBe(0);
        editor.destroy();
      });
    }
  }

  it("serializer proof: after a bailed insert the full \\title{...} survives (no data-loss)", () => {
    const editor = mountFixture();
    const r = rangeInside(editor, "titleField");
    placeCaretAt(editor, Math.floor((r.from + r.to) / 2));

    // Attempt every corrupting insert at the mid-title caret.
    for (const id of GATED_BLOCK_ATOMS) {
      VIRGIL_ACTION_REGISTRY[id]!.run(ctxAtCaret(editor));
    }

    // Exactly one titleField remains (never split into two `\title{}`).
    expect(countOfType(editor, "titleField")).toBe(1);
    // The serialized preamble carries the WHOLE title — the dedup-drop can't fire.
    const tex = serializeToLatex(editor.getJSON());
    expect(tex).toContain("\\title{My Paper Title}");
    editor.destroy();
  });
});
