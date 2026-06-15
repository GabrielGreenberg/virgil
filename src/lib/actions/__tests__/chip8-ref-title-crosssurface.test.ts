// @vitest-environment jsdom
//
// CHIP 8 — REAL-STACK verification of the action-alignment matrix, category
// `ref-title`. The oracle is docs/memos/action-alignment-matrix/EXPECTED-MATRIX.md
// rows: `ref` (Atom ref, line 52), `title`/`author`/`date` (Heading + title,
// lines 33-35) + the cross-surface identity invariants (lines 124-126).
//
// This file DRIVES THE ACTUAL CODE — it mounts the real main-editor extension
// stack via `buildEditorExtensions("main")`, fires the real `commands.ts` slash
// actions through a real published bridge handle (exactly like EditorPane), and
// invokes the real registry `refRun` / `titleFieldRun`. NO mocks of the action
// code itself; only `@/lib/storage` is stubbed because the extension barrel
// transitively imports it (the documented sibling-test gotcha).
//
// SCOPE (per the CHIP-8 dispatch brief):
//
//   REF  — `refRun` → `openRefPopover` seam. The popover IS the creator; `refRun`
//          itself produces ZERO docDelta (oracle: "the cross-surface test asserts
//          labelRefs===0 after the action"). We assert the seam fires from BOTH
//          the slash bridge path AND the lightning grid `refRun` path, that the
//          two are byte-identical (same no-doc-mutation, same single seam call),
//          that the collab read-only gate no-ops BOTH (NO popover, no atom), and
//          the per-kind `applies()` taxonomy (ok on text/atom-bearing kinds,
//          `disabled` on the `isAtomBlock` kinds). We also pin the labelRef atom
//          the popover lands so the .tex round-trip is locked to the oracle.
//
//   TITLE/AUTHOR/DATE — idempotent find-or-insert singletons, SLASH-ONLY. We
//          assert: a second `\title`/`\author`/`\date` does NOT add a duplicate
//          (childCount unchanged — the core idempotency criterion), find-existing
//          works regardless of the field's doc position, canonical order
//          (title=0/author=1/date=2 + the `\maketitle`=99 ordering subtlety),
//          `\date` pre-fills today AND serializes to `\date{\today}` (NOT the
//          expanded literal) AND a re-parse reproduces `isToday:true` (the
//          round-trip identity invariant), find-existing does NOT overwrite a
//          user-edited date, and SLASH-ONLY surface exposure (no menu twin).
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
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP, VIRGIL_COMMAND_NAMES } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  refRun,
  type ActionContext,
  type ActionId,
  type ActionRef,
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import { setEditorActionsHandle } from "@/lib/actions/editor-actions-bridge";
import { paragraphUuidAt } from "@/links/links";
import { serializeToLatex } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";

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

function mountEditor(
  content: Record<string, unknown>[],
  editable = true,
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  return editor;
}

/** A single paragraph with text, caret at end. */
function mountParagraph(text = ""): Editor {
  const editor = mountEditor([
    {
      type: "paragraph",
      attrs: { uuid: "para-A" },
      content: text ? [{ type: "text", text }] : [],
    },
  ]);
  const pos = 1 + text.length;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
  return editor;
}

function selectAll(editor: Editor): void {
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, Math.max(1, end))),
  );
}

/** Every top-level titleField, in doc order. */
function titleFields(editor: Editor): PMNode[] {
  const out: PMNode[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === "titleField") out.push(n);
  });
  return out;
}

function countLabelRefs(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "labelRef") n++;
    return true;
  });
  return n;
}

let openRefPopover: ReturnType<typeof vi.fn>;
let lastSeed: { surface: ActionSurfaceLite } | null;

type ActionSurfaceLite = "grab" | "lightning" | "slash" | "typed" | "keyboard";

/** Publish a bridge handle EXACTLY like EditorPane: synthesize a CursorRef from
 *  the live selection head, build the ActionContext with the spy `openRefPopover`
 *  seam + a `canEdit` that mirrors the live editable flag, invoke `spec.run(ctx)`.
 *  `refRun` calls `ctx.openRefPopover()`. */
function publishHandle(editor: Editor): void {
  const handle: EditorActionsHandle = {
    runAction(id: ActionId, seed) {
      lastSeed = seed as { surface: ActionSurfaceLite };
      const spec = VIRGIL_ACTION_REGISTRY[id];
      if (!spec) return;
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
        surface: seed.surface,
        // EditorPane threads the live editable flag down as canEdit so the
        // uniform collab gate fires on the slash bridge path too.
        canEdit: editor.isEditable,
        openRefPopover: openRefPopover as () => void,
      };
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

/** Invoke `refRun` the way the lightning 'Cross-ref' grid cell does — a
 *  selection-ref ActionContext built from the live editor + the seam. */
function runLightningRef(editor: Editor): void {
  refRun({
    editor,
    view: editor.view,
    ref: {
      kind: "selection",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      paragraphId: "",
    },
    surface: "lightning",
    canEdit: editor.isEditable,
    openRefPopover: openRefPopover as () => void,
  });
}

/** Build an ActionContext for a per-kind `applies()` probe with the given ref. */
function applyCtx(editor: Editor, ref: ActionRef, canEdit = true): ActionContext {
  return {
    editor,
    view: editor.view,
    ref,
    surface: "lightning",
    canEdit,
  };
}

beforeEach(() => {
  openRefPopover = vi.fn();
  lastSeed = null;
});

afterEach(() => {
  setEditorActionsHandle(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// REF — `\ref` cross-reference: the refRun → openRefPopover seam
// ═══════════════════════════════════════════════════════════════════════════

describe("REF: refRun → openRefPopover seam reached from slash AND lightning", () => {
  it("slash \\ref fires the openRefPopover seam exactly once via the bridge", () => {
    const editor = mountParagraph("see ");
    publishHandle(editor);

    COMMAND_MAP.get("ref")!.action(editor.view, "\\ref");

    expect(openRefPopover).toHaveBeenCalledTimes(1);
    expect(lastSeed?.surface).toBe("slash");
  });

  it("the lightning 'Cross-ref' cell fires the SAME seam (direct refRun, grid path)", () => {
    const editor = mountParagraph("see ");
    runLightningRef(editor);
    expect(openRefPopover).toHaveBeenCalledTimes(1);
  });

  it("refRun ALONE produces NO docDelta — labelRefs===0 after BOTH surfaces (oracle)", () => {
    // The popover is the creator; the action mutates nothing.
    const e1 = mountParagraph("see ");
    publishHandle(e1);
    const before1 = e1.state.doc.toString();
    COMMAND_MAP.get("ref")!.action(e1.view, "\\ref");
    expect(countLabelRefs(e1)).toBe(0);
    expect(e1.state.doc.toString()).toBe(before1); // byte-stable doc

    const e2 = mountParagraph("see ");
    const before2 = e2.state.doc.toString();
    runLightningRef(e2);
    expect(countLabelRefs(e2)).toBe(0);
    expect(e2.state.doc.toString()).toBe(before2);
  });

  it("slash and lightning are byte-identical: both no-op the doc + call the seam once", () => {
    // CROSS-SURFACE IDENTITY (oracle line 124-region invariant for ref): the two
    // surfaces share ONE creator (the popover) by construction. Drive each on an
    // identical doc and compare the resulting doc bytes AND the seam call count.
    const slashEd = mountParagraph("alpha ");
    publishHandle(slashEd);
    const slashSeam = vi.fn();
    openRefPopover = slashSeam;
    publishHandle(slashEd); // re-publish so the handle closes over the new spy
    COMMAND_MAP.get("ref")!.action(slashEd.view, "\\ref");
    const slashDoc = slashEd.state.doc.toString();

    const lightEd = mountParagraph("alpha ");
    const lightSeam = vi.fn();
    openRefPopover = lightSeam;
    runLightningRef(lightEd);
    const lightDoc = lightEd.state.doc.toString();

    expect(slashDoc).toBe(lightDoc); // identical (both unchanged)
    expect(slashSeam).toHaveBeenCalledTimes(1);
    expect(lightSeam).toHaveBeenCalledTimes(1);
  });

  it("refRun no-ops cleanly when no popover seam is supplied (pure view-only path)", () => {
    const editor = mountParagraph("see ");
    expect(() =>
      refRun({
        editor,
        view: editor.view,
        ref: { kind: "cursor", pos: editor.state.selection.head, paragraphId: "" },
        surface: "slash",
      }),
    ).not.toThrow();
  });
});

describe("REF: collab read-only gates BOTH surfaces (no popover, no atom)", () => {
  it("a read-only editor: the slash \\ref bridge path opens NO popover", () => {
    const editor = mountParagraph("see ");
    editor.setEditable(false);
    publishHandle(editor);

    // commands.ts `\ref` rides the bridge; the bridge ctx carries canEdit=false,
    // so refRun's isCollabReadOnly gate fires before the seam.
    COMMAND_MAP.get("ref")!.action(editor.view, "\\ref");

    expect(openRefPopover).not.toHaveBeenCalled();
    expect(countLabelRefs(editor)).toBe(0);
  });

  it("a read-only editor: the lightning refRun path opens NO popover", () => {
    const editor = mountParagraph("see ");
    editor.setEditable(false);
    runLightningRef(editor);
    expect(openRefPopover).not.toHaveBeenCalled();
    expect(countLabelRefs(editor)).toBe(0);
  });
});

describe("REF: applies() per-kind taxonomy (oracle: ok on text/atom kinds, disabled on atom-blocks)", () => {
  const row = VIRGIL_ACTION_REGISTRY["ref"]!;

  it("ok for a cursor and a selection ref", () => {
    const editor = mountParagraph("see ");
    expect(
      row.applies!(applyCtx(editor, { kind: "cursor", pos: 1, paragraphId: "" })),
    ).toBe("ok");
    expect(
      row.applies!(applyCtx(editor, { kind: "selection", from: 1, to: 3, paragraphId: "" })),
    ).toBe("ok");
  });

  // The oracle's ok-kinds for ref include the prose/list/heading/example kinds and
  // the atom-bearing/atom-only labelRef. blockApplies returns "ok" for every kind
  // whose TEXT_OBJECT_REGISTRY entry is isAtomBlock:false.
  const OK_KINDS = [
    "paragraph",
    "heading",
    "blockquote",
    "codeBlock",
    "bulletList",
    "orderedList",
    "listItem",
    "exampleItem",
    "exampleBlock",
    "titleField",
    "figureBlock", // NOTE: isAtomBlock:false → "ok" (see the discrepancy test below)
    "linkedRange",
  ] as const;
  for (const kind of OK_KINDS) {
    it(`ok for a ${kind} ref (isAtomBlock:false → blockApplies "ok")`, () => {
      const editor = mountParagraph("see ");
      expect(row.applies!(applyCtx(editor, { kind, id: "x" }))).toBe("ok");
    });
  }

  // The oracle's disabled-kinds: the isAtomBlock block kinds (no caret to insert at).
  const DISABLED_KINDS = ["displayMath", "texBlock", "graphicsBlock", "latexComment"] as const;
  for (const kind of DISABLED_KINDS) {
    it(`disabled for a ${kind} ref (isAtomBlock:true → blockApplies "disabled")`, () => {
      const editor = mountParagraph("see ");
      expect(row.applies!(applyCtx(editor, { kind, id: "x" }))).toBe("disabled");
    });
  }

  it("disabled under collab read-only even on an otherwise-ok kind (uniform gate)", () => {
    const editor = mountParagraph("see ");
    expect(
      row.applies!(applyCtx(editor, { kind: "paragraph", id: "x" }, /*canEdit*/ false)),
    ).toBe("disabled");
  });

  it("DISCREPANCY: figureBlock applies 'ok' (isAtomBlock:false), NOT 'disabled' as the REF_ACTION_ROW jsdoc claims", () => {
    // Oracle row 52 concern (2): the jsdoc on REF_ACTION_ROW says "figure /
    // displayMath … 'disabled'", but figureBlock.isAtomBlock is FALSE in
    // TEXT_OBJECT_REGISTRY, so blockApplies returns "ok". LIVE CODE IS TRUTH:
    // we assert the live behavior ("ok") and flag the doc/jsdoc as the thing to
    // correct. (This is a doc/comment discrepancy, not a product behavior bug.)
    const editor = mountParagraph("see ");
    expect(row.applies!(applyCtx(editor, { kind: "figureBlock", id: "x" }))).toBe("ok");
  });
});

describe("REF: the labelRef atom the popover lands round-trips through .tex (oracle tex cell)", () => {
  // refRun emits no atom; the popover's handleInsertRef does. We pin the atom
  // shape + serializer output so the create-path destination stays aligned with
  // the oracle ("\\ref{<label>}", refCommand default 'ref', no card/sidecar).
  function docWithLabelRef(refCommand: string, label = "eq:main") {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [
            { type: "text", text: "see " },
            {
              type: "labelRef",
              attrs: { label, displayText: "1", refCommand, targetKind: "displayMath" },
            },
          ],
        },
      ],
    };
  }

  it("refCommand 'ref' serializes to \\ref{label}", () => {
    expect(serializeToLatex(docWithLabelRef("ref"))).toContain("\\ref{eq:main}");
  });
  it("refCommand 'getref' serializes to \\getref{label}", () => {
    expect(serializeToLatex(docWithLabelRef("getref"))).toContain("\\getref{eq:main}");
  });
  it("refCommand 'getfullref' serializes to \\getfullref{label}", () => {
    expect(serializeToLatex(docWithLabelRef("getfullref"))).toContain("\\getfullref{eq:main}");
  });
});

describe("REF: surface exposure (slash + lightning, no grab/typed/keyboard)", () => {
  it("the ref row owns slash + lightning ONLY", () => {
    const row = VIRGIL_ACTION_REGISTRY["ref"]!;
    expect(row.surfaces.slash).toBe(true);
    expect(row.surfaces.lightning).toBe(true);
    expect(!!row.surfaces.grab).toBe(false);
    expect(!!row.surfaces.typed).toBe(false);
    expect(!!row.surfaces.keyboard).toBe(false);
    expect(row.slashName).toBe("ref");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TITLE / AUTHOR / DATE — idempotent find-or-insert singletons, slash-only
// ═══════════════════════════════════════════════════════════════════════════

describe("TITLE-FIELDS: insert behavior on a fresh doc", () => {
  for (const field of ["title", "author", "date"] as const) {
    it(`\\${field} inserts exactly one titleField{field:'${field}'}`, () => {
      const editor = mountParagraph("body");
      COMMAND_MAP.get(field)!.action(editor.view, `\\${field}`);
      const fields = titleFields(editor);
      expect(fields).toHaveLength(1);
      expect(fields[0].attrs.field).toBe(field);
      // Minted attrs match what the parser produces (round-trip identity).
      expect(fields[0].attrs.rawPrefix).toBeNull();
      expect(typeof fields[0].attrs.uuid).toBe("string");
      expect((fields[0].attrs.uuid as string).length).toBeGreaterThan(0);
    });
  }
});

describe("TITLE-FIELDS: IDEMPOTENCY — a second invocation must NOT add a duplicate", () => {
  // The CORE per-kind criterion of the mission: childCount unchanged on the
  // second invocation (find-existing, not insert).
  for (const field of ["title", "author", "date"] as const) {
    it(`\\${field} twice → still exactly ONE titleField (childCount unchanged)`, () => {
      const editor = mountParagraph("body");
      COMMAND_MAP.get(field)!.action(editor.view, `\\${field}`);
      const after1 = titleFields(editor).length;
      const childCount1 = editor.state.doc.childCount;
      expect(after1).toBe(1);

      // Move the caret away (so the idempotent path can't be confused with an
      // in-place re-run), then fire again.
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
        ),
      );
      COMMAND_MAP.get(field)!.action(editor.view, `\\${field}`);

      expect(titleFields(editor)).toHaveLength(1); // no duplicate
      expect(editor.state.doc.childCount).toBe(childCount1); // childCount unchanged
    });
  }

  it("idempotent re-run re-places the cursor INSIDE the existing field (no node mutation)", () => {
    const editor = mountParagraph("body");
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");
    const docJSONBefore = JSON.stringify(editor.getJSON());

    // caret away, fire again
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
      ),
    );
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");

    // doc content unchanged (idempotent = caret-move only)
    expect(JSON.stringify(editor.getJSON())).toBe(docJSONBefore);
    // caret landed inside the titleField (the first child)
    const tf = editor.state.doc.firstChild!;
    const head = editor.state.selection.head;
    expect(head).toBeGreaterThan(0);
    expect(head).toBeLessThanOrEqual(tf.nodeSize);
  });

  it("each title kind is idempotent independently (no cross-duplication across all three)", () => {
    const editor = mountParagraph("body");
    for (const name of ["title", "author", "date"] as const) {
      COMMAND_MAP.get(name)!.action(editor.view, `\\${name}`);
      COMMAND_MAP.get(name)!.action(editor.view, `\\${name}`); // second fire
    }
    expect(titleFields(editor).map((f) => f.attrs.field)).toEqual([
      "title",
      "author",
      "date",
    ]);
  });
});

describe("TITLE-FIELDS: find-existing works regardless of the field's doc position", () => {
  it("a \\title whose titleField is NOT at index 0 still dedupes (find scans ALL children)", () => {
    // Mount a doc where the title field sits AFTER a body paragraph (not hoisted).
    const editor = mountEditor([
      { type: "paragraph", attrs: { uuid: "p0" }, content: [{ type: "text", text: "intro" }] },
      {
        type: "titleField",
        attrs: { field: "title", rawPrefix: null, isToday: false, uuid: "tf-1" },
        content: [{ type: "text", text: "My Paper" }],
      },
    ]);
    expect(titleFields(editor)).toHaveLength(1);

    COMMAND_MAP.get("title")!.action(editor.view, "\\title");

    // Found the existing one — no duplicate, no insert at index 0.
    expect(titleFields(editor)).toHaveLength(1);
    expect(titleFields(editor)[0].attrs.uuid).toBe("tf-1");
  });
});

describe("TITLE-FIELDS: canonical doc-top order (title=0 / author=1 / date=2)", () => {
  it("places them in canonical order regardless of insert order", () => {
    const editor = mountParagraph("body");
    // Insert OUT of order: date, then title, then author.
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");
    COMMAND_MAP.get("author")!.action(editor.view, "\\author");

    expect(titleFields(editor).map((f) => f.attrs.field)).toEqual([
      "title",
      "author",
      "date",
    ]);
  });

  it("\\title inserted when only \\date exists lands BEFORE \\date (order 0 < 2)", () => {
    const editor = mountParagraph("body");
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");
    expect(titleFields(editor).map((f) => f.attrs.field)).toEqual(["title", "date"]);
  });

  it("\\author lands at index 1 BETWEEN an existing \\title and \\date", () => {
    // Oracle row 34 risk: with both title+date present, author must land between.
    const editor = mountParagraph("body");
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    COMMAND_MAP.get("author")!.action(editor.view, "\\author");
    expect(titleFields(editor).map((f) => f.attrs.field)).toEqual([
      "title",
      "author",
      "date",
    ]);
  });

  it("a title field sorts BEFORE a non-title block (the \\maketitle ordering subtlety)", () => {
    // Oracle row 35 subtlest case: a non-titleField (incl. maketitleMarker) sorts
    // at order 99, so an inserted \date lands BEFORE it. We model the
    // "non-title block" with a plain paragraph carrying maketitle-like content;
    // the order math (childOrder 99 for non-titleField) is what's under test.
    const editor = mountEditor([
      { type: "paragraph", attrs: { uuid: "mt" }, content: [{ type: "text", text: "\\maketitle" }] },
    ]);
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    // The date titleField must be the FIRST child (before the non-title block).
    expect(editor.state.doc.firstChild?.type.name).toBe("titleField");
    expect(editor.state.doc.firstChild?.attrs.field).toBe("date");
  });
});

describe("TITLE-FIELDS: \\date pre-fills today + serializes to \\date{\\today} (round-trip identity)", () => {
  const prettyToday = () =>
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  it("INSERT pre-fills today's pretty date with isToday:true", () => {
    const editor = mountParagraph("");
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    const d = titleFields(editor)[0];
    expect(d.attrs.field).toBe("date");
    expect(d.attrs.isToday).toBe(true);
    expect(d.textContent).toBe(prettyToday());
  });

  it("serializes to \\date{\\today} — NOT the expanded literal date string", () => {
    const editor = mountParagraph("");
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    const tex = serializeToLatex(editor.getJSON());
    expect(tex).toContain("\\date{\\today}");
    expect(tex).not.toContain(`\\date{${prettyToday()}}`);
  });

  it("round-trip identity: serialize \\date{\\today} → re-parse reproduces isToday:true + same pretty content", () => {
    // Oracle line 126 invariant: the inserted date (isToday:true) serializes to
    // \date{\today}, and re-parsing \date{\today} must reproduce isToday:true +
    // the same pretty rendering — so the minted attrs == the parser's attrs.
    const editor = mountParagraph("");
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    const tex = serializeToLatex(editor.getJSON());

    const reparsed = parseLatex(tex);
    let parsedDate: { isToday?: unknown; field?: unknown; content?: unknown } | null = null;
    const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (n.type === "titleField" && n.attrs?.field === "date") parsedDate = n as never;
      (n.content as { type?: string }[] | undefined)?.forEach((c) => walk(c as never));
    };
    walk(reparsed as never);
    expect(parsedDate).not.toBeNull();
    expect((parsedDate as unknown as { attrs: Record<string, unknown> }).attrs.isToday).toBe(true);
    // Pretty content identical to what the run minted.
    const node = parsedDate as unknown as { content?: Array<{ text?: string }> };
    expect(node.content?.[0]?.text).toBe(prettyToday());
  });

  it("FIND-EXISTING does NOT overwrite a user-edited date with today", () => {
    // Oracle row 35 risk (2): re-firing \date on an existing user-edited date is a
    // pure caret-move — the content stays the user's literal, isToday stays false.
    const editor = mountEditor([
      {
        type: "titleField",
        attrs: { field: "date", rawPrefix: null, isToday: false, uuid: "d-1" },
        content: [{ type: "text", text: "January 1, 1970" }],
      },
      { type: "paragraph", attrs: { uuid: "p" }, content: [{ type: "text", text: "body" }] },
    ]);
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");

    const d = titleFields(editor)[0];
    expect(titleFields(editor)).toHaveLength(1); // no duplicate
    expect(d.attrs.isToday).toBe(false); // NOT flipped to today
    expect(d.textContent).toBe("January 1, 1970"); // user's value preserved
  });
});

describe("TITLE-FIELDS: SLASH-ONLY surface exposure (no menu/typed/keyboard twin)", () => {
  for (const field of ["title", "author", "date"] as const) {
    it(`the ${field} row owns slash ONLY`, () => {
      const row = VIRGIL_ACTION_REGISTRY[field]!;
      expect(row.surfaces.slash).toBe(true);
      expect(!!row.surfaces.lightning).toBe(false);
      expect(!!row.surfaces.grab).toBe(false);
      expect(!!row.surfaces.typed).toBe(false);
      expect(!!row.surfaces.keyboard).toBe(false);
      expect(row.slashName).toBe(field);
    });
  }

  it("a non-editable (collab read-only) editor no-ops \\title (no insert)", () => {
    // runViewOnlyAction gates on view.editable; titleFieldRun ALSO has the
    // isCollabReadOnly(ctx.canEdit===false) gate. Both must refuse.
    const editor = mountParagraph("body");
    editor.setEditable(false);
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");
    expect(titleFields(editor)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SSOT — these ids are registry rows + every live slash name resolves
// ═══════════════════════════════════════════════════════════════════════════

describe("SSOT: ref + title/author/date are registry rows owning their slash surface", () => {
  it("all four ids have rows", () => {
    for (const id of ["ref", "title", "author", "date"] as const) {
      expect(VIRGIL_ACTION_REGISTRY[id]).toBeTruthy();
      expect(VIRGIL_ACTION_REGISTRY[id]!.id).toBe(id);
    }
  });

  it("the live slash names ref/title/author/date each resolve to a row that owns slash", () => {
    for (const name of ["ref", "title", "author", "date"]) {
      expect(VIRGIL_COMMAND_NAMES).toContain(name);
      const row = Object.values(VIRGIL_ACTION_REGISTRY).find((r) => r?.slashName === name);
      expect(row, `slash \\${name} should resolve to a row`).toBeTruthy();
      expect(row!.surfaces.slash).toBe(true);
    }
  });
});
