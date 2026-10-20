// @vitest-environment jsdom
//
// TASK 1199 — the ¶ block-type menu renders the heading verdict, and every row
// commits through ONE door.
//
// THE DEFECT. Every lightning-grid cell greyed from its registry row except
// ¶, whose only gate was read-only, and whose rows greyed on the document
// class alone. The heading rows' own `applies()` knows three more refusals —
// the surface schema has no heading (a footnote / note body, task 1182), the
// caret's container cannot host one (a list item / example item), and the
// range holds a protected block (titleField / codeBlock / latexComment). ¶
// asked none of them: its rows stayed lit and the click did nothing. Levels
// 1–4 ran `spec.run` without `spec.applies`; 0/5/6 ran a hand copy of
// `headingRun`; and only some rows handed focus back to the editor.
//
// Driven over the REAL schemas (main stack + the card-body stack
// `RichTextField` mounts) — only `@/lib/storage` is stubbed.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { buildCardBodySchema, starterKitConfigForScope } from "@/lib/tiptap/borrowed-schema";
import { blockTypeOptions, blockTypeVerdict } from "@/lib/actions/block-type";
import { headingLevelVerdict, runHeadingLevel } from "@/lib/actions/action-registry";
import { lightningContext } from "@/lib/actions/lightning-context";
import { refusalPhrase } from "@/lib/actions/refusal";
import { pickBlockType } from "@/components/MenuBar";

const SURFACE_PHRASE = refusalPhrase({ cause: "surface" });

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
beforeEach(() => {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});

const mounted: Editor[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.destroy();
  document.body.innerHTML = "";
});

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function mountMain(content: Record<string, unknown>[]): ReactEditor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  mounted.push(editor);
  return editor as unknown as ReactEditor;
}

/** The extension stack `RichTextField` mounts for a footnote / note body. */
function mountCardBody(): ReactEditor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [StarterKit.configure(starterKitConfigForScope("card")), ...buildCardBodySchema("card")],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a note" }] }] },
  });
  mounted.push(editor);
  caretInside(editor as unknown as ReactEditor, "paragraph");
  return editor as unknown as ReactEditor;
}

const para = (uuid: string, text: string) => ({
  type: "paragraph",
  attrs: { uuid },
  content: [{ type: "text", text }],
});

/** Collapse the caret mid-way inside the first `nodeName`. */
function caretInside(editor: ReactEditor, nodeName: string): void {
  let mid: number | null = null;
  editor.state.doc.descendants((node: PMNode, pos: number) => {
    if (mid !== null || node.type.name !== nodeName) return mid === null;
    mid = pos + 1 + Math.floor(Math.max(1, node.content.size) / 2);
    return false;
  });
  if (mid === null) throw new Error(`no ${nodeName} mounted`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, mid)));
}

function count(editor: ReactEditor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

const headingRows = (editor: ReactEditor) =>
  blockTypeOptions(editor, null).filter((o) => o.value !== "p");
const bodyRow = (editor: ReactEditor) => blockTypeOptions(editor, null).find((o) => o.value === "p")!;

describe("task 1199 — a footnote / note body has no heading", () => {
  it("the ¶ cell is greyed with the surface reason, and every row with it", () => {
    const editor = mountCardBody();
    expect(editor.state.schema.nodes.heading).toBeUndefined();
    expect(blockTypeVerdict(editor, null, true)).toEqual({ disabled: true, reason: SURFACE_PHRASE });
    for (const row of headingRows(editor)) {
      expect(row.disabled, row.label).toBe(true);
      expect(row.hint, row.label).toBe(SURFACE_PHRASE);
    }
  });

  it("pickBlockType for a registry level (2) and an off-registry level (0) dispatches nothing — not even a focus move", () => {
    const editor = mountCardBody();
    const before = editor.state.doc;
    const dispatch = vi.spyOn(editor.view, "dispatch");
    pickBlockType(editor, "2");
    pickBlockType(editor, "0");
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state.doc.eq(before)).toBe(true);
  });
});

describe("task 1199 — a list-item caret cannot become a heading", () => {
  const listDoc = () =>
    mountMain([
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [para("li-A", "an item")] }],
      },
    ]);

  it("every heading row is greyed with a reason; Body text stays live", () => {
    const editor = listDoc();
    caretInside(editor, "paragraph");
    for (const row of headingRows(editor)) {
      expect(row.disabled, row.label).toBe(true);
      expect(row.hint, row.label).toBeTruthy();
    }
    expect(bodyRow(editor).disabled).toBe(false);
    // …so the cell itself greys: no row would do anything.
    const cell = blockTypeVerdict(editor, null, true);
    expect(cell.disabled).toBe(true);
    expect(cell.reason).toBeTruthy();
  });

  it("every level's commit is refused — including 0/5/6, which used to skip the verdict", () => {
    const editor = listDoc();
    caretInside(editor, "paragraph");
    for (const level of ["0", "1", "2", "3", "4", "5", "6"]) pickBlockType(editor, level);
    expect(count(editor, "heading")).toBe(0);
    expect(count(editor, "listItem")).toBe(1);
  });
});

describe("task 1199 — a protected block greys the heading rows, not just bails", () => {
  for (const [container, node] of [
    ["titleField", { type: "titleField", attrs: { field: "title", uuid: "t-A" }, content: [{ type: "text", text: "Title" }] }],
    ["codeBlock", { type: "codeBlock", attrs: { uuid: "c-A" }, content: [{ type: "text", text: "x = 1" }] }],
    ["latexComment", { type: "latexComment", attrs: { uuid: "m-A" }, content: [{ type: "text", text: "a comment" }] }],
  ] as const) {
    it(`caret in ${container}: every heading row and the ¶ cell are greyed`, () => {
      const editor = mountMain([node, para("p-A", "prose")]);
      caretInside(editor, container);
      for (const row of headingRows(editor)) expect(row.disabled, `${container} ${row.label}`).toBe(true);
      expect(blockTypeVerdict(editor, null, true).disabled).toBe(true);
    });
  }
});

describe("task 1199 — ordinary prose stays live (no over-gating)", () => {
  it("a paragraph caret: every row lit, the cell lit", () => {
    const editor = mountMain([para("p-A", "prose")]);
    caretInside(editor, "paragraph");
    expect(headingRows(editor).every((r) => !r.disabled)).toBe(true);
    expect(blockTypeVerdict(editor, null, true)).toEqual({ disabled: false, reason: null });
  });

  it("the document class still greys its own rows first (task 752)", () => {
    const editor = mountMain([para("p-A", "prose")]);
    caretInside(editor, "paragraph");
    const chapter = blockTypeOptions(editor, "article").find((o) => o.value === "1")!;
    expect(chapter.disabled).toBe(true);
    expect(chapter.hint).toContain("article");
  });

  it("read-only: the cell greys with the read-only reason", () => {
    const editor = mountMain([para("p-A", "prose")]);
    const cell = blockTypeVerdict(editor, null, false);
    expect(cell.disabled).toBe(true);
    expect(cell.reason).toBeTruthy();
  });

  it("the verdict and the door agree for all seven levels", () => {
    const editor = mountMain([para("p-A", "prose")]);
    caretInside(editor, "paragraph");
    const ctx = lightningContext(editor, true);
    for (const level of [0, 1, 2, 3, 4, 5, 6]) {
      expect(headingLevelVerdict(ctx, level).state, `level ${level}`).toBe("ok");
    }
    expect(runHeadingLevel(ctx, 5)).toBe(true);
    let lvl: number | null = null;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "heading") lvl = n.attrs.level as number;
      return true;
    });
    expect(lvl).toBe(5);
  });
});

describe("task 1199 — every row hands focus back the same way", () => {
  for (const level of ["2", "0", "p"]) {
    it(`after picking ${level === "p" ? "Body text" : `level ${level}`}, the editor holds focus`, async () => {
      const editor = mountMain([
        { type: "heading", attrs: { level: 3, uuid: "h-A" }, content: [{ type: "text", text: "Head" }] },
        para("p-A", "prose"),
      ]);
      caretInside(editor, level === "p" ? "heading" : "paragraph");
      // The pick comes from a toolbar button, which holds DOM focus.
      const trigger = document.createElement("button");
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);
      pickBlockType(editor, level);
      // TipTap's `focus()` lands DOM focus inside a frame.
      await new Promise((r) => setTimeout(r, 50));
      expect(editor.view.dom.contains(document.activeElement)).toBe(true);
      // …and the pick itself landed.
      expect(count(editor, "heading")).toBe(level === "p" ? 0 : 2);
    });
  }
});

describe("task 1199 — STRUCTURAL: the dropdown holds no copy of the heading transform", () => {
  it("MenuBar.tsx reaches every level through the registry door, never the gate or door directly", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/components/MenuBar.tsx"), "utf8");
    expect(src).not.toMatch(/\bsetHeadingLevelInRange\b/);
    expect(src).not.toMatch(/\bblockRangeHostsBlockInsert\b/);
    expect(src).not.toMatch(/\.run\(ctx\)/);
    expect(src).toMatch(/\brunHeadingLevel\(ctx, parseInt\(value\)\)/);
  });
});
