// @vitest-environment jsdom
//
// TASK 1182 — a row is offered only on a surface whose SCHEMA holds what it
// makes.
//
// THE DEFECT. The lightning panel runs against the FOCUSED editor — a footnote
// or note body when one has focus. That body mounts the narrow card schema (no
// heading, horizontal rule, example, raw-LaTeX block…). Every insert gate read
// `schema.nodes[name]` and treated `undefined` as "allow", while every run read
// the same lookup and treated `undefined` as "do nothing": the rule / example
// cells were LIT, a click did nothing, and no reason was given.
//
// WHAT IS PINNED HERE (a census, derived from the registry — not a hand-list)
//   1. DECLARATION: every row that is not a card row declares `makes` (the node
//      it inserts / converts to / wraps with, or the mark it toggles), so no
//      future node-making row can slip in without the gate.
//   2. AGREEMENT: on a real card-body editor, every row whose `makes` the schema
//      LACKS is "disabled" and its reason is "Not available in this field";
//      on a real main editor, no row is refused for that cause.
//   3. LIT ⇒ ACTS: on the card body, every pure-ProseMirror row that is still
//      "ok" changes the editor state when run — the "lit cell, silent click"
//      shape cannot recur for a row the census can execute.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { buildCardBodySchema, starterKitConfigForScope } from "@/lib/tiptap/borrowed-schema";
import {
  VIRGIL_ACTION_REGISTRY,
  refusalOf,
  verdictOf,
  withSchemaGate,
  type ActionContext,
  type ActionSpec,
} from "@/lib/actions/action-registry";
import { refusalPhrase } from "@/lib/actions/refusal";

const SURFACE_PHRASE = refusalPhrase({ cause: "surface" });

const mounted: Editor[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.destroy();
  document.body.innerHTML = "";
});

function caretAtEndOfFirstParagraph(editor: Editor): void {
  let caret = 1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") {
      caret = pos + 1 + node.content.size;
      return false;
    }
    return true;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
}

function mountMain(): Editor {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "p-A" }, content: [{ type: "text", text: "main text" }] }],
    },
  });
  mounted.push(editor);
  caretAtEndOfFirstParagraph(editor);
  return editor;
}

/** The extension stack `RichTextField` mounts for a footnote / note body. */
function mountCardBody(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [StarterKit.configure(starterKitConfigForScope("card")), ...buildCardBodySchema("card")],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a note" }] }] },
  });
  mounted.push(editor);
  caretAtEndOfFirstParagraph(editor);
  return editor;
}

function lightningCtx(editor: Editor): ActionContext {
  return {
    editor,
    view: editor.view,
    ref: { kind: "cursor", pos: editor.state.selection.from, paragraphId: "" },
    surface: "lightning",
    canEdit: true,
  } as ActionContext;
}

function lacks(editor: Editor, spec: ActionSpec): boolean {
  const m = spec.makes!;
  const schema = editor.state.schema;
  return "node" in m ? !schema.nodes[m.node] : !schema.marks[m.mark];
}

const ROWS = Object.values(VIRGIL_ACTION_REGISTRY) as ActionSpec[];

describe("task 1182 — schema membership gates every node/mark-making row", () => {
  it("DECLARATION: every non-card row declares what it makes", () => {
    const undeclared = ROWS.filter((r) => r.category !== "card" && !r.makes).map((r) => r.id);
    expect(undeclared).toEqual([]);
  });

  it("the reported pair: rule + example are greyed in a footnote body, lit in the main text", () => {
    const body = mountCardBody();
    const main = mountMain();
    for (const id of ["horizontal-rule", "example"] as const) {
      const spec = VIRGIL_ACTION_REGISTRY[id];
      expect(verdictOf(spec, lightningCtx(body))).toEqual({ state: "disabled", reason: SURFACE_PHRASE });
      expect(spec.applies(lightningCtx(main))).toBe("ok");
    }
  });

  it("AGREEMENT: on a card body every row whose `makes` is missing is refused for that cause", () => {
    const body = mountCardBody();
    const ctx = lightningCtx(body);
    const missing = ROWS.filter((r) => r.makes && lacks(body, r));
    // The card schema is genuinely narrower — the census must be exercising something.
    expect(missing.map((r) => r.id)).toEqual(
      expect.arrayContaining(["horizontal-rule", "example", "heading-section", "blockquote", "text-color"]),
    );
    for (const spec of missing) {
      expect({ id: spec.id, v: verdictOf(spec, ctx) }).toEqual({
        id: spec.id,
        v: { state: "disabled", reason: SURFACE_PHRASE },
      });
    }
  });

  // Task 1299: the declaration IS the gate. No row asks `surfaceLacks` by hand;
  // the registry assembly composes it from `makes`, so a row whose own
  // `applies` asks nothing about the schema is still greyed where it can't land.
  it("COMPOSITION: a row that declares `makes` with a bare `applies` is greyed on a card body", () => {
    const body = mountCardBody();
    const main = mountMain();
    const bare: ActionSpec = {
      ...VIRGIL_ACTION_REGISTRY["horizontal-rule"],
      applies: () => "ok",
    };
    const gated = withSchemaGate(bare);
    expect(verdictOf(gated, lightningCtx(body))).toEqual({ state: "disabled", reason: SURFACE_PHRASE });
    expect(gated.applies(lightningCtx(main))).toBe("ok");
    // A row that makes nothing is passed through untouched.
    const card = ROWS.find((r) => !r.makes)!;
    expect(withSchemaGate(card)).toBe(card);
  });

  it("AGREEMENT: in the main text no row is refused for lacking its schema member", () => {
    const main = mountMain();
    const ctx = lightningCtx(main);
    for (const spec of ROWS.filter((r) => r.makes)) {
      expect({ id: spec.id, lacks: lacks(main, spec) }).toEqual({ id: spec.id, lacks: false });
      if (spec.applies(ctx) === "disabled") {
        expect({ id: spec.id, cause: refusalOf(spec, ctx).cause }).not.toEqual({ id: spec.id, cause: "surface" });
      }
    }
  });

  it("LIT ⇒ ACTS: every pure-ProseMirror row still lit on a card body changes the editor when run", () => {
    // Rows whose run opens a popover / routes through the React bridge cannot be
    // executed headless; they are covered by the AGREEMENT census above.
    const BRIDGED = new Set(["ref", "text-color", "figure", "graphics"]);
    const silent: string[] = [];
    for (const spec of ROWS.filter((r) => r.makes && !BRIDGED.has(r.id))) {
      const body = mountCardBody();
      const ctx = lightningCtx(body);
      if (spec.applies(ctx) !== "ok") continue;
      const before = body.state;
      void spec.run(ctx);
      const after = body.state;
      const changed = !before.doc.eq(after.doc) || before.storedMarks !== after.storedMarks;
      if (!changed) silent.push(spec.id);
    }
    expect(silent).toEqual([]);
  });
});
