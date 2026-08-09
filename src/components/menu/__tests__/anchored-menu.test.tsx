// @vitest-environment jsdom
//
// `<AnchoredMenu>` — the trigger half of the `<Menu>` primitive (task 143), and
// the omni-strip filter menu as its first migrated consumer.
//
// The three menus this shell retired (`HeaderAddDropdown`, `OmniFilterMenu`,
// Search's `MoreScopesDropdown`) each hand-rolled the same plumbing and each
// dropped a DIFFERENT guard, which is the shape this suite pins: the guards are
// properties of the SHELL now, so they cannot be dropped one consumer at a time.
//
// Contracts:
//   1. the trigger carries `aria-haspopup="menu"` + a live `aria-expanded`, and
//      its click is a real toggle (the trigger is in `excludeRefs`);
//   2. the open menu is a `role="menu"` portaled to `document.body` — NOT a
//      child of the trigger's wrapper, which is what let the old absolute /
//      in-flow copies get clipped by `Panel`'s `overflow-hidden`;
//   3. Escape closes it (none of the three had a keydown handler);
//   4. the menu is height-clamped + scrollable rather than rendering rows below
//      the fold with nothing to scroll (`maxHeight`, on by default) — the
//      OmniFilterMenu symptom that made this a user-facing bug and not just a
//      consolidation;
//   5. `closeOnInsideClick` is opt-IN, so a menu built from explicit rows
//      controls its own closing (a filter menu survives a run of toggles).
//
// And for `OmniFilterMenu` specifically: rows are `menuitemcheckbox` +
// `aria-checked` (it had NO menu semantics at all), toggling a category keeps
// the menu open, and "Default view" is a one-shot that closes.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";

// The Omni panel pulls the storage barrel transitively; stub it so the heavy
// FSA/dev backend graph doesn't load under vitest (documented
// `@/lib/storage-fsa` resolution failure).
vi.mock("@/lib/storage", () => ({}));

import { AnchoredMenu } from "../AnchoredMenu";
import { MenuActionRow } from "../MenuActionRow";
import { OmniFilterMenu } from "@/panels/Omni/OmniViewPanel";
import type { OmniCategory } from "@/panels/panel-registry";

afterEach(() => cleanup());

const menu = () => document.body.querySelector('[role="menu"]');
const triggerIn = (c: HTMLElement) =>
  c.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement;

/** See the twin note in `header-add-dropdown-toggle.test.tsx`: the shared
 *  dismiss controller installs its outside-mousedown listener on a
 *  `setTimeout(…, 0)` so the opening click can't self-close the menu. */
async function settleDismissListener() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("AnchoredMenu — the guards the shell owns", () => {
  const shell = (extra?: Partial<React.ComponentProps<typeof AnchoredMenu>>) => (
    <AnchoredMenu ariaLabel="Options" trigger={() => "⋯"} {...extra}>
      {({ close }) => (
        <MenuActionRow id="one" label="One" onSelect={close} />
      )}
    </AnchoredMenu>
  );

  it("the trigger announces the menu and reflects its open state", () => {
    const { container } = render(shell());
    const btn = triggerIn(container);
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-label")).toBe("Options");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("the click is a real toggle — mousedown→click while open closes it", async () => {
    const { container } = render(shell());
    const btn = triggerIn(container);
    fireEvent.click(btn);
    expect(menu()).toBeTruthy();
    await settleDismissListener();
    // The full browser sequence. The trigger sits OUTSIDE the portaled menu, so
    // without the `excludeRefs` entry the mousedown would close and the click
    // re-open — the task-094 regression, one level further out.
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(menu()).toBeNull();
  });

  it("portals the menu to document.body, not into the trigger's wrapper", () => {
    const { container } = render(shell());
    fireEvent.click(triggerIn(container));
    const m = menu();
    expect(m).toBeTruthy();
    // The clip half of the law (STYLE_GUIDE "Menus"): a menu laid out inside a
    // panel would be cut off at the panel's box with nothing to scroll.
    expect(container.contains(m)).toBe(false);
    expect(m!.parentElement).toBe(document.body);
  });

  it("Escape closes it", () => {
    const { container } = render(shell());
    fireEvent.click(triggerIn(container));
    expect(menu()).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu()).toBeNull();
  });

  it("clamps its height and scrolls instead of overflowing the viewport", async () => {
    const { container } = render(shell());
    fireEvent.click(triggerIn(container));
    // The clamp is computed by `useFloatingMenuPosition` after the first
    // measurement (a microtask), which is why this awaits a tick.
    await settleDismissListener();
    const style = (menu() as HTMLElement).style;
    expect(style.position).toBe("fixed");
    expect(style.overflowY).toBe("auto");
    expect(style.maxHeight).not.toBe("");
  });

  it("does NOT close on an inside click unless the caller opts in", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <AnchoredMenu ariaLabel="Options" trigger={() => "⋯"}>
        <MenuActionRow id="one" label="One" onSelect={onSelect} />
      </AnchoredMenu>,
    );
    fireEvent.click(triggerIn(container));
    fireEvent.click(screen.getByText("One"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu()).toBeTruthy();

    cleanup();
    const { container: c2 } = render(
      <AnchoredMenu ariaLabel="Options" trigger={() => "⋯"} closeOnInsideClick>
        <MenuActionRow id="one" label="One" onSelect={onSelect} />
      </AnchoredMenu>,
    );
    fireEvent.click(triggerIn(c2));
    fireEvent.click(screen.getByText("One"));
    expect(menu()).toBeNull();
  });
});

describe("OmniFilterMenu — folded onto the shell (task 143)", () => {
  const CATEGORY_SIDES = {
    footnotes: "left",
    citations: "left",
    notes: "right",
  } as unknown as Record<OmniCategory, "left" | "right">;

  function renderFilter(
    enabled: OmniCategory[],
    handlers: {
      onToggle?: (c: OmniCategory) => void;
      onSelectDefault?: () => void;
    } = {},
  ) {
    return render(
      <OmniFilterMenu
        side="left"
        enabled={new Set(enabled)}
        onToggle={handlers.onToggle ?? (() => {})}
        onSelectDefault={handlers.onSelectDefault ?? (() => {})}
        categorySides={CATEGORY_SIDES}
        defaultCategories={["footnotes", "citations"] as OmniCategory[]}
      />,
    );
  }

  const rows = () =>
    Array.from(
      document.body.querySelectorAll('[role="menu"] [role="menuitemcheckbox"]'),
    ) as HTMLButtonElement[];
  const rowByLabel = (label: string) =>
    rows().find((b) => b.textContent?.includes(label));

  it("rows are menuitemcheckbox carrying aria-checked (it had no menu ARIA)", () => {
    const { container } = renderFilter(["footnotes"]);
    fireEvent.click(triggerIn(container));
    expect(menu()).toBeTruthy();
    const footnotes = rowByLabel("Footnotes")!;
    const citations = rowByLabel("Citations")!;
    expect(footnotes.getAttribute("role")).toBe("menuitemcheckbox");
    expect(footnotes.getAttribute("aria-checked")).toBe("true");
    expect(citations.getAttribute("aria-checked")).toBe("false");
    // Only the side's own categories are listed, as before: `categorySides`
    // puts Notes on the right, and this is the LEFT strip's menu.
    expect(rowByLabel("Notes")).toBeUndefined();
  });

  it("toggling a category fires onToggle and KEEPS the menu open", () => {
    const onToggle = vi.fn();
    const { container } = renderFilter(["footnotes"], { onToggle });
    fireEvent.click(triggerIn(container));
    fireEvent.click(rowByLabel("Citations")!);
    expect(onToggle).toHaveBeenCalledWith("citations");
    expect(menu()).toBeTruthy();
  });

  it("'Default view' is a one-shot: it resets and closes", () => {
    const onSelectDefault = vi.fn();
    const { container } = renderFilter(["footnotes", "citations"], {
      onSelectDefault,
    });
    fireEvent.click(triggerIn(container));
    const dflt = rowByLabel("Default view")!;
    // It reflects "am I at the registry default?" as a real checkbox state.
    expect(dflt.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(dflt);
    expect(onSelectDefault).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("Escape closes it", () => {
    const { container } = renderFilter(["footnotes"]);
    fireEvent.click(triggerIn(container));
    expect(menu()).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menu()).toBeNull();
  });
});
