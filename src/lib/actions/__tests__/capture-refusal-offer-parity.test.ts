// @vitest-environment jsdom
//
// Task 907 — the WRAP rows' OFFER and COMMIT ask ONE capture question.
//
// `texRun` / `exampleRun` / `mathRun` delete the selection and carry it out in
// one capture dialect (task 641/848), refusing a selection that dialect cannot
// represent. Pre-907 that refusal lived only in the runs (a bare `return`),
// while each row's `applies()` asked only the CONTAINER question — so over a
// cited sentence the lightning grid offered a LIVE Raw LaTeX cell whose click
// did nothing and said nothing. Both now read `wrapCaptureHolds`.
//
// Each leg: a selection the run refuses → `applies()` is "disabled" AND `run()`
// leaves the doc byte-identical; a capturable selection → "ok" and the run
// changes the doc (the positive control that keeps the gate falsifiable).
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
} from "@/lib/actions/action-registry";

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

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

function mount(content: Record<string, unknown>[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}

/** Select the whole doc's content range [1, size-1] (every block's interior). */
function selectAll(editor: Editor): void {
  const { doc } = editor.state;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(doc, 1, doc.content.size - 1)),
  );
}

function gridCtx(editor: Editor): ActionContext {
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
    canEdit: true,
  } as ActionContext;
}

const para = (content: Record<string, unknown>[], uuid = "p1") => ({
  type: "paragraph",
  attrs: { uuid },
  content,
});
const text = (t: string, marks?: unknown[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });

const CITED = [
  para([
    text("see "),
    { type: "citation", attrs: { citationId: "cit-1", command: "\\cite{bar}", displayText: "" } },
    text(" here"),
  ]),
];
const ANCHORED = [
  para([text("anchored", [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "note" } }])]),
];
const WITH_DISPLAY_MATH = [
  para([text("before")]),
  { type: "displayMath", attrs: { latex: "x^2", uuid: "dm1" } },
  para([text("after")], "p2"),
];
const PLAIN = [para([text("plain words")])];

const CASES: { id: ActionId; refused: Record<string, unknown>[]; why: string }[] = [
  { id: "tex", refused: CITED, why: "a Card-bearing citation (citationId)" },
  { id: "example", refused: WITH_DISPLAY_MATH, why: "a displayMath block" },
  { id: "inline-math", refused: ANCHORED, why: "a linkedAnchor (card anchor)" },
  { id: "display-math", refused: ANCHORED, why: "a linkedAnchor (card anchor)" },
];

describe("task 907 — wrap rows grey exactly where their run refuses", () => {
  for (const { id, refused, why } of CASES) {
    const row = VIRGIL_ACTION_REGISTRY[id];

    it(`${id}: a selection holding ${why} → applies() "disabled" and run() is a no-op`, () => {
      const editor = mount(refused);
      selectAll(editor);
      const ctx = gridCtx(editor);
      expect(row.applies!(ctx)).toBe("disabled");
      const before = editor.state.doc.toJSON();
      row.run!(ctx);
      expect(editor.state.doc.toJSON()).toEqual(before);
    });

    it(`${id}: a capturable selection → applies() "ok" and run() changes the doc`, () => {
      const editor = mount(PLAIN);
      selectAll(editor);
      const ctx = gridCtx(editor);
      expect(row.applies!(ctx)).toBe("ok");
      const before = editor.state.doc.toJSON();
      row.run!(ctx);
      expect(editor.state.doc.toJSON()).not.toEqual(before);
    });
  }
});
