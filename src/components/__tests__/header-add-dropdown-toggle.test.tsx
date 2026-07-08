// @vitest-environment jsdom
//
// HeaderAddDropdown — the shared multi-option "+" add menu rendered by
// PanelHeader when a panel passes `onAddOptions` (panel-primitives.tsx).
//
// Pins task 094: the "+" must be a real TOGGLE. The Bibliography panel used
// to roll its own `addMenuOpen` + a bespoke document-`mousedown` outside-click
// whose ref wrapped ONLY the dropdown, not the "+" trigger. So clicking "+"
// while open double-fired: the mousedown outside-handler closed it, then the
// click re-toggled it open — the menu could never be dismissed by its own
// button. HeaderAddDropdown wraps the trigger AND the dropdown in ONE ref, so
// its outside-click correctly EXCLUDES the trigger; the trigger's own click is
// the sole toggle.
//
// Contracts pinned:
//   1. click "+" opens the menu (options visible);
//   2. the real browser sequence mousedown→click on "+" while OPEN closes it
//      (the regression — this is exactly what the old bespoke menu got wrong);
//   3. an outside mousedown closes it, and the trigger re-opens it;
//   4. picking an option fires its handler (with the trigger rect) and closes;
//   5. a `disabled` option renders inert — no handler, menu stays open.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

// panel-primitives pulls the storage barrel transitively; stub it so the
// heavy FSA/dev backend graph doesn't load under vitest (documented
// `@/lib/storage-fsa` resolution failure).
vi.mock("@/lib/storage", () => ({}));

import { PanelHeader } from "../panel-primitives";

afterEach(() => cleanup());

const trigger = (c: HTMLElement) =>
  c.querySelector('[aria-haspopup="menu"]') as HTMLElement;
const menu = () => document.body.querySelector('[role="menu"]');

/** The real pointer sequence a browser dispatches for a plain click. */
function pointerClick(el: HTMLElement) {
  fireEvent.mouseDown(el);
  fireEvent.click(el);
}

describe("HeaderAddDropdown — the '+' is a real toggle (task 094)", () => {
  it("click '+' opens the menu with its options", () => {
    const { container } = render(
      <PanelHeader
        title="Bibliography"
        onAddOptions={[
          { label: "Search library…", onClick: () => {} },
          { label: "Request entry", onClick: () => {} },
        ]}
      />,
    );
    expect(menu()).toBeNull();
    fireEvent.click(trigger(container));
    expect(menu()).toBeTruthy();
    expect(screen.getByText("Search library…")).toBeTruthy();
    expect(screen.getByText("Request entry")).toBeTruthy();
  });

  it("mousedown→click on '+' while open CLOSES it (the toggle regression)", () => {
    const { container } = render(
      <PanelHeader
        title="Bibliography"
        onAddOptions={[
          { label: "Search library…", onClick: () => {} },
          { label: "Request entry", onClick: () => {} },
        ]}
      />,
    );
    fireEvent.click(trigger(container));
    expect(menu()).toBeTruthy();
    // The real browser sequence: mousedown (outside-click handler) then click
    // (toggle). The old bespoke menu re-opened here; the shared primitive stays
    // closed because the trigger lives INSIDE the outside-click ref.
    pointerClick(trigger(container));
    expect(menu()).toBeNull();
  });

  it("outside mousedown closes it; the trigger re-opens it", () => {
    const { container } = render(
      <PanelHeader
        title="Bibliography"
        onAddOptions={[{ label: "Request entry", onClick: () => {} }]}
      />,
    );
    fireEvent.click(trigger(container));
    expect(menu()).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
    fireEvent.click(trigger(container));
    expect(menu()).toBeTruthy();
  });

  it("picking an option fires its handler (with the trigger rect) and closes", () => {
    const onSearch = vi.fn();
    const onRequest = vi.fn();
    const { container } = render(
      <PanelHeader
        title="Bibliography"
        onAddOptions={[
          { label: "Search library…", onClick: onSearch },
          { label: "Request entry", onClick: onRequest },
        ]}
      />,
    );
    fireEvent.click(trigger(container));
    fireEvent.click(screen.getByText("Search library…"));
    expect(onSearch).toHaveBeenCalledTimes(1);
    // The trigger rect flows through so the library picker can anchor to "+".
    expect(onSearch.mock.calls[0][0]).toBeDefined();
    expect(onRequest).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("a disabled option is inert — no handler, menu stays open", () => {
    const onSearch = vi.fn();
    const { container } = render(
      <PanelHeader
        title="Bibliography"
        onAddOptions={[
          { label: "Search library…", onClick: onSearch, disabled: true },
          { label: "Request entry", onClick: () => {} },
        ]}
      />,
    );
    fireEvent.click(trigger(container));
    const disabled = screen.getByText("Search library…") as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    fireEvent.click(disabled);
    expect(onSearch).not.toHaveBeenCalled();
    expect(menu()).toBeTruthy();
  });
});
