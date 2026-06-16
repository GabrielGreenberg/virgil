// @vitest-environment jsdom
//
// LabelRefPopover on the <Menu> primitive's COMBOBOX path (Phase C): behavior
// PARITY + the new combobox ARIA + two-stage Escape. Drives the REAL component
// through the full primitive stack (MenuProvider layout="combobox" role="listbox"
// + useMenuCombobox + useMenuItem + useMenuKeyboard), mirroring
// heading-type-menu-keyboard.test.tsx. Covers the DoD matrix:
//
//   - combobox nav over a FILTERED list (typing narrows; arrows move the
//     highlight; the highlight resets on a filter keystroke);
//   - the input is the keyboard SOURCE + focus STAYS in the input (arrows never
//     move DOM focus to an option, the caret never leaves);
//   - listbox / option ARIA (input role=combobox aria-expanded aria-controls
//     aria-activedescendant; container role=listbox#id; rows role=option
//     aria-selected);
//   - two-stage Escape (first exits edit mode, second closes);
//   - group dividers (Sections / Examples) are NOT nav stops;
//   - parity: filter, commit-on-Enter (active option OR typed fallback),
//     click-outside, create-mode focus.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import LabelRefPopover, { type LabelInfo } from "../../LabelRefPopover";

// jsdom implements neither scrollIntoView nor ResizeObserver.
beforeAll(() => {
  (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView =
    () => undefined;
});
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

const labels: LabelInfo[] = [
  { label: "sec:intro", kind: "heading", typeLabel: "Section 1", title: "Intro" },
  { label: "sec:method", kind: "heading", typeLabel: "Section 2", title: "Method" },
  { label: "sec:results", kind: "heading", typeLabel: "Section 3", title: "Results" },
  { label: "ex:donkey", kind: "example", typeLabel: "Example (3)", title: "" },
];

const ANCHOR = {
  left: 100,
  top: 100,
  bottom: 120,
  width: 40,
  height: 20,
  right: 140,
  x: 100,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

function setupCreate(extra?: Partial<Parameters<typeof LabelRefPopover>[0]>) {
  const onInsertRef = vi.fn();
  const onChangeLabel = vi.fn();
  const onClose = vi.fn();
  render(
    <LabelRefPopover
      label="" // create mode
      anchorRect={ANCHOR}
      labels={labels}
      onChangeLabel={onChangeLabel}
      onJumpToLabel={vi.fn()}
      onInsertRef={onInsertRef}
      onClose={onClose}
      {...extra}
    />,
  );
  const input = screen.getByPlaceholderText("label key") as HTMLInputElement;
  return { input, onInsertRef, onChangeLabel, onClose };
}

function options(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('[role="listbox"] [role="option"]'),
  ) as HTMLElement[];
}
function activeOption(): HTMLElement | undefined {
  return options().find((o) => o.getAttribute("data-active") === "");
}
function labelOf(o: HTMLElement | undefined): string {
  return o?.querySelector(".label-ref-option-label")?.textContent ?? "";
}

describe("LabelRefPopover combobox — listbox / combobox ARIA (§3.5)", () => {
  it("the input is a combobox owning the listbox; rows are options", () => {
    const { input } = setupCreate();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("true"); // create mode opens it

    // aria-controls points at the listbox container's id.
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox).not.toBeNull();
    expect(listbox.id).toBe("label-ref-listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);

    // Every row carries role=option + aria-selected.
    const opts = options();
    expect(opts.length).toBe(labels.length);
    expect(opts.every((o) => o.getAttribute("aria-selected") != null)).toBe(true);
  });

  it("aria-expanded is false when the dropdown is collapsed (no matches)", () => {
    const { input } = setupCreate();
    fireEvent.change(input, { target: { value: "zzz-nomatch" } });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(options()).toHaveLength(0);
  });
});

describe("LabelRefPopover combobox — nav over a filtered list", () => {
  it("typing narrows the option set", () => {
    const { input } = setupCreate();
    expect(options()).toHaveLength(4);
    fireEvent.change(input, { target: { value: "sec" } });
    expect(options().map((o) => labelOf(o))).toEqual([
      "sec:intro",
      "sec:method",
      "sec:results",
    ]);
  });

  it("ArrowDown moves the highlight + sets aria-selected; Enter commits it", () => {
    const { input, onInsertRef } = setupCreate();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // first → sec:intro
    expect(labelOf(activeOption())).toBe("sec:intro");
    expect(activeOption()!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:intro", "ref");
  });

  it("arrows operate over the FILTERED list, not the full one", () => {
    const { input, onInsertRef } = setupCreate();
    fireEvent.change(input, { target: { value: "method" } }); // only sec:method
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:method", "ref");
  });

  it("a filter keystroke resets the highlight (Enter falls back to typed value)", () => {
    const { input, onInsertRef } = setupCreate();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlight sec:intro
    expect(activeOption()).toBeDefined();
    fireEvent.change(input, { target: { value: "sec:custom" } }); // clears highlight
    expect(activeOption()).toBeUndefined();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:custom", "ref");
  });

  it("ArrowDown crosses the Sections→Examples group boundary as one list", () => {
    const { input, onInsertRef } = setupCreate();
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sec:intro
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sec:method
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sec:results
    fireEvent.keyDown(input, { key: "ArrowDown" }); // ex:donkey (across the divider)
    expect(labelOf(activeOption())).toBe("ex:donkey");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("ex:donkey", "ref");
  });
});

describe("LabelRefPopover combobox — input is the keyboard source (no focus theft)", () => {
  it("arrows keep DOM focus in the input; aria-activedescendant tracks the option", () => {
    const { input } = setupCreate();
    // Create mode auto-focuses the input via rAF — focus it deterministically.
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = activeOption();
    expect(active).toBeDefined();
    // Focus NEVER moved to the option; the input owns aria-activedescendant.
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(active!.id);
    expect(active!.id).toBe("label-ref-item-h:sec:intro");
  });

  it("the option's id is `${menuId}-item-${id}` (stable activedescendant target)", () => {
    setupCreate();
    const ids = options().map((o) => o.id);
    expect(ids).toContain("label-ref-item-h:sec:intro");
    expect(ids).toContain("label-ref-item-e:ex:donkey");
  });
});

describe("LabelRefPopover combobox — group dividers are not nav stops", () => {
  it("ArrowDown skips the Sections / Examples group-heading dividers", () => {
    const { input } = setupCreate();
    // The dividers exist as visual rows but are NOT options.
    expect(
      document.querySelectorAll(".label-ref-popover-group-heading").length,
    ).toBe(2);
    // Walk the whole list; an active row is ALWAYS an option, never a divider.
    for (let i = 0; i < labels.length + 2; i++) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      const active = activeOption();
      expect(active).toBeDefined();
      expect(active!.getAttribute("role")).toBe("option");
      expect(active!.classList.contains("label-ref-popover-group-heading")).toBe(
        false,
      );
    }
  });
});

describe("LabelRefPopover combobox — two-stage Escape (§3.2)", () => {
  it("first Escape exits edit mode (popover stays); second closes", () => {
    const { input, onClose } = setupCreate();
    // Stage 1: editing → exit edit mode, do NOT close.
    expect(input).toBeDefined();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    // The input is gone (edit mode exited) but the popover is still mounted.
    expect(screen.queryByPlaceholderText("label key")).toBeNull();
    expect(document.querySelector(".label-ref-popover")).not.toBeNull();

    // Stage 2: not editing → close.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("in display mode (existing ref) the first Escape closes (single-stage)", () => {
    const onClose = vi.fn();
    render(
      <LabelRefPopover
        label="sec:intro" // NOT create mode → starts in display mode
        anchorRect={ANCHOR}
        labels={labels}
        onChangeLabel={vi.fn()}
        onJumpToLabel={vi.fn()}
        onInsertRef={vi.fn()}
        onClose={onClose}
      />,
    );
    // No input rendered (display mode).
    expect(screen.queryByPlaceholderText("label key")).toBeNull();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("LabelRefPopover combobox — parity (commit / click / create-focus)", () => {
  it("Enter with no highlight commits the typed value", () => {
    const { input, onInsertRef } = setupCreate();
    fireEvent.change(input, { target: { value: "sec:fresh" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:fresh", "ref");
  });

  it("clicking an option commits its label", () => {
    const { onInsertRef } = setupCreate();
    const intro = options().find((o) => labelOf(o) === "sec:intro")!;
    fireEvent.click(intro);
    expect(onInsertRef).toHaveBeenCalledWith("sec:intro", "ref");
  });

  it("create mode renders the input open (auto-focus target present)", () => {
    const { input } = setupCreate();
    expect(input).toBeDefined();
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("click-outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <LabelRefPopover
        label=""
        anchorRect={ANCHOR}
        labels={labels}
        onChangeLabel={vi.fn()}
        onJumpToLabel={vi.fn()}
        onInsertRef={vi.fn()}
        onClose={onClose}
      />,
    );
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("the ref-command round-trips: a flipped command commits with the new command", () => {
    const onInsertRef = vi.fn();
    render(
      <LabelRefPopover
        label=""
        anchorRect={ANCHOR}
        labels={labels}
        refCommand="getfullref" // create mode honors the active command
        onChangeLabel={vi.fn()}
        onJumpToLabel={vi.fn()}
        onInsertRef={onInsertRef}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("label key");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sec:intro
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onInsertRef).toHaveBeenCalledWith("sec:intro", "getfullref");
  });
});
