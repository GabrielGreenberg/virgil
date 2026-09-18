// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * Preference presets (task 624) — the built-in "Default" is DERIVED from the
 * shipped defaults, never STORED.
 *
 * It used to be persisted alongside the user's presets, so the first Save froze
 * a copy of whatever `DEFAULT_PREFS` was that day. Once the promote-defaults
 * pipeline shipped new colours the two doors disagreed: "Reset to defaults"
 * applied the new ones, picking "Default" applied the frozen old ones — and
 * then WROTE them back as the user's prefs. The same storage round-trip let a
 * user preset named "Default" shadow the built-in, where every by-name lookup
 * (load, delete, the delete affordance) found the built-in first and the user's
 * entry became unreachable.
 *
 * The three legs below are the contract: nothing derived is written, nothing
 * derived is read back, and user names stay unambiguous across the migration.
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

const PRESETS_KEY = "virgil-editor-presets";
const PREFS_KEY = "virgil-editor-prefs";

const storedPresets = () => JSON.parse(localStorage.getItem(PRESETS_KEY)!);

beforeEach(() => { installLocalStorage(); vi.resetModules(); });

async function mount() {
  const mod = await import("@/hooks/usePreferences");
  const { result } = renderHook(() => mod.usePreferences());
  return { mod, result };
}

describe("the built-in preset is derived, never stored", () => {
  it("a stale stored built-in is ignored: 'Default' applies TODAY's defaults", async () => {
    // What a pre-fix install looks like: the built-in frozen at an old palette.
    localStorage.setItem(PRESETS_KEY, JSON.stringify([
      {
        name: "Default",
        builtIn: true,
        createdAt: 0,
        prefs: { topbarBackground: "#abcdef", tabBg: "#fedcba" },
        transforms: {},
      },
    ]));

    const { mod, result } = await mount();

    const builtIn = result.current.presets.find((p) => p.builtIn)!;
    expect(builtIn.prefs.topbarBackground).toBe(mod.DEFAULT_PREFS.topbarBackground);
    expect(builtIn.prefs.topbarBackground).not.toBe("#abcdef");

    act(() => result.current.loadPreset("Default"));
    expect(result.current.prefs.topbarBackground).toBe(mod.DEFAULT_PREFS.topbarBackground);
    // …and the write-back is the live defaults too, not the frozen copy.
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).topbarBackground)
      .toBe(mod.DEFAULT_PREFS.topbarBackground);
  });

  it("'Default' and 'Reset to defaults' cannot disagree", async () => {
    const { result } = await mount();

    act(() => result.current.updatePref("topbarBackground", "#111111"));
    act(() => result.current.loadPreset("Default"));
    const viaPreset = result.current.prefs;

    act(() => result.current.updatePref("topbarBackground", "#222222"));
    act(() => result.current.resetAll());

    expect(result.current.prefs).toEqual(viaPreset);
  });

  it("saving a preset writes no built-in to storage", async () => {
    const { result } = await mount();

    act(() => { result.current.savePreset("Warm"); });

    expect(storedPresets()).toHaveLength(1);
    expect(storedPresets()[0].name).toBe("Warm");
    expect(storedPresets().some((p: { builtIn?: boolean }) => p.builtIn)).toBe(false);
    // …while the picker still offers it, derived.
    expect(result.current.presets.filter((p) => p.builtIn)).toHaveLength(1);
  });

  it("deleting a preset does not resurrect a stored built-in", async () => {
    const { result } = await mount();

    act(() => { result.current.savePreset("Warm"); });
    act(() => result.current.deletePreset("Warm"));

    expect(storedPresets()).toEqual([]);
    expect(result.current.presets.map((p) => p.name)).toEqual(["Default"]);
  });
});

describe("built-in names are reserved", () => {
  it("refuses to save a preset named like a built-in, in any casing", async () => {
    const { mod, result } = await mount();

    expect(mod.isReservedPresetName("Default")).toBe(true);
    expect(mod.isReservedPresetName("  default ")).toBe(true);
    expect(mod.isReservedPresetName("Default 2")).toBe(false);

    let ok: boolean | undefined;
    act(() => { ok = result.current.savePreset(" DEFAULT "); });

    expect(ok).toBe(false);
    expect(result.current.presets.map((p) => p.name)).toEqual(["Default"]);
    expect(localStorage.getItem(PRESETS_KEY)).toBeNull();
  });

  it("refuses an empty name", async () => {
    const { result } = await mount();
    let ok: boolean | undefined;
    act(() => { ok = result.current.savePreset("   "); });
    expect(ok).toBe(false);
    expect(result.current.presets).toHaveLength(1);
  });

  it("renames — never drops — a stored preset that shadows a built-in", async () => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify([
      { name: "Default", createdAt: 1, prefs: { topbarBackground: "#abcdef" }, transforms: {} },
      { name: "Warm", createdAt: 2, prefs: { topbarBackground: "#ffeecc" }, transforms: {} },
    ]));

    const { result } = await mount();

    expect(result.current.presets.map((p) => p.name)).toEqual(["Default", "Default 2", "Warm"]);

    // The user's work is reachable again: it loads, and it is not the built-in.
    act(() => result.current.loadPreset("Default 2"));
    expect(result.current.prefs.topbarBackground).toBe("#abcdef");

    // …and it is deletable, which the shadowed entry never was.
    act(() => result.current.deletePreset("Default 2"));
    expect(result.current.presets.map((p) => p.name)).toEqual(["Default", "Warm"]);
  });

  it("disambiguates duplicate user names so every option has a unique value", async () => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify([
      { name: "Warm", createdAt: 1, prefs: { topbarBackground: "#111111" }, transforms: {} },
      { name: "warm", createdAt: 2, prefs: { topbarBackground: "#222222" }, transforms: {} },
    ]));

    const { result } = await mount();
    const names = result.current.presets.map((p) => p.name);

    expect(names).toEqual(["Default", "Warm", "warm 2"]);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);

    act(() => result.current.loadPreset("warm 2"));
    expect(result.current.prefs.topbarBackground).toBe("#222222");
  });
});

describe("loading and overwriting", () => {
  it("re-loading the same preset re-applies it over intervening edits", async () => {
    const { result } = await mount();

    act(() => result.current.updatePref("topbarBackground", "#111111"));
    act(() => { result.current.savePreset("Warm"); });

    act(() => result.current.loadPreset("Warm"));
    act(() => result.current.updatePref("topbarBackground", "#999999"));
    act(() => result.current.loadPreset("Warm"));

    expect(result.current.prefs.topbarBackground).toBe("#111111");
  });

  it("saving an existing user name overwrites in place", async () => {
    const { result } = await mount();

    act(() => result.current.updatePref("topbarBackground", "#111111"));
    act(() => { result.current.savePreset("Warm"); });
    act(() => result.current.updatePref("topbarBackground", "#222222"));
    act(() => { result.current.savePreset("  Warm  "); });

    expect(result.current.presets.filter((p) => p.name === "Warm")).toHaveLength(1);
    expect(storedPresets()).toHaveLength(1);
    expect(storedPresets()[0].prefs.topbarBackground).toBe("#222222");
  });

  it("a user preset is merged onto the LIVE defaults, so new shipped keys appear", async () => {
    localStorage.setItem(PRESETS_KEY, JSON.stringify([
      { name: "Sparse", createdAt: 1, prefs: { topbarBackground: "#abcdef" }, transforms: {} },
    ]));

    const { mod, result } = await mount();
    act(() => result.current.loadPreset("Sparse"));

    expect(result.current.prefs.topbarBackground).toBe("#abcdef");
    expect(result.current.prefs.tabBg).toBe(mod.DEFAULT_PREFS.tabBg);
  });
});
