// @vitest-environment jsdom
/**
 * Task 389, end to end through the REAL drop controller: **the "Re-anchor this
 * snippet?" answer resolves on `Return` alone.**
 *
 * This is Gabriel's own gesture. `textObjectSideReanchorSpec` is the repo's only
 * `confirm`-classifying spec, so the dialog it raises always opens at the END of
 * a POINTER drag — and pre-389 that was the whole problem. The producers
 * `preventDefault()` their mousedown to suppress native focus, so DOM focus never
 * leaves the editor; the dialog's only claim on it is a deferred one-shot rAF
 * scheduled from a commit where the dialog renders `null`; and Enter-to-confirm
 * was gated on that claim having landed. Escape closed (it was unconditional),
 * Return did nothing — exactly the report.
 *
 * The leg drives `beginDropSession` → mousemove → `commitDropSession`, wires
 * `ctx.confirm` to the REAL `useConfirmDialog` the `DropModeProvider` mounts, and
 * then presses ONE key: Enter, on `document.body`, with focus nowhere near the
 * dialog. The spec's `applyDrop` must run.
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

let mockPlacement: Placement | null = null;
vi.mock("../hit-test", () => ({
  hitTest: () => mockPlacement,
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

import { act, cleanup, render } from "@testing-library/react";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  setDropCtx,
} from "../controller";
import type { DropCtx, ParagraphAnchorApi, Placement } from "../types";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { __resetDialogStack } from "@/components/dialog-stack";

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

function buildDoc(): PMNode {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ uuid: "OLD" }, schema.text("first")),
    schema.nodes.paragraph.create({ uuid: "NEW" }, schema.text("second")),
  ]);
}

const CARD_KEY = "note:N1";

/* ── the rAF pump (jsdom has no frame clock worth trusting) ──────── */
const rafs: FrameRequestCallback[] = [];
let realRaf: typeof window.requestAnimationFrame;
let realCaf: typeof window.cancelAnimationFrame;

function flushFrames() {
  const pending = rafs.splice(0, rafs.length);
  act(() => {
    for (const cb of pending) cb(performance.now());
  });
}

beforeEach(() => {
  mockPlacement = null;
  realRaf = window.requestAnimationFrame;
  realCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafs.push(cb);
    return rafs.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
  cleanup();
  rafs.length = 0;
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
  __resetDialogStack();
  vi.restoreAllMocks();
});

interface Harness {
  editor: Editor;
  anchoredTo: string[];
  removed: string[];
}

/** Mounts the REAL confirm dialog the DropModeProvider mounts, and hands the
 *  controller the REAL `confirm` door it awaits. */
function harness(): Harness {
  const doc = buildDoc();
  const editor = {
    state: EditorState.create({ schema, doc }),
    schema,
    view: { dispatch: () => {}, focus: () => {} },
  } as unknown as Editor;

  const anchoredTo: string[] = [];
  const removed: string[] = [];
  const notes: ParagraphAnchorApi = {
    exists: () => true,
    getAnchorTextObjectIds: () =>
      anchoredTo.length ? [...anchoredTo] : ["OLD"],
    addTextObjectLink: (_id, pid) => anchoredTo.push(pid),
    removeTextObjectLink: (_id, pid) => removed.push(pid),
  };

  let confirmFn: DropCtx["confirm"] | null = null;
  function Host() {
    const { confirm, dialog } = useConfirmDialog();
    confirmFn = confirm as DropCtx["confirm"];
    return <>{dialog}</>;
  }
  render(<Host />);

  const ctx: DropCtx = {
    mainEditor: editor,
    notes,
    confirm: (opts: Parameters<NonNullable<DropCtx["confirm"]>>[0]) =>
      confirmFn!(opts),
  } as unknown as DropCtx;
  setDropCtx(ctx);
  return { editor, anchoredTo, removed };
}

function sidePlacement(editor: Editor): Placement {
  return {
    kind: "paragraph-side",
    editor,
    paragraphId: "NEW",
    side: "right",
    rect: { x: 0, y: 0, width: 4, height: 20 },
  };
}

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
  await new Promise((r) => setTimeout(r, 30));
  return started;
}

function pressKey(key: string) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("the re-anchor confirm answers to Return", () => {
  it("DEFECT: focus never left the editor — Enter alone re-anchors the note", async () => {
    const h = harness();
    expect(await startAndMove(sidePlacement(h.editor))).toBe(true);

    const commit = commitDropSession();
    // The dialog mounts inside the mouseup dispatch; let React settle it.
    await act(async () => {});
    flushFrames();

    // The stolen/never-claimed-focus state the report is about.
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    expect(document.activeElement).toBe(document.body);

    pressKey("Enter");
    await commit;

    expect(h.anchoredTo).toEqual(["NEW"]);
    expect(h.removed).toEqual(["OLD"]);
  });

  it("Escape still declines the re-anchor and changes nothing", async () => {
    const h = harness();
    expect(await startAndMove(sidePlacement(h.editor))).toBe(true);

    const commit = commitDropSession();
    await act(async () => {});
    flushFrames();

    pressKey("Escape");
    await commit;

    expect(h.anchoredTo).toEqual([]);
    expect(h.removed).toEqual([]);
  });
});
