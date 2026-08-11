// @vitest-environment jsdom
//
// Task 145 — the grab-bar SELECTION-ref menu decoration must agree with the
// CONTAINING block's curated `actions` set, exactly as the block-ref path and
// the lightning twin already do (the SELECTION residual of task 061).
//
// THE BUG THIS PINS: `DragHandleMenu` used to build its decoration ctx as
// `{ ref, canEdit }` — a cast that ELIDED `view` — and synthesize a throwaway
// `{ kind:"selection", from:0, to:1 }` ref. With no view, `cardActionAllowedForCtx`
// hit its `if (!doc) return true` allow-all short-circuit, so EVERY row rendered
// enabled for ANY selection regardless of its containing block — re-opening the
// `\title{\cite{}}` corruption task 061 set out to close. The fix threads the
// REAL ref (carrying the selection's live `from`) + the live `view`, so a
// selection resolves its containing block via `posBlockAllowsAction`.
//
// WHAT IS PROVEN (all via the REAL editor stack + REAL schema — no mocks of the
// action code; only `@/lib/storage`, per the documented extension-barrel gotcha):
//   1. A selection inside a `titleField` greys Citation + the destructive /
//      duplicate rows (matching `TITLE_FIELD_ACTIONS`); keeps footnote/note/etc.
//   2. A selection inside a `codeBlock` greys footnote / citation / suggest-edit
//      (matching `MARKLESS_BLOCK_ACTIONS` — the bucket task 148 renamed the
//      prose-container half out of; see container-body-inline-insert.test.ts).
//   3. A selection inside a `latexComment` greys footnote / citation /
//      suggest-edit AND highlight (matching `MARKLESS_BLOCK_ACTIONS`).
//   4. A prose selection leaves the full card vocabulary enabled.
//   5. Parity: the selection-ref decoration for each container yields the SAME
//      enabled/disabled split as that block's own curated `actions` set.
//   6. Regression pin — the viewless ctx (`ref` but no `view`) still allow-alls
//      (the historic short-circuit), so the bug is precisely the missing `view`.
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

import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  cardActionRows,
  type ActionContext,
  type ActionRef,
} from "@/lib/actions/action-registry";
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import type { TextObjectKind } from "@/text-objects/types";
import type { DragHandleAction } from "@/components/DragHandleMenu";

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

/** Mount a real main editor holding one paragraph + one titleField + one
 *  codeBlock + one latexComment, each seeded with text so a non-empty selection
 *  lands inside it. */
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

/** A SELECTION ref spanning the inner text of the first block named `nodeName`. */
function selectionRefInside(editor: Editor, nodeName: string): ActionRef {
  const ranges: Array<{ from: number; to: number }> = [];
  editor.state.doc.descendants((node: PMNode, pos: number) => {
    if (ranges.length > 0 || node.type.name !== nodeName) return true;
    const from = pos + 1; // just inside the block's open token
    ranges.push({ from, to: from + Math.max(1, node.content.size) });
    return false;
  });
  const range = ranges[0];
  if (!range) throw new Error(`no ${nodeName} mounted`);
  return { kind: "selection", from: range.from, to: range.to, paragraphId: "" };
}

/** The grab menu's decoration decision for `id`, given a ref + (optional) view —
 *  mirrors exactly what `DragHandleMenu` computes at open time. */
function decorate(
  id: DragHandleAction,
  ref: ActionRef,
  editor: Editor | null,
): "ok" | "disabled" | "absent" {
  const row = cardActionRows("grab").find((r) => r.id === id);
  if (!row) throw new Error(`no grab row for ${id}`);
  return row.applies({ ref, view: editor?.view } as ActionContext);
}

/** The card ids the grab menu renders, in registry order. */
function grabCardIds(): DragHandleAction[] {
  return cardActionRows("grab").map((r) => r.id as DragHandleAction);
}

/** The curated `actions` set for a TextObject kind. */
function curated(kind: TextObjectKind): ReadonlyArray<DragHandleAction> {
  return TEXT_OBJECT_REGISTRY[kind].actions as ReadonlyArray<DragHandleAction>;
}

describe("grab-bar SELECTION-ref decoration honors the containing block (task 145)", () => {
  it("titleField selection greys Citation + the destructive/duplicate rows, keeps footnote/note", () => {
    const editor = mountFixture();
    const ref = selectionRefInside(editor, "titleField");
    // TITLE_FIELD_ACTIONS drops citation, duplicate, archive, delete.
    expect(decorate("citation", ref, editor)).toBe("disabled");
    expect(decorate("duplicate", ref, editor)).toBe("disabled");
    expect(decorate("archive", ref, editor)).toBe("disabled");
    expect(decorate("delete", ref, editor)).toBe("disabled");
    // ...and keeps the rest.
    expect(decorate("footnote", ref, editor)).toBe("ok");
    expect(decorate("note", ref, editor)).toBe("ok");
    expect(decorate("highlight", ref, editor)).toBe("ok");
    expect(decorate("suggest-edit", ref, editor)).toBe("ok");
    editor.destroy();
  });

  it("codeBlock selection greys footnote / citation / suggest-edit", () => {
    const editor = mountFixture();
    const ref = selectionRefInside(editor, "codeBlock");
    expect(decorate("footnote", ref, editor)).toBe("disabled");
    expect(decorate("citation", ref, editor)).toBe("disabled");
    expect(decorate("suggest-edit", ref, editor)).toBe("disabled");
    // codeBlock is MARKLESS (task 146) — highlight greyed too; note/todo ok.
    expect(decorate("highlight", ref, editor)).toBe("disabled");
    expect(decorate("note", ref, editor)).toBe("ok");
    expect(decorate("todo", ref, editor)).toBe("ok");
    editor.destroy();
  });

  it("latexComment selection greys footnote / citation / suggest-edit AND highlight", () => {
    const editor = mountFixture();
    const ref = selectionRefInside(editor, "latexComment");
    expect(decorate("footnote", ref, editor)).toBe("disabled");
    expect(decorate("citation", ref, editor)).toBe("disabled");
    expect(decorate("suggest-edit", ref, editor)).toBe("disabled");
    expect(decorate("highlight", ref, editor)).toBe("disabled"); // marks:"" (task 066)
    expect(decorate("note", ref, editor)).toBe("ok");
    editor.destroy();
  });

  it("a prose selection leaves the full card vocabulary enabled", () => {
    const editor = mountFixture();
    const ref = selectionRefInside(editor, "paragraph");
    for (const id of grabCardIds()) {
      expect(decorate(id, ref, editor)).toBe("ok");
    }
    editor.destroy();
  });

  it("parity: the selection-ref split matches the block's own curated actions set", () => {
    const editor = mountFixture();
    const cases: Array<{ nodeName: string; kind: TextObjectKind }> = [
      { nodeName: "titleField", kind: "titleField" },
      { nodeName: "codeBlock", kind: "codeBlock" },
      { nodeName: "latexComment", kind: "latexComment" },
      { nodeName: "paragraph", kind: "paragraph" },
    ];
    for (const { nodeName, kind } of cases) {
      const ref = selectionRefInside(editor, nodeName);
      const set = curated(kind);
      for (const id of grabCardIds()) {
        const expected = set.includes(id) ? "ok" : "disabled";
        expect(decorate(id, ref, editor), `${kind} × ${id}`).toBe(expected);
      }
    }
    editor.destroy();
  });

  it("regression pin: a viewless ctx still allow-alls (the historic short-circuit) — the bug WAS the missing view", () => {
    const editor = mountFixture();
    const ref = selectionRefInside(editor, "titleField");
    // No view threaded → `cardActionAllowedForCtx` hits its allow-all fallback,
    // so Citation reads "ok" (the pre-145 viewless bypass). With a view it's
    // "disabled" (asserted above). This isolates the fix to the threaded view.
    expect(decorate("citation", ref, null)).toBe("ok");
    editor.destroy();
  });
});
