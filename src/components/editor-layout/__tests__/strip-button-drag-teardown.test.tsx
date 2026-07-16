// @vitest-environment jsdom
//
// StripButton drag-interruption teardown (task 2026-07-15-141, member B).
//
// The panel-rail icon drag appends a fixed z-9999 `#virgil-drag-ghost` (and a
// `#virgil-drop-indicator`) to `document.body` mid-drag. Every terminating
// pointer event must run the SAME single teardown (`cleanupDragArtifacts`) so
// those body-appended nodes can't be orphaned on screen:
//   - `pointerup` (the normal end) — already covered by existing behavior.
//   - `pointercancel` — the browser co-opts the gesture as a scroll/pinch
//     (routine on touch/pen). Per the Pointer Events spec this SUPPRESSES the
//     trailing `pointerup`, so without a cancel handler the ghost is stranded.
//   - unmount mid-drag — no pointerup fires either; the unmount effect reclaims.
//
// This pins the two branches the prior code missed. jsdom's pointer-capture is
// a stub (installed below), so the touch/pen path still owes a real-device
// preview eyeball — but the teardown wiring itself is faithfully exercised here.
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";

// StripButton lives in the same module as `useStripHandlers`, which imports the
// heavy `panel-column` chain (pane-resize / useViewPrefs / storage). StripButton
// itself never touches it, so stub it out to keep this a focused unit test.
vi.mock("../panel-column", () => ({ measureOmniGap: () => 0 }));

import { render, fireEvent, cleanup } from "@testing-library/react";
import { StripButton } from "../drag-drop";

// jsdom ships pointer-capture methods as no-throwing stubs in some versions and
// omits them in others; force them present so the drag-start capture can't throw
// and short-circuit ghost creation.
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  cleanup();
  // Belt-and-suspenders: a failing assertion shouldn't leak a ghost into the
  // next test's document.body.
  document.getElementById("virgil-drag-ghost")?.remove();
  document.getElementById("virgil-drop-indicator")?.remove();
});

function renderButton() {
  const onClick = vi.fn();
  const onMove = vi.fn();
  const stripRef = { current: null };
  const utils = render(
    <StripButton
      panelId="notes"
      active={false}
      onClick={onClick}
      onMove={onMove}
      side="left"
      stripRef={stripRef}
    />,
  );
  const btn = utils.getByRole("button");
  return { ...utils, btn, onClick, onMove };
}

// Drive a real drag past the 5px threshold so the ghost is appended to body.
function startDrag(btn: HTMLElement) {
  fireEvent.pointerDown(btn, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(btn, { clientX: 20, clientY: 20, pointerId: 1 });
}

describe("StripButton drag-interruption teardown", () => {
  it("appends the drag ghost once the drag passes threshold", () => {
    const { btn } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();
  });

  it("a pointercancel reclaims the ghost (no orphan on document.body)", () => {
    const { btn, onMove } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();

    fireEvent.pointerCancel(btn, { pointerId: 1 });

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
    expect(document.getElementById("virgil-drop-indicator")).toBeNull();
    // A cancelled drag must NOT commit a move.
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a lostpointercapture reclaims the ghost", () => {
    const { btn } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();

    fireEvent.lostPointerCapture(btn, { pointerId: 1 });

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
  });

  it("unmount mid-drag reclaims the ghost", () => {
    const { btn, unmount } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();

    unmount();

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
  });

  it("a normal pointerup still tears down and commits the move", () => {
    const { btn, onMove } = renderButton();
    startDrag(btn);
    fireEvent.pointerUp(btn, { clientX: 20, clientY: 20, pointerId: 1 });

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
