// @vitest-environment jsdom
/**
 * Task 1401 — a footnote/citation card drag resolves its atom within its OWN
 * pane, never through "whatever editor is mounted".
 *
 * Under multi-doc keep-alive, a hidden pane holding a sibling paper (a Finder
 * copy, a file sharing parse ids) keeps its editors registered with the drop
 * target registry. `locateAtom` used to walk every registered editor, so an
 * unanchored card X in paper A, dropped onto A's prose, FOUND an atom with
 * id X in hidden paper B — the resolution became `move-across`, which deleted
 * the atom (and its footnote body) out of B. The registry now records each
 * editor's owning pane, and both the by-id lookup and the hit-test consult
 * only the session ctx's own pane.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { inlineAtomMoveSpec } from "../util/inline-atom-move";
import { hitTest } from "../hit-test";
import {
  dropTargetOwner,
  getEditorsOwnedBy,
  registerDropTarget,
} from "../target-registry";
import type { DropCtx, DropSpec, Placement } from "../types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      attrs: { footnoteId: { default: "" }, number: { default: 1 } },
      toDOM: () => ["span", { "data-type": "footnote" }, "1"],
    },
  },
});

const ID = "fn-shared-7q";
const CARD_KEY = `float:card:footnote:${ID}`;

function plainDoc(): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("alpha bravo")]),
  ]);
}

function docWithAtom(): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("home "),
      schema.node("footnote", { footnoteId: ID }),
      schema.text(" tail"),
    ]),
  ]);
}

function liveEditor(doc: PMNode) {
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  const dom = document.createElement("div");
  dom.className = "ProseMirror";
  let posProbes = 0;
  const editor = {
    schema,
    get state() {
      return state;
    },
    get isEditable() {
      return true;
    },
    view: {
      dom,
      editable: true,
      get state() {
        return state;
      },
      nodeDOM: () => null,
      posAtCoords: () => {
        posProbes++;
        return null;
      },
      dispatch: (tr: Transaction) => {
        dispatched.push(tr);
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, getState: () => state, posProbes: () => posProbes };
}

function inlineCursor(editor: Editor, pos: number): Placement {
  return {
    kind: "inline-cursor",
    editor,
    pos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
}

const unregister: Array<() => void> = [];
afterEach(() => {
  while (unregister.length) unregister.pop()!();
});

describe("task 1401 — by-id atom lookup stays inside the dragging pane", () => {
  it("registry: each editor is enumerated only under its own owner", () => {
    const a = liveEditor(plainDoc());
    const b = liveEditor(docWithAtom());
    unregister.push(registerDropTarget(a.editor, "pane-a"));
    unregister.push(registerDropTarget(b.editor, "pane-b"));
    expect(getEditorsOwnedBy("pane-a")).toEqual([a.editor]);
    expect(getEditorsOwnedBy("pane-b")).toEqual([b.editor]);
    expect(getEditorsOwnedBy(null)).toEqual([]);
    expect(dropTargetOwner(b.editor)).toBe("pane-b");
  });

  it("an id collision in a HIDDEN sibling pane is invisible: the drop CREATES in A and B is byte-identical", () => {
    const a = liveEditor(plainDoc());
    const b = liveEditor(docWithAtom()); // hidden keep-alive pane, same id
    unregister.push(registerDropTarget(a.editor, "pane-a"));
    unregister.push(registerDropTarget(b.editor, "pane-b"));
    const bBefore = b.getState().doc;

    const spec = inlineAtomMoveSpec({
      nodeName: "footnote",
      idAttr: "footnoteId",
      createAtom: ({ id, schema: s }) =>
        s.nodes.footnote!.create({ footnoteId: id, number: 0 }),
    });
    const ctx = { owner: "pane-a", mainEditor: a.editor } as unknown as DropCtx;

    expect(spec.classifyDrop(inlineCursor(a.editor, 3), CARD_KEY, ctx).kind).toBe(
      "apply",
    );
    spec.applyDrop(inlineCursor(a.editor, 3), CARD_KEY, ctx);

    let created = 0;
    a.getState().doc.descendants((n) => {
      if (n.type.name === "footnote" && n.attrs.footnoteId === ID) created++;
    });
    expect(created).toBe(1);
    expect(b.dispatched).toHaveLength(0);
    expect(b.getState().doc.eq(bBefore)).toBe(true);
  });

  it("without a create factory, a foreign pane's atom is NOT found (no-op), while a same-pane card body's IS", () => {
    const spec = inlineAtomMoveSpec({ nodeName: "footnote", idAttr: "footnoteId" });
    const a = liveEditor(plainDoc());
    const foreign = liveEditor(docWithAtom());
    unregister.push(registerDropTarget(a.editor, "pane-a"));
    unregister.push(registerDropTarget(foreign.editor, "pane-b"));
    const ctx = { owner: "pane-a", mainEditor: a.editor } as unknown as DropCtx;
    expect(spec.classifyDrop(inlineCursor(a.editor, 3), CARD_KEY, ctx).kind).toBe(
      "no-op",
    );

    // The same atom in a card body of pane A itself is still located.
    const body = liveEditor(docWithAtom());
    unregister.push(registerDropTarget(body.editor, "pane-a"));
    expect(spec.classifyDrop(inlineCursor(a.editor, 3), CARD_KEY, ctx).kind).not.toBe(
      "no-op",
    );
  });
});

describe("task 1401 — the hit-test refuses an editor owned by another pane", () => {
  const spec = { targetScope: "any-editor" } as unknown as DropSpec;
  const probe = (editor: Editor, owner: string | null | undefined) => {
    document.elementsFromPoint = () => [editor.view.dom];
    return hitTest(
      10,
      10,
      spec,
      ["inline-cursor"],
      CARD_KEY,
      null,
      null as never,
      null as never,
      null,
      owner,
    );
  };

  it("a foreign-owned editor under the pointer is no target — never even probed", () => {
    const b = liveEditor(plainDoc());
    unregister.push(registerDropTarget(b.editor, "pane-b"));
    expect(probe(b.editor, "pane-a")).toBeNull();
    expect(b.posProbes()).toBe(0);
  });

  it("the session's own pane's editor is probed as before", () => {
    const a = liveEditor(plainDoc());
    unregister.push(registerDropTarget(a.editor, "pane-a"));
    probe(a.editor, "pane-a");
    expect(a.posProbes()).toBe(1);
  });
});
