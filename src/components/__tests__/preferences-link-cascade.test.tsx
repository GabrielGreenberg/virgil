// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import type { EditorPreferences } from "@/hooks/usePreferences";

// Something in the dialog's import graph reaches `@/lib/storage`, whose backend
// is picked with a bare `require` vitest can't resolve (the known barrel gotcha)
// — stub it wholesale; nothing here calls a storage fn.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

/**
 * The locked-link cascade belongs to the WRITER, not to a call site (task 625).
 *
 * `tabBg` tracks `topbarBackground` and `libraryBg` tracks `backgroundColor`, each
 * by a lightness delta, and the links ship LOCKED. But the cascade used to be a
 * wrapper (`useLinkAwareUpdater`) that one section of the preferences dialog
 * applied and the rest didn't — so "Virgil bar background" in the Smart section
 * moved the linked shades, while "Top bar background" in the "All preferences"
 * tree a few inches lower wrote the same key and left them behind. One
 * preference, two behaviours, chosen by which control the user happened to
 * reach for.
 *
 * The contract pinned here: every door of the dialog produces the SAME prefs
 * for the same edit, an unlocked link is still inert, and editing a child still
 * leaves its link alone.
 */

// Deterministic in-memory localStorage — the ambient one in this runner is
// Node's experimental Web Storage and lacks a usable `clear`.
function installLocalStorage() {
  const m = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); },
      clear: () => { m.clear(); },
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => { installLocalStorage(); vi.resetModules(); });

/** Mount the real dialog over the real prefs store; `read()` is the live prefs. */
async function mountDialog() {
  const prefsMod = await import("@/hooks/usePreferences");
  const linksMod = await import("@/hooks/usePrefLinks");
  const { default: PreferencesModal } = await import("@/components/PreferencesModal");

  let live: EditorPreferences | null = null;
  let hook: ReturnType<typeof prefsMod.usePreferences> | null = null;
  function Host() {
    const p = prefsMod.usePreferences();
    live = p.prefs;
    hook = p;
    return (
      <PreferencesModal
        prefs={p.prefs}
        transforms={p.transforms}
        presets={p.presets}
        onUpdate={p.updatePref}
        onUpdateTransform={p.updateTransform}
        onReset={p.resetAll}
        onClose={() => {}}
        onSavePreset={p.savePreset}
        onLoadPreset={p.loadPreset}
        onDeletePreset={p.deletePreset}
        onRestoreSettings={p.applySettings}
        onRestorePreset={p.restorePreset}
      />
    );
  }
  const { unmount } = render(<Host />);
  return { prefsMod, linksMod, unmount, read: () => live!, store: () => hook! };
}

/**
 * The hex text box of one preference row, found by the row's LABEL.
 */
function hexBoxFor(label: string): HTMLInputElement {
  let el: HTMLElement | null = screen.getByText(label);
  while (el && !el.querySelector('input[type="color"]')) el = el.parentElement;
  if (!el) throw new Error(`no colour control around "${label}"`);
  const boxes = el.querySelectorAll("input");
  // [0] is the native swatch, [1] the hex field. The row is the SMALLEST
  // ancestor holding a colour input, so these belong to this preference.
  return boxes[1] as HTMLInputElement;
}

/** Type a hex and commit it (the field's commit edge is blur, not keystroke). */
function typeHex(box: HTMLInputElement, hex: string) {
  act(() => {
    fireEvent.change(box, { target: { value: hex } });
    fireEvent.blur(box);
  });
}

/** Go to a page of the window's sidebar. */
function openPage(label: string) {
  act(() => { fireEvent.click(screen.getByRole("button", { name: label })); });
}

/** Run "Reset to defaults" from the window's ⋯ menu. */
function resetAll() {
  act(() => { fireEvent.click(screen.getByRole("button", { name: "Options" })); });
  act(() => { fireEvent.click(screen.getByText("Reset to defaults")); });
}

const PARENT_HEX = "#3a5f8a";

describe("every door of the preferences dialog cascades a locked link", () => {
  it("the Smart section row moves the linked shades", async () => {
    const { read } = await mountDialog();
    const before = { libraryBg: read().libraryBg, tabBg: read().tabBg };

    openPage("Top bar");
    typeHex(hexBoxFor("Virgil bar background"), PARENT_HEX);

    expect(read().topbarBackground).toBe(PARENT_HEX);
    expect(read().tabBg).not.toBe(before.tabBg);
    // The bar is a band of its own: the Library follows the page, not the bar.
    expect(read().libraryBg).toBe(before.libraryBg);

    typeHex(hexBoxFor("Document background"), PARENT_HEX);

    expect(read().backgroundColor).toBe(PARENT_HEX);
    expect(read().libraryBg).not.toBe(before.libraryBg);
  });

  it("an UNLOCKED link is inert", async () => {
    const { linksMod, read } = await mountDialog();
    act(() => {
      linksMod.setLinkLocked("backgroundColor", "libraryBg", false);
      linksMod.setLinkLocked("topbarBackground", "tabBg", false);
    });
    const before = { libraryBg: read().libraryBg, tabBg: read().tabBg };

    openPage("Top bar");
    typeHex(hexBoxFor("Virgil bar background"), PARENT_HEX);
    typeHex(hexBoxFor("Document background"), PARENT_HEX);

    expect(read().topbarBackground).toBe(PARENT_HEX);
    expect(read().backgroundColor).toBe(PARENT_HEX);
    expect(read().libraryBg).toBe(before.libraryBg);
    expect(read().tabBg).toBe(before.tabBg);
  });
});

describe("the cascade's shape inside the one writer", () => {
  async function mountStore() {
    const mod = await import("@/hooks/usePreferences");
    const { renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() => mod.usePreferences());
    return { mod, result };
  }

  it("editing a CHILD leaves its link alone", async () => {
    const { result } = await mountStore();
    const parentBefore = result.current.prefs.topbarBackground;

    act(() => result.current.updatePref("libraryBg", "#112233"));

    expect(result.current.prefs.libraryBg).toBe("#112233");
    expect(result.current.prefs.topbarBackground).toBe(parentBefore);
  });

  it("parent + children land in ONE state write and ONE persist", async () => {
    const { result } = await mountStore();
    const spy = vi.spyOn(localStorage, "setItem");

    act(() => result.current.updatePref("topbarBackground", PARENT_HEX));

    const prefWrites = spy.mock.calls.filter(([k]) => k === "virgil-editor-prefs");
    expect(prefWrites).toHaveLength(1);
    // …and that single write already carries the cascaded children.
    const persisted = JSON.parse(prefWrites[0][1] as string);
    expect(persisted.topbarBackground).toBe(PARENT_HEX);
    expect(persisted.libraryBg).toBe(result.current.prefs.libraryBg);
    expect(persisted.tabBg).toBe(result.current.prefs.tabBg);
    spy.mockRestore();
  });

  it("a non-string preference takes the raw path", async () => {
    const { result } = await mountStore();
    act(() => result.current.updatePref("editorFontSize", 1.2));
    expect(result.current.prefs.editorFontSize).toBe(1.2);
  });
});

/**
 * Task 903 — "Reset to defaults" wiped every preference and transform in one
 * click with no way back. It now sits in the window's ⋯ menu and offers Undo, which restores the snapshot it
 * replaced; and any further change retires the offer — from ANY writer, not
 * just the dialog's own controls (task 1121: the offer is derived from the live
 * state, so FontsDialog and a peer window retire it too).
 */
describe("Reset to defaults is undoable (task 903)", () => {
  it("the global transform sliders resolve by their label", async () => {
    await mountDialog();
    expect(screen.getByLabelText("Contrast").getAttribute("type")).toBe("range");
    expect(screen.getByLabelText("Hue")).toBeTruthy();
    expect(screen.getByLabelText("Brightness")).toBeTruthy();
  });

  it("reset → Undo restores the prior settings", async () => {
    const { read, prefsMod } = await mountDialog();
    openPage("Top bar");
    typeHex(hexBoxFor("Virgil bar background"), PARENT_HEX);
    expect(read().topbarBackground).toBe(PARENT_HEX);

    resetAll();
    expect(read().topbarBackground).toBe(prefsMod.DEFAULT_PREFS.topbarBackground);
    expect(screen.getByRole("status").textContent).toContain("Preferences reset");

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    expect(read().topbarBackground).toBe(PARENT_HEX);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("a later edit retires the Undo offer", async () => {
    await mountDialog();
    openPage("Top bar");
    resetAll();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    typeHex(hexBoxFor("Virgil bar background"), PARENT_HEX);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("an edit from OUTSIDE the dialog (FontsDialog's raw updatePref) retires the offer", async () => {
    const { read, store } = await mountDialog();
    resetAll();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    // FontsDialog is wired straight to the store's door, not the dialog's.
    act(() => store().updatePref("editorFontSize", 1.37));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(read().editorFontSize).toBe(1.37);
  });

  it("an edit from a PEER window (storage event) retires the offer", async () => {
    const { read, prefsMod } = await mountDialog();
    resetAll();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    act(() => {
      localStorage.setItem(
        "virgil-editor-prefs",
        JSON.stringify({ ...prefsMod.DEFAULT_PREFS, editorFontSize: 1.37 }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "virgil-editor-prefs" }));
    });
    expect(read().editorFontSize).toBe(1.37);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("the destructive action stays out of sight until its menu opens", async () => {
    await mountDialog();
    expect(screen.queryByText("Reset to defaults")).toBeNull();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Options" })); });
    expect(screen.getByText("Reset to defaults").getAttribute("role")).toBe("menuitem");
  });
});

/**
 * Task 1489 — the dialog renders FIVE stores (prefs, transforms, and the Smart
 * section's panel colours, panel typography and link deltas), but reset, its
 * Undo and presets spanned only the first two. Every whole-settings operation
 * now iterates the one declared table (`SIDE_SETTINGS_STORES`), and loading a
 * preset is undoable like reset.
 */
/** The preset picker, on the window's first page. */
function presetPicker(): HTMLSelectElement {
  return screen.getByLabelText("Preset") as HTMLSelectElement;
}

describe("whole-settings operations span every store the dialog renders (task 1489)", () => {
  async function sideStores() {
    const theme = await import("@/lib/panel-theme");
    const typo = await import("@/lib/panel-typography");
    const links = await import("@/lib/pref-links");
    const colorKey = (Object.keys(theme.DEFAULT_PANEL_COLORS) as Array<keyof typeof theme.DEFAULT_PANEL_COLORS>)
      .find((k) => !theme.SYSTEM_THEME_KEYS.has(k))!;
    const typoKey = Object.keys(typo.DEFAULT_PANEL_TYPOGRAPHY)[0] as keyof typeof typo.DEFAULT_PANEL_TYPOGRAPHY;
    const linkKey = Object.keys(links.DEFAULT_LINK_STATES)[0];
    const set = () => act(() => {
      theme.setPanelColor(colorKey, "#123456");
      typo.setPanelTypographyField(typoKey, "fontSize", 23);
      links.setLinkField(linkKey, "deltaL", 0.31);
    });
    const expectSet = () => {
      expect(theme.getPanelColor(colorKey)).toBe("#123456");
      expect(typo.getPanelTypography(typoKey).fontSize).toBe(23);
      expect(links.getLinkState(linkKey)!.deltaL).toBe(0.31);
    };
    const expectDefault = () => {
      expect(theme.getPanelColorOverrides()).toEqual({});
      expect(typo.getAllPanelTypographyOverrides()).toEqual({});
      expect(links.getAllLinkStates()).toEqual(links.DEFAULT_LINK_STATES);
    };
    return { set, expectSet, expectDefault, theme, colorKey };
  }

  it("Reset clears panel colour, panel typography and link delta; Undo restores all three", async () => {
    await mountDialog();
    const s = await sideStores();
    s.set();
    s.expectSet();

    resetAll();
    s.expectDefault();

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    s.expectSet();
  });

  it("a side-store edit after reset retires the Undo offer", async () => {
    await mountDialog();
    const s = await sideStores();
    resetAll();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    act(() => s.theme.setPanelColor(s.colorKey, "#654321"));
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("loading a preset offers Undo, which restores the tweaks it replaced", async () => {
    const { read, prefsMod } = await mountDialog();
    const s = await sideStores();
    openPage("Top bar");
    typeHex(hexBoxFor("Virgil bar background"), PARENT_HEX);
    s.set();

    openPage("Theme");
    act(() => { fireEvent.change(presetPicker(), { target: { value: "Default" } }); });
    expect(read().topbarBackground).toBe(prefsMod.DEFAULT_PREFS.topbarBackground);
    s.expectDefault();
    expect(screen.getByRole("status").textContent).toContain("Preset “Default” loaded");

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Undo" })); });
    expect(read().topbarBackground).toBe(PARENT_HEX);
    s.expectSet();
  });

  it("loading a preset that changes nothing offers no Undo", async () => {
    await mountDialog();
    act(() => { fireEvent.change(presetPicker(), { target: { value: "Default" } }); });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("a preset captures the side stores, and loading it puts them back", async () => {
    const { store } = await mountDialog();
    const s = await sideStores();
    s.set();
    act(() => { store().savePreset("Mine"); });
    act(() => { store().resetAll(); });
    s.expectDefault();
    act(() => { store().loadPreset("Mine"); });
    s.expectSet();
  });
});
