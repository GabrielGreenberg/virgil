"use client";

/**
 * Zen Mode — suppress editor chrome for a distraction-free view
 * ==============================================================
 *
 * A global toggle that hides the editor's surrounding chrome (icon strips,
 * panel columns, floating MenuBar, marginalia gutters, popped-out panels
 * and cards) while leaving the underlying layout state untouched. The top
 * bar stays visible so there's always an affordance to toggle Zen off.
 *
 * In Zen mode, empty adjustable "page margins" take the place of where
 * the panel columns would normally sit. Their widths are stored here
 * (leftMargin / rightMargin), independent of the panel column widths, so
 * a narrow reading margin doesn't force narrow panels when Zen is off.
 *
 * Architecture mirrors usePreferenceMode.ts — module-scoped state, pub/sub
 * via useSyncExternalStore, localStorage persistence, and a body attribute
 * mirror (`data-zen-mode="on"`).
 *
 * Storage key: "virgil-zen-mode" — JSON: { on: boolean, leftMargin: number, rightMargin: number }.
 * Legacy boolean values are migrated on load.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "virgil-zen-mode";
const DEFAULT_MARGIN = 160;
// Bounds are generous so Zen can preserve whatever margins the non-Zen
// layout currently has (icon strip alone ≈ 42px; strip + wide panel can
// easily exceed 600). Drag handle in ZenMargin has its own bounds.
const MIN_MARGIN = 0;
const MAX_MARGIN = 1200;

interface ZenState {
  on: boolean;
  leftMargin: number;
  rightMargin: number;
  // Top/bottom gutter heights around the page in zen mode. Independent
  // of `prefs.topGutter` / `prefs.bottomGutter` so the non-zen layout's
  // gutter prefs are preserved when toggling zen on/off. Default 0 —
  // the page extends to the top/bottom edges of the window symmetrically.
  // User can drag either handle to grow that side.
  topGutter: number;
  bottomGutter: number;
}

let _state: ZenState = { on: false, leftMargin: DEFAULT_MARGIN, rightMargin: DEFAULT_MARGIN, topGutter: 0, bottomGutter: 0 };
const _ssrSnapshot: ZenState = { on: false, leftMargin: DEFAULT_MARGIN, rightMargin: DEFAULT_MARGIN, topGutter: 0, bottomGutter: 0 };
let _loaded = false;
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((l) => l());
}

function _loadOnce() {
  if (_loaded) return;
  _loaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "boolean") {
      // Legacy format: just the on/off flag.
      _state = { ..._state, on: parsed };
    } else if (parsed && typeof parsed === "object") {
      _state = {
        on: parsed.on === true,
        leftMargin: typeof parsed.leftMargin === "number" ? parsed.leftMargin : DEFAULT_MARGIN,
        rightMargin: typeof parsed.rightMargin === "number" ? parsed.rightMargin : DEFAULT_MARGIN,
        topGutter: typeof parsed.topGutter === "number" ? parsed.topGutter : 0,
        bottomGutter: typeof parsed.bottomGutter === "number" ? parsed.bottomGutter : 0,
      };
    }
  } catch {
    /* ignore */
  }
}

function _persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch { /* ignore */ }
}

function _subscribe(listener: () => void) {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function _clamp(n: number) {
  return Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, n));
}

/**
 * Read/write the zen-mode state.
 *
 *   const { on, toggle, set, leftMargin, rightMargin, setLeftMargin, setRightMargin } = useZenMode();
 */
export function useZenMode() {
  _loadOnce();

  const state = useSyncExternalStore(
    _subscribe,
    () => _state,
    () => _ssrSnapshot,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (state.on) {
      document.body.setAttribute("data-zen-mode", "on");
    } else {
      document.body.removeAttribute("data-zen-mode");
    }
  }, [state.on]);

  const set = useCallback((value: boolean) => {
    if (_state.on === value) return;
    _state = { ..._state, on: value };
    _persist();
    _notify();
  }, []);

  const toggle = useCallback(() => {
    _state = { ..._state, on: !_state.on };
    _persist();
    _notify();
  }, []);

  const setLeftMargin = useCallback((w: number) => {
    const next = _clamp(w);
    if (_state.leftMargin === next) return;
    _state = { ..._state, leftMargin: next };
    _persist();
    _notify();
  }, []);

  const setRightMargin = useCallback((w: number) => {
    const next = _clamp(w);
    if (_state.rightMargin === next) return;
    _state = { ..._state, rightMargin: next };
    _persist();
    _notify();
  }, []);

  const setTopGutter = useCallback((h: number) => {
    const next = _clamp(h);
    if (_state.topGutter === next) return;
    _state = { ..._state, topGutter: next };
    _persist();
    _notify();
  }, []);

  const setBottomGutter = useCallback((h: number) => {
    const next = _clamp(h);
    if (_state.bottomGutter === next) return;
    _state = { ..._state, bottomGutter: next };
    _persist();
    _notify();
  }, []);

  return {
    on: state.on,
    toggle,
    set,
    leftMargin: state.leftMargin,
    rightMargin: state.rightMargin,
    setLeftMargin,
    setRightMargin,
    topGutter: state.topGutter,
    setTopGutter,
    bottomGutter: state.bottomGutter,
    setBottomGutter,
  };
}
