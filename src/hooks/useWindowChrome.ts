"use client";

/**
 * Window chrome geometry — the app's single reactive view of the OS/browser
 * window edges (display mode + Window-Controls-Overlay title-bar rect).
 * ====================================================================
 *
 * The VISUAL behaviour (the Virgil bar growing into the WCO title-bar strip
 * and its material insetting to clear the window controls) is driven entirely
 * by the `--window-inset-*` CSS variables in globals.css, which read the LIVE
 * `env(titlebar-area-*)` / `env(safe-area-inset-*)` values with zero JS. This
 * hook is the thin JS companion for the things CSS can't express:
 *
 *   • `displayMode` — a single reactive source of truth for browser /
 *     standalone / window-controls-overlay / fullscreen (dedupes the old
 *     one-shot `matchMedia` read in InstallPwaPrompt).
 *   • `getWindowInsetTopPx()` — an imperative px reading of the reserved top
 *     strip for JS clamps (e.g. FloatingPanel drag), computed from the live
 *     WCO title-bar rect.
 *   • a `data-display-mode` mirror on <html> (documentElement) so
 *     display-mode-conditional CSS can branch off ONE SSOT selector
 *     (`:root[data-display-mode="…"]`) instead of a raw @media query that the
 *     dev preview / ?wco-debug can never enter. A pre-paint bootstrap in
 *     layout.tsx seeds the same attribute before first paint (flash-free);
 *     this hook keeps it live and, under debug, forces WCO.
 *
 * Architecture mirrors useZenMode.ts / usePreferenceMode.ts — module-scoped
 * state, pub/sub via useSyncExternalStore, a <body> attribute mirror.
 *
 * KEYSTROKE SANCTITY: this is a WINDOW-level / wall-clock service, NOT an
 * `editor.on(...)` subscriber — it does O(1) work per real geometry/display
 * change (a resize, a WCO `geometrychange`, a display-mode `change`), never
 * per keystroke and never proportional to document size. It belongs to the
 * "wall-clock services are exempt" category alongside DiskWatcher; it is
 * deliberately NOT on the permitted-`editor.on` list in AGENTS.md.
 *
 * DEV OVERRIDE: WCO only exists in an installed desktop PWA — the dev-preview
 * iframe / a normal tab never enters it, so the title-bar behaviour MASKS in
 * preview. Set `localStorage["virgil:wco-debug"] = "1"` (or append
 * `?wco-debug` to the URL) to inject synthetic insets onto the document root
 * so the bar's stretch + material-shift can be eyeballed in the preview.
 */

import { useEffect, useSyncExternalStore } from "react";

export type DisplayMode =
  | "browser"
  | "standalone"
  | "window-controls-overlay"
  | "fullscreen";

export interface WindowInsets {
  /** px reserved at each viewport edge by OS/browser chrome. */
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WindowChrome {
  displayMode: DisplayMode;
  /** Whether the Window Controls Overlay is currently painted. */
  wcoVisible: boolean;
  /** px insets derived from the live WCO title-bar rect (safe-area is 0 here — CSS owns that half). */
  insets: WindowInsets;
}

const ZERO: WindowInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const _ssrSnapshot: WindowChrome = {
  displayMode: "browser",
  wcoVisible: false,
  insets: ZERO,
};

// Synthetic insets used by the dev override so WCO can be seen in preview:
// a macOS-ish left gutter (traffic lights), a Chrome-ish right gutter
// (⋮ / puzzle / fold chevron), and a taller title-bar strip.
const DEBUG_INSETS: WindowInsets = { top: 48, right: 140, bottom: 0, left: 80 };

let _state: WindowChrome = _ssrSnapshot;
let _loaded = false;
const _listeners = new Set<() => void>();

interface WCOLike {
  visible: boolean;
  getTitlebarAreaRect: () => DOMRect;
  addEventListener: (t: string, cb: () => void) => void;
  removeEventListener: (t: string, cb: () => void) => void;
}

function _wco(): WCOLike | null {
  if (typeof navigator === "undefined") return null;
  const w = (navigator as unknown as { windowControlsOverlay?: WCOLike })
    .windowControlsOverlay;
  return w ?? null;
}

function _debugOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem("virgil:wco-debug") === "1") return true;
  } catch {
    /* ignore */
  }
  return typeof location !== "undefined" && location.search.includes("wco-debug");
}

function _matches(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

function _computeDisplayMode(): DisplayMode {
  // Priority order: the most "chrome-less"/specific mode wins.
  if (_matches("(display-mode: window-controls-overlay)")) return "window-controls-overlay";
  if (_matches("(display-mode: fullscreen)")) return "fullscreen";
  if (_matches("(display-mode: standalone)")) return "standalone";
  return "browser";
}

function _computeInsets(wcoVisible: boolean): WindowInsets {
  if (_debugOn()) return DEBUG_INSETS;
  const wco = _wco();
  if (!wcoVisible || !wco || typeof window === "undefined") return ZERO;
  try {
    const r = wco.getTitlebarAreaRect();
    const vw = window.innerWidth;
    return {
      top: Math.round(r.height),
      left: Math.round(r.x),
      right: Math.max(0, Math.round(vw - (r.x + r.width))),
      bottom: 0,
    };
  } catch {
    return ZERO;
  }
}

function _compute(): WindowChrome {
  const displayMode = _debugOn() ? "window-controls-overlay" : _computeDisplayMode();
  const wcoVisible = _debugOn() ? true : _wco()?.visible ?? false;
  return { displayMode, wcoVisible, insets: _computeInsets(wcoVisible) };
}

function _insetsEqual(a: WindowInsets, b: WindowInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

function _equal(a: WindowChrome, b: WindowChrome): boolean {
  return (
    a.displayMode === b.displayMode &&
    a.wcoVisible === b.wcoVisible &&
    _insetsEqual(a.insets, b.insets)
  );
}

function _loadOnce() {
  if (_loaded) return;
  _loaded = true;
  if (typeof window === "undefined") return;
  _state = _compute();
  _applyDebugVars();
}

/**
 * In dev-override mode, stamp the synthetic insets onto the document root as
 * inline styles so they beat the :root defaults and the env()-derived vars —
 * letting the WCO bar stretch/shift be seen without an installed PWA. In
 * normal operation this is a no-op: real CSS env() drives the vars.
 */
function _applyDebugVars() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (_debugOn()) {
    root.style.setProperty("--window-inset-top", `${DEBUG_INSETS.top}px`);
    root.style.setProperty("--window-inset-left", `${DEBUG_INSETS.left}px`);
    root.style.setProperty("--window-inset-right", `${DEBUG_INSETS.right}px`);
  } else {
    root.style.removeProperty("--window-inset-top");
    root.style.removeProperty("--window-inset-left");
    root.style.removeProperty("--window-inset-right");
  }
}

function _notify() {
  _listeners.forEach((l) => l());
}

function _onChange() {
  const next = _compute();
  if (_equal(next, _state)) return;
  _state = next;
  _notify();
}

// Live listener wiring: attached when the first subscriber arrives, torn
// down when the last leaves — so the store costs nothing when unused.
let _teardown: (() => void) | null = null;

function _attach() {
  if (_teardown || typeof window === "undefined") return;
  const cleanups: Array<() => void> = [];

  const mqls = [
    "(display-mode: window-controls-overlay)",
    "(display-mode: fullscreen)",
    "(display-mode: standalone)",
  ].map((q) => window.matchMedia(q));
  for (const mql of mqls) {
    mql.addEventListener("change", _onChange);
    cleanups.push(() => mql.removeEventListener("change", _onChange));
  }

  const wco = _wco();
  if (wco) {
    wco.addEventListener("geometrychange", _onChange);
    cleanups.push(() => wco.removeEventListener("geometrychange", _onChange));
  }

  // Horizontal WCO insets are viewport-relative, so a plain resize can change
  // them even without a geometrychange.
  //
  // This is the ONE geometry follower that deliberately stays LIVE through a
  // continuous layout gesture (task 317): the WCO title-bar strip is native
  // window chrome with a real visual obligation every frame, so parking it
  // would leave the strip's inset stale against the moving system buttons.
  // What it does NOT get to be is un-coalesced — `_onChange` notifies through
  // `useSyncExternalStore` at `EditorLayout`, i.e. an APP-ROOT re-render, and
  // `insets.right` mixes two independently-updated sources
  // (`getTitlebarAreaRect()` and `window.innerWidth`), so a one-frame lag
  // between them makes `right` oscillate and defeats the `_equal` bail. RAF
  // coalescing bounds that to at most one root render per frame. The
  // `geometrychange` and display-mode paths stay synchronous — they're
  // discrete, rare, and must land immediately.
  let resizeRaf = 0;
  const onResize = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      _onChange();
    });
  };
  window.addEventListener("resize", onResize);
  cleanups.push(() => {
    window.removeEventListener("resize", onResize);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
  });

  _teardown = () => {
    cleanups.forEach((c) => c());
    _teardown = null;
  };
}

function _subscribe(listener: () => void) {
  _loadOnce();
  if (_listeners.size === 0) _attach();
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
    if (_listeners.size === 0 && _teardown) _teardown();
  };
}

/**
 * Compute the current window insets fresh (WCO title-bar rect, or the dev
 * synthetic override). Pure w.r.t. the live globals — no dependence on the
 * subscribed store state — so it's safe to call whether or not the store is
 * mounted, and directly unit-testable. Safe-area is 0 here; the CSS
 * `--window-inset-*` vars own that half.
 */
export function readWindowInsets(): WindowInsets {
  if (typeof window === "undefined") return ZERO;
  const wcoVisible = _debugOn() ? true : _wco()?.visible ?? false;
  return _computeInsets(wcoVisible);
}

/**
 * Imperative px reading of the reserved top strip, for one-shot JS clamps
 * (e.g. clamping a dragged floating panel so it can't tuck under the WCO
 * title bar). Covers the WCO case (the one that matters on desktop, where
 * panels are dragged).
 */
export function getWindowInsetTopPx(): number {
  return readWindowInsets().top;
}

/**
 * Read/subscribe to the window chrome geometry.
 *
 *   const { displayMode, wcoVisible, insets } = useWindowChrome();
 *
 * Consume this ONCE at a stable top level (EditorLayout) so the <body>
 * mirror + listeners stay active for the whole session.
 */
export function useWindowChrome(): WindowChrome {
  _loadOnce();

  const state = useSyncExternalStore(_subscribe, () => _state, () => _ssrSnapshot);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // Mirror onto <html> (documentElement), NOT <body>: the pre-paint
    // bootstrap in layout.tsx sets this same attribute on <html> before the
    // body exists, so the two writers must target the same element for the
    // WCO CSS (:root[data-display-mode="..."]) to stay flash-free on load and
    // live thereafter. This hook keeps it current across display-mode changes
    // and, under ?wco-debug, forces "window-controls-overlay" so the preview
    // renders WCO chrome.
    document.documentElement.setAttribute("data-display-mode", state.displayMode);
    // Re-assert the debug vars after any change (a resize can re-run compute).
    _applyDebugVars();
  }, [state.displayMode, state.wcoVisible, state.insets]);

  return state;
}
