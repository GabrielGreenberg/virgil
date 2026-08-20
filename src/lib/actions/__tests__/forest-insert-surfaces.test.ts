// @vitest-environment jsdom
//
// Task 385 — the INSERTION surfaces for `forestBlock` (the 383 node / 384
// renderer cluster's third stage) and the `\usepackage{forest}` plumbing.
//
// The two surfaces are the slash command `\forest` and the lightning grid's
// tree cell, and the whole point of routing both through ONE registry row is
// that they cannot disagree about the starter bytes, the uuid mint, the
// container guard or the collab gate. So every behavioural leg below drives
// BOTH and asserts the SAME node — a suite that exercised one surface at a
// time could not represent a divergence between them, which is the shape this
// repo keeps re-learning (`card-body-inline-parity`, `card-anchor-two-renderers`).
//
// Three legs carry teeth beyond the behaviour:
//
//   * the STARTER PARSES. The starter template's one real constraint is a fact
//     about the 384 GRAMMAR — a starter outside the v1 whitelist would open
//     badge-first, i.e. a new user's very first tree telling them Virgil can't
//     draw it. Nothing else in the codebase asks that question.
//   * the CENSUS. The row was never the part that could misbehave; a CELL that
//     builds its own ActionContext is (the `\tex` cell beside it does exactly
//     that — no `canEdit` — which is the known task-228 member-5 trap), and so
//     is a second site minting its own starter bytes. Neither is visible to any
//     behavioural test of `forestRun`.
//   * the GRAB-BAR bucket is DERIVED, not hand-added — one leg off the real
//     `TEXT_OBJECT_REGISTRY` derivation rather than a hand-written row list.
//
// Measured by neutering each half of `forestRun` in turn: replacing the
// selection COLLAPSE with a delete takes 2 legs, dropping the container guard 1,
// dropping the collab gate 1. The two SLASH refusal legs pass either way and
// say so here rather than pretending to teeth they lack — `runViewOnlyAction`
// consults `applies()` and `view.editable` before it ever reaches the row, so
// on that surface the row's own guards are defence-in-depth. They are still
// worth pinning: the grid path has no such pre-gate, and a future surface that
// calls the row directly inherits whichever guard the row itself carries.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the
// same gotcha every sibling action test carries.)

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
import type { JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  SLASH_NAME_TO_ACTION_ID,
  type ActionContext,
} from "@/lib/actions/action-registry";
import { blockRangeAllowsAction } from "@/text-objects/text-object-registry";
import { freshForestSource, parseForestSource } from "@/lib/forest/grammar";
import { serializeToLatex } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

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

function placeCaret(editor: Editor, caretOffset = 1): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + caretOffset),
    ),
  );
}

function selectRange(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + from, 1 + to),
    ),
  );
}

function firstForest(editor: Editor): PMNode | null {
  let found: PMNode | null = null;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === "forestBlock") found = node;
    return !found;
  });
  return found;
}

function countForests(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "forestBlock") n += 1;
    return true;
  });
  return n;
}

/** Drive the SLASH surface exactly as `executeSelection` does. */
function runSlash(editor: Editor): void {
  COMMAND_MAP.get("forest")!.action(editor.view, "\\forest");
}

/** Drive the LIGHTNING surface exactly as `ActionsMenuPanel.runGridAction`
 *  does — the same view-only ActionContext shape, `surface: "lightning"`, with
 *  `canEdit` threaded (the field the `\tex` cell's private builder omits). */
function runGrid(editor: Editor, canEdit = true): void {
  const ctx: ActionContext = {
    editor,
    view: editor.view,
    ref: {
      kind: "selection",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      paragraphId: "",
    },
    surface: "lightning",
    canEdit,
  } as ActionContext;
  VIRGIL_ACTION_REGISTRY.forest.run(ctx);
}

const SURFACES: ReadonlyArray<[string, (editor: Editor) => void]> = [
  ["slash \\forest", runSlash],
  ["lightning grid cell", (editor) => runGrid(editor)],
];

// A BARE preamble: `CLASSIC_PREAMBLE` already ships several packages, so
// against the default seed "did this inject one?" has no observable answer.
const BARE_PREAMBLE = "\\documentclass{article}\n\\begin{document}\n";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (1) Both surfaces land the SAME node — starter bytes + a fresh uuid
// ---------------------------------------------------------------------------

describe("both insertion surfaces land one node", () => {
  for (const [name, run] of SURFACES) {
    it(`${name} inserts a forestBlock carrying the starter template and a fresh uuid`, () => {
      const editor = mountEditor([paragraph("Hello world")]);
      placeCaret(editor, 5);
      run(editor);

      const forest = firstForest(editor);
      expect(forest).not.toBeNull();
      expect(forest!.attrs.source).toBe(freshForestSource());
      expect(typeof forest!.attrs.uuid).toBe("string");
      expect((forest!.attrs.uuid as string).length).toBeGreaterThan(0);
    });

    it(`${name} mints a uuid that does not collide with an existing forestBlock`, () => {
      const editor = mountEditor([
        { type: "forestBlock", attrs: { uuid: "abcd", source: freshForestSource() } },
        paragraph("Hello world"),
      ]);
      // Caret in the paragraph (the second top-level block).
      const paraPos = editor.state.doc.child(0).nodeSize + 1;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, paraPos + 2),
        ),
      );
      run(editor);

      const uuids: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "forestBlock") uuids.push(node.attrs.uuid as string);
        return true;
      });
      expect(uuids).toHaveLength(2);
      expect(new Set(uuids).size).toBe(2);
    });
  }

  it("the two surfaces produce byte-identical nodes (one shared creator)", () => {
    const a = mountEditor([paragraph("Hello world")]);
    placeCaret(a, 5);
    runSlash(a);
    const b = mountEditor([paragraph("Hello world")]);
    placeCaret(b, 5);
    runGrid(b);

    const fa = firstForest(a)!;
    const fb = firstForest(b)!;
    expect(fa.type.name).toBe(fb.type.name);
    expect(fa.attrs.source).toBe(fb.attrs.source);
  });
});

// ---------------------------------------------------------------------------
// (2) SELECTION POLICY — collapse, never delete
// ---------------------------------------------------------------------------

describe("a live selection is preserved, not consumed", () => {
  for (const [name, run] of SURFACES) {
    it(`${name} keeps the selected prose intact`, () => {
      const editor = mountEditor([paragraph("alpha beta gamma")]);
      selectRange(editor, 6, 10); // "beta"
      run(editor);

      expect(firstForest(editor)).not.toBeNull();
      // Nothing of the user's text may have been eaten: a forest tree cannot
      // absorb prose (unlike `\tex`, which seeds its `code` from it), so
      // deleting the selection would be pure loss with nothing bought.
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, " ");
      expect(text).toContain("alpha");
      expect(text).toContain("beta");
      expect(text).toContain("gamma");
    });
  }
});

// ---------------------------------------------------------------------------
// (3) The two refusals — the collab gate and the container guard
// ---------------------------------------------------------------------------

describe("refusals", () => {
  it("the grid cell inserts NOTHING without the pen (canEdit false)", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    placeCaret(editor, 5);
    runGrid(editor, false);
    expect(countForests(editor)).toBe(0);
  });

  it("the slash command inserts NOTHING on a non-editable view", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    placeCaret(editor, 5);
    editor.setEditable(false);
    runSlash(editor);
    expect(countForests(editor)).toBe(0);
  });

  for (const [name, run] of SURFACES) {
    it(`${name} refuses a caret inside a titleField (the container guard)`, () => {
      const editor = mountEditor([
        {
          type: "titleField",
          attrs: { field: "title" },
          content: [{ type: "text", text: "A Paper" }],
        },
        paragraph("Body text"),
      ]);
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)),
      );
      run(editor);
      // A block atom spliced into a `titleField` would SPLIT it into two
      // `\title{}` — silent data loss on reload (task 147).
      expect(countForests(editor)).toBe(0);
    });

    it(`${name} greys out at that same caret (applies() and run() agree)`, () => {
      const editor = mountEditor([
        {
          type: "titleField",
          attrs: { field: "title" },
          content: [{ type: "text", text: "A Paper" }],
        },
        paragraph("Body text"),
      ]);
      void run; // this leg asks the gate, not the run
      const ctx = {
        editor,
        view: editor.view,
        ref: { kind: "cursor", pos: 3, paragraphId: "" },
        surface: "lightning",
        canEdit: true,
      } as unknown as ActionContext;
      expect(VIRGIL_ACTION_REGISTRY.forest.applies(ctx)).toBe("disabled");
    });
  }
});

// ---------------------------------------------------------------------------
// (4) The starter template PARSES — it must never open badge-first
// ---------------------------------------------------------------------------

describe("the starter template is subset-clean", () => {
  it("parses through the real forest grammar with no refusal", () => {
    const result = parseForestSource(freshForestSource());
    expect(result.ok).toBe(true);
  });

  it("draws a real tree (a root and two children), not an empty one", () => {
    const result = parseForestSource(freshForestSource());
    if (!result.ok) throw new Error(`starter refused: ${result.refusal.message}`);
    expect(result.tree.labelText).toBe("S");
    expect(result.tree.children.map((c) => c.labelText)).toEqual(["NP", "VP"]);
  });
});

// ---------------------------------------------------------------------------
// (5) Round trip — what the surfaces insert survives a save/reload
// ---------------------------------------------------------------------------

describe("the inserted node round-trips", () => {
  it("serializes to the starter bytes and re-parses to a forestBlock", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    placeCaret(editor, 5);
    runSlash(editor);

    const latex = serializeToLatex(editor.getJSON() as JSONContent, {
      preamble: BARE_PREAMBLE,
    });
    expect(latex).toContain(freshForestSource());

    const body = latex.split("\\begin{document}")[1] ?? "";
    const reparsed = parseLatex(body);
    const kinds = (reparsed.content ?? []).map((n) => n.type);
    expect(kinds).toContain("forestBlock");
  });
});

// ---------------------------------------------------------------------------
// (6) The package plumbing — declared from the NODE MODEL
// ---------------------------------------------------------------------------

function forestDoc(): JSONContent {
  return {
    type: "doc",
    content: [{ type: "forestBlock", attrs: { uuid: "aaaa", source: freshForestSource() } }],
  };
}

function usepackageCount(latex: string, id: string): number {
  const preamble = latex.split("\\begin{document}")[0] ?? "";
  const re = new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b${id}\\b[^}]*\\}`, "g");
  return (preamble.match(re) ?? []).length;
}

describe("\\usepackage{forest} plumbing", () => {
  it("a document holding a tree gains the package exactly once", () => {
    const latex = serializeToLatex(forestDoc(), { preamble: BARE_PREAMBLE });
    expect(usepackageCount(latex, "forest")).toBe(1);
  });

  it("a preamble that already loads it gains nothing (idempotent)", () => {
    const latex = serializeToLatex(forestDoc(), {
      preamble: "\\documentclass{article}\n\\usepackage{forest}\n\\begin{document}\n",
    });
    expect(usepackageCount(latex, "forest")).toBe(1);
  });

  it("a document with no tree does not gain it (the control)", () => {
    const latex = serializeToLatex(
      { type: "doc", content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Plain prose." }] }] },
      { preamble: BARE_PREAMBLE },
    );
    expect(usepackageCount(latex, "forest")).toBe(0);
  });

  it("an inserted tree carries the package all the way to the saved bytes", () => {
    const editor = mountEditor([paragraph("Hello world")]);
    placeCaret(editor, 5);
    runGrid(editor);
    const latex = serializeToLatex(editor.getJSON() as JSONContent, {
      preamble: BARE_PREAMBLE,
    });
    expect(usepackageCount(latex, "forest")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (7) The grab-bar / selection-menu bucket is DERIVED, not hand-added
// ---------------------------------------------------------------------------

describe("the block-atom action bucket reaches forestBlock by derivation", () => {
  it("offers the block lifecycle actions and withholds the inline inserts", () => {
    const editor = mountEditor([
      { type: "forestBlock", attrs: { uuid: "abcd", source: freshForestSource() } },
    ]);
    const from = 0;
    const to = editor.state.doc.child(0).nodeSize;
    // The block-range gate reads the kind's `actions` bucket off
    // `TEXT_OBJECT_REGISTRY` (383's row: `ATOM_BLOCK_ACTIONS`), so nothing here
    // is hand-listed per surface.
    expect(blockRangeAllowsAction(editor.state.doc, from, to, "archive")).toBe(true);
    expect(blockRangeAllowsAction(editor.state.doc, from, to, "delete")).toBe(true);
    // No inline position inside a tree for these to land at.
    expect(blockRangeAllowsAction(editor.state.doc, from, to, "footnote")).toBe(false);
    expect(blockRangeAllowsAction(editor.state.doc, from, to, "citation")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (8) CENSUS — the leg with teeth
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..", "..", "..");
const PANEL = join(ROOT, "src", "components", "ActionsMenuPanel.tsx");
const COMMANDS = join(ROOT, "src", "lib", "tiptap", "commands.ts");

// Comments blanked, LITERALS KEPT: every needle here lives inside quotes (a
// JSX attribute value, a dispatch argument, the starter's own bytes), so
// `codeOnly` — which blanks literals too — would make every leg vacuous.
function readCode(path: string): string {
  return commentsStripped(readFileSync(path, "utf8"));
}

describe("census — both surfaces enter the SHARED dispatch", () => {
  it("the grid cell dispatches through runGridAction, never a private builder", () => {
    const src = readCode(PANEL);
    // The cell exists…
    expect(src).toMatch(/id="forest"/);
    // …and routes through the shared view-only ctx builder, which is the ONE
    // place `canEdit` is threaded. The `\tex` cell beside it still calls
    // `insertTexBlock(editor)` and builds its own ActionContext with no
    // `canEdit` — the known task-228 member-5 trap. A new cell must not copy it.
    expect(src).toContain('runGridAction("forest")');
    // Nothing may mint the starter bytes here: the SSOT is `freshForestSource`
    // on the grammar leaf, reached through the registry row.
    expect(src).not.toContain("begin{forest}");
    expect(src).not.toContain("freshForestSource");
  });

  it("the slash command routes through the registry row, not a hand-built node", () => {
    const src = readCode(COMMANDS);
    expect(src).toContain('runViewOnlyAction("forest"');
    expect(src).not.toContain("forestBlock");
    expect(src).not.toContain("freshForestSource");
  });

  it("the slash name is reconciled with the action vocabulary", () => {
    expect(SLASH_NAME_TO_ACTION_ID.forest).toBe("forest");
    expect(VIRGIL_ACTION_REGISTRY.forest.slashName).toBe("forest");
    expect(VIRGIL_ACTION_REGISTRY.forest.surfaces.slash).toBe(true);
    expect(VIRGIL_ACTION_REGISTRY.forest.surfaces.lightning).toBe(true);
  });

  it("exactly ONE production site mints the starter TREE", () => {
    // The template's home is the grammar leaf (beside the whitelist its parse
    // is a contract against); every insertion surface reads it there. A second
    // literal is how the two surfaces come to seed different trees.
    //
    // The needle is the starter's own BODY (`[NP]` beside `[VP]`), not the env
    // name: `\begin{forest}` is legitimately spelled by the parser and the
    // serializer, which claim and re-emit the environment — a census on the env
    // would indict the two files that have to know it and say nothing about the
    // thing that must not be duplicated.
    const files = collectSources(join(ROOT, "src"));
    const spellers = files.filter((f) => {
      const code = commentsStripped(readFileSync(f, "utf8"));
      return code.includes("[NP]") && code.includes("[VP]");
    });
    expect(spellers.map((f) => f.slice(ROOT.length + 1))).toEqual([
      join("src", "lib", "forest", "grammar.ts"),
    ]);
  });
});

function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      collectSources(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}
