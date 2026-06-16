// @vitest-environment jsdom
//
// ActionsMenuPanel (the "lightning" panel) on the <Menu> primitive (Phase B2):
// the COMPOSITE grid+list reference. Drives the REAL component through the full
// primitive stack (MenuProvider layout="composite" + the bespoke FmtBtn grid
// cells via useMenuItem + the card list via MenuItemsFromRegistry):
//
//   - the composite cross-region edge over the REAL 4-col grid → 11-row list:
//     Left/Right within a grid row, Up/Down between rows, Down off the last grid
//     row into the card list, Up off the list top back into the grid's
//     remembered column;
//   - the letter fast-path (F → footnote) still fires, and coexists with arrows;
//   - Escape closes AND stopPropagation()s (the load-bearing :338 seam that
//     keeps tab-indent.ts's Escape→blur from dropping the editor selection);
//   - disabled grid cells (collab read-only) + disabled card rows are skipped by
//     nav and inert on activate;
//   - click-outside dismisses, but NOT when the click lands in the spawned color
//     popover (the real excludeRefs entry, replacing the old querySelector).
//
// The heavy nested-menu grid deps (BlockTypeDropdown, tex/figure/graphics block
// inserters) are mocked — they're orthogonal to the nav under test. The color
// popover is REAL (the exclusion test needs its live container element).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// The nested-menu grid trigger + the block inserters need a live editor; mock
// them (orthogonal to the composite nav). The color popover is REAL.
vi.mock("../../MenuBar", () => ({
  BlockTypeDropdown: () => <button data-hint="Block type">¶</button>,
}));
vi.mock("@/lib/tiptap/tex-block", () => ({ insertTexBlock: vi.fn() }));

import { ActionsMenuPanel } from "../../ActionsMenuPanel";
import { DragHandleMenuProvider } from "../../editor-layout/card-actions/drag-handle-menu-context";
import { cardActionRows } from "@/lib/actions/action-registry";

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

/**
 * A minimal editor stub the panel + the registry `applies()`/`run()` read. The
 * one non-trivial part: `wrappersDisabled` (a render-time probe) calls the
 * `bullet-list` row's `applies()` → `selectionIsListable(view)`, which reads
 * `view.state.selection.$from.blockRange($to)` + `$from.parent.type.name`. We
 * stub a PM-like selection whose block range parents to a single `paragraph`
 * (a LISTABLE_BLOCK_TYPE), so the wrapper cells render ENABLED — matching the
 * real lightning panel over prose (so arrow nav visits Blockquote etc.).
 */
function makeEditor(editable = true) {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    const ret = () => c;
    for (const m of [
      "focus", "setTextColor", "unsetTextColor", "setTextSelection",
      "toggleBold", "toggleItalic", "run",
    ]) {
      c[m] = ret;
    }
    return c;
  };
  const paragraphType = { type: { name: "paragraph" } };
  const $pos = {
    parent: { type: { name: "paragraph" } },
    blockRange: () => ({
      parent: { child: () => paragraphType },
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
    editable?: boolean;
    dispatch?: ReturnType<typeof vi.fn>;
    onClose?: () => void;
  } = {},
) {
  const dispatch = opts.dispatch ?? vi.fn();
  const api = { open: vi.fn(), dispatch } as unknown as Parameters<
    typeof DragHandleMenuProvider
  >[0]["value"];
  const utils = render(
    <DragHandleMenuProvider value={api}>
      <ActionsMenuPanel
        editor={makeEditor(opts.editable ?? true)}
        paragraphUuid="p7"
        range={{ from: 3, to: 9 }}
        mode={opts.mode ?? "selection"}
        triggerRect={RECT}
        onClose={opts.onClose ?? (() => {})}
      />
    </DragHandleMenuProvider>,
  );
  return { ...utils, dispatch };
}

function key(k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }),
    );
  });
}

const menuEl = () =>
  document.querySelector('[aria-label="Selection actions"]') as HTMLElement;

/** The active (roving) element across BOTH regions — the one with data-active. */
function activeEl(): HTMLElement | undefined {
  return Array.from(
    menuEl().querySelectorAll('[data-active=""]'),
  )[0] as HTMLElement | undefined;
}

/** A grid cell carries `data-hint` (the title) + role=menuitem post-B2. */
function activeHint(): string | null {
  return activeEl()?.getAttribute("data-hint") ?? null;
}

/** The active card row's label (card rows live in `.lightning-card-list`). */
function activeCardLabel(): string | null {
  const el = activeEl();
  if (!el || !el.closest(".lightning-card-list")) return null;
  return el.querySelectorAll("span")[1]?.textContent ?? null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Composite grid nav over the REAL 4×4 layout.
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel — composite GRID nav", () => {
  it("ArrowDown with no active lands on the first grid cell (Bold)", () => {
    renderPanel();
    key("ArrowDown");
    expect(activeHint()).toBe("Bold (⌘B)");
  });

  it("ArrowRight steps within the first grid row (Bold → Italic → Strike → Code), clamping at the row end", () => {
    renderPanel();
    key("ArrowDown"); // Bold (0,0)
    key("ArrowRight");
    expect(activeHint()).toBe("Italic (⌘I)");
    key("ArrowRight");
    expect(activeHint()).toBe("Strikethrough");
    key("ArrowRight");
    expect(activeHint()).toBe("Inline code");
    key("ArrowRight"); // clamp at row end — no wrap
    expect(activeHint()).toBe("Inline code");
  });

  it("ArrowLeft clamps at the row start (Bold stays Bold)", () => {
    renderPanel();
    key("ArrowDown"); // Bold (0,0)
    key("ArrowLeft");
    expect(activeHint()).toBe("Bold (⌘B)");
  });

  it("ArrowDown moves between grid rows by column (Code → Blockquote → Text color → Cross-ref)", () => {
    renderPanel();
    key("ArrowDown"); // Bold (0,0)
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowRight"); // Code (0,3)
    key("ArrowDown");
    expect(activeHint()).toBe("Blockquote"); // (1,3)
    key("ArrowDown");
    expect(activeHint()).toBe("Text color"); // (2,3)
    key("ArrowDown");
    expect(activeHint()).toBe("Insert cross-reference (\\ref)"); // (3,3)
  });
});

// ---------------------------------------------------------------------------
// The composite grid ↔ list cross-region edge (§3.4).
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel — composite grid↔list seam", () => {
  it("ArrowDown off the LAST grid row enters the card list (first card)", () => {
    renderPanel();
    // Walk to the bottom grid row, column 0 (\tex), then Down → into the list.
    key("ArrowDown"); // Bold (0,0)
    key("ArrowDown"); // Block type (1,0)
    key("ArrowDown"); // Example (2,0)
    key("ArrowDown"); // \tex (3,0)
    expect(activeHint()).toBe("Insert raw LaTeX block");
    key("ArrowDown"); // off the last row → first card
    expect(activeCardLabel()).toBe(cardActionRows("lightning")[0].label); // Highlight
  });

  it("ArrowUp off the list TOP re-enters the grid at the remembered column", () => {
    renderPanel();
    // Enter the grid at column 2 (Strike), drop to the last row (graphics, col 2),
    // then Down into the list, then Up back — should land on the col-2 cell.
    key("ArrowDown"); // Bold (0,0)
    key("ArrowRight");
    key("ArrowRight"); // Strike (0,2)
    key("ArrowDown"); // Ordered list (1,2)
    key("ArrowDown"); // Display math (2,2)
    key("ArrowDown"); // graphics (3,2)
    expect(activeHint()).toBe("Insert image");
    key("ArrowDown"); // → first card (remembers lastGridCol = 2)
    expect(activeCardLabel()).toBe(cardActionRows("lightning")[0].label);
    key("ArrowUp"); // back into the grid at {maxRow, col 2}
    expect(activeHint()).toBe("Insert image"); // graphics (3,2)
  });

  it("ArrowDown/Up navigate WITHIN the card list once inside it", () => {
    renderPanel();
    const rows = cardActionRows("lightning");
    // Jump to the list bottom via End (composite End = grid end → but Home/End in
    // the list region jump within the list; reach the list first).
    key("ArrowDown"); // Bold
    for (let i = 0; i < 3; i++) key("ArrowDown"); // descend col 0 to \tex
    key("ArrowDown"); // first card (Highlight)
    expect(activeCardLabel()).toBe(rows[0].label);
    key("ArrowDown");
    expect(activeCardLabel()).toBe(rows[1].label); // Note
    key("ArrowUp");
    expect(activeCardLabel()).toBe(rows[0].label); // Highlight
  });

  it("Enter on an active card row dispatches that card action", () => {
    const { dispatch } = renderPanel({ mode: "selection" });
    key("ArrowDown");
    for (let i = 0; i < 3; i++) key("ArrowDown"); // descend col 0 to \tex
    key("ArrowDown"); // Highlight (first card)
    key("Enter");
    expect(dispatch).toHaveBeenCalledWith("highlight", {
      kind: "selection",
      paragraphId: "p7",
      from: 3,
      to: 9,
    });
  });
});

// ---------------------------------------------------------------------------
// Letter fast-path coexistence.
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel — letter fast-path", () => {
  it("a bare letter fires the matching card action (F → footnote)", () => {
    const { dispatch } = renderPanel({ mode: "selection" });
    key("f");
    expect(dispatch).toHaveBeenCalledWith("footnote", {
      kind: "selection",
      paragraphId: "p7",
      from: 3,
      to: 9,
    });
  });

  it("letters coexist with arrows — pressing N after arrowing still fires Note", () => {
    const { dispatch } = renderPanel({ mode: "selection" });
    key("ArrowDown"); // move into the grid
    key("ArrowRight");
    key("n"); // letter still works
    expect(dispatch).toHaveBeenCalledWith("note", {
      kind: "selection",
      paragraphId: "p7",
      from: 3,
      to: 9,
    });
  });

  it("modifier+letter does NOT fire (bare keys only)", () => {
    const { dispatch } = renderPanel();
    key("f", { metaKey: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a greyed card row's letter is inert (Highlight in cursor mode)", () => {
    const { dispatch } = renderPanel({ mode: "cursor" });
    key("h"); // highlight greyed in cursor mode → inert
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Disabled-skip (collab read-only greys EVERY grid cell + card row).
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel — disabled-skip", () => {
  it("read-only: arrow nav never lands on a disabled cell, Enter never activates one", () => {
    const { dispatch } = renderPanel({ editable: false, mode: "selection" });
    // Every grid cell + card row is greyed; arrowing finds no enabled target, so
    // nothing activates.
    for (let i = 0; i < 20; i++) {
      key("ArrowDown");
      const el = activeEl();
      // If anything is active, it must NOT be disabled.
      if (el) expect(el.getAttribute("aria-disabled")).not.toBe("true");
    }
    key("Enter");
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Escape — closes AND stopPropagation (the :338 seam).
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel — Escape seam", () => {
  it("Escape closes the panel", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape stopPropagation()s so it never reaches the editor (tab-indent.ts blur)", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    const e = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    const stop = vi.fn();
    const orig = e.stopPropagation.bind(e);
    e.stopPropagation = () => {
      stop();
      orig();
    };
    act(() => {
      window.dispatchEvent(e);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Click-outside dismissal + the color-popover exclusion (the real ref).
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel — click-outside + color-popover exclusion", () => {
  it("click outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderPanel({ onClose });
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clicking INTO the spawned color popover does NOT dismiss the lightning panel", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderPanel({ onClose });
    // Open the color popover by clicking the text-color grid cell. The
    // registry's `textColorRun` requires `payload.anchorRect instanceof
    // DOMRect`; jsdom's `getBoundingClientRect()` is NOT a DOMRect instance
    // (it's a plain object), so stub it to a real DOMRect — in a real browser
    // it already is one.
    const colorCell = menuEl().querySelector(
      'button[data-hint="Text color"]',
    ) as HTMLButtonElement;
    colorCell.getBoundingClientRect = () => new DOMRect(10, 10, 30, 34);
    act(() => {
      colorCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The popover (role=dialog, aria-label="Text color") is now mounted to body.
    const popover = document.querySelector(
      'div[role="dialog"][aria-label="Text color"]',
    ) as HTMLElement;
    expect(popover).toBeTruthy();
    // The exclude-set registration happens on a setTimeout(…,0) in the provider;
    // flush it (and the deferred mousedown listener mount).
    act(() => {
      vi.runAllTimers();
    });
    // A mousedown on a swatch inside the popover must NOT close the panel.
    const swatch = popover.querySelector("button") as HTMLButtonElement;
    act(() => {
      swatch.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// aria-activedescendant (no focus theft) — the active item's domId mirrors onto
// a focused contentEditable; focus never moves to the menu item.
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel — aria-activedescendant (no focus theft)", () => {
  it("mirrors the active grid cell's domId onto a focused contentEditable", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    Object.defineProperty(editable, "isContentEditable", {
      value: true,
      configurable: true,
    });
    document.body.appendChild(editable);
    editable.focus();
    expect(document.activeElement).toBe(editable);

    renderPanel();
    key("ArrowDown"); // Bold (0,0)
    const active = activeEl();
    expect(active).toBeDefined();
    expect(editable.getAttribute("aria-activedescendant")).toBe(active!.id);
    expect(document.activeElement).toBe(editable);
  });
});
