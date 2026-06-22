// @vitest-environment jsdom
//
// CHIP 7b — the DA-5 selection-mode taxonomy + the UNIFORM collab read-only gate.
//
// WHAT IS PROVEN
//   (A) Selection-mode taxonomy (the declarative `selection` field):
//       1. EVERY registry row declares a `selection` mode (the taxonomy is
//          exhaustive), and the per-action assignment is correct:
//            - `highlight` is the ONLY `"required"` row;
//            - the atoms / inserts / lifecycle cards are `"optional"`;
//            - the marks / lists / quote / headings / title-fields are `"ignored"`.
//       2. `applies()` greys the right actions per mode:
//            - `highlight` → "disabled" at a collapsed caret / empty selection,
//              "ok" on a live range (selection-`"required"`);
//            - `bold` (and the other marks) → "ok" at a collapsed caret
//              (selection-`"ignored"` — toggles the stored mark);
//            - `footnote` / `citation` / `tex` / `example` / math → "ok" at a
//              collapsed caret (selection-`"optional"` — collapse-and-insert).
//   (B) The uniform collab read-only gate (`ctx.canEdit`):
//       3. with `canEdit: false`, EVERY action's `applies()` returns "disabled"
//          across the grab / lightning vocabulary (cards + atoms + blocks + format);
//       4. with `canEdit: false`, each canonical `run()` NO-OPS (no dispatch, no
//          doc mutation, no popover/seam call) — the bridge `runAction` path for
//          slash/typed reaches the SAME `run()`s, so this covers all 4 surfaces;
//       5. with `canEdit: true` / `undefined` (the no-over-gating default) NOTHING
//          changes — every action behaves exactly as before this chip.
//
// The extension barrel (pulled for the REAL schema) transitively imports
// `@/lib/storage`; stub it (same pattern as the sibling coverage test).
import { describe, it, expect, vi } from "vitest";

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

import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type ActionRef,
  type ActionSpec,
  type ActionSelectionMode,
} from "@/lib/actions/action-registry";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ALL_IDS = Object.keys(VIRGIL_ACTION_REGISTRY) as ActionId[];

// The grab / lightning vocabulary (the rows a menu surface can render + grey).
// Used by the collab-gate sweep — these are the surfaces whose `applies()` the
// React menus read at decoration time.
const GRAB_OR_LIGHTNING_IDS = ALL_IDS.filter((id) => {
  const r = VIRGIL_ACTION_REGISTRY[id]!;
  return r.surfaces.grab || r.surfaces.lightning;
});

const mainCtx = (): EditorExtensionsCtx => ({
  surface: "main",
  editable: true,
  cardContext: true,
  callbacks: {},
  docIdRef: null,
  host: { getMainEditor: () => null },
});

const schema = getSchema(buildEditorExtensions(mainCtx()));

const emptyDoc: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { uuid: "p0" }, content: [] }],
};

/** Build an ActionContext over a real (empty) EditorState, with an optional
 *  `canEdit` override threaded through. `applies()` reads only `ctx.ref` +
 *  `ctx.canEdit`; `run()` additionally reads `ctx.view`/`ctx.editor`/`ctx.dispatch`. */
function ctxFor(
  ref: ActionRef,
  opts: {
    canEdit?: boolean;
    dispatch?: ActionContext["dispatch"];
  } = {},
): ActionContext {
  const doc = PMNode.fromJSON(schema, emptyDoc);
  const state = EditorState.create({ schema, doc });
  const view = { state, dispatch: vi.fn() } as unknown as ActionContext["view"];
  const editor = {
    state,
    view,
    chain: () => {
      throw new Error("editor.chain() must not be reached when collab read-only");
    },
  } as unknown as ActionContext["editor"];
  return {
    editor,
    view,
    ref,
    surface: "grab",
    canEdit: opts.canEdit,
    dispatch: opts.dispatch,
  };
}

function row(id: ActionId): ActionSpec {
  const r = VIRGIL_ACTION_REGISTRY[id];
  if (!r) throw new Error(`no row for ${id}`);
  return r;
}

// Representative refs.
const cursor: ActionRef = { kind: "cursor", pos: 1, paragraphId: "p0" };
const emptySel: ActionRef = { kind: "selection", from: 3, to: 3, paragraphId: "p0" };
const liveSel: ActionRef = { kind: "selection", from: 1, to: 5, paragraphId: "p0" };
const paragraph: ActionRef = { kind: "paragraph", id: "p0" };

// ===========================================================================
// (A) The selection-mode taxonomy
// ===========================================================================

describe("DA-5 selection-mode taxonomy — the declarative `selection` field", () => {
  // The canonical per-id assignment. ONLY `highlight` is "required"; the
  // marks/lists/quote/headings/title-fields are "ignored"; everything else is
  // "optional". (This IS the taxonomy CHIP 7b designed — pinned so a row can't
  // silently change mode.)
  const EXPECTED_MODE: Readonly<Record<ActionId, ActionSelectionMode>> = {
    // cards
    highlight: "required",
    note: "optional",
    footnote: "optional",
    citation: "optional",
    todo: "optional",
    "suggest-edit": "optional",
    cutter: "optional",
    report: "optional",
    duplicate: "optional",
    archive: "optional",
    delete: "optional",
    // atom
    ref: "optional",
    // blocks — headings/title-fields are conversions/singletons ("ignored");
    // the inserts (tex/example/math/figure/graphics) are "optional".
    "heading-chapter": "ignored",
    "heading-section": "ignored",
    "heading-subsection": "ignored",
    "heading-subsubsection": "ignored",
    example: "optional",
    tex: "optional",
    figure: "optional",
    graphics: "optional",
    "inline-math": "optional",
    "display-math": "optional",
    title: "ignored",
    author: "ignored",
    date: "ignored",
    // format marks/lists/quote/color — toggles, valid at a caret
    bold: "ignored",
    italic: "ignored",
    strike: "ignored",
    code: "ignored",
    "bullet-list": "ignored",
    "ordered-list": "ignored",
    blockquote: "ignored",
    "text-color": "ignored",
  };

  it("EVERY row declares a `selection` mode (the taxonomy is exhaustive)", () => {
    for (const id of ALL_IDS) {
      expect(row(id).selection, `${id}.selection`).toBeDefined();
    }
  });

  it("each row's `selection` mode matches the canonical assignment", () => {
    for (const id of ALL_IDS) {
      expect(row(id).selection, `${id}.selection`).toBe(EXPECTED_MODE[id]);
    }
  });

  it("`highlight` is the ONLY selection-`required` action", () => {
    const required = ALL_IDS.filter((id) => row(id).selection === "required");
    expect(required).toEqual(["highlight"]);
  });
});

describe("applies() greys the right actions per selection mode (cursor mode)", () => {
  it("`highlight` (required) → disabled at a collapsed caret + empty selection, ok on a live range", () => {
    expect(row("highlight").applies(ctxFor(cursor))).toBe("disabled");
    expect(row("highlight").applies(ctxFor(emptySel))).toBe("disabled");
    expect(row("highlight").applies(ctxFor(liveSel))).toBe("ok");
    // A persistent block ref always resolves to a range → ok.
    expect(row("highlight").applies(ctxFor(paragraph))).toBe("ok");
  });

  it("mark toggles (ignored) → ok at a collapsed caret (they toggle the stored mark)", () => {
    for (const id of ["bold", "italic", "strike", "code"] as const) {
      expect(row(id).applies(ctxFor(cursor)), `${id} @ caret`).toBe("ok");
      expect(row(id).applies(ctxFor(liveSel)), `${id} @ range`).toBe("ok");
    }
  });

  it("list/quote/heading/title (ignored) → ok at a collapsed caret", () => {
    for (const id of [
      "bullet-list", "ordered-list", "blockquote",
      "heading-section", "title", "author", "date",
    ] as const) {
      expect(row(id).applies(ctxFor(cursor)), `${id} @ caret`).toBe("ok");
    }
  });

  it("atoms / inserts (optional) → ok at a collapsed caret (collapse-and-insert)", () => {
    for (const id of [
      "footnote", "citation", "ref", "tex", "example",
      "inline-math", "display-math", "figure", "graphics",
    ] as const) {
      expect(row(id).applies(ctxFor(cursor)), `${id} @ caret`).toBe("ok");
    }
  });

  it("annotation cards (optional) → ok at a collapsed caret", () => {
    for (const id of ["note", "todo", "suggest-edit", "cutter", "report"] as const) {
      expect(row(id).applies(ctxFor(cursor)), `${id} @ caret`).toBe("ok");
    }
  });
});

// ===========================================================================
// (B) The uniform collab read-only gate
// ===========================================================================

describe("uniform collab read-only gate — applies() (grab + lightning)", () => {
  it("with canEdit:false EVERY grab/lightning action greys out", () => {
    for (const id of GRAB_OR_LIGHTNING_IDS) {
      // Use a live-range selection so a selection-required action (highlight)
      // would otherwise be "ok" — proving the collab gate is what disables it.
      const status = row(id).applies(ctxFor(liveSel, { canEdit: false }));
      expect(status, `${id} collab-readonly`).toBe("disabled");
    }
  });

  it("with canEdit:true NOTHING is gated — every action is enabled on a live range (no over-gating)", () => {
    for (const id of GRAB_OR_LIGHTNING_IDS) {
      expect(row(id).applies(ctxFor(liveSel, { canEdit: true })), `${id} editable`).toBe("ok");
    }
  });

  it("with canEdit UNDEFINED behaves identically to true (the default — no over-gating)", () => {
    for (const id of GRAB_OR_LIGHTNING_IDS) {
      const withUndef = row(id).applies(ctxFor(liveSel));
      const withTrue = row(id).applies(ctxFor(liveSel, { canEdit: true }));
      expect(withUndef, `${id} undefined==true`).toBe(withTrue);
    }
  });

  it("the collab gate is INDEPENDENT of the selection mode (highlight greys even on a live range)", () => {
    // highlight is "ok" on a live range when editable, "disabled" when read-only.
    expect(row("highlight").applies(ctxFor(liveSel, { canEdit: true }))).toBe("ok");
    expect(row("highlight").applies(ctxFor(liveSel, { canEdit: false }))).toBe("disabled");
  });
});

describe("uniform collab read-only gate — run() no-ops (covers all 4 surfaces via the shared run())", () => {
  it("card run() does NOT dispatch when collab read-only (grab/lightning)", () => {
    for (const id of ["note", "todo", "highlight", "duplicate", "archive", "delete"] as const) {
      const spy = vi.fn();
      // A grab-shaped ref so the card would normally forward to the dispatcher.
      row(id).run(ctxFor(paragraph, { canEdit: false, dispatch: spy }));
      expect(spy, `${id} dispatch suppressed`).not.toHaveBeenCalled();
    }
  });

  it("citation/footnote run() does NOT dispatch when collab read-only", () => {
    for (const id of ["citation", "footnote"] as const) {
      const spy = vi.fn();
      row(id).run(ctxFor(paragraph, { canEdit: false, dispatch: spy }));
      expect(spy, `${id} dispatch suppressed`).not.toHaveBeenCalled();
    }
  });

  it("card run() DOES dispatch when editable (no over-gating)", () => {
    const spy = vi.fn();
    row("note").run(ctxFor(paragraph, { canEdit: true, dispatch: spy }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("note", paragraph);
  });

  it("ref run() does NOT open the popover when collab read-only", () => {
    let opened: string | null = null;
    const ctx = ctxFor(cursor, { canEdit: false });
    ctx.openAtomCreate = (kind) => {
      opened = kind;
    };
    row("ref").run(ctx);
    expect(opened).toBe(null);
  });

  it("ref run() DOES open the popover when editable", () => {
    let opened: string | null = null;
    const ctx = ctxFor(cursor, { canEdit: true });
    ctx.openAtomCreate = (kind) => {
      opened = kind;
    };
    row("ref").run(ctx);
    expect(opened).toBe("ref");
  });

  it("format run() does NOT touch the editor chain when collab read-only", () => {
    // `ctxFor`'s editor.chain() throws — so a non-no-op format run would throw.
    for (const id of ["bold", "italic", "strike", "code", "bullet-list", "blockquote"] as const) {
      expect(() => row(id).run(ctxFor(liveSel, { canEdit: false })), `${id}`).not.toThrow();
    }
  });

  it("text-color run() does NOT open the color popover when collab read-only", () => {
    let opened = false;
    const ctx = ctxFor(liveSel, { canEdit: false });
    ctx.openColorPopover = () => {
      opened = true;
    };
    ctx.payload = { anchorRect: new DOMRect(0, 0, 10, 10) };
    row("text-color").run(ctx);
    expect(opened).toBe(false);
  });

  it("pure-PM block run() (heading/tex/example/title) does NOT mutate the doc when collab read-only", () => {
    for (const id of [
      "heading-section", "tex", "example", "inline-math", "display-math",
      "figure", "graphics", "title", "author", "date",
    ] as const) {
      const ctx = ctxFor(cursor, { canEdit: false });
      const dispatchSpy = ctx.view.dispatch as unknown as ReturnType<typeof vi.fn>;
      row(id).run(ctx);
      expect(dispatchSpy, `${id} view.dispatch suppressed`).not.toHaveBeenCalled();
    }
  });
});
