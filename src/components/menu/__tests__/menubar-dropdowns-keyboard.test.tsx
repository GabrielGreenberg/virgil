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
import { REGISTRY_DEFAULTS, type RegistryPrefs } from "@/lib/view-prefs/registry";

// Task 153: the dropdown's out-of-scope levels (0/5/6) now gate their direct
// `setNode` on `posHostsBlockInsert`. These tests drive a STUB editor (no real
// doc) whose fixtures are ordinary prose (paragraph / heading) that legitimately
// hosts a heading conversion — so stub the predicate `true`. The gate's OWN
// correctness (a titleField/codeBlock/latexComment caret is a no-op) is covered
// end-to-end in heading-convert-container-gate.test.ts against the real schema.
vi.mock("@/text-objects/text-object-registry", async (importActual) => ({
  ...(await importActual<typeof import("@/text-objects/text-object-registry")>()),
  posHostsBlockInsert: () => true,
}));

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
  // Task 658: the out-of-scope levels (0/5/6) no longer call `setNode` with a
  // literal attr object (which rebuilt the heading from defaults, dropping the
  // user's `\label`, `[short]` title, `numbered` and uuid). They route through
  // `setHeadingLevelInRange` inside a `.command()`, the SAME door the registry's
  // `headingRun` takes — so the stub grows the one link it was missing.
  command: (fn: (props: FakeCommandProps) => boolean) => FakeChain;
  run: () => boolean;
}

/** Just enough of TipTap's CommandProps for the heading pick's callback. */
interface FakeCommandProps {
  tr: { selection: { from: number; to: number }; setBlockType: (...a: unknown[]) => unknown };
  dispatch: (() => void) | undefined;
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
    command: vi.fn((fn: (props: FakeCommandProps) => boolean) => {
      fn(commandProps);
      return chain;
    }) as unknown as (fn: (props: FakeCommandProps) => boolean) => FakeChain,
    run,
  };
  const setBlockType = vi.fn();
  const commandProps: FakeCommandProps = {
    tr: { selection: { from: 1, to: 1 }, setBlockType },
    dispatch: () => {},
  };
  const headingType = { name: "heading" };
  const editor = {
    isEditable: true,
    schema: { nodes: { heading: headingType } },
    isActive: (name: string, attrs?: { level?: number }) => {
      if (name !== "heading") return false;
      if (attrs && typeof attrs.level === "number") return currentLevel === attrs.level;
      return currentLevel !== null; // isActive("heading")
    },
    chain: () => chain,
    // `editable` on the VIEW, because that is where a real TipTap editor
    // keeps it and where the surface-editability door reads it (task 733).
    view: { editable: true, state: { selection: { head: 1 }, doc: {} } },
  } as unknown as Editor;
  return { editor, chain, run, setBlockType, headingType };
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

  it("clicking 'Part' (an out-of-scope level) sets the level through the ONE door", () => {
    // Task 658. The pick used to be `setNode("heading", { level, numbered: true })`
    // — a LITERAL attr object, i.e. "rebuild this heading from scratch", which
    // silently deleted an existing heading's `\label`, its `\section[short]`
    // title and its uuid and forced a `\section*` numbered. It now goes through
    // `setHeadingLevelInRange`, whose attrs argument is a FUNCTION asked once
    // per node — so the same pick is a conversion for a paragraph and a
    // level-only change for a heading. Preservation end-to-end over the real
    // schema is heading-level-attr-preservation.test.ts; what belongs HERE is
    // that the dropdown's out-of-scope half reaches that door at all.
    const { editor, chain, setBlockType, headingType } = makeEditor(null); // paragraph
    const { container } = render(<BlockTypeDropdown editor={editor} />);
    fireEvent.click(container.querySelector("button")!);
    fireEvent.click(blockButtonByLabel("Part")!);

    expect(chain.setNode).not.toHaveBeenCalled();
    expect(chain.command).toHaveBeenCalledTimes(1);
    expect(setBlockType).toHaveBeenCalledTimes(1);
    const [from, to, type, attrs] = setBlockType.mock.calls[0] as [
      number, number, unknown, (n: unknown) => Record<string, unknown>,
    ];
    expect(from).toBe(1);
    expect(to).toBe(1);
    expect(type).toBe(headingType);
    // A FUNCTION, not a literal — that is the whole of the fix at this seam.
    expect(typeof attrs).toBe("function");
    const existingHeading = {
      type: headingType,
      attrs: { level: 2, label: "sec:x", numbered: false, uuid: "H1", shortTitle: "S" },
    };
    expect(attrs(existingHeading)).toEqual({
      level: 0, label: "sec:x", numbered: false, uuid: "H1", shortTitle: "S",
    });
    expect(attrs({ type: { name: "paragraph" }, attrs: {} })).toEqual({
      level: 0, numbered: true,
    });
  });

  it("a read-only editor makes the pick inert (no chain call)", () => {
    const { editor, chain } = makeEditor(2);
    (editor as unknown as { isEditable: boolean }).isEditable = false;
    (editor.view as unknown as { editable: boolean }).editable = false;
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

/** Build ViewMenu props with the three registry writers as spies (task 274 —
 *  the menu takes ONE values object keyed by registry key plus those writers,
 *  not a per-pref prop pair). `prefs` overrides layer onto the real
 *  `REGISTRY_DEFAULTS`, so a new pref needs no edit here either. */
function makeViewProps(
  prefs: Partial<RegistryPrefs> = {},
  overrides: Partial<ViewMenuProps> = {},
): ViewMenuProps {
  return {
    viewPrefs: {
      ...REGISTRY_DEFAULTS,
      showParTitles: false,
      showCardTitles: false,
      showLatexComments: false,
      showHeadingLabels: false,
      omniDimResting: false,
      cardOutlineChrome: false,
      showMarginalia: true,
      hiddenMarginaliaTypes: [],
      showHighlights: true,
      hiddenHighlightTypes: [],
      dividerLevels: [2],
      dividerWidth: "full",
      ...prefs,
    },
    availableDividerLevels: new Set<DividerLevel>([1, 2, 3]),
    onToggleViewPref: vi.fn(),
    onSetViewPref: vi.fn(),
    onToggleViewPrefMember: vi.fn(),
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
    // The write travels BY KEY through the one registry-driven toggler.
    expect(props.onToggleViewPref).toHaveBeenCalledTimes(1);
    expect(props.onToggleViewPref).toHaveBeenCalledWith("showParTitles");
    expect(container.querySelector('[role="menu"]')).toBeNull(); // closed
  });

  it("an in-group sub-toggle toggles WITHOUT closing the menu", () => {
    const props = makeViewProps();
    openViewMenu(props);
    fireEvent.click(viewRowByLabel("Marginalia")!); // expand
    const showMarg = viewRowByLabel("Show marginalia")!;
    fireEvent.click(showMarg);
    expect(props.onToggleViewPref).toHaveBeenCalledWith("showMarginalia");
    expect(document.querySelector('[role="menu"]')).toBeTruthy(); // STILL open
  });

  it("a per-type sub-row toggles that SET's member; a width row SETs the enum", () => {
    const props = makeViewProps();
    openViewMenu(props);
    fireEvent.click(viewRowByLabel("Marginalia")!); // expand
    fireEvent.click(viewRowByLabel("Notes")!);
    expect(props.onToggleViewPrefMember).toHaveBeenCalledWith(
      "hiddenMarginaliaTypes",
      "note",
    );
    fireEvent.click(viewRowByLabel("Show dividers for…")!); // expand
    fireEvent.click(viewRowByLabel("Sections")!);
    expect(props.onToggleViewPrefMember).toHaveBeenCalledWith("dividerLevels", 2);
    fireEvent.click(viewRowByLabel("Divider preferences")!); // expand
    fireEvent.click(viewRowByLabel("Mid width")!);
    expect(props.onSetViewPref).toHaveBeenCalledWith("dividerWidth", "mid");
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

  it("ArrowDown after an expand lands on the group's FIRST CHILD — nav order is visual order (task 745)", () => {
    const props = makeViewProps();
    openViewMenu(props);
    let guard = 0;
    while (labelText(activeViewRow()) !== "Marginalia" && guard++ < 20) key("ArrowDown");
    expect(labelText(activeViewRow())).toBe("Marginalia");
    key("ArrowRight"); // expand — children mount while the menu is open
    expect(viewRowByLabel("Show marginalia")).toBeDefined();
    // The children register AFTER every other row; nav must still step to the
    // row drawn directly beneath the group, not to the next group.
    key("ArrowDown");
    expect(labelText(activeViewRow())).toBe("Show marginalia");
    // And back up returns to the group row.
    key("ArrowUp");
    expect(labelText(activeViewRow())).toBe("Marginalia");
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
    const props = makeViewProps({}, { availableDividerLevels: new Set<DividerLevel>() });
    openViewMenu(props);
    expect(viewRowByLabel("Show dividers for…")).toBeUndefined();
  });
});
