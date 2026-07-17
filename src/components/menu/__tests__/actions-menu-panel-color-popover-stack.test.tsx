// @vitest-environment jsdom
//
// Task 151 — the lightning color popover is a STACK PARTICIPANT, not a portaled
// sibling. `SelectionColorPopover` renders as a React DESCENDANT of the lightning
// `<MenuProvider>` (it still `portal`s to document.body), so `MenuStackContext`
// flows through the `createPortal` boundary → the popover inherits the SAME
// `MenuStackController` → depth+1 → becomes the stack top while open. The
// lightning menu's window-capture keydown + Escape then STAND DOWN, exactly like
// the nested-descendant case pinned by `nested-provider-stack.test.tsx` — but
// here through the REAL ActionsMenuPanel + SelectionColorPopover topology.
//
// Pre-151 the popover was a sibling rendered after `</MenuProvider>`, so it read
// the root sentinel and built its OWN controller → BOTH menus declared `isTop`
// → one Arrow moved both roving cursors, one Enter activated both registries
// (re-running the lightning menu's active row), one Escape closed both. Each
// test below goes RED on that topology and GREEN once the popover is a
// descendant.
//
// Reuses the harness shape of `actions-menu-panel-keyboard.test.tsx`: the nested
// grid trigger + block inserters are mocked (orthogonal), the color popover is
// REAL (the stack membership is exactly what's under test).

import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// The nested-menu grid trigger + the block inserters need a live editor; mock
// them (orthogonal to the stack membership under test). The color popover is REAL.
vi.mock("../../MenuBar", () => ({
  BlockTypeDropdown: () => <button data-hint="Block type">¶</button>,
}));
vi.mock("@/lib/tiptap/tex-block", () => ({ insertTexBlock: vi.fn() }));

import { ActionsMenuPanel } from "../../ActionsMenuPanel";
import { DragHandleMenuProvider } from "../../editor-layout/card-actions/drag-handle-menu-context";

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

/**
 * A minimal editor stub the panel + the registry `applies()`/`run()` read (same
 * shape as the keyboard test). `setTextColor` is a passed-in spy so we can assert
 * the swatch's `applyColor` chain actually ran on Enter.
 */
function makeEditor(setTextColor: (color: string) => void, editable = true) {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const ret = () => c;
    for (const m of [
      "focus", "unsetTextColor", "setTextSelection", "toggleBold",
      "toggleItalic", "run",
    ]) {
      c[m] = ret;
    }
    c.setTextColor = (color: string) => {
      setTextColor(color);
      return c;
    };
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

function renderPanel(
  opts: {
    mode?: "selection" | "cursor";
    dispatch?: ReturnType<typeof vi.fn>;
    setTextColor?: Mock<(color: string) => void>;
    onClose?: () => void;
  } = {},
) {
  const dispatch = opts.dispatch ?? vi.fn();
  const setTextColor = opts.setTextColor ?? vi.fn<(color: string) => void>();
  const api = { open: vi.fn(), dispatch } as unknown as Parameters<
    typeof DragHandleMenuProvider
  >[0]["value"];
  const utils = render(
    <DragHandleMenuProvider value={api}>
      <ActionsMenuPanel
        editor={makeEditor(setTextColor)}
        paragraphUuid="p7"
        nodeKind="paragraph"
        range={{ from: 3, to: 9 }}
        mode={opts.mode ?? "selection"}
        triggerRect={RECT}
        onClose={opts.onClose ?? (() => {})}
      />
    </DragHandleMenuProvider>,
  );
  return { ...utils, dispatch, setTextColor };
}

function key(k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }),
    );
  });
}

const menuEl = () =>
  document.querySelector('[aria-label="Selection actions"]') as HTMLElement | null;
const popoverEl = () =>
  document.querySelector(
    'div[role="dialog"][aria-label="Text color"]',
  ) as HTMLElement | null;

/** data-active hint WITHIN a container (the popover is a separate portal, so a
 *  query scoped to the lightning menu never sees the popover's active, and vice
 *  versa — the exact separation the double-move assertion needs). */
function activeHint(root: HTMLElement | null): string | null {
  const el = root?.querySelector('[data-active=""]') as HTMLElement | null;
  return el?.getAttribute("data-hint") ?? null;
}

/** Open the color popover by clicking the lightning grid's text-color cell. The
 *  registry's text-color `run()` requires `payload.anchorRect instanceof
 *  DOMRect`; jsdom's `getBoundingClientRect()` isn't a DOMRect instance, so stub
 *  it (in a real browser it already is one). */
function openColorPopover() {
  const colorCell = menuEl()!.querySelector(
    'button[data-hint="Text color"]',
  ) as HTMLButtonElement;
  colorCell.getBoundingClientRect = () => new DOMRect(10, 10, 30, 34);
  act(() => {
    colorCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("Task 151 — color popover joins the lightning menu's stack", () => {
  it("with the popover open, a single Arrow moves ONLY the popover cursor (the lightning grid cursor is untouched)", () => {
    renderPanel();
    openColorPopover();
    expect(popoverEl()).toBeTruthy();

    // The lightning grid's roving cursor before the arrow (clicking the cell
    // does NOT set roving active — only onMouseEnter does — so it's null here).
    const lightningBefore = activeHint(menuEl());

    // The popover is a horizontal list → Right steps its swatches.
    key("ArrowRight");

    // The popover (now the stack top) consumed the arrow: a swatch is active.
    expect(activeHint(popoverEl())).toBeTruthy();
    // The lightning grid's cursor did NOT move — no double-move leak.
    expect(activeHint(menuEl())).toBe(lightningBefore);
  });

  it("a single Escape pops ONE level — the popover closes, the lightning panel stays open", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    openColorPopover();
    expect(popoverEl()).toBeTruthy();

    key("Escape");

    // Only the innermost provider (the popover) owns Escape → only it closes.
    expect(popoverEl()).toBeNull();
    // The lightning panel is still mounted and its onClose was NOT fired.
    expect(menuEl()).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a single Enter applies ONLY the swatch — the lightning menu's active card action does NOT re-run", () => {
    const dispatch = vi.fn();
    const setTextColor = vi.fn<(color: string) => void>();
    const onClose = vi.fn();
    renderPanel({ mode: "selection", dispatch, setTextColor, onClose });

    // Park the lightning roving cursor on a dispatch-bearing card row (Highlight,
    // the first card). Down ×5: Bold → Block type → Example → \tex → first card.
    key("ArrowDown");
    for (let i = 0; i < 3; i++) key("ArrowDown");
    key("ArrowDown");

    openColorPopover();
    // Move the popover cursor onto a swatch (Right is inert on the lightning card
    // LIST, so the lightning cursor stays parked on Highlight).
    key("ArrowRight");

    key("Enter");

    // The swatch's applyColor chain ran (setTextColor invoked)...
    expect(setTextColor).toHaveBeenCalled();
    // ...but the lightning menu's active card row did NOT re-run: no dispatch,
    // no panel close (runAction would have fired both).
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // applyColor closed the popover; the lightning panel stays open.
    expect(popoverEl()).toBeNull();
    expect(menuEl()).toBeTruthy();
  });
});
