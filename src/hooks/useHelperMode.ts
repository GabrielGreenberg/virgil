"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  subscribeToStorageKey,
  writeStorageIfChanged,
} from "@/lib/cross-window-storage";

const STORAGE_KEY = "virgil-helper-mode";

let _on = false;
let _loaded = false;
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((l) => l());
}

function _read(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw != null && JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

function _loadOnce() {
  if (_loaded) return;
  _loaded = true;
  if (typeof window === "undefined") return;
  _on = _read();
  // A peer window's toggle re-reads here, so two windows can't disagree on
  // helper-mode chrome until a reload (task 599). Module-lifetime, like the
  // snapshot it guards.
  subscribeToStorageKey(STORAGE_KEY, () => {
    const next = _read();
    if (next === _on) return;
    _on = next;
    _notify();
  });
}

function _persist() {
  if (typeof window === "undefined") return;
  writeStorageIfChanged(STORAGE_KEY, JSON.stringify(_on));
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
