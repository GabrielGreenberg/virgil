// @vitest-environment jsdom
/**
 * **Task 1025 — a commit's continuation acts only while ITS session is alive.**
 *
 * `commitDropSession`'s confirm leg awaits a dialog. While it is open the
 * session can end on a path the commit cannot see — a pane unmount disposes
 * its DropCtx (`registerDropCtx` → `cancelDropSession`), or another ending —
 * and the continuation used to call `finishApply` regardless: a late "yes"
 * applied the drop against a torn-down ctx. The leg now re-checks the session
 * (by serial) after the await and bails if it is gone or replaced.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

let mockPlacement: Placement | null = null;
vi.mock("../hit-test", () => ({
  hitTest: () => mockPlacement,
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_editor: unknown, id: string) => id,
}));

const applyCalls: string[] = [];
const fakeSpec = {
  allowedPlacements: ["paragraph-side"],
  targetScope: "main-only",
  postDrop: "close",
  classifyDrop: () => ({ kind: "confirm", title: "Re-anchor?", message: "?" }),
  applyDrop: (_p: Placement, key: string) => {
    applyCalls.push(key);
    return true;
  },
} as unknown as DropSpec;
vi.mock("../registry", () => ({
  lookupSpec: () => fakeSpec,
  MODULE_DROP_SPECS: [],
}));

import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import type { DropCtx, DropSpec, Placement } from "../types";

const fakeEditor = { state: {}, view: { dispatch() {} } } as unknown as Editor;

/** A confirm whose answer the test hands back LATER. */
function deferredConfirm() {
  let resolve!: (ok: boolean) => void;
  const confirm = vi.fn(
    () =>
      new Promise<boolean>((r) => {
        resolve = r;
      }),
  );
  return { confirm, answer: (ok: boolean) => resolve(ok) };
}

async function startSession(cardKey: string) {
  mockPlacement = {
    kind: "paragraph-side",
    editor: fakeEditor,
    paragraphId: "P1",
    side: "left",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  } as unknown as Placement;
  expect(
    beginDropSession({ cardKey, origin: { x: 10, y: 10 }, externalCommit: true }),
  ).toBe(true);
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 20, clientY: 20, buttons: 1 }),
  );
  await new Promise((r) => setTimeout(r, 30));
}

describe("the confirm leg re-checks its session after the await (task 1025)", () => {
  let closePopout: ReturnType<typeof vi.fn>;
  let gate: ReturnType<typeof deferredConfirm>;

  beforeEach(() => {
    applyCalls.length = 0;
    closePopout = vi.fn();
    gate = deferredConfirm();
    setDropCtx({
      mainEditor: null,
      closePopout,
      requestAnchorFlush: () => undefined,
      confirm: gate.confirm,
    } as unknown as DropCtx);
  });
  afterEach(() => {
    cancelDropSession();
    setDropCtx(null);
  });

  it("a session cancelled while the dialog is open: a late `true` applies NOTHING", async () => {
    await startSession("float:card:note:n1");
    const commit = commitDropSession();
    expect(gate.confirm).toHaveBeenCalledTimes(1);
    // The pane tears down mid-dialog.
    cancelDropSession();
    gate.answer(true);
    await commit;
    expect(applyCalls).toEqual([]);
    expect(closePopout).not.toHaveBeenCalled();
  });

  it("a late `false` never ends a NEWER session that replaced it", async () => {
    await startSession("float:card:note:n1");
    const commit = commitDropSession();
    cancelDropSession();
    await startSession("float:card:note:n2");
    gate.answer(false);
    await commit;
    expect(getDropSession()?.cardKey).toBe("float:card:note:n2");
  });

  it("CONTROL — a session still alive at the answer applies", async () => {
    await startSession("float:card:note:n1");
    const commit = commitDropSession();
    gate.answer(true);
    await commit;
    expect(applyCalls).toEqual(["float:card:note:n1"]);
    expect(getDropSession()).toBeNull();
  });
});
