// @vitest-environment jsdom
//
// Fix 2 — `useMenuCombobox` `onArrowHorizontal` seam (unblocks BibPicker's
// ArrowLeft/Right = expand/collapse the active row's detail, design §4). Drives
// the REAL hook through a `MenuProvider` (layout="combobox", role="listbox") +
// the owned input, asserting:
//
//   - with `onArrowHorizontal` set: a PLAIN Left/Right CALLS it (with the right
//     dir) and does NOT move the roving cursor (the controller never sees it);
//   - Up/Down STILL move the cursor (untouched by the override);
//   - without `onArrowHorizontal`: Left/Right are forwarded to the controller
//     and are inert in a `list`/combobox layout (cursor unchanged), exactly as
//     before — backward-compatible (LabelRefPopover passes none).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { MenuProvider } from "../MenuProvider";
import { useMenuItem } from "../useMenuItem";
import { useMenuCombobox } from "../useMenuCombobox";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function Option({ id }: { id: string }) {
  const { getItemProps } = useMenuItem({ id, run: () => {} });
  return (
    <div {...getItemProps()} data-test-id={id}>
      {id}
    </div>
  );
}

/** A minimal combobox: an input wired via `useMenuCombobox`, three options. */
function Combobox({
  onArrowHorizontal,
}: {
  onArrowHorizontal?: (dir: "left" | "right") => void;
}) {
  const { getInputProps } = useMenuCombobox();
  return (
    <>
      <input
        placeholder="q"
        {...getInputProps({ open: true, onArrowHorizontal })}
      />
      <Option id="a" />
      <Option id="b" />
      <Option id="c" />
    </>
  );
}

function renderCombobox(onArrowHorizontal?: (dir: "left" | "right") => void) {
  render(
    <MenuProvider
      id="cb"
      layout="combobox"
      role="listbox"
      anchorRect={RECT}
      placements={PLACEMENTS}
      keyboardSource="input"
      onClose={() => {}}
      ariaLabel="cb"
    >
      <Combobox onArrowHorizontal={onArrowHorizontal} />
    </MenuProvider>,
  );
  return screen.getByPlaceholderText("q") as HTMLInputElement;
}

function activeId(): string | null {
  const el = document.querySelector('[data-active=""]') as HTMLElement | null;
  return el?.getAttribute("data-test-id") ?? null;
}

describe("useMenuCombobox — onArrowHorizontal", () => {
  it("with onArrowHorizontal set, a plain Left/Right calls it and does NOT move the cursor", () => {
    const onArrowHorizontal = vi.fn();
    const input = renderCombobox(onArrowHorizontal);

    // Seed a cursor first (Down → first option), so we can prove Left/Right
    // leave it untouched rather than there simply being no cursor.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId()).toBe("a");

    const ev = fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(onArrowHorizontal).toHaveBeenCalledTimes(1);
    expect(onArrowHorizontal).toHaveBeenLastCalledWith("right");
    expect(ev).toBe(false); // preventDefault was called (caret won't move)
    expect(activeId()).toBe("a"); // cursor unchanged

    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(onArrowHorizontal).toHaveBeenCalledTimes(2);
    expect(onArrowHorizontal).toHaveBeenLastCalledWith("left");
    expect(activeId()).toBe("a"); // still unchanged
  });

  it("with onArrowHorizontal set, Up/Down STILL move the roving cursor", () => {
    const onArrowHorizontal = vi.fn();
    const input = renderCombobox(onArrowHorizontal);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId()).toBe("a");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId()).toBe("b");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeId()).toBe("a");
    // The vertical keys never reached the horizontal override.
    expect(onArrowHorizontal).not.toHaveBeenCalled();
  });

  it("a MODIFIED Left/Right does not call the override (plain keys only)", () => {
    const onArrowHorizontal = vi.fn();
    const input = renderCombobox(onArrowHorizontal);
    fireEvent.keyDown(input, { key: "ArrowRight", shiftKey: true });
    expect(onArrowHorizontal).not.toHaveBeenCalled();
  });

  it("WITHOUT onArrowHorizontal, Left/Right are inert in the list (cursor unchanged) — backward-compatible", () => {
    const input = renderCombobox(undefined);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId()).toBe("a");
    // Left/Right forwarded to the controller, which makes them no-ops in a list.
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(activeId()).toBe("a");
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(activeId()).toBe("a");
    // And Up/Down still move (proving the input is wired to the controller).
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId()).toBe("b");
  });
});
