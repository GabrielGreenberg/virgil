// @vitest-environment jsdom
/**
 * Task 482 — **a gesture's exit state must not change the NEXT gesture's
 * payload KIND at the same pixel.**
 *
 * The reported repro, in a flat 4-item bullet list [Alpha, Beta, Gamma, Delta]:
 *
 *   1. drag Beta below Delta — a clean, correct reorder, uuid conserved;
 *   2. grab "Beta" again at the same visual spot and release it 6px into
 *      Gamma's first text line — the natural "put it back on that row" aim.
 *
 * Pre-482 that spliced Beta's TEXT into Gamma's paragraph MID-WORD and left
 * Beta's `listItem` behind as an EMPTY husk still carrying its uuid — an
 * invisible blank bullet every anchored card and marker now points at, and two
 * undo steps to recover. From the BASELINE state the identical gesture at the
 * identical pixel is a clean no-op. Nothing in between was broken: the commit
 * ended with `selectInsertedSpan`, leaving a non-empty TextSelection over the
 * moved item; the grab-handle resolver gives a live non-empty TextSelection
 * ABSOLUTE priority over the hovered block, so the one handle at that row was a
 * SelectionRef; a SelectionRef lift hydrates a transient `linkedRange` and
 * routes to `textRangeMoveDropSpec`, whose placements include `inline-cursor`.
 *
 * TWO halves close it and each is sufficient on its own — deliberately, because
 * the exit state is only ONE producer of a whole-block selection:
 *
 *   A. `placeCaretAtLanding` (was `selectInsertedSpan`) — a whole-node splice
 *      leaves a CARET, never a content-spanning selection. The resolver's
 *      rule 1 requires `from !== to`, so it cannot fire at all.
 *   B. `resolveSelectionGrab` — a selection covering exactly ONE textblock's
 *      whole content is a statement about that BLOCK, whoever made it (a
 *      triple-click, a `Cmd+A` inside one block, a text-range move that landed
 *      as one new block).
 *
 * **No pre-482 suite drove two gestures in a row**, which is exactly how this
 * shipped: every drop-mode fixture builds one pristine state, plans one drop and
 * reads the transaction. The sequence legs below dispatch commit 1 into the
 * state commit 2 is planned against.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy({}, { get: (_t, p) => (p === "__esModule" ? true : p === "then" ? undefined : noop) });
});

const blocksAtY = vi.fn<(y: number) => Array<{ uuid: string; el: HTMLElement }> | null>();
vi.mock("@/lib/editor-geometry", () => ({
  geomHoverEnabled: () => true,
  getGeometry: () => ({ blocksAtY }),
}));
const PORTAL_ORIGIN = { top: 100, left: 40 };
vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({ frameRef: { current: frame }, version: 0 }),
}));
vi.mock("@/lib/marginalia-blocks", () => ({ resolveDomForUuid: () => null }));

import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { textObjectDropSpec } from "../specs/textobject";
import { lookupSpec } from "../registry";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import type { DropCtx, Placement } from "../types";
import {
  resolveSelectionGrab,
  selectionOwnerId,
  wholeBlockSelection,
} from "@/text-objects/selection-payload";
import { TextObjectGrabHandle } from "@/text-objects/TextObjectGrabHandle";
import { notePointerInput } from "@/lib/input-modality";

// ── The REAL main-editor schema ─────────────────────────────────────────────

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
  } as unknown as EditorExtensionsCtx;
}
const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));
const ZERO = { x: 0, y: 0, width: 0, height: 0 };

// A `listItem` is a DEFERRING_PARENT: its inner paragraph yields identity to
// the item and carries NO uuid of its own. Getting that wrong is the whole
// difference between the resolver answering `listItem` and answering
// `paragraph`, so the fixture spells production's shape exactly.
const item = (uuid: string, text: string) => ({
  type: "listItem",
  attrs: { uuid },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** The reported fixture: a flat 4-item bullet list. */
function flatList(): PMNode {
  return schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "bulletList",
        attrs: { uuid: "ul" },
        content: [
          item("alpha", "Alpha flat bullet one."),
          item("beta", "Beta flat bullet two."),
          item("gamma", "Gamma flat bullet three."),
          item("delta", "Delta flat bullet four."),
        ],
      },
    ],
  });
}

/**
 * A LIVE editor stub: `dispatch` APPLIES, so the second gesture in a sequence
 * is planned against the document the first one produced. Every prior drop-mode
 * fixture pushes the transaction onto an array and never applies it, which is
 * precisely why the sequence class was unrepresentable in all of them.
 */
function liveEditor(doc: PMNode) {
  const e = {
    state: EditorState.create({ schema, doc }),
    view: {
      dispatch: (tr: Transaction) => {
        e.state = e.state.apply(tr);
      },
      focus: () => {},
      nodeDOM: () => null,
    },
  };
  return {
    editor: e as unknown as Editor,
    ctx: { mainEditor: e as unknown as Editor } as unknown as DropCtx,
  };
}

const betweenBlocks = (editor: Editor, insertPos: number): Placement => ({
  kind: "between-blocks",
  editor,
  insertPos,
  rect: ZERO,
});

/** Position of the gap BEFORE the list item carrying `uuid`, and AFTER it. */
function itemGaps(doc: PMNode, uuid: string): { before: number; after: number } {
  let before = -1;
  let after = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "listItem" && node.attrs?.uuid === uuid) {
      before = pos;
      after = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  return { before, after };
}

/** The ITEM identities — what an anchored card or marker points at. A wrap
 *  legitimately MINTS a fresh container uuid (an item pulled to top level gets
 *  a new list around it), so the conservation claim is about the items. */
function itemUuids(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((n) => {
    if (n.type.name !== "listItem") return true;
    const u = n.attrs?.uuid as string | undefined;
    if (typeof u === "string" && u) out.push(u);
    return true;
  });
  return out;
}

function itemTexts(d: PMNode): string[] {
  const out: string[] = [];
  d.descendants((n) => {
    if (n.type.name === "listItem") out.push(n.textContent);
    return true;
  });
  return out;
}

const KEY = (uuid: string) => `textobject:listItem:${uuid}`;

// ── A. The exit state ───────────────────────────────────────────────────────

describe("a block move's exit state is a CARET, not a content selection", () => {
  it("leaves the selection collapsed inside what landed", () => {
    const { editor, ctx } = liveEditor(flatList());
    const gaps = itemGaps(editor.state.doc, "delta");
    const plan = textObjectDropSpec.planDrop!(betweenBlocks(editor, gaps.after), KEY("beta"), ctx);
    expect(plan).not.toBeNull();
    plan!.commit();

    const sel = editor.state.selection;
    expect(sel.empty, "a whole-NODE splice never leaves a content selection").toBe(true);
    // …and it landed inside the moved item, not at doc top.
    const moved = itemGaps(editor.state.doc, "beta");
    expect(sel.from).toBeGreaterThan(moved.before);
    expect(sel.from).toBeLessThan(moved.after);
  });

  it("so the grab-handle resolver's rule 1 cannot fire — the payload is the BLOCK", () => {
    const { editor, ctx } = liveEditor(flatList());
    const gaps = itemGaps(editor.state.doc, "delta");
    textObjectDropSpec.planDrop!(betweenBlocks(editor, gaps.after), KEY("beta"), ctx)!.commit();

    expect(resolveSelectionGrab(editor.state.selection, editor.state.doc)).toBeNull();
  });

  it("DEFECT LEG: the retired exit rule produced a whole-block TextSelection", () => {
    // The retired `selectInsertedSpan`, reimplemented locally rather than
    // re-parameterising the live one — so this leg fails for the reason it
    // names instead of by arithmetic identity.
    const { editor, ctx } = liveEditor(flatList());
    const gaps = itemGaps(editor.state.doc, "delta");
    textObjectDropSpec.planDrop!(betweenBlocks(editor, gaps.after), KEY("beta"), ctx)!.commit();

    const moved = itemGaps(editor.state.doc, "beta");
    const retiredTr = editor.state.tr;
    retiredTr.setSelection(
      TextSelection.between(
        retiredTr.doc.resolve(moved.before + 1),
        retiredTr.doc.resolve(moved.after - 1),
      ),
    );
    const retiredSel = retiredTr.selection;
    expect(retiredSel.empty, "the retired rule left a NON-empty selection").toBe(false);

    // The retired resolver rule (pre-482 `resolveActiveRefs` rule 1): any
    // non-empty TextSelection with a uuid-bearing ancestor → a SelectionRef.
    const retiredOwner = selectionOwnerId(retiredTr.doc, retiredSel.from);
    expect(retiredOwner, "…whose owner was the moved item").toBe("beta");

    // The LIVE rule answers the BLOCK for the very same selection — half B on
    // its own is enough, which is why both shipped.
    const grab = resolveSelectionGrab(retiredSel, retiredTr.doc);
    expect(grab?.payload).toBe("block");
    expect(grab?.payload === "block" && grab.ref.kind).toBe("listItem");
    expect(grab?.payload === "block" && grab.ref.id).toBe("beta");
  });
});

// ── B. The whole-block rule ─────────────────────────────────────────────────

describe("a text lift is a PARTIAL range", () => {
  const doc = flatList();
  const state = EditorState.create({ schema, doc });
  const beta = itemGaps(doc, "beta");
  // The item's paragraph content runs [before + 2, after - 2] — one token for
  // the listItem's own open, one for the paragraph's.
  const wholeFrom = beta.before + 2;
  const wholeTo = beta.after - 2;

  it("a selection over one block's WHOLE content resolves to that block", () => {
    const sel = TextSelection.create(doc, wholeFrom, wholeTo);
    const grab = resolveSelectionGrab(sel, doc);
    expect(grab?.payload).toBe("block");
    expect(grab?.payload === "block" && grab.ref.id).toBe("beta");
    // The owner is the uuid-bearing `listItem`, never its uuid-less inner
    // paragraph — the DEFERRING_PARENTS fact both ladders already knew.
    expect(grab?.payload === "block" && grab.ref.kind).toBe("listItem");
  });

  it("CONTROL: a genuinely PARTIAL selection is still a text lift", () => {
    const grab = resolveSelectionGrab(TextSelection.create(doc, wholeFrom + 1, wholeTo), doc);
    expect(grab?.payload).toBe("range");
    expect(grab?.payload === "range" && grab.ref.kind).toBe("selection");
  });

  it("CONTROL: a selection spanning TWO blocks is still a text lift", () => {
    const gamma = itemGaps(doc, "gamma");
    const grab = resolveSelectionGrab(TextSelection.create(doc, wholeFrom, gamma.after - 3), doc);
    expect(grab?.payload).toBe("range");
  });

  it("CONTROL: a collapsed caret and a NodeSelection both decline rule 1", () => {
    expect(resolveSelectionGrab(TextSelection.create(doc, wholeFrom), doc)).toBeNull();
    const list = itemGaps(doc, "beta");
    expect(
      resolveSelectionGrab(NodeSelection.create(doc, list.before), doc),
    ).toBeNull();
    void state;
  });

  it("wholeBlockSelection is offset-exact at BOTH ends", () => {
    expect(wholeBlockSelection(TextSelection.create(doc, wholeFrom, wholeTo), doc)).not.toBeNull();
    expect(wholeBlockSelection(TextSelection.create(doc, wholeFrom, wholeTo - 1), doc)).toBeNull();
    expect(wholeBlockSelection(TextSelection.create(doc, wholeFrom + 1, wholeTo), doc)).toBeNull();
  });
});

// ── C. The SEQUENCE — two REAL commits back to back ─────────────────────────

describe("sequences compose — the second drag has the first's semantics", () => {
  it("reorder twice conserves every uuid and every word", () => {
    const { editor, ctx } = liveEditor(flatList());
    const before = itemUuids(editor.state.doc).slice().sort();
    const beforeTexts = itemTexts(editor.state.doc).slice().sort();

    // Move 1: Beta below Delta.
    textObjectDropSpec
      .planDrop!(betweenBlocks(editor, itemGaps(editor.state.doc, "delta").after), KEY("beta"), ctx)!
      .commit();
    expect(itemTexts(editor.state.doc).map((t) => t.slice(0, 5))).toEqual([
      "Alpha", "Gamma", "Delta", "Beta ",
    ]);

    // Move 2: the SAME item, back above Gamma — the "put it back on that row"
    // aim. Pre-482 the handle at that pixel was a SelectionRef and this was a
    // TEXT slice.
    const grab = resolveSelectionGrab(editor.state.selection, editor.state.doc);
    expect(grab, "the exit state offers no text-lift payload").toBeNull();
    textObjectDropSpec
      .planDrop!(betweenBlocks(editor, itemGaps(editor.state.doc, "gamma").before), KEY("beta"), ctx)!
      .commit();

    expect(itemTexts(editor.state.doc).map((t) => t.slice(0, 5))).toEqual([
      "Alpha", "Beta ", "Gamma", "Delta",
    ]);
    expect(itemUuids(editor.state.doc).slice().sort()).toEqual(before);
    expect(itemTexts(editor.state.doc).slice().sort()).toEqual(beforeTexts);
    // No EMPTY husk: every listItem still carries its text.
    expect(itemTexts(editor.state.doc).filter((t) => t.length === 0)).toEqual([]);
    expect(editor.state.doc.check()).toBeUndefined();
  });

  it("in → out → in conserves every ITEM identity and every word", () => {
    const { editor, ctx } = liveEditor(flatList());
    const before = itemUuids(editor.state.doc).slice().sort();
    const beforeTexts = itemTexts(editor.state.doc).slice().sort();

    // Out of the list, to the very top of the document — the adapter WRAPS,
    // minting a fresh single-item `bulletList` around it.
    textObjectDropSpec.planDrop!(betweenBlocks(editor, 0), KEY("beta"), ctx)!.commit();
    expect(resolveSelectionGrab(editor.state.selection, editor.state.doc)).toBeNull();
    // Back in, above Gamma.
    const back = textObjectDropSpec.planDrop!(
      betweenBlocks(editor, itemGaps(editor.state.doc, "gamma").before),
      KEY("beta"),
      ctx,
    );
    expect(back).not.toBeNull();
    back!.commit();

    expect(itemUuids(editor.state.doc).slice().sort()).toEqual(before);
    expect(itemTexts(editor.state.doc).filter((t) => t.length > 0).sort()).toEqual(beforeTexts);
    expect(editor.state.doc.check()).toBeUndefined();
  });

  it("RESIDUAL, stated: the out-move's MINTED wrapper is left behind empty", () => {
    // Pre-existing and independent of task 482 — a different mechanism from the
    // reported husk, and recorded here rather than implied. Pulling an item to
    // top level mints a `bulletList` around it (content `listItem+`); moving it
    // back cuts its SOLE child, so ProseMirror keeps the schema's minimal
    // residue — an empty `listItem` in a list nothing else occupies.
    //
    // It is NOT the reported class: that husk carried the SOURCE's uuid, so
    // every anchored card and marker followed it onto an invisible blank
    // bullet. This one is a freshly MINTED container whose residue item carries
    // no uuid at all, so nothing points at it — a visible empty bullet, not a
    // silent re-anchoring.
    //
    // Closing it is task 320's SHED question one level up ("shedding a shell
    // TRANSFERS its identity; it must never destroy it"), and `AGENTS.md` is
    // explicit that "the schema permits it" is not "it was residue" — a
    // container-level shed has to answer for `alignedGlossRow`, `heading` and
    // `titleField` before it can be safe. Deliberately out of scope here.
    const { editor, ctx } = liveEditor(flatList());
    textObjectDropSpec.planDrop!(betweenBlocks(editor, 0), KEY("beta"), ctx)!.commit();
    textObjectDropSpec
      .planDrop!(betweenBlocks(editor, itemGaps(editor.state.doc, "gamma").before), KEY("beta"), ctx)!
      .commit();

    const empty = itemTexts(editor.state.doc).filter((t) => t.length === 0);
    expect(empty, "one empty residue item, in the minted wrapper").toEqual([""]);
    // …and it carries NO identity, which is what keeps it out of the reported
    // class. Every uuid-bearing item still has its text.
    const orphanUuids = itemUuids(editor.state.doc);
    expect(orphanUuids.sort()).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("the pre-482 payload flip routed to a DIFFERENT spec — the class, named", () => {
    // The key a SelectionRef lift hydrates into is a `linkedRange`, and the
    // registry sends that to the inline-splicing spec. That routing is
    // unchanged and correct FOR A TEXT SLICE; what task 482 removed is the
    // block-move gesture's ability to produce one.
    expect(lookupSpec("textobject:linkedRange:t1")).toBe(textRangeMoveDropSpec);
    expect(lookupSpec(KEY("beta"))).toBe(textObjectDropSpec);
    expect(textRangeMoveDropSpec.allowedPlacements).toContain("inline-cursor");
  });
});

// ── D. The component — which handle is actually rendered ────────────────────

let editorEl: HTMLElement;
let listEl: HTMLElement;
let itemEl: HTMLElement;
let frame: Record<string, unknown>;

function rect(top: number, bottom: number, left = 200, right = 700): DOMRect {
  return {
    top, bottom, left, right,
    width: right - left, height: bottom - top, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function buildDom() {
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  Object.defineProperty(editorEl, "offsetHeight", { value: 800, configurable: true });
  editorEl.getBoundingClientRect = () => rect(0, 800, 200, 700);
  listEl = document.createElement("ul");
  listEl.setAttribute("data-uuid", "ul");
  listEl.setAttribute("data-text-object-kind", "bulletList");
  listEl.getBoundingClientRect = () => rect(300, 340, 230, 700);
  itemEl = document.createElement("li");
  itemEl.setAttribute("data-uuid", "beta");
  itemEl.setAttribute("data-text-object-kind", "listItem");
  itemEl.getBoundingClientRect = () => rect(300, 340, 260, 700);
  const p = document.createElement("p");
  p.textContent = "Beta flat bullet two.";
  p.getBoundingClientRect = () => rect(302, 338, 260, 700);
  itemEl.appendChild(p);
  listEl.appendChild(itemEl);
  editorEl.appendChild(listEl);
  document.body.appendChild(editorEl);

  const portal = document.createElement("div");
  portal.setAttribute("data-grab-handle-portal", "");
  const column = document.createElement("div");
  column.appendChild(portal);
  document.body.appendChild(column);
  frame = {
    editorEl, contentLeft: 260, editorRight: 700, scrollTop: 0, scrollBottom: 800,
    marginInset: 22, paperEl: column, paperRect: PORTAL_ORIGIN,
    containsHoverZone: () => true,
    toPortalCoords: (x: number, y: number) => ({
      x: x - PORTAL_ORIGIN.left, y: y - PORTAL_ORIGIN.top,
    }),
  };
}

/** A fake editor whose SELECTION the leg controls, over the real fixture doc. */
function handleEditor(sel: { from: number; to: number }): Editor {
  const doc = flatList();
  return {
    isDestroyed: false,
    isEditable: true,
    state: { selection: TextSelection.create(doc, sel.from, sel.to), doc },
    view: {
      dom: editorEl,
      coordsAtPos: () => ({ top: 305, bottom: 320, left: 262, right: 263 }),
      nodeDOM: () => itemEl,
    },
    on: () => {},
    off: () => {},
  } as unknown as Editor;
}

let rafQueue: FrameRequestCallback[] = [];
const flushFrames = () =>
  act(() => {
    for (let i = 0; i < 4 && rafQueue.length; i += 1) {
      const q = rafQueue;
      rafQueue = [];
      for (const cb of q) cb(0);
    }
  });

describe("the rendered handle names its owner", () => {
  beforeEach(() => {
    rafQueue = [];
    blocksAtY.mockReset();
    blocksAtY.mockImplementation(() => []);
    buildDom();
    notePointerInput();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => { rafQueue = []; });
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    notePointerInput();
  });

  const owners = () =>
    [...document.querySelectorAll<HTMLElement>(".text-object-grab-handle")].map((el) => ({
      kind: el.getAttribute("data-grab-owner-kind"),
      uuid: el.getAttribute("data-grab-owner-uuid"),
    }));

  it("a whole-block selection renders the BLOCK's handle, not a selection handle", () => {
    const doc = flatList();
    const beta = itemGaps(doc, "beta");
    render(<TextObjectGrabHandle editorRef={{ current: handleEditor({ from: beta.before + 2, to: beta.after - 2 }) }} />);
    flushFrames();
    expect(owners()).toEqual([{ kind: "listItem", uuid: "beta" }]);
  });

  it("CONTROL: a partial selection still renders a SELECTION handle", () => {
    const doc = flatList();
    const beta = itemGaps(doc, "beta");
    render(<TextObjectGrabHandle editorRef={{ current: handleEditor({ from: beta.before + 3, to: beta.after - 2 }) }} />);
    flushFrames();
    expect(owners()).toEqual([{ kind: "selection", uuid: null }]);
  });
});
