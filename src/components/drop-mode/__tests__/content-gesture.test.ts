// @vitest-environment jsdom
/**
 * Perf Wave 2 — a drop session IS a content layout gesture.
 *
 * The controller (the single chokepoint every pointer-driven content drag
 * routes through) publishes `kind:"content"` edges on the LayoutGestureBus so
 * every parked geometry follower holds for the drag's duration and settles
 * once. Pins:
 *
 *   - begin edge on `beginDropSession` success (and ONLY on success — a
 *     rejected begin must not publish an edge nothing will ever end);
 *   - end edge at `commitDropSession` ENTRY (the pointer gesture is over the
 *     moment commit is entered — a confirm dialog must not hold every park
 *     hostage) and again, idempotently, in `endDropSession`;
 *   - cancel funnels end it too (Escape / setDropCtx(null) teardown);
 *   - the missed-release failsafe: a mousemove with the primary button up
 *     cancels the session, so a swallowed mouseup can never wedge the parked
 *     followers app-wide.
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
  isUnmintedParagraphId: (id: string) => id.startsWith("unminted@"),
  mintPlacementUuid: (_editor: unknown, id: string) => id,
}));

import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import { buildFloatKey } from "@/floats/float-key";
import type { DropCtx, ParagraphAnchorApi, Placement } from "../types";
import {
  hasActiveLayoutGesture,
  __resetLayoutGestureBusForTest,
} from "@/lib/pane-resize/layout-gesture-bus";

const fakeEditor = { state: {}, view: { dispatch() {} } } as unknown as Editor;
const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "n1" });

const contentActive = () => hasActiveLayoutGesture(["content"]);

function makeApi(initial: string[]): ParagraphAnchorApi {
  const set = new Set(initial);
  return {
    exists: () => true,
    getAnchorTextObjectIds: () => [...set],
    addTextObjectLink: (_id, pid) => void set.add(pid),
    removeTextObjectLink: (_id, pid) => void set.delete(pid),
    preserveModeBAnchor: () => null,
  };
}

function paragraphSide(pid: string): Placement {
  return {
    kind: "paragraph-side",
    editor: fakeEditor,
    paragraphId: pid,
    side: "left",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  } as unknown as Placement;
}

/** `confirm` resolves only when the test releases it — so we can observe the
 *  gesture state WHILE the dialog is open. */
function setup(initialAnchors: string[]) {
  let releaseConfirm: (ok: boolean) => void = () => {};
  const confirm = () =>
    new Promise<boolean>((resolve) => {
      releaseConfirm = resolve;
    });
  const ctx: DropCtx = {
    mainEditor: null,
    closePopout: () => {},
    requestAnchorFlush: () => {},
    confirm,
    notes: makeApi(initialAnchors),
  } as unknown as DropCtx;
  setDropCtx(ctx);
  return { releaseConfirm: (ok: boolean) => releaseConfirm(ok) };
}

async function moveTo(pid: string): Promise<void> {
  mockPlacement = paragraphSide(pid);
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 20, clientY: 20, buttons: 1 }),
  );
  await new Promise((r) => setTimeout(r, 30)); // past the 16ms throttle
}

beforeEach(() => {
  __resetLayoutGestureBusForTest();
  mockPlacement = null;
});

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
  vi.restoreAllMocks();
});

describe("content-gesture publishing", () => {
  it("beginDropSession success publishes the begin edge; endDropSession ends it", () => {
    setup([]);
    expect(contentActive()).toBe(false);
    expect(
      beginDropSession({ cardKey: CARD_KEY, origin: { x: 1, y: 1 }, externalCommit: true }),
    ).toBe(true);
    expect(contentActive()).toBe(true);
    cancelDropSession();
    expect(contentActive()).toBe(false);
  });

  it("a REJECTED begin publishes nothing (no orphan edge to wedge the parks)", () => {
    // No DropCtx registered → begin returns false.
    setDropCtx(null);
    expect(
      beginDropSession({ cardKey: CARD_KEY, origin: { x: 1, y: 1 } }),
    ).toBe(false);
    expect(contentActive()).toBe(false);
  });

  it("the gesture ends at COMMIT ENTRY — a confirm dialog does not hold the parks hostage", async () => {
    const { releaseConfirm } = setup(["P_old"]); // different target → classifyDrop 'confirm'
    beginDropSession({ cardKey: CARD_KEY, origin: { x: 1, y: 1 }, externalCommit: true });
    await moveTo("P_new");
    expect(contentActive()).toBe(true);

    const commit = commitDropSession();
    // The dialog is now OPEN (confirm unresolved) — the pointer gesture is
    // over, so the bus gesture must already be ended.
    expect(contentActive()).toBe(false);
    releaseConfirm(true);
    await commit;
    expect(contentActive()).toBe(false);
    expect(getDropSession()).toBeNull();
  });

  it("missed release (primary button up mid-move) cancels the session AND the gesture", async () => {
    setup([]);
    beginDropSession({ cardKey: CARD_KEY, origin: { x: 1, y: 1 }, externalCommit: true });
    expect(contentActive()).toBe(true);
    // A move with buttons: 0 — the release happened where we never saw it.
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 30, clientY: 30, buttons: 0 }),
    );
    expect(getDropSession()).toBeNull();
    expect(contentActive()).toBe(false);
  });

  it("setDropCtx(null) mid-session (editor unmount mid-drag) ends the gesture", () => {
    setup([]);
    beginDropSession({ cardKey: CARD_KEY, origin: { x: 1, y: 1 }, externalCommit: true });
    expect(contentActive()).toBe(true);
    setDropCtx(null);
    expect(contentActive()).toBe(false);
  });
});
