// @vitest-environment jsdom
/**
 * Task 772 — **a card drag's commit-on-release lives exactly as long as its
 * session.**
 *
 * `beginCardDropGesture` used to arm a bare `window` mouseup removed only by
 * firing. Three of the four ways a session ends never fire it — Escape, the
 * controller's missed-release failsafe, a provider teardown — so the stale
 * listener stayed armed, and (registered first, so run first) committed the
 * NEXT `externalCommit` session on its release, before that gesture's own
 * owner could decide. The one-shot now goes through the controller's
 * `armReleaseCommit`, which disarms on the session's end and commits only the
 * session it was armed for.
 *
 * Each leg: begin a card gesture, end it by a route its release never sees,
 * begin a SECOND externalCommit session (whose owner has not decided), fire
 * mouseup → the second session must still be live.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../hit-test", () => ({
  hitTest: () => null,
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  armReleaseCommit,
  beginDropSession,
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import { beginCardDropGesture } from "../card-drop-gesture";
import type { DropCtx } from "../types";

const CARD_KEY = "textobject:paragraph:SRC";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", attrs: { uuid: { default: null } } },
    text: {},
  },
});

function installCtx(): void {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", { uuid: "SRC" }, [schema.text("hello")]),
  ]);
  const editor = {
    state: EditorState.create({ schema, doc }),
    schema,
    view: { dispatch: () => {}, focus: () => {} },
  } as unknown as Editor;
  setDropCtx({
    mainEditor: editor,
    closePopout: () => {},
    confirm: async () => true,
  } as unknown as DropCtx);
}

/** The next gesture: an externalCommit session whose owner decides itself. */
function beginForeignSession(): boolean {
  return beginDropSession({
    cardKey: CARD_KEY,
    origin: { x: 50, y: 50 },
    inPlace: true,
    externalCommit: true,
  });
}

const release = () => window.dispatchEvent(new MouseEvent("mouseup"));

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
});

describe("the card drop gesture's release commit is session-scoped", () => {
  it("control: the release commits its OWN session", () => {
    installCtx();
    expect(beginCardDropGesture({ cardKey: CARD_KEY, origin: { x: 0, y: 0 } })).toBe(true);
    expect(getDropSession()).not.toBeNull();
    release();
    // No placement → commit cancels: the session ended through the release.
    expect(getDropSession()).toBeNull();
  });

  it("Escape: the stale release does not commit the next gesture", () => {
    installCtx();
    beginCardDropGesture({ cardKey: CARD_KEY, origin: { x: 0, y: 0 } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(getDropSession()).toBeNull();
    expect(beginForeignSession()).toBe(true);
    release();
    expect(getDropSession()).not.toBeNull();
  });

  it("missed-release failsafe: the stale release does not commit the next gesture", () => {
    installCtx();
    beginCardDropGesture({ cardKey: CARD_KEY, origin: { x: 0, y: 0 } });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5, buttons: 0 }));
    expect(getDropSession()).toBeNull();
    expect(beginForeignSession()).toBe(true);
    release();
    expect(getDropSession()).not.toBeNull();
  });

  it("teardown: the stale release does not commit the next gesture", () => {
    installCtx();
    beginCardDropGesture({ cardKey: CARD_KEY, origin: { x: 0, y: 0 } });
    cancelDropSession();
    expect(beginForeignSession()).toBe(true);
    release();
    expect(getDropSession()).not.toBeNull();
  });

  it("armReleaseCommit without a session arms nothing", () => {
    installCtx();
    const disarm = armReleaseCommit();
    expect(beginForeignSession()).toBe(true);
    release();
    expect(getDropSession()).not.toBeNull();
    disarm();
  });
});
