// @vitest-environment jsdom
//
/**
 * Task 1064 — **only the dialog that owns the input may be dismissed by it**,
 * for the POINTER as task 389's stack already rules for the keyboard.
 *
 * A scrimless window (`variant="draggable"`: Preferences, Bug Report) closes on
 * an outside mousedown. Pre-1064 "outside" meant outside ITS OWN frame, so a
 * press on a modal raised above it — a confirm's Cancel, the modal's scrim —
 * answered the modal AND closed the window beneath. The handler now asks the
 * stack (`pointerOwnedElsewhere`) before it dismisses.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import SystemDialog from "../system-dialog";
import {
  __resetDialogStack,
  pointerOwnedElsewhere,
  popDialog,
  pushDialog,
} from "../dialog-stack";

afterEach(() => {
  cleanup();
  __resetDialogStack();
});

async function armOutsideClick() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

function Scene({
  modalOpen,
  onWindowClose,
  onModalClose,
}: {
  modalOpen: boolean;
  onWindowClose: () => void;
  onModalClose: () => void;
}) {
  return (
    <div>
      <button data-testid="outside">out</button>
      <SystemDialog open variant="draggable" onClose={onWindowClose}>
        <div data-testid="window">prefs</div>
      </SystemDialog>
      <SystemDialog open={modalOpen} onClose={onModalClose}>
        <button data-testid="modal-cancel">Cancel</button>
      </SystemDialog>
    </div>
  );
}

describe("scrimless outside-mousedown consults the dialog stack (task 1064)", () => {
  it("a press on a modal raised above the window does not close the window", async () => {
    const onWindowClose = vi.fn();
    const onModalClose = vi.fn();
    const { rerender } = render(
      <Scene modalOpen onWindowClose={onWindowClose} onModalClose={onModalClose} />,
    );
    await armOutsideClick();

    // The modal's own button.
    fireEvent.mouseDown(screen.getByTestId("modal-cancel"));
    expect(onWindowClose).not.toHaveBeenCalled();

    // The modal's scrim (the aria-modal element wraps the frame).
    const scrim = document.querySelector('[aria-modal="true"]')!;
    fireEvent.mouseDown(scrim);
    expect(onWindowClose).not.toHaveBeenCalled();

    // Even bare document: a modal above owns the pointer outright.
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onWindowClose).not.toHaveBeenCalled();

    // Once the modal is gone, the window's outside-close is live again.
    rerender(
      <Scene
        modalOpen={false}
        onWindowClose={onWindowClose}
        onModalClose={onModalClose}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onWindowClose).toHaveBeenCalledTimes(1);
  });

  it("two coexisting scrimless windows do not close each other", async () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    render(
      <div>
        <button data-testid="outside">out</button>
        <SystemDialog open variant="draggable" onClose={closeA}>
          <div data-testid="a">A</div>
        </SystemDialog>
        <SystemDialog open variant="draggable" onClose={closeB}>
          <div data-testid="b">B</div>
        </SystemDialog>
      </div>,
    );
    await armOutsideClick();
    fireEvent.mouseDown(screen.getByTestId("b"));
    fireEvent.mouseDown(screen.getByTestId("a"));
    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
  });
});

describe("pointerOwnedElsewhere (pure)", () => {
  it("a modal ABOVE owns the pointer; a modal BELOW does not", () => {
    const frame = () => null;
    const below = pushDialog(true, frame);
    const win = pushDialog(false, frame);
    expect(pointerOwnedElsewhere(win, null)).toBe(false);
    const above = pushDialog(true, frame);
    expect(pointerOwnedElsewhere(win, null)).toBe(true);
    popDialog(above);
    expect(pointerOwnedElsewhere(win, null)).toBe(false);
    popDialog(below);
    popDialog(win);
    // A popped token owns nothing and is never "elsewhere".
    expect(pointerOwnedElsewhere(win, null)).toBe(false);
  });

  it("a press inside another entry's frame belongs to it", () => {
    const other = document.createElement("div");
    const inner = document.createElement("span");
    other.appendChild(inner);
    const mine = document.createElement("div");
    const win = pushDialog(false, () => mine);
    pushDialog(false, () => other);
    expect(pointerOwnedElsewhere(win, inner)).toBe(true);
    expect(pointerOwnedElsewhere(win, document.body)).toBe(false);
  });
});
