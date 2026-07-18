// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Cross-window sync for the module-global localStorage override stores
 * (task 177).
 *
 * The bug class: a store that hydrates ONCE (behind a `loaded` latch) and
 * serializes its WHOLE snapshot on every setter goes permanently stale in a
 * second window — and that window's next write silently clobbers the first
 * window's changes from its stale base. `outline-prefs-store` was fixed for
 * this in task 111; `panel-theme` (reported) and `panel-typography` (its
 * structural twin, swept alongside) are the remaining members.
 *
 * All three now ride ONE listener primitive, `subscribeToStorageKey`, whose
 * two easy-to-get-wrong guards (foreign keys; `key === null` is a clear() and
 * must be honored only from localStorage) are pinned here directly.
 */

const COLOR_KEY = "virgil-panel-colors";
const TYPO_KEY = "virgil-panel-typography";

// Deterministic in-memory localStorage — the ambient one in this runner is
// Node's experimental Web Storage and lacks a usable `clear`.
function installLocalStorage() {
  const m = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: ls, configurable: true, writable: true,
  });
}

/** Simulate a PEER window's write: the raw blob lands in storage, then the
 *  native `storage` event fires — which real browsers deliver only to OTHER
 *  windows, never the writer. */
function peerWrite(key: string, blob: unknown) {
  localStorage.setItem(key, JSON.stringify(blob));
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

async function freshTheme() {
  vi.resetModules();
  const m = await import("@/lib/panel-theme");
  m.loadPanelColors();
  return m;
}

async function freshTypography() {
  vi.resetModules();
  const m = await import("@/lib/panel-typography");
  m.loadPanelTypography();
  return m;
}

describe("subscribeToStorageKey (the shared listener contract)", () => {
  beforeEach(() => { installLocalStorage(); });

  it("fires for its own key, and not for a foreign one", async () => {
    vi.resetModules();
    const { subscribeToStorageKey } = await import("@/lib/cross-window-storage");
    const cb = vi.fn();
    const off = subscribeToStorageKey("mine", cb);

    window.dispatchEvent(new StorageEvent("storage", { key: "theirs" }));
    expect(cb).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent("storage", { key: "mine" }));
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    window.dispatchEvent(new StorageEvent("storage", { key: "mine" }));
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it("honors a localStorage clear (key === null) but not a sessionStorage one", async () => {
    vi.resetModules();
    const { subscribeToStorageKey } = await import("@/lib/cross-window-storage");
    const cb = vi.fn();
    subscribeToStorageKey("mine", cb);

    // A peer's sessionStorage.clear() also fires with a null key — ignore it.
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: sessionStorage }));
    expect(cb).not.toHaveBeenCalled();

    // jsdom's StorageEvent constructor only accepts a real jsdom Storage for
    // `storageArea`, so stamp our in-memory shim on after construction.
    const clearEvent = new StorageEvent("storage", { key: null });
    Object.defineProperty(clearEvent, "storageArea", { value: localStorage });
    window.dispatchEvent(clearEvent);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("panel-theme cross-window sync", () => {
  beforeEach(() => { installLocalStorage(); });

  it("re-syncs from a peer window's write, and the next local write preserves it", async () => {
    const s = await freshTheme();
    s.setPanelColor("todo", "#b45757");           // this window: Todo → Rust
    const cb = vi.fn();
    s.subscribePanelColors(cb);
    const v0 = s.getPanelColorVersion();

    // Peer window (which had the same base) sets Notes → Purple and rewrites
    // the whole blob, carrying our todo entry along.
    peerWrite(COLOR_KEY, { todo: "#b45757", note: "#9333ea" });

    expect(cb).toHaveBeenCalled();
    expect(s.getPanelColorVersion()).toBeGreaterThan(v0);
    expect(s.getPanelColor("note")).toBe("#9333ea");  // observed without a reload

    // The clobber test: our NEXT whole-blob write starts from the refreshed
    // base, so the peer's note override survives it.
    s.setPanelColor("cut", "#15803d");
    const raw = JSON.parse(localStorage.getItem(COLOR_KEY)!);
    expect(raw.note).toBe("#9333ea");
    expect(raw.todo).toBe("#b45757");
    expect(raw.cut).toBe("#15803d");
  });

  it("propagates a peer CLEARING an override (back to the default)", async () => {
    const s = await freshTheme();
    s.setPanelColor("todo", "#b45757");
    expect(s.isPanelColorOverridden("todo")).toBe(true);

    peerWrite(COLOR_KEY, {}); // peer called clearPanelColor("todo")

    expect(s.isPanelColorOverridden("todo")).toBe(false);
    expect(s.getPanelColor("todo")).toBe(s.DEFAULT_PANEL_COLORS.todo);
  });

  it("still refuses a peer blob's system-accent override (SYSTEM_THEME_KEYS)", async () => {
    const s = await freshTheme();
    const errorBefore = s.getPanelColor("error");

    peerWrite(COLOR_KEY, { aiRequest: "#9333ea", error: "#9333ea", note: "#9333ea" });

    // The sync path runs the SAME validation as the hydrate: system accents
    // are skipped, non-system entries are honored.
    expect(s.getPanelColor("error")).toBe(errorBefore);
    expect(s.getPanelColor("aiRequest")).toBe(s.DEFAULT_PANEL_COLORS.aiRequest);
    expect(s.getPanelColor("note")).toBe("#9333ea");
  });

  it("drops malformed values from a peer blob", async () => {
    const s = await freshTheme();
    peerWrite(COLOR_KEY, { note: "not-a-hex", todo: "#b45757", cut: 42 });
    expect(s.isPanelColorOverridden("note")).toBe(false);
    expect(s.isPanelColorOverridden("cut")).toBe(false);
    expect(s.getPanelColor("todo")).toBe("#b45757");
  });

  it("ignores a foreign key and a non-localStorage clear", async () => {
    const s = await freshTheme();
    s.setPanelColor("todo", "#b45757");
    const v0 = s.getPanelColorVersion();

    localStorage.setItem(COLOR_KEY, JSON.stringify({}));
    window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: sessionStorage }));

    // Neither event re-read storage, so the snapshot (and version) stand.
    expect(s.getPanelColorVersion()).toBe(v0);
    expect(s.getPanelColor("todo")).toBe("#b45757");
  });
});

describe("panel-typography cross-window sync", () => {
  beforeEach(() => { installLocalStorage(); });

  it("re-syncs from a peer write, and the next local write preserves it", async () => {
    const s = await freshTypography();
    s.setPanelTypographyField("note", "fontSize", 14);
    const cb = vi.fn();
    s.subscribePanelTypography(cb);
    const v0 = s.getPanelTypographyVersion();

    peerWrite(TYPO_KEY, {
      note: { fontSize: 14 },
      footnote: { fontFamily: "Lora" },
    });

    expect(cb).toHaveBeenCalled();
    expect(s.getPanelTypographyVersion()).toBeGreaterThan(v0);
    expect(s.getPanelTypography("footnote").fontFamily).toBe("Lora");

    s.setPanelTypographyField("todo", "fontSize", 13);
    const raw = JSON.parse(localStorage.getItem(TYPO_KEY)!);
    expect(raw.footnote).toEqual({ fontFamily: "Lora" });   // peer write survived
    expect(raw.note).toEqual({ fontSize: 14 });
    expect(raw.todo).toEqual({ fontSize: 13 });
  });

  it("drops malformed fields from a peer blob and propagates a clear", async () => {
    const s = await freshTypography();
    s.setPanelTypographyField("note", "fontSize", 14);

    peerWrite(TYPO_KEY, { note: { fontSize: "big", color: "nope" }, todo: null });
    expect(s.getPanelTypographyOverrides("note")).toEqual({});
    expect(s.getPanelTypographyOverrides("todo")).toEqual({});
  });
});
