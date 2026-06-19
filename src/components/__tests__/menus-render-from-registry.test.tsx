// @vitest-environment jsdom
//
// CHIP 3 — the two live menus (DragHandleMenu / ActionsMenuPanel) render
// their CARD action list FROM the registry (`VIRGIL_ACTION_REGISTRY` via
// `cardActionRows`), not from a private `MENU_ENTRIES` array. The registry is
// now the SSOT; the menus are thin views. This test pins BEHAVIOR-IDENTICAL:
//
//   1. both menus render the same 11 entries in the same canonical order,
//      with the same labels + single-letter hints;
//   2. per representative kind the SAME entries are greyed (visible-disabled,
//      not filtered): displayMath → footnote/citation/suggest-edit greyed;
//      titleField → citation/duplicate/archive/delete greyed; cursor mode →
//      highlight greyed;
//   3. clicking an entry fires the dispatch with the right (action, ref) args.
//
// The icon barrel + floating-position hook are real (the icons are simple
// SVGs); jsdom lacks ResizeObserver, which `useFloatingMenuPosition` uses, so
// we stub it. For ActionsMenuPanel the heavy formatting-grid deps (MenuBar,
// block inserters, color popover) are mocked — this test exercises the ACTION
// LIST, which is the part CHIP 3 re-pointed at the registry.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// ActionsMenuPanel renders a formatting grid (MenuBar's BlockTypeDropdown +
// the block inserters + the color popover) that needs a live editor. Mock
// those — they are orthogonal to the CHIP-3 action-list inversion under test.
vi.mock("../MenuBar", () => ({
  BlockTypeDropdown: () => <div data-testid="block-type-dropdown" />,
}));
vi.mock("@/lib/tiptap/tex-block", () => ({ insertTexBlock: vi.fn() }));
vi.mock("@/lib/tiptap/figure-block", () => ({ insertFigureBlock: vi.fn() }));
vi.mock("@/lib/tiptap/graphics-block", () => ({ insertGraphicsBlock: vi.fn() }));
vi.mock("../SelectionColorPopover", () => ({
  SelectionColorPopover: () => null,
}));

import { DragHandleMenu } from "../DragHandleMenu";
import { ActionsMenuPanel } from "../ActionsMenuPanel";
import { DragHandleMenuProvider } from "../editor-layout/card-actions/drag-handle-menu-context";
import { cardActionRows } from "@/lib/actions/action-registry";

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

// The canonical order + labels + letters, straight off the registry view.
// Every card row carries a non-empty single-letter hint (the coverage
// assertion pins this), so we narrow `letter` to a definite string here.
const EXPECTED = cardActionRows("grab").map((r) => ({
  id: r.id,
  label: r.label,
  letter: r.letter ?? "",
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Read the rendered action menu items as {label, letter, disabled} in DOM
 *  order. Both menus render each row as a <button role="menuitem"> whose
 *  first <span> chain is [icon, label, letter]. */
function readItems(scope: HTMLElement) {
  const buttons = Array.from(
    scope.querySelectorAll('button[role="menuitem"]'),
  ) as HTMLButtonElement[];
  return buttons.map((b) => {
    const spans = b.querySelectorAll("span");
    return {
      label: spans[1]?.textContent ?? "",
      letter: spans[2]?.textContent ?? "",
      disabled: b.disabled,
    };
  });
}

// ---------------------------------------------------------------------------
// Sanity: there ARE 11 card rows in canonical order off the registry.
// ---------------------------------------------------------------------------
describe("registry card-row view (the menus' SSOT)", () => {
  it("exposes exactly the 11 cards in canonical menu order", () => {
    expect(EXPECTED.map((e) => e.id)).toEqual([
      "highlight", "note", "footnote", "citation", "todo", "suggest-edit",
      "cutter", "report", "duplicate", "archive", "delete",
    ]);
    expect(EXPECTED.map((e) => e.letter)).toEqual([
      "H", "N", "F", "C", "T", "E", "X", "R", "D", "A", "⌫",
    ]);
  });

  it("grab and lightning expose the identical card list", () => {
    expect(cardActionRows("lightning").map((r) => r.id)).toEqual(
      cardActionRows("grab").map((r) => r.id),
    );
  });
});

// ---------------------------------------------------------------------------
// DragHandleMenu (grab surface)
// ---------------------------------------------------------------------------
describe("DragHandleMenu renders from the registry", () => {
  it("renders all 11 entries in order with the same labels + letters (selection)", () => {
    render(
      <DragHandleMenu
        anchorRect={RECT}
        onSelect={() => {}}
        onClose={() => {}}
        kind="selection"
      />,
    );
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const items = readItems(menu);
    expect(items.map((i) => i.label)).toEqual(EXPECTED.map((e) => e.label));
    expect(items.map((i) => i.letter)).toEqual(EXPECTED.map((e) => e.letter));
    // Selection mode → full vocabulary, nothing greyed.
    expect(items.every((i) => !i.disabled)).toBe(true);
  });

  it("greys (visible, not filtered) footnote/citation/suggest-edit on displayMath", () => {
    render(
      <DragHandleMenu
        anchorRect={RECT}
        onSelect={() => {}}
        onClose={() => {}}
        kind="displayMath"
      />,
    );
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const items = readItems(menu);
    // Still 11 entries — disabled entries are visible, not removed.
    expect(items).toHaveLength(11);
    const byLetter = Object.fromEntries(items.map((i) => [i.letter, i.disabled]));
    expect(byLetter["F"]).toBe(true); // footnote
    expect(byLetter["C"]).toBe(true); // citation
    expect(byLetter["E"]).toBe(true); // suggest-edit
    expect(byLetter["N"]).toBe(false); // note stays
    expect(byLetter["H"]).toBe(false); // highlight stays (block ref has a range)
    expect(byLetter["⌫"]).toBe(false); // delete stays
  });

  it("greys citation + duplicate/archive/delete on titleField", () => {
    render(
      <DragHandleMenu
        anchorRect={RECT}
        onSelect={() => {}}
        onClose={() => {}}
        kind="titleField"
      />,
    );
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const byLetter = Object.fromEntries(
      readItems(menu).map((i) => [i.letter, i.disabled]),
    );
    expect(byLetter["C"]).toBe(true); // citation
    expect(byLetter["D"]).toBe(true); // duplicate
    expect(byLetter["A"]).toBe(true); // archive
    expect(byLetter["⌫"]).toBe(true); // delete
    expect(byLetter["F"]).toBe(false); // footnote stays
    expect(byLetter["N"]).toBe(false); // note stays
  });

  it("onSelect fires with the action id when an enabled entry is clicked", () => {
    const onSelect = vi.fn();
    render(
      <DragHandleMenu
        anchorRect={RECT}
        onSelect={onSelect}
        onClose={() => {}}
        kind="paragraph"
      />,
    );
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    // Click "Footnote".
    const footnote = within(menu).getByText("Footnote").closest("button")!;
    fireEvent.click(footnote);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("footnote");
  });

  it("a greyed entry does NOT fire onSelect", () => {
    const onSelect = vi.fn();
    render(
      <DragHandleMenu
        anchorRect={RECT}
        onSelect={onSelect}
        onClose={() => {}}
        kind="displayMath"
      />,
    );
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const footnote = within(menu).getByText("Footnote").closest("button")!;
    fireEvent.click(footnote);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ActionsMenuPanel (lightning surface) — action-list slice
// ---------------------------------------------------------------------------
describe("ActionsMenuPanel action list renders from the registry", () => {
  const editorStub = {
    isActive: () => false,
    chain: () => ({ focus: () => ({ run: () => {} }) }),
    state: { selection: { from: 0, to: 0 }, doc: { textBetween: () => "" } },
  } as unknown as Parameters<typeof ActionsMenuPanel>[0]["editor"];

  function renderPanel(
    mode: "selection" | "cursor",
    dispatch = vi.fn(),
  ) {
    const api = {
      open: vi.fn(),
      dispatch,
    };
    const utils = render(
      <DragHandleMenuProvider value={api}>
        <ActionsMenuPanel
          editor={editorStub}
          paragraphUuid="p7"
          // BUG2/Path A: cursor-mode dispatch now emits the REAL node kind.
          // A paragraph caret resolves to kind "paragraph", so this keeps the
          // cursor-mode assertion below (`{ kind: "paragraph", id: "p7" }`)
          // faithful to the live behavior for a paragraph anchor.
          nodeKind="paragraph"
          range={{ from: 3, to: 9 }}
          mode={mode}
          triggerRect={RECT}
          onClose={() => {}}
        />
      </DragHandleMenuProvider>,
    );
    return { ...utils, dispatch };
  }

  /** The action list lives below the formatting grid in the `<MenuList>`
   *  region (`.lightning-card-list`). Post-B2 the grid FmtBtn cells ALSO carry
   *  role=menuitem (they're registered grid items now), so scope to the card
   *  list to read just the 11 card rows. */
  function actionItems() {
    const list = document.querySelector(
      '[aria-label="Selection actions"] .lightning-card-list',
    ) as HTMLElement;
    return readItems(list);
  }

  it("renders all 11 entries in the same order with the same labels + letters", () => {
    renderPanel("selection");
    const items = actionItems();
    expect(items.map((i) => i.label)).toEqual(EXPECTED.map((e) => e.label));
    expect(items.map((i) => i.letter)).toEqual(EXPECTED.map((e) => e.letter));
  });

  it("greys ONLY highlight in cursor mode (matches the legacy ActionsMenuPanel rule)", () => {
    renderPanel("cursor");
    const byLetter = Object.fromEntries(
      actionItems().map((i) => [i.letter, i.disabled]),
    );
    expect(byLetter["H"]).toBe(true); // highlight greyed in cursor mode
    // Everything else enabled (the lightning list is not per-kind gated).
    for (const e of EXPECTED) {
      if (e.letter === "H") continue;
      expect(byLetter[e.letter], `${e.label} enabled`).toBe(false);
    }
  });

  it("nothing greyed in selection mode", () => {
    renderPanel("selection");
    expect(actionItems().every((i) => !i.disabled)).toBe(true);
  });

  it("clicking an entry dispatches (action, selectionRef) in selection mode", () => {
    const { dispatch } = renderPanel("selection");
    const menu = document.querySelector(
      '[aria-label="Selection actions"]',
    ) as HTMLElement;
    fireEvent.click(within(menu).getByText("Footnote").closest("button")!);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("footnote", {
      kind: "selection",
      paragraphId: "p7",
      from: 3,
      to: 9,
    });
  });

  it("clicking an entry dispatches (action, paragraphRef) in cursor mode", () => {
    const { dispatch } = renderPanel("cursor");
    const menu = document.querySelector(
      '[aria-label="Selection actions"]',
    ) as HTMLElement;
    fireEvent.click(within(menu).getByText("Note").closest("button")!);
    expect(dispatch).toHaveBeenCalledWith("note", { kind: "paragraph", id: "p7" });
  });

  it("a greyed highlight (cursor mode) does NOT dispatch", () => {
    const { dispatch } = renderPanel("cursor");
    const menu = document.querySelector(
      '[aria-label="Selection actions"]',
    ) as HTMLElement;
    fireEvent.click(within(menu).getByText("Highlight").closest("button")!);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
