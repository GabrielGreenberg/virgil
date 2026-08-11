// @vitest-environment jsdom
//
// Task 181 — the last three panel-chrome dropdowns fold onto the `<Menu>` SSOT.
//
// `ItemMenu` migrated in task 180 and the STYLE_GUIDE has called the primitive
// canonical since ("don't hand-roll a portal + `z-[9999]` + a bespoke
// `document.addEventListener('mousedown')` closer"); task 143 built
// `<AnchoredMenu>` and drained the three dropdowns that MEASURED their trigger.
// What was left was a whole dialect the census could not see — a dropdown
// anchored by CSS (`absolute right-0 top-full`), which reads no rect — and
// three of them were still live in `src/`, each with a different z-tier and a
// different subset of the guards.
//
// This suite pins BEHAVIOUR at the three migrated sites, because the census
// that now catches the shape can only prove nobody hand-rolled one; it cannot
// prove these three do what the primitive promises. Every assertion below fails
// on the pre-181 source.
//
//   1. PORTAL + Z — the open menu is a `document.body` child at
//      `OPEN_CHROME_MENU_Z`, not an in-flow `absolute` surface at `z-[9999]`
//      (== `DROP_INDICATOR_Z`) or `z-50` (under the float layer at 1200), and
//      not a descendant of a panel list that clips it.
//   2. ESCAPE, SCOPED — the picker nested inside `ItemMenu` is stack depth+1, so
//      Escape closes the PICKER and leaves the kebab open (the task-151 shape:
//      before, the picker had no Escape at all and the key went to the kebab,
//      closing the wrong thing).
//   3. THE KEBAB SURVIVES A PICK — the click fence that made the old popup
//      compatible with `ItemMenu`'s `closeOnInsideClick` is still load-bearing
//      through a React portal.
//   4. KEYBOARD — the swatch grid navigates in two axes (`layout="composite"`,
//      its first real consumer) and the card-kind rows have `aria-checked`.
//   5. TOGGLES SURVIVE — the citation overflow menu stays open across a run of
//      toggles, as its two bare `<label>`s did.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act, screen } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

import PanelThemePicker from "@/components/PanelThemePicker";
import { CardKindHeader, ItemMenu } from "@/components/panel-primitives";
import { OPEN_CHROME_MENU_Z } from "@/floats/float-policy";
import {
  clearPanelColor,
  DEFAULT_PANEL_COLORS,
  getPanelColor,
  PRESET_COLORS,
} from "@/lib/panel-theme";

// jsdom has no ResizeObserver; `useFloatingMenuPosition` measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

beforeEach(() => {
  localStorage.clear();
});

/** The shared dismiss controller installs its outside-mousedown listener on a
 *  `setTimeout(…, 0)` so the opening click can't self-close the menu — and
 *  `MenuProvider`'s R8 parent-exclude registration rides the same tick. Both
 *  must land before a nested-menu assertion means anything. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const menus = () =>
  Array.from(
    document.body.querySelectorAll('[role="menu"], [role="dialog"]'),
  ) as HTMLElement[];

function esc() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

function arrow(key: string) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("PanelThemePicker — on the primitive", () => {
  it("portals to document.body at the chrome z-tier (it was an in-flow z-[9999])", async () => {
    const { container } = render(<PanelThemePicker panelKey="note" label="Note color" />);
    fireEvent.click(screen.getByLabelText("Note color"));
    await settle();

    const surface = document.body.querySelector('[aria-label="Note color"][role]') as HTMLElement;
    expect(surface).toBeTruthy();
    // A body child, NOT a descendant of the component's own wrapper — which is
    // what an `absolute top-full` popup is, and why the panel list clipped it.
    expect(container.contains(surface)).toBe(false);
    expect(surface.style.position).toBe("fixed");
    expect(surface.style.zIndex).toBe(String(OPEN_CHROME_MENU_Z));
    // The exact literal the old surface carried, which IS `DROP_INDICATOR_Z`.
    expect(surface.style.zIndex).not.toBe("9999");
  });

  it("picking a preset writes the panel colour and closes", async () => {
    render(<PanelThemePicker panelKey="note" label="Note color" />);
    fireEvent.click(screen.getByLabelText("Note color"));
    await settle();

    const preset = PRESET_COLORS.find(
      (c) => c.hex.toLowerCase() !== DEFAULT_PANEL_COLORS.note.toLowerCase(),
    )!;
    fireEvent.click(screen.getByLabelText(preset.name));
    await settle();

    expect(getPanelColor("note").toLowerCase()).toBe(preset.hex.toLowerCase());
    expect(document.body.querySelector('[aria-label="Note color"][role]')).toBeNull();
    clearPanelColor("note");
  });

  it("navigates the swatch GRID in two axes — the composite layout, its first consumer", async () => {
    render(<PanelThemePicker panelKey="note" label="Note color" />);
    fireEvent.click(screen.getByLabelText("Note color"));
    await settle();

    const activeName = () =>
      (document.body.querySelector('[role="menuitem"][data-active]') as HTMLElement | null)
        ?.getAttribute("aria-label") ?? null;

    // First arrow ENTERS the menu at the first enabled cell (row 0, col 0).
    arrow("ArrowRight");
    expect(activeName()).toBe(PRESET_COLORS[0].name);
    arrow("ArrowRight");
    expect(activeName()).toBe(PRESET_COLORS[1].name);
    // Down crosses ROWS by column — the move a `list` layout cannot make, and
    // the reason the shell had to learn to forward `layout` at all.
    arrow("ArrowDown");
    expect(activeName()).toBe(PRESET_COLORS[1 + 7].name);
  });
});

describe("PanelThemePicker nested in ItemMenu — the task-151 shape", () => {
  const nested = () => (
    <ItemMenu align="left">
      <div>
        <PanelThemePicker panelKey="note" label="Note color" />
      </div>
    </ItemMenu>
  );

  it("Escape closes the PICKER and leaves the kebab open", async () => {
    const { container } = render(nested());
    fireEvent.click(container.querySelector('[aria-haspopup="menu"]') as HTMLElement);
    await settle();
    fireEvent.click(screen.getByLabelText("Note color"));
    await settle();
    expect(menus()).toHaveLength(2);

    esc();
    await settle();
    // Exactly one level popped — the innermost. Before this, the picker had no
    // Escape handler at all, so the key reached the kebab and closed the outer
    // menu while the swatch grid was open.
    const left = menus();
    expect(left).toHaveLength(1);
    expect(left[0].getAttribute("aria-label")).toBe("Options");
  });

  it("picking a colour does not dismiss the kebab (the click fence, through a portal)", async () => {
    const { container } = render(nested());
    fireEvent.click(container.querySelector('[aria-haspopup="menu"]') as HTMLElement);
    await settle();
    fireEvent.click(screen.getByLabelText("Note color"));
    await settle();

    const preset = PRESET_COLORS.find(
      (c) => c.hex.toLowerCase() !== DEFAULT_PANEL_COLORS.note.toLowerCase(),
    )!;
    fireEvent.click(screen.getByLabelText(preset.name));
    await settle();

    // `ItemMenu` sets `closeOnInsideClick`, and a React portal propagates
    // through the REACT tree — so without the fence this click would reach the
    // kebab's wrapper and close it.
    const left = menus();
    expect(left).toHaveLength(1);
    expect(left[0].getAttribute("aria-label")).toBe("Options");
    clearPanelColor("note");
  });
});

describe("CardKindDropdown — on the primitive", () => {
  const kindMenu = (onChange = vi.fn()) => (
    <CardKindHeader kind="note" options={["note", "todo"]} onChange={onChange} />
  );

  it("keeps the `Change card type` accessible name on the trigger", () => {
    // The single most load-bearing string in this migration: three morph-gate
    // suites resolve the chevron by exactly this label, and the shell owns the
    // button now, so the name has to be passed rather than written.
    const { container } = render(kindMenu());
    const trigger = container.querySelector('[aria-label="Change card type"]');
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("portals at the chrome z-tier instead of an in-flow z-50 the panel list clips", async () => {
    const { container } = render(kindMenu());
    fireEvent.click(screen.getByLabelText("Change card type"));
    await settle();

    const surface = document.body.querySelector(
      '[role="menu"][aria-label="Change card type"]',
    ) as HTMLElement;
    expect(surface).toBeTruthy();
    expect(container.contains(surface)).toBe(false);
    expect(surface.style.zIndex).toBe(String(OPEN_CHROME_MENU_Z));
  });

  it("states which kind the card currently IS, and morphs on pick", async () => {
    const onChange = vi.fn();
    render(kindMenu(onChange));
    fireEvent.click(screen.getByLabelText("Change card type"));
    await settle();

    // `aria-checked` on `menuitemradio` — a card has exactly one kind, so the
    // set is mutually exclusive (its checkbox sibling on the citation menu is
    // right for a genuinely independent pair). The old rows conveyed the current
    // kind only by bolding the text.
    const rows = Array.from(
      document.body.querySelectorAll('[role="menuitemradio"]'),
    ) as HTMLElement[];
    expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);

    fireEvent.click(rows[1]);
    await settle();
    expect(onChange).toHaveBeenCalledWith("todo");
    // A morph is a one-shot: the menu goes with it.
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("the trigger cannot start the card's HTML5 anchor-drag", () => {
    // A menu trigger inside a `draggable="true"` card root: `draggable={false}`
    // is what stops a press on it from dragging the whole card. The hand-rolled
    // dropdown set it per-site; the shell states it once, which also fixed the
    // kebab that had been missing it since task 180.
    const { container } = render(kindMenu());
    const trigger = container.querySelector(
      '[aria-label="Change card type"]',
    ) as HTMLButtonElement;
    expect(trigger.draggable).toBe(false);
  });
});

// ── The two click fences an adversarial pass caught the migration dropping ──
//
// Both are the same lesson, and it is the one a "now it's portaled" instinct
// gets wrong: `createPortal` moves the DOM node, not the REACT tree, so a menu
// row rendered into `document.body` still bubbles its click through every React
// ancestor of the `<AnchoredMenu>` — including handlers on the card header that
// hosts the trigger. A hand-rolled dropdown that stopped its own clicks was not
// being redundant; the primitive stops `mousedown` at the container and has no
// `click` equivalent, so the fence has to survive the migration.
describe("click fences that survive portaling", () => {
  it("picking a card kind does not also activate the card header", async () => {
    const headerClick = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      // Stands in for `PanelCard`'s unified header, whose real handler runs
      // `headerActivate()` — collapse/expand + select.
      <div onClick={headerClick} role="button" tabIndex={0}>
        <CardKindHeader kind="note" options={["note", "todo"]} onChange={onChange} />
      </div>,
    );

    fireEvent.click(container.querySelector('[aria-label="Change card type"]') as HTMLElement);
    await settle();
    expect(headerClick).not.toHaveBeenCalled(); // the trigger's own fence

    const rows = Array.from(
      document.body.querySelectorAll('[role="menuitemradio"]'),
    ) as HTMLElement[];
    fireEvent.click(rows[1]);
    await settle();

    expect(onChange).toHaveBeenCalledWith("todo");
    // Without the row's fence the card morphs AND collapses in one click — and
    // picking the kind the card ALREADY IS (a pure no-op path) collapses it too.
    expect(headerClick).not.toHaveBeenCalled();
  });

  it("a click on the picker's padding ring does not dismiss the kebab", async () => {
    const { container } = render(
      <ItemMenu align="left">
        <div>
          <PanelThemePicker panelKey="note" label="Note color" />
        </div>
      </ItemMenu>,
    );
    fireEvent.click(container.querySelector('[aria-haspopup="menu"]') as HTMLElement);
    await settle();
    fireEvent.click(screen.getByLabelText("Note color"));
    await settle();
    expect(menus()).toHaveLength(2);

    // The menu CONTAINER, i.e. the padding band around the 168px grid. If the
    // padding sits on the container while the fence sits on a child, missing a
    // swatch by a few pixels closes the picker AND the kebab behind it.
    const picker = menus().find((m) => m.getAttribute("aria-label") === "Note color")!;
    fireEvent.click(picker);
    await settle();
    expect(menus()).toHaveLength(2);
  });
});
