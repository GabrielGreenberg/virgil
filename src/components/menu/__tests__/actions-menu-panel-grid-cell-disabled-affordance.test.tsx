// @vitest-environment jsdom
//
// Task 294 — the lightning grid's two <button>-based cells (FmtBtn +
// ColorGridCell) must paint the SAME disabled affordance when the collab pen is
// held by a partner (canEdit === false → each cell's `disabled` is true).
//
// Pre-294 the color cell's disabled cursor was a `disabled ? "pointer" :
// "pointer"` tautology, so it showed a `pointer` cursor while every FmtBtn cell
// (bold/italic/…) correctly showed `not-allowed`. The fix routes both cell kinds
// through the shared `gridCellShellStyle` helper, so this test pins that the
// disabled cursor + opacity now MATCH across the two primitives. It goes RED on
// the old tautology (color cell cursor === "pointer") and GREEN once both share
// the shell.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// The nested block-type trigger + block inserters need a live editor; mock them
// (orthogonal to the disabled-affordance axis under test).
vi.mock("../../MenuBar", () => ({
  BlockTypeDropdown: () => <button data-hint="Block type">¶</button>,
}));
vi.mock("@/lib/tiptap/tex-block", () => ({ insertTexBlock: vi.fn() }));

import { ActionsMenuPanel } from "../../ActionsMenuPanel";
import { DragHandleMenuProvider } from "../../editor-layout/card-actions/drag-handle-menu-context";

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

/** Minimal editor stub the panel + the registry `applies()`/`run()` read.
 *  `editable=false` → `canEdit` is false → every grid cell renders disabled. */
function makeEditor(editable: boolean) {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const ret = () => c;
    for (const m of [
      "focus", "unsetTextColor", "setTextColor", "setTextSelection",
      "toggleBold", "toggleItalic", "run",
    ]) {
      c[m] = ret;
    }
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
    coordsAtPos: () => ({ left: 0, top: 0, bottom: 10, right: 0 }),
  };
  return {
    isEditable: editable,
    isActive: () => false,
    chain,
    state,
    view,
  } as unknown as Parameters<typeof ActionsMenuPanel>[0]["editor"];
}

function renderPanel(editable: boolean) {
  const api = { open: vi.fn(), dispatch: vi.fn() } as unknown as Parameters<
    typeof DragHandleMenuProvider
  >[0]["value"];
  return render(
    <DragHandleMenuProvider value={api}>
      <ActionsMenuPanel
        editor={makeEditor(editable)}
        paragraphUuid="p7"
        nodeKind="paragraph"
        range={{ from: 3, to: 9 }}
        mode="selection"
        triggerRect={RECT}
        onClose={() => {}}
      />
    </DragHandleMenuProvider>,
  );
}

const menuEl = () =>
  document.querySelector('[aria-label="Selection actions"]') as HTMLElement | null;
const cell = (hint: string) =>
  menuEl()!.querySelector(`button[data-hint="${hint}"]`) as HTMLButtonElement | null;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("Task 294 — grid cells share one disabled affordance", () => {
  it("both the color cell and a FmtBtn cell paint not-allowed + 0.4 opacity when disabled", () => {
    renderPanel(/* editable */ false);

    const color = cell("Text color");
    const bold = cell("Bold (⌘B)");
    expect(color).toBeTruthy();
    expect(bold).toBeTruthy();

    // The native disabled attribute is set on both button cells.
    expect(color!.disabled).toBe(true);
    expect(bold!.disabled).toBe(true);

    // The color cell no longer shows the tautological `pointer` — it matches
    // FmtBtn's `not-allowed`, and both carry the greyed 0.4 opacity.
    expect(color!.style.cursor).toBe("not-allowed");
    expect(bold!.style.cursor).toBe("not-allowed");
    expect(color!.style.cursor).toBe(bold!.style.cursor);
    expect(color!.style.opacity).toBe("0.4");
    expect(bold!.style.opacity).toBe("0.4");
  });

  it("enabled state keeps the pointer cursor on both cells (no behavior change)", () => {
    renderPanel(/* editable */ true);

    const color = cell("Text color");
    const bold = cell("Bold (⌘B)");
    expect(color!.style.cursor).toBe("pointer");
    expect(bold!.style.cursor).toBe("pointer");
    expect(color!.style.opacity).toBe("1");
    expect(bold!.style.opacity).toBe("1");
  });
});
