// @vitest-environment jsdom
//
// Task 150 — the TYPED math input rules (`$…$` inline, `$$…$$` display) must
// honor the caret's CONTAINING block, exactly as the typed cite/footnote rules
// (061) and the lightning-grid block-atom inserts (147) already do. These are
// raw PM `handleTextInput` plugins (NOT the TipTap `inputRulesPlugin`, which
// refuses to fire inside `code` nodes) — so they DO fire inside a `codeBlock`,
// which is precisely why the verbatim corruption below is reachable.
//
// THE BUG THIS PINS (data-loss / structural corruption):
//   • Typed `$$` inserts a `displayMath` BLOCK. At a caret inside titleField /
//     codeBlock / latexComment (none of which can host a block child) the fitter
//     SPLITS the container. For titleField the title text is consumed/dropped →
//     `\title{}` loses it = silent data-loss on reload. For the verbatim
//     codeBlock / latexComment the block fractures = structural corruption.
//   • Typed inline `$x$` inserts an inline atom — valid in a titleField
//     (`inline*`) but SPLITTING the `text*` verbatim codeBlock / latexComment
//     (they admit literal text only), fabricating a stray paragraph.
//
// WHAT IS PROVEN (driving the REAL `buildEditorExtensions` stack + REAL schema +
// REAL serializer via PM's own `view.someProp("handleTextInput", …)` dispatch —
// only `@/lib/storage` is stubbed, per the extension-barrel gotcha):
//   1. Typed `$$` (both the `$$`-on-empty case AND the `$$x$$` closing case)
//      inserts NO displayMath and leaves the top-level structure unchanged in
//      all three non-hosting containers.
//   2. Typed inline `$x$` inserts NO inlineMath (no split, no stray paragraph)
//      in codeBlock / latexComment, but STILL converts inside a titleField (the
//      atom lands in the title) — the guard is a container gate, not a kill.
//   3. Positive control: in a plain paragraph every typed rule still fires.
//   4. Serializer proof: after a typed `$$`/`$x$` at a titleField caret the
//      `\title{…}` still round-trips the title text — the data-loss is gone.
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
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
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

// jsdom has no layout engine; mounting the full editor / katex NodeView never
// needs real rects here (the typed rules do a bare `replaceWith`), but shim the
// rect APIs defensively so nothing throws on mount.
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

/**
 * Mount a real main editor whose FIRST block is `containerType` seeded with
 * `seedText`, followed by a trailing paragraph — matching the audit's
 * `[container, paragraph]` before-state. Returns the editor and the caret
 * position at the END of the seeded text (where the closing `$` would be typed).
 */
function mountWithSeed(
  containerType: string,
  seedText: string,
): { editor: Editor; caret: number } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const attrs =
    containerType === "titleField" ? { field: "title", uuid: "c-A" } : { uuid: "c-A" };
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: containerType,
          attrs,
          content: seedText ? [{ type: "text", text: seedText }] : [],
        },
        { type: "paragraph", attrs: { uuid: "tail-A" }, content: [{ type: "text", text: "tail" }] },
      ],
    },
  });
  // Caret at end of the seeded container text: container opens at doc pos 0, its
  // inner content starts at pos 1, so the end of `seedText` is `1 + length`.
  return { editor, caret: 1 + seedText.length };
}

/**
 * Fire PM's REAL `handleTextInput` dispatch for a closing `$` typed at `pos`
 * (exactly the contract ProseMirror uses). Returns whether SOME plugin claimed
 * the input (true = a rule fired & dispatched; false = it fell through as a
 * literal char).
 */
function typeClosingDollar(editor: Editor, pos: number): boolean {
  const view = editor.view;
  // The 5th `deflt` arg (the default-insertion Transaction factory) is unused by
  // the math rules — they destructure only `(view, from, _to, text)`.
  return !!view.someProp("handleTextInput", (f) =>
    f(view, pos, pos, "$", () => view.state.tr),
  );
}

function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node: PMNode) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

function topLevelNames(editor: Editor): string[] {
  const names: string[] = [];
  editor.state.doc.forEach((node: PMNode) => names.push(node.type.name));
  return names;
}

/** The `latex` attr of the first node of `typeName`, or undefined. */
function firstLatexOf(editor: Editor, typeName: string): string | undefined {
  let latex: string | undefined;
  editor.state.doc.descendants((node: PMNode) => {
    if (latex !== undefined || node.type.name !== typeName) return latex === undefined;
    latex = (node.attrs.latex as string) ?? "";
    return false;
  });
  return latex;
}

const NON_HOSTING = ["titleField", "codeBlock", "latexComment"] as const;
const VERBATIM = ["codeBlock", "latexComment"] as const;

beforeEach(() => {
  installLayoutShims();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Typed `$$` (display block) — bails in every non-hosting container
// ───────────────────────────────────────────────────────────────────────────

describe("typed `$$` display-math honors the containing block (task 150)", () => {
  // Case 1 (`$$`-on-empty): seed "$", type the closing "$".
  // Case 2 (`$$x$$` closing): seed "$$x$", type the closing "$".
  for (const [label, seed] of [["$$-on-empty", "$"], ["$$x$$-closing", "$$x$"]] as const) {
    for (const container of NON_HOSTING) {
      it(`${label} at a ${container} caret inserts NO displayMath, no split`, () => {
        const { editor, caret } = mountWithSeed(container, seed);
        const fired = typeClosingDollar(editor, caret);

        expect(fired, "rule must fall through (not fire)").toBe(false);
        expect(countOfType(editor, "displayMath"), "displayMath count").toBe(0);
        // Container not split — still exactly `[container, paragraph]`.
        expect(topLevelNames(editor)).toEqual([container, "paragraph"]);
        editor.destroy();
      });
    }
  }

  it("positive control: `$$`-on-empty in a plain paragraph DOES insert displayMath", () => {
    const { editor, caret } = mountWithSeed("paragraph", "$");
    const fired = typeClosingDollar(editor, caret);
    expect(fired).toBe(true);
    expect(countOfType(editor, "displayMath")).toBe(1);
    editor.destroy();
  });

  it("positive control: `$$x$$`-closing in a plain paragraph DOES insert displayMath", () => {
    const { editor, caret } = mountWithSeed("paragraph", "$$x$");
    const fired = typeClosingDollar(editor, caret);
    expect(fired).toBe(true);
    expect(countOfType(editor, "displayMath")).toBe(1);
    expect(firstLatexOf(editor, "displayMath")).toBe("x");
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Typed inline `$x$` — bails in the verbatim blocks, converts in a title
// ───────────────────────────────────────────────────────────────────────────

describe("typed inline `$x$` honors the containing block (task 150)", () => {
  for (const container of VERBATIM) {
    it(`\`$x$\` at a ${container} caret inserts NO inlineMath, no split/stray paragraph`, () => {
      const { editor, caret } = mountWithSeed(container, "$x");
      const fired = typeClosingDollar(editor, caret);

      expect(fired, "rule must fall through (not fire)").toBe(false);
      expect(countOfType(editor, "inlineMath"), "inlineMath count").toBe(0);
      // No split, no fabricated paragraph — still `[container, paragraph]`.
      expect(topLevelNames(editor)).toEqual([container, "paragraph"]);
      editor.destroy();
    });
  }

  it("`$x$` at a titleField caret STILL converts (atom lands inside the title)", () => {
    const { editor, caret } = mountWithSeed("titleField", "$x");
    const fired = typeClosingDollar(editor, caret);

    expect(fired, "inline math is valid in a title — must fire").toBe(true);
    expect(countOfType(editor, "inlineMath")).toBe(1);
    // The atom is a CHILD of the (un-split) titleField.
    expect(topLevelNames(editor)).toEqual(["titleField", "paragraph"]);
    const title = editor.state.doc.firstChild!;
    expect(title.type.name).toBe("titleField");
    expect(title.firstChild?.type.name).toBe("inlineMath");
    expect(title.firstChild?.attrs.latex).toBe("x");
    editor.destroy();
  });

  it("positive control: `$x$` in a plain paragraph still converts", () => {
    const { editor, caret } = mountWithSeed("paragraph", "$x");
    const fired = typeClosingDollar(editor, caret);
    expect(fired).toBe(true);
    expect(countOfType(editor, "inlineMath")).toBe(1);
    editor.destroy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Serializer proof — the title text round-trips (no data-loss)
// ───────────────────────────────────────────────────────────────────────────

describe("typed math at a titleField caret preserves \\title on the round-trip (task 150)", () => {
  it("a typed `$$`-close after real title text drops NO title text / no displayMath", () => {
    // Real title text followed by a `$$x$` the user is about to close with `$`.
    const { editor, caret } = mountWithSeed("titleField", "Real Title $$x$");
    typeClosingDollar(editor, caret);

    expect(countOfType(editor, "displayMath")).toBe(0);
    expect(countOfType(editor, "titleField")).toBe(1);
    const tex = serializeToLatex(editor.getJSON());
    expect(tex).toMatch(/\\title\{[^}]*Real Title/);
    editor.destroy();
  });

  it("a typed `$$`-on-empty consuming the sole title char keeps the title non-empty", () => {
    // The audit's exact case-1 repro: title content is just "$"; without the
    // guard it is consumed into an (empty) displayMath → `\title{}` = data-loss.
    const { editor, caret } = mountWithSeed("titleField", "$");
    typeClosingDollar(editor, caret);

    expect(countOfType(editor, "displayMath")).toBe(0);
    expect(countOfType(editor, "titleField")).toBe(1);
    // The title still has its content (the `$` survived as literal text).
    expect(editor.state.doc.firstChild!.textContent).toBe("$");
    editor.destroy();
  });
});
