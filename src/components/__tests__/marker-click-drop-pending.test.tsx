// @vitest-environment jsdom
/**
 * Task 1192 — **a plain click on a margin marker selects its card.**
 *
 * The marker began its re-anchor drop session on the PRESS. A live session
 * sets `body[data-drop-mode-active]`, and the task-351 rule makes every
 * `.marginalia-marker` `pointer-events:none` under it — so the mouseup of a
 * no-move click hit-tested to the editor beneath, the browser dispatched
 * `click` to the common ancestor, and the marker's `onClick` (select →
 * `placeSelectedCard`) never ran. Reproduced live in the dev preview.
 *
 * jsdom has no hit-testing, so `releaseLikeABrowser` applies the CSS
 * consequence by hand: while the attribute is set the marker is not the
 * release target (mouseup lands on the editor, click on the common ancestor);
 * otherwise mouseup + click land on the marker. Real controller, real pending
 * door, real MarkerButton — red on the pre-fix press-started session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/drop-mode/hit-test", () => ({
  hitTest: () => null,
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));
// Any key resolves to a minimal side-only spec, so a session CAN start —
// the defect needs one.
vi.mock("@/components/drop-mode/registry", () => ({
  lookupSpec: () => ({ allowedPlacements: ["paragraph-side"] }),
}));
const beginContentGesture = vi.fn();
vi.mock("@/lib/pane-resize/layout-gesture-bus", async (orig) => ({
  ...(await orig<typeof import("@/lib/pane-resize/layout-gesture-bus")>()),
  beginContentGesture: (...a: unknown[]) => beginContentGesture(...a),
}));

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { MarkerButton } from "@/components/Marginalia";
import {
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "@/components/drop-mode/controller";
import {
  cancelPendingDropSession,
  hasPendingDropSession,
} from "@/components/drop-mode/pending-session";
import type { DropCtx } from "@/components/drop-mode/types";
import type { MarginaliaMarker } from "@/lib/marginalia";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", attrs: { uuid: { default: null } } },
    text: {},
  },
});

let editorEl: HTMLElement;

beforeEach(() => {
  beginContentGesture.mockClear();
  editorEl = document.createElement("div");
  editorEl.className = "ProseMirror";
  document.body.appendChild(editorEl);
  const doc = schema.node("doc", null, [
    schema.node("paragraph", { uuid: "p1" }, [schema.text("hello")]),
  ]);
  setDropCtx({
    mainEditor: {
      state: EditorState.create({ schema, doc }),
      schema,
      view: { dispatch: () => {}, focus: () => {}, dom: editorEl },
    } as unknown as Editor,
    closePopout: () => {},
    confirm: async () => true,
  } as unknown as DropCtx);
});

afterEach(() => {
  cancelPendingDropSession();
  cancelDropSession();
  setDropCtx(null);
  cleanup();
  editorEl.remove();
});

function marker(onClick: (y: number) => void): MarginaliaMarker {
  return {
    id: "n1:p1",
    textObjectId: "p1",
    type: "note",
    entityKind: "note",
    entityId: "n1",
    onClick,
  } as unknown as MarginaliaMarker;
}

/** The release as the browser delivers it, given the click-through CSS. */
function releaseLikeABrowser(btn: HTMLElement): void {
  if (document.body.dataset.dropModeActive) {
    fireEvent.mouseUp(editorEl);
    fireEvent.click(document.body); // the common ancestor
  } else {
    fireEvent.mouseUp(btn);
    fireEvent.click(btn);
  }
}

describe("margin marker: a press is not a drag (task 1192)", () => {
  it("a plain click (no movement) reaches the marker and selects its card", () => {
    const onClick = vi.fn();
    render(<MarkerButton m={marker(onClick)} dragEnabled />);
    const btn = screen.getByRole("button");
    fireEvent.mouseDown(btn, { button: 0, clientX: 40, clientY: 50 });
    // No drop-mode side effect on the press.
    expect(document.body.dataset.dropModeActive).toBeUndefined();
    expect(document.body.style.cursor).toBe("");
    expect(getDropSession()).toBeNull();
    expect(beginContentGesture).not.toHaveBeenCalled();
    expect(hasPendingDropSession()).toBe(true);
    releaseLikeABrowser(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    // The release discarded the pending press; nothing began, nothing leaks.
    expect(hasPendingDropSession()).toBe(false);
    expect(getDropSession()).toBeNull();
    expect(beginContentGesture).not.toHaveBeenCalled();
  });

  it("sub-threshold jitter is still a click", () => {
    const onClick = vi.fn();
    render(<MarkerButton m={marker(onClick)} dragEnabled />);
    const btn = screen.getByRole("button");
    fireEvent.mouseDown(btn, { button: 0, clientX: 40, clientY: 50 });
    fireEvent(window, new MouseEvent("mousemove", { clientX: 42, clientY: 52, buttons: 1 }));
    expect(getDropSession()).toBeNull();
    releaseLikeABrowser(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a drag past the threshold begins the session, and its trailing click is swallowed", () => {
    const onClick = vi.fn();
    render(<MarkerButton m={marker(onClick)} dragEnabled />);
    const btn = screen.getByRole("button");
    fireEvent.mouseDown(btn, { button: 0, clientX: 40, clientY: 50 });
    fireEvent(window, new MouseEvent("mousemove", { clientX: 40, clientY: 70, buttons: 1 }));
    expect(getDropSession()?.cardKey).toBe("float:card:note:n1");
    expect(document.body.dataset.dropModeActive).toBe("true");
    expect(beginContentGesture).toHaveBeenCalledTimes(1);
    // Released back over the marker (it is click-through mid-drag, but a
    // release that lands on it anyway must not also select).
    fireEvent.mouseUp(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(getDropSession()).toBeNull();
  });

  it("Escape while pending discards the press: a later move cannot start a drag", () => {
    render(<MarkerButton m={marker(vi.fn())} dragEnabled />);
    fireEvent.mouseDown(screen.getByRole("button"), { button: 0, clientX: 40, clientY: 50 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    fireEvent(window, new MouseEvent("mousemove", { clientX: 40, clientY: 90, buttons: 1 }));
    expect(getDropSession()).toBeNull();
    expect(hasPendingDropSession()).toBe(false);
  });

  it("a missed release while pending discards the press", () => {
    render(<MarkerButton m={marker(vi.fn())} dragEnabled />);
    fireEvent.mouseDown(screen.getByRole("button"), { button: 0, clientX: 40, clientY: 50 });
    fireEvent(window, new MouseEvent("mousemove", { clientX: 40, clientY: 90, buttons: 0 }));
    expect(hasPendingDropSession()).toBe(false);
    fireEvent(window, new MouseEvent("mousemove", { clientX: 40, clientY: 95, buttons: 1 }));
    expect(getDropSession()).toBeNull();
  });
});
