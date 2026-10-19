"use client";

/**
 * Zen Mode — suppress editor chrome for a distraction-free view
 * ==============================================================
 *
 * A global toggle that hides the editor's surrounding chrome (icon strips,
 * panel columns, floating MenuBar, marginalia markers, popped-out panels
 * and cards) while leaving the underlying layout state untouched. The top
 * bar stays visible so there's always an affordance to toggle Zen off.
 *
 * Zen is a VIEW of the normal page, not a second layout: the page keeps the
 * width normal view gives it, centred where the panels were. That width is
 * DERIVED (`normal-view-rails.ts`), never stored here — so this store is
 * on/off and nothing else (task 1178 retired the old per-side zen margins and
 * their drag handles; change the page width in normal view).
 *
 * Architecture: module-scoped state, pub/sub via useSyncExternalStore,
 * localStorage persistence, and a body attribute mirror
 * (`data-zen-mode="on"`). `useWindowChrome.ts` mirrors the same shape.
 *
 * Storage key: "virgil-zen-mode" — JSON: { on: boolean }. Legacy boolean
 * values are migrated on load; the retired `leftMargin` / `rightMargin`
 * fields of older blobs are ignored and dropped on the next write.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { subscribeToStorageKey } from "@/lib/cross-window-storage";

const STORAGE_KEY = "virgil-zen-mode";

interface ZenState {
  on: boolean;
}

let _state: ZenState = { on: false };
const _ssrSnapshot: ZenState = { on: false };
let _loaded = false;
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((l) => l());
}

/**
 * The ONE parse/validate path for the persisted blob — shared by the one-shot
 * hydrate and the cross-window re-sync below, so a peer's blob is filtered by
 * exactly the same rules (including the legacy-boolean migration) as a local
 * one. Returns the defaults when the key is absent or unreadable, which is
 * also what a peer's `clear()` must produce.
 */
function _readFromStorage(): ZenState {
  const base: ZenState = { on: false };
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return base;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "boolean") {
      // Legacy format: just the on/off flag.
      return { on: parsed };
    }
    if (parsed && typeof parsed === "object") {
      return { on: parsed.on === true };
    }
  } catch {
    /* ignore */
  }
  return base;
}

function _loadOnce() {
  if (_loaded) return;
  _loaded = true;
  if (typeof window === "undefined") return;
  _state = _readFromStorage();
}

// Cross-window re-sync (task 179, following 177). `_loaded` is a one-shot
// latch, so without this a second window's snapshot could never re-hydrate and
// its next whole-blob `_persist()` would silently drop the peer's zen state.
// The `storage` event never fires in the writing window, so this is the peer
// channel only; the re-read runs the same validation as the hydrate, and
// `_notify()` re-renders every `useZenMode` consumer (which also re-runs the
// `data-zen-mode` body-attribute effect).
subscribeToStorageKey(STORAGE_KEY, () => {
  _state = _readFromStorage();
  _notify();
});

function _persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch { /* ignore */ }
}

function _subscribe(listener: () => void) {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/**
 * Read/write the zen-mode state.
 *
 *   const { on, toggle, set } = useZenMode();
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
    _state = { on: value };
    _persist();
    _notify();
  }, []);

  const toggle = useCallback(() => {
    _state = { on: !_state.on };
    _persist();
    _notify();
  }, []);

  return { on: state.on, toggle, set };
}
