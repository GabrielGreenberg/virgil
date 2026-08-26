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
 * The legs. FOUR fail when the pre-fix selection is restored (verified by
 * temporarily pointing the hit-test's switch back at `spec.allowedPlacements`):
 *   1. a CARD over paragraph TEXT hit-tests to `paragraph-side` (was
 *      `inline-cursor`) — and the commit accepts it and anchors the card;
 *   2. a PARAGRAPH (and a HEADING) payload over text now yields NO placement —
 *      the honest half of the same defect (an inviting caret over a commit that
 *      refuses it);
 *   3. a card kind this build doesn't carry offers no placement anywhere (until
 *      task 259 this leg read `example`, a DECLARED kind whose pull was a
 *      documented no-op; 259 retired the kind rather than keeping the empty
 *      offer, so the same geometry is now exercised through a retired-kind
 *      snapshot);
 *   4. an unresolvable key offers none either.
 *
 * The rest are NON-REGRESSION pins that hold identically before and after, and
 * are here because they are what a naive fix breaks: a CARD in a block gap
 * still lands unanchored, and a TEXT payload keeps the inline caret over text
 * (which is what reordering the union — the tempting one-line "fix" — would
 * have destroyed).
 *
 * Two structural legs carry the rest of the weight:
 *   • the WIRING leg drives the real controller (`beginDropSession` + a
 *     synthetic mousemove), because every other leg calls `hitTest` directly
 *     and would stay green if `handleMove` were reverted to pass
 *     `spec.allowedPlacements` — which typechecks, and is the original bug;
 *   • the DERIVATION leg iterates `CARD_PLACEMENTS`'s own keys and asserts
 *     "declares paragraph-side" ⟺ "its `applyDrop` branch passes the
 *     paragraphId to its `ctx.stack` factory", against the REAL applyDrop with
 *     a recording API — so a kind the compiler forces someone to declare is a
 *     kind this suite then checks.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { hitTest } from "../hit-test";
import { resolveSessionPlacements } from "../placement-policy";
import { TEXT_ONLY_PAYLOAD } from "../inline-host";
import { registerDropTarget } from "../target-registry";
import {
  beginDropSession,
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import {
  CARD_PLACEMENTS,
  STACK_PULL_PLACEMENT_LISTS,
  stackPullBlockPayloadFor,
  stackPullDropSpec,
  stackPullPlacementsFor,
} from "../specs/stack-pull";
import type { DropCtx, Placement, StackPullApi } from "../types";
import {
  STACK_CARD_KINDS,
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
    // This suite's schema has no verbatim block and its payloads are cards /
    // paragraphs, so the inline CONTAINER question (task 414) has nothing to
    // refuse here — stated explicitly rather than defaulted, which is why the
    // parameter is required.
    TEXT_ONLY_PAYLOAD,
    // The BLOCK payload (task 416), through the spec's own resolver — the
    // paragraph/heading pulls declare one and the card/text pulls declare
    // EMPTY, which is exactly what keeps a card's paragraph-side reach intact.
    stackPullBlockPayloadFor(KEY),
    // A Stack pull has no source in the target document, so it declares no
    // source range (task 480) — the ANSWER, not a default.
    null,
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
    // A READ, not a factory: deliberately unrecorded, so the per-kind
    // derivations below stay a census of what a branch CREATES (task 235).
    getAnnotation: () => "",
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

/** A block gap — the one geometry EVERY card kind's list admits. */
const betweenBlocksPlacement = (editor: Editor): Placement => ({
  kind: "between-blocks",
  editor,
  insertPos: editor.state.doc.content.size,
  rect: { x: 0, y: 0, width: 300, height: 2 },
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

  // RENEGOTIATED in place (task 416), with the reason at the site. These two
  // legs pinned `null` over TEXT, and the sentence they carried — "an inline
  // caret painted here and the commit refused it" — names the defect the 258
  // fix closed, which was that a CARET painted. It was never a claim that a
  // whole-block payload has nothing to offer over a block's text: over a LIST,
  // where there are no top-level gaps between the items, that reading meant no
  // bar anywhere over the list body, which is the F0 half of task 416. Since
  // 416 a block payload declares itself (`blockPayloadFor`) and gets the
  // candidate ladder over text as well as in gaps. What must NOT come back is
  // the caret, and that is what these legs now pin — plus the gap answer,
  // unchanged.
  it("a PARAGRAPH payload over TEXT offers a BLOCK bar, never a caret", () => {
    seedStack({ kind: "paragraph", node: { type: "paragraph" } });
    expect(hit(editor, IN_TEXT_Y)?.kind).toBe("between-blocks");
    expect(hit(editor, IN_GAP_Y)?.kind).toBe("between-blocks");
  });

  it("a HEADING payload behaves the same", () => {
    seedStack({ kind: "heading", nodes: [] });
    expect(hit(editor, IN_TEXT_Y)?.kind).toBe("between-blocks");
    expect(hit(editor, IN_GAP_Y)?.kind).toBe("between-blocks");
  });

  it("a card kind this build no longer carries offers no placement anywhere", () => {
    // Was the `example` leg: until task 259 `example` was a DECLARED member of
    // the vocabulary whose pull branch was a documented no-op, so it offered
    // nothing anywhere. 259 removed the kind instead of the offer — a kind that
    // cannot round-trip is not in `STACK_CARD_KINDS` at all — so this is now the
    // retired-kind door (a snapshot persisted by an older build), which must
    // answer the same way.
    seedStack({
      kind: "card",
      card: { cardKind: "example", data: {} },
    } as unknown as StackPayload);
    expect(hit(editor, IN_TEXT_Y)).toBeNull();
    expect(hit(editor, IN_GAP_Y)).toBeNull();
  });

  it("an unresolvable key (item evicted mid-drag) offers no placement", () => {
    localStorage.clear();
    expect(hit(editor, IN_TEXT_Y)).toBeNull();
    expect(hit(editor, IN_GAP_Y)).toBeNull();
  });

  it("a payload shape this build doesn't know offers nothing and REFUSES — never throws", () => {
    // `readEnvelope` validates the envelope version and that `items` is an
    // array, then casts — so an item written by another build, or carrying a
    // card kind since renamed, arrives typed as something it is not. Both
    // unknown-shape doors must answer "nowhere": a nullish answer would fall
    // back to the envelope (restoring the unreachable order) at hover and throw
    // on `.includes` inside `classifyDrop` at commit, which the controller does
    // not catch — wedging the session and the whole drop-mode CSS state.
    for (const rogue of [
      { kind: "card", card: { cardKind: "retired-kind", data: {} } },
      { kind: "some-future-payload", blob: 1 },
    ]) {
      seedStack(rogue as unknown as StackPayload);
      expect(stackPullPlacementsFor(KEY)).toEqual([]);
      expect(resolveSessionPlacements(stackPullDropSpec, KEY)).toEqual([]);
      expect(hit(editor, IN_TEXT_Y)).toBeNull();
      expect(hit(editor, IN_GAP_Y)).toBeNull();
      const { ctx } = recordingCtx(editor);
      expect(() =>
        stackPullDropSpec.classifyDrop(
          paragraphSidePlacement(editor),
          KEY,
          ctx,
        ),
      ).not.toThrow();
      expect(
        stackPullDropSpec.classifyDrop(paragraphSidePlacement(editor), KEY, ctx),
      ).toEqual({ kind: "no-op" });
    }
  });
});

describe("the per-card-kind table is DERIVED from what applyDrop does", () => {
  // The table's OWN keys, not a hand-written twin: `CARD_PLACEMENTS` is a
  // Record over `StackCardKind`, so a 13th kind is a compile error there — and
  // iterating it here means that same kind is compared against its branch. A
  // literal list would satisfy the type and silently skip the new kind.
  const ALL_CARD_KINDS = Object.keys(CARD_PLACEMENTS) as StackCardKind[];

  it("covers every stackable card kind", () => {
    expect(new Set(ALL_CARD_KINDS)).toEqual(new Set(STACK_CARD_KINDS));
  });

  it("no declared kind offers NOWHERE — an empty list is the untrusted-input answer", () => {
    // Task 259. `example` used to sit in this table declaring `[]`, because its
    // pull branch did nothing: stackable at every link of the chain by name and
    // at none in fact. The vocabulary no longer admits such a member, so an
    // empty placement list can only come from a payload this build doesn't
    // understand — which is what the retired-kind and evicted-key legs above
    // assert. Without this, a future kind could be re-added with a placeholder
    // branch and the per-kind derivation leg below would pass it (`[] ⇔ no
    // calls` is satisfied by a kind that does nothing at all).
    for (const kind of ALL_CARD_KINDS) {
      expect(CARD_PLACEMENTS[kind].length, `${kind}: empty placement list`)
        .toBeGreaterThan(0);
    }
  });

  it.each(ALL_CARD_KINDS)(
    "%s: declares paragraph-side ⟺ its branch passes the paragraphId",
    (cardKind) => {
      seedStack(cardPayload(cardKind));
      const declared = stackPullPlacementsFor(KEY);

      // RENEGOTIATED by task 321 — net stronger, with one loss named. This leg
      // used to drive the apply at a paragraph-side placement "whatever the
      // declaration says", because `applyDrop` consulted `isPlacementValidFor`
      // nowhere — only `classifyDrop` did, so a direct apply ran the branch at a
      // geometry the spec would have refused. Both doors are now derived from
      // one `planDrop`, so the commit enforces the table too, and the
      // declaration is checked at BOTH geometries instead:
      //
      //   • a GAP (every kind's list admits it) — the branch must create
      //     something, unanchored. This is the leg that keeps the paragraph-side
      //     half below from being vacuously satisfied by a kind that does
      //     nothing at all, which is what the old `[] ⇔ no calls` line covered.
      //   • the SIDE — anchored iff declared, and REFUSED outright when not.
      //
      // THE LOSS, stated: because the commit now refuses a geometry the table
      // doesn't declare, the ⟸ direction is satisfied by that refusal rather
      // than by the branch ignoring a paragraphId. A gap-only kind whose branch
      // WOULD anchor if it were ever reached is no longer detected here — it is
      // unreachable through the spec, which is why this is a coverage loss and
      // not a correctness one. The harmful direction (a kind declaring
      // paragraph-side whose branch drops the anchor) still bites.
      const gap = recordingCtx(editor);
      stackPullDropSpec.applyDrop(betweenBlocksPlacement(editor), KEY, gap.ctx);
      expect(gap.calls.length, `${cardKind}: no factory ran at a gap`)
        .toBeGreaterThan(0);
      expect(gap.calls.some((c) => c.args.includes(PARA_ID))).toBe(false);

      const side = recordingCtx(editor);
      stackPullDropSpec.applyDrop(paragraphSidePlacement(editor), KEY, side.ctx);
      const anchored = side.calls.some((c) => c.args.includes(PARA_ID));
      expect(declared.includes("paragraph-side")).toBe(anchored);
      expect(declared.includes("paragraph-side")).toBe(side.calls.length > 0);
    },
  );

  it("the declared envelope is the union of every per-payload list", () => {
    // `allowedPlacements` is the capability envelope, not a priority order.
    expect([...stackPullDropSpec.allowedPlacements].sort()).toEqual(
      ["between-blocks", "inline-cursor", "paragraph-side"].sort(),
    );
  });

  it("every answer this spec can give is one the reachability census sees", () => {
    // `STACK_PULL_PLACEMENT_LISTS` dedupes by IDENTITY, and the census checks
    // only what it publishes — so a branch that returned a freshly-built array
    // would be censused by nothing. Assert the live answers ARE the published
    // objects, for every payload shape, so that premise is enforced rather
    // than merely stated in a comment.
    const payloads: StackPayload[] = [
      { kind: "text", slice: { content: [] }, plain: "x" },
      { kind: "paragraph", node: { type: "paragraph" } },
      { kind: "heading", nodes: [] },
      ...ALL_CARD_KINDS.map(cardPayload),
    ];
    for (const payload of payloads) {
      seedStack(payload);
      const answer = stackPullPlacementsFor(KEY);
      expect({
        payload: payload.kind,
        published: STACK_PULL_PLACEMENT_LISTS.includes(answer),
      }).toEqual({ payload: payload.kind, published: true });
    }
  });
});

describe("the controller WIRING — the list the session resolves is the list the hit-test walks", () => {
  /**
   * Every other leg calls `hitTest` directly with a hand-resolved list, so all
   * of them would stay green if `handleMove` were reverted to pass
   * `session.spec.allowedPlacements` — which typechecks (both are
   * `ReadonlyArray<PlacementKind>`) and IS the task-258 bug. This leg is the
   * one that fails on that revert.
   */
  function mouseMove(x: number, y: number) {
    window.dispatchEvent(
      // `buttons: 1` — the controller's missed-release failsafe cancels a move
      // with the primary button no longer held.
      new MouseEvent("mousemove", { clientX: x, clientY: y, buttons: 1 }),
    );
  }
  /** The controller throttles hit-testing to ~16 ms and DEFERS a too-soon move
   *  onto a timer, so a move dispatched right after a previous test's may not
   *  have run yet. Wait past the window before asserting. */
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it("a card pull driven through beginDropSession lands on paragraph-side over text", async () => {
    seedStack(cardPayload("note"));
    const { ctx } = recordingCtx(editor);
    setDropCtx(ctx);
    try {
      expect(
        beginDropSession({ cardKey: KEY, origin: { x: CURSOR_X, y: 0 } }),
      ).toBe(true);
      expect(getDropSession()?.placements).toEqual([
        "between-blocks",
        "paragraph-side",
      ]);
      mouseMove(CURSOR_X, IN_TEXT_Y);
      await settle();
      expect(getDropSession()?.placement?.kind).toBe("paragraph-side");
    } finally {
      cancelDropSession();
      setDropCtx(null);
    }
  });

  it("resolves the payload ONCE per gesture, not once per move", async () => {
    // The documented perf law behind `DropSession.placements`: stack-pull's
    // resolution parses the whole Stack envelope out of localStorage, so moving
    // it into the throttled hit-test would put a getItem + JSON.parse on every
    // pointermove of every drag.
    seedStack(cardPayload("note"));
    const { ctx } = recordingCtx(editor);
    setDropCtx(ctx);
    const real = Storage.prototype.getItem;
    let stackReads = 0;
    Storage.prototype.getItem = function (key: string) {
      if (key === STACK_STORAGE_KEY) stackReads++;
      return real.call(this, key);
    };
    try {
      beginDropSession({ cardKey: KEY, origin: { x: CURSOR_X, y: 0 } });
      const afterBegin = stackReads;
      for (let i = 0; i < 6; i++) mouseMove(CURSOR_X, IN_TEXT_Y + i);
      await settle();
      expect(getDropSession()?.placement?.kind).toBe("paragraph-side");
      expect(stackReads).toBe(afterBegin);
    } finally {
      Storage.prototype.getItem = real;
      cancelDropSession();
      setDropCtx(null);
    }
  });
});
