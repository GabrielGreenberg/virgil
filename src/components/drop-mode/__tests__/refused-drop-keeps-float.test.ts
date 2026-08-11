// @vitest-environment jsdom
/**
 * Task 321, end to end through the REAL controller: **a refused drop must not
 * close the popped-out float.**
 *
 * The three legs are the three ways the gesture can end, and the middle one is
 * the whole bug:
 *
 *  1. the drop LANDS → the document changes and `postDrop: "close"` dismisses
 *     the float (unchanged behaviour, and the control that keeps leg 2 honest);
 *  2. the spec REFUSES → `classifyDrop` reports `no-op`, `commitDropSession`
 *     cancels, nothing is dispatched and **the float survives**. Pre-fix the
 *     refusal lived only inside `applyDrop`, so this path ran `finishApply`,
 *     which set `applied = true` because nothing threw and closed the float
 *     over an untouched document — "it worked and then vanished";
 *  3. `applyDrop` THROWS → `finishApply` logs and leaves `applied` false, and
 *     the close is gated on that report. This was the harshest form of the same
 *     shape: the close ran unconditionally, so the card the user was dragging
 *     disappeared on the one path where something had actually gone wrong.
 *
 * Every leg drives `beginDropSession` → mousemove → `commitDropSession`, so the
 * controller's own branch (not just the spec's) is what is under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

// The controller resolves the placement through the hit-test on mousemove;
// mocking it lets these legs choose the geometry precisely (same precedent as
// controller-commit-flush.test.ts).
let mockPlacement: Placement | null = null;
vi.mock("../hit-test", () => ({
  hitTest: () => mockPlacement,
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  setDropCtx,
} from "../controller";
import type { DropCtx, Placement } from "../types";

// A `strictList` holds nothing but `strictItem`s, and neither name is in
// `TEXT_OBJECT_REGISTRY` or the container fit's wrap vocabulary — so its item
// gap is a position the fit must REFUSE (leg 2). See the twin fixture in
// planned-decision-guardrail.test.ts.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    strictList: {
      group: "block",
      content: "strictItem+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["ul", 0],
    },
    strictItem: {
      content: "paragraph",
      attrs: { uuid: { default: null } },
      toDOM: () => ["li", 0],
    },
    text: { group: "inline" },
  },
});

const para = (uuid: string | null, text: string) =>
  schema.nodes.paragraph.create({ uuid }, schema.text(text));
const sItem = (text: string) =>
  schema.nodes.strictItem.create(null, para(null, text));

/** doc( p#SRC, strictList(item, item), p#TAIL ) */
function buildDoc(): PMNode {
  return schema.nodes.doc.create(null, [
    para("SRC", "move me"),
    schema.nodes.strictList.create({ uuid: "SL" }, [sItem("one"), sItem("two")]),
    para("TAIL", "tail"),
  ]);
}

const CARD_KEY = "textobject:paragraph:SRC";

interface Harness {
  editor: Editor;
  doc: PMNode;
  dispatched: Transaction[];
  closed: string[];
}

function harness(opts?: { dispatchThrows?: boolean }): Harness {
  const doc = buildDoc();
  const dispatched: Transaction[] = [];
  const closed: string[] = [];
  const state = EditorState.create({ schema, doc });
  const editor = {
    state,
    schema,
    view: {
      dispatch: (tr: Transaction) => {
        if (opts?.dispatchThrows) throw new Error("dispatch exploded");
        dispatched.push(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  const ctx: DropCtx = {
    mainEditor: editor,
    closePopout: (key: string) => closed.push(key),
    confirm: async () => true,
  } as unknown as DropCtx;
  setDropCtx(ctx);
  return { editor, doc, dispatched, closed };
}

function gap(editor: Editor, insertPos: number): Placement {
  return {
    kind: "between-blocks",
    editor,
    insertPos,
    rect: { x: 0, y: 0, width: 100, height: 2 },
  };
}

/** The gap between the two strict items — refused by the container fit. */
const refusedPos = (d: PMNode) =>
  d.firstChild!.nodeSize + 1 + d.child(1).firstChild!.nodeSize;
/** A top-level gap, after the list — accepted. */
const acceptedPos = (d: PMNode) => d.firstChild!.nodeSize + d.child(1).nodeSize;

/** Drive the gesture the way the controller does, up to (not including) commit. */
async function startAndMove(placement: Placement): Promise<boolean> {
  mockPlacement = placement;
  const started = beginDropSession({
    cardKey: CARD_KEY,
    origin: { x: 10, y: 10 },
    externalCommit: true,
  });
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 20, clientY: 20, buttons: 1 }),
  );
  // Past the controller's ~16ms move throttle, so the deferred run fires.
  await new Promise((r) => setTimeout(r, 30));
  return started;
}

beforeEach(() => {
  mockPlacement = null;
});

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
  vi.restoreAllMocks();
});

describe("the float survives a drop the spec refuses", () => {
  it("LANDS: a gap that fits dispatches the move and closes the float", async () => {
    const h = harness();
    expect(await startAndMove(gap(h.editor, acceptedPos(h.doc)))).toBe(true);

    await commitDropSession();

    expect(h.dispatched).toHaveLength(1);
    expect(h.closed).toEqual([CARD_KEY]);
  });

  it("REFUSES: a gap the container cannot hold dispatches nothing and KEEPS the float", async () => {
    const h = harness();
    expect(await startAndMove(gap(h.editor, refusedPos(h.doc)))).toBe(true);

    await commitDropSession();

    expect(h.dispatched).toEqual([]);
    expect(h.closed).toEqual([]);
  });

  it("THROWS: a failing applyDrop is logged and the float is KEPT", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness({ dispatchThrows: true });
    expect(await startAndMove(gap(h.editor, acceptedPos(h.doc)))).toBe(true);

    await commitDropSession();

    expect(errors).toHaveBeenCalled();
    expect(h.closed).toEqual([]);
  });
});
