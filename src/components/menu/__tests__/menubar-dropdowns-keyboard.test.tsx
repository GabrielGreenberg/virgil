// @vitest-environment jsdom
//
// MenuBar's BlockTypeDropdown + ViewMenu on the <Menu> primitive (Phase C, the
// docked `portal={false}` path + the R5 expandable-tree case). Drives the REAL
// components through the full primitive stack (MenuProvider + useMenuItem +
// useMenuKeyboard), mirroring heading-type-menu-keyboard.test.tsx:
//
//   BlockTypeDropdown:
//   - click selects a block type ('Body' → setParagraph, 'Part' → setNode);
//   - the current level carries the ✓ marker + aria-checked/data-current;
//   - Up/Down/Home/End arrow nav moves a visible data-active highlight; Enter
//     activates the active row;
//   - Escape closes; click-outside dismisses;
//   - the menu is DOCKED (rendered inline in the trigger wrapper, not portaled).
//
//   ViewMenu (the expandable tree):
//   - checkbox rows toggle (aria-checked) — Display rows close the menu, in-group
//     sub-toggles keep it open (today's split, preserved);
//   - group rows expand/collapse via click AND Enter (aria-expanded); the
//     registry snapshot GROWS/SHRINKS as a group opens (children register);
//   - arrow nav steps the visible set (newly-registered children included);
//   - Escape closes; click-outside dismisses.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { BlockTypeDropdown, ViewMenu } from "../../MenuBar";
import type { Editor } from "@tiptap/react";
import type { DividerLevel } from "@/hooks/useViewPrefs";

// jsdom has no ResizeObserver; useFloatingMenuPosition measures with one (the
// docked path bypasses positioning, but the provider still constructs the hook).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no rAF in some configs; the placement effect uses it. Provide a
// shim (via setTimeout) so the effect's measure runs.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  Number(setTimeout(() => cb(0), 0))) as typeof requestAnimationFrame;
(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame ??= ((id: number) =>
  clearTimeout(id)) as typeof cancelAnimationFrame;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function key(k: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
  });
}

// ── BlockTypeDropdown ─────────────────────────────────────────────────────────

interface FakeChain {
  focus: () => FakeChain;
  setParagraph: () => FakeChain;
  setNode: (name: string, attrs: unknown) => FakeChain;
  run: () => boolean;
}

/** A minimal editor stub: `isActive("heading", {level})` reflects `currentLevel`
 *  (null ⇒ paragraph), `isEditable` true, and a spy-able chain. Levels 0/5/6 +
 *  'Body' take the direct editor-chain path (no action registry), so we can
 *  assert them; levels 1–4 route through the registry (not asserted here). */
function makeEditor(currentLevel: number | null) {
  const run = vi.fn(() => true);
  const chain: FakeChain = {
    focus: () => chain,
    setParagraph: vi.fn(() => chain) as unknown as () => FakeChain,
    setNode: vi.fn(() => chain) as unknown as (name: string, attrs: unknown) => FakeChain,
    run,
  };
  const editor = {
    isEditable: true,
    isActive: (name: string, attrs?: { level?: number }) => {
      if (name !== "heading") return false;
      if (attrs && typeof attrs.level === "number") return currentLevel === attrs.level;
      return currentLevel !== null; // isActive("heading")
    },
    chain: () => chain,
    view: { state: { selection: { head: 1 }, doc: {} } },
  } as unknown as Editor;
  return { editor, chain, run };
}

function blockButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll('[role="menu"] button[role="menuitemcheckbox"]'),
  ) as HTMLButtonElement[];
}
function blockButtonByLabel(label: string): HTMLButtonElement | undefined {
  return blockButtons().find((b) => (b.textContent ?? "").includes(label));
}
function blockTrigger(): HTMLButtonElement {
  // The trigger is the button NOT inside the [role=menu] container.
  return Array.from(document.querySelectorAll("button")).find(
    (b) => !b.closest('[role="menu"]'),
  ) as HTMLButtonElement;
}
function activeBlockButton(): HTMLButtonElement | undefined {
  return blockButtons().find((b) => b.getAttribute("data-active") === "");
}
function labelOf(b: HTMLButtonElement | undefined): string {
  return (b?.textContent ?? "").replace("✓", "").trim();
}

describe("BlockTypeDropdown — docked render + click selection", () => {
  it("renders docked (inline, not portaled to body's end) once opened", () => {
    const { editor } = makeEditor(2);
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    // Docked: the menu lives inside the component's own relative wrapper, which
    // is inside the rendered container — NOT a direct child of <body>.
    expect(container.contains(menu)).toBe(true);
  });

  it("renders all 8 block types with the current level marked", () => {
    const { editor } = makeEditor(2); // Section
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    expect(blockButtons()).toHaveLength(8);
    const section = blockButtonByLabel("Section")!;
    expect(section.getAttribute("aria-checked")).toBe("true");
    expect(section.hasAttribute("data-current")).toBe(true);
    expect(section.textContent).toContain("✓");
    const body = blockButtonByLabel("Body text")!;
    expect(body.getAttribute("aria-checked")).toBe("false");
    expect(body.hasAttribute("data-current")).toBe(false);
  });

  it("clicking 'Body text' calls setParagraph + closes", () => {
    const { editor, chain } = makeEditor(2); // currently a heading
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(blockButtonByLabel("Body text")!);
    expect(chain.setParagraph).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeNull(); // closed
  });

  it("clicking 'Part' (an out-of-scope level) sets the heading node directly", () => {
    const { editor, chain } = makeEditor(null); // paragraph
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(blockButtonByLabel("Part")!);
    expect(chain.setNode).toHaveBeenCalledWith("heading", { level: 0, numbered: true });
  });

  it("a read-only editor makes the pick inert (no chain call)", () => {
    const { editor, chain } = makeEditor(2);
    (editor as unknown as { isEditable: boolean }).isEditable = false;
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(blockButtonByLabel("Body text")!);
    expect(chain.setParagraph).not.toHaveBeenCalled();
  });
});

describe("BlockTypeDropdown — NEW keyboard navigation", () => {
  it("Down/Up move a visible data-active highlight; Enter activates it", () => {
    const { editor, chain } = makeEditor(null);
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);

    key("ArrowDown"); // first enabled → Body text
    expect(labelOf(activeBlockButton())).toBe("Body text");
    key("ArrowDown");
    expect(labelOf(activeBlockButton())).toBe("Part");
    key("ArrowUp");
    expect(labelOf(activeBlockButton())).toBe("Body text");

    // Enter on Body text — editor is a paragraph so setParagraph is NOT called
    // (the 'Body' branch only runs when a heading is active), but the menu closes.
    key("Enter");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(chain.setParagraph).not.toHaveBeenCalled();
  });

  it("End jumps to the last row (Subparagraph heading), Home back to the first", () => {
    const { editor } = makeEditor(null);
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    key("End");
    expect(labelOf(activeBlockButton())).toBe("Subparagraph heading");
    key("Home");
    expect(labelOf(activeBlockButton())).toBe("Body text");
  });

  it("Escape closes the dropdown", () => {
    const { editor } = makeEditor(2);
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    key("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("click outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const { editor } = makeEditor(2);
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    vi.useRealTimers();
    void blockTrigger; // referenced to keep the helper exercised
  });
});

// ── ViewMenu (the expandable tree) ────────────────────────────────────────────

type ViewMenuProps = Parameters<typeof ViewMenu>[0];

/** Build ViewMenu props with all callbacks as spies. Pass overrides to control
 *  the checked/expanded-reflecting state values. */
function makeViewProps(overrides: Partial<ViewMenuProps> = {}): ViewMenuProps {
  return {
    showParTitles: false,
    onToggleParTitles: vi.fn(),
    showLatexComments: false,
    onToggleLatexComments: vi.fn(),
    showHeadingLabels: false,
    onToggleHeadingLabels: vi.fn(),
    omniDimResting: false,
    onToggleOmniDimResting: vi.fn(),
    onOpenPreferences: vi.fn(),
    showMarginalia: true,
    onToggleMarginalia: vi.fn(),
    hiddenMarginaliaTypes: new Set(),
    onToggleMarginaliaType: vi.fn(),
    showHighlights: true,
    onToggleHighlights: vi.fn(),
    hiddenHighlightTypes: new Set(),
    onToggleHighlightType: vi.fn(),
    availableDividerLevels: new Set<DividerLevel>([1, 2, 3]),
    dividerLevels: new Set<DividerLevel>([2]),
    onToggleDividerLevel: vi.fn(),
    dividerWidth: "full",
    onSetDividerWidth: vi.fn(),
    orientation: "horizontal",
    onSetOrientation: vi.fn(),
    onCloseAllPanels: vi.fn(),
    onOpenFontsDialog: vi.fn(),
    onOpenMarginsMode: vi.fn(),
    ...overrides,
  } as ViewMenuProps;
}

function openViewMenu(props: ViewMenuProps) {
  const utils = render(<ViewMenu {...props} />);
  fireEvent.click(utils.container.querySelector("button")!);
  return utils;
}

function viewRows(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll('[role="menu"] button'),
  ).filter((b) => !b.closest("button button")) as HTMLButtonElement[];
}
function viewRowByLabel(label: string): HTMLButtonElement | undefined {
  return viewRows().find((b) => (b.querySelector("span")?.textContent ?? "") === label);
}
function checkedOf(b: HTMLButtonElement | undefined): boolean {
  return b?.getAttribute("aria-checked") === "true";
}
function expandedOf(b: HTMLButtonElement | undefined): boolean {
  return b?.getAttribute("aria-expanded") === "true";
}
function activeViewRow(): HTMLButtonElement | undefined {
  return viewRows().find((b) => b.getAttribute("data-active") === "");
}

describe("ViewMenu — checkbox rows (toggle + close/keep-open split)", () => {
  it("Display rows are menuitemcheckbox with aria-checked; toggling closes the menu", () => {
    const props = makeViewProps({ showParTitles: true });
    const { container } = openViewMenu(props);
    const par = viewRowByLabel("Paragraph titles")!;
    expect(par.getAttribute("role")).toBe("menuitemcheckbox");
    expect(checkedOf(par)).toBe(true);
    fireEvent.click(par);
    expect(props.onToggleParTitles).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="menu"]')).toBeNull(); // closed
  });

  it("an in-group sub-toggle toggles WITHOUT closing the menu", () => {
    const props = makeViewProps();
    openViewMenu(props);
    fireEvent.click(viewRowByLabel("Marginalia")!); // expand
    const showMarg = viewRowByLabel("Show marginalia")!;
    fireEvent.click(showMarg);
    expect(props.onToggleMarginalia).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="menu"]')).toBeTruthy(); // STILL open
  });
});

describe("ViewMenu — expandable groups (click + Enter; snapshot grows/shrinks)", () => {
  it("a group row is aria-expanded; clicking it reveals its children", () => {
    const props = makeViewProps();
    openViewMenu(props);
    const group = viewRowByLabel("Marginalia")!;
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(viewRowByLabel("Show marginalia")).toBeUndefined(); // collapsed
    fireEvent.click(group);
    expect(expandedOf(viewRowByLabel("Marginalia"))).toBe(true);
    // Children now registered + rendered: Show marginalia + the 3 type rows.
    expect(viewRowByLabel("Show marginalia")).toBeDefined();
    expect(viewRowByLabel("Notes")).toBeDefined();
    expect(viewRowByLabel("Archive")).toBeDefined();
    expect(viewRowByLabel("Todo")).toBeDefined();
  });

  it("Enter on the active group row expands it (keyboard expand)", () => {
    const props = makeViewProps();
    openViewMenu(props);
    // Walk Down to the Marginalia group row, then Enter to expand.
    let guard = 0;
    while (labelText(activeViewRow()) !== "Marginalia" && guard++ < 20) key("ArrowDown");
    expect(labelText(activeViewRow())).toBe("Marginalia");
    key("Enter");
    expect(expandedOf(viewRowByLabel("Marginalia"))).toBe(true);
    expect(viewRowByLabel("Show marginalia")).toBeDefined();
  });

  it("Right expands / Left collapses the active group row (tree affordance, cursor stays put)", () => {
    const props = makeViewProps();
    openViewMenu(props);
    let guard = 0;
    while (labelText(activeViewRow()) !== "Marginalia" && guard++ < 20) key("ArrowDown");
    expect(labelText(activeViewRow())).toBe("Marginalia");
    expect(expandedOf(viewRowByLabel("Marginalia"))).toBe(false);

    key("ArrowRight"); // expand — does NOT move the cursor
    expect(expandedOf(viewRowByLabel("Marginalia"))).toBe(true);
    expect(viewRowByLabel("Show marginalia")).toBeDefined();
    expect(labelText(activeViewRow())).toBe("Marginalia");

    key("ArrowLeft"); // collapse
    expect(expandedOf(viewRowByLabel("Marginalia"))).toBe(false);
    expect(viewRowByLabel("Show marginalia")).toBeUndefined();

    // Right on an already-expanded group is a no-op; Left on a collapsed one too.
    key("ArrowLeft");
    expect(expandedOf(viewRowByLabel("Marginalia"))).toBe(false);
  });

  it("collapsing a group removes its children from the snapshot", () => {
    const props = makeViewProps();
    openViewMenu(props);
    fireEvent.click(viewRowByLabel("Marginalia")!); // expand
    expect(viewRowByLabel("Notes")).toBeDefined();
    fireEvent.click(viewRowByLabel("Marginalia")!); // collapse
    expect(viewRowByLabel("Notes")).toBeUndefined();
    expect(expandedOf(viewRowByLabel("Marginalia"))).toBe(false);
  });

  it("a nested group (Divider preferences) expands inside the Dividers group", () => {
    const props = makeViewProps();
    openViewMenu(props);
    fireEvent.click(viewRowByLabel("Show dividers for…")!);
    // Per-level rows now visible (Chapters/Sections/Subsections for levels 1/2/3).
    expect(viewRowByLabel("Sections")).toBeDefined();
    const prefs = viewRowByLabel("Divider preferences")!;
    expect(prefs.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(prefs);
    expect(viewRowByLabel("Full width")).toBeDefined();
    expect(viewRowByLabel("Mid width")).toBeDefined();
  });
});

function labelText(b: HTMLButtonElement | undefined): string {
  return b?.querySelector("span")?.textContent ?? "";
}

describe("ViewMenu — arrow nav over the (dynamic) visible set", () => {
  it("Down steps the visible rows; newly-expanded children are reachable", () => {
    const props = makeViewProps();
    openViewMenu(props);
    key("ArrowDown"); // first enabled → Paragraph titles
    expect(labelText(activeViewRow())).toBe("Paragraph titles");
    // Expand Marginalia (click), then verify a child is reachable by arrowing.
    fireEvent.click(viewRowByLabel("Marginalia")!);
    let guard = 0;
    while (labelText(activeViewRow()) !== "Show marginalia" && guard++ < 30) key("ArrowDown");
    expect(labelText(activeViewRow())).toBe("Show marginalia");
  });

  it("Home/End jump to the first/last visible row", () => {
    const props = makeViewProps();
    openViewMenu(props);
    key("Home");
    expect(labelText(activeViewRow())).toBe("Paragraph titles");
    key("End");
    expect(labelText(activeViewRow())).toBe("Close all panels");
  });
});

describe("ViewMenu — Escape + click-outside", () => {
  it("Escape closes", () => {
    const props = makeViewProps();
    const { container } = openViewMenu(props);
    expect(container.querySelector('[role="menu"]')).toBeTruthy();
    key("Escape");
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("click outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const props = makeViewProps();
    const { container } = openViewMenu(props);
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    vi.useRealTimers();
  });

  it("the dividers group is suppressed when no divider levels are available", () => {
    const props = makeViewProps({ availableDividerLevels: new Set<DividerLevel>() });
    openViewMenu(props);
    expect(viewRowByLabel("Show dividers for…")).toBeUndefined();
  });
});
