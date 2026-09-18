// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import type { EditorPreferences } from "@/hooks/usePreferences";

// Something in the dialog's import graph reaches `@/lib/storage`, whose backend
// is picked with a bare `require` vitest can't resolve (the known barrel gotcha)
// — stub it wholesale; nothing here calls a storage fn.
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "mutateBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = {};
  for (const name of STORAGE_FNS) mod[name] = name === "isDevStorage" ? false : vi.fn();
  return mod;
});

/**
 * The locked-link cascade belongs to the WRITER, not to a call site (task 625).
 *
 * `topbarBackground` is a linked parent: `libraryBg` and `tabBg` track it by a
 * lightness delta, and the links ship LOCKED. But the cascade used to be a
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
  function Host() {
    const p = prefsMod.usePreferences();
    live = p.prefs;
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
      />
    );
  }
  const { unmount } = render(<Host />);
  return { prefsMod, linksMod, unmount, read: () => live! };
}

/**
 * The hex text box of one preference row, found by the row's LABEL — the two
 * doors label the same key differently ("Virgil bar background" vs "Top bar
 * background"), which is exactly why they could drift apart.
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

/** Open the collapsed tree group that carries the tree's copy of the row. */
function openTreeGroup(label: string) {
  act(() => { fireEvent.click(screen.getByText(label)); });
}

const PARENT_HEX = "#3a5f8a";

describe("every door of the preferences dialog cascades a locked link", () => {
  it("the Smart section row moves the linked shades", async () => {
    const { read } = await mountDialog();
    const before = { libraryBg: read().libraryBg, tabBg: read().tabBg };

    typeHex(hexBoxFor("Virgil bar background"), PARENT_HEX);

    expect(read().topbarBackground).toBe(PARENT_HEX);
    expect(read().libraryBg).not.toBe(before.libraryBg);
    expect(read().tabBg).not.toBe(before.tabBg);
  });

  it("the 'All preferences' tree row moves them too — the bug", async () => {
    const { read } = await mountDialog();
    const before = { libraryBg: read().libraryBg, tabBg: read().tabBg };

    openTreeGroup("Top Bar & Browser");
    typeHex(hexBoxFor("Top bar background"), PARENT_HEX);

    expect(read().topbarBackground).toBe(PARENT_HEX);
    expect(read().libraryBg).not.toBe(before.libraryBg);
    expect(read().tabBg).not.toBe(before.tabBg);
  });

  it("the two doors produce byte-identical preferences", async () => {
    const smart = await mountDialog();
    typeHex(hexBoxFor("Virgil bar background"), PARENT_HEX);
    const viaSmart = { ...smart.read() };

    // A second, independent dialog over a fresh store — the first must go, or
    // both copies of every row answer to the same query.
    smart.unmount();
    vi.resetModules();
    installLocalStorage();
    const tree = await mountDialog();
    openTreeGroup("Top Bar & Browser");
    typeHex(hexBoxFor("Top bar background"), PARENT_HEX);

    expect({ ...tree.read() }).toEqual(viaSmart);
  });

  it("an UNLOCKED link is still inert from either door", async () => {
    const { linksMod, read } = await mountDialog();
    act(() => {
      linksMod.setLinkLocked("topbarBackground", "libraryBg", false);
      linksMod.setLinkLocked("topbarBackground", "tabBg", false);
    });
    const before = { libraryBg: read().libraryBg, tabBg: read().tabBg };

    openTreeGroup("Top Bar & Browser");
    typeHex(hexBoxFor("Top bar background"), PARENT_HEX);

    expect(read().topbarBackground).toBe(PARENT_HEX);
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
