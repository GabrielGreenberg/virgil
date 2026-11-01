// @vitest-environment jsdom
/**
 * Task 1404 — **a margin-marker drag shows what it is carrying.**
 *
 * The re-anchor grab rides `beginCardDropGesture`, which had no subject: the
 * marker sat still, the card wore no halo, and the only feedback was the
 * crosshair. On the promote edge the gesture now (a) selects the marker's card
 * (`placement: "none"`), (b) lifts a clone of the marker into the shared drop
 * ghost, which the controller moves through the transform channel, and (c)
 * stamps the live marker as the session's source (CSS dims it). Every ending —
 * release, Escape, missed release, teardown — clears the ghost and restores the
 * marker, because the controller owns that lifetime.
 *
 * Real controller, real pending door, real MarkerButton, real DropGhost.
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
vi.mock("@/components/drop-mode/registry", () => ({
  lookupSpec: () => ({ allowedPlacements: ["paragraph-side"] }),
}));

import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { MarkerButton } from "@/components/Marginalia";
import { DropGhost } from "@/components/drop-mode/DropGhost";
import {
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "@/components/drop-mode/controller";
import { cancelPendingDropSession } from "@/components/drop-mode/pending-session";
import { __getGhostNode } from "@/components/drop-mode/drop-ghost";
import { defaultCardStore } from "@/links/_shared/anchored-card-store";
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
  defaultCardStore.clearSelection();
  cleanup();
  editorEl.remove();
});

function marker(onClick: (y: number) => void = () => {}): MarginaliaMarker {
  return {
    id: "n1:p1",
    textObjectId: "p1",
    type: "note",
    entityKind: "note",
    entityId: "n1",
    onClick,
  } as unknown as MarginaliaMarker;
}

const ghosts = () => document.querySelectorAll(".drop-ghost");
const selected = () => defaultCardStore.getState().selected;

function mount(opts: { dragEnabled?: boolean; onClick?: (y: number) => void } = {}) {
  render(
    <>
      <MarkerButton m={marker(opts.onClick)} dragEnabled={opts.dragEnabled ?? true} />
      <DropGhost />
    </>,
  );
  return screen.getByRole("button");
}

/** Press + travel past the threshold → the promote edge. */
function grabAndDrag(btn: HTMLElement): void {
  fireEvent.mouseDown(btn, { button: 0, clientX: 40, clientY: 50 });
  act(() => {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 60, clientY: 90, buttons: 1 }));
  });
}

function expectRestored(btn: HTMLElement): void {
  expect(getDropSession()).toBeNull();
  expect(ghosts()).toHaveLength(0);
  expect(btn.hasAttribute("data-drop-mode-source")).toBe(false);
}

describe("margin-marker drag subject (task 1404)", () => {
  it("promote selects the card, lifts a sanitized ghost, and dims the marker", () => {
    const btn = mount();
    grabAndDrag(btn);
    expect(getDropSession()).not.toBeNull();
    expect(selected()).toEqual({ kind: "note", id: "n1" });
    // The halo rides the store, exactly as a click's select would paint it.
    expect(btn.getAttribute("data-card-selected")).toBe("true");
    expect(btn.getAttribute("data-drop-mode-source")).toBe("true");
    expect(ghosts()).toHaveLength(1);
    const clone = ghosts()[0].firstElementChild as HTMLElement;
    expect(clone).not.toBeNull();
    // A clean copy: no marker identity, no source stamp, laid out in flow.
    expect(clone.hasAttribute("data-marginalia-marker")).toBe(false);
    expect(clone.hasAttribute("data-drop-mode-source")).toBe(false);
    expect(clone.style.position).toBe("static");
    expect(document.querySelectorAll("[data-marginalia-marker]")).toHaveLength(1);
  });

  it("the ghost follows the cursor through the transform channel (no render per move)", async () => {
    const btn = mount();
    grabAndDrag(btn);
    const node = __getGhostNode();
    expect(node).not.toBeNull();
    // Mounted at the promote cursor (x − grab offset; jsdom rects are 0).
    expect(node!.style.transform).toContain("translate3d(20px, 90px, 0)");
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 140, clientY: 200, buttons: 1 }));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(__getGhostNode()).toBe(node); // same node — no remount
    expect(node!.style.transform).toContain("translate3d(100px, 200px, 0)");
  });

  it("release ends the ghost and restores the marker (no landing → no-op)", async () => {
    const btn = mount();
    grabAndDrag(btn);
    await act(async () => {
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 60, clientY: 90 }));
    });
    expectRestored(btn);
    // The card stays selected after the drag — the subject was this card.
    expect(selected()).toEqual({ kind: "note", id: "n1" });
  });

  it("Escape ends the ghost and restores the marker", () => {
    const btn = mount();
    grabAndDrag(btn);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expectRestored(btn);
  });

  it("a missed release (move with no button held) ends the ghost", () => {
    const btn = mount();
    grabAndDrag(btn);
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 70, clientY: 95, buttons: 0 }));
    });
    expectRestored(btn);
  });

  it("a teardown (session cancelled from outside) ends the ghost", () => {
    const btn = mount();
    grabAndDrag(btn);
    act(() => cancelDropSession());
    expectRestored(btn);
  });

  it("a plain click lifts no ghost and selects through onClick, as before", () => {
    const onClick = vi.fn();
    const btn = mount({ onClick });
    fireEvent.mouseDown(btn, { button: 0, clientX: 40, clientY: 50 });
    expect(ghosts()).toHaveLength(0);
    fireEvent.mouseUp(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(ghosts()).toHaveLength(0);
    expect(btn.hasAttribute("data-drop-mode-source")).toBe(false);
    // The select is the click's (EditorPane's handler), not the gesture's.
    expect(selected()).toBeNull();
  });

  it("a read-only marker shows nothing new on a drag", () => {
    const btn = mount({ dragEnabled: false });
    grabAndDrag(btn);
    expect(getDropSession()).toBeNull();
    expect(ghosts()).toHaveLength(0);
    expect(selected()).toBeNull();
  });
});
