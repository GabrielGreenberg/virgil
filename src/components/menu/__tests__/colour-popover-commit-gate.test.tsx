// @vitest-environment jsdom
//
// TASK 1168 — the lightning colour popover's commit crosses the registry door.
//
// `textColorRun` gates the popover's OPEN; the swatch PICK is the write, and it
// used to be a panel-side `chain().setTextColor().run()` with no gate, followed
// unconditionally by the MRU bump + close. So a pen hand-off while the popover
// was open gave a silent false success: `readOnlyEnforcer` dropped the mark on
// MAIN, but the palette reordered (persisted, cross-window) and the popover
// closed as if it had applied. Both halves pinned here, through the REAL panel +
// popover (the harness shape of `actions-menu-panel-color-popover-stack`):
//
//   - the COMMIT half: flip the surface read-only WITHOUT a re-render (the pick
//     outruns React) → no write, no palette change, popover closed;
//   - the AFFORDANCE half: a re-render that greys the colour cell closes an
//     already-open popover.
//
// Each refusal is paired with a POSITIVE CONTROL on the identical fixture.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

vi.mock("../../MenuBar", () => ({
  BlockTypeDropdown: () => <button data-hint="Block type">¶</button>,
}));
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { ActionsMenuPanel } from "../../ActionsMenuPanel";
import { DragHandleMenuProvider } from "../../editor-layout/card-actions/drag-handle-menu-context";

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };
const PALETTE_KEY = "virgil:selection-menu-color-palette";
const PALETTE = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777"];

/** A stub editor whose `view.editable` is MUTABLE — the live pen the commit
 *  door re-reads (`surfaceEditableNow`), flippable without a React re-render. */
function makeEditor(setTextColor: (color: string) => void) {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const ret = () => c;
    for (const m of ["focus", "unsetTextColor", "setTextSelection", "toggleBold", "toggleItalic"]) {
      c[m] = ret;
    }
    c.setTextColor = (color: string) => {
      setTextColor(color);
      return c;
    };
    c.run = () => true;
    return c;
  };
  const $pos = {
    parent: { type: { name: "paragraph" } },
    blockRange: () => ({
      parent: { child: () => ({ type: { name: "paragraph" } }) },
      startIndex: 0,
      endIndex: 1,
    }),
  };
  const state = {
    selection: { from: 3, to: 9, $from: $pos, $to: $pos },
    doc: { textBetween: () => "" },
  };
  const view = {
    state,
    editable: true,
    coordsAtPos: () => ({ left: 0, top: 0, bottom: 10, right: 0 }),
  };
  return {
    get isEditable() {
      return view.editable;
    },
    isActive: () => false,
    // The colour stash is a tracked range (task 1314) — it subscribes to
    // transactions while the popover is open.
    on: () => {},
    off: () => {},
    chain,
    state,
    view,
    storage: {},
  };
}

type StubEditor = ReturnType<typeof makeEditor>;

function panel(editor: StubEditor) {
  const api = { open: vi.fn(), dispatch: vi.fn() } as unknown as Parameters<
    typeof DragHandleMenuProvider
  >[0]["value"];
  return (
    <DragHandleMenuProvider value={api}>
      <ActionsMenuPanel
        editor={editor as unknown as Parameters<typeof ActionsMenuPanel>[0]["editor"]}
        paragraphUuid="p7"
        nodeKind="paragraph"
        range={{ from: 3, to: 9 }}
        mode="selection"
        triggerRect={RECT}
        onClose={() => {}}
      />
    </DragHandleMenuProvider>
  );
}

const menuEl = () =>
  document.querySelector('[aria-label="Selection actions"]') as HTMLElement | null;
const popoverEl = () =>
  document.querySelector('div[role="dialog"][aria-label="Text color"]') as HTMLElement | null;

function openColorPopover() {
  const cell = menuEl()!.querySelector('button[data-hint="Text color"]') as HTMLButtonElement;
  cell.getBoundingClientRect = () => new DOMRect(10, 10, 30, 34);
  act(() => {
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pickSwatch(color: string) {
  const swatch = popoverEl()!.querySelector(`button[data-hint="${color}"]`) as HTMLButtonElement;
  expect(swatch, `swatch ${color} rendered`).toBeTruthy();
  act(() => {
    swatch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const storedPalette = () => JSON.parse(window.localStorage.getItem(PALETTE_KEY) ?? "null");

beforeEach(() => {
  window.localStorage.setItem(PALETTE_KEY, JSON.stringify(PALETTE));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.removeItem(PALETTE_KEY);
  document.body.innerHTML = "";
});

describe("task 1168 — the colour popover's commit is gated at commit time", () => {
  it("POSITIVE CONTROL: editable → the mark is applied and the MRU bumps", () => {
    const setTextColor = vi.fn<(c: string) => void>();
    render(panel(makeEditor(setTextColor)));
    openColorPopover();
    expect(popoverEl()).toBeTruthy();

    pickSwatch("#333333");

    expect(setTextColor).toHaveBeenCalledWith("#333333");
    expect(storedPalette()[0], "the picked colour moved to the front").toBe("#333333");
    expect(popoverEl()).toBeNull();
  });

  it("the pen flips BETWEEN open and pick → no write, no palette reorder, popover closed", () => {
    const setTextColor = vi.fn<(c: string) => void>();
    const editor = makeEditor(setTextColor);
    render(panel(editor));
    openColorPopover();
    expect(popoverEl()).toBeTruthy();

    editor.view.editable = false; // the partner takes the pen; no React re-render yet

    pickSwatch("#333333");

    expect(setTextColor, "no colour write from a read-only surface").not.toHaveBeenCalled();
    expect(storedPalette(), "the MRU palette is untouched").toEqual(PALETTE);
    expect(popoverEl(), "the popover closes — it has nothing left to offer").toBeNull();
  });

  it("an open popover closes when a re-render greys the colour cell", () => {
    const editor = makeEditor(vi.fn());
    const { rerender } = render(panel(editor));
    openColorPopover();
    expect(popoverEl()).toBeTruthy();

    editor.view.editable = false;
    rerender(panel(editor));

    expect(popoverEl()).toBeNull();
  });

  it("POSITIVE CONTROL: a re-render that keeps the cell lit leaves the popover open", () => {
    const editor = makeEditor(vi.fn());
    const { rerender } = render(panel(editor));
    openColorPopover();
    rerender(panel(editor));
    expect(popoverEl()).toBeTruthy();
  });
});
