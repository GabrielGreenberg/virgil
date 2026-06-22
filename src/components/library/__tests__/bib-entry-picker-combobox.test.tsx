// @vitest-environment jsdom
//
// BibEntryPickerMenu on the <Menu> primitive's COMBOBOX path (Phase C):
// behavior PARITY + the new combobox/listbox ARIA + the `onArrowHorizontal`
// Left/Right expand-collapse + external-input mode + the maxHeight passthrough.
// Drives the REAL component through the full primitive stack (MenuProvider
// layout="combobox" role="listbox" + useMenuCombobox + useMenuItem +
// useMenuKeyboard), mirroring label-ref-combobox.test.tsx +
// combobox-arrow-horizontal.test.tsx. Covers the DoD matrix:
//
//   - combobox nav over a FILTERED list (typing narrows; arrows move the
//     highlight; the highlight re-seeds to the first row on a filter
//     keystroke);
//   - the input is the keyboard SOURCE + focus STAYS in the input (arrows
//     never move DOM focus to an option; aria-activedescendant tracks);
//   - listbox / option ARIA (input role=combobox aria-expanded aria-controls
//     aria-activedescendant; container role=listbox#id; rows role=option
//     aria-selected);
//   - ArrowLeft/Right = expand/collapse the active row's detail (the
//     `onArrowHorizontal` seam), with the caret never moving;
//   - external-input mode (caller owns the input; the picker omits its own +
//     bridges the keydown; the external input is a dismiss exemption);
//   - the maxHeight clamp passthrough (the container scrolls instead of
//     overflowing the viewport);
//   - parity: filter, Enter picks the active entry OR commits raw text,
//     Escape closes, click-outside, click picks.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import {
  BibEntryPickerMenu,
  type BibEntryPickerMenuProps,
} from "../BibEntryPickerMenu";
import type { BibEntry } from "@/lib/types";

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
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function entry(key: string, author: string, title: string): BibEntry {
  return {
    uid: `uid-${key}`,
    key,
    type: "article",
    fields: { author, title, year: "2020" },
    raw: "",
  };
}

// Distinctive enough that the fuzzy searcher narrows unambiguously.
const ENTRIES: BibEntry[] = [
  entry("burge1977", "Tyler Burge", "Belief De Re"),
  entry("kripke1980", "Saul Kripke", "Naming and Necessity"),
  entry("lewis1986", "David Lewis", "On the Plurality of Worlds"),
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

function setup(extra?: Partial<BibEntryPickerMenuProps>) {
  const onPick = vi.fn(async () => "added" as const);
  const onClose = vi.fn();
  const onCommitRaw = vi.fn();
  render(
    <BibEntryPickerMenu
      open
      anchorRect={ANCHOR}
      entries={ENTRIES}
      onPick={onPick}
      onCommitRaw={onCommitRaw}
      onClose={onClose}
      placeholder="Search…"
      ariaLabel="Search entries"
      {...extra}
    />,
  );
  const input =
    (screen.queryByPlaceholderText("Search…") as HTMLInputElement | null) ??
    null;
  return { input, onPick, onClose, onCommitRaw };
}

function options(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('[role="listbox"] [role="option"]'),
  ) as HTMLElement[];
}
function activeOption(): HTMLElement | undefined {
  return options().find((o) => o.getAttribute("data-active") === "");
}
function keyOf(o: HTMLElement | undefined): string {
  // The citekey is the only place the entry's identity surfaces unambiguously:
  // the collapsed row shows authors + year, but the registered option id is
  // `bib-entry-picker-item-opt:<key>`.
  return o?.id.replace("bib-entry-picker-item-opt:", "") ?? "";
}
/** Whether an expanded row's "citekey:" detail label is rendered anywhere. */
function hasExpandedDetail(): boolean {
  return Array.from(document.querySelectorAll("span")).some(
    (s) => s.textContent === "citekey:",
  );
}
/** Flush queued microtasks (e.g. the positioner's queueMicrotask reposition). */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BibEntryPickerMenu combobox — listbox / combobox ARIA (§3.5)", () => {
  it("the input is a combobox owning the listbox; rows are options", () => {
    const { input } = setup();
    expect(input).not.toBeNull();
    expect(input!.getAttribute("role")).toBe("combobox");
    expect(input!.getAttribute("aria-autocomplete")).toBe("list");
    expect(input!.getAttribute("aria-expanded")).toBe("true");

    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox).not.toBeNull();
    expect(listbox.id).toBe("bib-entry-picker-listbox");
    expect(input!.getAttribute("aria-controls")).toBe(listbox.id);

    const opts = options();
    expect(opts.length).toBe(ENTRIES.length);
    expect(opts.every((o) => o.getAttribute("aria-selected") != null)).toBe(
      true,
    );
  });

  it("aria-expanded is false when the dropdown is collapsed (no matches)", () => {
    const { input } = setup();
    fireEvent.change(input!, { target: { value: "zzqqnomatch" } });
    expect(input!.getAttribute("aria-expanded")).toBe("false");
    expect(options()).toHaveLength(0);
  });

  it("the first option is highlighted by default (old selectedIndex=0)", () => {
    setup();
    expect(keyOf(activeOption())).toBe("burge1977");
  });
});

describe("BibEntryPickerMenu combobox — nav over a filtered list", () => {
  it("typing narrows the option set (fuzzy)", () => {
    const { input } = setup();
    expect(options()).toHaveLength(3);
    fireEvent.change(input!, { target: { value: "kripke" } });
    expect(options().map((o) => keyOf(o))).toEqual(["kripke1980"]);
  });

  it("ArrowDown moves the highlight + sets aria-selected; Enter commits it", () => {
    const { input, onPick } = setup();
    // Default highlight is the first row; ArrowDown → second.
    fireEvent.keyDown(input!, { key: "ArrowDown" });
    expect(keyOf(activeOption())).toBe("kripke1980");
    expect(activeOption()!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "kripke1980" }),
    );
  });

  it("arrows operate over the FILTERED list, not the full one", () => {
    const { input, onPick } = setup();
    fireEvent.change(input!, { target: { value: "lewis" } }); // only lewis1986
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "lewis1986" }),
    );
  });

  it("a filter keystroke re-seeds the highlight to the new first row", () => {
    const { input, onPick } = setup();
    fireEvent.keyDown(input!, { key: "ArrowDown" }); // highlight kripke1980
    expect(keyOf(activeOption())).toBe("kripke1980");
    fireEvent.change(input!, { target: { value: "lewis" } }); // re-seed → lewis
    expect(keyOf(activeOption())).toBe("lewis1986");
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "lewis1986" }),
    );
  });

  it("Home / End jump to the first / last option (controller-provided)", () => {
    const { input } = setup();
    fireEvent.keyDown(input!, { key: "End" });
    expect(keyOf(activeOption())).toBe("lewis1986");
    fireEvent.keyDown(input!, { key: "Home" });
    expect(keyOf(activeOption())).toBe("burge1977");
  });
});

describe("BibEntryPickerMenu combobox — ArrowDown steps VISUAL order under a fuzzy re-rank (regression)", () => {
  // The reported bug: typing re-ranks the rows by fuzzy score; ArrowDown then
  // SKIPPED whole swaths of rows. Root cause: the rows are key-stable
  // (key={entry.key}), so a re-rank reorders the DOM WITHOUT remount and the
  // registry's nav order stayed frozen at insertion order. The fix republishes
  // each row's live visual index (useMenuItem `order`). These entries are
  // crafted so the "realism" query re-ranks them into a DIFFERENT visual order
  // than insertion order (the exact-match "realism" title sorts above "zzz
  // realism core"), exercising the divergence.
  const RERANK: BibEntry[] = [
    entry("k0", "Zed Zeta", "zzz realism core"),
    entry("k1", "Ann Alpha", "realism"),
    entry("k2", "Bea Beta", "mid realism text"),
    entry("k3", "Cy Gamma", "realism appears here too somewhat"),
    entry("k4", "Del Delta", "another realism mention buried deep in a very long title"),
  ];

  function setupRerank() {
    render(
      <BibEntryPickerMenu
        open
        anchorRect={ANCHOR}
        entries={RERANK}
        onPick={vi.fn(async () => "added" as const)}
        onCommitRaw={vi.fn()}
        onClose={vi.fn()}
        placeholder="Search…"
        ariaLabel="Search entries"
      />,
    );
    const input = screen.getByPlaceholderText("Search…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "realism" } });
    return input;
  }

  it("the fuzzy query reorders the rows away from insertion order (guards vacuity)", () => {
    setupRerank();
    const domOrder = options().map(keyOf);
    expect(domOrder.length).toBeGreaterThan(2);
    const insertionOrder = RERANK.map((e) => e.key).filter((k) =>
      domOrder.includes(k),
    );
    // If this ever stops diverging, the test below would pass vacuously — fail
    // loudly here instead so the fixture is fixed rather than the guard silently lost.
    expect(domOrder).not.toEqual(insertionOrder);
  });

  it("ArrowDown visits each rendered row top-to-bottom with no skips; ArrowUp reverses", () => {
    const input = setupRerank();
    const domOrder = options().map(keyOf);

    // Default highlight is the FIRST visual row.
    expect(keyOf(activeOption())).toBe(domOrder[0]);

    // Each ArrowDown advances to the next VISUAL row — never a skip.
    for (let i = 1; i < domOrder.length; i++) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(keyOf(activeOption())).toBe(domOrder[i]);
    }
    // ArrowUp walks back up the same visual order.
    for (let i = domOrder.length - 2; i >= 0; i--) {
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(keyOf(activeOption())).toBe(domOrder[i]);
    }
  });
});

describe("BibEntryPickerMenu combobox — input is the keyboard source (no focus theft)", () => {
  it("arrows keep DOM focus in the input; aria-activedescendant tracks the option", () => {
    const { input } = setup();
    input!.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input!, { key: "ArrowDown" });
    const active = activeOption();
    expect(active).toBeDefined();
    expect(document.activeElement).toBe(input);
    expect(input!.getAttribute("aria-activedescendant")).toBe(active!.id);
    expect(active!.id).toBe("bib-entry-picker-item-opt:kripke1980");
  });
});

describe("BibEntryPickerMenu combobox — onArrowHorizontal expand/collapse (§4)", () => {
  it("ArrowRight expands the active row's detail; ArrowLeft collapses it", () => {
    const { input } = setup();
    // Default-active row is burge1977. No row is expanded yet.
    expect(keyOf(activeOption())).toBe("burge1977");
    expect(hasExpandedDetail()).toBe(false);

    // ArrowRight → expand. The expanded detail renders the citekey row.
    const ev = fireEvent.keyDown(input!, { key: "ArrowRight" });
    expect(ev).toBe(false); // preventDefault was called (caret never moves)
    expect(hasExpandedDetail()).toBe(true);
    // The active highlight did NOT move (Left/Right are not nav).
    expect(keyOf(activeOption())).toBe("burge1977");

    // ArrowLeft → collapse.
    fireEvent.keyDown(input!, { key: "ArrowLeft" });
    expect(hasExpandedDetail()).toBe(false);
    expect(keyOf(activeOption())).toBe("burge1977");
  });

  it("Left/Right expand-collapse follows the active row as it moves", () => {
    const { input } = setup();
    fireEvent.keyDown(input!, { key: "ArrowDown" }); // active → kripke1980
    fireEvent.keyDown(input!, { key: "ArrowRight" }); // expand kripke1980
    // The kripke row is the expanded one — its citekey shows in the detail.
    expect(hasExpandedDetail()).toBe(true);
    const expandedRow = activeOption();
    expect(keyOf(expandedRow)).toBe("kripke1980");
    expect(expandedRow!.textContent).toContain("kripke1980");
  });
});

describe("BibEntryPickerMenu combobox — external-input mode", () => {
  function setupExternal(query: string) {
    const onPick = vi.fn(async () => "added" as const);
    const onClose = vi.fn();
    const onCommitRaw = vi.fn();
    // The caller owns the input. It lives OUTSIDE the picker portal.
    const externalInput = document.createElement("input");
    externalInput.setAttribute("data-testid", "external-input");
    document.body.appendChild(externalInput);
    const { rerender } = render(
      <BibEntryPickerMenu
        open
        anchorRect={ANCHOR}
        entries={ENTRIES}
        onPick={onPick}
        onCommitRaw={onCommitRaw}
        onClose={onClose}
        externalQuery={query}
        externalInputEl={externalInput}
      />,
    );
    return { externalInput, onPick, onClose, onCommitRaw, rerender };
  }

  it("omits its own input and reads the query from externalQuery", () => {
    const { externalInput } = setupExternal("kripke");
    // No internal search input rendered (placeholder absent).
    expect(screen.queryByPlaceholderText("Search…")).toBeNull();
    // The list is filtered by the external query.
    expect(options().map((o) => keyOf(o))).toEqual(["kripke1980"]);
    expect(document.body.contains(externalInput)).toBe(true);
  });

  it("forwards keydown from the external input: ArrowDown + Enter picks", () => {
    const { externalInput, onPick } = setupExternal("");
    // All three rows; default highlight is the first. Arrow on the EXTERNAL
    // input drives the picker's roving cursor via the keydown bridge.
    fireEvent.keyDown(externalInput, { key: "ArrowDown" }); // → kripke1980
    expect(keyOf(activeOption())).toBe("kripke1980");
    fireEvent.keyDown(externalInput, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "kripke1980" }),
    );
  });

  it("Enter on the external input with no matches commits the raw query", () => {
    const { externalInput, onCommitRaw } = setupExternal("brandnewkey");
    expect(options()).toHaveLength(0);
    fireEvent.keyDown(externalInput, { key: "Enter" });
    expect(onCommitRaw).toHaveBeenCalledWith("brandnewkey");
  });

  it("ArrowRight on the external input expands the active row (onArrowHorizontal)", () => {
    const { externalInput } = setupExternal("");
    fireEvent.keyDown(externalInput, { key: "ArrowRight" });
    expect(hasExpandedDetail()).toBe(true);
  });

  it("the external input is a dismiss exemption — clicking it does NOT close", () => {
    vi.useFakeTimers();
    const { externalInput, onClose } = setupExternal("");
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      externalInput.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("BibEntryPickerMenu combobox — maxHeight passthrough (§3.3)", () => {
  it("the container carries a maxHeight clamp + overflowY:auto so a tall list scrolls", async () => {
    // A short viewport so the clamp is a finite, small number.
    const origHeight = window.innerHeight;
    const origWidth = window.innerWidth;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    try {
      setup();
      // The positioner defers its first measurement to a microtask; flush it so
      // the maxHeight clamp lands as an inline style on the positioned container.
      await flush();
      const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
      // `maxHeight` on the provider → useFloatingMenuPosition computes a clamp
      // (overflowY:auto + a finite maxHeight) for the chosen below-placement.
      expect(listbox.style.overflowY).toBe("auto");
      const mh = parseFloat(listbox.style.maxHeight);
      expect(Number.isFinite(mh)).toBe(true);
      // Anchor bottom 120, gap 4, margin 8, vh 240 → ~108px of room below.
      expect(mh).toBeGreaterThan(0);
      expect(mh).toBeLessThan(240);
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: origHeight,
      });
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: origWidth,
      });
    }
  });
});

describe("BibEntryPickerMenu combobox — parity (commit / click / escape / dismiss)", () => {
  it("Enter with the default highlight picks the first row", () => {
    const { input, onPick } = setup();
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "burge1977" }),
    );
  });

  it("Enter with no matches commits the raw query via onCommitRaw", () => {
    const { input, onCommitRaw } = setup();
    fireEvent.change(input!, { target: { value: "freshkey" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    expect(onCommitRaw).toHaveBeenCalledWith("freshkey");
  });

  it("clicking an option picks it", () => {
    const { onPick } = setup();
    const kripke = options().find((o) => keyOf(o) === "kripke1980")!;
    fireEvent.click(kripke);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "kripke1980" }),
    );
  });

  it("Escape on the input closes the picker", () => {
    const { input, onClose } = setup();
    fireEvent.keyDown(input!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click-outside dismisses (after the deferred mount)", () => {
    vi.useFakeTimers();
    const { onClose } = setup();
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("the search input auto-focuses on open (internal-input mode)", () => {
    const { input } = setup();
    expect(document.activeElement).toBe(input);
  });

  it("open=false renders nothing", () => {
    const { container } = render(
      <BibEntryPickerMenu
        open={false}
        anchorRect={ANCHOR}
        entries={ENTRIES}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
