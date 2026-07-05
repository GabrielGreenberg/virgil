// @vitest-environment jsdom
//
// Pins task 033 surfaces #1/#3: the SystemDialog positioning variants. One shell
// (portal, SYSTEM_DIALOG_TOKENS chrome, Esc, focus, outside-click) with three
// principled placements — "modal" (scrim, centered), "draggable" (scrimless tool
// window on DRAGGABLE_DIALOG_Z, header drags via useSystemDialogDrag), and
// "anchored" (scrimless popover pinned + clamped at a point, MODAL_SCRIM_Z).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// SystemDialog's transitive import chain pulls the storage facade, whose runtime
// require("@/lib/storage-fsa") can't resolve under vitest (see memory
// vitest_extension_barrel_storage_mock). None of it is exercised at render — a
// stub namespace keeps the module graph loadable.
vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import SystemDialog, { useSystemDialogDrag } from "../system-dialog";
import { MODAL_SCRIM_Z, DRAGGABLE_DIALOG_Z } from "@/floats/float-policy";

afterEach(cleanup);

// The scrimless outside-click listener is rAF-armed (so the opening mousedown
// doesn't self-close). Flush one animation frame inside act() to arm it.
async function armOutsideClick() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

function DragProbe() {
  const { onMouseDown, dragging } = useSystemDialogDrag();
  return (
    <div
      data-testid="handle"
      data-hasdrag={onMouseDown ? "yes" : "no"}
      data-dragging={dragging ? "yes" : "no"}
      onMouseDown={onMouseDown}
    />
  );
}

describe("SystemDialog — modal variant (default)", () => {
  it("renders a scrim with aria-modal at MODAL_SCRIM_Z and closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <SystemDialog open onClose={onClose}>
        <div data-testid="content">hi</div>
      </SystemDialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.style.zIndex).toBe(String(MODAL_SCRIM_Z));

    // Clicking the scrim itself closes; clicking inside content does not.
    fireEvent.click(screen.getByTestId("content"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <SystemDialog open onClose={onClose}>
        <div>hi</div>
      </SystemDialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exposes no drag handle to useSystemDialogDrag", () => {
    render(
      <SystemDialog open onClose={() => {}}>
        <DragProbe />
      </SystemDialog>,
    );
    expect(screen.getByTestId("handle").getAttribute("data-hasdrag")).toBe("no");
  });
});

describe("SystemDialog — draggable variant", () => {
  it("is scrimless (no aria-modal), rides DRAGGABLE_DIALOG_Z, and exposes a drag handle", () => {
    render(
      <SystemDialog open variant="draggable" onClose={() => {}}>
        <DragProbe />
      </SystemDialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.style.zIndex).toBe(String(DRAGGABLE_DIALOG_Z));
    expect(dialog.style.position).toBe("fixed");
    expect(screen.getByTestId("handle").getAttribute("data-hasdrag")).toBe("yes");
  });

  it("closes on an outside mousedown but not on an inside one", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button data-testid="outside">out</button>
        <SystemDialog open variant="draggable" onClose={onClose}>
          <div data-testid="content">hi</div>
        </SystemDialog>
      </div>,
    );
    await armOutsideClick();
    fireEvent.mouseDown(screen.getByTestId("content"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("honors ignoreOutsideSelector (the trigger-button guard)", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button data-testid="trigger" data-hint="Preferences">
          open
        </button>
        <SystemDialog
          open
          variant="draggable"
          onClose={onClose}
          ignoreOutsideSelector='[data-hint="Preferences"]'
        >
          <div>hi</div>
        </SystemDialog>
      </div>,
    );
    await armOutsideClick();
    fireEvent.mouseDown(screen.getByTestId("trigger"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SystemDialog — anchored variant", () => {
  it("is scrimless, rides MODAL_SCRIM_Z, and positions near the `at` point", () => {
    render(
      <SystemDialog open variant="anchored" at={{ x: 200, y: 150 }} onClose={() => {}}>
        <div data-testid="content">hi</div>
      </SystemDialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.style.zIndex).toBe(String(MODAL_SCRIM_Z));
    // The positioning effect has run (act flushed it) → left/top set, visible.
    expect(dialog.style.left).toBe("200px");
    expect(dialog.style.top).toBe("150px");
    expect(dialog.style.visibility).not.toBe("hidden");
  });

  it("suppresses outside-click-close when outsideClickGuard returns true", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button data-testid="outside">out</button>
        <SystemDialog
          open
          variant="anchored"
          at={{ x: 10, y: 10 }}
          onClose={onClose}
          outsideClickGuard={(e) => e.ctrlKey}
        >
          <div>hi</div>
        </SystemDialog>
      </div>,
    );
    await armOutsideClick();
    // Guarded (ctrl held) → no close; plain click → close.
    fireEvent.mouseDown(screen.getByTestId("outside"), { ctrlKey: true });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
