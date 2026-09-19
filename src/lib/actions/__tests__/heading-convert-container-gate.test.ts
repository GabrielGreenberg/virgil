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
//
// Task 153 EXTENDS this file (section 6): the BlockType dropdown's OUT-of-scope
// levels 0/5/6 (Part / Paragraph heading / Subparagraph heading) have no
// registry row and fall through to a bare `setNode("heading")` that never
// reaches `headingRun`, so 149's bail never ran on them. `pickBlockType` now
// gates that fallback on the SAME `posHostsBlockInsert` predicate — one gate,
// every heading-convert surface.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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
import { pickBlockType } from "@/components/MenuBar";

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

// ───────────────────────────────────────────────────────────────────────────
// 6. The BlockType dropdown's OUT-of-scope levels (task 153)
//
// Levels 0 (Part) / 5 (Paragraph heading) / 6 (Subparagraph heading) have no
// registry row, so `applyHeadingFromDropdown` falls through to a bare
// `setNode("heading", {level})` that NEVER reaches `headingRun` — bypassing
// 149's container bail. The same in-place conversion 149 proved corrupts a
// titleField / codeBlock / latexComment. Task 153 gates that fallback on the
// SAME `posHostsBlockInsert` SSOT, so `pickBlockType(editor, "0"|"5"|"6")` is a
// no-op inside a protected block — matching the levels-1–4 behavior 149 gives.
// ───────────────────────────────────────────────────────────────────────────

const DROPDOWN_OUT_OF_SCOPE = ["0", "5", "6"] as const;

describe("BlockType dropdown out-of-scope levels honor the containing block (task 153)", () => {
  for (const container of PROTECTED) {
    for (const level of DROPDOWN_OUT_OF_SCOPE) {
      it(`pickBlockType(${level}) at a mid-${container} caret preserves it and creates no heading`, () => {
        const editor = mountFixture();
        placeCaretAt(editor, midInside(editor, container));
        const before = countOfType(editor, container);

        pickBlockType(editor, level);

        expect(countOfType(editor, container), `${container} count`).toBe(before);
        expect(countOfType(editor, "heading"), `heading count`).toBe(0);
        editor.destroy();
      });
    }
  }

  it("serializer proof: after every out-of-scope dropdown pick the full \\title{...} survives", () => {
    const editor = mountFixture();
    for (const level of DROPDOWN_OUT_OF_SCOPE) {
      placeCaretAt(editor, midInside(editor, "titleField"));
      pickBlockType(editor, level);
    }
    // Exactly one titleField remains; no heading was minted — the data-loss
    // (\title{X} re-emitting as \part{X} on reload) can no longer occur.
    expect(countOfType(editor, "titleField")).toBe(1);
    expect(countOfType(editor, "heading")).toBe(0);
    const tex = serializeToLatex(editor.getJSON());
    expect(tex).toContain("\\title{My Paper Title}");
    editor.destroy();
  });

  it("prose still converts: pickBlockType('0') at a paragraph caret produces a heading@level0 (no over-gating)", () => {
    const editor = mountFixture();
    placeCaretAt(editor, midInside(editor, "paragraph"));

    pickBlockType(editor, "0");

    expect(countOfType(editor, "heading")).toBe(1);
    let level: number | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading" && level === null) level = node.attrs.level as number;
      return true;
    });
    expect(level).toBe(0); // Part = level 0
    editor.destroy();
  });

  it("prose still converts: pickBlockType('5') and ('6') at a paragraph caret still create a heading", () => {
    for (const level of ["5", "6"] as const) {
      const editor = mountFixture();
      placeCaretAt(editor, midInside(editor, "paragraph"));
      pickBlockType(editor, level);
      expect(countOfType(editor, "heading"), `level ${level}`).toBe(1);
      editor.destroy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Task 641 — the RANGE half of the convert path. `setBlockType(from, to, …)`
// converts EVERY textblock in the range whose parent can host the target, and
// `latexComment` / `codeBlock` are textblocks whose parent is `doc` — which
// hosts a heading anywhere — so ProseMirror greenlights them and Virgil's own
// predicate is the ONLY protection. Asked at `from` alone (task 149's caret
// form) a [paragraph … latexComment] selection sailed through and the verbatim
// block was CONVERTED, promoting commented-out source into the typeset
// document; a [titleField … paragraph] selection converted the preamble
// singleton away (silent \title{} loss on the next save).
//
// `applies()` could not veto either: its walker is an EXISTENCE quantifier
// (`if (applicable) break`) that skips a protected block with `return
// undefined` while `applicable` stays true from an earlier convertible one. The
// universal half is now asked FIRST, by the same range predicate the block
// INSERT gate uses, so the two surfaces of one question can't diverge.
//
// Every leg asserts the DOCUMENT IS UNCHANGED, not merely a false return.
// ───────────────────────────────────────────────────────────────────────────

/** Select `[from, to]` on the live view. */
function selectRange(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
}

/** The doc position of the START of the first `nodeName`'s inner content. */
function innerStartOf(editor: Editor, nodeName: string): number {
  let pos: number | null = null;
  editor.state.doc.descendants((node: PMNode, p: number) => {
    if (pos !== null || node.type.name !== nodeName) return true;
    pos = p + 1;
    return false;
  });
  if (pos === null) throw new Error(`no ${nodeName} mounted`);
  return pos;
}

/** The heading row's applies() verdict for the live selection. */
function appliesForSelection(editor: Editor, id: ActionId): "ok" | "disabled" | "absent" {
  const row = VIRGIL_ACTION_REGISTRY[id];
  if (!row) throw new Error(`no registry row for ${id}`);
  const { from, to } = editor.state.selection;
  const ref: ActionRef = { kind: "selection", from, to, paragraphId: "" };
  return row.applies({ ref, view: editor.view, editor } as ActionContext);
}

/** Run a heading row over the live selection, EditorPane-style. */
function runHeadingRow(editor: Editor, id: ActionId): void {
  const row = VIRGIL_ACTION_REGISTRY[id];
  if (!row) throw new Error(`no registry row for ${id}`);
  const { from, to } = editor.state.selection;
  const ref: ActionRef = { kind: "selection", from, to, paragraphId: "" };
  void row.run({ ref, view: editor.view, editor, surface: "lightning" } as ActionContext);
}

describe("heading convert covers the whole RANGE it sets (task 641)", () => {
  for (const container of PROTECTED) {
    it(`\\section over a [paragraph … ${container}] selection leaves the document byte-identical`, () => {
      const editor = mountFixture();
      // Order in the fixture is titleField, paragraph, codeBlock, latexComment:
      // start at whichever of the two comes first so the range always spans both.
      const a = innerStartOf(editor, "paragraph") + 2;
      const b = innerStartOf(editor, container) + 2;
      selectRange(editor, Math.min(a, b), Math.max(a, b));
      const before = JSON.stringify(editor.getJSON());

      runHeadingRow(editor, "heading-section");

      expect(JSON.stringify(editor.getJSON())).toBe(before);
      expect(countOfType(editor, container)).toBe(1);
      editor.destroy();
    });

    it(`the heading affordance greys for a [paragraph … ${container}] selection`, () => {
      const editor = mountFixture();
      const a = innerStartOf(editor, "paragraph") + 2;
      const b = innerStartOf(editor, container) + 2;
      selectRange(editor, Math.min(a, b), Math.max(a, b));

      expect(appliesForSelection(editor, "heading-section")).toBe("disabled");
      editor.destroy();
    });

    it(`pickBlockType('5') over a [paragraph … ${container}] selection leaves the document byte-identical`, () => {
      const editor = mountFixture();
      const a = innerStartOf(editor, "paragraph") + 2;
      const b = innerStartOf(editor, container) + 2;
      selectRange(editor, Math.min(a, b), Math.max(a, b));
      const before = JSON.stringify(editor.getJSON());

      pickBlockType(editor, "5");

      expect(JSON.stringify(editor.getJSON())).toBe(before);
      editor.destroy();
    });
  }

  it("serializer proof: after a [titleField … paragraph] \\section the full \\title{...} survives", () => {
    const editor = mountFixture();
    const a = innerStartOf(editor, "titleField") + 2;
    const b = innerStartOf(editor, "paragraph") + 2;
    selectRange(editor, a, b);

    runHeadingRow(editor, "heading-section");

    expect(countOfType(editor, "titleField")).toBe(1);
    expect(countOfType(editor, "heading")).toBe(0);
    expect(serializeToLatex(editor.getJSON())).toContain("\\title{My Paper Title}");
    editor.destroy();
  });

  it("an all-prose multi-paragraph selection still converts EVERY paragraph (no over-gating)", () => {
    const editor = mount([
      { type: "paragraph", attrs: { uuid: "p-1" }, content: [{ type: "text", text: "First." }] },
      { type: "paragraph", attrs: { uuid: "p-2" }, content: [{ type: "text", text: "Second." }] },
    ]);
    selectRange(editor, 2, editor.state.doc.content.size - 2);

    expect(appliesForSelection(editor, "heading-section")).toBe("ok");
    runHeadingRow(editor, "heading-section");

    expect(countOfType(editor, "heading")).toBe(2);
    editor.destroy();
  });
});
