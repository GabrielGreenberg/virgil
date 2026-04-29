"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

const STORAGE_KEY = "virgil-helper-mode";

let _on = false;
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
    if (raw != null) _on = JSON.parse(raw) === true;
  } catch {
    /* ignore */
  }
}

function _persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_on)); } catch { /* ignore */ }
}

function _subscribe(listener: () => void) {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

export function useHelperMode() {
  _loadOnce();

  const on = useSyncExternalStore(
    _subscribe,
    () => _on,
    () => false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (on) {
      document.body.setAttribute("data-helper-mode", "on");
    } else {
      document.body.removeAttribute("data-helper-mode");
    }
  }, [on]);

  const set = useCallback((value: boolean) => {
    if (_on === value) return;
    _on = value;
    _persist();
    _notify();
  }, []);

  const toggle = useCallback(() => {
    _on = !_on;
    _persist();
    _notify();
  }, []);

  return { on, toggle, set };
}
