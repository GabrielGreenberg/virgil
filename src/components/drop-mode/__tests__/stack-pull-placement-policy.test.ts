// @vitest-environment jsdom
/**
 * Task 258 — a stack pull's placements are PER PAYLOAD, and the affordance and
 * the commit read the same table.
 *
 * The defect: `stackPullDropSpec` declared
 * `["between-blocks", "inline-cursor", "paragraph-side"]` and the hit-test's
 * priority loop returned the first geometry-matching entry. `inGap`/`inText`
 * partition every cursor position, so index 0 or index 1 always matched first
 * and **`paragraph-side` was structurally unreachable**. Pulling a note/todo/
 * archive/revision/cutter CARD out of the Stack onto a paragraph therefore
 * painted an inline caret, and at mouseup the spec's own per-payload check
 * refused `inline-cursor` for a card → `{kind:"no-op"}` → the drop silently did
 * nothing. The `paragraph-side` arm of that check and the whole `paragraphId`
 * anchoring branch behind it were dead code: a pulled card could never anchor.
 *
 * The legs, in the order they'd fail on the pre-fix tree:
 *   1. a CARD over paragraph TEXT hit-tests to `paragraph-side` (was
 *      `inline-cursor`) — and the commit accepts it and anchors the card;
 *   2. a CARD in a block GAP still lands unanchored (unchanged);
 *   3. a TEXT payload keeps the inline caret over text / the block bar in a gap
 *      (the placement that would have broken under a naive reorder);
 *   4. a PARAGRAPH payload over text now yields NO placement — the honest half
 *      of the same defect (an inviting caret over a commit that refuses it);
 *   5. an `example` card offers no placement anywhere, because its pull is a
 *      documented no-op;
 *   6. the derivation guard: for EVERY `StackCardKind`, "declares
 *      paragraph-side" ⟺ "its `applyDrop` branch actually passes the
 *      paragraphId to its `ctx.stack` factory" — run against the REAL applyDrop
 *      with a recording API, so the declaration cannot drift from the branch.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { hitTest } from "../hit-test";
import { resolveSessionPlacements } from "../placement-policy";
import { registerDropTarget } from "../target-registry";
import {
  stackPullDropSpec,
  stackPullPlacementsFor,
} from "../specs/stack-pull";
import type { DropCtx, Placement, StackPullApi } from "../types";
import {
  STACK_PULL_PREFIX,
  STACK_STORAGE_KEY,
  type StackCardKind,
  type StackItem,
  type StackPayload,
} from "@/lib/stack/types";

// ── Schema / doc ────────────────────────────────────────────────────────────
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
});

const PARA_ID = "p1";
const doc = schema.nodes.doc.create(null, [
  schema.nodes.paragraph.create({ uuid: PARA_ID }, schema.text("hello world")),
]);

// ── Geometry ────────────────────────────────────────────────────────────────
// One paragraph occupying y 100–120 in a 300px-wide column. A cursor at
// IN_TEXT_Y is inside its text rect; at IN_GAP_Y it is below the block (the
// hairline gap the between-blocks bar lives in).
const BLOCK_TOP = 100;
const BLOCK_BOTTOM = 120;
const IN_TEXT_Y = 110;
const IN_GAP_Y = 130;
const CURSOR_X = 150;

const rect = (): DOMRect => {
  const box = {
    top: BLOCK_TOP,
    bottom: BLOCK_BOTTOM,
    left: 64,
    right: 364,
    width: 300,
    height: BLOCK_BOTTOM - BLOCK_TOP,
    x: 64,
    y: BLOCK_TOP,
  };
  return { ...box, toJSON: () => box } as DOMRect;
};

/**
 * A mock main editor wired for the FULL hit-test path: registered in the
 * target registry, `elementsFromPoint` pointing at its `.ProseMirror` root,
 * `posAtCoords` landing inside the paragraph's text, `nodeDOM` returning an
 * element with the rect above.
 */
function mountEditor(): Editor {
  let state = EditorState.create({ schema, doc });
  const dom = document.createElement("div");
  dom.className = "ProseMirror";
  const blockEl = document.createElement("p");
  blockEl.getBoundingClientRect = rect;
  dom.appendChild(blockEl);
  document.body.appendChild(dom);
  const view = {
    dom,
    get state() {
      return state;
    },
    posAtCoords: () => ({ pos: 2, inside: 0 }),
    coordsAtPos: () => ({ left: 120, top: BLOCK_TOP, bottom: BLOCK_BOTTOM, right: 121 }),
    nodeDOM: () => blockEl,
    dispatch: (tr: Transaction) => {
      state = state.apply(tr);
    },
    focus: () => {},
  };
  const editor = {
    isEditable: true,
    get state() {
      return state;
    },
    view,
  } as unknown as Editor;
  registerDropTarget(editor);
  document.elementsFromPoint = () => [dom];
  return editor;
}

// ── Stack fixtures ──────────────────────────────────────────────────────────
const KEY = `${STACK_PULL_PREFIX}:item-1`;

function seedStack(payload: StackPayload) {
  const item: StackItem = {
    id: "item-1",
    capturedAt: "2026-07-31T00:00:00.000Z",
    source: { docId: null },
    payload,
  };
  localStorage.setItem(
    STACK_STORAGE_KEY,
    JSON.stringify({ version: 1, items: [item] }),
  );
}

const cardPayload = (cardKind: StackCardKind): StackPayload =>
  ({ kind: "card", card: { cardKind, data: {} } }) as unknown as StackPayload;

/** Drive the real hit-test the way the controller does: the session's
 *  placements resolved ONCE from the spec + key, then the per-move test. */
function hit(editor: Editor, y: number): Placement | null {
  return hitTest(
    CURSOR_X,
    y,
    stackPullDropSpec,
    resolveSessionPlacements(stackPullDropSpec, KEY),
    KEY,
    editor,
  );
}

// ── Recording ctx ───────────────────────────────────────────────────────────
interface Call {
  method: string;
  args: unknown[];
}

function recordingCtx(editor: Editor): { ctx: DropCtx; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return { id: "new" } as never;
    };
  const stack: StackPullApi = {
    addNote: rec("addNote"),
    addHighlight: rec("addHighlight"),
    addTodo: rec("addTodo"),
    addArchive: rec("addArchive"),
    addRevisionComment: rec("addRevisionComment"),
    addRevisionSuggestion: rec("addRevisionSuggestion"),
    addCutterComment: rec("addCutterComment"),
    addCutterSuggestion: rec("addCutterSuggestion"),
    addFootnote: rec("addFootnote"),
    addCitation: rec("addCitation"),
    upsertBibEntry: rec("upsertBibEntry"),
    setAnnotation: rec("setAnnotation"),
  };
  const ctx = {
    mainEditor: editor,
    closePopout: () => {},
    confirm: async () => true,
    stack,
  } as unknown as DropCtx;
  return { ctx, calls };
}

const paragraphSidePlacement = (editor: Editor): Placement => ({
  kind: "paragraph-side",
  editor,
  paragraphId: PARA_ID,
  side: "right",
  rect: { x: 0, y: 0, width: 2, height: 20 },
});

// ── Tests ───────────────────────────────────────────────────────────────────

let editor: Editor;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  editor = mountEditor();
});

describe("a CARD payload over paragraph text — the unreachable placement", () => {
  it("hit-tests to paragraph-side (NOT the inline caret) and carries the paragraph uuid", () => {
    seedStack(cardPayload("note"));
    const placement = hit(editor, IN_TEXT_Y);
    expect(placement).not.toBeNull();
    // Pre-fix this was "inline-cursor" — a caret no card kind accepts.
    expect(placement!.kind).toBe("paragraph-side");
    expect(
      (placement as Extract<Placement, { kind: "paragraph-side" }>).paragraphId,
    ).toBe(PARA_ID);
  });

  it("the commit ACCEPTS that placement and anchors the card to the paragraph", () => {
    seedStack(cardPayload("note"));
    const placement = hit(editor, IN_TEXT_Y)!;
    const { ctx, calls } = recordingCtx(editor);

    expect(stackPullDropSpec.classifyDrop(placement, KEY, ctx)).toEqual({
      kind: "apply",
    });
    stackPullDropSpec.applyDrop(placement, KEY, ctx);

    expect(calls.map((c) => c.method)).toEqual(["addNote"]);
    expect(calls[0].args[0]).toBe(PARA_ID);
  });

  it("in a block GAP it still lands UNANCHORED (between-blocks, paragraphId null)", () => {
    seedStack(cardPayload("note"));
    const placement = hit(editor, IN_GAP_Y)!;
    expect(placement.kind).toBe("between-blocks");

    const { ctx, calls } = recordingCtx(editor);
    expect(stackPullDropSpec.classifyDrop(placement, KEY, ctx)).toEqual({
      kind: "apply",
    });
    stackPullDropSpec.applyDrop(placement, KEY, ctx);
    expect(calls[0].method).toBe("addNote");
    expect(calls[0].args[0]).toBeNull();
  });
});

describe("the other payloads — the placements a naive reorder would have broken", () => {
  it("a TEXT slice keeps the inline caret over text and the block bar in a gap", () => {
    seedStack({ kind: "text", slice: { content: [] }, plain: "x" });
    expect(hit(editor, IN_TEXT_Y)?.kind).toBe("inline-cursor");
    expect(hit(editor, IN_GAP_Y)?.kind).toBe("between-blocks");
  });

  it("a PARAGRAPH payload over TEXT offers NOTHING (no misleading caret)", () => {
    seedStack({ kind: "paragraph", node: { type: "paragraph" } });
    // Pre-fix: an inline caret painted here and the commit refused it.
    expect(hit(editor, IN_TEXT_Y)).toBeNull();
    expect(hit(editor, IN_GAP_Y)?.kind).toBe("between-blocks");
  });

  it("a HEADING payload behaves the same (gap-only)", () => {
    seedStack({ kind: "heading", nodes: [] });
    expect(hit(editor, IN_TEXT_Y)).toBeNull();
    expect(hit(editor, IN_GAP_Y)?.kind).toBe("between-blocks");
  });

  it("an EXAMPLE card offers no placement anywhere — its pull is a no-op", () => {
    seedStack(cardPayload("example"));
    expect(hit(editor, IN_TEXT_Y)).toBeNull();
    expect(hit(editor, IN_GAP_Y)).toBeNull();
  });

  it("an unresolvable key (item evicted mid-drag) offers no placement", () => {
    localStorage.clear();
    expect(hit(editor, IN_TEXT_Y)).toBeNull();
    expect(hit(editor, IN_GAP_Y)).toBeNull();
  });
});

describe("the per-card-kind table is DERIVED from what applyDrop does", () => {
  const ALL_CARD_KINDS: StackCardKind[] = [
    "note",
    "highlight",
    "footnote",
    "citation",
    "bibliography",
    "example",
    "todo",
    "archive",
    "revision-comment",
    "revision-suggestion",
    "cutter-comment",
    "cutter-suggestion",
  ];

  it.each(ALL_CARD_KINDS)(
    "%s: declares paragraph-side ⟺ its branch passes the paragraphId",
    (cardKind) => {
      seedStack(cardPayload(cardKind));
      const declared = stackPullPlacementsFor(KEY);
      const { ctx, calls } = recordingCtx(editor);

      // Run the REAL apply at a paragraph-side placement, whatever the
      // declaration says — the point is to compare the two.
      stackPullDropSpec.applyDrop(paragraphSidePlacement(editor), KEY, ctx);
      const anchored = calls.some((c) => c.args.includes(PARA_ID));

      expect(declared.includes("paragraph-side")).toBe(anchored);
      // And an EMPTY declaration means the branch does nothing at all — the
      // only honest reason to offer no landing site.
      expect(declared.length === 0).toBe(calls.length === 0);
    },
  );

  it("the declared envelope is the union of every per-payload list", () => {
    // `allowedPlacements` is the capability envelope, not a priority order.
    expect([...stackPullDropSpec.allowedPlacements].sort()).toEqual(
      ["between-blocks", "inline-cursor", "paragraph-side"].sort(),
    );
  });
});
