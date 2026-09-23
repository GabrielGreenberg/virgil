// @vitest-environment jsdom
//
// TASK 642 — the bridge's nested-editor fallback must not read a FOREIGN
// document's caret, and a dropped card half must not be silent.
//
// THE DEFECT. `registerEditorActionsHandle` has one production call site
// (`EditorPane`), so only PANES are registry keys. A typed `\cite{}` fired
// inside a CARD BODY — `Citation` mounts unconditionally in the borrowed
// card-body schema, and `RichTextField` builds an editable body — misses the
// exact lookup and lands on the ACTIVE pane's handle through the documented
// "nested sub-editor" fallback. That fallback is right for the app-global
// React APIs it exists to supply. It was wrong for the POSITION: the handle
// then built the action's `ref` from `ed.state.selection.head` — MAIN's caret,
// in MAIN's pos-space, in a different document.
//
// Two symptoms, one cause:
//   M1  the card is registered against a foreign caret;
//   M3  `citationRun` re-gates on `posBlockAllowsAction(doc, ref.pos, …)`, so a
//       main caret parked in a `codeBlock` SUPPRESSED the card for a cite typed
//       inside a card body whose atom had already landed — an orphan produced
//       by where an unrelated cursor happened to be sitting.
// And M2: the atom is inserted first, on purpose (durability), so every failure
// edge leaves an orphan — silently, because `?.runAction(...)` swallows a null
// handle whole.
//
// WHAT IS PROVEN HERE
//   1. the typed `\cite{}` rule inside a REAL card-body editor lands its atom in
//      THAT body and registers the card with the body's own `citationId`;
//   2. the `ActionContext` the registry row receives names the BODY's view and a
//      position in the BODY's doc — never main's caret (M1);
//   3. it still runs with main's caret parked inside a `codeBlock` (M3);
//   4. the pane's own actions are unaffected — origin === the pane's view;
//   5. a dispatch with NO registered handle is observable: `runEditorAction`
//      returns `"no-handle"` and warns in dev (M2), and so are the bridge's
//      other drop edges.
//
// The extension barrel transitively imports `@/lib/storage`; stub it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildCardBodySchema, starterKitConfigForScope } from "@/lib/tiptap/borrowed-schema";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import {
  registerEditorActionsHandle,
  runEditorAction,
  __resetEditorActionsRegistry,
} from "@/lib/actions/editor-actions-bridge";
import { resolveActionOrigin } from "@/lib/actions/action-origin";
import { owningEditor } from "@/lib/tiptap/owning-editor";

// ---------------------------------------------------------------------------
// Real editor stacks — a MAIN pane editor and a nested CARD BODY editor
// ---------------------------------------------------------------------------

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

/** A real MAIN editor whose first block is a paragraph or a `codeBlock` (the
 *  M3 case), caret parked at the end of that block. */
function mountMain(first: "paragraph" | "codeBlock"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const block =
    first === "codeBlock"
      ? { type: "codeBlock", attrs: { uuid: "code-A" }, content: [{ type: "text", text: "x = 1" }] }
      : {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text: "main text here" }],
        };
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [block, { type: "paragraph", attrs: { uuid: "para-B" }, content: [] }],
    },
  });
  // Caret at the end of the FIRST block's text.
  let caret: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (caret === null && node.type.name === (first === "codeBlock" ? "codeBlock" : "paragraph")) {
      caret = pos + 1 + node.content.size;
      return false;
    }
    return true;
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret ?? 1)),
  );
  return editor;
}

/** A real NESTED card-body editor — the extension stack `RichTextField` builds
 *  at the default `"card"` scope, which mounts `Citation` (and therefore its
 *  typed `\cite{}` input rule) unconditionally. */
function mountCardBody(text: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [
      StarterKit.configure(starterKitConfigForScope("card")),
      ...buildCardBodySchema("card", { includeLabelRef: true }),
    ],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
    },
  });
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
  );
  return editor;
}

/** Drive the REAL `handleTextInput` chain on a view — what typing a character
 *  does, without a DOM keyboard. */
function typeChar(editor: Editor, ch: string): boolean {
  const { from, to } = editor.state.selection;
  const view = editor.view;
  return !!view.someProp("handleTextInput", (f) =>
    f(view, from, to, ch, () => view.state.tr),
  );
}

/** Type `\cite{key}` at the caret: the literal prefix goes in as text (it is
 *  the closing brace the rule watches for), then the brace runs the rule. */
function typeCite(editor: Editor, key: string): boolean {
  editor.view.dispatch(editor.state.tr.insertText(`\\cite{${key}`));
  return typeChar(editor, "}");
}

function citationAtoms(editor: Editor): Array<{ citationId: string; command: string }> {
  const out: Array<{ citationId: string; command: string }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      out.push({
        citationId: node.attrs.citationId as string,
        command: node.attrs.command as string,
      });
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// A bridge handle built the way EditorPane builds it — through the ONE origin
// SSOT, so this fixture cannot drift from production on the thing under test.
// ---------------------------------------------------------------------------

let createCitation: ReturnType<typeof vi.fn>;
let seenCtx: ActionContext[];

function publishPaneHandle(paneEditor: Editor): void {
  const handle: EditorActionsHandle = {
    runAction(id: ActionId, seed) {
      const spec = VIRGIL_ACTION_REGISTRY[id];
      if (!spec) return "no-row";
      if (!paneEditor.isEditable) return "read-only";
      const { view, editor, ref } = resolveActionOrigin(paneEditor, seed.origin);
      const ctx: ActionContext = {
        editor,
        view,
        ref,
        surface: seed.surface,
        canEdit: paneEditor.isEditable,
        cardCreation: { createCitation } as unknown as ActionContext["cardCreation"],
        payload: seed.payload,
      };
      if (spec.applies(ctx) === "disabled") return "disabled";
      seenCtx.push(ctx);
      void spec.run(ctx);
      return "ran";
    },
  };
  registerEditorActionsHandle(paneEditor, handle);
}

beforeEach(() => {
  createCitation = vi.fn(() => ({ id: "cit-ref" }));
  seenCtx = [];
});

afterEach(() => {
  __resetEditorActionsRegistry();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// M1 — the origin is the firing document
// ---------------------------------------------------------------------------

describe("a typed \\cite{} inside a card body acts on THAT body (task 642, M1)", () => {
  it("lands the atom in the body and registers the card with the BODY's citationId", () => {
    const main = mountMain("paragraph");
    publishPaneHandle(main);
    const body = mountCardBody("as ");

    expect(typeCite(body, "smith2020")).toBe(true);

    // The atom is in the BODY, and nowhere in MAIN.
    const inBody = citationAtoms(body);
    expect(inBody).toHaveLength(1);
    expect(inBody[0].command).toBe("\\cite{smith2020}");
    expect(citationAtoms(main)).toEqual([]);

    // The card was registered, with the SAME id as the body's atom.
    expect(createCitation).toHaveBeenCalledTimes(1);
    expect(createCitation.mock.calls[0][0]).toMatchObject({
      citationId: inBody[0].citationId,
      command: "\\cite{smith2020}",
      unanchored: false,
    });
  });

  it("the ActionContext names the BODY's view and a position in the BODY's doc", () => {
    const main = mountMain("paragraph");
    publishPaneHandle(main);
    const body = mountCardBody("as ");
    const mainCaret = main.state.selection.head;

    expect(typeCite(body, "smith2020")).toBe(true);
    expect(seenCtx).toHaveLength(1);
    const ctx = seenCtx[0];

    // The firing view — not the pane's.
    expect(ctx.view).toBe(body.view);
    expect(ctx.view).not.toBe(main.view);
    // …and its owning editor, resolved off TipTap's own back-pointer.
    expect(ctx.editor).toBe(body);
    expect(owningEditor(body.view)).toBe(body);
    // The position is the BODY's caret, in the BODY's pos-space. Main's caret
    // sits at a LARGER pos (its doc is longer) — the pre-642 bridge handed that
    // number over, and it does not even name the same document.
    expect(ctx.ref.kind).toBe("cursor");
    expect(ctx.ref).toMatchObject({ pos: body.state.selection.head });
    expect((ctx.ref as { pos: number }).pos).not.toBe(mainCaret);
    expect((ctx.ref as { pos: number }).pos).toBeLessThanOrEqual(body.state.doc.content.size);
  });
});

// ---------------------------------------------------------------------------
// M3 — an unrelated caret in MAIN cannot suppress the body's card
// ---------------------------------------------------------------------------

describe("main's caret cannot gate a card typed in a body (task 642, M3)", () => {
  it("still registers the card with main's caret parked inside a codeBlock", () => {
    const main = mountMain("codeBlock");
    publishPaneHandle(main);
    // Precondition: main's caret really is inside a codeBlock — the block kind
    // that greys `citation` out. Without it this leg is vacuous.
    expect(main.state.doc.resolve(main.state.selection.head).parent.type.name).toBe(
      "codeBlock",
    );

    const body = mountCardBody("as ");
    expect(typeCite(body, "smith2020")).toBe(true);

    expect(citationAtoms(body)).toHaveLength(1);
    // Pre-642 `citationRun`'s `posBlockAllowsAction(doc, ref.pos, …)` re-gate
    // read MAIN's codeBlock caret and returned early — atom, no card.
    expect(createCitation).toHaveBeenCalledTimes(1);
  });

  it("a cite typed in MAIN's OWN codeBlock is still refused (the gate is not disarmed)", () => {
    const main = mountMain("codeBlock");
    publishPaneHandle(main);
    // The typed rule's own `blockKindAllowsAction` bail fires first — no atom,
    // no card. The point of the leg is that task 642 moved WHICH document the
    // gate reads, it did not remove the gate.
    expect(typeCite(main, "smith2020")).toBe(false);
    expect(citationAtoms(main)).toEqual([]);
    expect(createCitation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The pane's own surface is unchanged
// ---------------------------------------------------------------------------

describe("a pane-fired action is unaffected (the origin IS the pane's view)", () => {
  it("typing \\cite{} in main builds the ref from main's own caret", () => {
    const main = mountMain("paragraph");
    publishPaneHandle(main);

    expect(typeCite(main, "smith2020")).toBe(true);
    expect(seenCtx).toHaveLength(1);
    expect(seenCtx[0].view).toBe(main.view);
    expect(seenCtx[0].editor).toBe(main);
    expect(seenCtx[0].ref).toMatchObject({ pos: main.state.selection.head });
    expect(createCitation).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// M2 — a dropped card half is observable
// ---------------------------------------------------------------------------

describe("a dropped dispatch is never silent (task 642, M2)", () => {
  it("no registered handle → runEditorAction returns \"no-handle\" and warns in dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = mountCardBody("as ");
    // Nothing published: the registry is empty (the afterEach reset ran).
    const outcome = runEditorAction(body.view, "citation", {
      surface: "typed",
      payload: { citationId: "cit-1", command: "\\cite{k}" },
    });
    expect(outcome).toBe("no-handle");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("no-handle");
    expect(String(warn.mock.calls[0][0])).toContain("citation");
  });

  it("the typed rule reaches that door — the atom lands and the drop is reported", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = mountCardBody("as ");
    // No handle anywhere. The atom is inserted synchronously ON PURPOSE (it must
    // land even if React is unmounted) — so this is exactly the orphan edge, and
    // it now says so instead of vanishing into `?.`.
    expect(typeCite(body, "smith2020")).toBe(true);
    expect(citationAtoms(body)).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("no-handle");
  });

  it("an unknown id and a read-only pane are reported as their own outcomes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const main = mountMain("paragraph");
    publishPaneHandle(main);

    expect(
      runEditorAction(main.view, "definitely-not-an-action" as ActionId, { surface: "typed" }),
    ).toBe("no-row");

    main.setEditable(false);
    expect(runEditorAction(main.view, "citation", { surface: "typed" })).toBe("read-only");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("a successful dispatch returns \"ran\" and warns about nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const main = mountMain("paragraph");
    publishPaneHandle(main);
    const outcome = runEditorAction(main.view, "citation", {
      surface: "typed",
      payload: { citationId: "cit-1", command: "\\cite{k}" },
    });
    expect(outcome).toBe("ran");
    expect(warn).not.toHaveBeenCalled();
  });
});
