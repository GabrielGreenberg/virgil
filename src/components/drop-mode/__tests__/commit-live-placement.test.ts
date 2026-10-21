// @vitest-environment jsdom
/**
 * **Task 1217 — a drop's WRITE asks the live document.**
 *
 * `commitDropSession` used to commit the `Placement` its LAST pointermove
 * recorded. For `between-blocks` / `inline-cursor` that is a raw ProseMirror
 * position, so a concurrent writer between the last move and the release (an
 * AI sidecar writeback, the external-change reload, a code-pane re-parse)
 * landed the drop at a stale-but-valid offset. The controller now stamps each
 * positional fact with the doc it was measured against and, on a mismatch at
 * commit, re-runs the ONE move pass at the release point (addressing law:
 * "the affordance may ask the snapshot; the WRITE asks the live doc").
 *
 * Every leg runs against a doc that has MOVED since capture — an unchanged doc
 * proves nothing (the law's CI note) — with a control on an unmoved doc.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// ── Harness: a hit-test that answers from the LIVE doc of the editor ────────
//
// It resolves "the gap before the paragraph reading TARGET" (or "the caret just
// after `TARGET`'s first character") every time it is asked — exactly what the
// real hit-test does under a pointer that has not moved. Its calls are counted
// so a test can prove the commit re-asked (or, on an unmoved doc, did not).
type Mode = "between-blocks" | "inline-cursor";
let mode: Mode = "between-blocks";
const hitCalls: Array<{ sourceRange: unknown }> = [];
vi.mock("../hit-test", () => ({
  hitTest: (
    _x: number,
    _y: number,
    _spec: unknown,
    _placements: unknown,
    _key: unknown,
    editor: Editor | null,
    _inline: unknown,
    _block: unknown,
    sourceRange: unknown,
  ) => {
    hitCalls.push({ sourceRange });
    if (!editor) return null;
    const pos = targetGap(editor.state.doc);
    if (pos === null) return null;
    const rect = { x: 0, y: 0, width: 1, height: 1 };
    return mode === "between-blocks"
      ? { kind: "between-blocks", editor, insertPos: pos, rect }
      : { kind: "inline-cursor", editor, pos: pos + 2, rect };
  },
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

let decisionKind: "apply" | "confirm" = "apply";
const applied: Placement[] = [];
const sourceRangeCalls: number[] = [];
const fakeSpec = {
  allowedPlacements: ["between-blocks", "inline-cursor"],
  targetScope: "any-editor",
  postDrop: "none",
  sourceRangeFor: (_key: string, ctx: DropCtx) => {
    const editor = ctx.mainEditor!;
    const pos = targetGap(editor.state.doc, "SOURCE");
    sourceRangeCalls.push(pos ?? -1);
    return pos === null ? null : { editor, from: pos, to: pos + 8 };
  },
  classifyDrop: () =>
    decisionKind === "apply"
      ? { kind: "apply" }
      : { kind: "confirm", title: "t", message: "m", confirmLabel: "ok" },
  applyDrop: (p: Placement) => {
    applied.push(p);
    return true;
  },
} as unknown as DropSpec;
vi.mock("../registry", () => ({
  lookupSpec: () => fakeSpec,
  MODULE_DROP_SPECS: [],
}));

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import type { DropCtx, DropSpec, Placement } from "../types";

const SCHEMA = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
});

/** Position immediately before the paragraph whose text is `text`. */
function targetGap(doc: PMNode, text = "TARGET"): number | null {
  let found: number | null = null;
  doc.forEach((node, offset) => {
    if (found === null && node.textContent === text) found = offset;
  });
  return found;
}

const p = (t: string) => SCHEMA.node("paragraph", null, [SCHEMA.text(t)]);

function liveEditor() {
  let state = EditorState.create({
    schema: SCHEMA,
    doc: SCHEMA.node("doc", null, [p("SOURCE"), p("one"), p("TARGET"), p("two")]),
  });
  const editor = {
    schema: SCHEMA,
    get state() {
      return state;
    },
    view: {
      get state() {
        return state;
      },
      dispatch: (tr: ReturnType<EditorState["tr"]["insert"]>) => {
        state = state.apply(tr);
      },
    },
  } as unknown as Editor;
  return {
    editor,
    /** A concurrent writer: insert a block at the very top of the doc. */
    insertAbove() {
      editor.view.dispatch(state.tr.insert(0, p("concurrent")));
    },
    /** A concurrent writer: delete the target paragraph outright. */
    deleteTarget() {
      const from = targetGap(state.doc)!;
      editor.view.dispatch(state.tr.delete(from, from + state.doc.nodeAt(from)!.nodeSize));
    },
  };
}

let confirmResolve: ((ok: boolean) => void) | null = null;

async function grab(editor: Editor) {
  setDropCtx({
    mainEditor: editor,
    closePopout: vi.fn(),
    confirm: () => new Promise<boolean>((r) => (confirmResolve = r)),
  } as unknown as DropCtx);
  expect(
    beginDropSession({
      cardKey: "float:card:note:n1",
      origin: { x: 10, y: 10 },
      externalCommit: true,
    }),
  ).toBe(true);
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 200, clientY: 200, buttons: 1 }),
  );
  await new Promise((r) => setTimeout(r, 30));
  expect(getDropSession()?.placement).not.toBeNull();
}

beforeEach(() => {
  mode = "between-blocks";
  decisionKind = "apply";
  hitCalls.length = 0;
  applied.length = 0;
  sourceRangeCalls.length = 0;
  confirmResolve = null;
});
afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
});

describe("commitDropSession — a positional placement is re-asked against the live doc", () => {
  it("between-blocks: a block inserted ABOVE the target lands the drop at the live gap", async () => {
    const m = liveEditor();
    await grab(m.editor);
    const recorded = getDropSession()!.placement as Extract<Placement, { kind: "between-blocks" }>;
    m.insertAbove();
    const live = targetGap(m.editor.state.doc)!;
    expect(live).not.toBe(recorded.insertPos); // the doc MOVED
    await commitDropSession();
    expect(applied).toHaveLength(1);
    expect((applied[0] as typeof recorded).insertPos).toBe(live);
  });

  it("inline-cursor: the caret position is re-asked the same way", async () => {
    mode = "inline-cursor";
    const m = liveEditor();
    await grab(m.editor);
    const recorded = getDropSession()!.placement as Extract<Placement, { kind: "inline-cursor" }>;
    m.insertAbove();
    await commitDropSession();
    expect(applied).toHaveLength(1);
    const pos = (applied[0] as typeof recorded).pos;
    expect(pos).not.toBe(recorded.pos);
    expect(pos).toBe(targetGap(m.editor.state.doc)! + 2);
  });

  it("the target region DELETED: the drop cancels cleanly — no throw, no landing", async () => {
    const m = liveEditor();
    await grab(m.editor);
    m.deleteTarget();
    await expect(commitDropSession()).resolves.toBeUndefined();
    expect(applied).toEqual([]);
    expect(getDropSession()).toBeNull();
  });

  it("the session's sourceRange is re-resolved too, and the re-ask reads the fresh one", async () => {
    const m = liveEditor();
    await grab(m.editor);
    expect(sourceRangeCalls).toEqual([0]);
    m.insertAbove();
    await commitDropSession();
    const sourceNow = targetGap(m.editor.state.doc, "SOURCE")!;
    expect(sourceRangeCalls).toEqual([0, sourceNow]);
    expect(hitCalls.at(-1)?.sourceRange).toMatchObject({ from: sourceNow });
  });

  it("control: an UNMOVED doc commits the recorded placement without re-asking", async () => {
    const m = liveEditor();
    await grab(m.editor);
    const recorded = getDropSession()!.placement;
    const calls = hitCalls.length;
    await commitDropSession();
    expect(hitCalls.length).toBe(calls);
    expect(sourceRangeCalls).toHaveLength(1);
    expect(applied).toEqual([recorded]);
  });

  it("confirm leg: a doc that moves while the dialog is open refuses the positional write", async () => {
    decisionKind = "confirm";
    const m = liveEditor();
    await grab(m.editor);
    const pending = commitDropSession();
    await Promise.resolve();
    m.insertAbove();
    confirmResolve!(true);
    await pending;
    expect(applied).toEqual([]);
    expect(getDropSession()).toBeNull();
  });

  it("confirm leg control: an unmoved doc applies after the dialog", async () => {
    decisionKind = "confirm";
    const m = liveEditor();
    await grab(m.editor);
    const pending = commitDropSession();
    await Promise.resolve();
    confirmResolve!(true);
    await pending;
    expect(applied).toHaveLength(1);
  });
});
