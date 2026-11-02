// @vitest-environment jsdom
/**
 * Task 389, end to end through the REAL drop controller: **a drop's confirm
 * resolves on `Return` alone.**
 *
 * Reported on the "Re-anchor this snippet?" dialog. Task 1423 deleted that
 * dialog (a reversible move asks nothing; a drop may confirm only a
 * `tone: "danger"` drop — `drop-confirm-policy-census.test.ts`), so the leg now
 * drives a stub DANGER spec through the same controller branch. Any drop's
 * dialog opens at the END of a POINTER drag — and pre-389 that was the whole
 * problem. The producers
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

/** The one shape a drop confirm may take (task 1423): a destructive drop. */
const applied: string[] = [];
const dangerSpec = {
  allowedPlacements: ["paragraph-side"],
  targetScope: "main-only",
  classifyDrop: () => ({
    kind: "confirm",
    tone: "danger",
    title: "Replace this paragraph?",
    message: "Its text is deleted.",
    confirmLabel: "Replace",
  }),
  applyDrop: (p: Placement) => {
    if (p.kind === "paragraph-side") applied.push(p.paragraphId);
    return true;
  },
} as unknown as DropSpec;
vi.mock("../registry", () => ({
  lookupSpec: () => dangerSpec,
  MODULE_DROP_SPECS: [],
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
import type { DropCtx, DropSpec, Placement } from "../types";
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
  applied.length = 0;
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

  let confirmFn: DropCtx["confirm"] | null = null;
  function Host() {
    const { confirm, dialog } = useConfirmDialog();
    confirmFn = confirm as DropCtx["confirm"];
    return <>{dialog}</>;
  }
  render(<Host />);

  const ctx: DropCtx = {
    mainEditor: editor,
    confirm: (opts: Parameters<NonNullable<DropCtx["confirm"]>>[0]) =>
      confirmFn!(opts),
  } as unknown as DropCtx;
  setDropCtx(ctx);
  return { editor };
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

describe("a drop confirm answers to Return", () => {
  it("DEFECT: focus never left the editor — Enter alone answers the cued default", async () => {
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
    // Pre-389 Enter did nothing and this await never settled. A danger
    // confirm cues CANCEL (task 386: a destruction is never one stray Enter
    // away), so the answer Return gives is "no".
    await commit;

    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
    expect(applied).toEqual([]);
  });

  it("the destructive button stays keyboard-reachable — Enter on it applies the drop", async () => {
    const h = harness();
    expect(await startAndMove(sidePlacement(h.editor))).toBe(true);

    const commit = commitDropSession();
    await act(async () => {});
    flushFrames();

    const replace = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Replace",
    );
    expect(replace).toBeTruthy();
    act(() => replace!.focus());
    act(() => {
      replace!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await commit;

    expect(applied).toEqual(["NEW"]);
  });

  it("Escape still declines the drop and changes nothing", async () => {
    const h = harness();
    expect(await startAndMove(sidePlacement(h.editor))).toBe(true);

    const commit = commitDropSession();
    await act(async () => {});
    flushFrames();

    pressKey("Escape");
    await commit;

    expect(applied).toEqual([]);
  });
});
